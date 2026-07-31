"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, type ExportRow } from "./engine";
import { downloadPublicationPng } from "./export-png";
import { FigureExportControls, type FigureExportStyle } from "./FigureExportControls";

type View = "groups" | "groupMatrix" | "pairDifference" | "paired" | "symmetry" | "asymmetry" | "scatter";
type QMetric = "probability" | "conditional" | "overall";
type CohortSummaryMetric = "rank" | "jsd" | "top1" | "asymmetry";
const VIEW_TITLES: Record<View, string> = {
  groups: "八组情绪指标总览",
  groupMatrix: "8×8 组间矩阵",
  pairDifference: "任选两组差值",
  paired: "八来源 P / Q 明细",
  symmetry: "单来源情绪一致性",
  asymmetry: "方向差热图（综合）",
  scatter: "双向散点（综合）",
};
const Q_METRICS: Record<QMetric, { label: string; field: string; rank: string; jsd: string }> = {
  probability: { label: "关联概率", field: "色选词归一化概率", rank: "情绪颜色排序Spearman_概率", jsd: "JSD相似度_关联概率" },
  conditional: { label: "条件强度", field: "色选词归一化条件强度", rank: "情绪颜色排序Spearman_条件强度", jsd: "JSD相似度_条件强度" },
  overall: { label: "综合强度（含零值）", field: "色选词归一化综合_Q", rank: "情绪颜色排序Spearman_综合", jsd: "JSD相似度_综合" },
};

function numberOf(row: ExportRow, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}
function optionalNumberOf(row: ExportRow, key: string) {
  if (row[key] === null || row[key] === undefined || row[key] === "") return null;
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : null;
}
function labelOf(row: ExportRow, key: string) { return String(row[key] ?? ""); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function cohortLabel(value: string) { return value === "human" ? "人类" : value === "ai" ? "AI" : "未标记"; }

export function BidirectionalVisualLab({ rows }: { rows: ExportRow[] }) {
  const sources = useMemo(() => [...new Set(rows.map(row => labelOf(row, "来源")))].filter(Boolean), [rows]);
  const sourceCohorts = useMemo(() => new Map(sources.map(source => [source, labelOf(rows.find(row => labelOf(row, "来源") === source) || {}, "组类型")])), [rows, sources]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedEmotion, setSelectedEmotion] = useState("");
  const [selectedA, setSelectedA] = useState(""), [selectedB, setSelectedB] = useState("");
  const [view, setView] = useState<View>("groups");
  const [qMetric, setQMetric] = useState<QMetric>("probability");
  const [exportStyle, setExportStyle] = useState<FigureExportStyle>({ columns: 3, width: 1800, scale: 2, showTitle: true });
  const canvasRef = useRef<HTMLDivElement>(null);
  const source = sources.includes(selectedSource) ? selectedSource : sources[0] || "";
  const emotions = GEW_EMOTIONS.filter(emotion => rows.some(row => labelOf(row, "情绪") === emotion));
  const emotion = emotions.includes(selectedEmotion as typeof GEW_EMOTIONS[number]) ? selectedEmotion : emotions[0] || "";
  const visible = rows.filter(row => labelOf(row, "来源") === source);
  const emotionRows = GEW_EMOTIONS.flatMap(emotion => {
    const row = visible.find(item => labelOf(item, "情绪") === emotion);
    return row ? [row] : [];
  });
  const uniqueSourceEmotionRows = sources.flatMap(item => GEW_EMOTIONS.flatMap(itemEmotion => {
    const row = rows.find(candidate => labelOf(candidate, "来源") === item && labelOf(candidate, "情绪") === itemEmotion);
    return row ? [row] : [];
  }));
  const effectiveA = sources.includes(selectedA) ? selectedA : (sources[0] || "");
  const effectiveB = sources.includes(selectedB) && selectedB !== effectiveA ? selectedB : (sources.find(item => item !== effectiveA) || "");
  const groupSummaries = sources.map(item => {
    const sourceRows = uniqueSourceEmotionRows.filter(row => labelOf(row, "来源") === item);
    const meanField = (field: string) => {
      const values = sourceRows.flatMap(row => { const value = optionalNumberOf(row, field); return value === null ? [] : [value]; });
      return values.length ? average(values) : null;
    };
    return {
      source: item, cohort: sourceCohorts.get(item) || "unspecified",
      rank: meanField(Q_METRICS[qMetric].rank), jsd: meanField(Q_METRICS[qMetric].jsd),
      top1: sourceRows.length ? average(sourceRows.map(row => row["Top1相互首选"] ? 1 : 0)) : null,
      asymmetry: meanField("平均绝对非对称"),
    };
  });

  if (!rows.length) return <div className="dashboard-empty"><span>⇄</span><b>需要同一来源的两项实验数据</b><small>词选色和色选词都存在时，平台才会生成群体层面的双向一致性。</small></div>;

  return <section className="bidirectional-lab panel python-paper-view" style={{ "--figure-columns": exportStyle.columns } as React.CSSProperties}>
    <div className="panel-head bidirectional-head">
      <div><span className="eyebrow">EIGHT-GROUP BIDIRECTIONAL COMPARISON</span><h3>四个人类组与四个 AI 组双向比较</h3><p>8个试验组全部保留为独立比较单位；人类/AI只作为组标签，不在默认看板中合并。</p></div>
      {!["groups", "groupMatrix", "pairDifference", "paired"].includes(view) ? <label>来源<select value={source} onChange={event => setSelectedSource(event.target.value)}>{sources.map(item => <option key={item}>{item}</option>)}</select></label> : <label>Q 口径<select value={qMetric} onChange={event => setQMetric(event.target.value as QMetric)}>{Object.entries(Q_METRICS).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select></label>}
    </div>
    <div className="visual-tabs" role="tablist" aria-label="双向一致性视图">
      <button className={view === "groups" ? "active" : ""} onClick={() => setView("groups")}>八组情绪指标总览</button>
      <button className={view === "groupMatrix" ? "active" : ""} onClick={() => setView("groupMatrix")}>8×8 组间矩阵</button>
      <button className={view === "pairDifference" ? "active" : ""} onClick={() => setView("pairDifference")}>任选两组差值</button>
      <button className={view === "paired" ? "active" : ""} onClick={() => setView("paired")}>八来源 P / Q 明细</button>
      <button className={view === "symmetry" ? "active" : ""} onClick={() => setView("symmetry")}>单来源情绪一致性</button>
      <button className={view === "asymmetry" ? "active" : ""} onClick={() => setView("asymmetry")}>方向差热图（综合）</button>
      <button className={view === "scatter" ? "active" : ""} onClick={() => setView("scatter")}>双向散点（综合）</button>
    </div>
    <FigureExportControls value={exportStyle} onChange={setExportStyle} onExport={() => canvasRef.current && void downloadPublicationPng(canvasRef.current, `bidirectional_${view}.png`, {
      minimumWidth: exportStyle.width,
      minimumHeight: Math.max(760, Math.round(exportStyle.width * .62)),
      scale: exportStyle.scale,
      showTitle: exportStyle.showTitle,
      title: VIEW_TITLES[view],
      subtitle: `${sources.length} 个独立来源 · 当前 Q 口径：${Q_METRICS[qMetric].label}`,
    }).catch(error => window.alert(error instanceof Error ? error.message : "PNG 导出失败。"))} disabled={!rows.length} />
    <div className="bidirectional-canvas" ref={canvasRef}>
      {view === "groups" ? <EightGroupOverview rows={uniqueSourceEmotionRows} qMetric={qMetric} sources={sources} sourceCohorts={sourceCohorts} /> : null}
      {view === "groupMatrix" ? <BidirectionalGroupMatrix rows={uniqueSourceEmotionRows} qMetric={qMetric} sources={sources} sourceCohorts={sourceCohorts} /> : null}
      {view === "pairDifference" ? <BidirectionalPairDifference rows={rows} qMetric={qMetric} sourceA={effectiveA} sourceB={effectiveB} sources={sources} onSourceA={setSelectedA} onSourceB={setSelectedB} /> : null}
      {view === "paired" ? <PairedProbabilityFacets rows={rows} emotion={emotion} emotions={emotions} onEmotionChange={setSelectedEmotion} qMetric={qMetric} onQMetricChange={setQMetric} sourceCohorts={sourceCohorts} /> : null}
      {view === "symmetry" ? <SymmetryPlot rows={emotionRows} qMetric={qMetric} /> : null}
      {view === "asymmetry" ? <AsymmetryHeatmap rows={visible} /> : null}
      {view === "scatter" ? <BidirectionalScatter rows={visible} /> : null}
    </div>
    <div className="bidirectional-group-summaries">{groupSummaries.map(item => <article key={item.source}><header><b>{item.source}</b><small className={`cohort-tag ${item.cohort}`}>{cohortLabel(item.cohort)}</small></header><div><span>ρ <strong>{item.rank === null ? "—" : item.rank.toFixed(3)}</strong></span><span>1−JSD <strong>{item.jsd === null ? "—" : item.jsd.toFixed(3)}</strong></span><span>Top-1 <strong>{item.top1 === null ? "—" : `${(item.top1 * 100).toFixed(1)}%`}</strong></span><span>|P−Q| <strong>{item.asymmetry === null ? "—" : item.asymmetry.toFixed(3)}</strong></span></div></article>)}</div>
    <p className="chart-note">每张摘要卡对应一个独立试验组，共8组；切换Q口径会同步更新排序一致性和分布相似度。双向整合为组级结构比较，不解释为同一参与者的回认率。</p>
  </section>;
}

const COHORT_SUMMARY_METRICS: Record<CohortSummaryMetric, { label: string; minimum: number; maximum: number }> = {
  rank: { label: "排序一致性 Spearman", minimum: -1, maximum: 1 },
  jsd: { label: "分布相似度 1−JSD", minimum: 0, maximum: 1 },
  top1: { label: "Top-1 相互首选", minimum: 0, maximum: 1 },
  asymmetry: { label: "平均绝对非对称", minimum: 0, maximum: 1 },
};

function metricValue(row: ExportRow, metric: CohortSummaryMetric, qMetric: QMetric) {
  return metric === "rank" ? optionalNumberOf(row, Q_METRICS[qMetric].rank) : metric === "jsd" ? optionalNumberOf(row, Q_METRICS[qMetric].jsd) : metric === "top1" ? (row["Top1相互首选"] ? 1 : 0) : optionalNumberOf(row, "平均绝对非对称");
}

function EightGroupOverview({ rows, qMetric, sources, sourceCohorts }: { rows: ExportRow[]; qMetric: QMetric; sources: string[]; sourceCohorts: Map<string, string> }) {
  const [metric, setMetric] = useState<CohortSummaryMetric>("rank");
  const config = COHORT_SUMMARY_METRICS[metric];
  const ordered = [...sources].sort((a, b) => {
    const rank = (source: string) => sourceCohorts.get(source) === "human" ? 0 : sourceCohorts.get(source) === "ai" ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return <div className="eight-group-overview">
    <div className="cohort-view-head"><div><span>8 GROUPS × 20 EMOTIONS</span><h4>八组双向指标热图</h4><p>每列是一个独立试验组，每行是一个情绪；同一指标使用统一尺度，可直接横向比较八组。</p></div><label>比较指标<select value={metric} onChange={event => setMetric(event.target.value as CohortSummaryMetric)}>{Object.entries(COHORT_SUMMARY_METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label></div>
    <div className="eight-group-emotion-grid" style={{ gridTemplateColumns: `125px repeat(${ordered.length},minmax(82px,1fr))` }}>
      <span />{ordered.map(source => <b className={`cohort-${sourceCohorts.get(source)}`} key={source}>{source}<small>{cohortLabel(sourceCohorts.get(source) || "")}</small></b>)}
      {GEW_EMOTIONS.map(emotion => <div className="grid-row" key={emotion}><strong>{emotion}</strong>{ordered.map(source => {
        const row = rows.find(item => labelOf(item, "来源") === source && labelOf(item, "情绪") === emotion), value = row ? metricValue(row, metric, qMetric) : null;
        const normalized = value === null ? 0 : (value - config.minimum) / (config.maximum - config.minimum);
        const background = value === null ? "#f0f2f0" : metric === "rank" && value < 0 ? `rgba(190,88,67,${.08 + Math.abs(value) * .82})` : `rgba(39,123,146,${.08 + Math.max(0, normalized) * .82})`;
        return <i key={source} style={{ background }} title={`${source} · ${emotion}: ${value === null ? "—" : value.toFixed(3)}`}><span>{value === null ? "—" : value.toFixed(2)}</span></i>;
      })}</div>)}
    </div><p className="chart-note">{metric === "rank" || metric === "jsd" ? `当前 Q 口径：${Q_METRICS[qMetric].label}` : "Top-1与非对称性使用综合强度口径。"} 人类/AI颜色标签仅帮助识别，不参与合并计算。</p>
  </div>;
}

function profileCorrelation(a: number[], b: number[]) {
  if (a.length < 2 || a.length !== b.length) return null;
  const meanA = average(a), meanB = average(b);
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0) * b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominator ? numerator / denominator : null;
}

function BidirectionalGroupMatrix({ rows, qMetric, sources, sourceCohorts }: { rows: ExportRow[]; qMetric: QMetric; sources: string[]; sourceCohorts: Map<string, string> }) {
  const [metric, setMetric] = useState<CohortSummaryMetric>("rank");
  const [mode, setMode] = useState<"difference" | "mae" | "correlation">("mae");
  const ordered = [...sources].sort((a, b) => (sourceCohorts.get(a) === "human" ? 0 : 1) - (sourceCohorts.get(b) === "human" ? 0 : 1) || a.localeCompare(b));
  const vectors = new Map(ordered.map(source => [source, GEW_EMOTIONS.map(emotion => {
    const row = rows.find(item => item["来源"] === source && item["情绪"] === emotion);
    return row ? metricValue(row, metric, qMetric) : null;
  })]));
  const compare = (a: string, b: string) => {
    const pairs = (vectors.get(a) || []).flatMap((value, index) => value === null || vectors.get(b)?.[index] === null ? [] : [{ a: value, b: vectors.get(b)![index] as number }]);
    if (!pairs.length) return null;
    if (mode === "difference") return average(pairs.map(pair => pair.a - pair.b));
    if (mode === "mae") return average(pairs.map(pair => Math.abs(pair.a - pair.b)));
    return profileCorrelation(pairs.map(pair => pair.a), pairs.map(pair => pair.b));
  };
  const values = ordered.flatMap(a => ordered.map(b => a === b ? null : compare(a, b))).filter((value): value is number => value !== null);
  const limit = Math.max(.01, ...values.map(Math.abs));
  return <div className="bidirectional-group-matrix-wrap"><div className="cohort-view-head"><div><span>ALL 28 GROUP PAIRS</span><h4>八组双向指标矩阵</h4><p>覆盖8组的全部28个组对；可比较跨20情绪的平均差、平均绝对差或轮廓相关。</p></div><div className="paired-display-controls"><label>指标<select value={metric} onChange={event => setMetric(event.target.value as CohortSummaryMetric)}>{Object.entries(COHORT_SUMMARY_METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label><label>矩阵值<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="mae">平均绝对差 MAE</option><option value="difference">行组−列组平均差</option><option value="correlation">20情绪轮廓相关</option></select></label></div></div>
    <div className="eight-group-matrix" style={{ gridTemplateColumns: `135px repeat(${ordered.length},minmax(74px,1fr))` }}><span />{ordered.map(source => <b className={`cohort-${sourceCohorts.get(source)}`} key={source}>{source}<small>{cohortLabel(sourceCohorts.get(source) || "")}</small></b>)}{ordered.map(a => <Fragment key={a}><strong className={`cohort-${sourceCohorts.get(a)}`}>{a}<small>{cohortLabel(sourceCohorts.get(a) || "")}</small></strong>{ordered.map(b => {
      if (a === b) return <i className="diagonal" key={`${a}-${b}`}>—</i>;
      const value = compare(a, b), strength = value === null ? 0 : Math.min(1, Math.abs(value) / limit);
      const background = value === null ? "#f0f2f0" : mode !== "mae" && value < 0 ? `rgba(39,123,146,${.08 + strength * .82})` : `rgba(190,88,67,${.08 + strength * .82})`;
      return <i key={`${a}-${b}`} style={{ background }} title={`${a} × ${b}: ${value === null ? "—" : value.toFixed(4)}`}>{value === null ? "—" : `${mode === "difference" && value > 0 ? "+" : ""}${value.toFixed(2)}`}</i>;
    })}</Fragment>)}</div><p className="chart-note">当前：{COHORT_SUMMARY_METRICS[metric].label} · {mode === "mae" ? "MAE越小越相似" : mode === "correlation" ? "相关越高，20情绪轮廓越相似" : "正值表示行组更高，负值表示列组更高"}。</p>
  </div>;
}

function BidirectionalPairDifference({ rows, qMetric, sourceA, sourceB, sources, onSourceA, onSourceB }: { rows: ExportRow[]; qMetric: QMetric; sourceA: string; sourceB: string; sources: string[]; onSourceA: (value: string) => void; onSourceB: (value: string) => void }) {
  const [metric, setMetric] = useState<"p" | "q" | "gap" | "harmony">("gap");
  const labels = { p: "词选色 P", q: `色选词 Q（${Q_METRICS[qMetric].label}）`, gap: "方向差 P−Q", harmony: "双向调和强度" };
  const rowValue = (row: ExportRow) => { const p = numberOf(row, "词选色概率_P"), q = numberOf(row, Q_METRICS[qMetric].field); return metric === "p" ? p : metric === "q" ? q : metric === "gap" ? p - q : p + q ? 2 * p * q / (p + q) : 0; };
  const difference = (emotion: string, code: string) => {
    const a = rows.find(row => row["来源"] === sourceA && row["情绪"] === emotion && row["标准色码"] === code), b = rows.find(row => row["来源"] === sourceB && row["情绪"] === emotion && row["标准色码"] === code);
    return a && b ? rowValue(a) - rowValue(b) : null;
  };
  const values = GEW_EMOTIONS.flatMap(emotion => GEW_COLOURS.map(code => difference(emotion, code))).filter((value): value is number => value !== null), limit = Math.max(.025, ...values.map(Math.abs));
  return <div className="pair-difference-view"><div className="cohort-view-head"><div><span>PAIRWISE DRILL-DOWN</span><h4>任选两个试验组的20×11差值</h4><p>直接显示来源A−来源B，定位两组差异具体落在哪些情绪与标准色。</p></div><div className="paired-display-controls"><label>来源A<select value={sourceA} onChange={event => onSourceA(event.target.value)}>{sources.map(item => <option key={item}>{item}</option>)}</select></label><label>来源B<select value={sourceB} onChange={event => onSourceB(event.target.value)}>{sources.filter(item => item !== sourceA).map(item => <option key={item}>{item}</option>)}</select></label><label>比较量<select value={metric} onChange={event => setMetric(event.target.value as typeof metric)}>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div></div>
    <div className="heatmap-wrap"><div className="bidirectional-heatmap" style={{ gridTemplateColumns: `125px repeat(${GEW_COLOURS.length},minmax(58px,1fr))` }}><span />{GEW_COLOURS.map(code => <b key={code}><i style={{ background: GEW_COLOR_HEX[code] }} />{code}</b>)}{GEW_EMOTIONS.map(emotion => <div className="heatmap-row" key={emotion}><strong>{emotion}</strong>{GEW_COLOURS.map(code => { const value = difference(emotion, code), strength = value === null ? 0 : Math.min(1, Math.abs(value) / limit), background = value === null ? "#f2f3f1" : value >= 0 ? `rgba(190,88,67,${.08 + strength * .82})` : `rgba(39,123,146,${.08 + strength * .82})`; return <i key={code} style={{ background }}><span>{value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`}</span></i>; })}</div>)}</div><div className="asymmetry-legend"><span>蓝：{sourceB}更高</span><i className="cohort-difference-scale" /><span>红：{sourceA}更高</span></div></div>
    <p className="chart-note">当前比较量：{labels[metric]}。这是两个独立试验组的描述性差值；可结合实验二的来源两两检验判断具体单元的统计证据。</p>
  </div>;
}

function PairedProbabilityFacets({ rows, emotion, emotions, onEmotionChange, qMetric, onQMetricChange, sourceCohorts }: { rows: ExportRow[]; emotion: string; emotions: readonly string[]; onEmotionChange: (emotion: string) => void; qMetric: QMetric; onQMetricChange: (metric: QMetric) => void; sourceCohorts: Map<string, string> }) {
  const sources = [...new Set(rows.map(row => labelOf(row, "来源")))].filter(Boolean).sort((a, b) => {
    const rank = (source: string) => sourceCohorts.get(source) === "human" ? 0 : sourceCohorts.get(source) === "ai" ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return <div className="paired-probability-display">
    <div className="paired-display-head"><div><span>DIRECT DISTRIBUTION</span><h4>同一情绪的双向概率色带</h4><p>P = 词选色映射比例；Q 可分别采用色选词的关联概率、条件强度或零值纳入综合强度。每个来源单独分面，口径不再混合。</p></div><div className="paired-display-controls"><label>情绪<select value={emotion} onChange={event => onEmotionChange(event.target.value)}>{emotions.map(item => <option key={item}>{item}</option>)}</select></label><label>Q 口径<select value={qMetric} onChange={event => onQMetricChange(event.target.value as QMetric)}>{Object.entries(Q_METRICS).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select></label></div></div>
    <div className="paired-display-legend"><span><i className="p-key" />P · 词选色映射比例</span><span><i className="q-key" />Q · {Q_METRICS[qMetric].label}</span><small>各方向分别归一化到 100%</small></div>
    <div className="paired-source-facets">{sources.map(source => {
      const sourceRows = rows.filter(row => labelOf(row, "来源") === source && labelOf(row, "情绪") === emotion);
      return <article key={source}>
        <header><h5>{source}<small className={`cohort-tag ${sourceCohorts.get(source)}`}>{cohortLabel(sourceCohorts.get(source) || "")}</small></h5><span>{emotion} · {sourceRows.reduce((sum, row) => sum + numberOf(row, "词选色映射样本数"), 0)} 个词选色样本</span></header>
        <div className="paired-color-grid">{GEW_COLOURS.map(code => {
          const row = sourceRows.find(item => labelOf(item, "标准色码") === code);
          const p = row ? numberOf(row, "词选色概率_P") : 0, q = row ? numberOf(row, Q_METRICS[qMetric].field) : 0;
          return <div className="paired-color-card" key={code} title={`${source} · ${emotion} · ${code}\nP=${p.toFixed(3)}\nQ=${q.toFixed(3)}`}>
            <div className="paired-color-name"><i style={{ background: GEW_COLOR_HEX[code] }} /><b>{code}</b><em className={p >= q ? "positive" : "negative"}>{p === q ? "P = Q" : `${p > q ? "P" : "Q"} +${Math.abs(p - q).toFixed(2)}`}</em></div>
            <div className="paired-meter"><span>P</span><i><em className="p-bar" style={{ width: `${p * 100}%` }} /></i><strong>{(p * 100).toFixed(1)}%</strong></div>
            <div className="paired-meter"><span>Q</span><i><em className="q-bar" style={{ width: `${q * 100}%` }} /></i><strong>{(q * 100).toFixed(1)}%</strong></div>
          </div>;
        })}</div>
      </article>;
    })}</div>
  </div>;
}

function SymmetryPlot({ rows, qMetric }: { rows: ExportRow[]; qMetric: QMetric }) {
  const ordered = [...rows].sort((a, b) => numberOf(b, Q_METRICS[qMetric].jsd) - numberOf(a, Q_METRICS[qMetric].jsd));
  return <div className="symmetry-list">
    <div className="symmetry-legend"><span><i className="rank-dot" />Spearman</span><span><i className="jsd-dot" />1 − JSD</span><small>中线对应 Spearman 0</small></div>
    {ordered.map(row => {
      const rank = numberOf(row, Q_METRICS[qMetric].rank), jsd = numberOf(row, Q_METRICS[qMetric].jsd);
      return <article key={labelOf(row, "情绪")}>
        <b>{labelOf(row, "情绪")}</b>
        <div className="symmetry-track">
          <i className="zero-line" />
          <em className="rank-dot" style={{ left: `${(rank + 1) / 2 * 100}%` }}><span>ρ {rank.toFixed(2)}</span></em>
          <em className="jsd-dot" style={{ left: `${jsd * 100}%` }}><span>JSD {jsd.toFixed(2)}</span></em>
        </div>
        <strong className={row["Top1相互首选"] ? "mutual" : ""}>{row["Top1相互首选"] ? "⇄ Top-1" : `Top-3 ${Math.round(numberOf(row, "Top3相互比例") * 3)}/3`}</strong>
      </article>;
    })}
  </div>;
}

function AsymmetryHeatmap({ rows }: { rows: ExportRow[] }) {
  const values = rows.map(row => numberOf(row, "方向差_P减Q"));
  const max = Math.max(.001, ...values.map(Math.abs));
  return <div className="heatmap-wrap"><div className="bidirectional-heatmap" style={{ gridTemplateColumns: `125px repeat(${GEW_COLOURS.length},minmax(58px,1fr))` }}>
    <span />
    {GEW_COLOURS.map(code => <b key={code}><i style={{ background: GEW_COLOR_HEX[code] }} />{code}</b>)}
    {GEW_EMOTIONS.map(emotion => <div className="heatmap-row" key={emotion}>
      <strong>{emotion}</strong>
      {GEW_COLOURS.map(code => {
        const row = rows.find(item => labelOf(item, "情绪") === emotion && labelOf(item, "标准色码") === code);
        const value = row ? numberOf(row, "方向差_P减Q") : NaN;
        const strength = Number.isFinite(value) ? Math.abs(value) / max : 0;
        const background = !Number.isFinite(value) ? "#f2f3f1" : value >= 0 ? `rgba(31,126,144,${.08 + strength * .82})` : `rgba(207,112,75,${.08 + strength * .82})`;
        return <i key={code} style={{ background }}><span>{Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}` : "—"}</span></i>;
      })}
    </div>)}
  </div><div className="asymmetry-legend"><span>橙：色选词更强（Q &gt; P）</span><i /><span>青：词选色更强（P &gt; Q）</span></div></div>;
}

function BidirectionalScatter({ rows }: { rows: ExportRow[] }) {
  const points = rows.map(row => ({ row, p: numberOf(row, "词选色概率_P"), q: numberOf(row, "色选词归一化综合_Q") }));
  const labels = [...points].sort((a, b) => Math.abs(b.p - b.q) - Math.abs(a.p - a.q)).slice(0, 8);
  return <div className="bidirectional-scatter-wrap"><svg className="bidirectional-scatter" viewBox="0 0 760 560" role="img" aria-label="词选色概率与色选词归一化综合评分散点图">
    {[0, .25, .5, .75, 1].map(tick => <g key={tick}><line className="grid" x1={75 + tick * 620} x2={75 + tick * 620} y1="40" y2="485" /><line className="grid" x1="75" x2="695" y1={485 - tick * 445} y2={485 - tick * 445} /><text x={75 + tick * 620} y="510">{tick.toFixed(2)}</text><text x="54" y={489 - tick * 445}>{tick.toFixed(2)}</text></g>)}
    <line className="parity-line" x1="75" y1="485" x2="695" y2="40" />
    <line className="chart-axis" x1="75" y1="485" x2="700" y2="485" /><line className="chart-axis" x1="75" y1="35" x2="75" y2="485" />
    {points.map((point, index) => {
      const code = labelOf(point.row, "标准色码");
      return <circle key={index} cx={75 + point.p * 620} cy={485 - point.q * 445} r="4.5" fill={GEW_COLOR_HEX[code as keyof typeof GEW_COLOR_HEX] || "#477"}><title>{labelOf(point.row, "情绪")} · {code} · P {point.p.toFixed(3)} · Q {point.q.toFixed(3)}</title></circle>;
    })}
    {labels.map((point, index) => <text className="point-label" key={index} x={82 + point.p * 620} y={480 - point.q * 445}>{labelOf(point.row, "情绪")}–{labelOf(point.row, "标准色码")}</text>)}
    <text className="axis-title" x="385" y="545">词选色概率 P(Color | Emotion)</text>
    <text className="axis-title" transform="translate(18 340) rotate(-90)">色选词归一化综合评分 Q</text>
  </svg><div className="scatter-quadrants"><span>颜色诱发型</span><span>双向稳定型</span><span>双向弱关联</span><span>情绪选择型</span></div></div>;
}
