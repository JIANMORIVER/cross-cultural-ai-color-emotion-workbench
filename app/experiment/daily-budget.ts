export const GEMINI_DAILY_COMPLETE_ROUNDS = 7;
export const COMPLETE_ROUND_REQUESTS = 31;
export const GEMINI_DAILY_FORMAL_REQUESTS = GEMINI_DAILY_COMPLETE_ROUNDS * COMPLETE_ROUND_REQUESTS;
export const GEMINI_DAILY_QUOTA_REFERENCE = 250;
export const GEMINI_DAILY_RESERVE = GEMINI_DAILY_QUOTA_REFERENCE - GEMINI_DAILY_FORMAL_REQUESTS;
export const GEMINI_QUOTA_TIME_ZONE = "America/Los_Angeles";

type DatedRunGroup = {
  model_id: string;
  run_index: number;
  started_at?: string | null;
  word_count?: number;
  color_count?: number;
};

export type GeminiDailyBudget = {
  quotaDay: string;
  targetRounds: number;
  completedRounds: number;
  remainingTargetRounds: number;
  todayRounds: number;
  remainingTodayRounds: number;
  nextBatchRounds: number;
};

export function quotaDayKey(value: Date | string | number = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GEMINI_QUOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function summarizeGeminiDailyBudget(
  modelId: string,
  groups: DatedRunGroup[],
  targetRounds: number,
  now: Date | string | number = new Date(),
): GeminiDailyBudget {
  const modelGroups = groups.filter(group => group.model_id === modelId);
  const uniqueRuns = new Map<number, DatedRunGroup>();
  for (const group of modelGroups) uniqueRuns.set(Number(group.run_index), group);
  const normalizedTarget = Math.max(0, Math.floor(Number(targetRounds) || 0));
  const quotaDay = quotaDayKey(now);
  const completedRounds = [...uniqueRuns.values()].filter(group =>
    Number(group.word_count || 0) >= 20 && Number(group.color_count || 0) >= 11).length;
  const todayRounds = [...uniqueRuns.values()].filter(group => quotaDayKey(group.started_at || "") === quotaDay).length;
  const remainingTargetRounds = Math.max(0, normalizedTarget - completedRounds);
  const remainingTodayRounds = Math.max(0, GEMINI_DAILY_COMPLETE_ROUNDS - todayRounds);
  return {
    quotaDay,
    targetRounds: normalizedTarget,
    completedRounds,
    remainingTargetRounds,
    todayRounds,
    remainingTodayRounds,
    nextBatchRounds: Math.min(remainingTargetRounds, remainingTodayRounds),
  };
}
