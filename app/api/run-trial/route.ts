import { env } from "cloudflare:workers";
import { applyRandomnessPolicy } from "../../experiment/randomness";
import { buildColorToEmotionPrompt, buildWordToColorPrompt, type OrderPolicy } from "../../experiment/prompts";
import { buildChatRequest, safeEndpoint } from "../../experiment/model-request";
import { parseAssociationResponse, parseColorResponse } from "../../experiment/response-parser";

const PROJECT_ID = "ECX-2026-001";

type RunModel = {
  id: string;
  alias: string;
  model_id: string;
  base_url: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  supports_seed: number | boolean;
  supports_json: number | boolean;
};

type Trial = {
  task: "word" | "color";
  runIndex: number;
  stimulusId: string;
  stimulusHex?: string;
  stimulusIndex: number;
};

type AttemptStatus = "success" | "api_error" | "empty_response" | "validation_error" | "request_error";

async function saveAttempt(input: {
  logicalTrialId: string;
  model: RunModel;
  trial: Trial;
  attemptNo: number;
  status: AttemptStatus;
  httpStatus?: number;
  retryable: boolean;
  errorMessage?: string;
  rawResponse?: string;
  latencyMs: number;
}) {
  const taskType = input.trial.task === "word" ? "Word to Color" : "Color to Emotion";
  const attemptId = `${input.logicalTrialId}-attempt-${input.attemptNo}`;
  await env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (
    attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type,
    run_index, stimulus_id, attempt_no, status, http_status, retryable,
    error_message, raw_response, latency_ms, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      attemptId, input.logicalTrialId, PROJECT_ID, input.model.id, input.model.alias, taskType,
      input.trial.runIndex, input.trial.stimulusId, input.attemptNo, input.status,
      input.httpStatus ?? null, input.retryable ? 1 : 0, input.errorMessage || "",
      String(input.rawResponse || "").slice(0, 12000), input.latencyMs, new Date().toISOString(),
    ).run();
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as {
      apiKey: string;
      model: RunModel;
      settings: OrderPolicy & { timeout_seconds?: number };
      trial: Trial;
      retryCount?: number;
    };
    if (!body.apiKey || !body.model?.model_id || !body.model?.base_url || !body.trial) {
      return Response.json({ ok: false, retryable: false, message: "试次缺少 API Key、模型配置或刺激项。" }, { status: 400 });
    }

    body.apiKey = body.apiKey.trim();
    const { trial } = body;
    const logicalTrialId = `batch-${body.model.id}-${trial.task}-${trial.runIndex}-${trial.stimulusId}`;
    const attemptNo = Number(body.retryCount || 0);
    const prompt = trial.task === "word"
      ? buildWordToColorPrompt(trial.stimulusId)
      : buildColorToEmotionPrompt(trial.stimulusId, trial.stimulusHex || "", body.settings, trial.runIndex, trial.stimulusIndex).prompt;
    const policy = applyRandomnessPolicy(prompt, body.settings, trial.runIndex, trial.stimulusIndex, body.model.supports_seed);
    const requestBody = buildChatRequest(body.model, policy.prompt, trial.task, policy.nativeSeed);

    let response: Response;
    try {
      response = await fetch(safeEndpoint(body.model.base_url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey.trim()}` },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(Math.max(5, Number(body.settings.timeout_seconds) || 60) * 1000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型网络请求失败。";
      await saveAttempt({
        logicalTrialId, model: body.model, trial, attemptNo, status: "request_error",
        retryable: true, errorMessage: message, latencyMs: Date.now() - started,
      });
      return Response.json({ ok: false, retryable: true, message }, { status: 503 });
    }
    const payloadText = await response.text();
    const payload = (() => {
      try { return JSON.parse(payloadText); } catch { return {}; }
    })() as {
      error?: { message?: string; type?: string; code?: string; param?: string };
      choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string | null } }>;
    };
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      const errorParts = [payload.error?.message || `模型接口返回 HTTP ${response.status}`];
      if (payload.error?.code) errorParts.push(`code=${payload.error.code}`);
      if (payload.error?.param) errorParts.push(`param=${payload.error.param}`);
      const message = errorParts.join(" · ");
      await saveAttempt({
        logicalTrialId, model: body.model, trial, attemptNo, status: "api_error",
        httpStatus: response.status, retryable, errorMessage: message,
        rawResponse: payloadText, latencyMs: Date.now() - started,
      });
      return Response.json({ ok: false, retryable, message, retryAfter, httpStatus: response.status }, { status: response.status });
    }

    const rawResponse = payload.choices?.[0]?.message?.content || "";
    if (!rawResponse) {
      const refusal = payload.choices?.[0]?.message?.refusal;
      const finishReason = payload.choices?.[0]?.finish_reason;
      const retryable = !refusal;
      const message = refusal
        ? `模型拒绝回答：${refusal}`
        : `模型响应中没有可读取的回答内容${finishReason ? `（finish_reason=${finishReason}）` : ""}。`;
      await saveAttempt({
        logicalTrialId, model: body.model, trial, attemptNo, status: "empty_response",
        httpStatus: response.status, retryable, errorMessage: message,
        rawResponse: payloadText, latencyMs: Date.now() - started,
      });
      return Response.json({ ok: false, retryable, message, httpStatus: response.status }, { status: 422 });
    }

    let clean: ReturnType<typeof parseColorResponse> | ReturnType<typeof parseAssociationResponse>;
    try {
      clean = trial.task === "word"
        ? parseColorResponse(rawResponse, trial.stimulusId)
        : parseAssociationResponse(rawResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型回答格式校验失败。";
      await saveAttempt({
        logicalTrialId, model: body.model, trial, attemptNo, status: "validation_error",
        httpStatus: response.status, retryable: true, errorMessage: message,
        rawResponse, latencyMs: Date.now() - started,
      });
      return Response.json({ ok: false, retryable: true, message, rawExcerpt: rawResponse.slice(0, 500) }, { status: 422 });
    }
    const result = {
      trial_id: logicalTrialId,
      project_id: PROJECT_ID,
      model_id: body.model.id,
      model_alias: body.model.alias,
      task_type: trial.task === "word" ? "Word to Color" : "Color to Emotion",
      run_index: trial.runIndex,
      stimulus_id: trial.stimulusId,
      clean_json: JSON.stringify(clean),
      raw_response: rawResponse,
      validation_status: "Valid",
      retry_count: Number(body.retryCount || 0),
      latency_ms: Date.now() - started,
      created_at: new Date().toISOString(),
    };

    await env.DB.batch([
      env.DB.prepare(`INSERT OR REPLACE INTO trial_results (
        trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id,
        clean_json, raw_response, validation_status, retry_count, latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(result.trial_id, result.project_id, result.model_id, result.model_alias, result.task_type,
          result.run_index, result.stimulus_id, result.clean_json, result.raw_response,
          result.validation_status, result.retry_count, result.latency_ms, result.created_at),
      env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (
        attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type,
        run_index, stimulus_id, attempt_no, status, http_status, retryable,
        error_message, raw_response, latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          `${logicalTrialId}-attempt-${attemptNo}`, logicalTrialId, PROJECT_ID, body.model.id,
          body.model.alias, result.task_type, trial.runIndex, trial.stimulusId, attemptNo,
          "success", response.status, 0, "", rawResponse.slice(0, 12000),
          result.latency_ms, result.created_at,
        ),
      env.DB.prepare("UPDATE trial_manifest SET completed_at = ? WHERE logical_trial_id = ?")
        .bind(result.created_at, logicalTrialId),
    ]);

    return Response.json({ ok: true, result, latencyMs: result.latency_ms });
  } catch (error) {
    return Response.json({ ok: false, retryable: true, message: error instanceof Error ? error.message : "试次执行失败。" }, { status: 422 });
  }
}
