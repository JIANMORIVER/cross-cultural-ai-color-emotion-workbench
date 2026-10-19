"use client";

import { useMemo, useState } from "react";
import { toCsv, type ExportRow, type GewRow } from "./engine";
import { runMlPhaseOne, type MlPhaseOneResult } from "./ml-client";

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Heatmap({ matrix, rows, columns, range = [0, 1], percent = false }: { matrix: Array<Array<number | null>>; rows: string[]; columns: string[]; range?: [number, number]; percent?: boolean }) {
  const [minimum, maximum] = range;
  return <div className="ml-heatmap-wrap"><div className="ml-heatmap" style={{ gridTemplateColumns: `120px repeat(${columns.length}, minmax(74px,1fr))` }}>
    <span />{columns.map(column => <b key={column}>{column}</b>)}
    {rows.map((row, rowIndex) => <div className="ml-heatmap-row" key={row} style={{ display: "contents" }}><strong>{row}</strong>{columns.map((column, columnIndex) => {
      const value = matrix[rowIndex]?.[columnIndex]; const level = value === null || value === undefined ? 0 : Math.max(0, Math.min(1, (value - minimum) / Math.max(.0001, maximum - minimum)));
      return <i key={column} className={value === null || value === undefined ? "missing" : ""} style={{ background: value === null || value === undefined ? "#edf0ef" : `rgba(39,123,146,${.07 + level * .87})`, color: level > .58 ? "white" : "#233f48" }}>{value === null || value === undefined ? "—" : percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(2)}</i>;
    })}</div>)}
  </div></div>;
}
function csvMatrix(rows: string[], columns: string[], matrix: Array<Array<number | null>>, rowName: string): ExportRow[] {
  return rows.map((row, index) => ({ [rowName]: row, ...Object.fromEntries(columns.map((column, columnIndex) => { const value = matrix[index]?.[columnIndex]; return [column, value === null || value === undefined ? null : Number(value.toFixed(8))]; })) }));
}
function matrixMaximum(matrix: Array<Array<number | null>>) { const values = matrix.flat().filter((value): value is number => value !== null && Number.isFinite(value)); return Math.max(1, ...values); }

export function MachineLearningLab({ rows, fileName }: { rows: GewRow[]; fileName: string }) {
  const [result, setResult] = useState<MlPhaseOneResult | null>(null), [running, setRunning] = useState(false), [error, setError] = useState("");
  const [outerFolds, setOuterFolds] = useState(10), [innerFolds, setInnerFolds] = useState(5), [matrixGroup, setMatrixGroup] = useState("");
  const validRows = useMemo(() => rows.filter(row => row.valid && (row.cohort === "human" || row.cohort === "ai")), [rows]);
  const selectedGroup = result?.sources.includes(matrixGroup) ? matrixGroup : result?.sources[0] || "";
  async function run() { setRunning(true); setError(""); try { setResult(await runMlPhaseOne(validRows, { outerFolds, innerFolds })); } catch (reason) { setError(reason instanceof Error ? reason.message : "机器学习分析失败。"); } finally { setRunning(false); } }
  function exportAll() {
    if (!result) return; const safe = fileName.replace(/\.[^.]+$/, "") || "chromalab";
    const metrics = result.sources.map(source => ({ group: source, cohort: result.decoding[source].cohort, independent_units: result.decoding[source].units, samples: result.decoding[source].samples, outer_folds: result.decoding[source].folds.length, accuracy: result.decoding[source].accuracy, macro_f1: result.decoding[source].macroF1, macro_auc: result.decoding[source].macroAuc, chance: result.decoding[source].chance }));
    download(`${safe}_color_decoding_metrics.csv`, toCsv(metrics));
    const recalls = result.sources.flatMap(source => result.colors.map(color => ({
      group: source,
      color,
      recall: result.decoding[source].recall[color],
    })));
    download(`${safe}_per_color_recall.csv`, toCsv(recalls));
    download(`${safe}_cross_generalization.csv`, toCsv(csvMatrix(result.sources, result.sources, result.crossGeneralization, "train_group")));
    download(`${safe}_normalized_transfer.csv`, toCsv(csvMatrix(result.sources, result.sources, result.normalizedTransfer, "train_group")));
    download(`${safe}_human_ai_similarity.csv`, toCsv(csvMatrix(result.humanSources, result.aiSources, result.humanToAi, "train_human")));
    result.sources.forEach(source => { download(`${safe}_${source}_color_confusion.csv`, toCsv(csvMatrix(result.colors, result.colors, result.decoding[source].confusionNormalized, "true_color"))); download(`${safe}_${source}_color_similarity.csv`, toCsv(csvMatrix(result.colors, result.colors, result.decoding[source].colorSimilarity, "color"))); });
  }
  return <section className="ml-lab">
    <div className="ml-hero panel"><div><span className="eyebrow">PHASE 1 · LEAKAGE-SAFE MACHINE LEARNING</span><h2>Human vs AI · Color Decoding 与跨组泛化</h2><p>StandardScaler + RBF-SVM；Human 按 participant、AI 按 run/session 锁组。所有组内最终指标均来自 outer-fold OOF 预测。</p></div><div className="ml-actions"><label>Outer folds<input type="number" min="2" max="10" value={outerFolds} onChange={event => setOuterFolds(Number(event.target.value))} /></label><label>Inner folds<input type="number" min="2" max="5" value={innerFolds} onChange={event => setInnerFolds(Number(event.target.value))} /></label><button className="primary" disabled={running || !validRows.length} onClick={() => void run()}>{running ? "正在运行嵌套 CV…" : "运行第一阶段分析"}</button><button className="secondary" disabled={!result} onClick={exportAll}>导出全部 CSV</button></div></div>
    <div className="ml-safety panel"><b>泄漏防护</b><span>同一 participant/run 的所有颜色始终进入同一 fold。</span><span>跨组矩阵训练后只预测独立的目标组。</span><span>共同颜色类别：{result?.colors.length ?? "运行后显示"}</span></div>
    {error ? <div className="analysis-alert error"><b>无法运行</b><span>{error}</span></div> : null}
    {!result ? <div className="ml-empty panel"><b>第一阶段尚未运行</b><p>当前识别到 {new Set(validRows.map(row => row.source)).size} 个来源、{new Set(validRows.map(row => `${row.source}\0${row.cohort === "human" ? row.participant : row.run}`)).size} 个独立 participant/run。</p></div> : <>
      <section className="panel ml-section"><header><div><span>FIGURE 1</span><h3>8组 Color-decoding Accuracy / AUC</h3></div><small>虚线含义由 chance=1/K 报告；高准确率表示模式更固定，不表示更正确。</small></header><div className="ml-bars">{result.sources.map(source => { const item=result.decoding[source]; return <article key={source}><b>{source}<small>{item.cohort === "human" ? "Human" : "AI"} · n={item.units} units</small></b><div><i style={{ width: `${item.accuracy * 100}%` }} /><em style={{ left: `${item.chance * 100}%` }} /></div><strong>{(item.accuracy*100).toFixed(1)}%<small>AUC {item.macroAuc === null ? "—" : item.macroAuc.toFixed(3)}</small></strong></article>; })}</div></section>
      <section className="panel ml-section"><header><div><span>FIGURE 2</span><h3>8×8 Cross-Generalization Accuracy</h3></div><small>行=训练组，列=独立测试组；对角线为 OOF 组内解码。</small></header><Heatmap matrix={result.crossGeneralization} rows={result.sources} columns={result.sources} percent /></section>
      <section className="panel ml-section"><header><div><span>FIGURE 3 · TARGET-NORMALIZED</span><h3>8×8 Chance-corrected Normalized Transfer</h3></div><small>T(A→B)=[Acc(A→B)−Chance]/[OOF Acc(B→B)−Chance]。以测试组 B 自身可解码水平为基准；B≤chance 时显示“—”。</small></header><Heatmap matrix={result.normalizedTransfer} rows={result.sources} columns={result.sources} range={[0, matrixMaximum(result.normalizedTransfer)]} /></section>
      <div className="ml-two"><section className="panel ml-section"><header><div><span>FIGURE 4A · TARGET-NORMALIZED</span><h3>Human → AI</h3></div><small>每列按对应 AI 的 OOF 可解码水平归一化。</small></header><Heatmap matrix={result.humanToAi} rows={result.humanSources} columns={result.aiSources} range={[0, matrixMaximum(result.humanToAi)]} /></section><section className="panel ml-section"><header><div><span>FIGURE 4B · TARGET-NORMALIZED</span><h3>AI → Human</h3></div><small>每列按对应 Human 组的 OOF 可解码水平归一化。</small></header><Heatmap matrix={result.aiToHuman} rows={result.aiSources} columns={result.humanSources} range={[0, matrixMaximum(result.aiToHuman)]} /></section></div>
      <section className="panel ml-section"><header><div><span>FIGURE 8 · PHASE 1</span><h3>组内 Color Confusion / Similarity</h3></div><label>组<select value={selectedGroup} onChange={event => setMatrixGroup(event.target.value)}>{result.sources.map(source => <option key={source}>{source}</option>)}</select></label></header><div className="ml-two"><div><h4>OOF Confusion（行归一化）</h4><Heatmap matrix={result.decoding[selectedGroup].confusionNormalized} rows={result.colors} columns={result.colors} /></div><div><h4>对称化 Color Similarity</h4><Heatmap matrix={result.decoding[selectedGroup].colorSimilarity} rows={result.colors} columns={result.colors} /></div></div></section>
      <p className="ml-phase-note">第二阶段待确认后实现：RSA、Source Classification、1000次 permutation 与 Bootstrap 扩展。</p>
    </>}
  </section>;
}
