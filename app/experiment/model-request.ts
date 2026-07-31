import { EXPERIMENT_EMOTIONS } from "./prompts";

export type RequestModel = {
  model_id: string;
  base_url: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  supports_json: number | boolean;
};

export type ExperimentTask = "word" | "color";

function enabled(value: number | boolean) {
  return value === true || value === 1;
}

export function isGpt56(modelId: string) {
  return /^gpt-5\.6(?:-|$)/i.test(modelId);
}

export function isGemini36Flash(modelId: string) {
  return /^gemini-3\.6-flash(?:-|$)/i.test(modelId);
}

export function isGemini31Pro(modelId: string) {
  return /^gemini-3\.1-pro-preview(?:-|$)/i.test(modelId);
}

export function isGemini3(modelId: string) {
  return /^gemini-3(?:\.|-)/i.test(modelId);
}

export function isDoubao21Pro(modelId: string) {
  return /^doubao-seed-2-1-pro(?:-|$)/i.test(modelId);
}

export function hasDeprecatedGeminiSampling(modelId: string) {
  return /^gemini-(?:3\.6-flash|3\.5-flash-lite)(?:-|$)/i.test(modelId);
}

export function supportsSamplingControls(modelId: string) {
  return !hasDeprecatedGeminiSampling(modelId);
}

function isDeepSeekModel(modelId: string, baseUrl = "") {
  return /^deepseek-/i.test(modelId) || /(?:^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname);
}

function isDoubaoModel(modelId: string, baseUrl = "") {
  return /^doubao-/i.test(modelId) || /(?:^|\.)volces\.com$/i.test(new URL(baseUrl).hostname);
}

export function reasoningModeForModel(modelId: string, baseUrl = "") {
  if (isGpt56(modelId)) return "none";
  if (isGemini3(modelId)) return "low";
  try {
    if (isDeepSeekModel(modelId, baseUrl) || isDoubaoModel(modelId, baseUrl)) return "disabled";
  } catch {
    if (/^deepseek-|^doubao-/i.test(modelId)) return "disabled";
  }
  return "provider-default";
}

export function friendlyModelApiError(modelId: string, status: number, detail: string) {
  const message = String(detail || `HTTP ${status}`);
  if (isDoubao21Pro(modelId) && (
    status === 404
    || /model.?not.?found|invalid.?model|not.?exist|未开通|不存在/i.test(message)
  )) {
    return `Doubao-Seed-2.1-Pro 当前不可用。请先在火山方舟开通该模型，并核对“API 接入”页面给出的 Model ID；在线推理推荐使用 doubao-seed-2-1-pro-260628，使用推理接入点时请改填对应的 ep-… ID。原始错误：${message}`;
  }
  if (isGemini31Pro(modelId) && status === 503) {
    return `Gemini 3.1 Pro Preview 暂时过载或服务不可用（HTTP 503）。这通常不是 API Key 或模型配置错误，请稍后重试。原始错误：${message}`;
  }
  if (isGemini31Pro(modelId) && (
    status === 429
    || status === 403
    || /quota|resource_exhausted|billing|free tier|limit:\s*0/i.test(message)
  )) {
    return `Gemini 3.1 Pro Preview 不提供免费 API 层。请在该 API Key 所属的 Google AI Studio 项目中启用付费结算；如需免费测试，请改用 Gemini 3.6 Flash。原始错误：${message}`;
  }
  if (isGemini31Pro(modelId) && status === 404) {
    return `当前 API Key 所属项目无法访问 gemini-3.1-pro-preview。请确认已启用付费结算且使用 Google AI Studio 生成的 Gemini API Key。原始错误：${message}`;
  }
  return message;
}

export function safeEndpoint(baseUrl: string) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (url.protocol !== "https:") throw new Error("只允许使用 HTTPS 模型接口。");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
    throw new Error("不允许访问本地或私有网络模型地址。");
  }
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function finiteParameter(value: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function responseFormat(task: ExperimentTask, strictSchema: boolean, geminiSchema = false) {
  if (!strictSchema) return { type: "json_object" };
  if (task === "word") {
    return {
      type: "json_schema",
      json_schema: {
        name: "emotion_color",
        strict: true,
        schema: {
          type: "object",
          properties: {
            hex: geminiSchema
              ? { type: "string", description: "A 6-digit sRGB HEX color beginning with #" }
              : { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          },
          required: ["hex"],
          additionalProperties: false,
        },
      },
    };
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "color_emotions",
      strict: true,
      schema: {
        type: "object",
        properties: {
          associations: {
            type: "array",
            minItems: 1,
            maxItems: EXPERIMENT_EMOTIONS.length,
            items: {
              type: "object",
              properties: {
                emotion: { type: "string", enum: [...EXPERIMENT_EMOTIONS] },
                intensity: { type: "integer", minimum: 1, maximum: 5 },
              },
              required: ["emotion", "intensity"],
              additionalProperties: false,
            },
          },
        },
        required: ["associations"],
        additionalProperties: false,
      },
    },
  };
}

export function buildChatRequest(model: RequestModel, prompt: string, task: ExperimentTask, nativeSeed: number | null = null) {
  const configuredTokenLimit = Math.max(64, Math.min(32768, finiteParameter(model.max_tokens, 500)));
  const tokenLimit = isGemini31Pro(model.model_id) ? Math.max(2048, configuredTokenLimit) : configuredTokenLimit;
  const temperature = Math.max(0, Math.min(2, finiteParameter(model.temperature, 1)));
  const topP = Math.max(0, Math.min(1, finiteParameter(model.top_p, 1)));
  const gpt56 = isGpt56(model.model_id);
  const gemini3 = isGemini3(model.model_id);
  const samplingControls = supportsSamplingControls(model.model_id);
  const body: Record<string, unknown> = {
    model: model.model_id.trim(),
    messages: [{ role: "user", content: prompt }],
  };
  // Gemini 3.6 Flash and newer-generation Flash models deprecate these fields.
  // Gemini 3.1 Pro still supports them and is kept at the recommended 1.0 / 1.0.
  if (samplingControls) {
    body.temperature = temperature;
    body.top_p = topP;
  }
  if (gpt56) {
    body.max_completion_tokens = tokenLimit;
    body.reasoning_effort = "none";
  } else {
    body.max_tokens = tokenLimit;
  }
  // Gemini 3.1 Pro defaults to high thinking. Low is sufficient for the
  // experiment's short, schema-constrained classifications and reduces latency.
  if (gemini3) body.reasoning_effort = "low";
  if (reasoningModeForModel(model.model_id, model.base_url) === "disabled") {
    body.thinking = { type: "disabled" };
  }
  if (enabled(model.supports_json)) body.response_format = responseFormat(task, gpt56 || gemini3, gemini3);
  if (nativeSeed !== null) body.seed = nativeSeed;
  return body;
}
