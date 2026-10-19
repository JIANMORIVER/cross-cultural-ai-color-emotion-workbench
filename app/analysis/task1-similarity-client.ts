import type { CanonicalColorRow, ExportRow } from "./engine";

const BASE_URL = "http://127.0.0.1:8773";

export type SimilarityMatrix = Array<Array<number | null>>;
export type Task1SimilarityResult = {
  version: number;
  randomState: number;
  sources: string[];
  humanSources: string[];
  aiSources: string[];
  emotions: string[];
  missingIdentitySources: string[];
  processedRows: ExportRow[];
  distributionStatistics: ExportRow[];
  coverage: { rows: ExportRow[]; matrix: SimilarityMatrix };
  distances: { rows: ExportRow[]; emdMatrix: SimilarityMatrix; jsdMatrix: SimilarityMatrix; primaryBins: number; binSizes: number[] };
  separability: {
    rows: ExportRow[];
    aucMatrix: SimilarityMatrix;
    inference: {
      iterations: number;
      pairSummaries: ExportRow[];
      bootstrapSamples: ExportRow[];
      permutationSamples: ExportRow[];
      deltaSummaries: ExportRow[];
      closestStability: ExportRow[];
      closestDraws: ExportRow[];
    };
  };
  countryAlignment: { probabilities: ExportRow[]; matrix: SimilarityMatrix; oofAccuracy: number | null; folds?: number; error?: string };
  evidence: ExportRow[];
  method: Record<string, string>;
};

export type Task1SimilarityJob = { jobId: string; status: "running"|"completed"|"failed"|"cancelled"; stage: string; completed: number; total: number; result?: Task1SimilarityResult; error?: string };

export async function startTask1SimilarityJob(rows: CanonicalColorRow[], options: { representativeK: number; folds: number; binSizes: number[]; inferenceIterations: number }) {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/task1-similarity-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, options }),
    });
  } catch {
    throw new Error("实验一多层相似性服务未启动，请重启 3006 后再试。");
  }
  const payload = await response.json().catch(() => ({})) as { jobId?: string; message?: string };
  if (!response.ok) throw new Error(payload.message || `多层相似性分析失败（HTTP ${response.status}）。`);
  if (!payload.jobId) throw new Error("多层相似性服务未返回任务编号。");
  return payload.jobId;
}

export async function getTask1SimilarityJob(jobId: string) {
  const response = await fetch(`${BASE_URL}/task1-similarity-jobs/${jobId}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as Task1SimilarityJob & { message?: string };
  if (!response.ok) throw new Error(payload.message || `查询多层相似性进度失败（HTTP ${response.status}）。`);
  return payload;
}

export async function cancelTask1SimilarityJob(jobId: string) {
  const response = await fetch(`${BASE_URL}/task1-similarity-jobs/${jobId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("取消多层相似性分析失败。");
}
