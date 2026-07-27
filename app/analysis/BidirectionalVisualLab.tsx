"use client";

import { useMemo, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, type ExportRow } from "./engine";

type View = "cohort" | "cohortHeatmap" | "paired" | "symmetry" | "asymmetry" | "scatter";
type QMetric = "probability" | "conditional" | "overall";
type CohortSummaryMetric = "rank" | "jsd" | "top1" | "asymmetry";
type CohortCellMetric = "p" | "q" | "gap" | "harmony";
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
  const humanSources = sources.filter(source => sourceCohorts.get(source) === "human");
  const aiSources = sources.filter(source => sourceCohorts.get(source) === "ai");
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedEmotion, setSelectedEmotion] = useState("");
  const [view, setView] = useState<View>("cohort");
  const [qMetric, setQMetric] = useState<QMetric>("probability");
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
  const cohortMean = (cohort: "human" | "ai", field: string, boolean = false) => {
    const values = uniqueSourceEmotionRows.filter(row => labelOf(row, "组类型") === cohort).flatMap(row => {
      if (boolean) return [row[field] ? 1 : 0];
      const value = optionalNumberOf(row, field);
      return value === null ? [] : [value];
    });
    return values.length ? average(values) : null;
  };
  const groupKpis = [
    { label: "排序一致性", human: cohortMean("human", Q_METRICS[qMetric].rank), ai: cohortMean("ai", Q_METRICS[qMetric].rank), note: `${Q_METRICS[qMetric].label} · Spearman` },
    { label: "分布相似度", human: cohortMean("human", Q_METRICS[qMetric].jsd), ai: cohortMean("ai", Q_METRICS[qMetric].jsd), note: `${Q_METRICS[qMetric].label} · 1−JSD` },
    { label: "Top-1 相互首选率", human: cohortMean("human", "Top1相互首选", true), ai: cohortMean("ai", "Top1相互首选", true), note: "情绪 ⇄ 标准色" },
    { label: "平均绝对非对称", human: cohortMean("human", "平均绝对非对称"), ai: cohortMean("ai", "平均绝对非对称"), note: "mean |P−Q| · 综合口径" },
  ];

  if (!rows.length) return <div className="dashboard-empty"><span>⇄</span><b>需要同一来源的两项实验数据</b><small>词选色和色选词都存在时，平台才会生成群体层面的双向一致性。</small></div>;

  return <section className="bidirectional-lab panel">
    <div className="panel-head bidirectional-head">
      <div><span className="eyebrow">BETWEEN-GROUP BIDIRECTIONAL CONSISTENCY</span><h3>人类组与 AI 组双向关联比较</h3><p>默认以来源为独立单位比较人类与 AI；选择具体来源的图表保留在后面的下钻视图中。</p></div>
      {!["cohort", "cohortHeatmap", "paired"].includes(view) ? <label>来源<select value={source} onChange={event => setSelectedSource(event.target.value)}>{sources.map(item => <option key={item}>{item}</option>)}</select></label> : <label>Q 口径<select value={qMetric} onChange={event => setQMetric(event.target.value as QMetric)}>{Object.entries(Q_METRICS).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select></label>}
    </div>
    <div className="visual-tabs" role="tablist" aria-label="双向一致性视图">
      <button className={view === "cohort" ? "active" : ""} onClick={() => setView("cohort")}>人类–AI 组间总览</button>
      <button className={view === "cohortHeatmap" ? "active" : ""} onClick={() => setView("cohortHeatmap")}>AI−人类差值热图</button>
      <button className={view === "paired" ? "active" : ""} onClick={() => setView("paired")}>八来源 P / Q 明细</button>
      <button className={view === "symmetry" ? "active" : ""} onClick={() => setView("symmetry")}>单来源情绪一致性</button>
      <button className={view === "asymmetry" ? "active" : ""} onClick={() => setView("asymmetry")}>方向差热图（综合）</button>
      <button className={view === "scatter" ? "active" : ""} onClick={() => setView("scatter")}>双向散点（综合）</button>
    </div>
    <div className="bidirectional-canvas">
      {view === "cohort" ? <CohortOverview rows={uniqueSourceEmotionRows} qMetric={qMetric} humanSources={humanSources} aiSources={aiSources} /> : null}
      {view === "cohortHeatmap" ? <CohortBidirectionalHeatmap rows={rows} qMetric={qMetric} /> : null}
      {view === "paired" ? <PairedProbabilityFacets rows={rows} emotion={emotion} emotions={emotions} onEmotionChange={setSelectedEmotion} qMetric={qMetric} onQMetricChange={setQMetric} sourceCohorts={sourceCohorts} /> : null}
      {view === "symmetry" ? <SymmetryPlot rows={emotionRows} qMetric={qMetric} /> : null}
      {view === "asymmetry" ? <AsymmetryHeatmap rows={visible} /> : null}
      {view === "scatter" ? <BidirectionalScatter rows={visible} /> : null}
    </div>
    <div className="bidirectional-kpis group-kpis">{groupKpis.map(item => <article key={item.label}><span>{item.label}</span><div><em>人类 <b>{item.human === null ? "—" : item.human.toFixed(3)}</b></em><em>AI <b>{item.ai === null ? "—" : item.ai.toFixed(3)}</b></em></div><strong>{item.human === null || item.ai === null ? "差值 —" : `AI−人类 ${(item.ai - item.human) >= 0 ? "+" : ""}${(item.ai - item.human).toFixed(3)}`}</strong><small>{item.note}</small></article>)}</div>
    <p className="chart-note">组间汇总以来源×情绪为单位，四个人类来源和四个 AI 来源等权；这是来源层面的探索性结构比较，不是同一参与者或同一 run 的回认率。</p>
  </section>;
}

const COHORT_SUMMARY_METRICS: Record<CohortSummaryMetric, { label: string; minimum: number; maximum: number }> = {
  rank: { label: "排序一致性 Spearman", minimum: -1, maximum: 1 },
  jsd: { label: "分布相似度 1−JSD", minimum: 0, maximum: 1 },
  top1: { label: "Top-1 相互首选", minimum: 0, maximum: 1 },
  asymmetry: { label: "平均绝对非对称", minimum: 0, maximum: 1 },
};

function CohortOverview({ rows, qMetric, humanSources, aiSources }: { rows: ExportRow[]; qMetric: QMetric; humanSources: string[]; aiSources: string[] }) {
  const [metric, setMetric] = useState<CohortSummaryMetric>("rank");
  const config = COHORT_SUMMARY_METRICS[metric];
  const rowValue = (row: ExportRow) => metric === "rank" ? optionalNumberOf(row, Q_METRICS[qMetric].rank) : metric === "jsd" ? optionalNumberOf(row, Q_METRICS[qMetric].jsd) : metric === "top1" ? (row["Top1相互首选"] ? 1 : 0) : optionalNumberOf(row, "平均绝对非对称");
  const position = (value: number) => (value - config.minimum) / (config.maximum - config.minimum) * 100;
  if (!humanSources.length || !aiSources.length) return <div className="group-comparison-empty"><b>缺少完整的人类 / AI 来源标记</b><span>请确保上传数据中的组类型列可识别为 human 与 ai，并在顶部保留“全部来源”筛选。</span></div>;
  return <div className="cohort-overview">
    <div className="cohort-view-head"><div><span>BETWEEN-GROUP FIRST</span><h4>20 个情绪的人类–AI 来源分布</h4><p>每个圆点是一个来源；横线分别连接人类和 AI 的来源等权均值。重点比较组间位置，同时保留组内离散程度。</p></div><label>比较指标<select value={metric} onChange={event => setMetric(event.target.value as CohortSummaryMetric)}>{Object.entries(COHORT_SUMMARY_METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label></div>
    <div className="cohort-source-legend"><span><i className="human" />人类来源（n={humanSources.length}）</span><span><i className="ai" />AI 来源（n={aiSources.length}）</span><small>{metric === "rank" || metric === "jsd" ? `当前 Q：${Q_METRICS[qMetric].label}` : "综合强度口径"}</small></div>
    <div className="cohort-emotion-table">
      <header><b>情绪</b><span>人类来源分布</span><strong>人类均值</strong><span>AI 来源分布</span><strong>AI 均值</strong><em>AI−人类</em></header>
      {GEW_EMOTIONS.map(emotion => {
        const emotionRows = rows.filter(row => labelOf(row, "情绪") === emotion);
        const human = emotionRows.filter(row => labelOf(row, "组类型") === "human").map(row => ({ source: labelOf(row, "来源"), value: rowValue(row) })).filter((item): item is { source: string; value: number } => item.value !== null);
        const ai = emotionRows.filter(row => labelOf(row, "组类型") === "ai").map(row => ({ source: labelOf(row, "来源"), value: rowValue(row) })).filter((item): item is { source: string; value: number } => item.value !== null);
        const humanMean = human.length ? average(human.map(item => item.value)) : null, aiMean = ai.length ? average(ai.map(item => item.value)) : null;
        return <article key={emotion}><b>{emotion}</b><div className="cohort-mini-track">{metric === "rank" ? <i className="zero" /> : null}{human.map(item => <em className="human" key={item.source} style={{ left: `${position(item.value)}%` }} title={`${item.source}: ${item.value.toFixed(3)}`} />)}{humanMean !== null ? <strong className="human-mean" style={{ left: `${position(humanMean)}%` }} /> : null}</div><strong>{humanMean === null ? "—" : humanMean.toFixed(3)}</strong><div className="cohort-mini-track">{metric === "rank" ? <i className="zero" /> : null}{ai.map(item => <em className="ai" key={item.source} style={{ left: `${position(item.value)}%` }} title={`${item.source}: ${item.value.toFixed(3)}`} />)}{aiMean !== null ? <strong className="ai-mean" style={{ left: `${position(aiMean)}%` }} /> : null}</div><strong>{aiMean === null ? "—" : aiMean.toFixed(3)}</strong><i className={humanMean !== null && aiMean !== null && aiMean - humanMean >= 0 ? "positive" : "negative"}>{humanMean === null || aiMean === null ? "—" : `${aiMean - humanMean >= 0 ? "+" : ""}${(aiMean - humanMean).toFixed(3)}`}</i></article>;
      })}
    </div>
  </div>;
}

function CohortBidirectionalHeatmap({ rows, qMetric }: { rows: ExportRow[]; qMetric: QMetric }) {
  const [metric, setMetric] = useState<CohortCellMetric>("gap");
  const metricLabels: Record<CohortCellMetric, string> = { p: "词选色 P", q: `色选词 Q（${Q_METRICS[qMetric].label}）`, gap: "方向差 P−Q", harmony: "双向调和强度" };
  const valueOfRow = (row: ExportRow) => {
    const p = numberOf(row, "词选色概率_P"), q = numberOf(row, Q_METRICS[qMetric].field);
    return metric === "p" ? p : metric === "q" ? q : metric === "gap" ? p - q : p + q ? 2 * p * q / (p + q) : 0;
  };
  const cellDifference = (emotion: string, code: string) => {
    const cellRows = rows.filter(row => labelOf(row, "情绪") === emotion && labelOf(row, "标准色码") === code);
    const human = cellRows.filter(row => labelOf(row, "组类型") === "human").map(valueOfRow), ai = cellRows.filter(row => labelOf(row, "组类型") === "ai").map(valueOfRow);
    return human.length && ai.length ? average(ai) - average(human) : null;
  };
  const differences = GEW_EMOTIONS.flatMap(emotion => GEW_COLOURS.map(code => cellDifference(emotion, code))).filter((value): value is number => value !== null);
  const limit = Math.max(.025, ...differences.map(Math.abs));
  return <div className="cohort-bidirectional-heatmap">
    <div className="cohort-view-head"><div><span>AI − HUMAN</span><h4>双向关联单元的组间差值</h4><p>对每个情绪×标准色先计算各来源指标，再比较 AI 来源均值与人类来源均值。</p></div><label>比较量<select value={metric} onChange={event => setMetric(event.target.value as CohortCellMetric)}>{Object.entries(metricLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
    <div className="heatmap-wrap"><div className="bidirectional-heatmap" style={{ gridTemplateColumns: `125px repeat(${GEW_COLOURS.length},minmax(58px,1fr))` }}>
      <span />{GEW_COLOURS.map(code => <b key={code}><i style={{ background: GEW_COLOR_HEX[code] }} />{code}</b>)}
      {GEW_EMOTIONS.map(emotion => <div className="heatmap-row" key={emotion}><strong>{emotion}</strong>{GEW_COLOURS.map(code => {
        const value = cellDifference(emotion, code), strength = value === null ? 0 : Math.min(1, Math.abs(value) / limit);
        const background = value === null ? "#f2f3f1" : value >= 0 ? `rgba(190,88,67,${.08 + strength * .82})` : `rgba(39,123,146,${.08 + strength * .82})`;
        return <i key={code} style={{ background }} title={`${emotion} · ${code}\nAI−人类: ${value === null ? "—" : value.toFixed(4)}`}><span>{value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}`}</span></i>;
      })}</div>)}
    </div><div className="asymmetry-legend"><span>蓝：人类更高</span><i className="cohort-difference-scale" /><span>红：AI 更高</span></div></div>
    <p className="chart-note">当前比较量：{metricLabels[metric]}。这里展示来源等权均值差，属于描述性组间结果；双向整合尚无参与者级共同观测，因此不把它包装成个体层面的显著性检验。</p>
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
