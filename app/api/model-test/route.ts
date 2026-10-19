import {
  buildModelRequest,
  friendlyModelApiError,
  modelEndpoint,
  modelHeaders,
  modelResponseEmptyReason,
  modelResponseText,
  isDoubaoModel,
  type RequestModel,
} from "../../experiment/model-request";
import {
  GEMINI_STABLE_POLICY,
  retryAfterMilliseconds,
  usesGeminiStablePolicy,
} from "../../experiment/execution-policy";
import { EXPERIMENT_COLORS, EXPERIMENT_EMOTIONS, buildColorToEmotionBatchPrompt, buildWordToColorBatchPrompt, type OrderPolicy } from "../../experiment/prompts";
import { parseAssociationBatchResponse, parseColorBatchResponse, parseRatingVectorBatchResponse } from "../../experiment/response-parser";

type TestBody = {
  apiKey: string;
  model?: RequestModel;
  settings?: OrderPolicy;
  baseUrl?: string;
  modelId?: string;
};

const fallbackSettings: OrderPolicy = {
  prompt_seed_enabled: false,
  prompt_seed_base: 20260715,
  native_seed_enabled: false,
  prompt_variants_enabled: false,
  shuffle_emotion_order: false,
  shuffle_color_order: false,
  shuffle_emotion_options: false,
};

const MAX_PROBE_ATTEMPTS = 4;

function transientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const serverDelay = retryAfterMilliseconds(retryAfter);
  if (serverDelay) return serverDelay;
  const exponential = Math.min(8000, 1000 * 2 ** attempt);
  return exponential + Math.floor(Math.random() * 350);
}

async function runProbe(apiKey: string, model: RequestModel, prompt: string, task: "word-batch" | "color-batch") {
  for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      const stimulusIds = task === "word-batch"
        ? EXPERIMENT_EMOTIONS
        : EXPERIMENT_COLORS.map(([colorId]) => colorId);
      response = await fetch(modelEndpoint(model), {
        method: "POST",
        headers: modelHeaders(model, apiKey.trim()),
        body: JSON.stringify(buildModelRequest(model, prompt, task, null, stimulusIds)),
        // Preflight validates the same complete-round JSON shape as formal
        // collection, so it receives the same 180-second response window.
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      if (usesGeminiStablePolicy(model) && attempt < MAX_PROBE_ATTEMPTS - 1) {
        const delay = GEMINI_STABLE_POLICY.retryDelaysMs[Math.min(attempt, GEMINI_STABLE_POLICY.retryDelaysMs.length - 1)]
          + Math.floor(Math.random() * 1_500);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
    const payloadText = await response.text();
    const payload = (() => {
      try { return JSON.parse(payloadText); } catch { return {}; }
    })() as {
      error?: { message?: string; code?: string; param?: string };
      choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string | null } }>;
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
      promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
    };
    if (!response.ok) {
      const detail = [
        payload.error?.message || `HTTP ${response.status}`,
        payload.error?.code ? `code=${payload.error.code}` : "",
        payload.error?.param ? `param=${payload.error.param}` : "",
      ].filter(Boolean).join(" · ");
      if (transientStatus(response.status) && attempt < MAX_PROBE_ATTEMPTS - 1) {
        const delay = usesGeminiStablePolicy(model)
          ? GEMINI_STABLE_POLICY.retryDelaysMs[Math.min(attempt, GEMINI_STABLE_POLICY.retryDelaysMs.length - 1)] + Math.floor(Math.random() * 1_500)
          : retryDelayMs(response, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const friendly = friendlyModelApiError(model.model_id, response.status, detail);
      const retrySummary = transientStatus(response.status) && attempt > 0
        ? `（已自动指数退避重试 ${attempt} 次，仍未恢复。）`
        : "";
      throw new Error(`${friendly}${retrySummary}`);
    }
    const content = modelResponseText(model.model_id, payload);
    if (!content) {
      throw new Error(modelResponseEmptyReason(model.model_id, payload));
    }
    try {
      if (task === "word-batch") parseColorBatchResponse(content, EXPERIMENT_EMOTIONS);
      else if (isDoubaoModel(model.model_id, model.base_url)) parseRatingVectorBatchResponse(content, EXPERIMENT_COLORS.map(([id]) => id));
      else parseAssociationBatchResponse(content, EXPERIMENT_COLORS.map(([id]) => id));
    } catch (error) {
      const label = task === "word-batch" ? "实验一（20 个词选色）" : "实验二（11 个色选词）";
      const message = error instanceof Error ? error.message : "JSON 格式校验失败。";
      throw new Error(`${label} 格式校验失败：${message} 原始回答片段：${content.slice(0, 700)}`);
    }
    return attempt;
  }
  throw new Error("运行前验证超过最大重试次数。");
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as TestBody;
    const apiKey = String(body.apiKey || "").trim();
    const model: RequestModel = body.model || {
      model_id: String(body.modelId || ""),
      base_url: String(body.baseUrl || ""),
      max_tokens: 2048,
      temperature: 1,
      top_p: 1,
      supports_json: true,
    };
    if (!apiKey || !model.model_id || !model.base_url) {
      return Response.json({ ok: false, message: "请完整填写 API Key、Base URL 和模型型号。" }, { status: 400 });
    }
    if (model.base_url.includes("api.openai.com") && !apiKey.startsWith("sk-")) {
      return Response.json({ ok: false, message: "OpenAI API Key 应以 sk- 开头；当前密钥前缀不正确。" }, { status: 400 });
    }

    const settings = body.settings || fallbackSettings;
    const colorPrompt = buildColorToEmotionBatchPrompt(
      EXPERIMENT_COLORS.map(([stimulusId, stimulusHex], stimulusIndex) => ({ stimulusId, stimulusHex, stimulusIndex })),
      settings,
      1,
      isDoubaoModel(model.model_id, model.base_url) ? "rating-vector" : "association-list",
    ).prompt;
    const wordRetries = await runProbe(apiKey, model, buildWordToColorBatchPrompt(EXPERIMENT_EMOTIONS), "word-batch");
    const colorRetries = await runProbe(apiKey, model, colorPrompt, "color-batch");
    const transientRetries = wordRetries + colorRetries;

    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      message: transientRetries
        ? `连接和两项格式均验证通过；期间遇到临时服务错误并自动恢复 ${transientRetries} 次。`
        : "连接、20 题整组词选色格式和 11 题整组色选词格式均验证通过。",
    });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : "连接或格式验证失败。",
      latencyMs: Date.now() - started,
    }, { status: 400 });
  }
}
