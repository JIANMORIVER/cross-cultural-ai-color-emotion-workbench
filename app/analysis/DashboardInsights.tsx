"use client";

import type { CanonicalColorRow, ExportRow, GewRow } from "./engine";

type Insight = {
  label: string;
  title: string;
  body: string;
  tone?: "finding" | "quality" | "caution";
};

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function repeatShare(rows: CanonicalColorRow[], keyOf: (row: CanonicalColorRow) => string) {
  if (!rows.length) return 0;
  const unique = new Set(rows.map(keyOf)).size;
  return Math.max(0, rows.length - unique) / rows.length;
}

function InsightPanel({ summary, insights }: { summary: string; insights: Insight[] }) {
  return <section className="dashboard-insights" aria-label="当前数据自动解读">
    <header>
      <div><span className="eyebrow">AUTOMATIC DESCRIPTIVE READING</span><h3>当前数据怎么读</h3></div>
      <span className="insight-method">规则计算 · 非生成式 AI</span>
    </header>
    <p className="insight-summary">{summary}</p>
    <div className="insight-grid">{insights.map((insight, index) => <article className={insight.tone || "finding"} key={`${insight.label}-${index}`}>
      <span>{insight.label}</span><h4>{insight.title}</h4><p>{insight.body}</p>
    </article>)}</div>
    <footer>这些文字随筛选条件即时重算，属于描述性辅助阅读；显著性、因果关系和模型优劣仍应以预注册检验、效应量与置信区间为准。</footer>
  </section>;
}

export function Task1Insights({ rows }: { rows: CanonicalColorRow[] }) {
  if (!rows.length) return null;
  const sources = [...new Set(rows.map(row => row.source))];
  const emotions = [...new Set(rows.map(row => row.emotion))];
  const cellCounts = new Map<string, number>();
  rows.forEach(row => {
    const key = `${row.source}\u0000${row.emotion}`;
    cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
  });
  const counts = [...cellCounts.values()];
  const sourceStats = sources.map(source => {
    const subset = rows.filter(row => row.source === source);
    return { source, saturation: mean(subset.map(row => row.hsvS)), lightness: mean(subset.map(row => row.labL)) };
  }).sort((a, b) => b.saturation - a.saturation);
  const high = sourceStats[0], low = sourceStats.at(-1);
  const hsRepeats = repeatShare(rows, row => `${row.source}\u0000${row.emotion}\u0000${row.hsvH.toFixed(2)}\u0000${row.hsvS.toFixed(3)}`);
  const vsRepeats = repeatShare(rows, row => `${row.source}\u0000${row.emotion}\u0000${row.hsvS.toFixed(3)}\u0000${row.hsvV.toFixed(3)}`);
  const balanceRatio = counts.length ? Math.min(...counts) / Math.max(1, Math.max(...counts)) : 0;
  const insights: Insight[] = [
    {
      label: "覆盖",
      title: `${sources.length} 个来源 × ${emotions.length} 个情绪`,
      body: `当前共有 ${rows.length.toLocaleString()} 个有效色彩；每个“来源×情绪”单元的典型样本量（中位数）为 ${median(counts).toFixed(1)}。`,
      tone: "quality",
    },
    {
      label: "来源差异",
      title: sources.length > 1 && high && low ? `${high.source} 的平均 HSV 饱和度最高` : "当前为单来源描述",
      body: sources.length > 1 && high && low
        ? `${high.source} 为 ${percent(high.saturation)}，${low.source} 为 ${percent(low.saturation)}，描述性差距 ${((high.saturation - low.saturation) * 100).toFixed(1)} 个百分点；是否稳定仍需查看置信区间和来源级检验。`
        : `平均 HSV 饱和度 ${percent(mean(rows.map(row => row.hsvS)))}，平均 Lab 明度 ${mean(rows.map(row => row.labL)).toFixed(1)}。`,
    },
    {
      label: "重叠诊断",
      title: `H–S ${percent(hsRepeats)} · V–S ${percent(vsRepeats)} 的观察与已有坐标重合`,
      body: "在下方 H–S / V–S 图开启“重叠点展开”，可以看到被遮住的重复观察及 ×N 标签。展开只是绘图位移，不参与计算。",
      tone: hsRepeats > .15 || vsRepeats > .15 ? "caution" : "quality",
    },
    {
      label: "均衡性",
      title: balanceRatio >= .8 ? "各分析单元样本量较均衡" : "部分来源×情绪单元样本量差异较大",
      body: `最小单元为 ${Math.min(...counts)}，最大单元为 ${Math.max(...counts)}，最小/最大比为 ${percent(balanceRatio)}。不均衡时不要只比较点云密度。`,
      tone: balanceRatio >= .8 ? "quality" : "caution",
    },
  ];
  return <InsightPanel summary={`总体上，这批词选色数据覆盖 ${sources.length} 个独立来源；H–S 看色相与饱和度方向，V–S 看明暗与饱和度组合。`} insights={insights} />;
}

export function Task2Insights({ rows, visibleEmotion }: { rows: GewRow[]; visibleEmotion?: string }) {
  const valid = rows.filter(row => row.valid && (!visibleEmotion || row.emotion === visibleEmotion));
  if (!valid.length) return null;
  const sources = [...new Set(valid.map(row => row.source))];
  const selected = valid.filter(row => row.selected > 0);
  const unitBreadth = new Map<string, number>();
  valid.forEach(row => {
    const key = `${row.source}\u0000${row.participant}\u0000${row.run}\u0000${row.color}`;
    if (!unitBreadth.has(key)) unitBreadth.set(key, 0);
    if (row.selected) unitBreadth.set(key, (unitBreadth.get(key) || 0) + 1);
  });
  const associations = new Map<string, { color: string; emotion: string; n: number; yes: number }>();
  valid.forEach(row => {
    const key = `${row.color}\u0000${row.emotion}`;
    const current = associations.get(key) || { color: row.color, emotion: row.emotion, n: 0, yes: 0 };
    current.n += 1; current.yes += row.selected > 0 ? 1 : 0; associations.set(key, current);
  });
  const top = [...associations.values()].sort((a, b) => b.yes / b.n - a.yes / a.n || b.n - a.n)[0];
  const sourceRates = sources.map(source => {
    const subset = valid.filter(row => row.source === source);
    return { source, rate: mean(subset.map(row => row.selected > 0 ? 1 : 0)) };
  }).sort((a, b) => b.rate - a.rate);
  const high = sourceRates[0], low = sourceRates.at(-1);
  const scope = visibleEmotion ? `情绪 ${visibleEmotion}` : "全部 20 个情绪";
  return <InsightPanel summary={`当前解读范围为${scope}；实验二的 0 表示未选择，1–5 只表示被选择后的关联强度。`} insights={[
    { label: "选择率", title: `${percent(selected.length / valid.length)} 的单元被选择`, body: `基于 ${valid.length.toLocaleString()} 个有效“试次×颜色×情绪”单元；不要把未选择的 0 与 1–5 条件强度混为同一量表。`, tone: "quality" },
    { label: "条件强度", title: selected.length ? `被选择后的平均强度为 ${mean(selected.map(row => row.intensity)).toFixed(2)} / 5` : "当前没有被选择的关联", body: `每个 participant×run×color 平均选择 ${mean([...unitBreadth.values()]).toFixed(2)} 个情绪；这是关联广度，不是情绪强度。` },
    { label: "最常见组合", title: top ? `${top.color} × ${top.emotion}` : "—", body: top ? `当前筛选下选择率为 ${percent(top.yes / top.n)}（${top.yes}/${top.n}）；这是样本内最高值，仍需结合组间检验与多重校正。` : "没有足够数据。" },
    { label: "来源范围", title: sources.length > 1 && high && low ? `${high.source} 的总体选择率最高` : "当前为单来源描述", body: sources.length > 1 && high && low ? `${high.source} ${percent(high.rate)}，${low.source} ${percent(low.rate)}；该差异可能同时包含颜色与情绪构成，不能直接解释为模型更敏感。` : `当前来源的总体选择率为 ${percent(sourceRates[0]?.rate || 0)}。`, tone: "caution" },
  ]} />;
}

function finiteValues(rows: ExportRow[], key: string) {
  return rows.flatMap(row => row[key] === null || row[key] === undefined || row[key] === "" ? [] : [Number(row[key])]).filter(Number.isFinite);
}

export function BidirectionalInsights({ rows }: { rows: ExportRow[] }) {
  if (!rows.length) return null;
  const unique = new Map<string, ExportRow>();
  rows.forEach(row => unique.set(`${row["来源"]}\u0000${row["情绪"]}`, row));
  const units = [...unique.values()];
  const jsd = finiteValues(units, "JSD相似度_综合");
  const rank = finiteValues(units, "情绪颜色排序Spearman_综合");
  const asymmetry = finiteValues(units, "平均绝对非对称");
  const top1 = units.filter(row => row["Top1相互首选"] === true).length / Math.max(1, units.length);
  const sources = [...new Set(units.map(row => String(row["来源"] || "")))].filter(Boolean);
  const sourceSimilarity = sources.map(source => {
    const subset = units.filter(row => row["来源"] === source);
    return { source, value: mean(finiteValues(subset, "JSD相似度_综合")) };
  }).sort((a, b) => b.value - a.value);
  const high = sourceSimilarity[0], low = sourceSimilarity.at(-1);
  const meanJsd = mean(jsd);
  const level = meanJsd >= .75 ? "较高" : meanJsd >= .5 ? "中等" : "较低";
  return <InsightPanel summary={`双向整合比较“词→色”的分布 P 与“色→词”的分布 Q；当前有 ${sources.length} 个可配对来源、${units.length} 个来源×情绪单元。`} insights={[
    { label: "分布一致性", title: `平均 JSD 相似度 ${meanJsd.toFixed(3)}（描述上${level}）`, body: "越接近 1，两个方向在 11 种标准色上的分布越相似；“较高/中等/较低”仅为阅读提示，不是预注册统计阈值。" },
    { label: "排序一致性", title: rank.length ? `平均 Spearman ρ = ${mean(rank).toFixed(3)}` : "排序指标暂不可用", body: `Top-1 双向相互首选率为 ${percent(top1)}；排序一致不等于概率大小完全一致。` },
    { label: "方向差", title: asymmetry.length ? `平均绝对非对称 ${mean(asymmetry).toFixed(3)}` : "方向差暂不可用", body: "越接近 0，P 与 Q 的逐颜色差异越小；它描述方向非对称，不直接说明哪一个方向更“正确”。", tone: "quality" },
    { label: "来源比较", title: sources.length > 1 && high && low ? `${high.source} 的平均分布相似度最高` : "当前为单来源配对", body: sources.length > 1 && high && low ? `${high.source} ${high.value.toFixed(3)}，${low.source} ${low.value.toFixed(3)}；双向整合属于来源级探索，不能当作个体回认实验。` : "增加同名来源的两项实验数据后，才能比较来源间双向一致性。", tone: "caution" },
  ]} />;
}
