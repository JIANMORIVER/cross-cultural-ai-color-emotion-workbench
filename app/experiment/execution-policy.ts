export type ExecutionPolicyModel = {
  provider?: string;
  alias?: string;
  model_id: string;
  base_url?: string;
  rate_limit?: number;
};

export const GEMINI_STABLE_POLICY = {
  id: "gemini-stable-v1",
  concurrency: 1,
  requestsPerMinute: 8,
  timeoutSeconds: 90,
  totalAttempts: 4,
  retryDelaysMs: [5_000, 20_000, 60_000] as const,
  cooldownThreshold: 3,
  cooldownMs: 180_000,
} as const;

export function usesGeminiStablePolicy(model: ExecutionPolicyModel) {
  const signature = `${model.provider || ""} ${model.alias || ""} ${model.model_id || ""} ${model.base_url || ""}`.toLowerCase();
  return signature.includes("gemini") || signature.includes("google") || signature.includes("generativelanguage.googleapis.com");
}

export function effectiveRequestsPerMinute(model: ExecutionPolicyModel) {
  if (usesGeminiStablePolicy(model)) return GEMINI_STABLE_POLICY.requestsPerMinute;
  const configured = Number(model.rate_limit);
  return Number.isFinite(configured) && configured > 0 ? configured : 60;
}

export function effectiveTimeoutSeconds(model: ExecutionPolicyModel, configuredSeconds: number) {
  if (usesGeminiStablePolicy(model)) return GEMINI_STABLE_POLICY.timeoutSeconds;
  const configured = Number(configuredSeconds);
  return Number.isFinite(configured) && configured >= 5 ? configured : 60;
}

export function totalAttemptLimit(model: ExecutionPolicyModel, configuredAttempts: number) {
  if (usesGeminiStablePolicy(model)) return GEMINI_STABLE_POLICY.totalAttempts;
  const configured = Number(configuredAttempts);
  return Math.max(1, Number.isFinite(configured) ? Math.floor(configured) : 1);
}

export function retryAfterMilliseconds(retryAfter: string | null | undefined, maximumMs = 180_000) {
  if (!retryAfter) return 0;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(maximumMs, seconds * 1000);
  const dateDelay = Date.parse(retryAfter) - Date.now();
  return Number.isFinite(dateDelay) && dateDelay > 0 ? Math.min(maximumMs, dateDelay) : 0;
}

export function retryDelayMilliseconds(
  model: ExecutionPolicyModel,
  retryIndex: number,
  retryAfter?: string | null,
  jitter = Math.random(),
) {
  const serverDelay = retryAfterMilliseconds(retryAfter);
  if (serverDelay > 0) return serverDelay;
  const normalizedIndex = Math.max(0, Math.floor(retryIndex));
  const base = usesGeminiStablePolicy(model)
    ? GEMINI_STABLE_POLICY.retryDelaysMs[Math.min(normalizedIndex, GEMINI_STABLE_POLICY.retryDelaysMs.length - 1)]
    : Math.min(5_000, 700 * 2 ** normalizedIndex);
  return base + Math.floor(Math.max(0, Math.min(1, jitter)) * (usesGeminiStablePolicy(model) ? 1_500 : 350));
}
