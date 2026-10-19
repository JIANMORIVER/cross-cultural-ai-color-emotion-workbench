import { EXPERIMENT_COLORS, EXPERIMENT_EMOTIONS } from "./prompts";

export type RequestModel = {
  model_id: string;
  base_url: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  supports_json: number | boolean;
};

export type ExperimentTask = "word" | "color" | "word-batch" | "color-batch";

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

export function isDoubaoModel(modelId: string, baseUrl = "") {
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

export function usesGeminiNativeApi(modelId: string) {
  return isGemini3(modelId);
}

export function geminiNativeEndpoint(baseUrl: string, modelId: string) {
  const url = new URL(String(baseUrl || "").trim());
  if (url.protocol !== "https:") throw new Error("只允许使用 HTTPS 模型接口。");
  if (url.hostname.toLowerCase() !== "generativelanguage.googleapis.com") {
    throw new Error("Gemini 原生接口地址必须使用 generativelanguage.googleapis.com。");
  }
  const version = url.pathname.match(/\/(v\d+(?:beta)?)/i)?.[1] || "v1beta";
  return `${url.origin}/${version}/models/${encodeURIComponent(modelId.trim())}:generateContent`;
}

function nativeHexSchema() {
  return {
    type: "object",
    properties: { hex: { type: "string", description: "A 6-digit sRGB HEX color beginning with #" } },
    required: ["hex"],
    additionalProperties: false,
  };
}

function nativeAssociationSchema() {
  return {
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
  };
}

function nativeResponseSchema(task: ExperimentTask, stimulusIds?: readonly string[]) {
  if (task === "word") return nativeHexSchema();
  if (task === "color") return nativeAssociationSchema();
  const ids = stimulusIds?.length
    ? [...stimulusIds]
    : task === "word-batch"
      ? [...EXPERIMENT_EMOTIONS]
      : EXPERIMENT_COLORS.map(([colorId]) => colorId);
  return {
    type: "object",
    properties: Object.fromEntries(ids.map(id => [id, task === "word-batch" ? nativeHexSchema() : nativeAssociationSchema()])),
    required: ids,
    additionalProperties: false,
  };
}

export function buildGeminiNativeRequest(
  model: RequestModel,
  prompt: string,
  task: ExperimentTask,
  nativeSeed: number | null = null,
  stimulusIds?: readonly string[],
) {
  // Gemini 3.1 Pro Preview currently rejects some nested JSON Schema constructs
  // for generateContent with HTTP 400.  The prompt plus local parsers remain
  // strict; responseMimeType guarantees JSON without making the API request
  // itself fragile.  Native Batch keeps its separate server-side schema path.
  void task;
  void stimulusIds;
  const configuredTokenLimit = Math.max(64, Math.min(32768, finiteParameter(model.max_tokens, 2048)));
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: Math.max(2048, configuredTokenLimit),
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "low" },
  };
  if (supportsSamplingControls(model.model_id)) {
    generationConfig.temperature = Math.max(0, Math.min(2, finiteParameter(model.temperature, 1)));
    generationConfig.topP = Math.max(0, Math.min(1, finiteParameter(model.top_p, 1)));
  }
  if (nativeSeed !== null) generationConfig.seed = nativeSeed;
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
  };
}

export function buildModelRequest(
  model: RequestModel,
  prompt: string,
  task: ExperimentTask,
  nativeSeed: number | null = null,
  stimulusIds?: readonly string[],
) {
  return usesGeminiNativeApi(model.model_id)
    ? buildGeminiNativeRequest(model, prompt, task, nativeSeed, stimulusIds)
    : buildChatRequest(model, prompt, task, nativeSeed, stimulusIds);
}

export function modelEndpoint(model: RequestModel) {
  return usesGeminiNativeApi(model.model_id)
    ? geminiNativeEndpoint(model.base_url, model.model_id)
    : safeEndpoint(model.base_url);
}

export function modelHeaders(model: RequestModel, apiKey: string) {
  return usesGeminiNativeApi(model.model_id)
    ? { "Content-Type": "application/json", "x-goog-api-key": apiKey }
    : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

type ModelResponsePayload = {
  error?: { message?: string; code?: string | number; status?: string; param?: string };
  choices?: Array<{ finish_reason?: string; message?: { content?: unknown; refusal?: string | null } }>;
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
};

export function modelResponseText(modelId: string, payload: ModelResponsePayload) {
  if (!usesGeminiNativeApi(modelId)) {
    // Ark-compatible endpoints usually return a string, but some deployments
    // return OpenAI content parts.  Normalize both representations before JSON
    // parsing so a valid JSON text part is never mistaken for "[object Object]".
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(part => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const value = part as { text?: unknown; content?: unknown };
        return typeof value.text === "string" ? value.text : typeof value.content === "string" ? value.content : "";
      }
      return "";
    }).join("").trim();
    if (content && typeof content === "object") {
      const value = content as { text?: unknown; content?: unknown };
      return typeof value.text === "string" ? value.text : typeof value.content === "string" ? value.content : "";
    }
    return "";
  }
  return (payload.candidates?.[0]?.content?.parts || [])
    .filter(part => !part.thought && typeof part.text === "string")
    .map(part => part.text)
    .join("")
    .trim();
}

export function modelResponseEmptyReason(modelId: string, payload: ModelResponsePayload) {
  if (!usesGeminiNativeApi(modelId)) {
    return payload.choices?.[0]?.message?.refusal
      ? `模型拒绝回答：${payload.choices[0].message?.refusal}`
      : `模型响应中没有可读取的回答内容${payload.choices?.[0]?.finish_reason ? `（finish_reason=${payload.choices[0].finish_reason}）` : ""}。`;
  }
  const reason = payload.promptFeedback?.blockReasonMessage
    || payload.promptFeedback?.blockReason
    || payload.candidates?.[0]?.finishReason;
  return `Gemini 原生响应中没有可读取的回答内容${reason ? `（reason=${reason}）` : ""}。`;
}

function finiteParameter(value: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function associationSchema() {
  return {
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
  };
}

function hexSchema() {
  return {
    type: "object",
    properties: { hex: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" } },
    required: ["hex"],
    additionalProperties: false,
  };
}

function ratingVectorSchema() {
  return {
    type: "object",
    properties: Object.fromEntries(EXPERIMENT_EMOTIONS.map(emotion => [emotion, {
      type: "integer", minimum: 0, maximum: 5,
    }])),
    required: [...EXPERIMENT_EMOTIONS],
    additionalProperties: false,
  };
}

function responseFormat(
  task: ExperimentTask,
  strictSchema: boolean,
  geminiSchema = false,
  stimulusIds?: readonly string[],
) {
  if (task === "word-batch" && strictSchema) {
    const emotions = stimulusIds?.length ? [...stimulusIds] : [...EXPERIMENT_EMOTIONS];
    return {
      type: "json_schema",
      json_schema: {
        name: "task1_gew20_hex_colours",
        strict: true,
        schema: {
          type: "object",
          properties: Object.fromEntries(emotions.map(emotion => [emotion, hexSchema()])),
          required: emotions,
          additionalProperties: false,
        },
      },
    };
  }
  // For Doubao Task 2, use a short fixed 11 × 20 rating matrix rather than
  // nested association objects.  It is easier for the model to serialize and
  // makes both colour IDs and all GEW-20 emotion keys closed at the API level.
  if (task === "color-batch" && strictSchema) {
    const colorIds = stimulusIds?.length ? [...stimulusIds] : EXPERIMENT_COLORS.map(([id]) => id);
    return {
      type: "json_schema",
      json_schema: {
        name: "task2_gew20_rating_matrix",
        strict: true,
        schema: {
          type: "object",
          properties: Object.fromEntries(colorIds.map(colorId => [colorId, ratingVectorSchema()])),
          required: colorIds,
          additionalProperties: false,
        },
      },
    };
  }
  if (task === "word-batch" || task === "color-batch") return { type: "json_object" };
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
          ...associationSchema().properties,
        },
        required: ["associations"],
        additionalProperties: false,
      },
    },
  };
}

export function buildChatRequest(
  model: RequestModel,
  prompt: string,
  task: ExperimentTask,
  nativeSeed: number | null = null,
  stimulusIds?: readonly string[],
) {
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
  const strictBatchSchema = isDoubaoModel(model.model_id, model.base_url);
  if (enabled(model.supports_json)) body.response_format = responseFormat(
    task,
    gpt56 || gemini3 || strictBatchSchema,
    gemini3,
    stimulusIds,
  );
  if (nativeSeed !== null) body.seed = nativeSeed;
  return body;
}
