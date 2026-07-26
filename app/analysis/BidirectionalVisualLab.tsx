"use client";

import { useMemo, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, type ExportRow } from "./engine";

type View = "paired" | "symmetry" | "asymmetry" | "scatter";

function numberOf(row: ExportRow, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}
function labelOf(row: ExportRow, key: string) { return String(row[key] ?? ""); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

export function BidirectionalVisualLab({ rows }: { rows: ExportRow[] }) {
  const sources = useMemo(() => [...new Set(rows.map(row => labelOf(row, "来源")))].filter(Boolean), [rows]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedEmotion, setSelectedEmotion] = useState("");
  const [view, setView] = useState<View>("paired");
  const source = sources.includes(selectedSource) ? selectedSource : sources[0] || "";
  const emotions = GEW_EMOTIONS.filter(emotion => rows.some(row => labelOf(row, "情绪") === emotion));
  const emotion = emotions.includes(selectedEmotion as typeof GEW_EMOTIONS[number]) ? selectedEmotion : emotions[0] || "";
  const visible = rows.filter(row => labelOf(row, "来源") === source);
  const emotionRows = GEW_EMOTIONS.flatMap(emotion => {
    const row = visible.find(item => labelOf(item, "情绪") === emotion);
    return row ? [row] : [];
  });
  const meanRank = average(emotionRows.map(row => numberOf(row, "情绪颜色排序Spearman_综合")));
  const meanJsd = average(emotionRows.map(row => numberOf(row, "JSD相似度_综合")));
  const top1Rate = average(emotionRows.map(row => row["Top1相互首选"] ? 1 : 0));
  const meanAsymmetry = average(emotionRows.map(row => numberOf(row, "平均绝对非对称")));

  if (!rows.length) return <div className="dashboard-empty"><span>⇄</span><b>需要同一来源的两项实验数据</b><small>词选色和色选词都存在时，平台才会生成群体层面的双向一致性。</small></div>;

  return <section className="bidirectional-lab panel">
    <div className="panel-head bidirectional-head">
      <div><span className="eyebrow">BIDIRECTIONAL CONSISTENCY</span><h3>双向情绪—颜色关联</h3><p>自由选色先按 CIEDE2000 映射到 11 个标准色，再与色选词的综合评分矩阵比较。</p></div>
      <label>来源<select value={source} onChange={event => setSelectedSource(event.target.value)}>{sources.map(item => <option key={item}>{item}</option>)}</select></label>
    </div>
    <div className="visual-tabs" role="tablist" aria-label="双向一致性视图">
      <button className={view === "paired" ? "active" : ""} onClick={() => setView("paired")}>P / Q 直接展陈</button>
      <button className={view === "symmetry" ? "active" : ""} onClick={() => setView("symmetry")}>情绪一致性</button>
      <button className={view === "asymmetry" ? "active" : ""} onClick={() => setView("asymmetry")}>方向差热图</button>
      <button className={view === "scatter" ? "active" : ""} onClick={() => setView("scatter")}>双向散点</button>
    </div>
    <div className="bidirectional-canvas">
      {view === "paired" ? <PairedProbabilityFacets rows={rows} emotion={emotion} emotions={emotions} onEmotionChange={setSelectedEmotion} /> : null}
      {view === "symmetry" ? <SymmetryPlot rows={emotionRows} /> : null}
      {view === "asymmetry" ? <AsymmetryHeatmap rows={visible} /> : null}
      {view === "scatter" ? <BidirectionalScatter rows={visible} /> : null}
    </div>
    <div className="bidirectional-kpis">
      <article><span>平均排序一致性</span><b>{meanRank.toFixed(3)}</b><small>Spearman · −1 至 1</small></article>
      <article><span>平均分布相似度</span><b>{meanJsd.toFixed(3)}</b><small>1 − JSD · 0 至 1</small></article>
      <article><span>Top-1 相互首选</span><b>{(top1Rate * 100).toFixed(1)}%</b><small>情绪 ⇄ 标准色</small></article>
      <article><span>平均绝对非对称</span><b>{meanAsymmetry.toFixed(3)}</b><small>mean |P − Q|</small></article>
    </div>
    <p className="chart-note">这是来源层面的结构一致性，不是同一参与者或同一 run 的回认率。高一致性可能表示稳定关联，也可能表示 AI 更依赖少数典型关系。</p>
  </section>;
}

function PairedProbabilityFacets({ rows, emotion, emotions, onEmotionChange }: { rows: ExportRow[]; emotion: string; emotions: readonly string[]; onEmotionChange: (emotion: string) => void }) {
  const sources = [...new Set(rows.map(row => labelOf(row, "来源")))].filter(Boolean);
  return <div className="paired-probability-display">
    <div className="paired-display-head"><div><span>DIRECT DISTRIBUTION</span><h4>同一情绪的双向概率色带</h4><p>P = 词选色中映射到该标准色的比例；Q = 色选词综合强度归一化后的比例。每个来源单独分面，横向同为 0–100%。</p></div><label>情绪<select value={emotion} onChange={event => onEmotionChange(event.target.value)}>{emotions.map(item => <option key={item}>{item}</option>)}</select></label></div>
    <div className="paired-display-legend"><span><i className="p-key" />P · 词选色</span><span><i className="q-key" />Q · 色选词</span><small>色块 = 11 个实验标准色</small></div>
    <div className="paired-source-facets">{sources.map(source => {
      const sourceRows = rows.filter(row => labelOf(row, "来源") === source && labelOf(row, "情绪") === emotion);
      return <article key={source}>
        <header><h5>{source}</h5><span>{emotion} · {sourceRows.reduce((sum, row) => sum + numberOf(row, "词选色映射样本数"), 0)} 个词选色样本</span></header>
        <div className="paired-color-grid">{GEW_COLOURS.map(code => {
          const row = sourceRows.find(item => labelOf(item, "标准色码") === code);
          const p = row ? numberOf(row, "词选色概率_P") : 0, q = row ? numberOf(row, "色选词归一化综合_Q") : 0;
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

function SymmetryPlot({ rows }: { rows: ExportRow[] }) {
  const ordered = [...rows].sort((a, b) => numberOf(b, "JSD相似度_综合") - numberOf(a, "JSD相似度_综合"));
  return <div className="symmetry-list">
    <div className="symmetry-legend"><span><i className="rank-dot" />Spearman</span><span><i className="jsd-dot" />1 − JSD</span><small>中线对应 Spearman 0</small></div>
    {ordered.map(row => {
      const rank = numberOf(row, "情绪颜色排序Spearman_综合"), jsd = numberOf(row, "JSD相似度_综合");
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
