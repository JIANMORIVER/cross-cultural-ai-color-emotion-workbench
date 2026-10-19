import { gunzipSync, strFromU8 } from "fflate";
import type { ContinuousDistanceResult } from "./continuous-distance-client";
import type { Task1SimilarityResult } from "./task1-similarity-client";
import type { HeterogeneityResult } from "./task2-heterogeneity-client";

type OfflineKind = "continuous" | "similarity" | "heterogeneity";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireArray(record: Record<string, unknown>, key: string, label: string) {
  if (!Array.isArray(record[key])) throw new Error(`${label}缺少 ${key}，文件可能不完整或类型不正确。`);
}

function normalizeNonFiniteJsonTokens(input: string) {
  let output = "", quoted = false, escaped = false, replacements = 0;
  const tokens = ["-Infinity", "Infinity", "NaN"];
  for (let index = 0; index < input.length;) {
    const character = input[index];
    if (quoted) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      index += 1;
      continue;
    }
    if (character === '"') { quoted = true; output += character; index += 1; continue; }
    const token = tokens.find(candidate => input.startsWith(candidate, index));
    if (token) { output += "null"; replacements += 1; index += token.length; continue; }
    output += character; index += 1;
  }
  return { text: output, replacements };
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

function validateHeterogeneity(value: unknown): HeterogeneityResult {
  if (!isRecord(value)) throw new Error("个体异质性结果的顶层结构不是 JSON 对象。");
  for (const key of ["colors", "emotions", "humanSources", "aiSources"]) requireArray(value, key, "个体异质性结果");
  for (const key of ["config", "qc", "subgroups", "distribution", "matching", "method"]) {
    if (!isRecord(value[key])) throw new Error(`个体异质性结果缺少 ${key}。`);
  }
  const qc = value.qc as Record<string, unknown>;
  requireArray(qc, "rows", "个体异质性 QC");
  if (Number(qc.dimensions) !== 220) throw new Error(`个体异质性结果维度为 ${String(qc.dimensions)}，预期应为完整 11×20 = 220 维。`);
  const subgroups = value.subgroups as Record<string, unknown>;
  for (const key of ["validation", "assignmentsHuman", "assignmentsAi", "profiles", "composition", "pca"]) requireArray(subgroups, key, "个体异质性 subgroup");
  const distribution = value.distribution as Record<string, unknown>;
  for (const key of ["energy", "mmd", "consistency"]) requireArray(distribution, key, "个体异质性分布距离");
  const matching = value.matching as Record<string, unknown>;
  for (const key of ["nn", "hungarian", "nnDistances"]) requireArray(matching, key, "个体异质性匹配结果");
  if ((distribution.energy as unknown[]).length < 16 || (distribution.mmd as unknown[]).length < 16) throw new Error("Energy/MMD 结果少于16个 AI–Human 配对，文件可能尚未计算完成。");
  const humanPca = (subgroups.pca as unknown[]).filter(row => isRecord(row) && row.population === "human" && row.representation === "binary") as Record<string, unknown>[];
  const binaryNn = (matching.nn as unknown[]).filter(row => isRecord(row) && row.representation === "binary") as Record<string, unknown>[];
  const collapsedHumanPca = humanPca.length > 0 && humanPca.every(row => Number(row.pc1) === 0 && Number(row.pc2) === 0);
  const saturatedNn = binaryNn.length >= 16 && binaryNn.every(row => Number(row.symmetricMean) === 1);
  if (collapsedHumanPca && saturatedNn) {
    throw new Error("检测到旧版全零 Human 结果：Human PCA 全部为(0,0)，且16组 Binary NN 全为1.000。该文件不是大小写修复版结果，请使用带 parserVersion 的新包重新做输入预检与分析。");
  }
  return value as unknown as HeterogeneityResult;
}

export async function readOfflineAnalysisResult(file: File, kind: "continuous"): Promise<ContinuousDistanceResult>;
export async function readOfflineAnalysisResult(file: File, kind: "similarity"): Promise<Task1SimilarityResult>;
export async function readOfflineAnalysisResult(file: File, kind: "heterogeneity"): Promise<HeterogeneityResult>;
export async function readOfflineAnalysisResult(file: File, kind: OfflineKind) {
  const input = new Uint8Array(await file.arrayBuffer());
  if (!input.length) throw new Error("所选文件为空。");
  let decoded = input;
  if (input[0] === 0x1f && input[1] === 0x8b) {
    try { decoded = gunzipSync(input); }
    catch { throw new Error("GZIP 解压失败；请重新复制完整的 .json.gz 文件。 "); }
  }
  let value: unknown;
  const jsonText = strFromU8(decoded);
  try { value = JSON.parse(jsonText); }
  catch {
    const normalized = normalizeNonFiniteJsonTokens(jsonText);
    if (!normalized.replacements) throw new Error("无法读取结果 JSON。请选择对应的 *_result.json.gz，而不是 CSV.zip。");
    try {
      value = JSON.parse(normalized.text);
      if (isRecord(value)) value.offlineNormalizationCount = normalized.replacements;
    } catch { throw new Error("结果文件包含无法修复的非标准 JSON；请保留文件并重新联系检查。"); }
  }
  return kind === "continuous" ? validateContinuous(value) : kind === "similarity" ? validateSimilarity(value) : validateHeterogeneity(value);
}
