import type { GewRow } from "./engine";

const ML_URL = "http://127.0.0.1:8773/ml-analysis";

export type MlPhaseOneResult = {
  version: number;
  randomState: number;
  sources: string[];
  colors: string[];
  emotions: string[];
  decoding: Record<string, {
    accuracy: number; macroF1: number; macroAuc: number | null; samples: number; units: number; chance: number; cohort: string; unitField: string;
    confusion: number[][]; confusionNormalized: number[][]; colorSimilarity: number[][]; recall: Record<string, number>;
    folds: Array<{ fold: number; trainUnits: number; testUnits: number; accuracy: number; bestC: number; bestGamma: string | number }>;
  }>;
  crossGeneralization: number[][];
  normalizedTransfer: Array<Array<number | null>>;
  humanSources: string[];
  aiSources: string[];
  humanToAi: Array<Array<number | null>>;
  aiToHuman: Array<Array<number | null>>;
  method: Record<string, string | number>;
};

export async function runMlPhaseOne(rows: GewRow[], options: { outerFolds: number; innerFolds: number }): Promise<MlPhaseOneResult> {
  let response: Response;
  try {
    response = await fetch(ML_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, options }) });
  } catch {
    throw new Error("本地机器学习服务未启动，请重启 3006 后重试。");
  }
  const payload = await response.json().catch(() => ({})) as MlPhaseOneResult & { message?: string };
  if (!response.ok) throw new Error(payload.message || `机器学习分析失败（HTTP ${response.status}）。`);
  return payload;
}
