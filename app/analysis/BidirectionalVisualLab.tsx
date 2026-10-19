"use client";

import { useMemo, useState } from "react";
import { GEW_COLOURS, GEW_COLOR_HEX, GEW_EMOTIONS, toCsv, type CanonicalColorRow, type ExportRow, type GewRow } from "./engine";
import { FigureExportControls, type FigureExportStyle } from "./FigureExportControls";
import { analyzeBidirectional, downloadFigureBlob, renderPublicationFigure } from "./python-figures";

type Summary = { n: number; mean: number | null; median: number | null; sd: number | null; ciLow: number | null; ciHigh: number | null };
type EmotionSummary = { emotion: string; selection: Summary; selectionExcess: Summary; selectionZ: Summary; strength: Summary; strengthExcess: Summary; strengthZ: Summary };
type GroupResult = { source: string; cohort: string; n: number; A: number[][]; BSelection: number[][]; BStrength: number[][]; CSelection: number[][]; CStrength: number[][]; emotion: EmotionSummary[]; meanDiagonalSelection: Summary; meanDiagonalStrength: Summary; dominanceSelection: Summary; dominanceStrength: Summary; excessSelection: Summary; excessStrength: Summary; sensitivity: Record<string, Summary> };
type UnitResult = { source: string; cohort: string; unit: string; meanDiagonalSelection: number; meanDiagonalStrength: number; dominanceSelection: number; dominanceStrength: number; excessSelection: number; excessStrength: number; topTransfers: Array<{ from: string; to: string; selection: number; strength: number }> };
type Analysis = { emotions: string[]; colors: string[]; tau: number; taus: number[]; permutations: number; qc: Array<Record<string, number | string>>; groups: GroupResult[]; units: UnitResult[]; structureDistances: Array<Record<string, number | string | null>>; methodNote: string; orderEffectNote: string };
type View = "check" | "a" | "b" | "parallel" | "cycle" | "permutation" | "groups" | "units" | "dominance" | "transfers" | "structure" | "ml";

const VIEWS: Array<[View, string]> = [["check", "01 数据检查"], ["a", "02 矩阵 A"], ["b", "03 矩阵 B"], ["parallel", "04 A ↔ B"], ["cycle", "05 Cycle"], ["permutation", "06 Permutation"], ["groups", "07 八组比较"], ["units", "独立单位分布"], ["dominance", "对角优势"], ["transfers", "Top 转移"], ["structure", "结构距离"], ["ml", "08 Cross-task ML"]];
const FIGURE_VIEWS = new Set<View>(["a", "b", "parallel", "cycle", "permutation", "groups", "units", "dominance", "transfers", "structure"]);

function n(value: number | null | undefined, digits = 3) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits); }
function save(name: string, content: string) { const blob = new Blob([content], { type: "text/csv;charset=utf-8" }), url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function matrixRows(matrix: number[][], rowLabels: readonly string[], columnLabels: readonly string[]) { return rowLabels.map((label, row) => Object.fromEntries([["row", label], ...columnLabels.map((column, index) => [column, matrix[row]?.[index] ?? 0])])) as ExportRow[]; }
function transpose(matrix: number[][]) { return matrix[0]?.map((_, column) => matrix.map(row => row[column])) || []; }

export function BidirectionalVisualLab({ colorRows, gewRows, fileName, sourceOrder }: { colorRows: CanonicalColorRow[]; gewRows: GewRow[]; fileName: string; sourceOrder: string[] }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null), [error, setError] = useState("");
  const [running, setRunning] = useState(false), [view, setView] = useState<View>("check"), [tau, setTau] = useState(10), [permutations, setPermutations] = useState(1000), [metric, setMetric] = useState<"strength" | "selection">("strength"), [source, setSource] = useState("");
  const [figureBusy, setFigureBusy] = useState(false), [figureError, setFigureError] = useState("");
  const [style, setStyle] = useState<FigureExportStyle>({ columns: 4, width: 4500, scale: 2, showTitle: true, format: "png" });
  const groups = analysis?.groups || [], active = groups.find(group => group.source === source) || groups[0];
  const sources = groups.map(group => group.source);
  const canRun = colorRows.length > 0 && gewRows.length > 0;
  const groupRows = useMemo(() => groups.map(group => ({ 来源: group.source, 组类型: group.cohort, 完整配对单位: group.n, 平均对角_选择: group.meanDiagonalSelection.mean, 平均对角_强度: group.meanDiagonalStrength.mean, 超额一致性_选择: group.excessSelection.mean, 超额一致性_强度: group.excessStrength.mean, 对角优势_选择: group.dominanceSelection.mean, 对角优势_强度: group.dominanceStrength.mean })), [groups]);
  async function run() {
    setRunning(true); setError("");
    try { setAnalysis(await analyzeBidirectional({ colorRows, gewRows, permutations, tau, sourceOrder }) as unknown as Analysis); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "双向分析失败。"); }
    finally { setRunning(false); }
  }
  async function exportFigure(format: "png" | "svg") {
    if (!analysis) return;
    setFigureBusy(true); setFigureError("");
    try {
      // Never resend participant/run matrices to Matplotlib.  A full 8-group
      // analysis can exceed the HTTP bridge limit even though each figure
      // only needs group summaries plus compact unit-level scores.
      const figureAnalysis = {
        ...analysis,
        units: analysis.units.map(unit => ({
          source: unit.source, cohort: unit.cohort, unit: unit.unit,
          meanDiagonalSelection: unit.meanDiagonalSelection, meanDiagonalStrength: unit.meanDiagonalStrength,
          dominanceSelection: unit.dominanceSelection, dominanceStrength: unit.dominanceStrength,
          excessSelection: unit.excessSelection, excessStrength: unit.excessStrength,
          topTransfers: unit.topTransfers,
        })),
      };
      const blob = await renderPublicationFigure({ scope: "bidirectional", kind: view, data: [figureAnalysis], options: { ...style, format, metric, selectedSource: active?.source, sourceOrder: sources, title: VIEWS.find(item => item[0] === view)?.[1] } });
      downloadFigureBlob(blob, `${fileName || "analysis"}_bidirectional_${view}.${format}`);
    } catch (problem) { setFigureError(problem instanceof Error ? problem.message : "图表导出失败。"); }
    finally { setFigureBusy(false); }
  }
  function exportCurrentCsv() {
    if (!analysis) return;
    let rows: ExportRow[] = groupRows as ExportRow[];
    if (view === "check") rows = analysis.qc as ExportRow[];
    else if (view === "a" && active) rows = matrixRows(active.A, GEW_EMOTIONS, GEW_COLOURS);
    else if (view === "b" && active) rows = matrixRows(transpose(metric === "strength" ? active.BStrength : active.BSelection), GEW_EMOTIONS, GEW_COLOURS);
    else if (view === "cycle" && active) rows = matrixRows(metric === "strength" ? active.CStrength : active.CSelection, GEW_EMOTIONS, GEW_EMOTIONS);
    else if (view === "permutation" && active) rows = active.emotion.map(row => ({ 情绪: row.emotion, 真实值: row[metric].mean, Null均值: row[`${metric}Excess`].mean == null || row[metric].mean == null ? null : row[metric].mean! - row[`${metric}Excess`].mean!, 超额一致性: row[`${metric}Excess`].mean, Z: row[`${metric}Z`].mean }));
    else if (view === "units") rows = analysis.units as unknown as ExportRow[];
    else if (view === "transfers") rows = analysis.units.flatMap(unit => unit.topTransfers.map(item => ({ 来源: unit.source, 独立单位: unit.unit, 起始情绪: item.from, 目标情绪: item.to, Selection: item.selection, Strength: item.strength })));
    else if (view === "structure") rows = analysis.structureDistances as ExportRow[];
    save(`${fileName || "analysis"}_bidirectional_${view}.csv`, toCsv(rows));
  }

  return <section className="bidirectional-cycle panel python-paper-view">
    <div className="panel-head"><div><span className="eyebrow">05 BIDIRECTIONAL ANALYSIS</span><h3>双向颜色—情绪探索</h3><p>严格按 participant / AI run 配对：Emotion → BCT similarity（A），BCT → Emotion（B），再计算循环矩阵 C=A×B。</p></div><div className="bidirectional-run-controls"><label>τ<select value={tau} onChange={event => setTau(Number(event.target.value))}><option>5</option><option>10</option><option>15</option></select></label><label>置换次数<select value={permutations} onChange={event => setPermutations(Number(event.target.value))}><option>1000</option><option>2000</option></select></label><button className="primary" disabled={!canRun || running} onClick={() => void run()}>{running ? "正在计算…" : analysis ? "重新计算" : "开始双向分析"}</button></div></div>
    {!canRun ? <div className="dashboard-empty"><b>需要同时导入实验一和实验二数据</b><small>并保留可匹配的 participant_id 或 run_id。</small></div> : null}
    {error ? <div className="task-error">{error}</div> : null}
    {!analysis && canRun ? <div className="bidirectional-method-preview"><article><b>A · Emotion → Color</b><span>自由色与实际 11 BCT 参照色计算 ΔE00，再以 exp(−ΔE/τ) 软分配；每行和为 1。</span></article><article><b>B · Color → Emotion</b><span>同时保留 selected 与 selected×intensity/5；B 不跨情绪归一化。</span></article><article><b>C · Cycle</b><span>每个独立单位先计算 C=A×B，再汇总真实对角、off-diagonal、对角优势与置换 Null。</span></article></div> : null}
    {analysis ? <>
      <div className="bidirectional-audit"><b>{analysis.units.length}</b><span>完整配对独立单位</span><b>{groups.length}</b><span>可分析来源</span><b>{analysis.permutations}</b><span>单位内标签置换</span><b>τ={analysis.tau}</b><span>主分析参数</span></div>
      <AutomaticSummary analysis={analysis} />
      <div className="visual-tabs">{VIEWS.map(([key, label]) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}>{label}</button>)}</div>
      {!["check", "groups", "units", "dominance", "structure", "ml"].includes(view) ? <div className="bidirectional-view-controls"><label>来源<select value={active?.source || ""} onChange={event => setSource(event.target.value)}>{sources.map(item => <option key={item}>{item}</option>)}</select></label>{view !== "a" ? <label>B/C 口径<select value={metric} onChange={event => setMetric(event.target.value as typeof metric)}><option value="strength">强度（selected×intensity/5）</option><option value="selection">选择（selected）</option></select></label> : null}</div> : null}
      <div className="bidirectional-actions"><button className="secondary" onClick={exportCurrentCsv}>导出当前数据 CSV ↓</button>{FIGURE_VIEWS.has(view) ? <FigureExportControls value={style} onChange={setStyle} onExport={format => void exportFigure(format)} exportLabel="导出论文图" busy={figureBusy} /> : null}</div>
      {figureError ? <div className="task-error">科研图生成失败：{figureError}</div> : null}
      {view === "check" ? <QcTable rows={analysis.qc} /> : null}
      {view === "a" && active ? <Matrix title={`${active.source} · A (20 emotions × 11 BCT colors)`} values={active.A} rows={GEW_EMOTIONS} columns={GEW_COLOURS} colors /> : null}
      {view === "b" && active ? <Matrix title={`${active.source} · B-${metric}ᵀ (20 emotions × 11 colors)`} values={transpose(metric === "strength" ? active.BStrength : active.BSelection)} rows={GEW_EMOTIONS} columns={GEW_COLOURS} colors /> : null}
      {view === "parallel" && active ? <Parallel group={active} metric={metric} /> : null}
      {view === "cycle" && active ? <Matrix title={`${active.source} · C-${metric} (20 × 20 cycle)`} values={metric === "strength" ? active.CStrength : active.CSelection} rows={GEW_EMOTIONS} columns={GEW_EMOTIONS} diagonal /> : null}
      {view === "permutation" && active ? <Permutation group={active} metric={metric} /> : null}
      {view === "groups" ? <GroupComparison groups={groups} metric={metric} /> : null}
      {view === "units" ? <UnitDistribution units={analysis.units} /> : null}
      {view === "dominance" ? <Dominance groups={groups} /> : null}
      {view === "transfers" && active ? <Transfers units={analysis.units.filter(unit => unit.source === active.source)} metric={metric} /> : null}
      {view === "structure" ? <Structure rows={analysis.structureDistances} sources={sources} /> : null}
      {view === "ml" ? <div className="dashboard-empty"><b>Cross-task machine learning 预留</b><small>为避免把描述性循环分析与预测模型混合，本阶段不在此处运行机器学习。</small></div> : null}
      <div className="bidirectional-notes"><p>{analysis.methodNote}</p><p><b>顺序效应限制：</b>{analysis.orderEffectNote}</p><p><b>解释边界：</b>高循环一致性表示映射更闭合或更规则，不等于“更正确”；AI 高于 Human 也可能来自更低随机性或模板化回答。</p></div>
    </> : null}
  </section>;
}

function QcTable({ rows }: { rows: Array<Record<string, number | string>> }) { return <div className="table-scroll"><table><thead><tr><th>来源</th><th>组别</th><th>实验一单位</th><th>实验二单位</th><th>ID 配对</th><th>完整纳入</th><th>不完整排除</th><th>仅实验一</th><th>仅实验二</th></tr></thead><tbody>{rows.map(row => <tr key={String(row.source)}><td>{row.source}</td><td>{row.cohort}</td><td>{row.task1Units}</td><td>{row.task2Units}</td><td>{row.pairedUnits}</td><td><b>{row.completeUnits}</b></td><td>{row.excludedIncomplete}</td><td>{row.task1Only}</td><td>{row.task2Only}</td></tr>)}</tbody></table></div>; }
function Matrix({ title, values, rows, columns, colors = false, diagonal = false }: { title: string; values: number[][]; rows: readonly string[]; columns: readonly string[]; colors?: boolean; diagonal?: boolean }) { const max = Math.max(.0001, ...values.flat()); return <div className="cycle-matrix"><h4>{title}</h4><div className="cycle-grid" style={{ gridTemplateColumns: `140px repeat(${columns.length},minmax(42px,1fr))` }}><span />{columns.map(column => <b key={column}>{colors ? <i style={{ background: GEW_COLOR_HEX[column as keyof typeof GEW_COLOR_HEX] }} /> : null}{column}</b>)}{rows.map((row, ri) => <div className="cycle-row" key={row}><strong>{row}</strong>{columns.map((column, ci) => { const value = values[ri]?.[ci] || 0, alpha = .06 + .88 * value / max; return <i className={diagonal && ri === ci ? "diagonal" : ""} style={{ background: `rgba(${diagonal && ri === ci ? "190,88,67" : "39,123,146"},${alpha})` }} key={column} title={`${row} → ${column}: ${value.toFixed(4)}`}><span>{value.toFixed(2)}</span></i>; })}</div>)}</div></div>; }
function Parallel({ group, metric }: { group: GroupResult; metric: "strength" | "selection" }) { return <div className="bidirectional-parallel"><Matrix title="A · Emotion → BCT similarity" values={group.A} rows={GEW_EMOTIONS} columns={GEW_COLOURS} colors /><Matrix title={`B-${metric}ᵀ · Emotion × BCT`} values={transpose(metric === "strength" ? group.BStrength : group.BSelection)} rows={GEW_EMOTIONS} columns={GEW_COLOURS} colors /></div>; }
function AutomaticSummary({ analysis }: { analysis: Analysis }) {
  const allEmotion = GEW_EMOTIONS.map(emotion => { const values = analysis.groups.flatMap(group => { const row = group.emotion.find(item => item.emotion === emotion); return row?.strengthExcess.mean == null ? [] : [row.strengthExcess.mean]; }); return { emotion, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }; }).sort((a, b) => b.mean - a.mean);
  const human = analysis.units.filter(unit => unit.cohort === "human"), ai = analysis.units.filter(unit => unit.cohort === "ai"), mean = (rows: UnitResult[]) => rows.length ? rows.reduce((sum, row) => sum + row.excessStrength, 0) / rows.length : null;
  const nearest = analysis.groups.filter(group => group.cohort === "ai").map(group => { const candidates = analysis.structureDistances.filter(row => row.sourceA === group.source && row.cohortB === "human" && typeof row.spearman === "number").sort((a, b) => Number(b.spearman) - Number(a.spearman)); return candidates[0] ? `${group.source} → ${candidates[0].sourceB} (ρ=${n(Number(candidates[0].spearman), 2)})` : `${group.source} → —`; });
  return <div className="bidirectional-auto-summary"><div><span>较稳定自返情绪</span><b>{allEmotion.slice(0, 3).map(item => item.emotion).join(" · ") || "—"}</b><small>按八组 mean excess strength 描述性排序</small></div><div><span>Human vs AI</span><b>Human {n(mean(human))} · AI {n(mean(ai))}</b><small>独立单位 overall excess；仅描述，不自动推断显著性</small></div><div><span>AI 最接近 Human 的循环结构</span><b>{nearest.join("；") || "—"}</b><small>组均值 C-strength 展平 Spearman</small></div></div>;
}
function Permutation({ group, metric }: { group: GroupResult; metric: "strength" | "selection" }) { return <div className="permutation-profile"><h4>{group.source} · 真实对角与置换 Null 的超额一致性</h4>{group.emotion.map(row => { const real = row[metric].mean || 0, excess = row[`${metric}Excess`].mean || 0, nullMean = real - excess; return <article key={row.emotion}><b>{row.emotion}</b><div><i className="null" style={{ width: `${Math.max(0, nullMean) * 100}%` }} /><i className="excess" style={{ left: `${Math.max(0, nullMean) * 100}%`, width: `${Math.max(0, excess) * 100}%` }} /></div><span>{n(real)} / excess {n(excess)} / Z {n(row[`${metric}Z`].mean, 2)}</span></article>; })}</div>; }
function GroupComparison({ groups, metric }: { groups: GroupResult[]; metric: "strength" | "selection" }) { return <div className="bidirectional-group-bars"><h4>八组循环一致性（独立单位均值与 95% CI）</h4>{groups.map(group => { const summary = group[`meanDiagonal${metric === "strength" ? "Strength" : "Selection"}`], excess = group[`excess${metric === "strength" ? "Strength" : "Selection"}`]; return <article key={group.source}><header><b>{group.source}</b><small>{group.cohort} · n={group.n}</small></header><div><i style={{ width: `${(summary.mean || 0) * 100}%` }} /></div><span>raw {n(summary.mean)} [{n(summary.ciLow)}, {n(summary.ciHigh)}]</span><strong>excess {n(excess.mean)}</strong></article>; })}</div>; }
function UnitDistribution({ units }: { units: UnitResult[] }) { const sources = [...new Set(units.map(unit => unit.source))]; return <div className="unit-distribution"><h4>participant / run 层级分布</h4>{sources.map(source => <article key={source}><b>{source}</b><div>{units.filter(unit => unit.source === source).map(unit => <i key={unit.unit} style={{ left: `${Math.max(0, Math.min(1, unit.excessStrength)) * 100}%` }} title={`${unit.unit}: ${unit.excessStrength.toFixed(4)}`} />)}</div><span>n={units.filter(unit => unit.source === source).length}</span></article>)}</div>; }
function Dominance({ groups }: { groups: GroupResult[] }) { return <div className="dominance-chart"><h4>Diagonal dominance = mean(diagonal) − mean(off-diagonal)</h4>{groups.map(group => <article key={group.source}><b>{group.source}</b><div><i style={{ width: `${Math.max(0, group.dominanceStrength.mean || 0) * 100}%` }} /></div><span>{n(group.dominanceStrength.mean)} [{n(group.dominanceStrength.ciLow)}, {n(group.dominanceStrength.ciHigh)}]</span></article>)}</div>; }
function Transfers({ units, metric }: { units: UnitResult[]; metric: "strength" | "selection" }) { const map = new Map<string, number[]>(); units.forEach(unit => unit.topTransfers.forEach(item => { const key = `${item.from}→${item.to}`, values = map.get(key) || []; values.push(item[metric]); map.set(key, values); })); const rows = [...map].map(([key, values]) => ({ key, mean: values.reduce((sum, value) => sum + value, 0) / values.length })).sort((a, b) => b.mean - a.mean).slice(0, 20); return <div className="transfer-list"><h4>最强 off-diagonal emotion transfers</h4>{rows.map((row, index) => <article key={row.key}><em>{index + 1}</em><b>{row.key}</b><div><i style={{ width: `${row.mean * 100}%` }} /></div><span>{n(row.mean)}</span></article>)}</div>; }
function Structure({ rows, sources }: { rows: Array<Record<string, number | string | null>>; sources: string[] }) { return <div className="structure-section"><h4>八组循环结构距离与相关</h4><Matrix title="C-strength flattened Spearman" values={sources.map(a => sources.map(b => Number(rows.find(row => row.sourceA === a && row.sourceB === b)?.spearman || 0)))} rows={sources} columns={sources} /><p className="chart-note">同时导出的 CSV 包含 Frobenius 距离、Pearson 与 Spearman；Human–Human、AI–AI、Human–AI 可按 cohort 字段分层。</p></div>; }
