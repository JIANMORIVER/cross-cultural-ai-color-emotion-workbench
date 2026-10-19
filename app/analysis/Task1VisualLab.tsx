"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  colorRowsToExport,
  GEW_EMOTIONS,
  runColorClustering,
  runContinuousHueEntropy,
  runRepresentativeColors,
  runCulturalBias,
  runDeltaE,
  runHsvDistribution,
  runWithinGroupDelta,
  toCsv,
  type CanonicalColorRow,
  type ExportRow,
} from "./engine";
import { FigureExportControls, type FigureExportStyle } from "./FigureExportControls";
import { FigureSourceSelector, normalizeFigureSources, orderFigureRows, readFigurePairingMode, readFigureSourceSelection, saveFigurePairingMode, saveFigureSourceSelection, type FigurePairingMode } from "./FigureSourceSelector";
import { downloadFigureBlob, renderPublicationFigure } from "./python-figures";

type ChartKind = "continuous-lab" | "hue-histogram" | "representative-palette" | "distribution-entropy" | "hs-polar" | "vs-density" | "lab-ab-density" | "lab-distribution" | "mosaic" | "cluster-strip" | "within-delta" | "delta-heatmap" | "delta-box" | "delta-mean" | "radar" | "dumbbell" | "parity" | "bias-bars" | "gravity" | "slopegraph" | "bias-density" | "rank-heatmap" | "difficulty-heatmap";
type OverlapMode = "raw" | "labels" | "rings" | "bubbles";
// `core70` is retained as the serialized renderer flag for compatibility;
// the UI presents it as relative-density / hexbin emphasis.
type PointEmphasis = "normal" | "core70" | "proximity";

const PUBLICATION_TITLES: Partial<Record<ChartKind, string>> = {
  "continuous-lab": "Continuous CIELAB Distribution",
  "hue-histogram": "Continuous Hue Distribution",
  "representative-palette": "Representative Colors",
  "distribution-entropy": "Hue Distribution Entropy",
  "hs-polar": "Hue–Saturation Distribution",
  "vs-density": "Value–Saturation Distribution",
  "lab-ab-density": "CIELAB a*–b* Distribution",
  "lab-distribution": "CIELAB Lightness and Chroma Distribution",
  mosaic: "Raw Color Mosaic",
};

const CHARTS: Array<{ id: ChartKind; group: string; label: string; script: string }> = [
  { id: "continuous-lab", group: "主分析 · 连续颜色空间", label: "01 · CIELAB 连续散点", script: "连续 a*–b* · 不画平均色" },
  { id: "hue-histogram", group: "主分析 · 连续颜色空间", label: "02 · Hue 连续分布", script: "10° bins + circular smoothing" },
  { id: "representative-palette", group: "主分析 · 解释性摘要", label: "03 · Representative Colors", script: "固定 K≤3 · 仅代表色" },
  { id: "distribution-entropy", group: "主分析 · 解释性摘要", label: "04 · Distribution Entropy", script: "36-bin circular Hue entropy" },
  { id: "hs-polar", group: "HSV 分布", label: "H–S 极坐标分面", script: "hsvplot.py" },
  { id: "vs-density", group: "HSV 分布", label: "V–S 密度散点分面", script: "hsvplot.py" },
  { id: "lab-ab-density", group: "CIELAB 分布", label: "a*–b* 色域密度分面", script: "新增 · CIELAB D65" },
  { id: "lab-distribution", group: "CIELAB 分布", label: "L* 与色度分布 / 集中度", script: "新增 · CIELAB D65" },
  { id: "mosaic", group: "原始选择", label: "原始色彩马赛克", script: "plott.py" },
  { id: "cluster-strip", group: "Supplement · 聚类", label: "K-means 权重色带（自适应 K · 补充）", script: "Bias_kMeans_Visualization.py" },
  { id: "within-delta", group: "Supplement · 色差", label: "组内一致性色差", script: "demac.py / de2mac.py" },
  { id: "delta-heatmap", group: "Supplement · 色差", label: "跨来源 ΔE 热力图", script: "de3mac.py / de4mac.py" },
  { id: "delta-box", group: "Supplement · 色差", label: "来源对 ΔE 分布", script: "de4mac.py" },
  { id: "delta-mean", group: "Supplement · 色差", label: "来源对平均 ΔE 与基线", script: "de4mac.py" },
  { id: "radar", group: "深度比较", label: "情绪色差雷达图", script: "de5mac.py" },
  { id: "dumbbell", group: "深度比较", label: "情绪难度哑铃图", script: "de5mac.py" },
  { id: "parity", group: "深度比较", label: "人类基线一致性图", script: "de5mac.py" },
  { id: "bias-bars", group: "文化偏置", label: "文化偏置发散条形图", script: "de6mac.py" },
  { id: "rank-heatmap", group: "文化偏置", label: "来源表现位次热力图", script: "de6mac.py" },
  { id: "difficulty-heatmap", group: "文化偏置", label: "情绪–来源难度聚类热图", script: "de6mac.py" },
  { id: "gravity", group: "文化偏置", label: "文化引力场散点图", script: "de7mac.py" },
  { id: "slopegraph", group: "文化偏置", label: "文化距离斜率图", script: "de7mac.py" },
  { id: "bias-density", group: "文化偏置", label: "宏观偏置分布", script: "de7mac.py" },
];

const SERIES = ["#277b92", "#d47d55", "#4f8a70", "#8d6b94", "#b9973b", "#5675a7", "#b45d6b", "#657c82"];
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const valueOf = (row: ExportRow, key: string) => Number(row[key]) || 0;
const labelOf = (row: ExportRow, key: string) => String(row[key] ?? "");

function download(name: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function groupBySource(rows: CanonicalColorRow[]) {
  return [...new Set(rows.map(row => row.source))].map(source => ({ source, rows: rows.filter(row => row.source === source) }));
}

function deltaValue(delta: ExportRow[], emotion: string, a: string, b: string) {
  const row = delta.find(item => labelOf(item, "情绪") === emotion && ((labelOf(item, "来源A") === a && labelOf(item, "来源B") === b) || (labelOf(item, "来源A") === b && labelOf(item, "来源B") === a)));
  return row ? valueOf(row, "对称最小ΔE76") : NaN;
}

function labRowsToExport(rows: CanonicalColorRow[]): ExportRow[] {
  return rows.map(row => ({
    行号: row.row,
    来源: row.source,
    组类型: row.cohort,
    情绪: row.emotion,
    HEX: row.hex,
    L星: round(row.labL, 4),
    a星: round(row.labA, 4),
    b星: round(row.labB, 4),
    C星_ab: round(Math.hypot(row.labA, row.labB), 4),
  }));
}

function chartData(kind: ChartKind, rows: CanonicalColorRow[], pairingMode: FigurePairingMode = "all") {
  let data: ExportRow[];
  if (kind === "representative-palette") data = runRepresentativeColors(rows, 3).rows;
  else if (kind === "distribution-entropy") data = runContinuousHueEntropy(rows, 36).rows;
  else if (kind === "cluster-strip") data = runColorClustering(rows).rows;
  else if (kind === "within-delta") data = runWithinGroupDelta(rows).rows;
  else if (["delta-heatmap", "delta-box", "delta-mean", "radar", "dumbbell", "parity", "gravity", "slopegraph", "rank-heatmap", "difficulty-heatmap"].includes(kind)) data = runDeltaE(rows).rows;
  else if (["bias-bars", "bias-density"].includes(kind)) data = runCulturalBias(rows).rows;
  else if (["hs-polar", "vs-density", "hue-histogram"].includes(kind)) data = runHsvDistribution(rows).rows;
  else if (["continuous-lab", "lab-ab-density", "lab-distribution"].includes(kind)) data = labRowsToExport(rows);
  else data = colorRowsToExport(rows);
  if (pairingMode === "all") return data;
  const cohorts = new Map(rows.map(row => [row.source, row.cohort]));
  return data.filter(row => {
    const a = String(row["来源A"] ?? row.sourceA ?? ""), b = String(row["来源B"] ?? row.sourceB ?? "");
    const cohortA = cohorts.get(a), cohortB = cohorts.get(b);
    return !a || !b || cohortA !== cohortB || !["human", "ai"].includes(String(cohortA));
  });
}

export function Task1VisualLab({ rows, fileName }: { rows: CanonicalColorRow[]; fileName: string }) {
  const [kind, setKind] = useState<ChartKind>("continuous-lab"); const [referenceA, setReferenceA] = useState(""); const [referenceB, setReferenceB] = useState(""); const [selectedEmotion, setSelectedEmotion] = useState(""); const [overlapMode, setOverlapMode] = useState<OverlapMode>("raw"); const [pointEmphasis, setPointEmphasis] = useState<PointEmphasis>("normal"); const [showClusters, setShowClusters] = useState(false); const [showCentroids, setShowCentroids] = useState(true); const [showLabDensity, setShowLabDensity] = useState(true); const [labCoordinateSystem, setLabCoordinateSystem] = useState<"cartesian" | "polar">("cartesian"); const [exporting, setExporting] = useState(false); const [exportStyle, setExportStyle] = useState<FigureExportStyle>({ columns: 5, width: 4500, scale: 2, showTitle: true, format: "png" }); const plotRef = useRef<HTMLDivElement>(null);
  const allSources = [...new Set(rows.map(row => row.source))];
  const [figureSourcesByKind, setFigureSourcesByKind] = useState<Partial<Record<ChartKind, string[]>>>({});
  const [figurePairingByKind, setFigurePairingByKind] = useState<Partial<Record<ChartKind, FigurePairingMode>>>({});
  const sources = normalizeFigureSources(allSources, figureSourcesByKind[kind]);
  const figurePairingMode = figurePairingByKind[kind] || "all";
  const figureRows = orderFigureRows(rows, sources, row => row.source);
  const setFigureSources = (next: string[]) => { saveFigureSourceSelection(`task1:${kind}`, next); setFigureSourcesByKind(current => ({ ...current, [kind]: next })); };
  const setFigurePairingMode = (mode: FigurePairingMode) => { saveFigurePairingMode(`task1:${kind}`, mode); setFigurePairingByKind(current => ({ ...current, [kind]: mode })); };
  useEffect(() => {
    const saved = readFigureSourceSelection(`task1:${kind}`);
    if (saved) setFigureSourcesByKind(current => current[kind] ? current : ({ ...current, [kind]: saved }));
    const savedPairing = readFigurePairingMode(`task1:${kind}`);
    if (savedPairing) setFigurePairingByKind(current => current[kind] ? current : ({ ...current, [kind]: savedPairing }));
  }, [kind]);
  const effectiveA = sources.includes(referenceA) ? referenceA : (sources.includes("CN") ? "CN" : sources[0] || ""); const effectiveB = sources.includes(referenceB) && referenceB !== effectiveA ? referenceB : (sources.find(source => source === "BW" && source !== effectiveA) || sources.find(source => source !== effectiveA) || "");
  const availableEmotions = GEW_EMOTIONS.filter(emotion => figureRows.some(row => row.emotion === emotion));
  const effectiveEmotion = availableEmotions.includes(selectedEmotion as typeof GEW_EMOTIONS[number]) ? selectedEmotion : availableEmotions[0] || "";
  const hsvFaceted = kind === "hs-polar" || kind === "vs-density";
  const batchFaceted = hsvFaceted || ["continuous-lab", "hue-histogram", "representative-palette", "distribution-entropy", "lab-ab-density"].includes(kind);
  // Keep the original name for the publication-facet workflow; Lab a–b adds
  // a separate, emotion-filtered clustering view below.
  const emotionFaceted = hsvFaceted;
  const emotionSelectable = hsvFaceted || ["continuous-lab", "hue-histogram", "representative-palette", "distribution-entropy", "lab-ab-density"].includes(kind);
  const activePointEmphasis: PointEmphasis = kind === "vs-density" && pointEmphasis === "proximity" ? "normal" : pointEmphasis;
  const visibleRows = emotionSelectable && effectiveEmotion ? figureRows.filter(row => row.emotion === effectiveEmotion) : figureRows;
  const clusterRows = useMemo(() => kind === "lab-ab-density" && showClusters ? runColorClustering(visibleRows).rows : [], [kind, showClusters, visibleRows]);
  const data = useMemo(() => chartData(kind, visibleRows, figurePairingMode), [kind, visibleRows, figurePairingMode]); const selected = CHARTS.find(chart => chart.id === kind)!; const needsReferences = ["parity", "bias-bars", "gravity", "slopegraph", "bias-density", "rank-heatmap", "difficulty-heatmap"].includes(kind);
  const safeName = (fileName || "task1").replace(/\.[^.]+$/, "").replace(/\s+/g, "-");

  const publicationTitle = PUBLICATION_TITLES[kind] || "Color–Emotion Analysis";
  const exportTitle = emotionSelectable && effectiveEmotion ? `${publicationTitle}: ${effectiveEmotion}` : publicationTitle;
  async function exportCurrentFigure(format: FigureExportStyle["format"]) {
    setExporting(true);
    try {
      const blob = await renderPublicationFigure({ scope: "task1", kind, rows: visibleRows, data, clusters: clusterRows, options: { ...exportStyle, format, title: exportTitle, sourceOrder: sources, pairingMode: figurePairingMode, overlapMode, pointEmphasis: activePointEmphasis, showClusters, showCentroids, showLabDensity, labCoordinateSystem } });
      downloadFigureBlob(blob, `${safeName}_${kind}.${format}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "PNG 导出失败。");
    } finally {
      setExporting(false);
    }
  }

  async function exportAllEmotionFacets() {
    if (!batchFaceted || !availableEmotions.length) return;
    setExporting(true);
    try {
      const { zipSync } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      for (const emotion of availableEmotions) {
        const emotionRows = figureRows.filter(row => row.emotion === emotion);
        const emotionClusters = kind === "lab-ab-density" && showClusters ? runColorClustering(emotionRows).rows : [];
        const blob = await renderPublicationFigure({ scope: "task1", kind, rows: emotionRows, data: chartData(kind, emotionRows, figurePairingMode), clusters: emotionClusters, options: { ...exportStyle, title: `${publicationTitle}: ${emotion}`, sourceOrder: sources, pairingMode: figurePairingMode, overlapMode, pointEmphasis: activePointEmphasis, showClusters, showCentroids, showLabDensity, labCoordinateSystem } });
        files[`${emotion}_${kind}.${exportStyle.format}`] = new Uint8Array(await blob.arrayBuffer());
      }
      const url = URL.createObjectURL(new Blob([zipSync(files, { level: 1 })], { type: "application/zip" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeName}_${kind}_20-emotions-${exportStyle.format}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "20 情绪分面图导出失败。");
    } finally {
      setExporting(false);
    }
  }

  return <section className="visual-lab panel">
    <div className="visual-lab-head"><div><span className="eyebrow">{hsvFaceted ? "PYTHON · MATPLOTLIB 原生导出" : "PYTHON PAPER STYLE · 300 DPI READY"}</span><h3>{exportTitle}</h3><p>对应 {selected.script} · 当前图 {visibleRows.length.toLocaleString()} 个观察 · {hsvFaceted ? "直接对应 hsvplot.py；最终 PNG 无网页卡片边框" : "当前分析视图"}</p></div><div className="visual-export"><button className="secondary" disabled={!data.length} onClick={() => download(`${safeName}_${kind}.csv`, toCsv(data))}>导出图表数据 CSV</button></div></div>
    <div className="visual-lab-controls">
      <label>可视化分析<select value={kind} onChange={event => setKind(event.target.value as ChartKind)}>{[...new Set(CHARTS.map(chart => chart.group))].map(group => <optgroup key={group} label={group}>{CHARTS.filter(chart => chart.group === group).map(chart => <option key={chart.id} value={chart.id}>{chart.label}</option>)}</optgroup>)}</select></label>
      <FigureSourceSelector available={allSources} selected={sources} onChange={setFigureSources} pairingMode={figurePairingMode} onPairingModeChange={setFigurePairingMode} compact />
      {emotionSelectable ? <label>情绪分面图<select value={effectiveEmotion} onChange={event => setSelectedEmotion(event.target.value)}>{availableEmotions.map(emotion => <option key={emotion}>{emotion}</option>)}</select></label> : null}
      {hsvFaceted ? <><label className="overlap-display-toggle"><span><b>导出重叠呈现</b><small>仅处理同坐标重复点</small></span><select value={overlapMode} onChange={event => setOverlapMode(event.target.value as OverlapMode)}><option value="raw">关闭 · 原始点</option><option value="labels">数字展开 · ×N</option><option value="rings">空心计数气泡</option><option value="bubbles">气泡面积编码</option></select></label><label className="overlap-display-toggle"><span><b>点强调方式</b><small>不改变原始数据</small></span><select value={pointEmphasis} onChange={event => setPointEmphasis(event.target.value as PointEmphasis)}><option value="normal">关闭 · 正常显示</option><option value="core70">密度 / hexbin · 叠加色点</option>{kind === "hs-polar" ? <option value="proximity">邻近密度 · 近深远浅</option> : null}</select></label></> : null}
      {kind === "lab-ab-density" ? <><label className="overlap-display-toggle"><span><b>a*–b* 坐标系</b><small>导出 PNG / SVG 同步</small></span><select value={labCoordinateSystem} onChange={event => setLabCoordinateSystem(event.target.value as "cartesian" | "polar")}><option value="cartesian">直角坐标 · a* × b*</option><option value="polar">极坐标 · 色度 × 方向</option></select></label><label className="overlap-display-toggle"><input type="checkbox" checked={showLabDensity} onChange={event => setShowLabDensity(event.target.checked)} /><span><b>显示面积密度色块</b><small>二维分箱背景；页面与导出同步</small></span></label><label className="overlap-display-toggle"><input type="checkbox" checked={showCentroids} onChange={event => setShowCentroids(event.target.checked)} /><span><b>显示组中心点</b><small>页面与导出同步</small></span></label><label className="overlap-display-toggle"><input type="checkbox" checked={showClusters} onChange={event => setShowClusters(event.target.checked)} /><span><b>显示 Lab 聚类中心 ×</b><small>仅在 Lab a*–b* 图中显示</small></span></label></> : null}
      {needsReferences ? <><label>参照 A<select value={effectiveA} onChange={event => setReferenceA(event.target.value)}>{sources.map(source => <option key={source}>{source}</option>)}</select></label><label>参照 B<select value={effectiveB} onChange={event => setReferenceB(event.target.value)}>{sources.filter(source => source !== effectiveA).map(source => <option key={source}>{source}</option>)}</select></label></> : null}
    </div>
    <FigureExportControls value={exportStyle} onChange={setExportStyle} onExport={format => void exportCurrentFigure(format)} exportLabel="导出科研图" disabled={!visibleRows.length} busy={exporting} batchAction={batchFaceted ? { label: `批量导出 ${availableEmotions.length} 个情绪 ZIP`, onClick: () => void exportAllEmotionFacets(), disabled: !availableEmotions.length } : undefined} />
    <div className="visual-stage python-paper-view" ref={plotRef} style={{ "--figure-columns": exportStyle.columns } as React.CSSProperties}>
      {kind === "continuous-lab" ? <p className="chart-note"><b>主分析 01：</b>每个点是一条原始自由选色；所有来源使用同一 a* / b* 坐标范围。不显示均值中心，不把颜色离散为名称。</p> : kind === "hue-histogram" ? <p className="chart-note"><b>主分析 02：</b>Hue 保持 0–360° 连续角度；10° 分箱只用于密度估计。S≤0.01 的无彩色不强行记作红色。</p> : kind === "representative-palette" ? <p className="chart-note"><b>主分析 03：</b>KMeans 固定提取最多 3 个解释性代表色。比例描述样本覆盖，不把聚类当作推断结论。</p> : kind === "distribution-entropy" ? <p className="chart-note"><b>主分析 04：</b>标准化 Hue 熵越高表示色相选择越分散；越低表示更集中或模板化，不表示更正确。</p> : hsvFaceted ? <p className="chart-note">重叠呈现：{overlapMode === "raw" ? "关闭（原始点）" : overlapMode === "labels" ? "数字展开 ×N" : overlapMode === "rings" ? "空心计数气泡" : "气泡面积编码"}；点强调：{activePointEmphasis === "normal" ? "关闭（正常显示）" : activePointEmphasis === "core70" ? "密度 / hexbin（叠加色点）" : "邻近密度（仅 H–S，近深远浅）"}。最终 PNG / SVG 使用这些设置。</p> : null}
      {!visibleRows.length ? <VisualEmpty /> : kind === "continuous-lab" ? <LabAbDensity rows={visibleRows} clusters={[]} showCentroids={false} showDensity={false} /> : kind === "hue-histogram" ? <HueHistogram rows={visibleRows} /> : kind === "representative-palette" ? <RepresentativePalettes data={data} /> : kind === "distribution-entropy" ? <EntropyBars data={data} /> : kind === "hs-polar" ? <HsPolar rows={visibleRows} expandOverlaps={overlapMode === "labels"} core70={activePointEmphasis === "core70"} proximity={activePointEmphasis === "proximity"} /> : kind === "vs-density" ? <VsDensity rows={visibleRows} expandOverlaps={overlapMode === "labels"} core70={activePointEmphasis === "core70"} /> : kind === "lab-ab-density" ? (labCoordinateSystem === "polar" ? <LabAbPolar rows={visibleRows} clusters={clusterRows} showCentroids={showCentroids} showDensity={showLabDensity} /> : <LabAbDensity rows={visibleRows} clusters={clusterRows} showCentroids={showCentroids} showDensity={showLabDensity} />) : kind === "lab-distribution" ? <LabDistributions rows={visibleRows} /> : kind === "mosaic" ? <Mosaic rows={visibleRows} /> : kind === "cluster-strip" ? <ClusterStrips data={data} /> : kind === "within-delta" ? <WithinDelta data={data} /> : kind === "delta-heatmap" ? <DeltaHeatmap data={data} /> : kind === "delta-box" ? <DeltaBox data={data} /> : kind === "delta-mean" ? <DeltaMean data={data} /> : kind === "radar" ? <Radar data={data} /> : kind === "dumbbell" ? <Dumbbell data={data} /> : kind === "parity" ? <Parity data={data} sources={sources} referenceA={effectiveA} referenceB={effectiveB} /> : kind === "bias-bars" ? <BiasBars data={data} sources={sources} referenceA={effectiveA} referenceB={effectiveB} /> : kind === "gravity" ? <Gravity data={data} sources={sources} referenceA={effectiveA} referenceB={effectiveB} /> : kind === "slopegraph" ? <Slopegraph data={data} sources={sources} referenceA={effectiveA} referenceB={effectiveB} /> : kind === "bias-density" ? <BiasDensity data={data} referenceA={effectiveA} referenceB={effectiveB} /> : kind === "difficulty-heatmap" ? <DifficultyHeatmap data={data} sources={sources} reference={effectiveA} /> : <RankHeatmap data={data} sources={sources} reference={effectiveA} />}
    </div>
  </section>;
}

function HueHistogram({ rows }: { rows: CanonicalColorRow[] }) {
  const bins = 36;
  const groups = groupBySource(rows);
  const densities = groups.map(group => {
    const chromatic = group.rows.filter(row => row.hsvS > .01);
    const counts = histogram(chromatic.map(row => row.hsvH), bins, 360);
    return { ...group, chromatic, counts, density: counts.map(count => count / Math.max(1, chromatic.length)) };
  });
  const peak = Math.max(.01, ...densities.flatMap(group => group.density));
  return <div className="facet-grid">{densities.map((group, sourceIndex) => <article className="chart-facet" key={group.source}>
    <h4 style={{ color: SERIES[sourceIndex % SERIES.length] }}>{group.source}</h4>
    <svg viewBox="0 0 430 230" role="img" aria-label={`${group.source} 连续 Hue 分布`}>
      {[0, .5, 1].map(level => <line key={level} x1="38" x2="418" y1={190 - level * 150} y2={190 - level * 150} stroke="#dfe6e7" />)}
      {group.density.map((value, index) => <rect key={index} x={38 + index * 380 / bins} y={190 - value / peak * 150} width={380 / bins + .4} height={value / peak * 150} fill={`hsl(${index * 10 + 5} 78% 55%)`} opacity=".76"><title>{index * 10}–{(index + 1) * 10}° · n={group.counts[index]}</title></rect>)}
      <line x1="38" x2="418" y1="190" y2="190" stroke="#52666d" />
      {[0, 90, 180, 270, 360].map(value => <g key={value}><line x1={38 + value / 360 * 380} x2={38 + value / 360 * 380} y1="190" y2="195" stroke="#52666d" /><text x={38 + value / 360 * 380} y="211" textAnchor="middle">{value}°</text></g>)}
      <text x="12" y="115" transform="rotate(-90 12 115)" textAnchor="middle">Probability</text>
    </svg>
    <p>有效 Hue n={group.chromatic.length} · 无彩色 n={group.rows.length - group.chromatic.length}</p>
  </article>)}</div>;
}

function RepresentativePalettes({ data }: { data: ExportRow[] }) {
  const sources = [...new Set(data.map(row => labelOf(row, "来源")))];
  return <div className="cluster-strip-list">{sources.map(source => {
    const parts = data.filter(row => labelOf(row, "来源") === source).sort((a, b) => valueOf(a, "代表色序号") - valueOf(b, "代表色序号"));
    return <article key={source}><div><b>{source}</b><span>K≤3 · CIELAB</span></div><div className="weighted-strip">{parts.map((part, index) => <i key={index} style={{ width: `${valueOf(part, "比例") * 100}%`, background: labelOf(part, "中心HEX") }}><span>{(valueOf(part, "比例") * 100).toFixed(0)}%</span><title>{labelOf(part, "中心HEX")} · L* {valueOf(part, "中心L").toFixed(1)} · a* {valueOf(part, "中心a").toFixed(1)} · b* {valueOf(part, "中心b").toFixed(1)}</title></i>)}</div></article>;
  })}</div>;
}

function EntropyBars({ data }: { data: ExportRow[] }) {
  const ordered = [...data].sort((a, b) => valueOf(b, "标准化色相熵") - valueOf(a, "标准化色相熵"));
  return <div className="simple-bars">{ordered.map((row, index) => <div key={`${labelOf(row, "来源")}-${labelOf(row, "情绪")}`}><span>{index + 1}. {labelOf(row, "来源")}</span><i><b style={{ width: `${valueOf(row, "标准化色相熵") * 100}%` }} /></i><strong>{valueOf(row, "标准化色相熵").toFixed(3)}</strong><small>n={valueOf(row, "有效色相N")}</small></div>)}</div>;
}

function overlapLayout(rows: CanonicalColorRow[], keyOf: (row: CanonicalColorRow) => string, enabled: boolean) {
  const totals = new Map<string, number>();
  rows.forEach(row => totals.set(keyOf(row), (totals.get(keyOf(row)) || 0) + 1));
  const seen = new Map<string, number>();
  return rows.map(row => {
    const key = keyOf(row), order = seen.get(key) || 0, count = totals.get(key) || 1;
    seen.set(key, order + 1);
    const distance = enabled && count > 1 ? Math.min(8, 2.25 * Math.sqrt(order)) : 0;
    const angle = order * 2.399963229728653;
    return { row, order, count, dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance };
  });
}

function coreBinKeys(rows: CanonicalColorRow[], kind: "hs" | "vs") {
  const hueBins = 24, radialBins = 8, bins = kind === "hs" ? [hueBins, radialBins] : [12, 12];
  const keyOf = (row: CanonicalColorRow) => {
    const x = kind === "hs" ? Math.min(bins[0] - 1, Math.floor((row.hsvH % 360) / 360 * bins[0])) : Math.min(bins[0] - 1, Math.floor(row.hsvS * bins[0]));
    const y = kind === "hs" ? Math.min(bins[1] - 1, Math.floor(row.hsvS * bins[1])) : Math.min(bins[1] - 1, Math.floor(row.hsvV * bins[1]));
    return `${x}\u0000${y}`;
  };
  const counts = new Map<string, number>(); rows.forEach(row => counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1));
  // A relative-density cutoff avoids a fixed cumulative-coverage boundary:
  // sparse cells fade, while cells at ≥18% of the local peak remain visible.
  const peak = Math.max(1, ...counts.values());
  const core = new Set([...counts.entries()].filter(([, count]) => count / peak >= .18).map(([key]) => key));
  return { core, keyOf, bins };
}

function hsDensityBins(rows: CanonicalColorRow[], hueBins = 24, saturationBins = 10) {
  const counts = Array.from({ length: hueBins * saturationBins }, () => 0);
  rows.forEach(row => {
    const x = Math.min(hueBins - 1, Math.floor((row.hsvH % 360) / 360 * hueBins));
    const y = Math.min(saturationBins - 1, Math.floor(row.hsvS * saturationBins));
    counts[y * hueBins + x] += 1;
  });
  return { counts, hueBins, saturationBins, max: Math.max(1, ...counts) };
}

function polarSectorPath(start: number, end: number, inner: number, outer: number) {
  const point = (angle: number, radius: number) => [110 + radius * Math.cos(angle), 110 + radius * Math.sin(angle)];
  const [x1, y1] = point(start, outer), [x2, y2] = point(end, outer), [x3, y3] = point(end, inner), [x4, y4] = point(start, inner);
  return `M ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x4} ${y4} Z`;
}

function hsNearestOpacity(rows: CanonicalColorRow[]) {
  if (rows.length < 2) return rows.map(() => .82);
  const points = rows.map(row => { const angle = row.hsvH * Math.PI / 180; return [row.hsvS * Math.cos(angle), row.hsvS * Math.sin(angle)]; });
  const distances = points.map((point, index) => Math.min(...points.filter((_, other) => other !== index).map(other => Math.hypot(point[0] - other[0], point[1] - other[1]))));
  const sorted = [...distances].sort((a, b) => a - b), low = sorted[Math.floor((sorted.length - 1) * .05)], high = sorted[Math.floor((sorted.length - 1) * .9)];
  return distances.map(distance => .14 + .72 * (1 - Math.max(0, Math.min(1, (distance - low) / Math.max(.000001, high - low)))));
}

function HsPolar({ rows, expandOverlaps, core70, proximity }: { rows: CanonicalColorRow[]; expandOverlaps: boolean; core70: boolean; proximity: boolean }) {
  return <div><div className="overlap-view-note"><span className={expandOverlaps || core70 || proximity ? "active" : ""}>{proximity ? "邻近密度已突出：近深远浅" : core70 ? "密度 hexbin 已叠加：保留原始色点" : expandOverlaps ? "重叠点已展开：×N 为同坐标观察数" : "原始坐标显示：重复观察会完全重叠"}</span><small>显示位移不进入统计或导出数据；邻近密度与密度底图仅作局部聚集的辅助阅读，不代表显著性</small></div><div className="facet-grid">{groupBySource(rows).map(group => { const layout=overlapLayout(group.rows.slice(0,1500),row=>`${row.hsvH.toFixed(2)}\u0000${row.hsvS.toFixed(3)}`,expandOverlaps), density=hsDensityBins(group.rows), nearby=hsNearestOpacity(group.rows); return <article className="chart-facet" key={group.source}><h4>{group.source}</h4><svg viewBox="0 0 220 220" role="img" aria-label={`${group.source} H-S 极坐标分布`}><circle className="polar-grid" cx="110" cy="110" r="40" /><circle className="polar-grid" cx="110" cy="110" r="80" />{core70 ? density.counts.map((count,index)=>{if(!count)return null;const h=index%density.hueBins,s=Math.floor(index/density.hueBins),start=h/density.hueBins*Math.PI*2,end=(h+1)/density.hueBins*Math.PI*2,inner=s/density.saturationBins*80,outer=(s+1)/density.saturationBins*80;return <path key={index} d={polarSectorPath(start,end,inner,outer)} fill="#277b92" opacity={.045+.25*count/density.max} />;}) : null}{[0,90,180,270].map(angle => { const rad=angle*Math.PI/180; return <line className="polar-grid" key={angle} x1="110" y1="110" x2={110+80*Math.cos(rad)} y2={110+80*Math.sin(rad)} />; })}{layout.map(({row,dx,dy},index)=>{const angle=row.hsvH*Math.PI/180, radius=row.hsvS*80, opacity=proximity ? nearby[index] : core70 ? (expandOverlaps ? .74 : .78) : (expandOverlaps ? .72 : .82);return <circle key={index} cx={110+radius*Math.cos(angle)+dx} cy={110+radius*Math.sin(angle)+dy} r={expandOverlaps?2.7:3.2} fill={row.hex} opacity={opacity}><title>{row.emotion} · H {round(row.hsvH,1)}° · S {round(row.hsvS,2)}</title></circle>;})}{expandOverlaps ? layout.filter(point=>point.order===0&&point.count>1).map(({row,count},index)=>{const angle=row.hsvH*Math.PI/180,radius=row.hsvS*80;return <text className="overlap-count-label" key={`count-${index}`} x={110+radius*Math.cos(angle)+7} y={110+radius*Math.sin(angle)-6}>×{count}</text>;}) : null}<text x="196" y="106">0°</text><text x="105" y="18">270°</text><text x="8" y="106">180°</text><text x="105" y="211">90°</text></svg><p>N={group.rows.length} · 半径=S，角度=H{proximity ? " · 邻近密度（近深远浅）" : core70 ? " · 密度 hexbin + 色点" : expandOverlaps ? " · 重复点已展开" : ""}</p></article>;})}</div></div>;
}

function VsDensity({ rows, expandOverlaps, core70 }: { rows: CanonicalColorRow[]; expandOverlaps: boolean; core70: boolean }) {
  return <div><div className="overlap-view-note"><span className={expandOverlaps || core70 ? "active" : ""}>{core70 ? "密度 hexbin 已叠加：保留原始色点" : expandOverlaps ? "重叠点已展开：×N 为同坐标观察数" : "原始坐标显示：重复观察会完全重叠"}</span><small>密度底图只帮助阅读聚集区域，不参与任何统计计算</small></div><div className="facet-grid">{groupBySource(rows).map(group => { const bins=12; const counts=Array.from({length:bins*bins},()=>0); group.rows.forEach(row=>{const x=Math.min(bins-1,Math.floor(row.hsvS*bins)),y=Math.min(bins-1,Math.floor(row.hsvV*bins));counts[y*bins+x]+=1;});const max=Math.max(1,...counts),layout=overlapLayout(group.rows.slice(0,1200),row=>`${row.hsvS.toFixed(3)}\u0000${row.hsvV.toFixed(3)}`,expandOverlaps);return <article className="chart-facet" key={group.source}><h4>{group.source}</h4><svg viewBox="0 0 260 220" role="img" aria-label={`${group.source} V-S 密度散点分布`}>{counts.map((count,index)=>{const x=index%bins,y=Math.floor(index/bins);return <rect key={index} x={34+x*17} y={190-(y+1)*14} width="17" height="14" fill="#277b92" opacity={count ? .04+.38*count/max : 0}/>;})}<line className="chart-axis" x1="34" y1="190" x2="238" y2="190"/><line className="chart-axis" x1="34" y1="22" x2="34" y2="190"/>{layout.map(({row,dx,dy},index)=><circle key={index} cx={34+row.hsvS*204+dx} cy={190-row.hsvV*168+dy} r={expandOverlaps?2.3:2.5} fill={row.hex} opacity={core70 ? (expandOverlaps ? .74 : .68) : .58}><title>{row.emotion} · S {round(row.hsvS,2)} · V {round(row.hsvV,2)}</title></circle>)}{expandOverlaps ? layout.filter(point=>point.order===0&&point.count>1).map(({row,count},index)=><text className="overlap-count-label" key={`count-${index}`} x={34+row.hsvS*204+7} y={190-row.hsvV*168-6}>×{count}</text>) : null}<text x="132" y="213">Saturation</text><text transform="translate(11 128) rotate(-90)">Value</text><text x="31" y="204">0</text><text x="232" y="204">1</text><text x="20" y="28">1</text></svg><p>N={group.rows.length} · {core70 ? "密度 hexbin + 色点" : "底色为 12×12 二维密度"}{expandOverlaps ? " · 重复点已展开" : ""}</p></article>;})}</div></div>;
}

function LabAbDensity({ rows, clusters, showCentroids, showDensity }: { rows: CanonicalColorRow[]; clusters: ExportRow[]; showCentroids: boolean; showDensity: boolean }) {
  const groups = groupBySource(rows);
  const largestCoordinate = Math.max(1, ...rows.flatMap(row => [Math.abs(row.labA), Math.abs(row.labB)]));
  const limit = Math.max(40, Math.ceil(largestCoordinate / 20) * 20);
  const bins = 14;
  const plotX = 38, plotY = 18, plotSize = 218;
  const xOf = (value: number) => plotX + (value + limit) / (limit * 2) * plotSize;
  const yOf = (value: number) => plotY + plotSize - (value + limit) / (limit * 2) * plotSize;
  return <div>
    <div className="lab-scale-note">{showDensity ? <span><i className="lab-density-key" />密度格</span> : null}{showCentroids ? <span><i className="lab-centroid-key" />组中心</span> : null}{clusters.length ? <span>× Lab 聚类中心</span> : null}<b>全部分面使用同一坐标范围 ±{limit}</b></div>
    <div className="facet-grid">{groups.map(group => {
      const counts = Array.from({ length: bins * bins }, () => 0);
      group.rows.forEach(row => {
        const x = Math.min(bins - 1, Math.max(0, Math.floor((row.labA + limit) / (limit * 2) * bins)));
        const y = Math.min(bins - 1, Math.max(0, Math.floor((row.labB + limit) / (limit * 2) * bins)));
        counts[y * bins + x] += 1;
      });
      const peak = Math.max(1, ...counts);
      const meanA = group.rows.reduce((sum, row) => sum + row.labA, 0) / group.rows.length;
      const meanB = group.rows.reduce((sum, row) => sum + row.labB, 0) / group.rows.length;
      const chroma = group.rows.map(row => Math.hypot(row.labA, row.labB));
      const stride = Math.max(1, Math.ceil(group.rows.length / 800));
      const sourceClusters = clusters.filter(cluster => labelOf(cluster, "来源") === group.source);
      return <article className="chart-facet lab-ab-facet" key={group.source}>
        <div className="lab-facet-title"><h4>{group.source}</h4><span>N={group.rows.length}</span></div>
        <svg viewBox="0 0 276 270" role="img" aria-label={`${group.source} CIELAB a 星 b 星色域密度分布`}>
          {showDensity ? counts.map((count, index) => {
            if (!count) return null;
            const x = index % bins, y = Math.floor(index / bins), cell = plotSize / bins;
            return <rect key={index} x={plotX + x * cell} y={plotY + plotSize - (y + 1) * cell} width={cell} height={cell} fill="#277b92" opacity={.06 + .48 * count / peak}><title>格内 N={count}</title></rect>;
          }) : null}
          <line className="lab-zero-axis" x1={xOf(0)} x2={xOf(0)} y1={plotY} y2={plotY + plotSize} />
          <line className="lab-zero-axis" x1={plotX} x2={plotX + plotSize} y1={yOf(0)} y2={yOf(0)} />
          <rect className="lab-plot-frame" x={plotX} y={plotY} width={plotSize} height={plotSize} />
          {group.rows.map((row, index) => index % stride === 0 ? <circle key={index} cx={xOf(row.labA)} cy={yOf(row.labB)} r="2.35" fill={row.hex} opacity=".64"><title>{row.emotion} · L* {round(row.labL, 1)} · a* {round(row.labA, 1)} · b* {round(row.labB, 1)}</title></circle> : null)}
          {showCentroids ? <><circle className="lab-centroid-halo" cx={xOf(meanA)} cy={yOf(meanB)} r="7" /><circle className="lab-centroid" cx={xOf(meanA)} cy={yOf(meanB)} r="3.7"><title>组中心 a* {round(meanA, 1)} · b* {round(meanB, 1)}</title></circle></> : null}
          {sourceClusters.map((cluster, index) => <g key={`cluster-${index}`}><circle cx={xOf(valueOf(cluster, "中心a"))} cy={yOf(valueOf(cluster, "中心b"))} r={4 + 7 * valueOf(cluster, "簇权重")} fill={labelOf(cluster, "中心HEX")} stroke="#172e39" strokeWidth="1.2" /><path d={`M ${xOf(valueOf(cluster, "中心a")) - 3.5} ${yOf(valueOf(cluster, "中心b")) - 3.5} L ${xOf(valueOf(cluster, "中心a")) + 3.5} ${yOf(valueOf(cluster, "中心b")) + 3.5} M ${xOf(valueOf(cluster, "中心a")) + 3.5} ${yOf(valueOf(cluster, "中心b")) - 3.5} L ${xOf(valueOf(cluster, "中心a")) - 3.5} ${yOf(valueOf(cluster, "中心b")) + 3.5}`} stroke="#172e39" strokeWidth="1.25" /><title>簇 {valueOf(cluster, "簇")} · K={valueOf(cluster, "最佳K")} · 权重 {(valueOf(cluster, "簇权重") * 100).toFixed(0)}%</title></g>)}
          <text x={plotX} y="252" textAnchor="start">绿 −a*</text><text x={plotX + plotSize} y="252" textAnchor="end">+a* 红</text>
          <text x="24" y={plotY + 5} textAnchor="middle">黄</text><text x="24" y={plotY + plotSize} textAnchor="middle">蓝</text>
        </svg>
        <p>中心 a* {meanA.toFixed(1)} / b* {meanB.toFixed(1)} · 中位 C*ab {quantile(chroma, .5).toFixed(1)}</p>
      </article>;
    })}</div>
    <p className="chart-note">密度格用于判断热点和多中心；彩色散点保留实际选色。a* 为绿–红轴，b* 为蓝–黄轴，图中不混用 HSL 明度。</p>
  </div>;
}

function LabAbPolar({ rows, clusters, showCentroids, showDensity }: { rows: CanonicalColorRow[]; clusters: ExportRow[]; showCentroids: boolean; showDensity: boolean }) {
  const groups = groupBySource(rows);
  const maxChroma = Math.max(40, Math.ceil(Math.max(1, ...rows.map(row => Math.hypot(row.labA, row.labB))) / 20) * 20);
  const thetaBins = 18, chromaBins = 8, center = 110, radius = 80;
  const point = (a: number, b: number) => { const theta = -Math.atan2(b, a), r = Math.min(1, Math.hypot(a, b) / maxChroma) * radius; return [center + r * Math.cos(theta), center + r * Math.sin(theta)]; };
  return <div>
    <div className="lab-scale-note">{showDensity ? <span><i className="lab-density-key" />极坐标密度扇区</span> : null}{showCentroids ? <span><i className="lab-centroid-key" />组中心</span> : null}{clusters.length ? <span>× Lab 聚类中心</span> : null}<b>全部分面使用同一 C* 上限 {maxChroma}</b></div>
    <div className="facet-grid">{groups.map(group => {
      const counts = Array.from({ length: thetaBins * chromaBins }, () => 0);
      group.rows.forEach(row => { const theta = (Math.atan2(row.labB, row.labA) + Math.PI * 2) % (Math.PI * 2), t = Math.min(thetaBins - 1, Math.floor(theta / (Math.PI * 2) * thetaBins)), r = Math.min(chromaBins - 1, Math.floor(Math.min(.999999, Math.hypot(row.labA, row.labB) / maxChroma) * chromaBins)); counts[r * thetaBins + t] += 1; });
      const peak = Math.max(1, ...counts), meanA = group.rows.reduce((sum, row) => sum + row.labA, 0) / group.rows.length, meanB = group.rows.reduce((sum, row) => sum + row.labB, 0) / group.rows.length, chroma = group.rows.map(row => Math.hypot(row.labA, row.labB)), sourceClusters = clusters.filter(cluster => labelOf(cluster, "来源") === group.source), stride = Math.max(1, Math.ceil(group.rows.length / 800));
      return <article className="chart-facet lab-ab-facet" key={group.source}><div className="lab-facet-title"><h4>{group.source}</h4><span>N={group.rows.length}</span></div><svg viewBox="0 0 220 230" role="img" aria-label={`${group.source} CIELAB 色度方向极坐标分布`}><circle className="polar-grid" cx={center} cy={center} r={radius / 3} /><circle className="polar-grid" cx={center} cy={center} r={radius * 2 / 3} /><circle className="polar-grid" cx={center} cy={center} r={radius} />{showDensity ? counts.map((count, index) => { if (!count) return null; const theta = index % thetaBins, r = Math.floor(index / thetaBins), start = -(theta + 1) / thetaBins * Math.PI * 2, end = -theta / thetaBins * Math.PI * 2; return <path key={index} d={polarSectorPath(start, end, r / chromaBins * radius, (r + 1) / chromaBins * radius)} fill="#277b92" opacity={.06 + .48 * count / peak}><title>扇区 N={count}</title></path>; }) : null}{[0, Math.PI / 2, Math.PI, Math.PI * 3 / 2].map(theta => <line className="polar-grid" key={theta} x1={center} y1={center} x2={center + radius * Math.cos(theta)} y2={center - radius * Math.sin(theta)} />)}{group.rows.map((row, index) => { if (index % stride) return null; const [x, y] = point(row.labA, row.labB); return <circle key={index} cx={x} cy={y} r="2.35" fill={row.hex} opacity=".64"><title>{row.emotion} · C* {Math.hypot(row.labA, row.labB).toFixed(1)} · a* {round(row.labA, 1)} · b* {round(row.labB, 1)}</title></circle>; })}{showCentroids ? (() => { const [x, y] = point(meanA, meanB); return <><circle className="lab-centroid-halo" cx={x} cy={y} r="7" /><circle className="lab-centroid" cx={x} cy={y} r="3.7"><title>组中心 a* {round(meanA, 1)} · b* {round(meanB, 1)}</title></circle></>; })() : null}{sourceClusters.map((cluster, index) => { const [x, y] = point(valueOf(cluster, "中心a"), valueOf(cluster, "中心b")); return <g key={`cluster-${index}`}><circle cx={x} cy={y} r={4 + 7 * valueOf(cluster, "簇权重")} fill={labelOf(cluster, "中心HEX")} stroke="#172e39" strokeWidth="1.2" /><path d={`M ${x - 3.5} ${y - 3.5} L ${x + 3.5} ${y + 3.5} M ${x + 3.5} ${y - 3.5} L ${x - 3.5} ${y + 3.5}`} stroke="#172e39" strokeWidth="1.25" /></g>; })}<text x="198" y="108">+a* 红</text><text x="110" y="18">+b* 黄</text><text x="22" y="108">−a* 绿</text><text x="110" y="211">−b* 蓝</text></svg><p>中位 C*ab {quantile(chroma, .5).toFixed(1)} · 半径=C*ab，角度=色相方向</p></article>;
    })}</div>
    <p className="chart-note">极坐标将 a*–b* 平面转换为“色度（半径）× 色相方向（角度）”；它只是同一 CIELAB 数据的另一种呈现，不能与 HSV 的 H–S 图混用。</p>
  </div>;
}

function histogram(values: number[], bins: number, maxValue: number) {
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach(value => {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(value / Math.max(1, maxValue) * bins)));
    counts[index] += 1;
  });
  return counts;
}

function DistributionStrip({ values, maxValue, label, color }: { values: number[]; maxValue: number; label: string; color: string }) {
  const bins = 20, counts = histogram(values, bins, maxValue), peak = Math.max(1, ...counts);
  const min = Math.min(...values), q1 = quantile(values, .25), median = quantile(values, .5), q3 = quantile(values, .75), max = Math.max(...values);
  const xOf = (value: number) => 14 + Math.min(1, Math.max(0, value / maxValue)) * 392;
  return <figure className="lab-distribution-figure">
    <figcaption><b>{label}</b><span>中位数 {median.toFixed(1)} · IQR {(q3 - q1).toFixed(1)}</span></figcaption>
    <svg viewBox="0 0 420 96" role="img" aria-label={`${label} 直方图与箱线概览`}>
      {counts.map((count, index) => <rect key={index} x={14 + index * (392 / bins) + 1} y={61 - count / peak * 48} width={392 / bins - 2} height={count / peak * 48} fill={color} opacity={.22 + .66 * count / peak}><title>N={count}</title></rect>)}
      <line className="distribution-baseline" x1="14" x2="406" y1="62" y2="62" />
      <line className="distribution-whisker" x1={xOf(min)} x2={xOf(max)} y1="76" y2="76" />
      <line className="distribution-whisker" x1={xOf(min)} x2={xOf(min)} y1="70" y2="82" />
      <line className="distribution-whisker" x1={xOf(max)} x2={xOf(max)} y1="70" y2="82" />
      <rect className="distribution-box" x={xOf(q1)} y="68" width={Math.max(2, xOf(q3) - xOf(q1))} height="16" style={{ fill: color }} />
      <line className="distribution-median" x1={xOf(median)} x2={xOf(median)} y1="67" y2="85" />
      <text x="14" y="94" textAnchor="start">0</text><text x="406" y="94" textAnchor="end">{maxValue.toFixed(0)}</text>
    </svg>
  </figure>;
}

function LabDistributions({ rows }: { rows: CanonicalColorRow[] }) {
  const groups = groupBySource(rows);
  const allChroma = rows.map(row => Math.hypot(row.labA, row.labB));
  const chromaMax = Math.max(20, Math.ceil(Math.max(...allChroma) / 20) * 20);
  return <div className="lab-distribution-list">
    <div className="lab-scale-note"><span>L* 固定 0–100</span><span>C*ab 统一 0–{chromaMax}</span><b>箱体为 IQR，须线为当前范围</b></div>
    {groups.map(group => {
      const lightness = group.rows.map(row => row.labL);
      const chroma = group.rows.map(row => Math.hypot(row.labA, row.labB));
      const center = [
        group.rows.reduce((sum, row) => sum + row.labL, 0) / group.rows.length,
        group.rows.reduce((sum, row) => sum + row.labA, 0) / group.rows.length,
        group.rows.reduce((sum, row) => sum + row.labB, 0) / group.rows.length,
      ];
      const centerDistances = group.rows.map(row => Math.hypot(row.labL - center[0], row.labA - center[1], row.labB - center[2]));
      const cohorts = [...new Set(group.rows.map(row => row.cohort))].join(" / ");
      return <article className="lab-distribution-card" key={group.source}>
        <header><div><h4>{group.source}</h4><span>{cohorts} · N={group.rows.length}</span></div><small>ΔE76 越低，组内越集中</small></header>
        <div className="lab-distribution-body">
          <div className="lab-distribution-plots">
            <DistributionStrip values={lightness} maxValue={100} label="知觉明度 L*" color="#277b92" />
            <DistributionStrip values={chroma} maxValue={chromaMax} label="色度 C*ab" color="#d47d55" />
          </div>
          <dl className="lab-concentration">
            <div><dt>中心距离中位数</dt><dd>{quantile(centerDistances, .5).toFixed(1)}<small>ΔE76</small></dd></div>
            <div><dt>90% 中心半径</dt><dd>{quantile(centerDistances, .9).toFixed(1)}<small>ΔE76</small></dd></div>
            <div><dt>L* 中间 50%</dt><dd>{quantile(lightness, .25).toFixed(1)}–{quantile(lightness, .75).toFixed(1)}</dd></div>
            <div><dt>C*ab 中间 50%</dt><dd>{quantile(chroma, .25).toFixed(1)}–{quantile(chroma, .75).toFixed(1)}</dd></div>
          </dl>
        </div>
      </article>;
    })}
    <p className="chart-note">C*ab = √(a*²+b*²)。中心距离采用 CIELAB 欧氏距离（ΔE76）作描述性集中度；显著性判断仍应结合组内色差与置换检验。</p>
  </div>;
}

function Mosaic({ rows }: { rows: CanonicalColorRow[] }) {
  return <div className="mosaic-facets">{groupBySource(rows).map(group=><article key={group.source}><div><h4>{group.source}</h4><span>N={group.rows.length}</span></div><div className="raw-mosaic">{group.rows.slice(0,600).map((row,index)=><i key={index} style={{background:row.hex}}><span>{row.emotion}<br/>{row.hex}</span></i>)}</div>{group.rows.length>600?<p>为保证页面性能，仅显示前 600 个；CSV 保留全部。</p>:null}</article>)}</div>;
}

function ClusterStrips({ data }: { data: ExportRow[] }) {
  const keys=[...new Set(data.map(row=>`${labelOf(row,"来源")}\u0000${labelOf(row,"情绪")}`))];
  return <div className="cluster-strip-list">{keys.map(key=>{const[source,emotion]=key.split("\u0000"),parts=data.filter(row=>labelOf(row,"来源")===source&&labelOf(row,"情绪")===emotion).sort((a,b)=>valueOf(b,"簇权重")-valueOf(a,"簇权重"));return <article key={key}><div><b>{emotion}</b><span>{source} · K={parts[0]?.["最佳K"]}</span></div><div className="weighted-strip">{parts.map((part,index)=><i key={index} style={{width:`${valueOf(part,"簇权重")*100}%`,background:labelOf(part,"中心HEX")}}><span>{(valueOf(part,"簇权重")*100).toFixed(0)}%</span></i>)}</div></article>;})}</div>;
}

function WithinDelta({ data }: { data: ExportRow[] }) {
  const max=Math.max(1,...data.map(row=>valueOf(row,"全部样本对平均ΔE76")));
  return <div className="delta-bars">{[...data].sort((a,b)=>valueOf(b,"平均最近邻ΔE76")-valueOf(a,"平均最近邻ΔE76")).map((row,index)=><article key={index}><span><b>{labelOf(row,"情绪")}</b><small>{labelOf(row,"来源")} · N={row["样本数"]}</small></span><div><i style={{width:`${valueOf(row,"全部样本对平均ΔE76")/max*100}%`}}/><em style={{left:`${valueOf(row,"平均最近邻ΔE76")/max*100}%`}}/></div><strong>{valueOf(row,"平均最近邻ΔE76").toFixed(1)} / {valueOf(row,"全部样本对平均ΔE76").toFixed(1)}</strong></article>)}</div>;
}

function pairName(row: ExportRow) { return `${labelOf(row,"来源A")}–${labelOf(row,"来源B")}`; }
function DeltaHeatmap({ data }: { data: ExportRow[] }) {
  const pairs=[...new Set(data.map(pairName))], emotions=[...new Set(data.map(row=>labelOf(row,"情绪")))], max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76")));
  return <div className="heatmap-wrap"><div className="delta-heatmap" style={{gridTemplateColumns:`135px repeat(${pairs.length},minmax(72px,1fr))`}}><span/>{pairs.map(pair=><b key={pair}>{pair}</b>)}{emotions.map(emotion=><Fragment key={emotion}><strong>{emotion}</strong>{pairs.map(pair=>{const row=data.find(item=>labelOf(item,"情绪")===emotion&&pairName(item)===pair),value=row?valueOf(row,"对称最小ΔE76"):NaN;return <i key={`${emotion}-${pair}`} style={{background:Number.isFinite(value)?`color-mix(in srgb, #b74747 ${15+75*value/max}%, #eef4f3)`:"#f1f2f0"}}><span>{Number.isFinite(value)?value.toFixed(1):"—"}</span></i>;})}</Fragment>)} </div></div>;
}

function quantile(values:number[],q:number){const sorted=[...values].sort((a,b)=>a-b),pos=(sorted.length-1)*q,base=Math.floor(pos),rest=pos-base;return sorted[base]+(sorted[base+1]!==undefined?rest*(sorted[base+1]-sorted[base]):0);}
function DeltaBox({ data }: { data: ExportRow[] }) {
  const pairs=[...new Set(data.map(pairName))],max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76")));
  return <svg className="boxplot-chart" viewBox={`0 0 820 ${90+pairs.length*62}`} role="img" aria-label="来源对色差箱线图">{pairs.map((pair,index)=>{const values=data.filter(row=>pairName(row)===pair).map(row=>valueOf(row,"对称最小ΔE76")),min=Math.min(...values),maxV=Math.max(...values),q1=quantile(values,.25),med=quantile(values,.5),q3=quantile(values,.75),y=60+index*62,scale=(v:number)=>170+v/max*600;return <g key={pair}><text x="10" y={y+5}>{pair}</text><line x1={scale(min)} x2={scale(maxV)} y1={y} y2={y}/><rect x={scale(q1)} y={y-13} width={Math.max(2,scale(q3)-scale(q1))} height="26"/><line className="median" x1={scale(med)} x2={scale(med)} y1={y-13} y2={y+13}/>{values.map((value,i)=><circle key={i} cx={scale(value)} cy={y+(i%3-1)*4} r="2.7"><title>{value.toFixed(2)}</title></circle>)}</g>;})}<line className="chart-axis" x1="170" x2="770" y1={60+pairs.length*62} y2={60+pairs.length*62}/><text x="470" y={84+pairs.length*62}>对称最小 ΔE76</text></svg>;
}

function DeltaMean({ data }: { data: ExportRow[] }) {
  const pairs=[...new Set(data.map(pairName))], summaries=pairs.map(pair=>{const values=data.filter(row=>pairName(row)===pair).map(row=>valueOf(row,"对称最小ΔE76"));const mean=values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);const sd=Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/Math.max(1,values.length-1));return {pair,mean,sd,n:values.length};}).sort((a,b)=>b.mean-a.mean);
  const human=pairs.find(pair=>pair.includes("CN")&&pair.includes("BW"))||pairs[0],baseline=human?quantile(data.filter(row=>pairName(row)===human).map(row=>valueOf(row,"对称最小ΔE76")),.5):0,max=Math.max(1,baseline,...summaries.map(item=>item.mean+item.sd));
  return <svg className="mean-bar-chart" viewBox={`0 0 850 ${120+summaries.length*62}`} role="img" aria-label="来源对平均色差与人类基线比较">{baseline>0?<g><line className="baseline-line" x1={190+baseline/max*590} x2={190+baseline/max*590} y1="38" y2={76+summaries.length*62}/><text x={196+baseline/max*590} y="30">{human} 中位数基线 {baseline.toFixed(1)}</text></g>:null}{summaries.map((item,index)=>{const y=62+index*62,x=190,width=item.mean/max*590,error=item.sd/max*590;return <g key={item.pair}><text x="12" y={y+17}>{item.pair}</text><rect x={x} y={y} width={width} height="28" fill={SERIES[index%SERIES.length]}/><line x1={x+width-error} x2={x+width+error} y1={y+14} y2={y+14}/><line x1={x+width-error} x2={x+width-error} y1={y+8} y2={y+20}/><line x1={x+width+error} x2={x+width+error} y1={y+8} y2={y+20}/><text x={x+width+error+7} y={y+19}>{item.mean.toFixed(1)} ± {item.sd.toFixed(1)} · n={item.n}</text></g>})}<line className="chart-axis" x1="190" x2="780" y1={84+summaries.length*62} y2={84+summaries.length*62}/><text x="450" y={109+summaries.length*62}>平均对称最小 ΔE76</text></svg>;
}

function Radar({ data }: { data: ExportRow[] }) {
  const pairs=[...new Set(data.map(pairName))].slice(0,6), emotions=[...new Set(data.map(row=>labelOf(row,"情绪")))],max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76"))),cx=300,cy=290,r=220;
  const point=(index:number,value:number)=>{const angle=-Math.PI/2+index/emotions.length*Math.PI*2;return `${cx+Math.cos(angle)*r*value/max},${cy+Math.sin(angle)*r*value/max}`;};
  return <div className="radar-layout"><svg className="radar-chart" viewBox="0 0 650 590" role="img" aria-label="情绪色差雷达图">{[.25,.5,.75,1].map(level=><polygon className="radar-grid" key={level} points={emotions.map((_,i)=>point(i,max*level)).join(" ")}/>) }{emotions.map((emotion,i)=>{const p=point(i,max);const[labelX,labelY]=p.split(",").map(Number);return <g key={emotion}><line className="radar-grid" x1={cx} y1={cy} x2={labelX} y2={labelY}/><text x={labelX} y={labelY} dx={labelX<cx?-5:5}>{emotion}</text></g>;})}{pairs.map((pair,pairIndex)=><polyline key={pair} fill="none" stroke={SERIES[pairIndex]} strokeWidth="2.5" points={`${emotions.map((emotion,i)=>point(i,valueOf(data.find(row=>labelOf(row,"情绪")===emotion&&pairName(row)===pair)||{},"对称最小ΔE76"))).join(" ")} ${point(0,valueOf(data.find(row=>labelOf(row,"情绪")===emotions[0]&&pairName(row)===pair)||{},"对称最小ΔE76"))}`}/>)}</svg><div className="chart-legend">{pairs.map((pair,index)=><span key={pair}><i style={{background:SERIES[index]}}/>{pair}</span>)}</div></div>;
}

function Dumbbell({ data }: { data: ExportRow[] }) {
  const pairs=[...new Set(data.map(pairName))], emotions=[...new Set(data.map(row=>labelOf(row,"情绪")))], max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76")));
  const ordered=[...emotions].sort((a,b)=>{const mean=(emotion:string)=>{const values=data.filter(row=>labelOf(row,"情绪")===emotion).map(row=>valueOf(row,"对称最小ΔE76"));return values.reduce((s,v)=>s+v,0)/Math.max(1,values.length);};return mean(b)-mean(a);});
  return <div className="dumbbell-list">{ordered.map(emotion=>{const values=pairs.map(pair=>({pair,value:valueOf(data.find(row=>labelOf(row,"情绪")===emotion&&pairName(row)===pair)||{},"对称最小ΔE76")})),min=Math.min(...values.map(item=>item.value)),maxV=Math.max(...values.map(item=>item.value));return <article key={emotion}><b>{emotion}</b><div><i style={{left:`${min/max*100}%`,width:`${(maxV-min)/max*100}%`}}/>{values.map((item,index)=><em key={item.pair} style={{left:`${item.value/max*100}%`,background:SERIES[index%SERIES.length]}}><span>{item.pair}: {item.value.toFixed(1)}</span></em>)}</div></article>;})}</div>;
}

function Parity({ data, sources, referenceA, referenceB }: { data: ExportRow[]; sources:string[]; referenceA:string; referenceB:string }) {
  const targets=sources.filter(source=>source!==referenceA&&source!==referenceB),emotions=[...new Set(data.map(row=>labelOf(row,"情绪")))],max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76")));
  return <div className="facet-grid">{targets.map((target,targetIndex)=><article className="chart-facet" key={target}><h4>{referenceA}–{target} vs {referenceA}–{referenceB}</h4><svg viewBox="0 0 260 230"><line className="parity-line" x1="35" y1="195" x2="230" y2="25"/><line className="chart-axis" x1="35" y1="195" x2="235" y2="195"/><line className="chart-axis" x1="35" y1="20" x2="35" y2="195"/>{emotions.map(emotion=>{const x=deltaValue(data,emotion,referenceA,referenceB),y=deltaValue(data,emotion,referenceA,target);return Number.isFinite(x)&&Number.isFinite(y)?<circle key={emotion} cx={35+x/max*195} cy={195-y/max*170} r="4" fill={SERIES[targetIndex]}><title>{emotion} · 基线 {x.toFixed(1)} · 目标 {y.toFixed(1)}</title></circle>:null})}<text x="132" y="221">{referenceA}–{referenceB} 基线 ΔE</text><text transform="translate(10 150) rotate(-90)">{referenceA}–{target} ΔE</text></svg></article>)}</div>;
}

function biasRows(data:ExportRow[],a:string,b:string){return data.filter(row=>labelOf(row,"参照A")===a&&labelOf(row,"参照B")===b);}
function BiasBars({ data, referenceA, referenceB }: { data: ExportRow[]; sources?: string[]; referenceA:string; referenceB:string }) {
  const filtered=biasRows(data,referenceA,referenceB),targets=[...new Set(filtered.map(row=>labelOf(row,"目标来源")))],max=Math.max(1,...filtered.map(row=>Math.abs(valueOf(row,"偏置指数_B减A"))));
  return <div className="bias-facets">{targets.map(target=><article key={target}><h4>{target}</h4><p>← 更接近 {referenceB} · 更接近 {referenceA} →</p>{filtered.filter(row=>labelOf(row,"目标来源")===target).sort((a,b)=>valueOf(a,"偏置指数_B减A")-valueOf(b,"偏置指数_B减A")).map((row,index)=>{const value=valueOf(row,"偏置指数_B减A");return <div key={index}><b>{labelOf(row,"情绪")}</b><i><em className={value>=0?"positive":"negative"} style={{width:`${Math.abs(value)/max*50}%`}}/></i><span>{value>0?"+":""}{value.toFixed(1)}</span></div>})}</article>)}</div>;
}

function Gravity({ data, sources, referenceA, referenceB }: { data:ExportRow[]; sources:string[]; referenceA:string; referenceB:string }) {
  const targets=sources.filter(source=>source!==referenceA&&source!==referenceB),emotions=[...new Set(data.map(row=>labelOf(row,"情绪")))],max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76")));
  return <div className="facet-grid">{targets.map((target,index)=><article className="chart-facet" key={target}><h4>{target}</h4><svg viewBox="0 0 260 230"><polygon className="zone-a" points="35,195 235,195 235,20"/><polygon className="zone-b" points="35,195 35,20 235,20"/><line className="parity-line" x1="35" y1="195" x2="235" y2="20"/><line className="chart-axis" x1="35" y1="195" x2="235" y2="195"/><line className="chart-axis" x1="35" y1="20" x2="35" y2="195"/>{emotions.map(emotion=>{const x=deltaValue(data,emotion,referenceB,target),y=deltaValue(data,emotion,referenceA,target);return Number.isFinite(x)&&Number.isFinite(y)?<circle key={emotion} cx={35+x/max*200} cy={195-y/max*175} r="4" fill={SERIES[index]}><title>{emotion} · 至 {referenceB} {x.toFixed(1)} · 至 {referenceA} {y.toFixed(1)}</title></circle>:null})}<text x="132" y="221">至 {referenceB} ΔE</text><text transform="translate(10 145) rotate(-90)">至 {referenceA} ΔE</text></svg><p>对角线下方更接近 {referenceA}，上方更接近 {referenceB}</p></article>)}</div>;
}

function Slopegraph({ data, sources, referenceA, referenceB }: { data:ExportRow[]; sources:string[]; referenceA:string; referenceB:string }) {
  const targets=sources.filter(source=>source!==referenceA&&source!==referenceB),emotions=[...new Set(data.map(row=>labelOf(row,"情绪")))],max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76")));
  return <div className="facet-grid">{targets.map(target=><article className="chart-facet slope-facet" key={target}><h4>{target}</h4><svg viewBox="0 0 300 250" role="img" aria-label={`${target} 到两个文化参照的色差斜率图`}><line className="chart-axis" x1="82" x2="82" y1="25" y2="208"/><line className="chart-axis" x1="218" x2="218" y1="25" y2="208"/>{emotions.map(emotion=>{const a=deltaValue(data,emotion,referenceA,target),b=deltaValue(data,emotion,referenceB,target);if(!Number.isFinite(a)||!Number.isFinite(b))return null;const yA=208-a/max*178,yB=208-b/max*178,closerA=a<b;return <g key={emotion}><line x1="82" y1={yA} x2="218" y2={yB} stroke={closerA?"#277b92":"#d47d55"} opacity=".64" strokeWidth="2"><title>{emotion} · {referenceA} {a.toFixed(1)} · {referenceB} {b.toFixed(1)}</title></line><circle cx="82" cy={yA} r="3" fill={closerA?"#277b92":"#d47d55"}/><circle cx="218" cy={yB} r="3" fill={closerA?"#277b92":"#d47d55"}/></g>})}<text x="82" y="232" textAnchor="middle">{referenceA}</text><text x="218" y="232" textAnchor="middle">{referenceB}</text><text transform="translate(18 158) rotate(-90)">到 {target} 的 ΔE</text></svg><p>蓝线：更接近 {referenceA} · 橙线：更接近 {referenceB}</p></article>)}</div>;
}

function BiasDensity({ data, referenceA, referenceB }: { data:ExportRow[]; referenceA:string; referenceB:string }) {
  const filtered=biasRows(data,referenceA,referenceB),targets=[...new Set(filtered.map(row=>labelOf(row,"目标来源")))],max=Math.max(1,...filtered.map(row=>Math.abs(valueOf(row,"偏置指数_B减A")))),bins=14;
  return <div className="density-stack">{targets.map((target,targetIndex)=>{const values=filtered.filter(row=>labelOf(row,"目标来源")===target).map(row=>valueOf(row,"偏置指数_B减A")),counts=Array.from({length:bins},()=>0);values.forEach(value=>{const index=Math.min(bins-1,Math.max(0,Math.floor((value+max)/(2*max)*bins)));counts[index]+=1;});const peak=Math.max(1,...counts);return <article key={target}><h4>{target}</h4><svg viewBox="0 0 700 150"><line className="chart-axis" x1="45" y1="120" x2="670" y2="120"/><line className="neutral-line" x1="357" y1="18" x2="357" y2="120"/>{counts.map((count,index)=><rect key={index} x={45+index*(625/bins)+2} y={120-count/peak*88} width={625/bins-4} height={count/peak*88} fill={SERIES[targetIndex%SERIES.length]}/>) }<text x="45" y="142">更接近 {referenceB}</text><text x="357" y="142">0</text><text x="670" y="142">更接近 {referenceA}</text></svg></article>;})}</div>;
}

function averageLinkageOrder(labels:string[],vectors:number[][]){
  if(labels.length<2)return labels;
  let clusters=labels.map((label,index)=>({labels:[label],indices:[index]}));
  const vectorDistance=(a:number[],b:number[])=>Math.sqrt(a.reduce((sum,value,index)=>sum+(value-b[index])**2,0));
  const clusterDistance=(a:{indices:number[]},b:{indices:number[]})=>{let total=0,count=0;a.indices.forEach(i=>b.indices.forEach(j=>{total+=vectorDistance(vectors[i],vectors[j]);count+=1;}));return total/Math.max(1,count);};
  while(clusters.length>1){let bestA=0,bestB=1,best=Infinity;clusters.forEach((a,i)=>clusters.slice(i+1).forEach((b,offset)=>{const j=i+offset+1,distance=clusterDistance(a,b);if(distance<best){best=distance;bestA=i;bestB=j;}}));const merged={labels:[...clusters[bestA].labels,...clusters[bestB].labels],indices:[...clusters[bestA].indices,...clusters[bestB].indices]};clusters=clusters.filter((_,index)=>index!==bestA&&index!==bestB);clusters.push(merged);}
  return clusters[0].labels;
}

function DifficultyHeatmap({ data, sources, reference }: { data:ExportRow[]; sources:string[]; reference:string }) {
  const models=sources.filter(source=>source!==reference),allEmotions=[...new Set(data.map(row=>labelOf(row,"情绪")))],rawVectors=allEmotions.map(emotion=>models.map(model=>{const value=deltaValue(data,emotion,reference,model);return Number.isFinite(value)?value:0;})),emotions=averageLinkageOrder(allEmotions,rawVectors),modelVectors=models.map(model=>allEmotions.map(emotion=>{const value=deltaValue(data,emotion,reference,model);return Number.isFinite(value)?value:0;})),orderedModels=averageLinkageOrder(models,modelVectors),max=Math.max(1,...data.map(row=>valueOf(row,"对称最小ΔE76")));
  return <div className="heatmap-wrap"><div className="delta-heatmap difficulty-heatmap" style={{gridTemplateColumns:`135px repeat(${orderedModels.length},minmax(82px,1fr))`}}><span/>{orderedModels.map(model=><b key={model}>{reference}–{model}</b>)}{emotions.map(emotion=><Fragment key={emotion}><strong>{emotion}</strong>{orderedModels.map(model=>{const value=deltaValue(data,emotion,reference,model);return <i key={`${emotion}-${model}`} style={{background:Number.isFinite(value)?`color-mix(in srgb, #263b59 ${12+82*value/max}%, #edf1ec)`:"#f1f2f0"}}><span>{Number.isFinite(value)?value.toFixed(1):"—"}</span></i>})}</Fragment>)}</div><p className="chart-note">行和列按平均连接层次聚类排序；颜色越深，情绪色彩匹配难度越高。</p></div>;
}

function RankHeatmap({ data, sources, reference }: { data:ExportRow[]; sources:string[]; reference:string }) {
  const models=sources.filter(source=>source!==reference),emotions=[...new Set(data.map(row=>labelOf(row,"情绪")))];
  return <div className="heatmap-wrap"><div className="rank-heatmap" style={{gridTemplateColumns:`135px repeat(${models.length},minmax(72px,1fr))`}}><span/>{models.map(model=><b key={model}>{model}</b>)}{emotions.map(emotion=>{const ranked=models.map(model=>({model,value:deltaValue(data,emotion,reference,model)})).filter(item=>Number.isFinite(item.value)).sort((a,b)=>a.value-b.value);return <Fragment key={emotion}><strong>{emotion}</strong>{models.map(model=>{const value=deltaValue(data,emotion,reference,model),rank=ranked.findIndex(item=>item.model===model)+1;return <i key={`${emotion}-${model}`} data-rank={rank}><span>{rank||"—"}</span><small>{Number.isFinite(value)?value.toFixed(1):"—"} ΔE</small></i>})}</Fragment>})}</div></div>;
}

function VisualEmpty(){return <div className="dashboard-empty"><span>○</span><b>当前筛选没有足够数据</b><small>跨来源图表至少需要两个来源；偏置图至少需要三个来源。</small></div>;}
