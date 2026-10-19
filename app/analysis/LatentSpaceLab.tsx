"use client";

import { useMemo, useState } from "react";
import { GEW_EMOTIONS, type CanonicalColorRow } from "./engine";

type Cohort = "human" | "ai" | "unspecified";
type Unit = { source: string; emotion: string; cohort: Cohort; vector: number[]; hueEntropy: number; point: [number, number] };

const EMOTION_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, value, index) => sum + (value - (b[index] || 0)) ** 2, 0));
const rank = (values: number[]) => [...values].map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value).reduce((out, item, index) => { out[item.index] = index + 1; return out; }, Array(values.length).fill(0) as number[]);
const correlation = (a: number[], b: number[]) => { if (a.length < 3) return null; const ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb); const numerator = ra.reduce((sum, x, i) => sum + (x - ma) * (rb[i] - mb), 0); const denominator = Math.sqrt(ra.reduce((sum, x) => sum + (x - ma) ** 2, 0) * rb.reduce((sum, x) => sum + (x - mb) ** 2, 0)); return denominator ? numerator / denominator : 0; };

function histogram(values: number[], bins: number, max = 1) {
  const output = Array(bins).fill(0) as number[];
  values.forEach(value => output[Math.min(bins - 1, Math.max(0, Math.floor(value / max * bins)))] += 1);
  return output.map(value => values.length ? value / values.length : 0);
}

function entropy(values: number[]) { return -values.filter(value => value > 0).reduce((sum, value) => sum + value * Math.log2(value), 0); }

function makeUnits(rows: CanonicalColorRow[]): Unit[] {
  const units: Unit[] = [];
  [...new Set(rows.map(row => `${row.source}\u0000${row.emotion}`))].forEach(key => {
    const [source, emotion] = key.split("\u0000");
    const subset = rows.filter(row => row.source === source && row.emotion === emotion);
    if (!subset.length) return;
    const hues = histogram(subset.map(row => ((row.hsvH % 360) + 360) % 360), 12, 360);
    const saturations = histogram(subset.map(row => row.hsvS), 6);
    const values = histogram(subset.map(row => row.hsvV), 6);
    const vector = [...hues, ...saturations, ...values, mean(subset.map(row => row.labL)) / 100, mean(subset.map(row => row.labA)) / 128, mean(subset.map(row => row.labB)) / 128, mean(subset.map(row => row.hsvS)), mean(subset.map(row => row.hsvV))];
    units.push({ source, emotion, cohort: subset[0].cohort, vector, hueEntropy: entropy(hues), point: [0, 0] });
  });
  return units;
}

function pca(units: Unit[]) {
  if (!units.length) return units;
  const width = units[0].vector.length;
  const center = Array.from({ length: width }, (_, index) => mean(units.map(unit => unit.vector[index])));
  const scale = Array.from({ length: width }, (_, index) => Math.sqrt(mean(units.map(unit => (unit.vector[index] - center[index]) ** 2))) || 1);
  const values = units.map(unit => unit.vector.map((value, index) => (value - center[index]) / scale[index]));
  const multiply = (vector: number[]) => values.reduce((out, row) => { const projection = row.reduce((sum, value, index) => sum + value * vector[index], 0); row.forEach((value, index) => { out[index] += value * projection; }); return out; }, Array(width).fill(0) as number[]);
  const eigen = (subtract?: number[]) => { let vector = Array.from({ length: width }, (_, index) => Math.sin(index + 1) + .2); for (let iteration = 0; iteration < 60; iteration += 1) { const next = multiply(vector).map((value, index) => value - (subtract ? subtract[index] * vector.reduce((sum, item, j) => sum + item * subtract[j], 0) : 0)); const norm = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0)) || 1; vector = next.map(value => value / norm); } return vector; };
  const first = eigen(); const second = eigen(first); return units.map((unit, index) => ({ ...unit, point: [values[index].reduce((sum, value, i) => sum + value * first[i], 0), values[index].reduce((sum, value, i) => sum + value * second[i], 0)] as [number, number] }));
}

function calculateMetrics(units: Unit[]) {
  const human = units.filter(unit => unit.cohort === "human"), ai = units.filter(unit => unit.cohort === "ai");
  const centroid = (items: Unit[]) => items.length ? [mean(items.map(item => item.point[0])), mean(items.map(item => item.point[1]))] : null;
  const humanCenter = centroid(human), aiCenter = centroid(ai);
  const separation = humanCenter && aiCenter ? distance(humanCenter, aiCenter) : null;
  const kernel = (a: Unit, b: Unit) => Math.exp(-(distance(a.point, b.point) ** 2) / 2);
  const averageKernel = (left: Unit[], right: Unit[]) => left.length && right.length ? mean(left.flatMap(a => right.map(b => kernel(a, b)))) : 0;
  const mmd = human.length && ai.length ? averageKernel(human, human) + averageKernel(ai, ai) - 2 * averageKernel(human, ai) : null;
  const classify = (item: Unit) => { if (!humanCenter || !aiCenter || item.cohort === "unspecified") return null; return distance(item.point, humanCenter) <= distance(item.point, aiCenter) ? "human" : "ai"; };
  const classified = [...human, ...ai].map(item => ({ item, prediction: classify(item) })).filter(item => item.prediction);
  const accuracy = classified.length ? classified.filter(item => item.prediction === item.item.cohort).length / classified.length : null;
  const observedF = humanCenter && aiCenter && human.length && ai.length ? separation! ** 2 / (mean(human.map(item => distance(item.point, humanCenter) ** 2).concat(ai.map(item => distance(item.point, aiCenter) ** 2))) || 1) : null;
  const permutations = observedF === null ? 0 : 199;
  let extreme = 0;
  if (permutations) {
    const labels = [...human.map(() => "human" as const), ...ai.map(() => "ai" as const)];
    for (let seed = 0; seed < permutations; seed += 1) {
      const shuffled = [...labels]; for (let index = shuffled.length - 1; index > 0; index -= 1) { const swap = (seed * 17 + index * 31) % (index + 1); [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]; }
      const a = units.filter((_, index) => shuffled[index] === "human"), b = units.filter((_, index) => shuffled[index] === "ai"); const ac = centroid(a), bc = centroid(b); if (!ac || !bc) continue; const f = distance(ac, bc) ** 2 / (mean(a.map(item => distance(item.point, ac) ** 2).concat(b.map(item => distance(item.point, bc) ** 2))) || 1); if (f >= observedF!) extreme += 1;
    }
  }
  const pValue = observedF === null ? null : (extreme + 1) / (permutations + 1);
  const emotionDistance = GEW_EMOTIONS.map(emotion => { const h = centroid(human.filter(item => item.emotion === emotion)), a = centroid(ai.filter(item => item.emotion === emotion)); return h && a ? { emotion, value: distance(h, a) } : null; }).filter(Boolean).sort((a, b) => b!.value - a!.value) as Array<{ emotion: string; value: number }>;
  const structures = (items: Unit[]) => { const present = GEW_EMOTIONS.filter(emotion => items.some(item => item.emotion === emotion)); const centers = new Map(present.map(emotion => [emotion, centroid(items.filter(item => item.emotion === emotion))!])); const values: number[] = []; present.forEach((a, i) => present.slice(i + 1).forEach(b => values.push(distance(centers.get(a)!, centers.get(b)!)))); return { present, centers, values }; };
  const hs = structures(human), as = structures(ai), common = GEW_EMOTIONS.filter(emotion => hs.centers.has(emotion) && as.centers.has(emotion)); const humanDistances: number[] = [], aiDistances: number[] = [];
  common.forEach((a, i) => common.slice(i + 1).forEach(b => { humanDistances.push(distance(hs.centers.get(a)!, hs.centers.get(b)!)); aiDistances.push(distance(as.centers.get(a)!, as.centers.get(b)!)); }));
  const entropyHuman = mean(human.map(item => item.hueEntropy)), entropyAi = mean(ai.map(item => item.hueEntropy));
  const compactHuman = human.length ? mean(human.map(item => distance(item.point, humanCenter!))) : null, compactAi = ai.length ? mean(ai.map(item => distance(item.point, aiCenter!))) : null;
  return { humanCount: human.length, aiCount: ai.length, separation, mmd, accuracy, observedF, pValue, emotionDistance, structureCorrelation: correlation(humanDistances, aiDistances), entropyHuman, entropyAi, compactHuman, compactAi };
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) { return <article className="latent-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

export function LatentSpaceLab({ rows }: { rows: CanonicalColorRow[] }) {
  const [view, setView] = useState<"space" | "emotion" | "structure">("space");
  const units = useMemo(() => pca(makeUnits(rows)), [rows]);
  const metrics = useMemo(() => calculateMetrics(units), [units]);
  const minX = Math.min(-1, ...units.map(unit => unit.point[0])), maxX = Math.max(1, ...units.map(unit => unit.point[0])), minY = Math.min(-1, ...units.map(unit => unit.point[1])), maxY = Math.max(1, ...units.map(unit => unit.point[1]));
  const point = (item: Unit) => [32 + (item.point[0] - minX) / (maxX - minX || 1) * 596, 326 - (item.point[1] - minY) / (maxY - minY || 1) * 280] as const;
  if (!rows.length) return <section className="latent-space panel"><h3>潜在认知空间</h3><p>需要先导入实验一的颜色—情绪记录。</p></section>;
  return <section className="latent-space panel">
    <header className="latent-head"><div><span className="eyebrow">SHARED LOW-DIMENSIONAL COLOR–EMOTION SPACE</span><h3>潜在认知空间</h3><p>每个点代表一个“来源 × 情绪”单元；使用相同颜色分布特征和共享 PCA 投影，不把它解释为模型拥有人的认知。</p></div><div className="latent-actions"><button className={view === "space" ? "active" : ""} onClick={() => setView("space")}>空间分布</button><button className={view === "emotion" ? "active" : ""} onClick={() => setView("emotion")}>情绪偏离</button><button className={view === "structure" ? "active" : ""} onClick={() => setView("structure")}>结构对照</button></div></header>
    <div className="latent-metrics"><MetricCard label="有效单元" value={`${units.length}`} note={`${metrics.humanCount} Human · ${metrics.aiCount} AI`} /><MetricCard label="Human–AI 中心距离" value={metrics.separation === null ? "—" : metrics.separation.toFixed(3)} note="共享潜在坐标中的欧氏距离" /><MetricCard label="MMD" value={metrics.mmd === null ? "—" : metrics.mmd.toFixed(3)} note="RBF 核的分布差异描述" /><MetricCard label="置换 F / p" value={metrics.observedF === null ? "—" : `${metrics.observedF.toFixed(2)} / ${metrics.pValue!.toFixed(3)}`} note="199 次标签置换的近似检验" /><MetricCard label="中心分类准确率" value={metrics.accuracy === null ? "—" : `${(metrics.accuracy * 100).toFixed(1)}%`} note="描述性最近中心分类，不是验证集性能" /><MetricCard label="结构 Spearman" value={metrics.structureCorrelation === null ? "—" : metrics.structureCorrelation.toFixed(3)} note="Human / AI 情绪距离矩阵相关" /></div>
    {view === "space" ? <div className="latent-space-grid"><div><svg className="latent-scatter" viewBox="0 0 660 360" role="img" aria-label="Human and AI latent space scatter"><line x1="32" y1="326" x2="628" y2="326" /><line x1="32" y1="46" x2="32" y2="326" />{units.map((unit, index) => { const [x, y] = point(unit); const color = EMOTION_COLORS[GEW_EMOTIONS.indexOf(unit.emotion as typeof GEW_EMOTIONS[number]) % EMOTION_COLORS.length]; return <g key={`${unit.source}-${unit.emotion}-${index}`}><circle cx={x} cy={y} r={unit.cohort === "ai" ? 6 : 5} fill={color} fillOpacity=".78" stroke={unit.cohort === "human" ? "#173f52" : "#fff"} strokeWidth={unit.cohort === "human" ? 2 : 1} strokeDasharray={unit.cohort === "ai" ? "" : "3 2"}><title>{unit.source} · {unit.emotion} · {unit.cohort}</title></circle></g>; })}<text x="330" y="352">Latent dimension 1</text><text transform="translate(12 220) rotate(-90)">Latent dimension 2</text></svg><div className="latent-legend"><span><i className="human-dot" />Human</span><span><i className="ai-dot" />AI</span><small>点颜色 = 情绪；点形状/描边 = 来源类型</small></div></div><div className="latent-method"><h4>当前读法</h4><p>{metrics.separation === null ? "当前数据没有同时标记 Human 与 AI，无法计算两类空间距离。" : `Human 与 AI 的中心距离为 ${metrics.separation.toFixed(3)}；这只是共享特征空间中的描述性差异。`}</p><p>{metrics.pValue === null ? "" : `置换检验（199 次）得到 p≈${metrics.pValue.toFixed(3)}；这是近似检验，正式论文建议在固定分析脚本中复核。`}</p><p>输入特征：12 个 Hue 分箱、6 个 Saturation 分箱、6 个 Value 分箱、Lab 均值、平均 S/V。未使用来源编号作为特征。</p></div></div> : null}
    {view === "emotion" ? <div className="latent-ranking"><h4>Human–AI 情绪级潜在距离</h4><p>距离越大，表示该情绪的颜色分布结构在两类来源之间偏离越明显。</p>{metrics.emotionDistance.map(item => <div className="latent-rank-row" key={item.emotion}><b>{item.emotion}</b><span><i style={{ width: `${Math.min(100, item.value / Math.max(.001, metrics.emotionDistance[0]?.value || 1) * 100)}%` }} /></span><strong>{item.value.toFixed(3)}</strong></div>)}{!metrics.emotionDistance.length ? <p>当前没有同时包含 Human 与 AI 的共同情绪。</p> : null}</div> : null}
    {view === "structure" ? <div className="latent-structure"><div><h4>结构与紧凑性</h4><table><tbody><tr><th />Human</tr><tr><th>平均 Hue 熵</th><td>{metrics.entropyHuman ? metrics.entropyHuman.toFixed(3) : "—"}</td></tr><tr><th>潜在中心平均距离</th><td>{metrics.compactHuman === null ? "—" : metrics.compactHuman.toFixed(3)}</td></tr><tr><th />AI</tr><tr><th>平均 Hue 熵</th><td>{metrics.entropyAi ? metrics.entropyAi.toFixed(3) : "—"}</td></tr><tr><th>潜在中心平均距离</th><td>{metrics.compactAi === null ? "—" : metrics.compactAi.toFixed(3)}</td></tr></tbody></table></div><div className="latent-method"><h4>学术解释边界</h4><p>低熵或较小中心距离可作为“颜色关联更集中/更原型化”的描述性线索，不能单独证明模型更刻板。</p><p>正式结论还应报告 MMD、PERMANOVA、稳定性重抽样，以及按实验轮次或参与者层级进行的独立检验。</p></div></div> : null}
    <footer className="latent-foot">方法标签：共享标准化特征 → PCA 2D 低维代理；当前显示 MMD、最近中心分类、情绪级距离、结构 Spearman，以及 199 次确定性标签置换得到的 F/p 近似值。PCA 用于稳定、可复现的当前浏览器分析；它不是 Autoencoder，也不代表真实认知过程。若论文需要 Autoencoder，可将同一特征矩阵送入预注册的 Python 模型脚本，并保留本模块作为透明基线。</footer>
  </section>;
}
