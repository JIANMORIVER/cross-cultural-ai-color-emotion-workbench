"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, runGewCompositeIndicators, runGewPairwise, runGewPatternSimilarity, toCsv, type AnalysisResult, type ExportRow, type GewRow } from "./engine";

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
const RATING_COLORS = ["#e5e7e5", "#3157c7", "#38b764", "#efd63f", "#e98632", "#d3312f"];
const COMPOSITE_METRICS: Record<CompositeMetric, { label: string; mean: string; low: string; high: string; minimum: number; maximum: number }> = {
  broadness: { label: "情绪广度", mean: "平均情绪广度", low: "广度95CI下限", high: "广度95CI上限", minimum: 0, maximum: 20 },
  intensity: { label: "条件强度", mean: "平均条件强度", low: "条件强度95CI下限", high: "条件强度95CI上限", minimum: 1, maximum: 5 },
  valence: { label: "效价偏向", mean: "平均效价偏向", low: "效价偏向95CI下限", high: "效价偏向95CI上限", minimum: -1, maximum: 1 },
};

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
  const pairwise = useMemo(() => new Set(rawRows.map(row => row.source)).size >= 2 ? runGewPairwise(rawRows).rows : [], [rawRows]);
  const sources = useMemo(() => [...new Set(cells.map(cell => cell.source))], [cells]);
  const colors = useMemo(() => [...new Set(cells.map(cell => cell.color))], [cells]);
  const [heatSource, setHeatSource] = useState(""), [profileSource, setProfileSource] = useState(""), [profileColor, setProfileColor] = useState("");
  const [displayMetric, setDisplayMetric] = useState<GewMetric>("probability");
  const [displayView, setDisplayView] = useState<"dots" | "wheel">("wheel");
  const [cohortMetric, setCohortMetric] = useState<GewMetric>("probability");
  const [groupColor, setGroupColor] = useState(""), [groupEmotion, setGroupEmotion] = useState("");
  const [compositeMetric, setCompositeMetric] = useState<CompositeMetric>("broadness");
  const [profileMetric, setProfileMetric] = useState<GewMetric>("overall"), [differenceA, setDifferenceA] = useState(""), [differenceB, setDifferenceB] = useState("");
  const [differenceMetric, setDifferenceMetric] = useState<GewMetric>("overall");
  const labRef = useRef<HTMLDivElement>(null);
  const effectiveHeat = sources.includes(heatSource) ? heatSource : (sources[0] || "");
  const effectiveProfileSource = sources.includes(profileSource) ? profileSource : effectiveHeat;
  const effectiveColor = colors.includes(profileColor) ? profileColor : (colors[0] || "");
  const effectiveA = sources.includes(differenceA) ? differenceA : (sources[0] || "");
  const effectiveB = sources.includes(differenceB) && differenceB !== effectiveA ? differenceB : (sources.find(source => source !== effectiveA) || "");
  const effectiveGroupColor = colors.includes(groupColor) ? groupColor : (colors[0] || "");
  const visibleEmotions = GEW_EMOTIONS.filter(emotion => cells.some(cell => cell.emotion === emotion));
  const effectiveGroupEmotion = visibleEmotions.includes(groupEmotion as typeof GEW_EMOTIONS[number]) ? groupEmotion : (visibleEmotions[0] || "");
  const safeName = fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, "-");

  return <section className="task2-visual-lab visual-lab panel" ref={labRef}>
    <div className="visual-lab-head"><div><span className="eyebrow">GEW 关系结构精选视图</span><h3>颜色 × 情绪关联画像</h3><p>当前筛选 {cells.length.toLocaleString()} 个统计单元 · {sources.length} 个来源 · {colors.length} 种颜色</p></div><div className="visual-export"><button className="secondary" disabled={!cells.length} onClick={() => download(`${safeName}_gew-visual-data.csv`, toCsv(exportRows(cells)))}>导出描述数据 CSV</button><button className="primary" disabled={!cells.length} onClick={() => labRef.current && void downloadPng(labRef.current, `${safeName}_gew-visual-panel.png`)}>导出面板 PNG</button></div></div>
    {!cells.length ? <div className="task2-visual-empty"><span>◎</span><b>当前筛选没有可绘制的 GEW 数据</b><small>请保留来源、颜色、情绪、选择与强度字段。</small></div> : <>
      <article className="gew-view-block emphasis">
        <ViewHead index="01" code="8-GROUP RANKING" title="指定颜色×情绪的八组并列比较" note="4个人类组和4个AI组全部保留为独立比较单位；按当前指标从高到低排列，不计算人类/AI合并均值。"><div className="gew-inline-controls"><Select label="颜色" value={effectiveGroupColor} onChange={setGroupColor} options={colors} /><Select label="情绪" value={effectiveGroupEmotion} onChange={setGroupEmotion} options={visibleEmotions} /><MetricSelect value={cohortMetric} onChange={setCohortMetric} /></div></ViewHead>
        <EightGroupRanking cells={cells} sourceCohorts={sourceCohorts} color={effectiveGroupColor} emotion={effectiveGroupEmotion} metric={cohortMetric} />
      </article>
      <article className="gew-view-block">
        <ViewHead index="02" code="8 × 8 PAIRWISE" title="指定单元的八组两两差值矩阵" note="矩阵显示行组−列组，覆盖全部28个组对；关联概率中的圆点表示该组对在全部颜色×情绪×来源对检验中 FDR q<.05。"><MetricSelect value={cohortMetric} onChange={setCohortMetric} /></ViewHead>
        <EightGroupPairMatrix cells={cells} pairwise={pairwise} sourceCohorts={sourceCohorts} color={effectiveGroupColor} emotion={effectiveGroupEmotion} metric={cohortMetric} />
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
        <ViewHead index="05" code="SOURCE FACETS" title={displayView === "wheel" ? "各来源 GEW 颜色面积扇区轮" : "各来源颜色—情绪气泡点阵"} note={displayView === "wheel" ? "圆周固定20个情绪，每个情绪扇区细分为11个标准色；小扇片面积与当前指标成正比。" : "横轴为20个情绪，纵轴为11个标准色，所有来源采用同一尺度。"}><div className="gew-inline-controls"><div className="view-mode-switch"><button className={displayView === "wheel" ? "active" : ""} onClick={() => setDisplayView("wheel")}>GEW 扇区轮</button><button className={displayView === "dots" ? "active" : ""} onClick={() => setDisplayView("dots")}>气泡点阵</button></div><MetricSelect value={displayMetric} onChange={setDisplayMetric} /></div></ViewHead>
        {displayView === "wheel" ? <GewAreaWheelFacets metric={displayMetric} sources={sources} colors={colors} cells={cells} /> : <GewDotFacets metric={displayMetric} sources={sources} colors={colors} cells={cells} />}
      </article>
      {rawRows.length ? <article className="gew-view-block">
        <ViewHead index="06" code="SOURCE × COLOR FACETS" title="八来源 × 标准色的 0–5 评分分布" note="参照GEW研究中的分面堆叠柱图：来源为行、颜色为列，每个面板的20根柱对应20个情绪；灰色0分位于顶部，彩色1–5分从底部堆叠。" ><span className="analysis-count">{sources.length} × {colors.length} 个分面</span></ViewHead>
        <RatingFacetGrid rows={visibleRawRows} sources={sources} colors={colors} sourceCohorts={sourceCohorts} />
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
        <ViewHead index="09" code="PAIRWISE DRILL-DOWN" title="两个指定来源的差值热力图" note="直接显示 A−B；用于从8×8组间矩阵继续下钻到任意两个独立试验组。"><div className="gew-inline-controls"><Select label="来源 A" value={effectiveA} onChange={setDifferenceA} options={sources} /><Select label="来源 B" value={effectiveB} onChange={setDifferenceB} options={sources.filter(source => source !== effectiveA)} /><MetricSelect value={differenceMetric} onChange={setDifferenceMetric} /></div></ViewHead>
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

function cohortName(cohort?: GewRow["cohort"]) {
  return cohort === "human" ? "人类" : cohort === "ai" ? "AI" : "未标记";
}

function EightGroupRanking({ cells, sourceCohorts, color, emotion, metric }: { cells: GewCell[]; sourceCohorts: Map<string, GewRow["cohort"]>; color: string; emotion: string; metric: GewMetric }) {
  const groups = [...sourceCohorts].map(([source, cohort]) => {
    const cell = cells.find(item => item.source === source && item.color === color && item.emotion === emotion);
    return { source, cohort, value: valueOf(cell, metric) };
  }).filter((item): item is { source: string; cohort: GewRow["cohort"]; value: number } => item.value !== null).sort((a, b) => b.value - a.value);
  const maximum = METRICS[metric].maximum;
  return <div className="eight-group-ranking">
    <div className="eight-group-axis"><span>0</span><i /><span>{metric === "probability" ? "100%" : maximum}</span></div>
    {groups.map((group, index) => <article key={group.source}><em>{index + 1}</em><b>{group.source}<small className={`cohort-tag ${group.cohort}`}>{cohortName(group.cohort)}</small></b><div><i style={{ width: `${group.value / maximum * 100}%` }} /></div><strong>{shown(group.value, metric)}</strong></article>)}
    <p className="chart-note">{color} × {emotion} · {METRICS[metric].label}。每一行就是一个独立试验组；人类/AI仅用于标签与排序识别。</p>
  </div>;
}

function EightGroupPairMatrix({ cells, pairwise, sourceCohorts, color, emotion, metric }: { cells: GewCell[]; pairwise: ExportRow[]; sourceCohorts: Map<string, GewRow["cohort"]>; color: string; emotion: string; metric: GewMetric }) {
  const sources = [...sourceCohorts.keys()].sort((a, b) => {
    const rank = (source: string) => sourceCohorts.get(source) === "human" ? 0 : sourceCohorts.get(source) === "ai" ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
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
  const orderedSources = [...sources].sort((a, b) => {
    const rank = (source: string) => sourceCohorts.get(source) === "human" ? 0 : sourceCohorts.get(source) === "ai" ? 1 : 2;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
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
