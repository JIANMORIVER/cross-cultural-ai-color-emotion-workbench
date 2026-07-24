import { env } from "cloudflare:workers";
import { applyRandomnessPolicy } from "../../experiment/randomness";
import { buildColorToEmotionPrompt, buildWordToColorPrompt, EXPERIMENT_EMOTIONS, type OrderPolicy } from "../../experiment/prompts";

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

function enabled(value: number | boolean) {
  return value === true || value === 1;
}

function isGpt56(modelId: string) {
  return /^gpt-5\.6(?:-|$)/i.test(modelId);
}

function safeEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new Error("只允许使用 HTTPS 模型接口。");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
    throw new Error("不允许访问本地或私有网络模型地址。");
  }
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function extractJson(content: string) {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean) as Record<string, unknown>;
}

function parseColor(content: string, emotion: string) {
  const parsed = extractJson(content);
  const nested = parsed[emotion] && typeof parsed[emotion] === "object" ? parsed[emotion] as Record<string, unknown> : parsed;
  if (!/^#[0-9A-F]{6}$/i.test(String(nested.hex || ""))) throw new Error("模型没有返回有效的 HEX 色值。");
  return nested;
}

function parseAssociations(content: string) {
  const parsed = extractJson(content);
  const values = parsed.associations;
  if (!Array.isArray(values) || values.length < 1 || values.length > EXPERIMENT_EMOTIONS.length) {
    throw new Error("关联结果必须包含 1–20 个情绪。");
  }
  const canonical = new Map(EXPERIMENT_EMOTIONS.map(emotion => [emotion.toLowerCase(), emotion]));
  const used = new Set<string>();
  return { associations: values.map(value => {
    if (!value || typeof value !== "object") throw new Error("情绪关联项格式无效。");
    const item = value as Record<string, unknown>;
    const emotion = canonical.get(String(item.emotion || "").toLowerCase());
    const intensity = Number(item.intensity);
    if (!emotion) throw new Error(`出现词表之外的情绪：${String(item.emotion || "空值")}`);
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) throw new Error(`${emotion} 的强度必须是 1–5 的整数。`);
    if (used.has(emotion)) throw new Error(`情绪重复：${emotion}`);
    used.add(emotion);
    return { emotion, intensity };
  }) };
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

    const { trial } = body;
    const prompt = trial.task === "word"
      ? buildWordToColorPrompt(trial.stimulusId)
      : buildColorToEmotionPrompt(trial.stimulusId, trial.stimulusHex || "", body.settings, trial.runIndex, trial.stimulusIndex).prompt;
    const policy = applyRandomnessPolicy(prompt, body.settings, trial.runIndex, trial.stimulusIndex, body.model.supports_seed);
    const tokenLimit = Math.max(64, Math.min(32768, Number(body.model.max_tokens) || 500));
    const requestBody: Record<string, unknown> = {
      model: body.model.model_id,
      messages: [{ role: "user", content: policy.prompt }],
      temperature: Number(body.model.temperature),
      top_p: Number(body.model.top_p),
    };
    if (isGpt56(body.model.model_id)) {
      requestBody.max_completion_tokens = tokenLimit;
      requestBody.reasoning_effort = "none";
    } else {
      requestBody.max_tokens = tokenLimit;
    }
    if (enabled(body.model.supports_json)) requestBody.response_format = { type: "json_object" };
    if (policy.nativeSeed !== null) requestBody.seed = policy.nativeSeed;

    const response = await fetch(safeEndpoint(body.model.base_url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${body.apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(Math.max(5, Number(body.settings.timeout_seconds) || 60) * 1000),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      return Response.json({ ok: false, retryable, message: payload.error?.message || `模型接口返回 HTTP ${response.status}`, retryAfter }, { status: response.status });
    }

    const rawResponse = payload.choices?.[0]?.message?.content || "";
    if (!rawResponse) return Response.json({ ok: false, retryable: true, message: "模型响应中没有可读取的回答内容。" }, { status: 422 });
    const clean = trial.task === "word" ? parseColor(rawResponse, trial.stimulusId) : parseAssociations(rawResponse);
    const result = {
      trial_id: `batch-${body.model.id}-${trial.task}-${trial.runIndex}-${trial.stimulusId}`,
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

    await env.DB.prepare(`INSERT OR REPLACE INTO trial_results (
      trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id,
      clean_json, raw_response, validation_status, retry_count, latency_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(result.trial_id, result.project_id, result.model_id, result.model_alias, result.task_type,
        result.run_index, result.stimulus_id, result.clean_json, result.raw_response,
        result.validation_status, result.retry_count, result.latency_ms, result.created_at).run();

    return Response.json({ ok: true, result, latencyMs: result.latency_ms });
  } catch (error) {
    return Response.json({ ok: false, retryable: true, message: error instanceof Error ? error.message : "试次执行失败。" }, { status: 422 });
  }
}
