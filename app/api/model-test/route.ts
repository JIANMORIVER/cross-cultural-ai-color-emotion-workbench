import {
  buildChatRequest,
  friendlyModelApiError,
  safeEndpoint,
  type RequestModel,
} from "../../experiment/model-request";
import {
  GEMINI_STABLE_POLICY,
  retryAfterMilliseconds,
  usesGeminiStablePolicy,
} from "../../experiment/execution-policy";
import { buildColorToEmotionPrompt, buildWordToColorPrompt, type OrderPolicy } from "../../experiment/prompts";
import { parseAssociationResponse, parseColorResponse } from "../../experiment/response-parser";

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

async function runProbe(apiKey: string, model: RequestModel, prompt: string, task: "word" | "color") {
  for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(safeEndpoint(model.base_url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify(buildChatRequest(model, prompt, task)),
        signal: AbortSignal.timeout(90000),
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
    const content = payload.choices?.[0]?.message?.content || "";
    if (!content) {
      const refusal = payload.choices?.[0]?.message?.refusal;
      throw new Error(refusal ? `模型拒绝测试请求：${refusal}` : "测试响应没有可读取内容。");
    }
    if (task === "word") parseColorResponse(content, "Interest");
    else parseAssociationResponse(content);
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
    const colorPrompt = buildColorToEmotionPrompt("J0", "#262626", settings, 1, 0).prompt;
    const wordRetries = await runProbe(apiKey, model, buildWordToColorPrompt("Interest"), "word");
    const colorRetries = await runProbe(apiKey, model, colorPrompt, "color");
    const transientRetries = wordRetries + colorRetries;

    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      message: transientRetries
        ? `连接和两项格式均验证通过；期间遇到临时服务错误并自动恢复 ${transientRetries} 次。`
        : "连接、词选色格式和色选情绪格式均验证通过。",
    });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : "连接或格式验证失败。",
      latencyMs: Date.now() - started,
    }, { status: 400 });
  }
}
