"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, toCsv, type AnalysisResult, type ExportRow, type GewRow } from "./engine";

type GewMetric = "probability" | "conditional" | "overall";
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

export type Task2VisualLabProps = { data: GewRow[] | AnalysisResult; fileName?: string };

const METRICS: Record<GewMetric, { label: string; maximum: number }> = {
  probability: { label: "关联概率", maximum: 1 },
  conditional: { label: "条件强度", maximum: 5 },
  overall: { label: "综合平均分", maximum: 5 },
};
const SERIES = ["#277b92", "#d47d55", "#4f8a70", "#8d6b94", "#b9973b", "#5675a7", "#b45d6b", "#657c82"];

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

export function Task2VisualLab({ data, fileName = "task2-gew" }: Task2VisualLabProps) {
  const cells = useMemo(() => normalizeGew(data), [data]);
  const sources = useMemo(() => [...new Set(cells.map(cell => cell.source))], [cells]);
  const colors = useMemo(() => [...new Set(cells.map(cell => cell.color))], [cells]);
  const [heatSource, setHeatSource] = useState(""), [profileSource, setProfileSource] = useState(""), [profileColor, setProfileColor] = useState("");
  const [displayMetric, setDisplayMetric] = useState<GewMetric>("probability");
  const [profileMetric, setProfileMetric] = useState<GewMetric>("overall"), [differenceA, setDifferenceA] = useState(""), [differenceB, setDifferenceB] = useState("");
  const [differenceMetric, setDifferenceMetric] = useState<GewMetric>("overall");
  const labRef = useRef<HTMLDivElement>(null);
  const effectiveHeat = sources.includes(heatSource) ? heatSource : (sources[0] || "");
  const effectiveProfileSource = sources.includes(profileSource) ? profileSource : effectiveHeat;
  const effectiveColor = colors.includes(profileColor) ? profileColor : (colors[0] || "");
  const effectiveA = sources.includes(differenceA) ? differenceA : (sources[0] || "");
  const effectiveB = sources.includes(differenceB) && differenceB !== effectiveA ? differenceB : (sources.find(source => source !== effectiveA) || "");
  const safeName = fileName.replace(/\.[^.]+$/, "").replace(/\s+/g, "-");

  return <section className="task2-visual-lab visual-lab panel" ref={labRef}>
    <div className="visual-lab-head"><div><span className="eyebrow">GEW 关系结构精选视图</span><h3>颜色 × 情绪关联画像</h3><p>当前筛选 {cells.length.toLocaleString()} 个统计单元 · {sources.length} 个来源 · {colors.length} 种颜色</p></div><div className="visual-export"><button className="secondary" disabled={!cells.length} onClick={() => download(`${safeName}_gew-visual-data.csv`, toCsv(exportRows(cells)))}>导出描述数据 CSV</button><button className="primary" disabled={!cells.length} onClick={() => labRef.current && void downloadPng(labRef.current, `${safeName}_gew-visual-panel.png`)}>导出面板 PNG</button></div></div>
    {!cells.length ? <div className="task2-visual-empty"><span>◎</span><b>当前筛选没有可绘制的 GEW 数据</b><small>请保留来源、颜色、情绪、选择与强度字段。</small></div> : <>
      <article className="gew-view-block">
        <ViewHead index="01" code="DIRECT DISPLAY" title="颜色—情绪气泡点阵分面" note="每个来源一张同尺度点阵；横轴为 20 个情绪，纵轴为 11 个标准色，圆点大小直接对应当前指标。"><MetricSelect value={displayMetric} onChange={setDisplayMetric} /></ViewHead>
        <GewDotFacets metric={displayMetric} sources={sources} colors={colors} cells={cells} />
      </article>
      <article className="gew-view-block">
        <ViewHead index="02" code="HURDLE MODEL" title="关联概率与条件强度" note="先区分“是否建立关联”，再观察建立关联后的强弱；两张图采用相同颜色与 GEW 情绪顺序。"><label>来源<select value={effectiveHeat} onChange={event => setHeatSource(event.target.value)}>{sources.map(source => <option key={source}>{source}</option>)}</select></label></ViewHead>
        <div className="gew-double-heatmaps"><GewHeatmap title="A · 关联概率" note="0–100% · 选择该情绪的样本比例" metric="probability" source={effectiveHeat} colors={colors} cells={cells} /><GewHeatmap title="B · 条件强度" note="1–5 · 仅在已选择样本中计算" metric="conditional" source={effectiveHeat} colors={colors} cells={cells} /></div>
      </article>
      <article className="gew-view-block">
        <ViewHead index="03" code="EMOTION FINGERPRINT" title="单一颜色的 20 情绪径向画像" note="维持 GEW 顺序；外扩越明显，代表该颜色与对应情绪的关联越强。"><div className="gew-inline-controls"><Select label="来源" value={effectiveProfileSource} onChange={setProfileSource} options={sources} /><Select label="颜色" value={effectiveColor} onChange={setProfileColor} options={colors} /><MetricSelect value={profileMetric} onChange={setProfileMetric} /></div></ViewHead>
        <GewRadial source={effectiveProfileSource} color={effectiveColor} metric={profileMetric} cells={cells} sourceIndex={Math.max(0, sources.indexOf(effectiveProfileSource))} />
      </article>
      <article className="gew-view-block">
        <ViewHead index="04" code="SOURCE CONTRAST" title="来源差值热力图" note="直接显示 A−B；正值表示来源 A 更强，负值表示来源 B 更强。"><div className="gew-inline-controls"><Select label="来源 A" value={effectiveA} onChange={setDifferenceA} options={sources} /><Select label="来源 B" value={effectiveB} onChange={setDifferenceB} options={sources.filter(source => source !== effectiveA)} /><MetricSelect value={differenceMetric} onChange={setDifferenceMetric} /></div></ViewHead>
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
