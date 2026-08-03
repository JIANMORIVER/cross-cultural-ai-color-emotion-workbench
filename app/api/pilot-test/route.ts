import { env } from "cloudflare:workers";
import { applyRandomnessPolicy } from "../../experiment/randomness";
import { buildColorToEmotionPrompt, buildWordToColorPrompt, type OrderPolicy } from "../../experiment/prompts";
import { buildChatRequest, friendlyModelApiError, safeEndpoint } from "../../experiment/model-request";
import {
  GEMINI_STABLE_POLICY,
  retryDelayMilliseconds,
  usesGeminiStablePolicy,
} from "../../experiment/execution-policy";
import { parseAssociationResponse, parseColorResponse } from "../../experiment/response-parser";

const PROJECT_ID = "ECX-2026-001";

type PilotModel = {
  id: string;
  provider: string;
  alias: string;
  model_id: string;
  base_url: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  supports_seed: number | boolean;
  supports_json: number | boolean;
};

type PilotPayload = {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: string } }>;
};

function transientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function requestPilot(apiKey: string, model: PilotModel, requestBody: Record<string, unknown>) {
  const attemptLimit = usesGeminiStablePolicy(model) ? GEMINI_STABLE_POLICY.totalAttempts : 1;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(safeEndpoint(model.base_url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(usesGeminiStablePolicy(model) ? GEMINI_STABLE_POLICY.timeoutSeconds * 1000 : 60_000),
      });
    } catch (error) {
      if (attempt < attemptLimit - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMilliseconds(model, attempt)));
        continue;
      }
      throw error;
    }
    const payload = await response.json().catch(() => ({})) as PilotPayload;
    if (response.ok) return { payload, retryCount: attempt };
    if (transientStatus(response.status) && attempt < attemptLimit - 1) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMilliseconds(model, attempt, response.headers.get("retry-after"))));
      continue;
    }
    const detail = payload.error?.message || `模型接口返回 HTTP ${response.status}`;
    throw new Error(friendlyModelApiError(model.model_id, response.status, detail));
  }
  throw new Error("单模型试跑超过最大尝试次数。");
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as { apiKey: string; model: PilotModel; settings: OrderPolicy; task?: "word" | "color" };
    if (!body.apiKey || !body.model?.model_id || !body.model?.base_url) {
      return Response.json({ ok: false, message: "请完整填写 API Key、模型型号和接口地址。" }, { status: 400 });
    }

    const task = body.task === "color" ? "color" : "word";
    body.apiKey = body.apiKey.trim();
    const colorPrompt = buildColorToEmotionPrompt("J0", "#262626", body.settings, 1, 0);
    const basePrompt = task === "color" ? colorPrompt.prompt : buildWordToColorPrompt("Interest");
    const policy = applyRandomnessPolicy(basePrompt, body.settings, 1, 0, body.model.supports_seed);
    const requestBody = buildChatRequest(body.model, policy.prompt, task, policy.nativeSeed);

    const { payload, retryCount } = await requestPilot(body.apiKey, body.model, requestBody);

    const rawResponse = payload.choices?.[0]?.message?.content || "";
    if (!rawResponse) return Response.json({ ok: false, message: "模型响应中没有可读取的回答内容。" }, { status: 400 });
    const colorResult = task === "word" ? parseColorResponse(rawResponse, "Interest") : null;
    const associationResult = task === "color" ? parseAssociationResponse(rawResponse) : null;
    const latencyMs = Date.now() - started;
    const createdAt = new Date().toISOString();
    const result = {
      trial_id: `pilot-${body.model.id}-${Date.now()}`,
      project_id: PROJECT_ID,
      model_id: body.model.id,
      model_alias: body.model.alias,
      task_type: task === "word" ? "Word to Color" : "Color to Emotion",
      run_index: 0,
      stimulus_id: task === "word" ? "Interest" : "J0",
      clean_json: JSON.stringify(task === "word" ? colorResult : associationResult),
      raw_response: rawResponse,
      validation_status: "Valid",
      retry_count: retryCount,
      latency_ms: latencyMs,
      created_at: createdAt,
    };

    await env.DB.prepare(`INSERT INTO trial_results (
      trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id,
      clean_json, raw_response, validation_status, retry_count, latency_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(result.trial_id, result.project_id, result.model_id, result.model_alias, result.task_type,
        result.run_index, result.stimulus_id, result.clean_json, result.raw_response,
        result.validation_status, result.retry_count, result.latency_ms, result.created_at).run();

    return Response.json({
      ok: true,
      color: colorResult?.hex,
      associationCount: associationResult?.associations.length,
      summary: task === "word" ? `Interest → ${colorResult?.hex}` : `J0 → ${associationResult?.associations.length} 个情绪（1–5 级）`,
      latencyMs,
      result,
      executionPolicy: usesGeminiStablePolicy(body.model) ? GEMINI_STABLE_POLICY.id : "standard",
      policy: { promptSeed: policy.promptSeed, nativeSeed: policy.nativeSeed, promptVariant: policy.promptVariant, emotionOptionSeed: task === "color" ? colorPrompt.optionSeed : null },
    });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "单模型试跑失败。" }, { status: 400 });
  }
}
