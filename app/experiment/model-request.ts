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

function responseFormat(task: ExperimentTask, strictSchema: boolean) {
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
            hex: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
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
  const tokenLimit = Math.max(64, Math.min(32768, finiteParameter(model.max_tokens, 500)));
  const temperature = Math.max(0, Math.min(2, finiteParameter(model.temperature, 1)));
  const topP = Math.max(0, Math.min(1, finiteParameter(model.top_p, 1)));
  const gpt56 = isGpt56(model.model_id);
  const body: Record<string, unknown> = {
    model: model.model_id.trim(),
    messages: [{ role: "user", content: prompt }],
    temperature,
  };
  // top_p=1 is neutral. Avoid changing two sampling controls at once for GPT.
  if (!gpt56 || topP !== 1) body.top_p = topP;
  if (gpt56) {
    body.max_completion_tokens = tokenLimit;
    body.reasoning_effort = "none";
  } else {
    body.max_tokens = tokenLimit;
  }
  if (enabled(model.supports_json)) body.response_format = responseFormat(task, gpt56);
  if (nativeSeed !== null) body.seed = nativeSeed;
  return body;
}

