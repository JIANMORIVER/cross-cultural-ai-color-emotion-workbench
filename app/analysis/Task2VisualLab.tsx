"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, runGewCompositeIndicators, runGewPatternSimilarity, runHumanAiGewCohortTest, toCsv, type AnalysisResult, type ExportRow, type GewRow } from "./engine";

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

export type Task2VisualLabProps = { data: GewRow[] | AnalysisResult; fileName?: string; visibleEmotion?: string };

const METRICS: Record<GewMetric, { label: string; maximum: number }> = {
  probability: { label: "关联概率", maximum: 1 },
  conditional: { label: "条件强度", maximum: 5 },
  overall: { label: "综合平均分", maximum: 5 },
};
const SERIES = ["#277b92", "#d47d55", "#4f8a70", "#8d6b94", "#b9973b", "#5675a7", "#b45d6b", "#657c82"];
const RATING_COLORS = ["#e8ece9", "#d9e8ea", "#b8d7dc", "#7fb6c1", "#3e8798", "#1f596b"];
const COMPOSITE_METRICS: Record<CompositeMetric, { label: string; mean: string; low: string; high: string; minimum: number; maximum: number }> = {
  broadness: { label: "情绪广度", mean: "平均情绪广度", low: "广度95CI下限", high: "广度95CI上限", minimum: 0, maximum: 20 },
  intensity: { label: "条件强度", mean: "平均条件强度", low: "条件强度95CI下限", high: "条件强度95CI上限", minimum: 1, maximum: 5 },
  valence: { label: "效价偏向", mean: "平均效价偏向", low: "效价偏向95CI下限", high: "效价偏向95CI上限", minimum: -1, maximum: 1 },
};

function numberOf(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}
function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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
async function downloadPng(element: HTMLElement, name: string) {
  const width = Math.max(1100, Math.ceil(element.scrollWidth)), height = Math.max(640, Math.ceil(element.scrollHeight));
  const css = [...document.styleSheets].map(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;min-height:${height}px;background:#f6f7f4;padding:20px;box-sizing:border-box"><style>${css}</style>${element.outerHTML}</div></foreignObject></svg>`;
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" })), image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("图表渲染失败")); image.src = url; });
  const canvas = document.createElement("canvas"); canvas.width = width * 2; canvas.height = height * 2;
  const context = canvas.getContext("2d"); if (!context) return;
  context.scale(2, 2); context.drawImage(image, 0, 0, width, height); URL.revokeObjectURL(url);
  canvas.toBlob(png => { if (!png) return; const pngUrl = URL.createObjectURL(png), anchor = document.createElement("a"); anchor.href = pngUrl; anchor.download = name; anchor.click(); URL.revokeObjectURL(pngUrl); }, "image/png");
}

export function Task2VisualLab({ data, fileName = "task2-gew", visibleEmotion }: Task2VisualLabProps) {
  const allCells = useMemo(() => normalizeGew(data), [data]);
  const cells = useMemo(() => visibleEmotion ? allCells.filter(cell => cell.emotion === visibleEmotion) : allCells, [allCells, visibleEmotion]);
  const rawRows = useMemo(() => Array.isArray(data) ? data.filter(row => row.valid) : [], [data]);
  const visibleRawRows = useMemo(() => visibleEmotion ? rawRows.filter(row => row.emotion === visibleEmotion) : rawRows, [rawRows, visibleEmotion]);
  const composite = useMemo(() => rawRows.length ? runGewCompositeIndicators(rawRows, 200).rows : [], [rawRows]);
  const pattern = useMemo(() => new Set(rawRows.map(row => row.color)).size >= GEW_COLOURS.length ? runGewPatternSimilarity(rawRows, 0).rows : [], [rawRows]);
  const sourceCohorts = useMemo(() => new Map(rawRows.map(row => [row.source, row.cohort])), [rawRows]);
  const humanSources = useMemo(() => [...sourceCohorts].filter(([, cohort]) => cohort === "human").map(([source]) => source), [sourceCohorts]);
  const aiSources = useMemo(() => [...sourceCohorts].filter(([, cohort]) => cohort === "ai").map(([source]) => source), [sourceCohorts]);
  const cohortComparison = useMemo(() => humanSources.length && aiSources.length ? runHumanAiGewCohortTest(rawRows).rows : [], [rawRows, humanSources.length, aiSources.length]);
  const visibleCohortComparison = useMemo(() => visibleEmotion ? cohortComparison.filter(row => row["情绪"] === visibleEmotion) : cohortComparison, [cohortComparison, visibleEmotion]);
  const sources = useMemo(() => [...new Set(cells.map(cell => cell.source))], [cells]);
  const colors = useMemo(() => [...new Set(cells.map(cell => cell.color))], [cells]);
  const [heatSource, setHeatSource] = useState(""), [profileSource, setProfileSource] = useState(""), [profileColor, setProfileColor] = useState("");
  const [ratingSource, setRatingSource] = useState(""), [ratingColor, setRatingColor] = useState("");
  const [displayMetric, setDisplayMetric] = useState<GewMetric>("probability");
  const [cohortMetric, setCohortMetric] = useState<GewMetric>("probability");
  const [groupColor, setGroupColor] = useState(""), [groupEmotion, setGroupEmotion] = useState("");
  const [compositeMetric, setCompositeMetric] = useState<CompositeMetric>("broadness");
  const [profileMetric, setProfileMetric] = useState<GewMetric>("overall"), [differenceA, setDifferenceA] = useState(""), [differenceB, setDifferenceB] = useState("");
  const [differenceMetric, setDifferenceMetric] = useState<GewMetric>("overall");
  const labRef = useRef<HTMLDivElement>(null);
  const effectiveHeat = sources.includes(heatSource) ? heatSource : (sources[0] || "");
  const effectiveProfileSource = sources.includes(profileSource) ? profileSource : effectiveHeat;
  const effectiveColor = colors.includes(profileColor) ? profileColor : (colors[0] || "");
  const effectiveRatingSource = sources.includes(ratingSource) ? ratingSource : effectiveHeat;
  const effectiveRatingColor = colors.includes(ratingColor) ? ratingColor : (colors[0] || "");
  const effectiveA = sources.includes(differenceA) ? differenceA : (sources[0] || "");
  const effectiveB = sources.includes(differenceB) && differenceB !== effectiveA ? differenceB : (sources.find(source => source !== effectiveA) || "");
  const effectiveGroupColor = colors.includes(groupColor) ? groupColor : (colors[0] || "");
  const visibleEmotions = GEW_EMOTIONS.filter(emotion => cells.some(cell => cell.emotion === emotion));
  const effectiveGroupEmotion = visibleEmotions.includes(groupEmotion as typeof GEW_EMOTIONS[number]) ? groupEmotion : (visibleEmotions[0] || "");
  const safeName = fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, "-");

  return <section className="task2-visual-lab visual-lab panel" ref={labRef}>
    <div className="visual-lab-head"><div><span className="eyebrow">GEW 关系结构精选视图</span><h3>颜色 × 情绪关联画像</h3><p>当前筛选 {cells.length.toLocaleString()} 个统计单元 · {sources.length} 个来源 · {colors.length} 种颜色</p></div><div className="visual-export"><button className="secondary" disabled={!cells.length} onClick={() => download(`${safeName}_gew-visual-data.csv`, toCsv(exportRows(cells)))}>导出描述数据 CSV</button><button className="primary" disabled={!cells.length} onClick={() => labRef.current && void downloadPng(labRef.current, `${safeName}_gew-visual-panel.png`)}>导出面板 PNG</button></div></div>
    {!cells.length ? <div className="task2-visual-empty"><span>◎</span><b>当前筛选没有可绘制的 GEW 数据</b><small>请保留来源、颜色、情绪、选择与强度字段。</small></div> : <>
      {visibleCohortComparison.length ? <article className="gew-view-block emphasis">
        <ViewHead index="01" code="AI − HUMAN" title="人类组与 AI 组来源均值差" note={`以来源为独立单位；比较 ${aiSources.length} 个 AI 来源均值与 ${humanSources.length} 个人类来源均值。圆点表示该单元在来源级精确置换检验后 FDR q<.05。`}><MetricSelect value={cohortMetric} onChange={setCohortMetric} /></ViewHead>
        <CohortDifferenceHeatmap rows={visibleCohortComparison} metric={cohortMetric} colors={colors} />
      </article> : <article className="gew-view-block emphasis">
        <ViewHead index="01" code="GROUP REQUIREMENT" title="人类–AI 组间比较尚未启用" note="需要同时导入并正确标记 human 与 ai 来源；仅选择单个来源时也会暂时隐藏总体组间比较。"><span className="analysis-count">当前 {sources.length} 个来源</span></ViewHead>
      </article>}
      <article className="gew-view-block">
        <ViewHead index="02" code="SOURCE-LEVEL CONTRAST" title="指定单元的八来源并列比较" note="每个点代表一个来源，按人类组与 AI 组分栏；粗线为该类别的来源等权均值，避免按原始行数加权。"><div className="gew-inline-controls"><Select label="颜色" value={effectiveGroupColor} onChange={setGroupColor} options={colors} /><Select label="情绪" value={effectiveGroupEmotion} onChange={setGroupEmotion} options={visibleEmotions} /><MetricSelect value={cohortMetric} onChange={setCohortMetric} /></div></ViewHead>
        <SourceGroupComparison cells={cells} sourceCohorts={sourceCohorts} color={effectiveGroupColor} emotion={effectiveGroupEmotion} metric={cohortMetric} />
      </article>
      {pattern.length ? <article className="gew-view-block">
        <ViewHead index="03" code="SOURCE × SOURCE" title="完整 11×20 矩阵模式相似性" note="八个来源直接两两比较；将完整关联概率矩阵展平为 220 维，便于观察人类内部、AI 内部与跨类别相似性。"><span className="analysis-count">Pearson r</span></ViewHead>
        <PatternSimilarityMatrix rows={pattern} sourceCohorts={sourceCohorts} />
      </article> : null}
      {composite.length ? <article className="gew-view-block">
        <ViewHead index="04" code="COMPOSITE BETWEEN-GROUP" title="广度、条件强度与效价偏向" note="所有来源使用同一坐标尺度，按来源比较点估计与 participant×run Bootstrap 95% 区间；人类来源在前，AI 来源在后。"><label>指标<select value={compositeMetric} onChange={event => setCompositeMetric(event.target.value as CompositeMetric)}>{Object.entries(COMPOSITE_METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label></ViewHead>
        <CompositeIndicatorFacets rows={composite} metric={compositeMetric} sourceCohorts={sourceCohorts} />
      </article> : null}
      <article className="gew-view-block">
        <ViewHead index="05" code="SOURCE FACETS" title="各来源颜色—情绪气泡点阵" note="组间总览后的来源明细；横轴为 20 个情绪，纵轴为 11 个标准色，所有来源采用同一尺度。"><MetricSelect value={displayMetric} onChange={setDisplayMetric} /></ViewHead>
        <GewDotFacets metric={displayMetric} sources={sources} colors={colors} cells={cells} />
      </article>
      {rawRows.length ? <article className="gew-view-block">
        <ViewHead index="06" code="SOURCE DETAIL" title="单一来源的 0–5 评分分布" note="作为组间差异的下钻明细，完整保留 0=未关联与 1–5 强度等级。"><div className="gew-inline-controls"><Select label="来源" value={effectiveRatingSource} onChange={setRatingSource} options={sources} /><Select label="颜色" value={effectiveRatingColor} onChange={setRatingColor} options={colors} /></div></ViewHead>
        <RatingDistribution rows={visibleRawRows} source={effectiveRatingSource} color={effectiveRatingColor} />
      </article> : null}
      <article className="gew-view-block">
        <ViewHead index="07" code="SOURCE DETAIL" title="单一来源的关联概率与条件强度" note="先区分“是否建立关联”，再观察建立关联后的强弱；用于解释上方组间差异来自哪个方向。"><label>来源<select value={effectiveHeat} onChange={event => setHeatSource(event.target.value)}>{sources.map(source => <option key={source}>{source}</option>)}</select></label></ViewHead>
        <div className="gew-double-heatmaps"><GewHeatmap title="A · 关联概率" note="0–100% · 选择该情绪的样本比例" metric="probability" source={effectiveHeat} colors={colors} cells={cells} /><GewHeatmap title="B · 条件强度" note="1–5 · 仅在已选择样本中计算" metric="conditional" source={effectiveHeat} colors={colors} cells={cells} /></div>
      </article>
      <article className="gew-view-block">
        <ViewHead index="08" code="SOURCE DETAIL" title="单一来源、单一颜色的情绪画像" note="维持 GEW 顺序；作为组间差异的来源级解释图。"><div className="gew-inline-controls"><Select label="来源" value={effectiveProfileSource} onChange={setProfileSource} options={sources} /><Select label="颜色" value={effectiveColor} onChange={setProfileColor} options={colors} /><MetricSelect value={profileMetric} onChange={setProfileMetric} /></div></ViewHead>
        <GewRadial source={effectiveProfileSource} color={effectiveColor} metric={profileMetric} cells={cells} sourceIndex={Math.max(0, sources.indexOf(effectiveProfileSource))} />
      </article>
      <article className="gew-view-block">
        <ViewHead index="09" code="PAIRWISE DRILL-DOWN" title="两个指定来源的差值热力图" note="直接显示 A−B；用于从总体人类–AI差异继续下钻到任意两组。"><div className="gew-inline-controls"><Select label="来源 A" value={effectiveA} onChange={setDifferenceA} options={sources} /><Select label="来源 B" value={effectiveB} onChange={setDifferenceB} options={sources.filter(source => source !== effectiveA)} /><MetricSelect value={differenceMetric} onChange={setDifferenceMetric} /></div></ViewHead>
        {effectiveB ? <GewDifference sourceA={effectiveA} sourceB={effectiveB} metric={differenceMetric} colors={colors} cells={cells} /> : <div className="gew-comparison-empty">至少需要两个来源才能计算来源差值。</div>}
      </article>
    </>}
  </section>;
}

function ViewHead({ index, code, title, note, children }: { index: string; code: string; title: string; note: string; children: React.ReactNode }) {
  return <div className="gew-view-head"><div><span>{index} / {code}</span><h4>{title}</h4><p>{note}</p></div>{children}</div>;
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}
function MetricSelect({ value, onChange }: { value: GewMetric; onChange: (value: GewMetric) => void }) {
  return <label>指标<select value={value} onChange={event => onChange(event.target.value as GewMetric)}>{Object.entries(METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>;
}

const COHORT_FIELDS: Record<GewMetric, { difference: string; q: string }> = {
  probability: { difference: "AI减人类_来源平均选择率差", q: "选择率FDR_q值" },
  conditional: { difference: "AI减人类_来源平均条件强度差", q: "条件强度FDR_q值" },
  overall: { difference: "AI减人类_来源平均强度差", q: "强度FDR_q值" },
};

function cohortName(cohort?: GewRow["cohort"]) {
  return cohort === "human" ? "人类" : cohort === "ai" ? "AI" : "未标记";
}

function CohortDifferenceHeatmap({ rows, metric, colors }: { rows: ExportRow[]; metric: GewMetric; colors: string[] }) {
  const fields = COHORT_FIELDS[metric];
  const emotions = GEW_EMOTIONS.filter(emotion => rows.some(row => row["情绪"] === emotion));
  const differences = rows.map(row => optionalNumber(row[fields.difference])).filter((value): value is number => value !== null);
  const limit = Math.max(metric === "probability" ? .05 : .25, ...differences.map(Math.abs));
  return <section className="gew-difference-card cohort-difference-card">
    <div className="gew-difference-title"><b>AI 来源均值 − 人类来源均值</b><span>{METRICS[metric].label} · 红色偏 AI，蓝色偏人类 · ● 为 FDR q&lt;.05</span></div>
    <div className="gew-matrix-scroll"><div className="gew-matrix gew-difference-matrix" style={{ gridTemplateColumns: `72px repeat(${emotions.length}, minmax(30px,1fr))` }}>
      <span className="gew-corner">颜色</span>{emotions.map(emotion => <b className={GEW_EMOTIONS.indexOf(emotion) === 10 ? "gew-negative-start" : ""} key={emotion}><span>{emotion}</span></b>)}
      {colors.map(color => <Fragment key={color}><strong>{color}</strong>{emotions.map(emotion => {
        const row = rows.find(item => item["颜色"] === color && item["情绪"] === emotion);
        const difference = optionalNumber(row?.[fields.difference]), q = optionalNumber(row?.[fields.q]);
        const signed = difference === null ? 0 : Math.max(-1, Math.min(1, difference / limit));
        return <i className={`${difference === null ? "missing" : signed >= 0 ? "positive" : "negative"} ${GEW_EMOTIONS.indexOf(emotion) === 10 ? "gew-negative-start" : ""}`} key={`${color}-${emotion}`} style={{ "--gew-difference": `${Math.abs(signed) * 82}%` } as React.CSSProperties} title={`${color} · ${emotion}\nAI−人类: ${difference === null ? "—" : difference.toFixed(3)}\nFDR q: ${q === null ? "—" : q.toFixed(4)}`}><span>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference.toFixed(metric === "probability" ? 2 : 1)}`}{q !== null && q < .05 ? <b>●</b> : null}</span></i>;
      })}</Fragment>)}
    </div></div>
    <div className="gew-diverging-scale"><span>人类更强</span><i /><em>0</em><i /><span>AI 更强</span></div>
    <p className="chart-note">差值先在每个来源内汇总，再对来源等权平均；不会把样本行数较多的来源重复加权。显著标记来自来源级双侧精确置换检验，并对 220 个颜色×情绪单元分别做 BH-FDR 校正。</p>
  </section>;
}

function SourceGroupComparison({ cells, sourceCohorts, color, emotion, metric }: { cells: GewCell[]; sourceCohorts: Map<string, GewRow["cohort"]>; color: string; emotion: string; metric: GewMetric }) {
  const groups = (["human", "ai"] as const).map(cohort => {
    const items = [...sourceCohorts].filter(([, value]) => value === cohort).map(([source]) => {
      const cell = cells.find(item => item.source === source && item.color === color && item.emotion === emotion);
      return { source, value: valueOf(cell, metric) };
    }).filter((item): item is { source: string; value: number } => item.value !== null);
    return { cohort, items, mean: items.length ? average(items.map(item => item.value)) : null };
  });
  const maximum = METRICS[metric].maximum;
  return <div className="source-group-comparison">
    <div className="source-group-scale"><span>0</span><i /><span>{metric === "probability" ? "100%" : maximum}</span></div>
    {groups.map(group => <article className={group.cohort} key={group.cohort}>
      <header><div><span>{cohortName(group.cohort)}</span><b>{group.items.length} 个来源</b></div><strong>{group.mean === null ? "—" : shown(group.mean, metric)}<small>来源均值</small></strong></header>
      <div className="source-strip">
        {group.mean !== null ? <i className="group-mean" style={{ left: `${group.mean / maximum * 100}%` }} /> : null}
        {group.items.map((item, index) => <em key={item.source} style={{ left: `${item.value / maximum * 100}%`, top: `${12 + index * 26}px` }}><span>{item.source}</span><b>{shown(item.value, metric)}</b></em>)}
      </div>
    </article>)}
    <p className="chart-note">{color} × {emotion} · {METRICS[metric].label}。点是来源，不是单条回答；两栏的粗线是类别内来源均值。</p>
  </div>;
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

function RatingDistribution({ rows, source, color }: { rows: GewRow[]; source: string; color: string }) {
  const emotions = GEW_EMOTIONS.filter(emotion => rows.some(row => row.source === source && row.color === color && row.emotion === emotion));
  return <div className="rating-distribution">
    <div className="rating-legend">{RATING_COLORS.map((fill, level) => <span key={level}><i style={{ background: fill }} />{level === 0 ? "0 未关联" : `${level} 分`}</span>)}</div>
    <div className="rating-bars">{emotions.map(emotion => {
      const values = rows.filter(row => row.source === source && row.color === color && row.emotion === emotion).map(row => Math.max(0, Math.min(5, Math.round(row.intensity))));
      const counts = Array.from({ length: 6 }, (_, level) => values.filter(value => value === level).length), total = Math.max(1, values.length);
      const selectedRate = 1 - counts[0] / total;
      return <article key={emotion}>
        <b>{emotion}</b>
        <div>{counts.map((count, level) => <i key={level} style={{ width: `${count / total * 100}%`, background: RATING_COLORS[level] }} title={`${emotion} · ${level}分 · ${count}/${values.length} (${(count / total * 100).toFixed(1)}%)`}>{count / total >= .08 ? <span>{(count / total * 100).toFixed(0)}%</span> : null}</i>)}</div>
        <strong>{(selectedRate * 100).toFixed(1)}%<small>关联</small></strong>
      </article>;
    })}</div>
    <p className="chart-note">每一行合计 100%；左侧灰色为未建立关联，后续色段为 1–5 级条件强度的原始比例。</p>
  </div>;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function CompositeIndicatorFacets({ rows, metric, sourceCohorts }: { rows: ExportRow[]; metric: CompositeMetric; sourceCohorts: Map<string, GewRow["cohort"]> }) {
  const config = COMPOSITE_METRICS[metric], sources = [...new Set(rows.map(row => String(row["来源"] || "")))].filter(Boolean).sort((a, b) => {
    const rank = (source: string) => sourceCohorts.get(source) === "human" ? 0 : sourceCohorts.get(source) === "ai" ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
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

function PatternSimilarityMatrix({ rows, sourceCohorts }: { rows: ExportRow[]; sourceCohorts: Map<string, GewRow["cohort"]> }) {
  const sources = [...new Set(rows.flatMap(row => [String(row["来源A"] || ""), String(row["来源B"] || "")]))].filter(Boolean).sort((a, b) => {
    const rank = (source: string) => sourceCohorts.get(source) === "human" ? 0 : sourceCohorts.get(source) === "ai" ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const valueFor = (sourceA: string, sourceB: string) => {
    if (sourceA === sourceB) return 1;
    const row = rows.find(item => (item["来源A"] === sourceA && item["来源B"] === sourceB) || (item["来源A"] === sourceB && item["来源B"] === sourceA));
    return optionalNumber(row?.["颜色情绪矩阵Pearson_r"]);
  };
  return <div className="pattern-matrix-wrap"><div className="pattern-matrix" style={{ gridTemplateColumns: `130px repeat(${sources.length},minmax(72px,1fr))` }}>
    <span />{sources.map(source => <b className={`cohort-${sourceCohorts.get(source) || "unspecified"}`} key={source}>{source}<small>{cohortName(sourceCohorts.get(source))}</small></b>)}
    {sources.map(sourceA => <Fragment key={sourceA}><strong className={`cohort-${sourceCohorts.get(sourceA) || "unspecified"}`}>{sourceA}<small>{cohortName(sourceCohorts.get(sourceA))}</small></strong>{sources.map(sourceB => {
      const value = valueFor(sourceA, sourceB), strength = value === null ? 0 : Math.abs(value);
      const background = value === null ? "#f0f2f0" : value >= 0 ? `rgba(39,123,146,${.08 + strength * .86})` : `rgba(202,105,70,${.08 + strength * .86})`;
      return <i key={sourceB} style={{ background, color: strength > .62 ? "white" : "#29414a" }} title={`${sourceA} × ${sourceB}: ${value === null ? "不可计算" : `r=${value.toFixed(3)}`}`}>{value === null ? "—" : value.toFixed(2)}</i>;
    })}</Fragment>)}
  </div><div className="pattern-scale"><span>负相关</span><i /><em>0</em><i /><span>正相关</span></div><p className="chart-note">任务卡导出的正式结果同时包含以 participant×run 为单位的 500 次 Bootstrap 95% 区间；此矩阵用于快速浏览点估计。</p></div>;
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
