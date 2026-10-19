import { gunzipSync, strFromU8 } from "fflate";
import type { ContinuousDistanceResult } from "./continuous-distance-client";
import type { Task1SimilarityResult } from "./task1-similarity-client";

type OfflineKind = "continuous" | "similarity";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireArray(record: Record<string, unknown>, key: string, label: string) {
  if (!Array.isArray(record[key])) throw new Error(`${label}缺少 ${key}，文件可能不完整或类型不正确。`);
}

function validateContinuous(value: unknown): ContinuousDistanceResult {
  if (!isRecord(value)) throw new Error("连续距离结果的顶层结构不是 JSON 对象。");
  for (const key of ["sources", "humanSources", "aiSources", "emotions", "metrics", "distanceLong", "ranking", "closestStability", "metricAgreementMatrix"]) requireArray(value, key, "连续距离结果");
  if (!isRecord(value.metadata)) throw new Error("连续距离结果缺少 metadata 方法记录。");
  return value as unknown as ContinuousDistanceResult;
}

function validateSimilarity(value: unknown): Task1SimilarityResult {
  if (!isRecord(value)) throw new Error("多层相似性结果的顶层结构不是 JSON 对象。");
  for (const key of ["sources", "humanSources", "aiSources", "emotions", "processedRows", "distributionStatistics", "evidence"]) requireArray(value, key, "多层相似性结果");
  for (const key of ["coverage", "distances", "separability", "countryAlignment", "method"]) {
    if (!isRecord(value[key])) throw new Error(`多层相似性结果缺少 ${key}。`);
  }
  const separability = value.separability as Record<string, unknown>;
  if (!isRecord(separability.inference)) throw new Error("多层相似性结果缺少 separability.inference 推断结果。");
  return value as unknown as Task1SimilarityResult;
}

export async function readOfflineAnalysisResult(file: File, kind: "continuous"): Promise<ContinuousDistanceResult>;
export async function readOfflineAnalysisResult(file: File, kind: "similarity"): Promise<Task1SimilarityResult>;
export async function readOfflineAnalysisResult(file: File, kind: OfflineKind) {
  const input = new Uint8Array(await file.arrayBuffer());
  if (!input.length) throw new Error("所选文件为空。");
  let decoded = input;
  if (input[0] === 0x1f && input[1] === 0x8b) {
    try { decoded = gunzipSync(input); }
    catch { throw new Error("GZIP 解压失败；请重新复制完整的 .json.gz 文件。 "); }
  }
  let value: unknown;
  try { value = JSON.parse(strFromU8(decoded)); }
  catch { throw new Error("无法读取结果 JSON。请选择 continuous_result.json.gz 或 similarity_result.json.gz，而不是 CSV.zip。"); }
  return kind === "continuous" ? validateContinuous(value) : validateSimilarity(value);
}
