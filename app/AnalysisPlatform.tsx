"use client";

import { useMemo, useRef, useState } from "react";
import { BidirectionalVisualLab } from "./analysis/BidirectionalVisualLab";
import { elementToPngBlob } from "./analysis/export-png";
import { buildInteractiveHtmlReport } from "./analysis/html-report";
import { Task1VisualLab } from "./analysis/Task1VisualLab";
import { Task2VisualLab } from "./analysis/Task2VisualLab";
import {
  colorRowsToExport,
  detectDataset,
  gewRowsToExport,
  inspectRowQuality,
  parseColorRows,
  parseGewRows,
  runBidirectionalConsistency,
  runBidirectionalGroupComparison,
  runColorClustering,
  runColorDiversity,
  runCulturalBias,
  runColorSummary,
  runDeltaE,
  runGewConcentration,
  runGewCompositeIndicators,
  runHsvDistribution,
  runGewDescriptive,
  runGewJsd,
  runGewOmnibus,
  runGewPairwise,
  runGewPatternSimilarity,
  runGewQc,
  runGewValenceProfile,
  runHueDistributionDistance,
  runHumanAiColorAlignment,
  runHumanAiColorCohortTest,
  runHumanAiGewAlignment,
  runHumanAiGewCohortTest,
  runWithinGroupDelta,
  toCsv,
  type AnalysisResult,
  type DataRow,
  type Detection,
  type ExportRow,
  type GewRow,
} from "./analysis/engine";

type Cohort = "human" | "ai" | "unspecified";
type SheetData = { name: string; rows: DataRow[]; columns: string[]; hiddenRows: number[] };
type ExperimentGroup = {
  id: string;
  label: string;
  fileName: string;
  sheets: SheetData[];
  sheetName: string;
  selectedColumns: string[];
  rowStart: number;
  rowEnd: number;
  enabled: boolean;
  cohort: Cohort;
  excludedRows: number[];
};
type RunStatus = "idle" | "running" | "completed" | "error";
type TaskRun = { status: RunStatus; result?: AnalysisResult; error?: string };
type WorkspaceTab = "import" | "tasks" | "dashboard";
type AnalysisScope = "combined" | "active";
type AnalysisConfig = {
  kind: "chromalab-analysis-config";
  version: 1;
  exportedAt: string;
  analysisScope: AnalysisScope;
  groups: Array<{
    fileName: string;
    label: string;
    cohort: Cohort;
    sheetName: string;
    selectedColumns: string[];
    rowStart: number;
    rowEnd: number;
    enabled: boolean;
    excludedRows: number[];
  }>;
};

type ColumnRecommendation = {
  keep: string[];
  exclude: string[];
  roles: Record<string, string>;
  schema: Detection["schema"];
};

const TASKS = [
  { id: "task1-normalize", group: "实验一", title: "色彩格式标准化", description: "宽表转长表，并将 HEX、RGB、HSL、HSV 或 Lab 统一到五种标准色彩表示。", output: "标准长表", space: "输入格式 → sRGB D65 → HSL / HSV / CIELAB" },
  { id: "task1-summary", group: "实验一", title: "来源 × 情绪描述统计", description: "汇总每个来源与情绪的样本量、平均色彩、亮度与饱和度。", output: "描述统计", space: "HSL + CIELAB D65" },
  { id: "task1-hsv", group: "实验一", title: "HSV 分布与 H–S / V–S 图", description: "由 RGB 转换 HSV，生成按来源分面的 H–S 极坐标和 V–S 密度散点数据。", output: "HSV 长表 + 图表", space: "sRGB → HSV（H°，S/V 0–1）" },
  { id: "task1-cluster", group: "实验一", title: "最佳 K 与 Lab 聚类", description: "按历史脚本在 Lab 空间搜索 K=2–5，以轮廓系数选择最佳聚类并输出中心色与权重；少于 5 个样本的组合跳过。", output: "聚类中心", space: "CIELAB D65" },
  { id: "task1-within-delta", group: "实验一", title: "组内色差与选择一致性", description: "生成组内 ΔE 矩阵摘要，计算平均最近邻色差和全部样本对平均色差。", output: "组内一致性", space: "CIELAB D65 · ΔE76" },
  { id: "task1-delta", group: "实验一", title: "跨来源 ΔE 色差", description: "按情绪计算来源之间的双向最近邻 CIE76 色差，刻画模型或文化偏差。", output: "色差矩阵", space: "CIELAB D65 · ΔE76" },
  { id: "task1-bias", group: "实验一", title: "跨文化引力与偏置指数", description: "以任意两个来源为参照，计算其他来源在每个情绪上的文化偏置方向与强度。", output: "偏置指数", space: "CIELAB D65 · ΔE76" },
  { id: "task1-diversity", group: "实验一 · 扩展", title: "色相多样性与色域离散", description: "用圆周统计、色相熵、有效色相数与 Lab 质心半径检验色彩是否集中或刻板。", output: "多样性指标", space: "HSV 圆周统计 + CIELAB D65" },
  { id: "task1-hue-jsd", group: "实验一 · 扩展", title: "色相分布来源距离", description: "将色相划分为 12 个圆周区间，计算来源两两 Jensen–Shannon 距离。", output: "色相距离矩阵", space: "HSV H · 12-bin JSD" },
  { id: "task1-human-ai", group: "实验一 · 扩展", title: "人类–AI 色彩对齐", description: "逐情绪寻找每个 AI 最接近的人类文化组，并与人类组间基线比较。", output: "人类–AI 对齐表", space: "CIELAB D65 · 对称最近邻 ΔE76" },
  { id: "task1-cohort-test", group: "实验一 · 推断", title: "人类–AI 来源级精确检验", description: "先聚合每个来源的 Lab 质心，再按来源而非单条回答执行 4×4 精确置换，并对 20 个情绪做 FDR 校正。", output: "来源级效应与精确 p/q", space: "来源质心 ΔE76 · 70种精确标签置换 + BH-FDR" },
  { id: "task2-qc", group: "实验二", title: "GEW 解析与质量控制", description: "解析 word_data.<颜色> JSON，检查无效单元格并补齐 20 情绪完整网格。", output: "QC 长表", space: "GEW 20 情绪 · 1–5 强度" },
  { id: "task2-descriptive", group: "实验二", title: "选择率、强度与价性", description: "按来源、颜色和情绪计算选择率、全部样本强度、已选强度与正负价性。", output: "描述统计", space: "二元选择 + 1–5 强度" },
  { id: "task2-omnibus", group: "实验二", title: "来源间总体差异", description: "对每个颜色 × 情绪执行总体卡方检验，并进行 Benjamini–Hochberg FDR 校正。", output: "总体检验", space: "χ² + Cramér’s V + BH-FDR" },
  { id: "task2-pairwise", group: "实验二", title: "来源两两差异", description: "逐对比较来源选择率，输出优势比、95% CI、Phi、p 值与 FDR q 值。", output: "两两检验", space: "χ² + OR(95% CI) + Phi + BH-FDR" },
  { id: "task2-jsd", group: "实验二", title: "情绪分布距离", description: "比较各来源的 20 情绪选择率分布，计算 Jensen–Shannon 距离。", output: "距离矩阵", space: "20 维选择率 · JSD" },
  { id: "task2-valence", group: "实验二 · 扩展", title: "正负价性轮廓", description: "按颜色比较正、负价情绪的选择率、强度与价性偏向。", output: "价性轮廓", space: "GEW 正/负价性聚合" },
  { id: "task2-concentration", group: "实验二 · 扩展", title: "情绪集中度与多样性", description: "用 Shannon 熵与有效情绪数检验 AI 是否更集中于少数典型情绪。", output: "集中度指标", space: "20 维选择率 · Shannon entropy" },
  { id: "task2-indicators", group: "实验二 · 扩展", title: "广度、条件强度与效价偏向", description: "以 participant×run×color 为单位分别计算情绪广度、已选择条件强度与正负效价偏向，并报告 Bootstrap 95% 区间。", output: "综合指标与区间", space: "Broadness + conditional intensity + valence bias" },
  { id: "task2-pattern", group: "实验二 · 扩展", title: "完整矩阵模式相似性", description: "将每个来源的 11×20 关联概率矩阵展平为 220 维向量，比较整张颜色—情绪结构并估计 Bootstrap 95% 区间。", output: "来源对模式相关", space: "220维 Pearson r + 500次 Bootstrap" },
  { id: "task2-human-ai", group: "实验二 · 扩展", title: "人类–AI 情绪轮对齐", description: "逐颜色寻找 AI 最接近的人类组，同时报告分布距离与轮廓相关。", output: "人类–AI 对齐表", space: "JSD + Pearson 相关" },
  { id: "task2-cohort-test", group: "实验二 · 推断", title: "人类–AI 来源级精确检验", description: "在每个来源内汇总颜色×情绪的选择率、条件强度与零值纳入强度，再做 4×4 来源级精确置换与 FDR 校正。", output: "三类效应与 p/q", space: "来源级 70种精确标签置换 + BH-FDR" },
  { id: "task-cross-bidirectional", group: "双向整合 · 探索", title: "双向一致性与非对称性", description: "将自由词选色按 CIEDE2000 映射到 11 个标准色，与色选词矩阵比较 Top-1/Top-3、Spearman、JSD、方向差与互惠强度。", output: "20×11 双向关联长表", space: "ΔE00 硬映射 + Spearman + JSD + P−Q" },
  { id: "task-cross-groups", group: "双向整合 · 扩展", title: "八组双向指标两两比较", description: "保留4个人类组和4个AI组为8个独立组，对全部28个组对比较排序一致性、分布相似度、Top-1和非对称性轮廓。", output: "28组对×8指标的差值、MAE与相关", space: "8×8组间矩阵 · 20情绪轮廓" },
] as const;

function download(name: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.style.display = "none"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resultFromRows(id: string, title: string, rows: ExportRow[], summary: AnalysisResult["summary"], note?: string): AnalysisResult {
  return { id, title, kind: "table", rows, summary, note };
}

function rangeRows(group?: ExperimentGroup) {
  if (!group) return [];
  const sheet = group.sheets.find(item => item.name === group.sheetName);
  if (!sheet) return [];
  return sheet.rows
    .slice(Math.max(0, group.rowStart - 1), Math.min(sheet.rows.length, group.rowEnd))
    .map((row, index) => ({ row, rowNumber: group.rowStart + index }));
}

function configuredRows(group?: ExperimentGroup) {
  if (!group) return [];
  const excluded = new Set(group.excludedRows);
  return rangeRows(group)
    .filter(item => !excluded.has(item.rowNumber))
    .map(({ row }) => ({
      ...Object.fromEntries(group.selectedColumns.map(column => [column, row[column]])),
      _analysis_group: group.label,
      _analysis_cohort: group.cohort,
    }) as DataRow);
}

function safeFileName(value: string) {
  return value.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "analysis";
}
function dataRowsToExport(rows: DataRow[]): ExportRow[] {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value == null || ["string", "number", "boolean"].includes(typeof value) ? value as ExportRow[string] : JSON.stringify(value)])));
}

function createId(suffix = "") {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${suffix}-${Math.random().toString(36).slice(2)}`;
}

const ANALYSIS_METADATA_COLUMNS = new Set([
  "_source_file", "_analysis_group", "_analysis_cohort", "source", "group", "model", "model_alias", "platform",
  "来源", "组别", "模型", "平台", "cohort", "participant_type", "source_type", "样本类型", "组类型",
  "participant", "participant_id", "sample_id", "id", "trial_id", "experiment_id", "实验id", "样本id",
  "run", "run_index", "repetition", "轮次", "重复轮次",
].map(value => value.toLowerCase()));
const TASK1_LONG_COLUMNS = new Set([
  "emotion", "word", "emotion_word", "情绪", "情绪词", "hex", "color", "colour", "hex_color", "hex colour", "色值", "颜色",
  "r", "red", "rgb_r", "g", "green", "rgb_g", "b", "blue", "rgb_b",
  "h_hsl", "hsl_h", "hue_hsl", "h", "hue", "s_hsl", "hsl_s", "saturation_hsl", "s", "saturation",
  "l_hsl", "hsl_l", "lightness_hsl", "lightness", "l", "h_hsv", "hsv_h", "hue_hsv",
  "s_hsv", "hsv_s", "saturation_hsv", "v", "value", "hsv_v",
  "l*", "lab_l", "l_lab", "cie_l", "a*", "lab_a", "a_lab", "cie_a", "b*", "lab_b", "b_lab", "cie_b",
].map(value => value.toLowerCase()));
const GEW_COLOR_CODES = new Set(["D38", "F17", "F4", "J0", "F0", "F29", "A0", "H35", "I6", "G3", "C9"]);

function columnRecommendation(rows: DataRow[], columns: string[]): ColumnRecommendation {
  const populated = columns.filter(column => rows.some(row => row[column] != null && String(row[column]).trim() !== ""));
  const detection = detectDataset(rows, populated);
  if (detection.schema === "unknown") {
    return {
      keep: populated,
      exclude: columns.filter(column => !populated.includes(column)),
      roles: Object.fromEntries(columns.map(column => [column, populated.includes(column) ? "结构未确认，保守保留" : "整列为空"])),
      schema: detection.schema,
    };
  }
  const roles: Record<string, string> = {};
  const keep = populated.filter(column => {
    const clean = column.trim().toLowerCase();
    if (ANALYSIS_METADATA_COLUMNS.has(clean)) { roles[column] = "来源 / 样本 / 轮次元数据"; return true; }
    if (/^color_data\..+\.(h|s|l|hex)$/i.test(column)) { roles[column] = "实验一宽表色彩字段"; return true; }
    const gewMatch = column.match(/^word_data\.(.+)$/i);
    if (gewMatch && GEW_COLOR_CODES.has(gewMatch[1].toUpperCase())) { roles[column] = "实验二 GEW 颜色字段"; return true; }
    if (detection.schema === "task1-long" && TASK1_LONG_COLUMNS.has(clean)) { roles[column] = "实验一长表分析字段"; return true; }
    roles[column] = "未被当前实验结构引用";
    return false;
  });
  columns.filter(column => !populated.includes(column)).forEach(column => { roles[column] = "整列为空"; });
  return { keep, exclude: columns.filter(column => !keep.includes(column)), roles, schema: detection.schema };
}

function mergeDetections(items: Array<{ label: string; detection: Detection }>): Detection {
  if (!items.length) return { schema: "unknown", schemaLabel: "待确认的数据结构", confidence: 0, formats: [], evidence: [], warnings: ["尚未选择实验组。"] };
  const schemas = new Set(items.map(item => item.detection.schema).filter(schema => schema !== "unknown"));
  const hasTask1 = [...schemas].some(schema => schema === "task1-wide" || schema === "task1-long" || schema === "mixed");
  const hasTask2 = [...schemas].some(schema => schema === "task2-gew" || schema === "mixed");
  const schema: Detection["schema"] = hasTask1 && hasTask2
    ? "mixed"
    : schemas.has("task1-wide")
      ? "task1-wide"
      : schemas.has("task1-long")
        ? "task1-long"
        : schemas.has("task2-gew")
          ? "task2-gew"
          : "unknown";
  const schemaLabel = hasTask1 && hasTask2
    ? "实验一 + 实验二 · 多组独立解析"
    : hasTask1 && schemas.size > 1
      ? "实验一 · 宽表与长表独立解析"
      : items.length > 1
        ? `${items[0].detection.schemaLabel} · ${items.length} 组`
        : items[0].detection.schemaLabel;
  return {
    schema,
    schemaLabel,
    confidence: items.reduce((sum, item) => sum + item.detection.confidence, 0) / items.length,
    formats: [...new Set(items.flatMap(item => item.detection.formats))],
    evidence: items.flatMap(item => item.detection.evidence.slice(0, 2).map(evidence => `${item.label}：${evidence}`)),
    warnings: items.flatMap(item => item.detection.warnings.map(warning => `${item.label}：${warning}`)),
  };
}

function buildAnalysisConfig(groups: ExperimentGroup[], analysisScope: AnalysisScope): AnalysisConfig {
  return {
    kind: "chromalab-analysis-config",
    version: 1,
    exportedAt: new Date().toISOString(),
    analysisScope,
    groups: groups.map(group => ({
      fileName: group.fileName,
      label: group.label,
      cohort: group.cohort,
      sheetName: group.sheetName,
      selectedColumns: group.selectedColumns,
      rowStart: group.rowStart,
      rowEnd: group.rowEnd,
      enabled: group.enabled,
      excludedRows: group.excludedRows,
    })),
  };
}

function applyAnalysisConfig(loaded: ExperimentGroup[], config: AnalysisConfig) {
  const usage = new Map<string, number>();
  const consumedSourceIds = new Set<string>();
  const configured = config.groups.flatMap((saved, index) => {
    const candidates = loaded.filter(group => group.fileName === saved.fileName);
    const used = usage.get(saved.fileName) || 0;
    const source = candidates[Math.min(used, Math.max(0, candidates.length - 1))];
    if (!source) return [];
    consumedSourceIds.add(source.id);
    usage.set(saved.fileName, used + 1);
    const targetSheet = source.sheets.find(sheet => sheet.name === saved.sheetName) || source.sheets[0];
    const selectedColumns = saved.selectedColumns.filter(column => targetSheet.columns.includes(column));
    const rowStart = Math.min(targetSheet.rows.length, Math.max(1, saved.rowStart));
    const rowEnd = Math.min(targetSheet.rows.length, Math.max(rowStart, saved.rowEnd));
    return [{
      ...source,
      id: used === 0 ? source.id : createId(`config-${index}`),
      label: saved.label,
      cohort: saved.cohort,
      sheetName: targetSheet.name,
      selectedColumns,
      rowStart,
      rowEnd,
      enabled: saved.enabled,
      excludedRows: saved.excludedRows.filter(row => row >= rowStart && row <= rowEnd),
    }];
  });
  return [...configured, ...loaded.filter(group => !consumedSourceIds.has(group.id))];
}

export function AnalysisPlatform() {
  const inputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<WorkspaceTab>("import");
  const [groups, setGroups] = useState<ExperimentGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>("combined");
  const [pendingConfig, setPendingConfig] = useState<AnalysisConfig | null>(null);
  const [configNotice, setConfigNotice] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState("");
  const [runs, setRuns] = useState<Record<string, TaskRun>>({});
  const [dashboardMode, setDashboardMode] = useState<"task1" | "task2" | "bidirectional">("task1");
  const [sourceFilter, setSourceFilter] = useState("全部来源");
  const [emotionFilter, setEmotionFilter] = useState("全部情绪");
  const [colorFilter, setColorFilter] = useState("全部颜色");
  const [publicationExporting, setPublicationExporting] = useState(false);

  const activeGroup = groups.find(group => group.id === activeGroupId) || groups[0];
  const sheet = activeGroup?.sheets.find(item => item.name === activeGroup.sheetName);
  const enabledGroups = useMemo(() => groups.filter(group => group.enabled), [groups]);
  const analysisGroups = useMemo(() => analysisScope === "combined" ? enabledGroups : activeGroup ? [activeGroup] : [], [analysisScope, enabledGroups, activeGroup]);
  const selectedColumns = useMemo(() => analysisGroups.length ? [...new Set(["_analysis_group", "_analysis_cohort", ...analysisGroups.flatMap(group => group.selectedColumns)])] : [], [analysisGroups]);
  const selectedRows = useMemo(() => {
    return analysisGroups.flatMap(group => configuredRows(group));
  }, [analysisGroups]);
  const activeRows = useMemo(() => configuredRows(activeGroup), [activeGroup]);
  const activeRangeRows = useMemo(() => rangeRows(activeGroup), [activeGroup]);
  const activeQuality = useMemo(() => inspectRowQuality(activeRangeRows.map(item => item.row), activeGroup?.selectedColumns || []), [activeRangeRows, activeGroup?.selectedColumns]);
  const activeQualityByRow = useMemo(() => activeQuality.map((quality, index) => ({ ...quality, row: activeRangeRows[index]?.rowNumber || quality.row })), [activeQuality, activeRangeRows]);
  const activeHiddenRows = useMemo(() => {
    if (!activeGroup || !sheet) return [];
    return sheet.hiddenRows.filter(row => row >= activeGroup.rowStart && row <= activeGroup.rowEnd);
  }, [activeGroup, sheet]);
  const activeUnrelatedRows = activeQualityByRow.filter(row => !row.related).map(row => row.row);
  const activeIncompleteTask1 = activeQualityByRow.filter(row => row.related && row.task1ExpectedColors > 0 && !row.completeTask1).length;
  const activeIncompleteTask2 = activeQualityByRow.filter(row => row.related && row.task2ExpectedCells > 0 && !row.completeTask2).length;
  const fileName = groups.length
    ? analysisScope === "combined"
      ? `${enabledGroups.length}组实验_合并分析`
      : activeGroup?.label || "单组分析"
    : "";
  const parsedGroups = useMemo(() => analysisGroups.map(group => {
    const rows = configuredRows(group);
    const parseColumns = ["_analysis_group", "_analysis_cohort", ...group.selectedColumns];
    const detection = detectDataset(rows, parseColumns);
    return {
      group,
      rows,
      detection,
      colors: parseColorRows(rows, parseColumns, detection.schema),
      gew: parseGewRows(rows, parseColumns),
    };
  }), [analysisGroups]);
  const detection = useMemo(() => mergeDetections(parsedGroups.map(item => ({ label: item.group.label, detection: item.detection }))), [parsedGroups]);
  const colorData = useMemo(() => ({
    rows: parsedGroups.flatMap(item => item.colors.rows),
    rejected: parsedGroups.reduce((sum, item) => sum + item.colors.rejected, 0),
  }), [parsedGroups]);
  const gewData = useMemo(() => ({
    rows: parsedGroups.flatMap(item => item.gew.rows),
    sourceRows: parsedGroups.reduce((sum, item) => sum + item.gew.sourceRows, 0),
    invalidCells: parsedGroups.reduce((sum, item) => sum + item.gew.invalidCells, 0),
  }), [parsedGroups]);
  const gewDescription = useMemo(() => runGewDescriptive(gewData.rows).rows, [gewData.rows]);
  const bidirectionalData = useMemo(() => runBidirectionalConsistency(colorData.rows, gewData.rows), [colorData.rows, gewData.rows]);
  const activeColumnRecommendation = useMemo(() => sheet ? columnRecommendation(sheet.rows, sheet.columns) : null, [sheet]);

  const sources = useMemo(() => [...new Set(dashboardMode === "task1"
    ? colorData.rows.map(row => row.source)
    : dashboardMode === "task2"
      ? gewData.rows.map(row => row.source)
      : bidirectionalData.rows.map(row => String(row["来源"] || "")))].filter(Boolean), [dashboardMode, colorData.rows, gewData.rows, bidirectionalData.rows]);
  const emotions = useMemo(() => [...new Set(dashboardMode === "task1"
    ? colorData.rows.map(row => row.emotion)
    : dashboardMode === "task2"
      ? gewData.rows.map(row => row.emotion)
      : bidirectionalData.rows.map(row => String(row["情绪"] || "")))].filter(Boolean), [dashboardMode, colorData.rows, gewData.rows, bidirectionalData.rows]);
  const colors = useMemo(() => [...new Set(gewData.rows.map(row => row.color))], [gewData.rows]);
  const dashboardColors = colorData.rows.filter(row => (sourceFilter === "全部来源" || row.source === sourceFilter) && (emotionFilter === "全部情绪" || row.emotion === emotionFilter));
  const dashboardGew = gewDescription.filter(row => (sourceFilter === "全部来源" || row["来源"] === sourceFilter) && (emotionFilter === "全部情绪" || row["情绪"] === emotionFilter) && (colorFilter === "全部颜色" || row["颜色"] === colorFilter));
  const dashboardGewRaw = gewData.rows.filter(row => (sourceFilter === "全部来源" || row.source === sourceFilter) && (colorFilter === "全部颜色" || row.color === colorFilter));
  const dashboardBidirectional = bidirectionalData.rows.filter(row => (sourceFilter === "全部来源" || row["来源"] === sourceFilter) && (emotionFilter === "全部情绪" || row["情绪"] === emotionFilter));

  async function loadFiles(fileList?: FileList | File[]) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setLoadingFile(true); setFileError("");
    try {
      const XLSX = await import("xlsx"); const incoming: ExperimentGroup[] = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const workbook = file.name.toLowerCase().endsWith(".csv")
          ? XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string", cellDates: true, cellStyles: true })
          : XLSX.read(buffer, { type: "array", cellDates: true, cellStyles: true });
        const parsed: SheetData[] = [];
        workbook.SheetNames.forEach(name => {
          const worksheet = workbook.Sheets[name];
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: true }) as DataRow[];
          const rows = rawRows.map(row => ({ _source_file: file.name.replace(/\.[^.]+$/, ""), ...row }));
          const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
          const rowMetadata = (worksheet as unknown as { "!rows"?: Array<{ hidden?: boolean }> })["!rows"] || [];
          const hiddenRows = rowMetadata.flatMap((metadata, index) => index > 0 && metadata?.hidden ? [index] : []);
          if (rows.length) parsed.push({ name, rows, columns, hiddenRows });
        });
        if (!parsed.length) continue;
        const first = parsed[0];
        incoming.push({
          id: createId(String(incoming.length)),
          label: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          sheets: parsed,
          sheetName: first.name,
          selectedColumns: first.columns,
          rowStart: 1,
          rowEnd: first.rows.length,
          enabled: true,
          cohort: "unspecified",
          excludedRows: [],
        });
      }
      if (!incoming.length) throw new Error("所选文件中没有可读取的数据行。");
      setGroups(current => {
        const loaded = [...current, ...incoming];
        return pendingConfig ? applyAnalysisConfig(loaded, pendingConfig) : loaded;
      });
      setActiveGroupId(incoming[0].id);
      setAnalysisScope(current => groups.length || incoming.length > 1 ? "combined" : current);
      if (pendingConfig) {
        const missing = pendingConfig.groups.map(group => group.fileName).filter(name => ![...groups, ...incoming].some(group => group.fileName === name));
        setConfigNotice(missing.length ? `配置已部分套用；还需导入：${[...new Set(missing)].join("、")}` : "配置已自动套用到已导入的数据文件。");
        if (!missing.length) {
          setAnalysisScope(pendingConfig.analysisScope);
          setPendingConfig(null);
        }
      }
      setRuns({});
    } catch (error) { setFileError(error instanceof Error ? error.message : "无法读取该文件，请检查格式。"); }
    finally { setLoadingFile(false); }
  }

  function updateGroup(id: string, update: (group: ExperimentGroup) => ExperimentGroup) {
    setGroups(current => current.map(group => group.id === id ? update(group) : group));
    setRuns({});
  }

  function changeSheet(name: string) {
    if (!activeGroup) return;
    const next = activeGroup.sheets.find(item => item.name === name); if (!next) return;
    updateGroup(activeGroup.id, group => ({ ...group, sheetName: name, selectedColumns: next.columns, rowStart: 1, rowEnd: next.rows.length, excludedRows: [] }));
  }

  function removeGroup(id: string) {
    setGroups(current => {
      const next = current.filter(group => group.id !== id);
      if (activeGroupId === id) setActiveGroupId(next[0]?.id || "");
      return next;
    });
    setRuns({});
  }

  function duplicateGroup(id: string) {
    const source = groups.find(group => group.id === id);
    if (!source) return;
    const duplicate = {
      ...source,
      id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-copy`,
      label: `${source.label} · 副本`,
    };
    setGroups(current => [...current, duplicate]);
    setActiveGroupId(duplicate.id);
    setRuns({});
  }

  function clearGroups() {
    setGroups([]); setActiveGroupId(""); setRuns({}); setFileError("");
  }

  function selectAllColumns() {
    if (activeGroup && sheet) updateGroup(activeGroup.id, group => ({ ...group, selectedColumns: sheet.columns }));
  }

  function toggleColumn(column: string) {
    if (!activeGroup) return;
    updateGroup(activeGroup.id, group => ({ ...group, selectedColumns: group.selectedColumns.includes(column) ? group.selectedColumns.filter(item => item !== column) : [...group.selectedColumns, column] }));
  }

  function selectGroup(id: string) {
    setActiveGroupId(id);
    if (analysisScope === "active") setRuns({});
  }

  function keepRelevantColumnsForCurrentGroup() {
    if (!activeGroup || !sheet || !activeColumnRecommendation) return;
    if (activeColumnRecommendation.schema === "unknown") {
      setConfigNotice(`“${activeGroup.label}”的数据结构尚未确认；为避免误删，只排除了 ${activeColumnRecommendation.exclude.length} 个整列为空字段。`);
    } else {
      setConfigNotice(`“${activeGroup.label}”已智能保留 ${activeColumnRecommendation.keep.length} 个分析字段，排除 ${activeColumnRecommendation.exclude.length} 个无关或空字段；可随时点击“恢复当前全部列”。`);
    }
    updateGroup(activeGroup.id, group => ({ ...group, selectedColumns: activeColumnRecommendation.keep }));
  }

  function keepRelevantColumnsForAllGroups() {
    let excluded = 0, unknown = 0;
    const next = groups.map(group => {
      const targetSheet = group.sheets.find(item => item.name === group.sheetName);
      if (!targetSheet) return group;
      const recommendation = columnRecommendation(targetSheet.rows, targetSheet.columns);
      excluded += recommendation.exclude.length;
      if (recommendation.schema === "unknown") unknown += 1;
      return { ...group, selectedColumns: recommendation.keep };
    });
    setGroups(next);
    setRuns({});
    setConfigNotice(`已处理 ${groups.length} 个实验组，共排除 ${excluded} 个无关或空字段${unknown ? `；其中 ${unknown} 组结构未确认，仅排除整列为空字段` : ""}。`);
  }

  function excludeUnrelatedRows() {
    if (!activeGroup) return;
    const rows = [...new Set([...activeHiddenRows, ...activeUnrelatedRows])].sort((a, b) => a - b);
    updateGroup(activeGroup.id, group => ({ ...group, excludedRows: [...new Set([...group.excludedRows, ...rows])].sort((a, b) => a - b) }));
    setConfigNotice(rows.length ? `已排除 ${rows.length} 行：仅包含 Excel 隐藏行或与两项实验均无关的行；相关但不完整的数据没有自动删除。` : "当前范围没有发现隐藏行或与实验无关的行。");
  }

  function restoreExcludedRows() {
    if (!activeGroup) return;
    updateGroup(activeGroup.id, group => ({ ...group, excludedRows: [] }));
    setConfigNotice("已恢复当前组的全部数据行。");
  }

  function exportConfig() {
    const config = buildAnalysisConfig(groups, analysisScope);
    download(`${safeFileName(fileName || "chromalab")}_analysis-config.json`, JSON.stringify(config, null, 2), "application/json;charset=utf-8");
  }

  async function importConfig(file?: File) {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Partial<AnalysisConfig>;
      if (raw.kind !== "chromalab-analysis-config" || raw.version !== 1 || !Array.isArray(raw.groups)) throw new Error("不是有效的 Chromalab v1 分析配置。");
      const config: AnalysisConfig = {
        kind: "chromalab-analysis-config",
        version: 1,
        exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : new Date().toISOString(),
        analysisScope: raw.analysisScope === "active" ? "active" : "combined",
        groups: raw.groups.filter(Boolean).map(saved => ({
          fileName: String(saved.fileName || ""),
          label: String(saved.label || saved.fileName || "实验组"),
          cohort: (saved.cohort === "human" || saved.cohort === "ai" ? saved.cohort : "unspecified") as Cohort,
          sheetName: String(saved.sheetName || ""),
          selectedColumns: Array.isArray(saved.selectedColumns) ? saved.selectedColumns.map(String) : [],
          rowStart: Math.max(1, Number(saved.rowStart) || 1),
          rowEnd: Math.max(1, Number(saved.rowEnd) || 1),
          enabled: saved.enabled !== false,
          excludedRows: Array.isArray(saved.excludedRows) ? saved.excludedRows.map(Number).filter(Number.isFinite) : [],
        })).filter(saved => saved.fileName),
      };
      if (!config.groups.length) throw new Error("配置中没有可用的实验组。");
      const missing = config.groups.map(group => group.fileName).filter(name => !groups.some(group => group.fileName === name));
      if (groups.length) {
        const applied = applyAnalysisConfig(groups, config);
        setGroups(applied);
        setActiveGroupId(applied[0]?.id || "");
        setAnalysisScope(config.analysisScope);
        setRuns({});
      }
      if (missing.length || !groups.length) {
        setPendingConfig(config);
        setConfigNotice(`配置已读取。请导入原数据文件：${[...new Set(missing.length ? missing : config.groups.map(group => group.fileName))].join("、")}；文件到齐后会自动套用。`);
      } else {
        setPendingConfig(null);
        setConfigNotice("配置已完整套用；工作表、行列范围、组类型和清洗记录均已恢复。");
      }
    } catch (error) {
      setConfigNotice(error instanceof Error ? `配置导入失败：${error.message}` : "配置导入失败。");
    }
  }

  function calculateTask(id: string): AnalysisResult {
    let result: AnalysisResult;
    if (id === "task1-normalize") {
      const mismatches = colorData.rows.filter(row => row.consistencyDeltaE !== null && row.consistencyDeltaE > 2.3).length;
      const inputFormats = [...new Set(colorData.rows.map(row => row.inputFormat))];
      result = resultFromRows(id, "色彩格式标准化", colorRowsToExport(colorData.rows), [{ label: "有效色彩", value: String(colorData.rows.length) }, { label: "拒绝值", value: String(colorData.rejected) }, { label: "多格式不一致", value: String(mismatches) }, { label: "权威输入格式", value: inputFormats.join(" + ") || "—" }], "历史宽表以 HSL 为权威输入：HSL → 浮点 sRGB(D65) → CIELAB/HSV；HEX 只做一致性核验。长表按 HSL、RGB、HEX、HSV、Lab 的可用性选择单一权威路径。ΔE76 > 2.3 的多格式记录会被标记，但不会静默删除。");
    }
    else if (id === "task1-summary") result = runColorSummary(colorData.rows, colorData.rejected);
    else if (id === "task1-hsv") result = runHsvDistribution(colorData.rows);
    else if (id === "task1-cluster") result = runColorClustering(colorData.rows);
    else if (id === "task1-within-delta") result = runWithinGroupDelta(colorData.rows);
    else if (id === "task1-delta") result = runDeltaE(colorData.rows);
    else if (id === "task1-bias") result = runCulturalBias(colorData.rows);
    else if (id === "task1-diversity") result = runColorDiversity(colorData.rows);
    else if (id === "task1-hue-jsd") result = runHueDistributionDistance(colorData.rows);
    else if (id === "task1-human-ai") result = runHumanAiColorAlignment(colorData.rows);
    else if (id === "task1-cohort-test") result = runHumanAiColorCohortTest(colorData.rows);
    else if (id === "task2-qc") result = runGewQc(gewData);
    else if (id === "task2-descriptive") result = runGewDescriptive(gewData.rows);
    else if (id === "task2-omnibus") result = runGewOmnibus(gewData.rows);
    else if (id === "task2-pairwise") result = runGewPairwise(gewData.rows);
    else if (id === "task2-jsd") result = runGewJsd(gewData.rows);
    else if (id === "task2-valence") result = runGewValenceProfile(gewData.rows);
    else if (id === "task2-concentration") result = runGewConcentration(gewData.rows);
    else if (id === "task2-indicators") result = runGewCompositeIndicators(gewData.rows);
    else if (id === "task2-pattern") result = runGewPatternSimilarity(gewData.rows);
    else if (id === "task2-human-ai") result = runHumanAiGewAlignment(gewData.rows);
    else if (id === "task2-cohort-test") result = runHumanAiGewCohortTest(gewData.rows);
    else if (id === "task-cross-groups") result = runBidirectionalGroupComparison(bidirectionalData.rows);
    else result = bidirectionalData;
    if (!result.rows.length) throw new Error("当前选择范围没有产生有效结果，请检查字段和行列范围。");
    return result;
  }

  async function runTask(id: string) {
    setRuns(current => ({ ...current, [id]: { status: "running" } }));
    await new Promise(resolve => window.setTimeout(resolve, 80));
    try {
      const result = calculateTask(id);
      setRuns(current => ({ ...current, [id]: { status: "completed", result } }));
    } catch (error) { setRuns(current => ({ ...current, [id]: { status: "error", error: error instanceof Error ? error.message : "分析失败" } })); }
  }

  function taskAvailable(id: string) {
    const task1 = colorData.rows.length > 0;
    const task2 = gewData.rows.length > 0;
    const colorSources = new Set(colorData.rows.map(row => row.source)).size;
    const gewSources = new Set(gewData.rows.map(row => row.source)).size;
    if (["task1-delta", "task1-hue-jsd"].includes(id)) return task1 && colorSources >= 2;
    if (id === "task1-bias") return task1 && new Set(colorData.rows.map(row => row.source)).size >= 3;
    if (id === "task1-human-ai") return task1 && colorData.rows.some(row => row.cohort === "human") && colorData.rows.some(row => row.cohort === "ai");
    if (id === "task1-cohort-test") return task1 && new Set(colorData.rows.filter(row => row.cohort === "human").map(row => row.source)).size >= 2 && new Set(colorData.rows.filter(row => row.cohort === "ai").map(row => row.source)).size >= 2;
    if (["task2-omnibus", "task2-pairwise", "task2-jsd", "task2-pattern"].includes(id)) return task2 && gewSources >= 2;
    if (id === "task2-human-ai") return task2 && gewData.rows.some(row => row.cohort === "human") && gewData.rows.some(row => row.cohort === "ai");
    if (id === "task2-cohort-test") return task2 && new Set(gewData.rows.filter(row => row.cohort === "human").map(row => row.source)).size >= 2 && new Set(gewData.rows.filter(row => row.cohort === "ai").map(row => row.source)).size >= 2;
    if (id === "task-cross-groups") return new Set(bidirectionalData.rows.map(row => row["来源"])).size >= 2;
    if (id === "task-cross-bidirectional") return bidirectionalData.rows.length > 0;
    return id.startsWith("task1") ? task1 : task2;
  }

  function taskUnavailableReason(id: string) {
    const task1 = colorData.rows.length > 0;
    const task2 = gewData.rows.length > 0;
    const colorSources = new Set(colorData.rows.map(row => row.source)).size;
    const gewSources = new Set(gewData.rows.map(row => row.source)).size;
    if (id.startsWith("task1") && !task1) return "当前范围没有有效的实验一词选色色彩数据。";
    if (id.startsWith("task2") && !task2) return "当前范围没有有效的实验二情绪轮数据。";
    if (["task1-delta", "task1-hue-jsd"].includes(id) && colorSources < 2) return "至少需要 2 个实验一来源。";
    if (id === "task1-bias" && colorSources < 3) return "至少需要 3 个实验一来源。";
    if (id === "task1-human-ai" && !colorData.rows.some(row => row.cohort === "human")) return "至少需要 1 个人类实验一来源。";
    if (id === "task1-human-ai" && !colorData.rows.some(row => row.cohort === "ai")) return "至少需要 1 个 AI 实验一来源。";
    if (id === "task1-cohort-test") return "至少需要 2 个人类来源和 2 个 AI 来源。";
    if (["task2-omnibus", "task2-pairwise", "task2-jsd", "task2-pattern"].includes(id) && gewSources < 2) return "至少需要 2 个实验二来源。";
    if (id === "task2-human-ai" && !gewData.rows.some(row => row.cohort === "human")) return "至少需要 1 个人类实验二来源。";
    if (id === "task2-human-ai" && !gewData.rows.some(row => row.cohort === "ai")) return "至少需要 1 个 AI 实验二来源。";
    if (id === "task2-cohort-test") return "至少需要 2 个人类来源和 2 个 AI 来源。";
    if (id === "task-cross-groups") return "至少需要 2 个可完成双向匹配的来源。";
    if (id === "task-cross-bidirectional") return "当前范围没有可完成双向匹配的数据。";
    return "当前数据不满足该分析的运行条件。";
  }

  function exportResult(result: AnalysisResult) { download(`${fileName.replace(/\.[^.]+$/, "") || "analysis"}_${result.id}.csv`, toCsv(result.rows)); }
  async function exportAllResults() {
    const completed = Object.values(runs).flatMap(run => run.result ? [run.result] : []);
    if (!completed.length) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    completed.forEach(result => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(result.rows), result.id.slice(0, 31)));
    const manifest = analysisGroups.map(group => {
      const groupSheet = group.sheets.find(item => item.name === group.sheetName);
      const groupDetection = detectDataset(configuredRows(group), group.selectedColumns);
      return {
        实验组: group.label,
        组类型: group.cohort,
        文件: group.fileName,
        工作表: group.sheetName,
        起始行: group.rowStart,
        结束行: group.rowEnd,
        有效行数: configuredRows(group).length,
        清洗排除行数: group.excludedRows.length,
        选中列数: group.selectedColumns.length,
        数据结构: groupDetection.schemaLabel,
        色彩格式: groupDetection.formats.join(" + "),
        原始工作表行数: groupSheet?.rows.length || 0,
      };
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(manifest), "analysis_manifest");
    XLSX.writeFile(workbook, `${safeFileName(fileName)}_全部分析结果.xlsx`, { compression: true });
  }

  async function exportInteractiveReport() {
    if (!analysisGroups.length) return;
    const availableTasks = TASKS.filter(task => taskAvailable(task.id));
    const completed: AnalysisResult[] = [];
    const failures = new Map<string, string>();
    const nextRuns: Record<string, TaskRun> = {};
    setConfigNotice(`正在计算 ${availableTasks.length} 项适用分析并生成完整交互报告…`);
    for (const task of availableTasks) {
      setRuns(current => ({ ...current, [task.id]: { status: "running" } }));
      await new Promise(resolve => window.setTimeout(resolve, 0));
      try {
        const result = calculateTask(task.id);
        completed.push(result);
        nextRuns[task.id] = { status: "completed", result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "分析失败";
        failures.set(task.id, message);
        nextRuns[task.id] = { status: "error", error: message };
      }
    }
    setRuns(current => ({ ...current, ...nextRuns }));
    const generatedAt = new Date().toISOString();
    const html = buildInteractiveHtmlReport({
      title: `${fileName || "Chromalab"} · 交互式数据报告`,
      generatedAt,
      scopeLabel: analysisScope === "combined" ? "合并已启用实验组" : activeGroup?.label || "当前实验组",
      schemaLabel: detection.schemaLabel,
      groups: analysisGroups.map(group => ({
        label: group.label,
        cohort: group.cohort,
        fileName: group.fileName,
        sheetName: group.sheetName,
        rowCount: configuredRows(group).length,
      })),
      methods: TASKS.map(task => {
        const result = completed.find(item => item.id === task.id);
        const failure = failures.get(task.id);
        return {
          ...task,
          status: result ? "included" as const : failure ? "error" as const : "not-applicable" as const,
          resultRows: result?.rows.length || 0,
          reason: failure || (!taskAvailable(task.id) ? taskUnavailableReason(task.id) : undefined),
        };
      }),
      colors: colorData.rows,
      gew: gewDescription,
      bidirectional: bidirectionalData.rows,
      results: completed,
      initialFilters: {
        source: sourceFilter,
        emotion: emotionFilter,
        color: colorFilter,
      },
    });
    download(`${safeFileName(fileName || "chromalab")}_交互式数据报告.html`, html, "text/html;charset=utf-8");
    setConfigNotice(failures.size
      ? `完整交互报告已导出：纳入 ${completed.length} 项分析，${failures.size} 项计算失败并已在目录注明。`
      : `完整交互报告已导出：当前数据适用的 ${completed.length} 项分析已全部纳入。`);
  }

  async function exportPublicationFigures() {
    if (!analysisGroups.length || publicationExporting) return;
    setPublicationExporting(true);
    setConfigNotice("正在准备论文标准图表，请保持当前页面开启…");

    const waitForPaint = () => new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    const files: Record<string, Uint8Array> = {};
    const manifest: ExportRow[] = [];
    const counters = { A: 0, B: 0, C: 0 };
    let completed = 0;
    let failed = 0;
    let firstCaptureError = "";

    try {
      await waitForPaint();
      const stage = document.getElementById("publication-export-stage");
      if (!stage) throw new Error("图表导出区未能完成加载，请重试。");

      const capture = async (group: keyof typeof counters, module: string, title: string, element?: HTMLElement | null) => {
        counters[group] += 1;
        const figureId = `${group}${String(counters[group]).padStart(2, "0")}`;
        const file = `${group === "A" ? "实验一_词选色" : group === "B" ? "实验二_情绪轮" : "双向整合"}/${figureId}_${safeFileName(title)}.png`;
        if (!element) {
          failed += 1;
          manifest.push({ 图号: figureId, 模块: module, 图表: title, 状态: "未生成", 文件: "", 说明: "当前数据没有对应的可绘制结果。" });
          return;
        }
        try {
          const blob = await elementToPngBlob(element, {
            minimumWidth: 1_200,
            minimumHeight: 720,
            background: "#ffffff",
            publicationMode: true,
          });
          files[`figures/${file}`] = new Uint8Array(await blob.arrayBuffer());
          completed += 1;
          manifest.push({ 图号: figureId, 模块: module, 图表: title, 状态: "已生成", 文件: `figures/${file}`, 说明: "白底高分辨率 PNG；交互控件已冻结为当前参数。" });
          setConfigNotice(`正在生成论文图表：已完成 ${completed} 张 · ${figureId} ${title}`);
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : "未知错误";
          if (!firstCaptureError) firstCaptureError = `${figureId} ${title}：${message}`;
          manifest.push({ 图号: figureId, 模块: module, 图表: title, 状态: "生成失败", 文件: "", 说明: message });
        }
        await new Promise(resolve => window.setTimeout(resolve, 0));
      };

      const task1Root = stage.querySelector<HTMLElement>('[data-publication-group="task1"]');
      const task1Select = task1Root?.querySelector<HTMLSelectElement>(".visual-lab-controls select");
      if (task1Root && task1Select) {
        const charts = Array.from(task1Select.options).map(option => ({ value: option.value, label: option.text }));
        for (const chart of charts) {
          const select = task1Root.querySelector<HTMLSelectElement>(".visual-lab-controls select");
          if (!select) continue;
          select.value = chart.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await waitForPaint();
          await capture("A", "实验一 · 词选色", chart.label, task1Root.querySelector<HTMLElement>(".visual-stage"));
        }
      }

      const task2Root = stage.querySelector<HTMLElement>('[data-publication-group="task2"]');
      if (task2Root) {
        const blocks = Array.from(task2Root.querySelectorAll<HTMLElement>(".gew-view-block"));
        for (const block of blocks) {
          const title = block.querySelector("h4")?.textContent?.trim() || "实验二分析图";
          await capture("B", "实验二 · 情绪轮", title, block);
        }
        const dotsButton = Array.from(task2Root.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("气泡点阵"));
        if (dotsButton) {
          dotsButton.click();
          await waitForPaint();
          const dotBlock = Array.from(task2Root.querySelectorAll<HTMLElement>(".gew-view-block")).find(block => block.querySelector("h4")?.textContent?.includes("气泡点阵"));
          await capture("B", "实验二 · 情绪轮", "各来源颜色—情绪气泡点阵", dotBlock);
        }
      }

      const bidirectionalRoot = stage.querySelector<HTMLElement>('[data-publication-group="bidirectional"]');
      if (bidirectionalRoot) {
        const views = Array.from(bidirectionalRoot.querySelectorAll<HTMLButtonElement>(".visual-tabs button")).map(button => button.textContent?.trim() || "双向分析图");
        for (const title of views) {
          const button = Array.from(bidirectionalRoot.querySelectorAll<HTMLButtonElement>(".visual-tabs button")).find(item => item.textContent?.trim() === title);
          button?.click();
          await waitForPaint();
          await capture("C", "双向整合", title, bidirectionalRoot.querySelector<HTMLElement>(".bidirectional-canvas"));
        }
      }

      if (!completed) throw new Error(firstCaptureError ? `所有图表生成失败；首个错误为 ${firstCaptureError}` : "当前范围没有可导出的分析图表。");
      const { zipSync, strToU8 } = await import("fflate");
      files["图表目录.csv"] = strToU8(toCsv(manifest));
      files["README_论文插图说明.txt"] = strToU8([
        "Chromalab 论文标准图表归档",
        `生成时间：${new Date().toISOString()}`,
        `分析范围：${analysisScope === "combined" ? "合并已启用实验组" : activeGroup?.label || "当前实验组"}`,
        `实验组：${analysisGroups.map(group => `${group.label}(${group.cohort})`).join("、")}`,
        `成功图表：${completed} 张`,
        `未生成或失败：${failed} 张`,
        "",
        "输出规范",
        "- 单图独立 PNG，白色背景，至少 1200 px 版心并以 2× 像素密度渲染（受浏览器最大画布限制时自动安全缩放）。",
        "- 图中交互下拉框已转换为静态参数标签；不包含网页按钮、API Key 或模型访问凭证。",
        "- A/B/C 分别代表实验一、实验二和双向整合；图号可直接用于论文图注与补充材料索引。",
        "- 参数化图表采用当前分析范围的默认来源、颜色、情绪或指标；具体值显示在图中或图表目录中。",
        "- PNG 本身按像素保存；排版时可在 Word、LaTeX 或期刊系统中按目标尺寸设为 300 dpi。",
        "",
        "请结合图表目录.csv核对图号、标题、生成状态和文件位置。",
      ].join("\n"));
      downloadBlob(
        `${safeFileName(fileName || "chromalab")}_全部论文图表PNG.zip`,
        new Blob([zipSync(files, { level: 1 })], { type: "application/zip" }),
      );
      setConfigNotice(`论文图表归档已导出：${completed} 张 PNG${failed ? `，另有 ${failed} 张未生成并已写入目录` : "，全部成功"}。`);
    } catch (error) {
      setConfigNotice(error instanceof Error ? `论文图表导出失败：${error.message}` : "论文图表导出失败。");
    } finally {
      setPublicationExporting(false);
    }
  }

  async function exportArchive() {
    if (!analysisGroups.length) return;
    const [{ zipSync, strToU8 }, XLSX] = await Promise.all([import("fflate"), import("xlsx")]);
    const completed = Object.values(runs).flatMap(run => run.result ? [run.result] : []);
    const config = buildAnalysisConfig(groups, analysisScope);
    const files: Record<string, Uint8Array> = {};
    const cleaningAudit: ExportRow[] = [];
    const columnAudit: ExportRow[] = [];

    analysisGroups.forEach((group, groupIndex) => {
      const rawItems = rangeRows(group);
      const quality = inspectRowQuality(rawItems.map(item => item.row), group.selectedColumns);
      const targetSheet = group.sheets.find(item => item.name === group.sheetName);
      const hidden = new Set(targetSheet?.hiddenRows || []);
      const excluded = new Set(group.excludedRows);
      const recommendation = targetSheet ? columnRecommendation(targetSheet.rows, targetSheet.columns) : null;
      rawItems.forEach((item, index) => {
        const rowQuality = quality[index];
        cleaningAudit.push({
          实验组: group.label,
          组类型: group.cohort,
          文件: group.fileName,
          工作表: group.sheetName,
          数据行: item.rowNumber,
          Excel隐藏行: hidden.has(item.rowNumber),
          与实验有关: rowQuality?.related ?? false,
          实验一有效色彩: rowQuality?.task1ValidColors ?? 0,
          实验一预期色彩: rowQuality?.task1ExpectedColors ?? 0,
          实验一完整: rowQuality?.completeTask1 ?? false,
          实验二有效单元格: rowQuality?.task2ValidCells ?? 0,
          实验二预期单元格: rowQuality?.task2ExpectedCells ?? 0,
          实验二完整: rowQuality?.completeTask2 ?? false,
          已排除: excluded.has(item.rowNumber),
          排除原因: excluded.has(item.rowNumber) ? hidden.has(item.rowNumber) ? "Excel隐藏行" : rowQuality && !rowQuality.related ? "与两项实验均无关" : "用户配置排除" : "",
        });
      });
      targetSheet?.columns.forEach(column => columnAudit.push({
        实验组: group.label,
        文件: group.fileName,
        工作表: group.sheetName,
        字段: column,
        当前纳入分析: group.selectedColumns.includes(column),
        智能筛列建议: recommendation?.keep.includes(column) ?? true,
        字段角色: recommendation?.roles[column] || "未分类",
      }));
      const groupPath = `${String(groupIndex + 1).padStart(2, "0")}_${safeFileName(group.label)}`;
      files[`raw-selected/${groupPath}.csv`] = strToU8(toCsv(dataRowsToExport(configuredRows(group))));
    });

    files["analysis-config.json"] = strToU8(JSON.stringify(config, null, 2));
    files["cleaning/cleaning-audit.csv"] = strToU8(toCsv(cleaningAudit));
    files["cleaning/column-audit.csv"] = strToU8(toCsv(columnAudit));
    files["processed/task1-colors-normalized.csv"] = strToU8(toCsv(colorRowsToExport(colorData.rows)));
    files["processed/task2-gew-qc-long.csv"] = strToU8(toCsv(gewRowsToExport(gewData.rows)));
    completed.forEach(result => {
      const task = TASKS.find(item => item.id === result.id);
      files[`results/${result.id}.csv`] = strToU8(toCsv(result.rows));
      files[`results/${result.id}.method.json`] = strToU8(JSON.stringify({
        taskId: result.id,
        title: result.title,
        analysisSpace: task?.space || null,
        output: task?.output || null,
        summary: result.summary,
        note: result.note || null,
        resultRows: result.rows.length,
        generatedAt: new Date().toISOString(),
      }, null, 2));
    });
    const methodManifest: ExportRow[] = TASKS.map(task => ({
      任务ID: task.id,
      分析: task.title,
      实验: task.group,
      分析空间或统计量: task.space,
      输出: task.output,
      当前可运行: taskAvailable(task.id),
      状态: runs[task.id]?.status || "idle",
      结果行数: runs[task.id]?.result?.rows.length || 0,
    }));
    files["results/method-manifest.csv"] = strToU8(toCsv(methodManifest));

    const workbook = XLSX.utils.book_new();
    completed.forEach(result => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(result.rows), result.id.slice(0, 31)));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cleaningAudit), "cleaning_audit");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(columnAudit), "column_audit");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(methodManifest), "method_manifest");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analysisGroups.map(group => ({
      实验组: group.label,
      组类型: group.cohort,
      文件: group.fileName,
      工作表: group.sheetName,
      范围: `${group.rowStart}–${group.rowEnd}`,
      清洗后行数: configuredRows(group).length,
      排除行数: group.excludedRows.length,
      选中列数: group.selectedColumns.length,
    }))), "analysis_manifest");
    const workbookArray = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
    files["results/all-results.xlsx"] = new Uint8Array(workbookArray);

    const readme = [
      "Chromalab 实验数据分析归档",
      `生成时间：${new Date().toISOString()}`,
      `分析范围：${analysisScope === "combined" ? "合并已启用实验组" : "仅当前实验组"}`,
      `实验组：${analysisGroups.map(group => `${group.label}(${group.cohort})`).join("、")}`,
      "",
      "目录说明",
      "- raw-selected/: 依据工作表、行范围、字段列和排除规则整理后的输入数据。",
      "- cleaning/: 每一原始数据行与字段列的保留、完整度及排除原因审计。",
      "- processed/: 实验一标准色彩长表与实验二 GEW QC 长表。",
      "- results/: 已完成分析的独立 CSV、方法 JSON、方法清单和统一 XLSX。",
      "- analysis-config.json: 可再次导入平台恢复本次设置，不含 API Key。",
      "",
      "实验一色彩链路",
      "历史宽表 HSL(H 0–360, S/L 0–100) 为权威输入；先转浮点 sRGB(D65)，再生成 CIELAB 与 HSV。HEX 作为一致性核验。",
      "H–S 与 V–S 使用 sRGB→HSV（H 为角度，S/V 为 0–1）；K-means、组内/跨来源色差及偏置使用 CIELAB D65 与 CIE76。",
      "多格式 ΔE76 > 2.3 只标记不自动删除；相关但不完整的实验行也不会被一键清洗静默删除。",
      "",
      `完成分析：${completed.length ? completed.map(result => `${result.id} ${result.title}`).join("；") : "尚未运行分析任务，归档仍包含清洗、配置和标准化数据。"}`,
    ].join("\n");
    files["README.txt"] = strToU8(readme);

    const archive = zipSync(files, { level: 6 });
    downloadBlob(`${safeFileName(fileName)}_Chromalab完整归档.zip`, new Blob([archive.slice().buffer as ArrayBuffer], { type: "application/zip" }));
  }
  function resetDashboardFilters(mode: "task1" | "task2" | "bidirectional") { setDashboardMode(mode); setSourceFilter("全部来源"); setEmotionFilter("全部情绪"); setColorFilter("全部颜色"); }

  const selectedTaskCount = TASKS.filter(task => taskAvailable(task.id)).length;
  const completeCount = Object.values(runs).filter(run => run.status === "completed").length;

  return <>
    <div className="analysis-page-title">
      <div><span className="eyebrow">步骤 07 / 07 · ANALYSIS WORKBENCH</span><h1>实验数据分析平台</h1><p>导入实验数据，确认字段与色彩格式，逐项运行可复现分析，并在筛选大屏中比较来源、情绪与颜色。</p></div>
      <div className="analysis-privacy"><span>⌁</span><p><b>浏览器本地分析</b><small>上传数据默认不离开当前设备</small></p></div>
    </div>

    <nav className="analysis-tabs" aria-label="分析工作区">
      {([["import", "01", "数据导入"], ["tasks", "02", "分析任务"], ["dashboard", "03", "数据大屏"]] as const).map(([id, number, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{number}</span><b>{label}</b>{id === "tasks" && completeCount ? <i>{completeCount}</i> : null}</button>)}
    </nav>

    {tab === "import" ? <section className="analysis-import-layout">
      <div className="analysis-main-column">
        <section className={`analysis-dropzone ${groups.length ? "loaded" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void loadFiles(event.dataTransfer.files); }}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" multiple onChange={event => { void loadFiles(event.target.files || undefined); event.currentTarget.value = ""; }} />
          <div className="drop-icon">{loadingFile ? "···" : groups.length ? "+" : "↑"}</div>
          <div><span className="eyebrow">批量数据源</span><h2>{groups.length ? `已导入 ${groups.length} 组实验` : "一次上传多组实验数据"}</h2><p>{groups.length ? "可继续追加文件；每组独立保存工作表、行范围与字段列，不会覆盖前面的配置。" : "支持同时选择或拖入多个 CSV / XLS / XLSX；每个文件建立一组独立分析配置。"}</p></div>
          <button className="secondary" onClick={() => inputRef.current?.click()} disabled={loadingFile}>{groups.length ? "继续添加" : "选择多个文件"}</button>
        </section>
        {fileError ? <div className="analysis-alert error"><b>导入失败</b><span>{fileError}</span></div> : null}
        <section className="analysis-config-toolbar panel">
          <input ref={configInputRef} type="file" accept=".json,application/json" onChange={event => { void importConfig(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <div><span className="eyebrow">可复现实验设置</span><h3>分析配置一键迁移</h3><p>保存工作表、行列范围、组类型、启用状态和清洗记录；配置不包含原始数据或 API Key。</p></div>
          <div className="config-actions"><button className="secondary" onClick={() => configInputRef.current?.click()}>导入配置 JSON</button><button className="secondary" disabled={!groups.length} onClick={exportConfig}>导出配置 JSON</button><button className="secondary" disabled={!analysisGroups.length} onClick={exportInteractiveReport}>导出交互式 HTML ↓</button><button className="secondary" disabled={!analysisGroups.length || publicationExporting} onClick={() => void exportPublicationFigures()}>{publicationExporting ? "正在生成图表…" : "一键导出全部图表 PNG.zip ↓"}</button><button className="primary" disabled={!analysisGroups.length} onClick={() => void exportArchive()}>一键导出归档 ZIP ↓</button></div>
        </section>
        {configNotice ? <div className="analysis-alert info"><b>配置 / 清洗记录</b><span>{configNotice}</span></div> : null}

        {groups.length ? <section className="analysis-batch-manager panel">
          <div className="panel-head"><div><h3>实验组队列</h3><p>勾选要纳入合并比较的组；同一文件需分析多个工作表时，先“复制”再分别设置。</p></div><div className="batch-head-actions"><span className="analysis-count">{enabledGroups.length} / {groups.length} 组已启用</span><button onClick={keepRelevantColumnsForAllGroups}>全部组智能筛列</button><button onClick={clearGroups}>清空全部</button></div></div>
          <div className="analysis-scope-switch" role="group" aria-label="分析范围">
            <button className={analysisScope === "combined" ? "active" : ""} onClick={() => { setAnalysisScope("combined"); setRuns({}); }}><b>合并已启用组</b><span>用于跨模型、跨批次统计比较</span></button>
            <button className={analysisScope === "active" ? "active" : ""} onClick={() => { setAnalysisScope("active"); setRuns({}); }}><b>仅当前设置组</b><span>用于检查或单独分析一组</span></button>
          </div>
          <div className="analysis-group-list">{groups.map(group => {
            const groupSheet = group.sheets.find(item => item.name === group.sheetName);
            const groupRows = configuredRows(group);
            const groupDetection = detectDataset(groupRows, group.selectedColumns);
            return <article key={group.id} className={`${group.id === activeGroup?.id ? "active" : ""} ${group.enabled ? "" : "disabled"}`}>
              <label className="group-enabled" title="纳入合并分析"><input type="checkbox" checked={group.enabled} onChange={event => updateGroup(group.id, current => ({ ...current, enabled: event.target.checked }))} /><span /></label>
              <div className="group-copy"><input aria-label="实验组名称" value={group.label} onChange={event => updateGroup(group.id, current => ({ ...current, label: event.target.value || current.label }))} /><small>{group.fileName} · {group.sheetName}</small><label className="group-cohort">对象类型<select value={group.cohort} onChange={event => updateGroup(group.id, current => ({ ...current, cohort: event.target.value as Cohort }))}><option value="unspecified">未指定</option><option value="human">人类</option><option value="ai">AI</option></select></label></div>
              <div className="group-schema"><b>{groupDetection.schemaLabel}</b><span>{groupRows.length} 行 × {group.selectedColumns.length} 列</span></div>
              <div className="group-actions"><button className={group.id === activeGroup?.id ? "active" : ""} onClick={() => selectGroup(group.id)}>{group.id === activeGroup?.id ? "设置中" : "设置"}</button><button onClick={() => duplicateGroup(group.id)}>复制</button><button className="danger" onClick={() => removeGroup(group.id)}>移除</button></div>
              <i className={groupDetection.schema === "unknown" || !groupSheet ? "warn" : "pass"}>{groupDetection.schema === "unknown" || !groupSheet ? "!" : "✓"}</i>
            </article>;
          })}</div>
          <div className="batch-summary"><span><b>{analysisGroups.length}</b> 个分析组</span><span><b>{selectedRows.length.toLocaleString()}</b> 行进入当前分析</span><span><b>{new Set(analysisGroups.flatMap(group => group.sheets.map(item => item.name))).size}</b> 个已选工作表</span></div>
        </section> : null}

        {sheet && activeGroup ? <>
          <section className="analysis-selection panel">
            <div className="panel-head"><div><h3>配置当前组 · {activeGroup.label}</h3><p>这里的工作表、数据行和字段列只作用于当前实验组。</p></div><span className="analysis-count">{activeRows.length} 行 × {activeGroup.selectedColumns.length} 列</span></div>
            <div className="analysis-range-controls">
              <label>工作表<select value={activeGroup.sheetName} onChange={event => changeSheet(event.target.value)}>{activeGroup.sheets.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
              <label>起始数据行<input type="number" min="1" max={sheet.rows.length} value={activeGroup.rowStart} onChange={event => updateGroup(activeGroup.id, group => ({ ...group, rowStart: Math.min(group.rowEnd, Math.max(1, Number(event.target.value))) }))} /></label>
              <label>结束数据行<input type="number" min={activeGroup.rowStart} max={sheet.rows.length} value={activeGroup.rowEnd} onChange={event => updateGroup(activeGroup.id, group => ({ ...group, rowEnd: Math.min(sheet.rows.length, Math.max(group.rowStart, Number(event.target.value))) }))} /></label>
            </div>
            <div className="analysis-cleaning">
              <div><span className="eyebrow">一键清洗 · 保守规则</span><b>{activeHiddenRows.length} 个隐藏行 · {activeUnrelatedRows.length} 个无关行 · 已排除 {activeGroup.excludedRows.length} 行</b><p>仅自动排除 Excel 隐藏行和与实验一、实验二均无有效字段的行。相关但不完整的行只报告：实验一 {activeIncompleteTask1} 行，实验二 {activeIncompleteTask2} 行。</p></div>
              <div><button className="primary" onClick={excludeUnrelatedRows}>一键筛除无关/隐藏行</button><button className="secondary" disabled={!activeGroup.excludedRows.length} onClick={restoreExcludedRows}>恢复全部行</button></div>
            </div>
            <div className="analysis-column-head"><div><span className="eyebrow">参与分析的列</span><b>{activeGroup.selectedColumns.length} / {sheet.columns.length} · 建议排除 {activeColumnRecommendation?.exclude.length || 0} 列</b></div><div><button className="recommended" onClick={keepRelevantColumnsForCurrentGroup}>一键筛去无关列</button><button onClick={selectAllColumns}>恢复当前全部列</button><button onClick={() => updateGroup(activeGroup.id, group => ({ ...group, selectedColumns: [] }))}>清空</button></div></div>
            <div className="analysis-column-grid">{sheet.columns.map(column => <label key={column} className={activeGroup.selectedColumns.includes(column) ? "selected" : ""}><input type="checkbox" checked={activeGroup.selectedColumns.includes(column)} onChange={() => toggleColumn(column)} /><span>{column}</span></label>)}</div>
          </section>

          <section className="analysis-preview panel">
            <div className="panel-head"><div><h3>当前组预览</h3><p>显示 {activeGroup.label} 所选范围的前 6 行；分析时按上方范围组合。</p></div><button className="primary" disabled={!selectedRows.length || !selectedColumns.length} onClick={() => setTab("tasks")}>分析 {analysisGroups.length} 组数据 <span>→</span></button></div>
            <div className="analysis-table-scroll"><table><thead><tr><th>#</th>{activeGroup.selectedColumns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{activeRows.slice(0, 6).map((row, index) => <tr key={index}><td>{activeGroup.rowStart + index}</td>{activeGroup.selectedColumns.map(column => <td key={column}>{typeof row[column] === "object" && row[column] !== null ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
          </section>
        </> : null}
      </div>

      <aside className="analysis-detection panel">
        <div className="panel-head"><div><span className="eyebrow">范围自动预检</span><h3>{analysisScope === "combined" ? `${analysisGroups.length} 组汇总结构` : "当前组结构"}</h3></div><span className={`detection-score ${detection.schema === "unknown" ? "warn" : "pass"}`}>{Math.round(detection.confidence * 100)}%</span></div>
        <div className="detection-hero"><span>{detection.schema === "mixed" ? "A+B" : detection.schema === "task2-gew" ? "GEW" : detection.schema.startsWith("task1") ? "W→C" : "?"}</span><div><small>数据结构</small><b>{detection.schemaLabel}</b></div></div>
        <div className="format-section"><span className="eyebrow">识别到的色彩格式</span>{detection.formats.length ? <div>{detection.formats.map(format => <b key={format}>{format}</b>)}</div> : <p>任务二使用固定色码，或当前列中未识别到颜色通道。</p>}</div>
        <div className="detection-list">{detection.evidence.map((item, index) => <p key={index}><i>✓</i><span>{item}</span></p>)}{detection.warnings.map((item, index) => <p className="warning" key={index}><i>!</i><span>{item}</span></p>)}</div>
        <div className="detection-foot"><b>解析预估</b><span>{detection.schema === "mixed" ? `任务一 ${colorData.rows.length} 个色彩 · 任务二 ${gewData.rows.length} 行网格` : detection.schema.startsWith("task1") ? `${colorData.rows.length} 个有效色彩 · ${colorData.rejected} 个拒绝值` : detection.schema === "task2-gew" ? `${gewData.rows.length} 行完整网格 · ${gewData.invalidCells} 个无效 JSON` : "等待匹配字段"}</span></div>
      </aside>
    </section> : null}

    {tab === "tasks" ? <section className="analysis-task-workspace">
      <div className="analysis-status-strip batch"><div><span className="eyebrow">当前分析范围</span><b>{analysisScope === "combined" ? `${analysisGroups.length} 组实验合并比较` : activeGroup?.label || "尚未选择实验组"}</b><small>{detection.schemaLabel} · {selectedRows.length} 行 × {selectedColumns.length} 列</small></div><div><strong>{analysisGroups.length}</strong><span>个实验组</span></div><div><strong>{selectedTaskCount}</strong><span>项可运行</span></div><div><strong>{completeCount}</strong><span>项已完成</span></div><div className="analysis-batch-actions"><button className="secondary" onClick={() => setTab("import")}>调整数据范围</button><button className="primary" disabled={!selectedTaskCount || Object.values(runs).some(run => run.status === "running")} onClick={() => void Promise.all(TASKS.filter(task => taskAvailable(task.id)).map(task => runTask(task.id)))}>运行全部可用分析</button><button className="secondary" disabled={!completeCount} onClick={() => void exportAllResults()}>导出全部结果 XLSX ↓</button><button className="secondary" disabled={!analysisGroups.length} onClick={exportInteractiveReport}>导出交互 HTML ↓</button><button className="secondary" disabled={!analysisGroups.length || publicationExporting} onClick={() => void exportPublicationFigures()}>{publicationExporting ? "正在生成图表…" : "全部论文图表 PNG.zip ↓"}</button><button className="secondary archive" disabled={!analysisGroups.length} onClick={() => void exportArchive()}>一键导出归档 ZIP ↓</button></div></div>
      <section className="color-pipeline-audit panel">
        <div className="pipeline-title"><span className="eyebrow">词选色 · 色彩格式链路审计</span><h2>分析 1–7 使用固定、可追溯的转换路径</h2><p>已按历史 Bias_OriginalData.py 与 hsvplot.py 对齐，避免把 HSL 的 L 与 CIELAB 的 L* 混用。</p></div>
        <div className="pipeline-flow"><div><span>原始宽表</span><b>HSL 为权威</b><small>H 0–360 · S/L 0–100<br />HEX 仅核验</small></div><i>→</i><div><span>统一底层</span><b>浮点 sRGB</b><small>D65 白点<br />Lab 前不舍入</small></div><i>→</i><div><span>图形分析</span><b>HSV</b><small>H–S / V–S<br />H° · S/V 0–1</small></div><i>+</i><div><span>统计分析</span><b>CIELAB</b><small>K-means / ΔE / 偏置<br />D65 · CIE76</small></div></div>
        <div className="pipeline-checks"><span>当前权威输入：{[...new Set(colorData.rows.map(row => row.inputFormat))].join(" + ") || "等待数据"}</span><span className={colorData.rows.some(row => row.consistencyDeltaE !== null && row.consistencyDeltaE > 2.3) ? "warn" : "pass"}>多格式 ΔE76 &gt; 2.3：{colorData.rows.filter(row => row.consistencyDeltaE !== null && row.consistencyDeltaE > 2.3).length}</span></div>
        <div className="pipeline-matrix">
          <div><b>01 标准化</b><span>原始 HSL / HEX / RGB / HSV / Lab</span><i>→</i><strong>统一色彩长表</strong></div>
          <div><b>02 描述</b><span>统一 HSL + Lab</span><i>→</i><strong>亮度、饱和度、质心</strong></div>
          <div><b>03 H–S / V–S</b><span>统一浮点 sRGB</span><i>→</i><strong>HSV（H°，S/V 0–1）</strong></div>
          <div><b>04 聚类</b><span>统一 CIELAB D65</span><i>→</i><strong>K=2–5 + 轮廓系数</strong></div>
          <div><b>05 组内一致性</b><span>统一 CIELAB D65</span><i>→</i><strong>ΔE76</strong></div>
          <div><b>06 跨来源色差</b><span>统一 CIELAB D65</span><i>→</i><strong>对称最近邻 ΔE76</strong></div>
          <div><b>07 文化偏置</b><span>第 06 项距离口径</span><i>→</i><strong>参照差值</strong></div>
        </div>
        <p className="pipeline-assurance">即使按 1 → 7 依次点击，每个单元也都从同一份未舍入的标准化内存数据读取，不会把上一项导出的 HSL、HSV 或 Lab 表再次误解析。</p>
      </section>
      {(["实验一", "实验二", "双向整合"] as const).map(group => <section className="analysis-task-group" key={group}><div className="analysis-section-label"><span>{group === "实验一" ? "A" : group === "实验二" ? "B" : "C"}</span><div><h2>{group === "实验一" ? "词选色分析" : group === "实验二" ? "日内瓦情绪轮分析" : "双向关联整合"}</h2><p>{group === "实验一" ? "前 7 项延续历史脚本口径，另加分布、多样性、对齐与 4×4 来源级精确置换检验。" : group === "实验二" ? "以8个试验组为独立比较单位，覆盖全部28个组对；同时保留关联概率、条件强度、0–5分布、220维模式与Bootstrap区间。" : "同一组同时包含词选色和色选词时启用；8组独立展示并比较全部28个组对，人类/AI只作为标签，不在默认分析中合并。"}</p></div></div><div className="analysis-task-grid">{TASKS.filter(task => task.group.startsWith(group)).map((task, index) => {
        const available = taskAvailable(task.id), run = runs[task.id] || { status: "idle" as const };
        return <article key={task.id} className={`analysis-task-card ${available ? "available" : "disabled"} ${run.status}`}>
          <div className="task-card-top"><span>{String(index + 1).padStart(2, "0")}{task.group.includes("扩展") ? <small>扩展</small> : task.group.includes("推断") ? <small>推断</small> : task.group.includes("探索") ? <small>探索</small> : null}</span><em className={`run-state ${run.status}`}>{run.status === "running" ? "运行中" : run.status === "completed" ? "已完成" : run.status === "error" ? "需检查" : available ? "可运行" : "不适用"}</em></div>
          <h3>{task.title}</h3><p>{task.description}</p><div className="task-space">{task.space}</div><div className="task-output"><span>输出</span><b>{task.output}</b></div>
          {run.result ? <><div className="task-result-metrics">{run.result.summary.slice(0, 3).map(item => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div><ResultPreview result={run.result} /></> : null}
          {run.error ? <div className="task-error">{run.error}</div> : null}
          <div className="task-actions"><button className="primary" disabled={!available || run.status === "running"} onClick={() => void runTask(task.id)}>{run.status === "running" ? "正在计算…" : run.status === "completed" ? "重新运行" : "启动分析"}</button><button className="secondary" disabled={!run.result} onClick={() => run.result && exportResult(run.result)}>导出 CSV ↓</button></div>
        </article>;
      })}</div></section>)}
    </section> : null}

    {tab === "dashboard" ? <section className="analysis-dashboard">
      <div className="dashboard-hero"><div><span className="eyebrow">INTERACTIVE OVERVIEW</span><h2>情绪 × 色彩数据大屏</h2><p>筛选条件会同时作用于指标、图表和大屏导出；不会改动原始数据或分析任务结果。</p></div><div className="dashboard-export-actions"><button className="secondary" disabled={dashboardMode === "task1" ? !dashboardColors.length : dashboardMode === "task2" ? !dashboardGew.length : !dashboardBidirectional.length} onClick={() => download(`${fileName || "dashboard"}_${dashboardMode}_filtered.csv`, toCsv((dashboardMode === "task1" ? colorRowsToExport(dashboardColors) : dashboardMode === "task2" ? dashboardGew : dashboardBidirectional) as ExportRow[]))}>导出当前视图 CSV ↓</button><button className="secondary" disabled={!analysisGroups.length} onClick={exportInteractiveReport}>导出交互式 HTML ↓</button><button className="primary" disabled={!analysisGroups.length || publicationExporting} onClick={() => void exportPublicationFigures()}>{publicationExporting ? "正在生成…" : "一键导出全部论文图表 ↓"}</button></div></div>
      <div className="dashboard-toolbar panel">
        <div className="dashboard-mode"><button className={dashboardMode === "task1" ? "active" : ""} onClick={() => resetDashboardFilters("task1")}>实验一 · 词选色</button><button className={dashboardMode === "task2" ? "active" : ""} onClick={() => resetDashboardFilters("task2")}>实验二 · 情绪轮</button><button className={dashboardMode === "bidirectional" ? "active" : ""} onClick={() => resetDashboardFilters("bidirectional")}>双向整合 · 探索</button></div>
        <label>来源<select value={sources.includes(sourceFilter) ? sourceFilter : "全部来源"} onChange={event => setSourceFilter(event.target.value)}><option>全部来源</option>{sources.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>情绪<select value={emotions.includes(emotionFilter) ? emotionFilter : "全部情绪"} onChange={event => setEmotionFilter(event.target.value)}><option>全部情绪</option>{emotions.map(value => <option key={value}>{value}</option>)}</select></label>
        {dashboardMode === "task2" ? <label>颜色<select value={colors.includes(colorFilter) ? colorFilter : "全部颜色"} onChange={event => setColorFilter(event.target.value)}><option>全部颜色</option>{colors.map(value => <option key={value}>{value}</option>)}</select></label> : null}
      </div>

      {dashboardMode === "task1"
        ? <Task1Dashboard rows={dashboardColors} fileName={fileName} />
        : dashboardMode === "task2"
          ? <Task2Dashboard rawRows={dashboardGewRaw} visibleEmotion={emotionFilter === "全部情绪" ? undefined : emotionFilter} fileName={fileName} />
          : <BidirectionalVisualLab rows={dashboardBidirectional} />}
    </section> : null}
    {publicationExporting ? <div className="publication-export-stage" id="publication-export-stage" aria-hidden="true">
      {colorData.rows.length ? <div data-publication-group="task1"><Task1VisualLab rows={colorData.rows} fileName={fileName} /></div> : null}
      {gewData.rows.length ? <div data-publication-group="task2"><Task2VisualLab data={gewData.rows} fileName={fileName} /></div> : null}
      {bidirectionalData.rows.length ? <div data-publication-group="bidirectional"><BidirectionalVisualLab rows={bidirectionalData.rows} /></div> : null}
    </div> : null}
  </>;
}

function ResultPreview({ result }: { result: AnalysisResult }) {
  const columns = Object.keys(result.rows[0] || {}).slice(0, 4);
  return <details className="task-preview"><summary>预览结果 · {result.rows.length} 行</summary><div><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.slice(0, 3).map((row, index) => <tr key={index}>{columns.map(column => <td key={column}>{column.toLowerCase().includes("hex") ? <><i className="tiny-swatch" style={{ background: String(row[column]) }} />{String(row[column])}</> : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>{result.note ? <p>{result.note}</p> : null}</div></details>;
}

function Task1Dashboard({ rows, fileName }: { rows: ReturnType<typeof parseColorRows>["rows"]; fileName: string }) {
  const average = (key: "s" | "l" | "labL") => rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
  return <>
    <div className="dashboard-kpis"><article><span>有效色彩</span><strong>{rows.length.toLocaleString()}</strong><small>当前筛选范围</small></article><article><span>来源数</span><strong>{new Set(rows.map(row => row.source)).size}</strong><small>模型 / 文化组</small></article><article><span>平均饱和度</span><strong>{(average("s") * 100).toFixed(1)}%</strong><small>HSL S</small></article><article><span>平均明度</span><strong>{average("labL").toFixed(1)}</strong><small>CIE Lab L*</small></article></div>
    <Task1VisualLab rows={rows} fileName={fileName} />
  </>;
}

function Task2Dashboard({ rawRows, visibleEmotion, fileName }: { rawRows: GewRow[]; visibleEmotion?: string; fileName: string }) {
  const sources = new Set(rawRows.map(row => row.source));
  const humanSources = new Set(rawRows.filter(row => row.cohort === "human").map(row => row.source));
  const aiSources = new Set(rawRows.filter(row => row.cohort === "ai").map(row => row.source));
  const pairwiseRows = sources.size >= 2 ? runGewPairwise(rawRows).rows : [];
  const significantPairs = pairwiseRows.filter(row => row["FDR_q值"] !== null && Number(row["FDR_q值"]) < .05).length;
  return <>
    <div className="dashboard-kpis"><article><span>独立试验组</span><strong>{sources.size}</strong><small>{humanSources.size}个人类组 + {aiSources.size}个AI组</small></article><article><span>全部组对</span><strong>{sources.size * (sources.size - 1) / 2}</strong><small>8组时共28个两两比较</small></article><article><span>组对×分析单元</span><strong>{pairwiseRows.length.toLocaleString()}</strong><small>颜色×情绪×来源对</small></article><article><span>选择率显著组对单元</span><strong>{pairwiseRows.length ? significantPairs : "—"}</strong><small>全部两两检验统一 BH-FDR</small></article></div>
    <Task2VisualLab data={rawRows} visibleEmotion={visibleEmotion} fileName={fileName} />
  </>;
}
