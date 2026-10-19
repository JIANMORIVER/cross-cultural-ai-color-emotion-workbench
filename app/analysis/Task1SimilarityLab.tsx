"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { toCsv, type CanonicalColorRow, type ExportRow } from "./engine";
import { cancelTask1SimilarityJob, getTask1SimilarityJob, startTask1SimilarityJob, type SimilarityMatrix, type Task1SimilarityResult } from "./task1-similarity-client";
import { readOfflineAnalysisResult } from "./offline-result-import";

function valueOf(row: ExportRow, key: string) { const value = Number(row[key]); return Number.isFinite(value) ? value : null; }
function textOf(row: ExportRow, key: string) { return String(row[key] ?? ""); }
function download(name: string, content: Uint8Array | string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content as BlobPart], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function matrixRange(matrix: SimilarityMatrix, fallback: [number, number] = [0, 1]): [number, number] {
  const values = matrix.flat().filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? [Math.min(...values), Math.max(...values)] : fallback;
}
function Heatmap({ matrix, rows, columns, range, format = value => value.toFixed(3), lowerIsCloser = false }: { matrix: SimilarityMatrix; rows: string[]; columns: string[]; range?: [number, number]; format?: (value: number) => string; lowerIsCloser?: boolean }) {
  const [minimum, maximum] = range || matrixRange(matrix);
  return <div className="similarity-heatmap" style={{ gridTemplateColumns: `108px repeat(${columns.length}, minmax(84px,1fr))` }}><span />{columns.map(column => <b key={column}>{column}</b>)}{rows.map((row, rowIndex) => <div key={row} style={{ display: "contents" }}><strong>{row}</strong>{columns.map((column, columnIndex) => {
    const value = matrix[rowIndex]?.[columnIndex]; const raw = value === null || value === undefined ? 0 : (value - minimum) / Math.max(1e-9, maximum - minimum); const level = lowerIsCloser ? 1 - raw : raw;
    return <i key={column} className={value === null || value === undefined ? "missing" : ""} style={{ background: value === null || value === undefined ? "#edf0ef" : `rgba(39,123,146,${.08 + .84 * level})`, color: level > .58 ? "white" : "#203e49" }}>{value === null || value === undefined ? "—" : format(value)}</i>;
  })}</div>)}</div>;
}
function emotionMatrix(rows: ExportRow[], ai: string[], humans: string[], emotion: string, field: string): SimilarityMatrix {
  return ai.map(model => humans.map(country => {
    const matches = rows.filter(row => textOf(row, "ai") === model && textOf(row, "country") === country && (emotion === "Overall" || textOf(row, "emotion") === emotion));
    const values = matches.map(row => valueOf(row, field)).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }));
}
function binnedDistanceMatrix(rows: ExportRow[], ai: string[], humans: string[], bins: number, field: string): SimilarityMatrix {
  return ai.map(model => humans.map(country => {
    const values = rows
      .filter(row => valueOf(row, "binsPerAxis") === bins && textOf(row, "ai") === model && textOf(row, "country") === country)
      .map(row => valueOf(row, field))
      .filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }));
}

export function Task1SimilarityLab({ rows, fileName }: { rows: CanonicalColorRow[]; fileName: string }) {
  const [result, setResult] = useState<Task1SimilarityResult | null>(null), [running, setRunning] = useState(false), [error, setError] = useState(""), [importNotice,setImportNotice]=useState("");
  const [folds, setFolds] = useState(5), [representativeK, setRepresentativeK] = useState(3), [inferenceIterations, setInferenceIterations] = useState(0), [emotion, setEmotion] = useState("Overall"), [diversityMetric, setDiversityMetric] = useState("normalizedEntropy"), [jobId, setJobId] = useState(""), [progress, setProgress] = useState({stage:"待运行",completed:0,total:1});
  const validRows = useMemo(() => rows.filter(row => row.cohort === "human" || row.cohort === "ai"), [rows]);
  const importInput=useRef<HTMLInputElement>(null);
  const sourceCount = result?.sources.length ?? new Set(validRows.map(row => row.source)).size;
  const pointCount = result?.processedRows.length ?? validRows.length;
  async function run() {
    setRunning(true); setError(""); setResult(null);
    try { const id=await startTask1SimilarityJob(validRows,{representativeK,folds,binSizes:[6,8,10],inferenceIterations});setJobId(id);for(;;){const job=await getTask1SimilarityJob(id);setProgress({stage:job.stage||"计算中",completed:job.completed||0,total:Math.max(1,job.total||1)});if(job.status==="completed"&&job.result){setResult(job.result);break}if(job.status==="failed")throw new Error(job.error||"多层相似性分析失败");if(job.status==="cancelled")throw new Error("本次多层相似性分析已取消。");await new Promise(resolve=>setTimeout(resolve,700))} }
    catch (reason) { setError(reason instanceof Error ? reason.message : "多层相似性分析失败。"); }
    finally { setRunning(false);setJobId(""); }
  }
  async function cancel(){if(!jobId)return;try{await cancelTask1SimilarityJob(jobId);setProgress(current=>({...current,stage:"正在取消…"}))}catch(reason){setError(reason instanceof Error?reason.message:"取消失败")}}
  async function importOffline(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value="";if(!file)return;setError("");setImportNotice("");try{const imported=await readOfflineAnalysisResult(file,"similarity");setResult(imported);setInferenceIterations(imported.separability.inference.iterations);const importedFolds=Number(imported.countryAlignment.folds);if(Number.isFinite(importedFolds)&&importedFolds>=2)setFolds(importedFolds);setEmotion("Overall");setProgress({stage:"已导入离线结果",completed:1,total:1});setImportNotice(`已导入 ${file.name} · ${imported.sources.length} 个来源 · ${imported.separability.inference.iterations.toLocaleString()} 次分组推断`)}catch(reason){setError(reason instanceof Error?reason.message:"离线结果导入失败")}}
  async function exportAll() {
    if (!result) return;
    const { zipSync, strToU8 } = await import("fflate"); const safe = (fileName || "chromalab").replace(/\.[^.]+$/, "");
    const files: Record<string, Uint8Array> = {
      "processed_continuous_color_features.csv": strToU8(toCsv(result.processedRows)),
      "distribution_statistics.csv": strToU8(toCsv(result.distributionStatistics)),
      "dominant_region_coverage.csv": strToU8(toCsv(result.coverage.rows)),
      "distribution_distance_sensitivity.csv": strToU8(toCsv(result.distances.rows)),
      "pairwise_classifier_separability.csv": strToU8(toCsv(result.separability.rows)),
      "auc_group_bootstrap_summary.csv": strToU8(toCsv(result.separability.inference.pairSummaries)),
      "auc_group_bootstrap_samples.csv": strToU8(toCsv(result.separability.inference.bootstrapSamples)),
      "auc_group_permutation_samples.csv": strToU8(toCsv(result.separability.inference.permutationSamples)),
      "auc_country_delta_summary.csv": strToU8(toCsv(result.separability.inference.deltaSummaries)),
      "auc_closest_country_stability.csv": strToU8(toCsv(result.separability.inference.closestStability)),
      "auc_closest_country_bootstrap_draws.csv": strToU8(toCsv(result.separability.inference.closestDraws)),
      "human_trained_country_alignment.csv": strToU8(toCsv(result.countryAlignment.probabilities)),
      "three_evidence_report.csv": strToU8(toCsv(result.evidence)),
      "method.json": strToU8(JSON.stringify(result.method, null, 2)),
    };
    download(`${safe}_experiment1_multilevel_similarity.zip`, zipSync(files, { level: 1 }), "application/zip");
  }
  const coverageMatrix = result ? emotionMatrix(result.coverage.rows, result.aiSources, result.humanSources, emotion, "consensusCoverage") : [];
  const diversitySources = result?.sources || [];
  const diversityMatrix: SimilarityMatrix = result ? diversitySources.map(source => result.emotions.map(itemEmotion => {
    const item = result.distributionStatistics.find(row => textOf(row, "source") === source && textOf(row, "emotion") === itemEmotion);
    return item ? valueOf(item, diversityMetric) : null;
  })) : [];
  const sensitivity = result ? result.distances.binSizes.flatMap(bins => result.aiSources.flatMap(ai => result.humanSources.map(country => {
    const matches = result.distances.rows.filter(row => valueOf(row, "binsPerAxis") === bins && textOf(row, "ai") === ai && textOf(row, "country") === country);
    const emd = matches.map(row => valueOf(row, "emdDeltaE76")).filter((value): value is number => value !== null);
    return { bins, ai, country, emd: emd.length ? emd.reduce((sum, value) => sum + value, 0) / emd.length : null };
  }))) : [];
  const emdByBins = result ? result.distances.binSizes.map(bins => ({
    bins,
    matrix: binnedDistanceMatrix(result.distances.rows, result.aiSources, result.humanSources, bins, "emdDeltaE76"),
  })) : [];
  const emdSharedRange = matrixRange(emdByBins.flatMap(item => item.matrix), [0, 1]);
  const closestStabilityMatrix: SimilarityMatrix = result ? result.aiSources.map(ai => result.humanSources.map(country => {
    const row = result.separability.inference.closestStability.find(item => textOf(item, "ai") === ai && textOf(item, "country") === country);
    return row ? valueOf(row, "stabilityProportion") : null;
  })) : [];
  const percent=Math.min(100,Math.round(progress.completed/Math.max(1,progress.total)*100)),longWork=inferenceIterations>100;
  return <section className="task1-similarity-lab panel">
    <header className="similarity-hero"><div><span className="eyebrow">EXPERIMENT 1 · MULTI-LEVEL SIMILARITY</span><h2>Human–AI 连续颜色多层相似性</h2><p>不使用平均颜色距离给出主结论。分别报告主导区域覆盖、完整分布距离与分类器可分性；三个结果不合成为单一分数。</p></div><div className="similarity-actions"><label>KMeans K<input type="number" min="1" max="5" value={representativeK} disabled={running} onChange={event => setRepresentativeK(Number(event.target.value))} /></label><label>Group CV folds<input type="number" min="2" max="10" value={folds} disabled={running} onChange={event => setFolds(Number(event.target.value))} /></label><label>Bootstrap / Permutation<input type="number" min="0" max="5000" step="1" value={inferenceIterations} disabled={running} onChange={event => setInferenceIterations(Number(event.target.value))} /></label><div className="similarity-presets"><button disabled={running} onClick={()=>setInferenceIterations(0)}>快速结果：仅观察值</button><button disabled={running} onClick={()=>setInferenceIterations(1)}>流程试算：1次</button><button disabled={running} onClick={()=>setInferenceIterations(1000)}>正式推断：1000次</button></div><button className="primary" disabled={running || !validRows.length} onClick={() => void run()}>{running ? `${progress.stage} ${percent}%` : "运行多层相似性分析"}</button>{running?<button className="secondary" onClick={()=>void cancel()}>取消计算</button>:null}<input ref={importInput} type="file" hidden accept=".gz,.json,application/gzip,application/json" onChange={event=>void importOffline(event)}/><button className="secondary offline-import-button" disabled={running} onClick={()=>importInput.current?.click()}>导入离线结果 .json.gz</button><button className="secondary" disabled={!result} onClick={() => void exportAll()}>导出全部 CSV.zip</button></div></header>
    {running?<div className="continuous-progress"><div><span style={{width:`${percent}%`}}/></div><p>{progress.stage} · {progress.completed.toLocaleString()} / {progress.total.toLocaleString()}（{percent}%）</p></div>:null}
    {longWork&&!running?<div className="analysis-alert error"><b>长任务提醒</b><span>每个迭代包含16组 AI–Country 的 Group-CV Bootstrap 与置换，1000次会产生约32,000次交叉验证任务。请先运行10次检查，正式推断时不要同时启动其他分析。</span></div>:null}
    <div className="similarity-guard"><b>解释约束</b><span>Coverage 越高越接近</span><span>EMD / JSD 越低越接近</span><span>AUC 越接近 0.5 越难区分</span><span>当前 {sourceCount} 个来源 · {pointCount.toLocaleString()} 个原始颜色点</span></div>
    {importNotice?<div className="offline-import-notice"><b>R9000P 离线结果已载入</b><span>{importNotice}；本次仅展示保存结果，不重新计算。</span></div>:null}
    {error ? <div className="analysis-alert error"><b>无法完成分析</b><span>{error}</span></div> : null}
    {!result ? <div className="similarity-empty"><b>尚未运行</b><p>默认0次：约一分钟内生成分布、EMD、Coverage 与观察 AUC；1次仅用于验证完整推断流程。1000次 Bootstrap + 1000次置换属于正式长任务。</p></div> : <>
      {result.missingIdentitySources.length ? <div className="analysis-alert error"><b>分类器身份字段不完整</b><span>{result.missingIdentitySources.join("、")} 缺少 participant/run ID；分布分析仍有效，但相关 AUC 不会计算。</span></div> : null}
      <section className="similarity-section"><header><div><span>LEVEL 1 · DISTRIBUTION & CONCENTRATION</span><h3>来源 × 情绪的多样性 / 集中度</h3></div><label>指标<select value={diversityMetric} onChange={event => setDiversityMetric(event.target.value)}><option value="normalizedEntropy">标准化 Hue 熵</option><option value="convexHullAreaAB">a*b* Convex Hull Area</option><option value="withinMeanPairwiseDeltaE76">组内平均 pairwise ΔE76</option><option value="largestClusterProportion">最大 KMeans 簇比例</option></select></label></header><Heatmap matrix={diversityMatrix} rows={diversitySources} columns={result.emotions} range={diversityMetric === "normalizedEntropy" || diversityMetric === "largestClusterProportion" ? [0, 1] : undefined} /><p>熵、色域面积和组内 ΔE 越高表示越分散；最大簇比例越高表示越集中。它们是分布形态描述，不直接等于 Human–AI 相似性。</p></section>
      <section className="similarity-section"><header><div><span>LEVEL 2 · DOMINANT-REGION CAPTURE</span><h3>AI 落入人类主导颜色区域的比例</h3></div><label>情绪<select value={emotion} onChange={event => setEmotion(event.target.value)}><option>Overall</option>{result.emotions.map(item => <option key={item}>{item}</option>)}</select></label></header><Heatmap matrix={coverageMatrix} rows={result.aiSources} columns={result.humanSources} range={[0, 1]} format={value => `${(value * 100).toFixed(1)}%`} /><p>KMeans 最大簇与 DBSCAN 最大非噪声簇分别估计人类主导区域；表中为两种可用覆盖率的均值。Overall 为20个情绪的等权平均。</p></section>
      <section className="similarity-section"><header><div><span>LEVEL 3A · DISTRIBUTION DISTANCE</span><h3>AI × Country EMD · 6³ / 8³ / 10³</h3></div><small>三种分箱共用色阶 · 8³ 为主分析</small></header><div className="similarity-bin-grid">{emdByBins.map(item => <div className="similarity-bin-panel" key={item.bins}><h4>{item.bins}³ bins{item.bins === result.distances.primaryBins ? <em>主分析</em> : <em>敏感性</em>}</h4><Heatmap matrix={item.matrix} rows={result.aiSources} columns={result.humanSources} range={emdSharedRange} lowerIsCloser format={value => value.toFixed(2)} /></div>)}</div><p>每个单元格均为20个情绪的等权平均 EMD；越低越近。三图使用同一数值范围与同一色阶，可直接比较分箱敏感性；ground distance 为 CIELAB 分箱中心间 ΔE76。</p></section>
      <section className="similarity-section"><header><div><span>LEVEL 3B · SUPPLEMENT</span><h3>AI × Country JSD</h3></div><small>{result.distances.primaryBins}³ 同分箱</small></header><Heatmap matrix={result.distances.jsdMatrix} rows={result.aiSources} columns={result.humanSources} range={[0, 1]} lowerIsCloser /><p>越低越近；作为 EMD 的分布形状补充。</p></section>
      <section className="similarity-section"><header><div><span>SENSITIVITY</span><h3>EMD 对分箱大小的敏感性</h3></div></header><div className="sensitivity-table"><table><thead><tr><th>AI</th><th>Country</th>{result.distances.binSizes.map(bins => <th key={bins}>{bins}³</th>)}</tr></thead><tbody>{result.aiSources.flatMap(ai => result.humanSources.map(country => <tr key={`${ai}-${country}`}><td>{ai}</td><td>{country}</td>{result.distances.binSizes.map(bins => { const item = sensitivity.find(row => row.bins === bins && row.ai === ai && row.country === country); return <td key={bins}>{item?.emd == null ? "—" : item.emd.toFixed(2)}</td>; })}</tr>))}</tbody></table></div></section>
      <section className="similarity-section"><header><div><span>LEVEL 4 · CLASSIFIER SEPARABILITY</span><h3>AI vs Country · Group-CV AUC</h3></div><small>AUC=0.5 表示难以区分</small></header><Heatmap matrix={result.separability.aucMatrix} rows={result.aiSources} columns={result.humanSources} range={[.5, 1]} lowerIsCloser /><p>输入为 emotion one-hot + Lab + LCh + HSV + sin/cos Hue；同一 participant/run 不跨训练与测试 fold。</p></section>
      <section className="similarity-section auc-inference-section"><header><div><span>LEVEL 4A · GROUP-LEVEL INFERENCE</span><h3>AUC 的 participant/run Bootstrap 95% CI 与置换检验</h3></div><small>{result.separability.inference.iterations.toLocaleString()} 次 · 单侧 H₁: AUC &gt; 0.5</small></header><div className="sensitivity-table"><table><thead><tr><th>AI</th><th>Country</th><th>AUC</th><th>95% CI</th><th>Permutation p</th><th>结论</th><th>完整 units (H / AI)</th></tr></thead><tbody>{result.separability.inference.pairSummaries.map(row => { const auc=valueOf(row,"auc"), low=valueOf(row,"ciLow"), high=valueOf(row,"ciHigh"), p=valueOf(row,"permutationP"), significant=row.significantAboveChance === true; return <tr key={`${textOf(row,"ai")}-${textOf(row,"country")}`}><td>{textOf(row,"ai")}</td><td>{textOf(row,"country")}</td><td>{auc?.toFixed(3) ?? "—"}</td><td>{low == null || high == null ? "—" : `[${low.toFixed(3)}, ${high.toFixed(3)}]`}</td><td>{p == null ? "—" : p < .001 ? "< .001" : p.toFixed(3)}</td><td><span className={significant ? "inference-significant" : "inference-neutral"}>{significant ? "显著高于 0.5" : "未达显著"}</span></td><td>{valueOf(row,"humanUnits") ?? "—"} / {valueOf(row,"aiUnits") ?? "—"}</td></tr>; })}</tbody></table></div><p>重采样单位是完整 participant/run，而不是单行；每次抽中一个单位即保留其全部20条情绪记录。只纳入拥有完整20情绪的单位，排除数记录在导出表中。</p></section>
      <section className="similarity-section auc-inference-section"><header><div><span>LEVEL 4B · CLOSEST-COUNTRY CONTRASTS</span><h3>最低 AUC 国家与其他国家的配对 ΔAUC</h3></div><small>Δ = 其他国家 AUC − 原始最低国家 AUC</small></header><div className="sensitivity-table"><table><thead><tr><th>AI</th><th>原始最低国家</th><th>比较国家</th><th>ΔAUC</th><th>95% CI</th><th>结论</th></tr></thead><tbody>{result.separability.inference.deltaSummaries.map(row => { const delta=valueOf(row,"observedDeltaAuc"), low=valueOf(row,"ciLow"), high=valueOf(row,"ciHigh"), referenceLower=row.referenceSignificantlyLower === true, reversed=high != null && high < 0; return <tr key={`${textOf(row,"ai")}-${textOf(row,"comparisonCountry")}`}><td>{textOf(row,"ai")}</td><td>{textOf(row,"referenceCountry")}</td><td>{textOf(row,"comparisonCountry")}</td><td>{delta?.toFixed(3) ?? "—"}</td><td>{low == null || high == null ? "—" : `[${low.toFixed(3)}, ${high.toFixed(3)}]`}</td><td><span className={referenceLower ? "inference-significant" : "inference-neutral"}>{referenceLower ? "最低国家显著更难区分" : reversed ? "方向反转" : "差异不显著"}</span></td></tr>; })}</tbody></table></div><p>四个国家在每轮使用同一组 AI run 抽样，因此 ΔAUC 是配对 bootstrap 差值。只有 CI 全部大于0，才说明原始最低国家显著更难区分；CI 全部小于0会明确标记为方向反转。</p></section>
      <section className="similarity-section"><header><div><span>LEVEL 4C · SELECTION STABILITY</span><h3>Bootstrap 中“最低 AUC 国家”的稳定性</h3></div><small>并列最低按 1/k 分配权重</small></header><Heatmap matrix={closestStabilityMatrix} rows={result.aiSources} columns={result.humanSources} range={[0,1]} format={value => `${(value*100).toFixed(1)}%`} /><p>比例越高，说明该国家在重采样后仍最难与对应 AI 区分。每一轮的最低国家及并列情况均写入导出文件。</p></section>
      <section className="similarity-section"><header><div><span>HUMAN-TRAINED ALIGNMENT</span><h3>AI 在人类国家分类空间中的预测概率</h3></div><small>Human OOF accuracy {result.countryAlignment.oofAccuracy == null ? "—" : `${(result.countryAlignment.oofAccuracy * 100).toFixed(1)}%`}</small></header><Heatmap matrix={result.countryAlignment.matrix} rows={result.aiSources} columns={result.humanSources} range={[0, 1]} format={value => `${(value * 100).toFixed(1)}%`} /><p>只用人类数据训练多分类模型，再投射 AI；它回答文化方向，不替代 EMD、coverage 或 pairwise AUC。</p></section>
      <section className="similarity-section evidence-section"><header><div><span>FINAL · THREE-EVIDENCE REPORT</span><h3>三条证据并列报告</h3></div><small>不计算综合分数</small></header><div className="sensitivity-table"><table><thead><tr><th>AI</th><th>Country</th><th>Coverage ↑</th><th>EMD ↓</th><th>JSD ↓</th><th>AUC → 0.5</th><th>三类名次</th></tr></thead><tbody>{result.evidence.map(row => <tr key={`${textOf(row, "ai")}-${textOf(row, "country")}`}><td>{textOf(row, "ai")}</td><td>{textOf(row, "country")}</td><td>{valueOf(row, "coverage") == null ? "—" : `${(valueOf(row, "coverage")! * 100).toFixed(1)}%`}</td><td>{valueOf(row, "emdDeltaE76")?.toFixed(2) ?? "—"}</td><td>{valueOf(row, "jsdDistance")?.toFixed(3) ?? "—"}</td><td>{valueOf(row, "auc")?.toFixed(3) ?? "—"}</td><td>C{row.coverageRank ?? "—"} · E{row.emdRank ?? "—"} · A{row.aucClosenessRank ?? "—"}</td></tr>)}</tbody></table></div><p>只有当某国家同时表现为 coverage 较高、EMD 较低且 AUC 接近 0.5，才可描述为多项证据一致；若三者不一致，应报告证据分歧而不是强行选出单一“最接近”国家。</p></section>
      <details className="similarity-method"><summary>查看完整方法记录</summary>{Object.entries(result.method).map(([key, value]) => <p key={key}><b>{key}</b>{value}</p>)}</details>
    </>}
  </section>;
}
