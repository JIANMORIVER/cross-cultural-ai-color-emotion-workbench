import { env } from "cloudflare:workers";
import { applyRandomnessPolicy } from "../../experiment/randomness";
import { buildColorToEmotionBatchPrompt, buildWordToColorBatchPrompt, type OrderPolicy } from "../../experiment/prompts";
import {
  buildModelRequest,
  friendlyModelApiError,
  modelEndpoint,
  modelHeaders,
  modelResponseEmptyReason,
  modelResponseText,
  isDoubaoModel,
  usesGeminiNativeApi,
} from "../../experiment/model-request";
import { parseAssociationBatchResponse, parseColorBatchResponse, parseRatingVectorBatchResponse } from "../../experiment/response-parser";

const PROJECT_ID = "ECX-2026-001";

type Model = { id: string; alias: string; model_id: string; base_url: string; max_tokens: number; temperature: number; top_p: number; supports_seed: number | boolean; supports_json: number | boolean };
type Trial = { task: "word" | "color"; runIndex: number; stimulusId: string; stimulusHex?: string; stimulusIndex: number };

function logicalId(model: Model, trial: Trial) {
  return `batch-${model.id}-${trial.task}-${trial.runIndex}-${trial.stimulusId}`;
}

async function saveAttempt(model: Model, trials: Trial[], attemptNo: number, status: string, retryable: boolean, latencyMs: number, errorMessage = "", rawResponse = "", httpStatus?: number) {
  const now = new Date().toISOString();
  await env.DB.batch(trials.map(trial => env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (
    attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id,
    attempt_no, status, http_status, retryable, error_message, raw_response, latency_ms, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`${logicalId(model, trial)}-attempt-${attemptNo}`, logicalId(model, trial), PROJECT_ID, model.id, model.alias,
      trial.task === "word" ? "Word to Color" : "Color to Emotion", trial.runIndex, trial.stimulusId,
      attemptNo, status, httpStatus ?? null, retryable ? 1 : 0, errorMessage, rawResponse.slice(0, 12000), latencyMs, now)));
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as { apiKey: string; model: Model; settings: OrderPolicy & { timeout_seconds?: number }; trials: Trial[]; retryCount?: number };
    const { model, trials } = body;
    if (!body.apiKey?.trim() || !model?.model_id || !model.base_url || !trials?.length || trials.length > 20) {
      return Response.json({ ok: false, retryable: false, message: "整组请求缺少 API Key、模型或试题。" }, { status: 400 });
    }
    const task = trials[0].task;
    if (!trials.every(trial => trial.task === task && trial.runIndex === trials[0].runIndex)) {
      return Response.json({ ok: false, retryable: false, message: "一组请求只能包含同一任务、同一轮次的题目。" }, { status: 400 });
    }
    const expected = task === "word" ? 20 : 11;
    if (trials.length !== expected) return Response.json({ ok: false, retryable: false, message: `${task === "word" ? "实验一" : "实验二"}必须一次提交完整的 ${expected} 个题目。` }, { status: 400 });

    const doubaoRatingVector = task === "color" && isDoubaoModel(model.model_id, model.base_url);
    const basePrompt = task === "word"
      ? buildWordToColorBatchPrompt(trials.map(trial => trial.stimulusId))
      : buildColorToEmotionBatchPrompt(
        trials.map(trial => ({ stimulusId: trial.stimulusId, stimulusHex: trial.stimulusHex || "", stimulusIndex: trial.stimulusIndex })),
        body.settings,
        trials[0].runIndex,
        doubaoRatingVector ? "rating-vector" : "association-list",
      ).prompt;
    const policy = applyRandomnessPolicy(basePrompt, body.settings, trials[0].runIndex, task === "word" ? 101 : 202, model.supports_seed);
    const requestTask = task === "word" ? "word-batch" : "color-batch";
    const requestBody = buildModelRequest(model, policy.prompt, requestTask, policy.nativeSeed, trials.map(trial => trial.stimulusId));
    const attemptNo = Number(body.retryCount || 0);

    let response: Response;
    try {
      response = await fetch(modelEndpoint(model), {
        method: "POST", headers: modelHeaders(model, body.apiKey.trim()),
        body: JSON.stringify(requestBody), signal: AbortSignal.timeout(Math.max(180, Number(body.settings.timeout_seconds) || 180) * 1000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型网络请求失败。";
      await saveAttempt(model, trials, attemptNo, "request_error", true, Date.now() - started, message);
      return Response.json({ ok: false, retryable: true, message }, { status: 503 });
    }
    const payloadText = await response.text();
    const payload = (() => { try { return JSON.parse(payloadText); } catch { return {}; } })() as {
      error?: { message?: string; code?: string; status?: string; param?: string };
      choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string | null } }>;
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
    };
    if (!response.ok) {
      const detail = [payload.error?.message || `模型接口返回 HTTP ${response.status}`, payload.error?.code ? `code=${payload.error.code}` : "", payload.error?.param ? `param=${payload.error.param}` : ""].filter(Boolean).join(" · ");
      const message = friendlyModelApiError(model.model_id, response.status, detail);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      await saveAttempt(model, trials, attemptNo, "api_error", retryable, Date.now() - started, message, payloadText, response.status);
      return Response.json({ ok: false, retryable, message, retryAfter: response.headers.get("retry-after"), httpStatus: response.status }, { status: response.status });
    }
    const rawResponse = modelResponseText(model.model_id, payload);
    if (!rawResponse) {
      const message = modelResponseEmptyReason(model.model_id, payload);
      const blocked = usesGeminiNativeApi(model.model_id) && Boolean(payload.promptFeedback?.blockReason);
      await saveAttempt(model, trials, attemptNo, "empty_response", !blocked, Date.now() - started, message, payloadText, response.status);
      return Response.json({ ok: false, retryable: !blocked, message }, { status: 422 });
    }

    let clean: Array<{ stimulusId: string; value: unknown }>;
    try {
      clean = task === "word"
        ? parseColorBatchResponse(rawResponse, trials.map(trial => trial.stimulusId)).map(answer => ({ stimulusId: answer.emotion, value: answer.color }))
        : (doubaoRatingVector
          ? parseRatingVectorBatchResponse(rawResponse, trials.map(trial => trial.stimulusId))
          : parseAssociationBatchResponse(rawResponse, trials.map(trial => trial.stimulusId)))
          .map(answer => ({ stimulusId: answer.colorId, value: answer.association }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "整组回答格式校验失败。";
      await saveAttempt(model, trials, attemptNo, "validation_error", true, Date.now() - started, message, rawResponse, response.status);
      return Response.json({ ok: false, retryable: true, message, rawExcerpt: rawResponse.slice(0, 700) }, { status: 422 });
    }

    const createdAt = new Date().toISOString();
    const latencyMs = Date.now() - started;
    const byStimulus = new Map(clean.map(item => [item.stimulusId, item.value]));
    const results = trials.map(trial => ({
      trial_id: logicalId(model, trial), project_id: PROJECT_ID, model_id: model.id, model_alias: model.alias,
      task_type: task === "word" ? "Word to Color" : "Color to Emotion", run_index: trial.runIndex, stimulus_id: trial.stimulusId,
      clean_json: JSON.stringify(byStimulus.get(trial.stimulusId)), raw_response: rawResponse, validation_status: "Valid",
      retry_count: attemptNo, latency_ms: latencyMs, created_at: createdAt,
      protocol_version: usesGeminiNativeApi(model.model_id) ? "gemini-native-generate-content-v1" : "realtime-grouped-v1",
    }));
    const statements = results.flatMap(result => [
      env.DB.prepare(`INSERT OR REPLACE INTO trial_results (trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id, clean_json, raw_response, validation_status, retry_count, latency_ms, created_at, collection_mode, source_job_id, protocol_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'realtime', '', ?)`)
        .bind(result.trial_id, result.project_id, result.model_id, result.model_alias, result.task_type, result.run_index, result.stimulus_id, result.clean_json, result.raw_response, result.validation_status, result.retry_count, result.latency_ms, result.created_at, result.protocol_version),
      env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id, attempt_no, status, http_status, retryable, error_message, raw_response, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(`${result.trial_id}-attempt-${attemptNo}`, result.trial_id, PROJECT_ID, model.id, model.alias, result.task_type, result.run_index, result.stimulus_id, attemptNo, "success", response.status, 0, "", rawResponse.slice(0, 12000), latencyMs, createdAt),
      env.DB.prepare("UPDATE trial_manifest SET completed_at = ? WHERE logical_trial_id = ?").bind(createdAt, result.trial_id),
    ]);
    await env.DB.batch(statements);
    return Response.json({ ok: true, results, latencyMs, requestCount: 1, responseMode: "complete-round" });
  } catch (error) {
    return Response.json({ ok: false, retryable: true, message: error instanceof Error ? error.message : "整组试次执行失败。" }, { status: 422 });
  }
}
