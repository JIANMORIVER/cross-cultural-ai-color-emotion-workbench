import { env } from "cloudflare:workers";
import { applyRandomnessPolicy } from "../../experiment/randomness";
import { buildColorToEmotionPrompt, EXPERIMENT_EMOTIONS, type OrderPolicy } from "../../experiment/prompts";

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

function parseModelJson(content: string) {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
  const parsed = JSON.parse(candidate) as Record<string, unknown>;
  const nested = parsed.Interest && typeof parsed.Interest === "object" ? parsed.Interest as Record<string, unknown> : parsed;
  const hex = String(nested.hex || "");
  if (!/^#[0-9A-F]{6}$/i.test(hex)) throw new Error("模型已响应，但没有返回有效的 HEX 色值。");
  return { parsed: nested, hex: hex.toUpperCase() };
}

function parseAssociations(content: string) {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  const parsed = JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean) as Record<string, unknown>;
  const values = Array.isArray(parsed) ? parsed : parsed.associations;
  if (!Array.isArray(values) || values.length < 1 || values.length > EXPERIMENT_EMOTIONS.length) {
    throw new Error("模型已响应，但关联结果必须包含 1–20 个情绪。");
  }
  const canonical = new Map(EXPERIMENT_EMOTIONS.map(emotion => [emotion.toLowerCase(), emotion]));
  const used = new Set<string>();
  const associations = values.map(value => {
    if (!value || typeof value !== "object") throw new Error("情绪关联项格式无效。");
    const item = value as Record<string, unknown>;
    const emotion = canonical.get(String(item.emotion || "").toLowerCase());
    const intensity = Number(item.intensity);
    if (!emotion) throw new Error(`模型返回了不在词表中的情绪：${String(item.emotion || "空值")}`);
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) throw new Error(`${emotion} 的强度必须是 1–5 的整数。`);
    if (used.has(emotion)) throw new Error(`模型重复返回了情绪：${emotion}`);
    used.add(emotion);
    return { emotion, intensity };
  });
  return { associations };
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as { apiKey: string; model: PilotModel; settings: OrderPolicy; task?: "word" | "color" };
    if (!body.apiKey || !body.model?.model_id || !body.model?.base_url) {
      return Response.json({ ok: false, message: "请完整填写 API Key、模型型号和接口地址。" }, { status: 400 });
    }

    const task = body.task === "color" ? "color" : "word";
    const colorPrompt = buildColorToEmotionPrompt("J0", "#262626", body.settings, 1, 0);
    const basePrompt = task === "color" ? colorPrompt.prompt : `You are participating in an emotion-color association experiment.
For the English emotion word "Interest", choose the single sRGB color you most intuitively associate with it.
Return exactly one JSON object with the model's original color fields in this structure:
{"h": 0, "s": 0, "l": 0, "hex": "#000000"}
h must be 0-360; s and l must be 0-100. Do not add markdown or commentary.`;
    const policy = applyRandomnessPolicy(basePrompt, body.settings, 1, 0, body.model.supports_seed);
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
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) {
      return Response.json({ ok: false, message: payload.error?.message || `模型接口返回 HTTP ${response.status}` }, { status: 400 });
    }

    const rawResponse = payload.choices?.[0]?.message?.content || "";
    if (!rawResponse) return Response.json({ ok: false, message: "模型响应中没有可读取的回答内容。" }, { status: 400 });
    const colorResult = task === "word" ? parseModelJson(rawResponse) : null;
    const associationResult = task === "color" ? parseAssociations(rawResponse) : null;
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
      clean_json: JSON.stringify(task === "word" ? colorResult?.parsed : associationResult),
      raw_response: rawResponse,
      validation_status: "Valid",
      retry_count: 0,
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
      policy: { promptSeed: policy.promptSeed, nativeSeed: policy.nativeSeed, promptVariant: policy.promptVariant, emotionOptionSeed: task === "color" ? colorPrompt.optionSeed : null },
    });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "单模型试跑失败。" }, { status: 400 });
  }
}
