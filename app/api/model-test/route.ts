function safeEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new Error("Only HTTPS endpoints are allowed.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) {
    throw new Error("Private network endpoints are not allowed.");
  }
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const { apiKey, baseUrl, modelId } = await request.json() as Record<string, string>;
    if (!apiKey || !baseUrl || !modelId) return Response.json({ ok: false, message: "Complete the API key, Base URL, and Model ID." }, { status: 400 });
    const response = await fetch(safeEndpoint(baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Return only this JSON object: {\"ok\":true}" }],
        max_tokens: 20,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (payload as { error?: { message?: string } }).error?.message || `HTTP ${response.status}`;
      return Response.json({ ok: false, message, latencyMs: Date.now() - started }, { status: 400 });
    }
    return Response.json({ ok: true, latencyMs: Date.now() - started, jsonMode: true });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "Connection failed", latencyMs: Date.now() - started }, { status: 400 });
  }
}
