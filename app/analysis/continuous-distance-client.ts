import type { CanonicalColorRow, ExportRow } from "./engine";

const BASE_URL = "http://127.0.0.1:8773";
export type NumericMatrix = Array<Array<number | null>>;
export type ContinuousDistanceResult = {
  version: number; sources: string[]; humanSources: string[]; aiSources: string[]; emotions: string[]; metrics: string[];
  missingIdentitySources: string[]; bootstrapIterations: number; assignmentRepeats: number; permutationIterations?: number; formalMetrics?: string[];
  distanceLong: ExportRow[]; assignmentDetails: ExportRow[]; withinDispersion: ExportRow[]; withinMetricDistances?: ExportRow[];
  ranking: ExportRow[]; pairedCountryDeltas: ExportRow[]; closestStability: ExportRow[]; asymmetry: ExportRow[];
  metricAgreement: ExportRow[]; metricAgreementMatrix: NumericMatrix; rankAgreement: ExportRow[]; metadata: Record<string,string>;
  humanPairwisePermutation?: ExportRow[]; assignmentCommonMDiagnostics?: ExportRow[]; formalPairwiseLetters?: ExportRow[];
  formalPairwiseMatrices?: ExportRow[]; formalMetricRobustness?: ExportRow[]; formalUnitAudit?: ExportRow[];
  aiPairwiseDescriptive?: ExportRow[]; energy76UResults?: ExportRow[]; energy76VLegacy?: ExportRow[]; metricSensitivity?: ExportRow[];
  legacyHumanPairwiseBootstrap?: ExportRow[]; legacyAiPairwiseBootstrap?: ExportRow[]; legacyPairwiseLetters?: ExportRow[];
  legacyPairwiseSignificanceMatrices?: ExportRow[]; legacyMetricRobustness?: ExportRow[];
};

export type ContinuousDistanceJob = { jobId: string; status: "running"|"completed"|"failed"|"cancelled"; stage: string; completed: number; total: number; result?: ContinuousDistanceResult; error?: string };

export async function startContinuousDistanceJob(rows: CanonicalColorRow[], options: { bootstrapIterations: number; assignmentRepeats: number; permutationIterations: number }) {
  let response: Response;
  try { response = await fetch(`${BASE_URL}/continuous-distance-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, options }) }); }
  catch { throw new Error("连续色彩距离服务未启动，请重新启动 3006。"); }
  const payload = await response.json().catch(() => ({})) as { jobId?: string; message?: string };
  if (!response.ok) throw new Error(payload.message || `连续色彩距离分析失败（HTTP ${response.status}）。`);
  if (!payload.jobId) throw new Error("连续距离服务未返回任务编号。");
  return payload.jobId;
}

export async function getContinuousDistanceJob(jobId: string) {
  const response = await fetch(`${BASE_URL}/continuous-distance-jobs/${jobId}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as ContinuousDistanceJob & { message?: string };
  if (!response.ok) throw new Error(payload.message || `查询连续距离进度失败（HTTP ${response.status}）。`);
  return payload;
}

export async function cancelContinuousDistanceJob(jobId: string) {
  const response = await fetch(`${BASE_URL}/continuous-distance-jobs/${jobId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("取消连续距离分析失败。");
}

export async function renderContinuousDistanceFigure(result: ContinuousDistanceResult, kind: string, metric: string, format: "png"|"svg") {
  const response = await fetch(`${BASE_URL}/continuous-distance-figure`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result, kind, metric, format }) });
  if (!response.ok) { const payload=await response.json().catch(()=>({})) as {message?:string}; throw new Error(payload.message || `图表生成失败（HTTP ${response.status}）。`); }
  return response.blob();
}
