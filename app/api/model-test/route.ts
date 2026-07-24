import { buildChatRequest, safeEndpoint, type RequestModel } from "../../experiment/model-request";
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

async function runProbe(apiKey: string, model: RequestModel, prompt: string, task: "word" | "color") {
  const response = await fetch(safeEndpoint(model.base_url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify(buildChatRequest(model, prompt, task)),
  });
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
    throw new Error(detail);
  }
  const content = payload.choices?.[0]?.message?.content || "";
  if (!content) {
    const refusal = payload.choices?.[0]?.message?.refusal;
    throw new Error(refusal ? `模型拒绝测试请求：${refusal}` : "测试响应没有可读取内容。");
  }
  if (task === "word") parseColorResponse(content, "Interest");
  else parseAssociationResponse(content);
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json() as TestBody;
    const apiKey = String(body.apiKey || "").trim();
    const model: RequestModel = body.model || {
      model_id: String(body.modelId || ""),
      base_url: String(body.baseUrl || ""),
      max_tokens: 500,
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
    await runProbe(apiKey, model, buildWordToColorPrompt("Interest"), "word");
    await runProbe(apiKey, model, colorPrompt, "color");

    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      message: "连接、词选色格式和色选情绪格式均验证通过。",
    });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : "连接或格式验证失败。",
      latencyMs: Date.now() - started,
    }, { status: 400 });
  }
}
