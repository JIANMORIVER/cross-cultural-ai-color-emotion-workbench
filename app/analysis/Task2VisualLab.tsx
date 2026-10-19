"use client";

import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, runGewCompositeIndicators, runGewJsd, runGewPairwise, runGewPatternSimilarity, runGewPsiAiHumanSignificance, toCsv, type AnalysisResult, type ExportRow, type GewRow } from "./engine";
import { FigureExportControls, type FigureExportStyle } from "./FigureExportControls";
import { FigureSourceSelector, normalizeFigureSources, orderFigureRows, readFigurePairingMode, readFigureSourceSelection, saveFigurePairingMode, saveFigureSourceSelection, type FigurePairingMode } from "./FigureSourceSelector";
import { downloadFigureBlob, renderPublicationFigure } from "./python-figures";

type GewMetric = "probability" | "conditional" | "overall";
type CompositeMetric = "broadness" | "intensity" | "valence";
type GewCell = {
  source: string;
  color: string;
  emotion: string;
  n: number;
  selected: number;
  probability: number;
  conditional: number | null;
  overall: number;
};

export type Task2VisualLabProps = { data: GewRow[] | AnalysisResult; fileName?: string; visibleEmotion?: string; pairingMode?: "all" | "cross-cohort" };

const Task2FigureExportContext = createContext<{
  safeName: string;
  style: FigureExportStyle;
  disabled: boolean;
  exportView: (index: string, name: string) => void;
  availableSources: string[];
  sourcesFor: (index: string) => string[];
  setSourcesFor: (index: string, sources: string[]) => void;
  pairingFor: (index: string) => FigurePairingMode;
  setPairingFor: (index: string, mode: FigurePairingMode) => void;
} | null>(null);

const METRICS: Record<GewMetric, { label: string; maximum: number }> = {
  probability: { label: "关联概率", maximum: 1 },
  conditional: { label: "条件强度", maximum: 5 },
  overall: { label: "综合平均分", maximum: 5 },
};
const SERIES = ["#277b92", "#d47d55", "#4f8a70", "#8d6b94", "#b9973b", "#5675a7", "#b45d6b", "#657c82"];
const RATING_COLORS = ["#e5e7e5", "#3157c7", "#38b764", "#efd63f", "#e98632", "#d3312f"];
const COMPOSITE_METRICS: Record<CompositeMetric, { label: string; mean: string; low: string; high: string; minimum: number; maximum: number }> = {
  broadness: { label: "情绪广度", mean: "平均情绪广度", low: "广度95CI下限", high: "广度95CI上限", minimum: 0, maximum: 20 },
  intensity: { label: "条件强度", mean: "平均条件强度", low: "条件强度95CI下限", high: "条件强度95CI上限", minimum: 1, maximum: 5 },
  valence: { label: "效价偏向", mean: "平均效价偏向", low: "效价偏向95CI下限", high: "效价偏向95CI上限", minimum: -1, maximum: 1 },
};
const JSD_FIGURES = ["10", "11", "12", "13"];

function numberOf(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}
function normalizeGew(data: GewRow[] | AnalysisResult): GewCell[] {
  if (!Array.isArray(data)) {
    return data.rows.map(row => {
      const selected = numberOf(row["选择次数"]);
      return {
        source: String(row["来源"] ?? ""),
        color: String(row["颜色"] ?? ""),
        emotion: String(row["情绪"] ?? ""),
        n: numberOf(row["N"]),
        selected,
        probability: numberOf(row["选择率"]),
        conditional: selected > 0 ? numberOf(row["平均强度_已选择"]) : null,
        overall: numberOf(row["平均强度_全部"]),
      };
    }).filter(cell => cell.source && cell.color && cell.emotion);
  }

  const groups = new Map<string, { n: number; selected: number; selectedIntensity: number; totalIntensity: number }>();
  data.filter(row => row.valid).forEach(row => {
    const key = `${row.source}\u0000${row.color}\u0000${row.emotion}`;
    const group = groups.get(key) || { n: 0, selected: 0, selectedIntensity: 0, totalIntensity: 0 };
    const selected = row.selected > 0 ? 1 : 0;
    group.n += 1;
    group.selected += selected;
    group.totalIntensity += numberOf(row.intensity);
    if (selected) group.selectedIntensity += numberOf(row.intensity);
    groups.set(key, group);
  });

  return [...groups.entries()].map(([key, group]) => {
    const [source, color, emotion] = key.split("\u0000");
    return {
      source, color, emotion, n: group.n, selected: group.selected,
      probability: group.selected / Math.max(1, group.n),
      conditional: group.selected ? group.selectedIntensity / group.selected : null,
      overall: group.totalIntensity / Math.max(1, group.n),
    };
  });
}

function keyOf(source: string, color: string, emotion: string) {
  return `${source}\u0000${color}\u0000${emotion}`;
}
function valueOf(cell: GewCell | undefined, metric: GewMetric) {
  if (!cell) return null;
  return metric === "conditional" ? cell.conditional : cell[metric];
}
function shown(value: number | null, metric: GewMetric) {
  if (value === null || !Number.isFinite(value)) return "—";
  return metric === "probability" ? `${Math.round(value * 100)}%` : value.toFixed(2);
}
function exportRows(cells: GewCell[]): ExportRow[] {
  return cells.map(cell => ({
    来源: cell.source, 颜色: cell.color, 情绪: cell.emotion, N: cell.n, 选择次数: cell.selected,
    关联概率: Number(cell.probability.toFixed(6)),
    条件强度: cell.conditional === null ? null : Number(cell.conditional.toFixed(6)),
    综合平均分: Number(cell.overall.toFixed(6)),
  }));
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

type JsdPair = { sourceA: string; sourceB: string; label: string; block?: string };
type JsdViewData = {
  humanSources: string[];
  aiSources: string[];
  humanPairs: JsdPair[];
  aiPairs: JsdPair[];
  aiHumanPairs: JsdPair[];
  humanRows: ExportRow[];
  aiRows: ExportRow[];
  aiHumanRows: ExportRow[];
  meanRows: ExportRow[];
  missingCount: number;
  scaleMaximum: number;
};

function sourceToken(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function canonicalSource(value: string) {
  const token = sourceToken(value);
  if (token === "cn" || token.includes("china")) return "CN";
  if (token === "bw") return "BW";
  if (token === "uk") return "UK";
  if (token === "us" || token === "usa") return "US";
  if (token.includes("deepseek")) return "DeepSeek";
  if (token.includes("doubao")) return "Doubao";
  if (token === "gpt" || token.includes("openai")) return "GPT";
  if (token.includes("gemini")) return "Gemini";
  return value;
}
function orderedSourcesForJsd(sources: string[], desired: string[]) {
  const available = [...sources], ordered: string[] = [];
  desired.forEach(name => {
    const match = available.find(source => canonicalSource(source).toLowerCase() === name.toLowerCase());
    if (match && !ordered.includes(match)) ordered.push(match);
  });
  return [...ordered, ...available.filter(source => !ordered.includes(source)).sort((a, b) => a.localeCompare(b))];
}
function jsdValue(rows: ExportRow[], sourceA: string, sourceB: string, color: string) {
  const row = rows.find(item => item["颜色"] === color && ((item["来源A"] === sourceA && item["来源B"] === sourceB) || (item["来源A"] === sourceB && item["来源B"] === sourceA)));
  return optionalNumber(row?.["Jensen_Shannon距离"]);
}
function jsdCsvRows(rows: ExportRow[], pairs: JsdPair[]) {
  return pairs.flatMap(pair => GEW_COLOURS.map(color => {
    const row = rows.find(item => item["颜色"] === color && ((item["来源A"] === pair.sourceA && item["来源B"] === pair.sourceB) || (item["来源A"] === pair.sourceB && item["来源B"] === pair.sourceA)));
    return { pair: pair.label, source_a: pair.sourceA, source_b: pair.sourceB, color, jsd: optionalNumber(row?.["Jensen_Shannon距离"]), status: String(row?.["计算状态"] || "missing_pair") } as ExportRow;
  }));
}
function buildJsdViewData(rows: ExportRow[], sourceCohorts: Map<string, GewRow["cohort"]>): JsdViewData {
  const allSources = [...new Set(rows.flatMap(row => [String(row["来源A"] || ""), String(row["来源B"] || "")]))].filter(Boolean);
  const humanCandidates = allSources.filter(source => sourceCohorts.get(source) === "human" || ["CN", "BW", "UK", "US"].includes(canonicalSource(source)));
  const aiCandidates = allSources.filter(source => sourceCohorts.get(source) === "ai" || ["DeepSeek", "Doubao", "GPT", "Gemini"].includes(canonicalSource(source)));
  const humanSources = orderedSourcesForJsd(humanCandidates, ["CN", "BW", "UK", "US"]).slice(0, 4);
  const aiSources = orderedSourcesForJsd(aiCandidates, ["DeepSeek", "Doubao", "GPT", "Gemini"]).slice(0, 4);
  const pairsWithin = (ordered: string[]) => ordered.flatMap((sourceA, index) => ordered.slice(index + 1).map(sourceB => ({ sourceA, sourceB, label: `${canonicalSource(sourceA)}–${canonicalSource(sourceB)}` })));
  const humanPairs = pairsWithin(humanSources), aiPairs = pairsWithin(aiSources);
  const aiForCross = orderedSourcesForJsd(aiSources, ["Doubao", "DeepSeek", "GPT", "Gemini"]);
  const humanForCross = orderedSourcesForJsd(humanSources, ["UK", "US", "CN", "BW"]);
  const aiHumanPairs = aiForCross.flatMap(sourceA => humanForCross.map(sourceB => ({ sourceA, sourceB, label: `${canonicalSource(sourceA)}–${canonicalSource(sourceB)}`, block: canonicalSource(sourceA) })));
  const humanRows = jsdCsvRows(rows, humanPairs), aiRows = jsdCsvRows(rows, aiPairs), aiHumanRows = jsdCsvRows(rows, aiHumanPairs);
  const meanRows = aiForCross.flatMap(aiSource => humanForCross.map(humanSource => {
    const values = GEW_COLOURS.map(color => jsdValue(rows, aiSource, humanSource, color)).filter((value): value is number => value !== null);
    return { ai_source: aiSource, human_source: humanSource, mean_jsd: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6)) : null, valid_colors: values.length } as ExportRow;
  }));
  const observed = rows.map(row => optionalNumber(row["Jensen_Shannon距离"])).filter((value): value is number => value !== null);
  return { humanSources, aiSources, humanPairs, aiPairs, aiHumanPairs, humanRows, aiRows, aiHumanRows, meanRows, missingCount: rows.length - observed.length, scaleMaximum: Math.max(.01, ...observed) };
}
export function Task2VisualLab({ data, fileName = "task2-gew", visibleEmotion, pairingMode = "all" }: Task2VisualLabProps) {
  const allCells = useMemo(() => normalizeGew(data), [data]);
  const cells = useMemo(() => visibleEmotion ? allCells.filter(cell => cell.emotion === visibleEmotion) : allCells, [allCells, visibleEmotion]);
  const rawRows = useMemo(() => Array.isArray(data) ? data.filter(row => row.valid) : [], [data]);
  const visibleRawRows = useMemo(() => visibleEmotion ? rawRows.filter(row => row.emotion === visibleEmotion) : rawRows, [rawRows, visibleEmotion]);
  const composite = useMemo(() => rawRows.length ? runGewCompositeIndicators(rawRows, 200).rows : [], [rawRows]);
  const pattern = useMemo(() => new Set(rawRows.map(row => row.color)).size >= GEW_COLOURS.length ? runGewPatternSimilarity(rawRows, 0).rows : [], [rawRows]);
  const sourceCohorts = useMemo(() => new Map(rawRows.map(row => [row.source, row.cohort])), [rawRows]);
  const pairwise = useMemo(() => new Set(rawRows.map(row => row.source)).size >= 2 ? runGewPairwise(rawRows).rows : [], [rawRows]);
  const jsdRows = useMemo(() => new Set(rawRows.map(row => row.source)).size >= 2 ? runGewJsd(rawRows).rows : [], [rawRows]);
  const sources = useMemo(() => [...new Set(cells.map(cell => cell.source))], [cells]);
  const [figureSources, setFigureSources] = useState<Record<string, string[]>>({});
  const [figurePairing, setFigurePairing] = useState<Record<string, FigurePairingMode>>({});
  const sourcesFor = (index: string) => normalizeFigureSources(sources, figureSources[index]);
  const setSourcesFor = (index: string, next: string[]) => { saveFigureSourceSelection(`task2:${index}`, next); setFigureSources(current => ({ ...current, [index]: next })); };
  const pairingFor = (index: string) => figurePairing[index] || pairingMode;
  const setPairingFor = (index: string, mode: FigurePairingMode) => { saveFigurePairingMode(`task2:${index}`, mode); setFigurePairing(current => ({ ...current, [index]: mode })); };
  useEffect(() => {
    const saved = Object.fromEntries(["01", "02", "03", "04", "05", "06", "07", "08", "09", ...JSD_FIGURES].flatMap(index => {
      const value = readFigureSourceSelection(`task2:${index}`);
      return value ? [[index, value]] : [];
    }));
    if (Object.keys(saved).length) setFigureSources(current => ({ ...saved, ...current }));
    const savedPairing = Object.fromEntries(["01", "02", "03", "04", "05", "06", "07", "08", "09", ...JSD_FIGURES].flatMap(index => {
      const value = readFigurePairingMode(`task2:${index}`);
      return value ? [[index, value]] : [];
    })) as Record<string, FigurePairingMode>;
    if (Object.keys(savedPairing).length) setFigurePairing(current => ({ ...savedPairing, ...current }));
  }, []);
  useEffect(() => { setPsiSignificance(null); setPsiError(""); }, [rawRows]);
  const cellsFor = (index: string) => orderFigureRows(cells, sourcesFor(index), cell => cell.source);
  const rawRowsFor = (index: string) => orderFigureRows(visibleRawRows, sourcesFor(index), row => row.source);
  const colors = useMemo(() => [...new Set(cells.map(cell => cell.color))], [cells]);
  const [heatSource, setHeatSource] = useState(""), [profileSource, setProfileSource] = useState(""), [profileColor, setProfileColor] = useState("");
  const [displayMetric, setDisplayMetric] = useState<GewMetric>("probability");
  const [displayView, setDisplayView] = useState<"dots" | "wheel">("wheel");
  const [psiPermutations, setPsiPermutations] = useState(10_000);
  const [psiSignificance, setPsiSignificance] = useState<AnalysisResult | null>(null);
  const [psiRunning, setPsiRunning] = useState(false);
  const [psiError, setPsiError] = useState("");
  const [cohortMetric, setCohortMetric] = useState<GewMetric>("probability");
  const [groupColor, setGroupColor] = useState(""), [groupEmotion, setGroupEmotion] = useState("");
  const [compositeMetric, setCompositeMetric] = useState<CompositeMetric>("broadness");
  const [profileMetric, setProfileMetric] = useState<GewMetric>("overall"), [differenceA, setDifferenceA] = useState(""), [differenceB, setDifferenceB] = useState("");
  const [differenceMetric, setDifferenceMetric] = useState<GewMetric>("overall");
  const [exportStyle, setExportStyle] = useState<FigureExportStyle>({ columns: 2, width: 4500, scale: 2, showTitle: true, format: "png" });
  const [exporting, setExporting] = useState(false);
  const labRef = useRef<HTMLDivElement>(null);
  const sources07 = sourcesFor("07"), sources08 = sourcesFor("08"), sources09 = sourcesFor("09");
  const effectiveHeat = sources07.includes(heatSource) ? heatSource : (sources07[0] || "");
  const effectiveProfileSource = sources08.includes(profileSource) ? profileSource : (sources08[0] || "");
  const effectiveColor = colors.includes(profileColor) ? profileColor : (colors[0] || "");
  const effectiveA = sources09.includes(differenceA) ? differenceA : (sources09[0] || "");
  const pair09Allowed = (source: string) => source !== effectiveA && (pairingFor("09") === "all" || sourceCohorts.get(source) !== sourceCohorts.get(effectiveA));
  const effectiveB = sources09.includes(differenceB) && pair09Allowed(differenceB) ? differenceB : (sources09.find(pair09Allowed) || "");
  const effectiveGroupColor = colors.includes(groupColor) ? groupColor : (colors[0] || "");
  const visibleEmotions = GEW_EMOTIONS.filter(emotion => cells.some(cell => cell.emotion === emotion));
  const effectiveGroupEmotion = visibleEmotions.includes(groupEmotion as typeof GEW_EMOTIONS[number]) ? groupEmotion : (visibleEmotions[0] || "");
  const safeName = fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, "-");
  const jsdView = useMemo(() => buildJsdViewData(jsdRows, sourceCohorts), [jsdRows, sourceCohorts]);

  const exportOptions = (index: string, format: FigureExportStyle["format"], title: string) => {
    const metric = index === "01" || index === "02" ? cohortMetric
      : index === "08" ? profileMetric
      : index === "09" ? differenceMetric
      : displayMetric;
    return {
      ...exportStyle, format, title, metric,
      selectedColor: index === "08" ? effectiveColor : effectiveGroupColor,
      selectedEmotion: effectiveGroupEmotion,
      selectedSource: index === "08" ? effectiveProfileSource : effectiveHeat,
      sourceA: effectiveA,
      sourceB: effectiveB,
      displayView,
      compositeMetric,
      sourceCohorts: Object.fromEntries(sources.map(source => [source, sourceCohorts.get(source) || "unspecified"])),
    };
  };
  const exportAnalysisData = (index: string) => index === "02" ? pairwise : index === "04" ? composite : index === "03" ? [...pattern, ...(psiSignificance?.rows || [])] : JSD_FIGURES.includes(index) ? jsdRows : [];
  const exportOneView = async (index: string, title: string, format = exportStyle.format) => {
    setExporting(true);
    try {
      const viewSources = sourcesFor(index), viewCells = cellsFor(index), exportRawRows = rawRowsFor(index).map(row => ({ source: row.source, color: row.color, emotion: row.emotion, intensity: row.intensity, valid: row.valid }));
      const blob = await renderPublicationFigure({ scope: "task2", kind: `task2-${index}`, cells: viewCells, rows: index === "06" ? exportRawRows : [], data: exportAnalysisData(index), options: { ...exportOptions(index, format, title), sourceOrder: viewSources, pairingMode: pairingFor(index) } });
      downloadFigureBlob(blob, `${safeName}_${index}_${title.replace(/[^a-zA-Z0-9_-]+/g, "-")}.${format}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "科研图导出失败。");
    } finally { setExporting(false); }
  };
  const exportAllViews = async (format: FigureExportStyle["format"]) => {
    setExporting(true);
    try {
      const { zipSync } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      const figures = ["01", "02", "03", "04", "05", "06", "07", "08", "09", ...JSD_FIGURES];
      for (const index of figures) {
        const viewSources = sourcesFor(index), viewCells = cellsFor(index), exportRawRows = rawRowsFor(index).map(row => ({ source: row.source, color: row.color, emotion: row.emotion, intensity: row.intensity, valid: row.valid }));
        const blob = await renderPublicationFigure({ scope: "task2", kind: `task2-${index}`, cells: viewCells, rows: index === "06" ? exportRawRows : [], data: exportAnalysisData(index), options: { ...exportOptions(index, format, `Color–Emotion Figure ${index}`), sourceOrder: viewSources, pairingMode: pairingFor(index) } });
        files[`Task2_${index}.${format}`] = new Uint8Array(await blob.arrayBuffer());
      }
      downloadFigureBlob(new Blob([zipSync(files, { level: 1 })], { type: "application/zip" }), `${safeName}_task2-publication-figures-${format}.zip`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "科研图批量导出失败。");
    } finally { setExporting(false); }
  };
  const runPsiSignificance = async () => {
    setPsiRunning(true); setPsiError("");
    await new Promise(resolve => window.setTimeout(resolve, 20));
    try {
      setPsiSignificance(runGewPsiAiHumanSignificance(rawRows, psiPermutations, 20260823, 500));
    } catch (error) {
      setPsiSignificance(null); setPsiError(error instanceof Error ? error.message : "PSI显著性检验失败。");
    } finally { setPsiRunning(false); }
  };

  return <Task2FigureExportContext.Provider value={{ safeName, style: exportStyle, disabled: !cells.length || exporting, exportView: (index, name) => void exportOneView(index, name), availableSources: sources, sourcesFor, setSourcesFor, pairingFor, setPairingFor }}><section className="task2-visual-lab visual-lab panel python-paper-view" ref={labRef} style={{ "--figure-columns": exportStyle.columns } as React.CSSProperties}>
    <div className="visual-lab-head"><div><span className="eyebrow">GEW 关系结构精选视图</span><h3>颜色 × 情绪关联画像</h3><p>当前筛选 {cells.length.toLocaleString()} 个统计单元 · {sources.length} 个来源 · {colors.length} 种颜色</p><small className="pairing-scope-note">每幅图可独立选择“全部组对”或“仅人类–AI”；两两矩阵、模式相似性和差值下钻会按各自口径排除组对。</small></div><div className="visual-export"><button className="secondary" disabled={!cells.length} onClick={() => download(`${safeName}_gew-visual-data.csv`, toCsv(exportRows(cells)))}>导出描述数据 CSV</button></div></div>
    <FigureExportControls value={exportStyle} onChange={setExportStyle} onExport={format => void exportAllViews(format)} disabled={!cells.length} busy={exporting} exportLabel="导出全部科研图 ZIP" />
    {!cells.length ? <div className="task2-visual-empty"><span>◎</span><b>当前筛选没有可绘制的 GEW 数据</b><small>请保留来源、颜色、情绪、选择与强度字段。</small></div> : <>
      <article className="gew-view-block emphasis">
        <ViewHead index="01" code="8-GROUP RANKING" title="指定颜色×情绪的八组并列比较" note="4个人类组和4个AI组全部保留为独立比较单位；按当前指标从高到低排列，不计算人类/AI合并均值。"><div className="gew-inline-controls"><Select label="颜色" value={effectiveGroupColor} onChange={setGroupColor} options={colors} /><Select label="情绪" value={effectiveGroupEmotion} onChange={setGroupEmotion} options={visibleEmotions} /><MetricSelect value={cohortMetric} onChange={setCohortMetric} /></div></ViewHead>
        <EightGroupRanking cells={cellsFor("01")} sourceCohorts={new Map(sourcesFor("01").map(source => [source, sourceCohorts.get(source) || "unspecified"]))} color={effectiveGroupColor} emotion={effectiveGroupEmotion} metric={cohortMetric} />
      </article>
      <article className="gew-view-block">
        <ViewHead index="02" code="8 × 8 PAIRWISE" title="指定单元的八组两两差值矩阵" note="矩阵显示行组−列组，覆盖全部28个组对；关联概率中的圆点表示该组对在全部颜色×情绪×来源对检验中 FDR q<.05。"><MetricSelect value={cohortMetric} onChange={setCohortMetric} /></ViewHead>
        <EightGroupPairMatrix cells={cellsFor("02")} pairwise={pairwise.filter(row => sourcesFor("02").includes(String(row["来源A"] || "")) && sourcesFor("02").includes(String(row["来源B"] || "")))} sourceCohorts={new Map(sourcesFor("02").map(source => [source, sourceCohorts.get(source) || "unspecified"]))} color={effectiveGroupColor} emotion={effectiveGroupEmotion} metric={cohortMetric} pairingMode={pairingFor("02")} />
      </article>
      {pattern.length ? <article className="gew-view-block">
        <ViewHead index="03" code="SOURCE × SOURCE" title="完整 11×20 矩阵模式相似性（PSI）" note="PSI点估计与participant/run Bootstrap保持原样；新增检验仅针对16个AI–Human pair，判断正确颜色×情绪语义对齐是否高于结构保持的随机对齐。"><div className="psi-controls"><label>Permutation B<input type="number" min="1" max="50000" step="1000" disabled={psiRunning} value={psiPermutations} onChange={event => setPsiPermutations(Math.max(1, Number(event.target.value)))} /></label><button className="secondary" disabled={psiRunning || rawRows.length === 0} onClick={() => void runPsiSignificance()}>{psiRunning ? `正在运行 ${psiPermutations.toLocaleString()} 次…` : "运行 PSI 显著性检验"}</button>{psiSignificance ? <button className="secondary" onClick={() => download("psi_ai_human_significance.csv", toCsv(psiSignificance.rows))}>导出 PSI 显著性 CSV</button> : null}</div></ViewHead>
        {psiError ? <div className="analysis-alert error"><b>PSI显著性检验未完成</b><span>{psiError}</span></div> : null}
        <PatternSimilarityMatrix rows={pattern.filter(row => sourcesFor("03").includes(String(row["来源A"] || "")) && sourcesFor("03").includes(String(row["来源B"] || "")))} significanceRows={psiSignificance?.rows || []} sourceCohorts={sourceCohorts} sourceOrder={sourcesFor("03")} pairingMode={pairingFor("03")} />
        {psiSignificance ? <PsiAiHumanSummary rows={psiSignificance.rows} /> : <div className="psi-awaiting"><b>4×4 AI–Human PSI显著性摘要尚未计算</b><span>默认运行10,000次固定种子结构保持置换；完成后8×8矩阵两侧同步显示FDR星号，并在下方生成16格摘要。</span></div>}
        <div className="psi-method-note"><p><b>Bootstrap 95% CI：</b>衡量participant/run抽样不确定性。</p><p><b>Permutation p/q：</b>固定AI矩阵，分别随机排列Human矩阵的11个颜色行标签和20个情绪列标签；保留行列结构，但破坏两来源正确语义对应。16个唯一AI–Human比较统一采用BH-FDR。</p></div>
      </article> : null}
      {composite.length ? <article className="gew-view-block">
        <ViewHead index="04" code="COMPOSITE BETWEEN-GROUP" title="广度、条件强度与效价偏向" note="所有来源使用同一坐标尺度，按来源比较点估计与 participant×run Bootstrap 95% 区间；人类来源在前，AI 来源在后。"><label>指标<select value={compositeMetric} onChange={event => setCompositeMetric(event.target.value as CompositeMetric)}>{Object.entries(COMPOSITE_METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label></ViewHead>
        <CompositeIndicatorFacets rows={orderFigureRows(composite, sourcesFor("04"), row => String(row["来源"] || ""))} metric={compositeMetric} sourceCohorts={new Map(sourcesFor("04").map(source => [source, sourceCohorts.get(source) || "unspecified"]))} />
      </article> : null}
      <article className="gew-view-block">
        <ViewHead index="05" code="SOURCE FACETS" title={displayView === "wheel" ? "各来源 GEW 颜色面积扇区轮" : "各来源颜色—情绪气泡点阵"} note={displayView === "wheel" ? "圆周固定20个情绪，每个情绪扇区细分为11个标准色；小扇片面积与当前指标成正比。" : "横轴为20个情绪，纵轴为11个标准色，所有来源采用同一尺度。"}><div className="gew-inline-controls"><div className="view-mode-switch"><button className={displayView === "wheel" ? "active" : ""} onClick={() => setDisplayView("wheel")}>GEW 扇区轮</button><button className={displayView === "dots" ? "active" : ""} onClick={() => setDisplayView("dots")}>气泡点阵</button></div><MetricSelect value={displayMetric} onChange={setDisplayMetric} /></div></ViewHead>
        {displayView === "wheel" ? <GewAreaWheelFacets metric={displayMetric} sources={sourcesFor("05")} colors={colors} cells={cellsFor("05")} /> : <GewDotFacets metric={displayMetric} sources={sourcesFor("05")} colors={colors} cells={cellsFor("05")} />}
      </article>
      {rawRows.length ? <article className="gew-view-block">
        <ViewHead index="06" code="SOURCE ROWS × COLOR COLUMNS" title="八来源 × 标准色的 0–5 评分分布（8行×11列）" note="固定矩阵排版：来源为行、颜色为列；完整数据严格为8行×11列。每个面板的20根柱对应20个情绪，网页与PNG/SVG导出使用同一顺序。" ><span className="analysis-count">{sourcesFor("06").length} 行 × {colors.length} 列</span></ViewHead>
        <RatingFacetGrid rows={rawRowsFor("06")} sources={sourcesFor("06")} colors={colors} sourceCohorts={sourceCohorts} />
      </article> : null}
      <article className="gew-view-block">
        <ViewHead index="07" code="SOURCE DETAIL" title="单一来源的关联概率与条件强度" note="先区分“是否建立关联”，再观察建立关联后的强弱；用于解释上方组间差异来自哪个方向。"><label>来源<select value={effectiveHeat} onChange={event => setHeatSource(event.target.value)}>{sources07.map(source => <option key={source}>{source}</option>)}</select></label></ViewHead>
        <div className="gew-double-heatmaps"><GewHeatmap title="A · 关联概率" note="0–100% · 选择该情绪的样本比例" metric="probability" source={effectiveHeat} colors={colors} cells={cellsFor("07")} /><GewHeatmap title="B · 条件强度" note="1–5 · 仅在已选择样本中计算" metric="conditional" source={effectiveHeat} colors={colors} cells={cellsFor("07")} /></div>
      </article>
      <article className="gew-view-block">
        <ViewHead index="08" code="SOURCE DETAIL" title="单一来源、单一颜色的情绪画像" note="维持 GEW 顺序；作为组间差异的来源级解释图。"><div className="gew-inline-controls"><Select label="来源" value={effectiveProfileSource} onChange={setProfileSource} options={sources08} /><Select label="颜色" value={effectiveColor} onChange={setProfileColor} options={colors} /><MetricSelect value={profileMetric} onChange={setProfileMetric} /></div></ViewHead>
        <GewRadial source={effectiveProfileSource} color={effectiveColor} metric={profileMetric} cells={cellsFor("08")} sourceIndex={Math.max(0, sources08.indexOf(effectiveProfileSource))} />
      </article>
      <article className="gew-view-block">
        <ViewHead index="09" code="PAIRWISE DRILL-DOWN" title="两个指定来源的差值热力图" note="直接显示 A−B；用于从8×8组间矩阵继续下钻到任意两个独立试验组。"><div className="gew-inline-controls"><Select label="来源 A" value={effectiveA} onChange={setDifferenceA} options={sources09} /><Select label="来源 B" value={effectiveB} onChange={setDifferenceB} options={sources09.filter(pair09Allowed)} /><MetricSelect value={differenceMetric} onChange={setDifferenceMetric} /></div></ViewHead>
        {effectiveB ? <GewDifference sourceA={effectiveA} sourceB={effectiveB} metric={differenceMetric} colors={colors} cells={cellsFor("09")} /> : <div className="gew-comparison-empty">至少需要两个来源才能计算来源差值。</div>}
      </article>
      <article className="gew-view-block jsd-module-block">
        <div className="jsd-module-head"><div><span>TASK 2 · JSD DISTANCE BY COLOR</span><h4>单一颜色的20维情绪分布距离</h4><p>每个来源×颜色先汇总20个情绪选择率，再归一化为概率分布并计算 Jensen–Shannon distance。所有图共用 0–{jsdView.scaleMaximum.toFixed(2)} 色标；越小越相似，越大越不同。</p></div><div className="jsd-csv-actions"><button className="secondary" disabled={!jsdView.humanRows.length} onClick={() => download("jsd_colorwise_human.csv", toCsv(jsdView.humanRows))}>Human CSV</button><button className="secondary" disabled={!jsdView.aiRows.length} onClick={() => download("jsd_colorwise_ai.csv", toCsv(jsdView.aiRows))}>AI CSV</button><button className="secondary" disabled={!jsdView.aiHumanRows.length} onClick={() => download("jsd_colorwise_ai_human.csv", toCsv(jsdView.aiHumanRows))}>AI–Human CSV</button><button className="secondary" disabled={!jsdView.meanRows.length} onClick={() => download("jsd_ai_human_mean.csv", toCsv(jsdView.meanRows))}>平均 JSD CSV</button><button className="secondary" disabled={!jsdRows.length} onClick={() => download("jsd_colorwise_all_pairs.csv", toCsv(jsdRows))}>全部组对 CSV</button></div></div>
        {jsdView.missingCount ? <div className="analysis-alert warning"><b>{jsdView.missingCount} 个来源对×颜色无法计算 JSD</b><span>至少一侧的20维选择率总和为0；对应格显示 NA，CSV 的 status 字段记录具体原因。</span></div> : null}
        <div className="jsd-figure-stack">
          <JsdFigureHeader index="10" title="Figure A · Human 组内颜色级 JSD" note="横轴为6个人类组内配对；纵轴为11种标准色。" disabled={exporting || !jsdView.humanRows.length} onExport={() => void exportOneView("10", "JSD-Human-within-colorwise")} />
          <JsdColorwiseHeatmap pairs={jsdView.humanPairs} rows={jsdView.humanRows} maximum={jsdView.scaleMaximum} />
          <JsdFigureHeader index="11" title="Figure B · AI 组内颜色级 JSD" note="横轴为6个AI组内配对；纵轴颜色顺序与Figure A完全一致。" disabled={exporting || !jsdView.aiRows.length} onExport={() => void exportOneView("11", "JSD-AI-within-colorwise")} />
          <JsdColorwiseHeatmap pairs={jsdView.aiPairs} rows={jsdView.aiRows} maximum={jsdView.scaleMaximum} />
          <JsdFigureHeader index="12" title="Figure C · AI–Human 颜色级 JSD" note="16个跨类别组对按 Doubao、DeepSeek、GPT、Gemini 分成4个区块；用于定位具体是哪种颜色造成差异。" disabled={exporting || !jsdView.aiHumanRows.length} onExport={() => void exportOneView("12", "JSD-AI-Human-colorwise")} />
          <JsdColorwiseHeatmap pairs={jsdView.aiHumanPairs} rows={jsdView.aiHumanRows} maximum={jsdView.scaleMaximum} grouped />
          <JsdFigureHeader index="13" title="Figure D · AI–Human 平均 JSD 汇总" note="每格为对应AI–Human组对在11种颜色上的算术平均；越低表示总体颜色级情绪轮廓越接近。" disabled={exporting || !jsdView.meanRows.length} onExport={() => void exportOneView("13", "JSD-AI-Human-mean")} />
          <JsdMeanHeatmap rows={jsdView.meanRows} maximum={jsdView.scaleMaximum} />
        </div>
        <div className="jsd-interpretation"><p><b>PSI / Pearson：</b>回答两组整张11×20颜色—情绪结构的高低变化模式有多相似。</p><p><b>颜色级 JSD：</b>回答对某一种颜色，两组20情绪分布的形状差多少。PSI高不代表每种颜色都完全一致；JSD可定位具体差异颜色。</p><p><b>Figure D：</b>平均JSD越低，只表示11种颜色总体上更接近；仍需结合Figure C确认是否由少数颜色驱动。</p></div>
      </article>
    </>}
  </section></Task2FigureExportContext.Provider>;
}

function JsdFigureHeader({ index, title, note, disabled, onExport }: { index: string; title: string; note: string; disabled: boolean; onExport: () => void }) {
  return <div className="jsd-figure-head"><div><span>{index} / JSD COLORWISE</span><h5>{title}</h5><p>{note} 格内为JSD，保留两位小数；数值越小表示越相似。</p></div><button className="figure-view-export" disabled={disabled} onClick={onExport}>导出此科研图</button></div>;
}

function JsdColorwiseHeatmap({ pairs, rows, maximum, grouped = false }: { pairs: JsdPair[]; rows: ExportRow[]; maximum: number; grouped?: boolean }) {
  const rowValue = (pair: JsdPair, color: string) => optionalNumber(rows.find(row => row["pair"] === pair.label && row["color"] === color)?.["jsd"]);
  const blocks = grouped ? [...new Set(pairs.map(pair => pair.block || ""))].filter(Boolean) : [];
  return <div className="jsd-heatmap-scroll"><div className={`jsd-heatmap ${grouped ? "grouped" : ""}`} style={{ gridTemplateColumns: `88px repeat(${pairs.length},minmax(${grouped ? 66 : 96}px,1fr))` }}>
    {grouped ? <><span className="jsd-corner block-corner" />{blocks.map(block => <b className="jsd-block-head" style={{ gridColumn: "span 4" }} key={block}>{block}</b>)}</> : null}
    <span className="jsd-corner">标准色</span>{pairs.map((pair, index) => <b className={`jsd-pair-head ${grouped && index > 0 && index % 4 === 0 ? "block-start" : ""}`} key={pair.label}>{pair.label}</b>)}
    {GEW_COLOURS.map(color => <Fragment key={color}><strong className="jsd-color-head"><i style={{ background: GEW_COLOR_HEX[color] }} />{color}</strong>{pairs.map((pair, index) => {
      const value = rowValue(pair, color), level = value === null ? 0 : Math.min(1, value / maximum);
      return <i className={`jsd-cell ${value === null ? "missing" : ""} ${grouped && index > 0 && index % 4 === 0 ? "block-start" : ""}`} style={value === null ? undefined : { "--jsd-level": `${level * 100}%`, color: level > .62 ? "white" : "#29414a" } as React.CSSProperties} key={`${pair.label}-${color}`} title={`${pair.label} · ${color}: ${value === null ? "NA（20维选择率总和为0或组对缺失）" : value.toFixed(6)}`}>{value === null ? "NA" : value.toFixed(2)}</i>;
    })}</Fragment>)}
  </div><div className="jsd-scale"><span>0 · 更相似</span><i /><span>{maximum.toFixed(2)} · 更不同</span></div></div>;
}

function JsdMeanHeatmap({ rows, maximum }: { rows: ExportRow[]; maximum: number }) {
  const aiSources = [...new Set(rows.map(row => String(row["ai_source"] || "")))].filter(Boolean);
  const humanSources = [...new Set(rows.map(row => String(row["human_source"] || "")))].filter(Boolean);
  const valueFor = (ai: string, human: string) => optionalNumber(rows.find(row => row["ai_source"] === ai && row["human_source"] === human)?.["mean_jsd"]);
  return <div className="jsd-mean-wrap"><div className="jsd-mean-heatmap" style={{ gridTemplateColumns: `120px repeat(${humanSources.length},minmax(110px,1fr))` }}><span />{humanSources.map(source => <b key={source}>{canonicalSource(source)}</b>)}{aiSources.map(ai => <Fragment key={ai}><strong>{canonicalSource(ai)}</strong>{humanSources.map(human => {
    const value = valueFor(ai, human), level = value === null ? 0 : Math.min(1, value / maximum);
    return <i className={value === null ? "missing" : ""} style={value === null ? undefined : { "--jsd-level": `${level * 100}%`, color: level > .62 ? "white" : "#29414a" } as React.CSSProperties} key={`${ai}-${human}`} title={`${canonicalSource(ai)}–${canonicalSource(human)} · 11色平均JSD: ${value === null ? "NA" : value.toFixed(6)}`}>{value === null ? "NA" : value.toFixed(2)}</i>;
  })}</Fragment>)}</div><div className="jsd-scale"><span>0 · 更相似</span><i /><span>{maximum.toFixed(2)} · 更不同</span></div></div>;
}

function ViewHead({ index, code, title, note, children }: { index: string; code: string; title: string; note: string; children: React.ReactNode }) {
  const exportContext = useContext(Task2FigureExportContext);
  const exportName = title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  return <><div className="gew-view-head"><div><span>{index} / {code}</span><h4>{title}</h4><p>{note}</p></div><div className="gew-view-actions">{children}{exportContext ? <button className="figure-view-export" disabled={exportContext.disabled || !exportContext.sourcesFor(index).length} onClick={() => exportContext.exportView(index, exportName)}>导出此科研图 {exportContext.style.format.toUpperCase()}</button> : null}</div></div>{exportContext ? <FigureSourceSelector available={exportContext.availableSources} selected={exportContext.sourcesFor(index)} onChange={sources => exportContext.setSourcesFor(index, sources)} pairingMode={exportContext.pairingFor(index)} onPairingModeChange={mode => exportContext.setPairingFor(index, mode)} compact /> : null}</>;
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}
function MetricSelect({ value, onChange }: { value: GewMetric; onChange: (value: GewMetric) => void }) {
  return <label>指标<select value={value} onChange={event => onChange(event.target.value as GewMetric)}>{Object.entries(METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>;
}

function cohortName(cohort?: GewRow["cohort"]) {
  return cohort === "human" ? "人类" : cohort === "ai" ? "AI" : "未标记";
}

function EightGroupRanking({ cells, sourceCohorts, color, emotion, metric }: { cells: GewCell[]; sourceCohorts: Map<string, GewRow["cohort"]>; color: string; emotion: string; metric: GewMetric }) {
  const groups = [...sourceCohorts].map(([source, cohort]) => {
    const cell = cells.find(item => item.source === source && item.color === color && item.emotion === emotion);
    return { source, cohort, value: valueOf(cell, metric) };
  }).filter((item): item is { source: string; cohort: GewRow["cohort"]; value: number } => item.value !== null);
  const maximum = METRICS[metric].maximum;
  return <div className="eight-group-ranking">
    <div className="eight-group-axis"><span>0</span><i /><span>{metric === "probability" ? "100%" : maximum}</span></div>
    {groups.map((group, index) => <article key={group.source}><em>{index + 1}</em><b>{group.source}<small className={`cohort-tag ${group.cohort}`}>{cohortName(group.cohort)}</small></b><div><i style={{ width: `${group.value / maximum * 100}%` }} /></div><strong>{shown(group.value, metric)}</strong></article>)}
    <p className="chart-note">{color} × {emotion} · {METRICS[metric].label}。每一行就是一个独立试验组；人类/AI仅用于标签与排序识别。</p>
  </div>;
}

function EightGroupPairMatrix({ cells, pairwise, sourceCohorts, color, emotion, metric, pairingMode }: { cells: GewCell[]; pairwise: ExportRow[]; sourceCohorts: Map<string, GewRow["cohort"]>; color: string; emotion: string; metric: GewMetric; pairingMode: "all" | "cross-cohort" }) {
  const sources = [...sourceCohorts.keys()];
  const valueFor = (source: string) => valueOf(cells.find(cell => cell.source === source && cell.color === color && cell.emotion === emotion), metric);
  const differences = sources.flatMap(a => sources.map(b => {
    const first = valueFor(a), second = valueFor(b);
    return first === null || second === null ? null : first - second;
  })).filter((value): value is number => value !== null);
  const limit = Math.max(metric === "probability" ? .05 : .25, ...differences.map(Math.abs));
  const qFor = (a: string, b: string) => optionalNumber(pairwise.find(row => row["颜色"] === color && row["情绪"] === emotion && ((row["来源A"] === a && row["来源B"] === b) || (row["来源A"] === b && row["来源B"] === a)))?.["FDR_q值"]);
  return <div className="eight-group-matrix-wrap"><div className="eight-group-matrix" style={{ gridTemplateColumns: `135px repeat(${sources.length},minmax(74px,1fr))` }}>
    <span />{sources.map(source => <b key={source} className={`cohort-${sourceCohorts.get(source)}`}>{source}<small>{cohortName(sourceCohorts.get(source))}</small></b>)}
    {sources.map(a => <Fragment key={a}><strong className={`cohort-${sourceCohorts.get(a)}`}>{a}<small>{cohortName(sourceCohorts.get(a))}</small></strong>{sources.map(b => {
      if (a === b) return <i className="diagonal" key={b}>—</i>;
      if (pairingMode === "cross-cohort" && sourceCohorts.get(a) === sourceCohorts.get(b) && (sourceCohorts.get(a) === "human" || sourceCohorts.get(a) === "ai")) return <i className="diagonal excluded" key={b}>×</i>;
      const first = valueFor(a), second = valueFor(b), difference = first === null || second === null ? null : first - second, q = metric === "probability" ? qFor(a, b) : null;
      const strength = difference === null ? 0 : Math.min(1, Math.abs(difference) / limit);
      const background = difference === null ? "#f0f2f0" : difference >= 0 ? `rgba(190,88,67,${.08 + strength * .82})` : `rgba(39,123,146,${.08 + strength * .82})`;
      return <i key={b} style={{ background }} title={`${a}−${b}: ${difference === null ? "—" : difference.toFixed(4)}${q === null ? "" : `\nFDR q=${q.toFixed(4)}`}`}>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference.toFixed(metric === "probability" ? 2 : 1)}`}{q !== null && q < .05 ? <small>●</small> : null}</i>;
    })}</Fragment>)}
  </div><div className="asymmetry-legend"><span>蓝：列组更高</span><i className="cohort-difference-scale" /><span>红：行组更高</span></div><p className="chart-note">当前单元：{color} × {emotion}。矩阵上下三角互为相反数；关联概率的显著标记来自全部组对的统一 BH-FDR，条件强度与综合强度在此仅展示描述性差值。</p></div>;
}

function polarPoint(center: number, radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return [center + radius * Math.cos(radians), center + radius * Math.sin(radians)] as const;
}

function annularSectorPath(center: number, inner: number, outer: number, start: number, end: number) {
  const outerStart = polarPoint(center, outer, start), outerEnd = polarPoint(center, outer, end);
  const innerEnd = polarPoint(center, inner, end), innerStart = polarPoint(center, inner, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${outerStart[0]} ${outerStart[1]} A ${outer} ${outer} 0 ${large} 1 ${outerEnd[0]} ${outerEnd[1]} L ${innerEnd[0]} ${innerEnd[1]} A ${inner} ${inner} 0 ${large} 0 ${innerStart[0]} ${innerStart[1]} Z`;
}

function GewAreaWheelFacets({ metric, sources, colors, cells }: { metric: GewMetric; sources: string[]; colors: string[]; cells: GewCell[] }) {
  const orderedColors = [...GEW_COLOURS.filter(code => colors.includes(code)), ...colors.filter(color => !GEW_COLOURS.includes(color as typeof GEW_COLOURS[number]))];
  return <div className="gew-area-wheel-display">
    <div className="gew-area-wheel-legend"><span>扇片面积 = {METRICS[metric].label}</span>{orderedColors.map(color => <i key={color}><em style={{ background: GEW_COLOR_HEX[color as keyof typeof GEW_COLOR_HEX] || "#8a989b" }} />{color}</i>)}<small>积极情绪 1–10 · 消极情绪 11–20</small></div>
    <div className="gew-area-wheel-facets">{sources.map(source => <GewAreaWheel key={source} source={source} metric={metric} colors={orderedColors} cells={cells} />)}</div>
  </div>;
}

function GewAreaWheel({ source, metric, colors, cells }: { source: string; metric: GewMetric; colors: string[]; cells: GewCell[] }) {
  const center = 300, inner = 53, outer = 214, labelRadius = 248, maximum = METRICS[metric].maximum;
  const lookup = new Map(cells.filter(cell => cell.source === source).map(cell => [`${cell.color}\u0000${cell.emotion}`, cell]));
  return <article className="gew-area-wheel-card"><header><h5>{source}</h5><span>20 情绪 × {colors.length} 标准色 · 面积编码</span></header><svg className="gew-area-wheel" viewBox="0 0 600 600" role="img" aria-label={`${source} 的日内瓦情绪轮颜色面积图`}>
    {GEW_EMOTIONS.map((emotion, emotionIndex) => {
      const sectorStart = emotionIndex * 18 + .6, sectorEnd = (emotionIndex + 1) * 18 - .6;
      const sliceWidth = (sectorEnd - sectorStart) / Math.max(1, colors.length);
      return <g key={emotion}>
        <path className={emotionIndex < 10 ? "emotion-sector positive" : "emotion-sector negative"} d={annularSectorPath(center, inner, outer, sectorStart, sectorEnd)} />
        {colors.map((color, colorIndex) => {
          const start = sectorStart + colorIndex * sliceWidth + .08, end = sectorStart + (colorIndex + 1) * sliceWidth - .08;
          const cell = lookup.get(`${color}\u0000${emotion}`), value = valueOf(cell, metric);
          const level = value === null ? 0 : Math.min(1, Math.max(0, value / maximum));
          const radius = Math.sqrt(inner ** 2 + level * (outer ** 2 - inner ** 2));
          return level > 0 ? <path className="color-area-slice" key={color} d={annularSectorPath(center, inner, radius, start, end)} fill={GEW_COLOR_HEX[color as keyof typeof GEW_COLOR_HEX] || "#8a989b"}><title>{source} · {emotion} · {color} · {METRICS[metric].label}: {shown(value, metric)}</title></path> : null;
        })}
      </g>;
    })}
    {[.25, .5, .75, 1].map(level => { const radius = Math.sqrt(inner ** 2 + level * (outer ** 2 - inner ** 2)); return <circle className="area-grid" key={level} cx={center} cy={center} r={radius} />; })}
    <circle className="area-center" cx={center} cy={center} r={inner} />
    <text className="area-center-title" x={center} y={center - 5}>GEW</text><text className="area-center-subtitle" x={center} y={center + 12}>{METRICS[metric].label}</text>
    {GEW_EMOTIONS.map((emotion, index) => {
      const angle = index * 18 + 9, [x, y] = polarPoint(center, labelRadius, angle);
      return <text className={index < 10 ? "emotion-label positive" : "emotion-label negative"} key={emotion} x={x} y={y} textAnchor={x < center - 8 ? "end" : x > center + 8 ? "start" : "middle"}>{emotion}</text>;
    })}
  </svg><p>面积按环形扇区的实际几何面积缩放，而非仅按半径缩放；因此同一指标可在不同情绪与颜色间直接比较。</p></article>;
}

function GewDotFacets({ metric, sources, colors, cells }: { metric: GewMetric; sources: string[]; colors: string[]; cells: GewCell[] }) {
  const lookup = new Map(cells.map(cell => [keyOf(cell.source, cell.color, cell.emotion), cell]));
  const maximum = METRICS[metric].maximum;
  const displayEmotions = GEW_EMOTIONS.filter(emotion => cells.some(cell => cell.emotion === emotion));
  const orderedColors = [...GEW_COLOURS.filter(code => colors.includes(code)), ...colors.filter(color => !GEW_COLOURS.includes(color as typeof GEW_COLOURS[number]))];
  return <div className="gew-dot-display">
    <div className="gew-dot-legend"><span>圆点大小 = {METRICS[metric].label}</span>{[.25, .5, 1].map(level => <i key={level}><em style={{ width: `${5 + Math.sqrt(level) * 16}px`, height: `${5 + Math.sqrt(level) * 16}px` }} /><b>{metric === "probability" ? `${level * 100}%` : (level * maximum).toFixed(1)}</b></i>)}<small>圆点颜色 = 标准色本身</small></div>
    <div className="gew-dot-facets">{sources.map(source => {
      const sourceCells = cells.filter(cell => cell.source === source), visibleValues = sourceCells.map(cell => valueOf(cell, metric)).filter((value): value is number => value !== null);
      return <article className="gew-dot-facet" key={source}>
        <header><h5>{source}</h5><span>{sourceCells.length} 个单元 · {visibleValues.length ? `${METRICS[metric].label}均值 ${shown(visibleValues.reduce((sum, value) => sum + value, 0) / visibleValues.length, metric)}` : "暂无数值"}</span></header>
        <div className="gew-dot-scroll"><div className="gew-dot-matrix" style={{ gridTemplateColumns: `78px repeat(${displayEmotions.length},minmax(25px,1fr))`, minWidth: `${Math.max(220, 78 + displayEmotions.length * 27)}px` }}>
          <span className="gew-dot-corner">颜色</span>
          {displayEmotions.map(emotion => <b className={GEW_EMOTIONS.indexOf(emotion) === 10 ? "negative-start" : ""} key={emotion}><span>{emotion}</span></b>)}
          {orderedColors.map(color => <Fragment key={color}>
            <strong><i style={{ background: GEW_COLOR_HEX[color as keyof typeof GEW_COLOR_HEX] || "#94a2a5" }} />{color}</strong>
            {displayEmotions.map(emotion => {
              const cell = lookup.get(keyOf(source, color, emotion)), value = valueOf(cell, metric);
              const level = value === null ? 0 : Math.min(1, Math.max(0, value / maximum));
              const diameter = value === null ? 0 : 4 + Math.sqrt(level) * 20;
              return <i className={`${value === null ? "missing" : level === 0 ? "zero" : ""} ${GEW_EMOTIONS.indexOf(emotion) === 10 ? "negative-start" : ""}`} key={`${color}-${emotion}`} title={`${source} · ${color} · ${emotion}\n${METRICS[metric].label}: ${shown(value, metric)}\nN=${cell?.n ?? 0}`}><em style={{ width: diameter, height: diameter, background: GEW_COLOR_HEX[color as keyof typeof GEW_COLOR_HEX] || "#5d8791" }} /></i>;
            })}
          </Fragment>)}
        </div></div>
      </article>;
    })}</div>
  </div>;
}

function RatingFacetGrid({ rows, sources, colors, sourceCohorts }: { rows: GewRow[]; sources: string[]; colors: string[]; sourceCohorts: Map<string, GewRow["cohort"]> }) {
  const orderedSources = sources;
  const orderedColors = [...GEW_COLOURS.filter(code => colors.includes(code)), ...colors.filter(color => !GEW_COLOURS.includes(color as typeof GEW_COLOURS[number]))];
  return <div className="rating-facet-wrap"><div className="rating-facet-legend">{RATING_COLORS.map((fill, level) => <span key={level}><i style={{ background: fill }} />{level === 0 ? "0 未关联" : `${level} 分`}</span>)}<small>每根柱总高 = 100%</small></div>
    <div className="rating-facet-grid" style={{ gridTemplateColumns: `115px repeat(${orderedColors.length},minmax(285px,1fr))`, minWidth: `${115 + orderedColors.length * 285}px` }}>
      <span className="rating-facet-corner">来源 × 颜色</span>{orderedColors.map(color => <b className="rating-color-head" key={color}><i style={{ background: GEW_COLOR_HEX[color as keyof typeof GEW_COLOR_HEX] || "#8a989b" }} />{color}</b>)}
      {orderedSources.map((source, sourceIndex) => <Fragment key={source}><strong className="rating-source-head">{source}<small className={`cohort-tag ${sourceCohorts.get(source) || "unspecified"}`}>{cohortName(sourceCohorts.get(source))}</small></strong>{orderedColors.map(color => <RatingFacet key={`${source}-${color}`} rows={rows} source={source} color={color} showLabels={sourceIndex === orderedSources.length - 1} />)}</Fragment>)}
    </div><p className="chart-note">每个小面板对应一个来源×标准色，20根柱按GEW固定情绪顺序排列。0分在柱顶以灰色显示；1–5分从蓝、绿、黄、橙到红依次向下堆叠，彩色部分总高度就是该情绪的关联率。</p>
  </div>;
}

function RatingFacet({ rows, source, color, showLabels }: { rows: GewRow[]; source: string; color: string; showLabels: boolean }) {
  return <div className={`rating-facet ${showLabels ? "show-labels" : ""}`}><div className="rating-facet-bars">{GEW_EMOTIONS.map(emotion => {
    const values = rows.filter(row => row.source === source && row.color === color && row.emotion === emotion).map(row => Math.max(0, Math.min(5, Math.round(row.intensity))));
    const counts = Array.from({ length: 6 }, (_, level) => values.filter(value => value === level).length), total = Math.max(1, values.length);
    return <div className="rating-facet-column" key={emotion}><div className="rating-facet-stack">{counts.map((count, level) => <i key={level} style={{ height: `${count / total * 100}%`, background: RATING_COLORS[level] }} title={`${source} · ${color} · ${emotion}\n${level}分: ${count}/${values.length} (${(count / total * 100).toFixed(1)}%)`} />)}</div>{showLabels ? <span>{emotion}</span> : null}</div>;
  })}</div></div>;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function CompositeIndicatorFacets({ rows, metric, sourceCohorts }: { rows: ExportRow[]; metric: CompositeMetric; sourceCohorts: Map<string, GewRow["cohort"]> }) {
  const config = COMPOSITE_METRICS[metric], sources = [...new Set(rows.map(row => String(row["来源"] || "")))].filter(Boolean);
  const position = (value: number) => (value - config.minimum) / (config.maximum - config.minimum) * 100;
  return <div className="composite-facets">{sources.map(source => <article key={source}>
    <header><h5>{source}</h5><span className={`cohort-tag ${sourceCohorts.get(source) || "unspecified"}`}>{cohortName(sourceCohorts.get(source))}</span></header>
    <div className="composite-axis"><span>{config.minimum}</span><i>{metric === "valence" ? <em style={{ left: "50%" }} /> : null}</i><span>{config.maximum}</span></div>
    <div className="composite-rows">{GEW_COLOURS.map(code => {
      const row = rows.find(item => item["来源"] === source && item["颜色"] === code);
      const mean = optionalNumber(row?.[config.mean]), low = optionalNumber(row?.[config.low]), high = optionalNumber(row?.[config.high]);
      return <div key={code}><b><i style={{ background: GEW_COLOR_HEX[code] }} />{code}</b><span>{mean === null || low === null || high === null ? null : <><i style={{ left: `${position(low)}%`, width: `${Math.max(0, position(high) - position(low))}%` }} /><em style={{ left: `${position(mean)}%`, background: GEW_COLOR_HEX[code] }}><small>{mean.toFixed(2)} [{low.toFixed(2)}, {high.toFixed(2)}]</small></em></>}</span><strong>{mean === null ? "—" : mean.toFixed(2)}</strong></div>;
    })}</div>
  </article>)}</div>;
}

function PatternSimilarityMatrix({ rows, significanceRows, sourceCohorts, sourceOrder, pairingMode }: { rows: ExportRow[]; significanceRows: ExportRow[]; sourceCohorts: Map<string, GewRow["cohort"]>; sourceOrder: string[]; pairingMode: "all" | "cross-cohort" }) {
  const sources = sourceOrder;
  const valueFor = (sourceA: string, sourceB: string) => {
    if (sourceA === sourceB) return 1;
    const row = rows.find(item => (item["来源A"] === sourceA && item["来源B"] === sourceB) || (item["来源A"] === sourceB && item["来源B"] === sourceA));
    return optionalNumber(row?.["颜色情绪矩阵Pearson_r"]);
  };
  const significanceFor = (sourceA: string, sourceB: string) => significanceRows.find(row => (row["ai_source"] === sourceA && row["human_source"] === sourceB) || (row["ai_source"] === sourceB && row["human_source"] === sourceA));
  return <div className="pattern-matrix-wrap"><div className="pattern-matrix" style={{ gridTemplateColumns: `130px repeat(${sources.length},minmax(72px,1fr))` }}>
    <span />{sources.map(source => <b className={`cohort-${sourceCohorts.get(source) || "unspecified"}`} key={source}>{source}<small>{cohortName(sourceCohorts.get(source))}</small></b>)}
    {sources.map(sourceA => <Fragment key={sourceA}><strong className={`cohort-${sourceCohorts.get(sourceA) || "unspecified"}`}>{sourceA}<small>{cohortName(sourceCohorts.get(sourceA))}</small></strong>{sources.map(sourceB => {
      if (sourceA !== sourceB && pairingMode === "cross-cohort" && sourceCohorts.get(sourceA) === sourceCohorts.get(sourceB) && (sourceCohorts.get(sourceA) === "human" || sourceCohorts.get(sourceA) === "ai")) return <i className="diagonal excluded" key={sourceB}>×</i>;
      const value = valueFor(sourceA, sourceB), strength = value === null ? 0 : Math.abs(value), significance = significanceFor(sourceA, sourceB), stars = String(significance?.["significance_stars"] || "");
      const background = value === null ? "#f0f2f0" : value >= 0 ? `rgba(39,123,146,${.08 + strength * .86})` : `rgba(202,105,70,${.08 + strength * .86})`;
      return <i key={sourceB} style={{ background, color: strength > .62 ? "white" : "#29414a" }} title={`${sourceA} × ${sourceB}: ${value === null ? "不可计算" : `PSI=${value.toFixed(3)}`}${significance ? `\nBootstrap 95% CI: [${optionalNumber(significance["bootstrap_ci_low"])?.toFixed(3) ?? "NA"}, ${optionalNumber(significance["bootstrap_ci_high"])?.toFixed(3) ?? "NA"}]\nPermutation p=${optionalNumber(significance["permutation_p"])?.toFixed(6)}\nBH-FDR q=${optionalNumber(significance["fdr_q"])?.toFixed(6)}` : ""}`}>{value === null ? "—" : <>{value.toFixed(2)}<small className="psi-stars">{stars}</small></>}</i>;
    })}</Fragment>)}
  </div><div className="pattern-scale"><span>负相关</span><i /><em>0</em><i /><span>正相关</span></div><p className="chart-note">星号仅出现在16个AI–Human格：* q&lt;.05，** q&lt;.01，*** q&lt;.001；对称两格复用同一次检验，不重复进入FDR family。</p></div>;
}

function PsiAiHumanSummary({ rows }: { rows: ExportRow[] }) {
  const aiSources = [...new Set(rows.map(row => String(row["ai_source"] || "")))];
  const humanSources = [...new Set(rows.map(row => String(row["human_source"] || "")))];
  const rowFor = (ai: string, human: string) => rows.find(row => row["ai_source"] === ai && row["human_source"] === human);
  return <section className="psi-summary"><header><div><span>AI × HUMAN · 16 UNIQUE TESTS</span><h5>4×4 PSI 显著性摘要</h5></div><div className="psi-audit"><b>{rows.length === 16 ? "✓ 16/16" : `! ${rows.length}/16`}</b><span>BH-FDR family</span></div></header><div className="psi-summary-grid" style={{ gridTemplateColumns: `120px repeat(${humanSources.length},minmax(115px,1fr))` }}><span />{humanSources.map(source => <b key={source}>{canonicalSource(source)}</b>)}{aiSources.map(ai => <Fragment key={ai}><strong>{canonicalSource(ai)}</strong>{humanSources.map(human => {
    const row = rowFor(ai, human), psi = optionalNumber(row?.["psi"]), stars = String(row?.["significance_stars"] || "");
    const title = row ? `AI: ${canonicalSource(ai)}\nHuman: ${canonicalSource(human)}\nPSI: ${psi?.toFixed(3) ?? "NA"}\nBootstrap 95% CI: [${optionalNumber(row["bootstrap_ci_low"])?.toFixed(3) ?? "NA"}, ${optionalNumber(row["bootstrap_ci_high"])?.toFixed(3) ?? "NA"}]\nPermutation: B=${row["n_permutation"]}\np=${optionalNumber(row["permutation_p"])?.toFixed(6)}\nBH-FDR q=${optionalNumber(row["fdr_q"])?.toFixed(6)}\nSignificant: ${row["significant_fdr"] ? "yes" : "no"}` : "结果缺失";
    const strength = psi === null ? 0 : Math.min(1, Math.abs(psi));
    return <i className={row?.["significant_fdr"] ? "significant" : ""} style={{ "--psi-strength": `${strength * 100}%` } as React.CSSProperties} key={`${ai}-${human}`} title={title}>{psi === null ? "NA" : <>{psi.toFixed(2)}<small>{stars}</small></>}</i>;
  })}</Fragment>)}</div><p>每格只检验该AI–Human pair本身的PSI是否高于随机语义对齐；不比较不同Human之间的PSI差值。</p></section>;
}

function GewHeatmap({ title, note, metric, source, colors, cells }: { title: string; note: string; metric: GewMetric; source: string; colors: string[]; cells: GewCell[] }) {
  const lookup = new Map(cells.map(cell => [keyOf(cell.source, cell.color, cell.emotion), cell])), maximum = METRICS[metric].maximum;
  return <section className="gew-heatmap-card"><header><b>{title}</b><span>{note}</span></header><div className="gew-matrix-scroll"><div className="gew-matrix" style={{ gridTemplateColumns: `72px repeat(${GEW_EMOTIONS.length}, minmax(30px,1fr))` }}>
    <span className="gew-corner">颜色</span>{GEW_EMOTIONS.map((emotion, index) => <b className={index === 10 ? "gew-negative-start" : ""} key={emotion}><span>{emotion}</span></b>)}
    {colors.map(color => <Fragment key={color}><strong>{color}</strong>{GEW_EMOTIONS.map((emotion, index) => { const cell = lookup.get(keyOf(source, color, emotion)), value = valueOf(cell, metric), level = value === null ? 0 : Math.min(1, Math.max(0, value / maximum)); return <i className={`${value === null ? "missing" : ""} ${index === 10 ? "gew-negative-start" : ""}`} key={`${color}-${emotion}`} style={{ "--gew-level": `${level * 88}%` } as React.CSSProperties} title={`${source} · ${color} · ${emotion}\n${METRICS[metric].label}: ${shown(value, metric)}\nN=${cell?.n ?? 0}`}><span>{shown(value, metric)}</span></i>; })}</Fragment>)}
  </div></div><div className="gew-scale"><span>低</span><i /><span>{metric === "probability" ? "100%" : "5"}</span><em>积极情绪</em><em>消极情绪</em></div></section>;
}

function GewRadial({ source, color, metric, cells, sourceIndex }: { source: string; color: string; metric: GewMetric; cells: GewCell[]; sourceIndex: number }) {
  const lookup = new Map(cells.map(cell => [keyOf(cell.source, cell.color, cell.emotion), cell]));
  const values = GEW_EMOTIONS.map(emotion => valueOf(lookup.get(keyOf(source, color, emotion)), metric) ?? 0), maximum = METRICS[metric].maximum, center = 310, radius = 212;
  const point = (index: number, value: number) => { const angle = -Math.PI / 2 + index / GEW_EMOTIONS.length * Math.PI * 2, scaled = radius * Math.min(1, Math.max(0, value / maximum)); return [center + Math.cos(angle) * scaled, center + Math.sin(angle) * scaled] as const; };
  const outline = values.map((value, index) => point(index, value).join(",")).join(" "), series = SERIES[sourceIndex % SERIES.length];
  const ranked = GEW_EMOTIONS.map((emotion, index) => ({ emotion, value: values[index] })).sort((a, b) => b.value - a.value).slice(0, 3);
  return <div className="gew-radial-layout"><svg className="gew-radial" viewBox="0 0 620 620" role="img" aria-label={`${source} ${color} 的 20 情绪径向画像`}>
    <path className="gew-positive-half" d="M310 310 L310 98 A212 212 0 0 1 310 522 Z" /><path className="gew-negative-half" d="M310 310 L310 522 A212 212 0 0 1 310 98 Z" />
    {[.25, .5, .75, 1].map(level => <circle key={level} cx={center} cy={center} r={radius * level} className="gew-radial-grid" />)}
    {GEW_EMOTIONS.map((emotion, index) => { const outer = point(index, maximum), angle = -Math.PI / 2 + index / GEW_EMOTIONS.length * Math.PI * 2, labelRadius = radius + 34, x = center + Math.cos(angle) * labelRadius, y = center + Math.sin(angle) * labelRadius; return <g key={emotion}><line className="gew-radial-axis" x1={center} y1={center} x2={outer[0]} y2={outer[1]} /><text x={x} y={y} textAnchor={Math.cos(angle) > .2 ? "start" : Math.cos(angle) < -.2 ? "end" : "middle"}>{emotion}</text></g>; })}
    <polygon className="gew-radial-shape" points={outline} style={{ "--gew-series": series } as React.CSSProperties} />{values.map((value, index) => { const [x, y] = point(index, value); return <circle key={GEW_EMOTIONS[index]} cx={x} cy={y} r="4" style={{ fill: series }}><title>{GEW_EMOTIONS[index]} · {shown(value, metric)}</title></circle>; })}<text className="gew-valence-label positive" x="478" y="82">积极</text><text className="gew-valence-label negative" x="142" y="542">消极</text>
  </svg><aside className="gew-profile-summary"><span>当前画像</span><h5>{color}</h5><p>{source} · {METRICS[metric].label}</p><div className="gew-top-emotions">{ranked.map((item, index) => <div key={item.emotion}><i>{index + 1}</i><b>{item.emotion}</b><strong>{shown(item.value, metric)}</strong></div>)}</div><small>画像按 GEW 固定顺序绘制；积极与消极情绪各占半轮。</small></aside></div>;
}

function GewDifference({ sourceA, sourceB, metric, colors, cells }: { sourceA: string; sourceB: string; metric: GewMetric; colors: string[]; cells: GewCell[] }) {
  const lookup = new Map(cells.map(cell => [keyOf(cell.source, cell.color, cell.emotion), cell]));
  const differences = colors.flatMap(color => GEW_EMOTIONS.map(emotion => { const a = valueOf(lookup.get(keyOf(sourceA, color, emotion)), metric), b = valueOf(lookup.get(keyOf(sourceB, color, emotion)), metric); return a === null || b === null ? null : a - b; })).filter((value): value is number => value !== null);
  const limit = Math.max(metric === "probability" ? .05 : .25, ...differences.map(Math.abs));
  return <section className="gew-difference-card"><div className="gew-difference-title"><b>{sourceA} − {sourceB}</b><span>{METRICS[metric].label} · 当前筛选最大绝对差值 ±{limit.toFixed(metric === "probability" ? 2 : 1)}</span></div><div className="gew-matrix-scroll"><div className="gew-matrix gew-difference-matrix" style={{ gridTemplateColumns: `72px repeat(${GEW_EMOTIONS.length}, minmax(30px,1fr))` }}>
    <span className="gew-corner">颜色</span>{GEW_EMOTIONS.map((emotion, index) => <b className={index === 10 ? "gew-negative-start" : ""} key={emotion}><span>{emotion}</span></b>)}
    {colors.map(color => <Fragment key={color}><strong>{color}</strong>{GEW_EMOTIONS.map((emotion, index) => { const a = valueOf(lookup.get(keyOf(sourceA, color, emotion)), metric), b = valueOf(lookup.get(keyOf(sourceB, color, emotion)), metric), difference = a === null || b === null ? null : a - b, signed = difference === null ? 0 : Math.max(-1, Math.min(1, difference / limit)); return <i className={`${difference === null ? "missing" : signed >= 0 ? "positive" : "negative"} ${index === 10 ? "gew-negative-start" : ""}`} key={`${color}-${emotion}`} style={{ "--gew-difference": `${Math.abs(signed) * 82}%` } as React.CSSProperties} title={`${color} · ${emotion}\n${sourceA}: ${shown(a, metric)}\n${sourceB}: ${shown(b, metric)}\n差值: ${difference === null ? "—" : difference.toFixed(3)}`}><span>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference.toFixed(metric === "probability" ? 2 : 1)}`}</span></i>; })}</Fragment>)}
  </div></div><div className="gew-diverging-scale"><span>{sourceB} 更强</span><i /><em>0</em><i /><span>{sourceA} 更强</span></div></section>;
}
