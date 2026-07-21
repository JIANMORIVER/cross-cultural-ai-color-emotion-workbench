export type CellValue = string | number | boolean | Date | null | undefined;
export type DataRow = Record<string, CellValue>;
export type ExportRow = Record<string, string | number | boolean | null>;

export type ColorFormat = "HEX" | "RGB" | "HSL" | "HSV" | "Lab";
export type SchemaKind = "task1-wide" | "task1-long" | "task2-gew" | "mixed" | "unknown";

export type Detection = {
  schema: SchemaKind;
  schemaLabel: string;
  confidence: number;
  formats: ColorFormat[];
  evidence: string[];
  warnings: string[];
};

export type CanonicalColorRow = {
  row: number;
  source: string;
  emotion: string;
  hex: string;
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  hsvH: number;
  hsvS: number;
  hsvV: number;
  labL: number;
  labA: number;
  labB: number;
};

export type GewRow = {
  participant: string;
  source: string;
  run: string;
  color: string;
  emotion: string;
  selected: number;
  intensity: number;
  valid: boolean;
};

export type AnalysisResult = {
  id: string;
  title: string;
  kind: "table" | "colors" | "matrix" | "statistics";
  rows: ExportRow[];
  summary: Array<{ label: string; value: string }>;
  note?: string;
};

export const GEW_EMOTIONS = [
  "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
  "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
] as const;
export const GEW_COLOURS = ["D38", "F17", "F4", "J0", "F0", "F29", "A0", "H35", "I6", "G3", "C9"] as const;

export const VALENCE: Record<string, number> = Object.fromEntries(GEW_EMOTIONS.map((emotion, index) => [emotion, index < 10 ? 1 : -1]));

const ALIASES = {
  source: ["source", "group", "model", "model_alias", "platform", "_source_file", "平台", "模型", "来源", "组别"],
  emotion: ["emotion", "word", "emotion_word", "情绪", "情绪词"],
  hex: ["hex", "color", "colour", "hex_color", "hex colour", "色值", "颜色"],
  r: ["r", "red", "rgb_r"], g: ["g", "green", "rgb_g"], b: ["b", "blue", "rgb_b"],
  h: ["h", "hue", "hsl_h"], s: ["s", "saturation", "hsl_s"], l: ["l", "lightness", "hsl_l"],
  hh: ["h_hsv", "hsv_h", "hue_hsv"], ss: ["s_hsv", "hsv_s", "saturation_hsv"], v: ["v", "value", "hsv_v"],
  labL: ["l*", "lab_l", "l_lab", "cie_l"], labA: ["a*", "lab_a", "a_lab", "cie_a"], labB: ["b*", "lab_b", "b_lab", "cie_b"],
  participant: ["participant", "participant_id", "sample_id", "id", "trial_id", "实验id", "样本id"],
  run: ["run", "run_index", "repetition", "轮次", "重复轮次"],
};

function cleanName(value: string) { return value.trim().toLowerCase().replaceAll("－", "-"); }
function findColumn(columns: string[], aliases: readonly string[]) {
  const byClean = new Map(columns.map(column => [cleanName(column), column]));
  return aliases.map(cleanName).map(alias => byClean.get(alias)).find(Boolean);
}
function num(value: CellValue) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Number(value.replace("%", "").trim());
}
function text(value: CellValue, fallback = "") { return value == null ? fallback : String(value).trim(); }
function clamp(value: number, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function round(value: number, digits = 4) { const power = 10 ** digits; return Math.round(value * power) / power; }

export function detectDataset(rows: DataRow[], columns: string[]): Detection {
  const wide = columns.filter(column => /^color_data\..+\.(h|s|l|hex)$/i.test(column));
  const gew = columns.filter(column => {
    const match = column.match(/^word_data\.(.+)$/i);
    return match ? GEW_COLOURS.includes(match[1] as typeof GEW_COLOURS[number]) : false;
  });
  const formats = new Set<ColorFormat>();
  const evidence: string[] = [];
  const warnings: string[] = [];

  const sampleValues = (column?: string) => column ? rows.slice(0, 80).map(row => row[column]).filter(value => value != null && text(value) !== "") : [];
  const hexColumn = findColumn(columns, ALIASES.hex) || columns.find(column => /\.hex$/i.test(column));
  if (hexColumn && sampleValues(hexColumn).some(value => /^#?[0-9a-f]{6}$/i.test(text(value)))) {
    formats.add("HEX"); evidence.push(`在“${hexColumn}”中识别到 6 位 HEX 色值`);
  }
  if (findColumn(columns, ALIASES.r) && findColumn(columns, ALIASES.g) && findColumn(columns, ALIASES.b)) {
    formats.add("RGB"); evidence.push("识别到 R / G / B 三通道列");
  }
  if (findColumn(columns, ALIASES.h) && findColumn(columns, ALIASES.s) && findColumn(columns, ALIASES.l)) {
    formats.add("HSL"); evidence.push("识别到 H / S / L 三通道列");
  }
  if ((findColumn(columns, ALIASES.hh) || findColumn(columns, ALIASES.h)) && (findColumn(columns, ALIASES.ss) || findColumn(columns, ALIASES.s)) && findColumn(columns, ALIASES.v)) {
    formats.add("HSV"); evidence.push("识别到 H / S / V 三通道列");
  }
  if (findColumn(columns, ALIASES.labL) && findColumn(columns, ALIASES.labA) && findColumn(columns, ALIASES.labB)) {
    formats.add("Lab"); evidence.push("识别到 CIE L* / a* / b* 三通道列");
  }
  if (wide.some(column => /\.hex$/i.test(column))) formats.add("HEX");
  if (wide.some(column => /\.h$/i.test(column)) && wide.some(column => /\.s$/i.test(column)) && wide.some(column => /\.l$/i.test(column))) formats.add("HSL");

  let schema: SchemaKind = "unknown";
  let confidence = 0.28;
  if (gew.length && wide.length >= 3) {
    schema = "mixed"; confidence = .99;
    evidence.unshift(`同时识别到 ${wide.length} 个任务一色彩列与 ${gew.length} 个任务二情绪轮列`);
  } else if (gew.length) {
    schema = "task2-gew"; confidence = Math.min(.99, .78 + gew.length / 100);
    evidence.unshift(`识别到 ${gew.length} 个 word_data.<颜色> 列，符合日内瓦情绪轮数据`);
  } else if (wide.length >= 3) {
    schema = "task1-wide"; confidence = Math.min(.98, .72 + wide.length / 100);
    evidence.unshift(`识别到 ${wide.length} 个 color_data.<情绪>.<通道> 宽表列`);
  } else if (findColumn(columns, ALIASES.emotion) && formats.size) {
    schema = "task1-long"; confidence = .86;
    evidence.unshift("识别到情绪列与色彩通道，符合词选色长表");
  } else {
    warnings.push("未找到明确的任务一或任务二字段组合；可调整工作表或列选择后重试。");
  }
  if (!rows.length) warnings.push("当前行范围没有数据。");
  if ((schema === "task1-wide" || schema === "task1-long") && formats.size === 0) warnings.push("结构像任务一，但没有找到可解析的 HEX、RGB、HSL、HSV 或 Lab 色彩字段。");

  const schemaLabel = schema === "mixed" ? "实验一 + 实验二 · 混合数据" : schema === "task1-wide" ? "实验一 · 词选色宽表" : schema === "task1-long" ? "实验一 · 词选色长表" : schema === "task2-gew" ? "实验二 · 日内瓦情绪轮" : "待确认的数据结构";
  return { schema, schemaLabel, confidence, formats: [...formats], evidence, warnings };
}

export function hexToRgb(input: string) {
  const value = input.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}
export function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s); l = clamp(l);
  if (s === 0) { const gray = Math.round(l * 255); return { r: gray, g: gray, b: gray }; }
  const q = l < .5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
  const channel = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return { r: Math.round(channel(h + 1 / 3) * 255), g: Math.round(channel(h) * 255), b: Math.round(channel(h - 1 / 3) * 255) };
}
function hsvToRgb(h: number, s: number, v: number) {
  h = ((h % 360) + 360) % 360; s = clamp(s); v = clamp(v);
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [rp, gp, bp] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((rp + m) * 255), g: Math.round((gp + m) * 255), b: Math.round((bp + m) * 255) };
}
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b); const d = max - min; const l = (max + min) / 2;
  let h = 0; if (d) { if (max === r) h = 60 * (((g - b) / d) % 6); else if (max === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)); return { h: (h + 360) % 360, s, l };
}
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0; if (d) { if (max === r) h = 60 * (((g - b) / d) % 6); else if (max === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}
function rgbToLab(r: number, g: number, b: number) {
  const linear = (value: number) => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; };
  const rr = linear(r), gg = linear(g), bb = linear(b);
  const x = (rr * .4124564 + gg * .3575761 + bb * .1804375) / .95047;
  const y = (rr * .2126729 + gg * .7151522 + bb * .0721750);
  const z = (rr * .0193339 + gg * .1191920 + bb * .9503041) / 1.08883;
  const f = (value: number) => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}
function labToRgb(l: number, a: number, b: number) {
  const fy = (l + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
  const inv = (value: number) => value ** 3 > .008856 ? value ** 3 : (value - 16 / 116) / 7.787;
  const x = .95047 * inv(fx), y = inv(fy), z = 1.08883 * inv(fz);
  const r = x * 3.2404542 + y * -.969266 + z * .0556434;
  const g = x * -.969266 + y * 1.8760108 + z * -.2040259;
  const bl = x * .0556434 + y * -.2040259 + z * 1.0572252;
  const gamma = (value: number) => 255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055);
  return { r: Math.round(clamp(gamma(r), 0, 255)), g: Math.round(clamp(gamma(g), 0, 255)), b: Math.round(clamp(gamma(bl), 0, 255)) };
}

function canonical(row: number, source: string, emotion: string, rgb: { r: number; g: number; b: number }): CanonicalColorRow {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b), hsv = rgbToHsv(rgb.r, rgb.g, rgb.b), lab = rgbToLab(rgb.r, rgb.g, rgb.b);
  return { row, source, emotion, hex: rgbToHex(rgb.r, rgb.g, rgb.b), r: rgb.r, g: rgb.g, b: rgb.b, h: hsl.h, s: hsl.s, l: hsl.l, hsvH: hsv.h, hsvS: hsv.s, hsvV: hsv.v, labL: lab.l, labA: lab.a, labB: lab.b };
}

function scaled(value: number) { return Math.abs(value) > 1 ? value / 100 : value; }

export function parseColorRows(rows: DataRow[], columns: string[], schema: SchemaKind): { rows: CanonicalColorRow[]; rejected: number } {
  const result: CanonicalColorRow[] = []; let rejected = 0;
  const sourceColumn = findColumn(columns, ALIASES.source);
  if (schema === "task1-wide" || schema === "mixed") {
    const emotions = [...new Set(columns.map(column => column.match(/^color_data\.(.+)\.(h|s|l|hex)$/i)?.[1]).filter((value): value is string => Boolean(value)))];
    rows.forEach((raw, index) => emotions.forEach(emotion => {
      const key = (channel: string) => columns.find(column => cleanName(column) === cleanName(`color_data.${emotion}.${channel}`));
      const hex = key("hex") ? hexToRgb(text(raw[key("hex")!])) : null;
      const h = num(raw[key("h") || ""]), s = num(raw[key("s") || ""]), l = num(raw[key("l") || ""]);
      const rgb = hex || ([h, s, l].every(Number.isFinite) ? hslToRgb(Math.abs(h) <= 1 ? h * 360 : h, scaled(s), scaled(l)) : null);
      if (rgb) result.push(canonical(index + 1, text(sourceColumn ? raw[sourceColumn] : null, "未分组"), emotion, rgb)); else rejected += 1;
    }));
    return { rows: result, rejected };
  }

  const emotionColumn = findColumn(columns, ALIASES.emotion);
  const hexColumn = findColumn(columns, ALIASES.hex);
  const rCol = findColumn(columns, ALIASES.r), gCol = findColumn(columns, ALIASES.g), bCol = findColumn(columns, ALIASES.b);
  const hCol = findColumn(columns, ALIASES.h), sCol = findColumn(columns, ALIASES.s), lCol = findColumn(columns, ALIASES.l);
  const hhCol = findColumn(columns, ALIASES.hh) || hCol, ssCol = findColumn(columns, ALIASES.ss) || sCol, vCol = findColumn(columns, ALIASES.v);
  const labLCol = findColumn(columns, ALIASES.labL), labACol = findColumn(columns, ALIASES.labA), labBCol = findColumn(columns, ALIASES.labB);
  rows.forEach((raw, index) => {
    let rgb = hexColumn ? hexToRgb(text(raw[hexColumn])) : null;
    const rgbValues = [num(raw[rCol || ""]), num(raw[gCol || ""]), num(raw[bCol || ""])];
    if (!rgb && rgbValues.every(Number.isFinite)) rgb = { r: rgbValues[0], g: rgbValues[1], b: rgbValues[2] };
    const hslValues = [num(raw[hCol || ""]), num(raw[sCol || ""]), num(raw[lCol || ""])];
    if (!rgb && hslValues.every(Number.isFinite)) rgb = hslToRgb(Math.abs(hslValues[0]) <= 1 ? hslValues[0] * 360 : hslValues[0], scaled(hslValues[1]), scaled(hslValues[2]));
    const hsvValues = [num(raw[hhCol || ""]), num(raw[ssCol || ""]), num(raw[vCol || ""])];
    if (!rgb && hsvValues.every(Number.isFinite)) rgb = hsvToRgb(Math.abs(hsvValues[0]) <= 1 ? hsvValues[0] * 360 : hsvValues[0], scaled(hsvValues[1]), scaled(hsvValues[2]));
    const labValues = [num(raw[labLCol || ""]), num(raw[labACol || ""]), num(raw[labBCol || ""])];
    if (!rgb && labValues.every(Number.isFinite)) rgb = labToRgb(labValues[0], labValues[1], labValues[2]);
    if (rgb) result.push(canonical(index + 1, text(sourceColumn ? raw[sourceColumn] : null, "未分组"), text(emotionColumn ? raw[emotionColumn] : null, "未标注"), rgb)); else rejected += 1;
  });
  return { rows: result, rejected };
}

export function colorRowsToExport(rows: CanonicalColorRow[]): ExportRow[] {
  return rows.map(row => ({ 行号: row.row, 来源: row.source, 情绪: row.emotion, HEX: row.hex, R: row.r, G: row.g, B: row.b, H_HSL: round(row.h, 2), S_HSL: round(row.s, 4), L_HSL: round(row.l, 4), H_HSV: round(row.hsvH, 2), S_HSV: round(row.hsvS, 4), V_HSV: round(row.hsvV, 4), L_Lab: round(row.labL, 3), a_Lab: round(row.labA, 3), b_Lab: round(row.labB, 3) }));
}

function distance(a: CanonicalColorRow | number[], b: CanonicalColorRow | number[]) {
  const aa = Array.isArray(a) ? a : [a.labL, a.labA, a.labB]; const bb = Array.isArray(b) ? b : [b.labL, b.labA, b.labB];
  return Math.sqrt(aa.reduce((sum, value, index) => sum + (value - bb[index]) ** 2, 0));
}
function meanVector(points: number[][]) { return [0, 1, 2].map(index => points.reduce((sum, point) => sum + point[index], 0) / points.length); }
function kmeans(points: number[][], k: number) {
  let centers = Array.from({ length: k }, (_, index) => points[Math.floor(index * points.length / k)].slice()); let labels = new Array(points.length).fill(0);
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const next = points.map(point => centers.reduce((best, center, index) => distance(point, center) < distance(point, centers[best]) ? index : best, 0));
    const changed = next.some((value, index) => value !== labels[index]); labels = next;
    centers = centers.map((center, index) => { const cluster = points.filter((_, pointIndex) => labels[pointIndex] === index); return cluster.length ? meanVector(cluster) : center; });
    if (!changed && iteration > 0) break;
  }
  return { labels, centers };
}
function silhouette(points: number[][], labels: number[], k: number) {
  if (points.length <= k) return -1;
  const values = points.map((point, index) => {
    const same = points.filter((_, j) => labels[j] === labels[index] && j !== index); const a = same.length ? same.reduce((sum, item) => sum + distance(point, item), 0) / same.length : 0;
    const other = Array.from({ length: k }, (_, label) => label).filter(label => label !== labels[index]).map(label => { const group = points.filter((_, j) => labels[j] === label); return group.length ? group.reduce((sum, item) => sum + distance(point, item), 0) / group.length : Infinity; });
    const b = Math.min(...other); return Number.isFinite(b) && Math.max(a, b) ? (b - a) / Math.max(a, b) : 0;
  });
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function runColorClustering(colors: CanonicalColorRow[]): AnalysisResult {
  const rows: ExportRow[] = [];
  const keys = [...new Set(colors.map(row => `${row.source}\u0000${row.emotion}`))];
  keys.forEach(key => {
    const [source, emotion] = key.split("\u0000"); const group = colors.filter(row => row.source === source && row.emotion === emotion); const points = group.map(row => [row.labL, row.labA, row.labB]);
    if (points.length < 3) { rows.push({ 来源: source, 情绪: emotion, 样本数: points.length, 最佳K: 1, 轮廓系数: 0, 簇: 1, 簇权重: 1, 中心HEX: group[0]?.hex || "" }); return; }
    let bestK = 2, bestScore = -Infinity, best = kmeans(points, 2); const maxK = Math.min(6, points.length - 1);
    for (let k = 2; k <= maxK; k += 1) { const candidate = kmeans(points, k); const score = silhouette(points, candidate.labels, k); if (score > bestScore) { bestK = k; bestScore = score; best = candidate; } }
    best.centers.forEach((center, cluster) => { const count = best.labels.filter(label => label === cluster).length; const rgb = labToRgb(center[0], center[1], center[2]); rows.push({ 来源: source, 情绪: emotion, 样本数: points.length, 最佳K: bestK, 轮廓系数: round(bestScore), 簇: cluster + 1, 簇权重: round(count / points.length), 中心HEX: rgbToHex(rgb.r, rgb.g, rgb.b), 中心L: round(center[0]), 中心a: round(center[1]), 中心b: round(center[2]) }); });
  });
  return { id: "task1-cluster", title: "最佳 K 与 Lab 色彩聚类", kind: "colors", rows, summary: [{ label: "来源×情绪组合", value: String(keys.length) }, { label: "聚类中心", value: String(rows.length) }, { label: "K 搜索范围", value: "2–6" }], note: "在 CIE Lab 空间执行确定性 K-means，并用平均轮廓系数选择最佳 K。" };
}

function symmetricMinDistance(a: CanonicalColorRow[], b: CanonicalColorRow[]) {
  if (!a.length || !b.length) return NaN;
  const ab = a.reduce((sum, item) => sum + Math.min(...b.map(other => distance(item, other))), 0) / a.length;
  const ba = b.reduce((sum, item) => sum + Math.min(...a.map(other => distance(item, other))), 0) / b.length;
  return (ab + ba) / 2;
}

export function runDeltaE(colors: CanonicalColorRow[]): AnalysisResult {
  const sources = [...new Set(colors.map(row => row.source))]; const emotions = [...new Set(colors.map(row => row.emotion))]; const rows: ExportRow[] = [];
  emotions.forEach(emotion => sources.forEach((sourceA, ai) => sources.slice(ai + 1).forEach(sourceB => {
    const a = colors.filter(row => row.emotion === emotion && row.source === sourceA); const b = colors.filter(row => row.emotion === emotion && row.source === sourceB); const delta = symmetricMinDistance(a, b);
    if (Number.isFinite(delta)) rows.push({ 情绪: emotion, 来源A: sourceA, 来源B: sourceB, A样本数: a.length, B样本数: b.length, 对称最小ΔE76: round(delta, 3), 差异等级: delta < 2.3 ? "几乎不可察觉" : delta < 10 ? "可察觉" : delta < 25 ? "明显" : "非常明显" });
  })));
  return { id: "task1-delta", title: "跨来源色差与偏差", kind: "matrix", rows, summary: [{ label: "来源", value: String(sources.length) }, { label: "情绪", value: String(emotions.length) }, { label: "有效比较", value: String(rows.length) }], note: "沿用历史脚本的双向最近邻思想，计算每个情绪下来源之间的对称最小 CIE76 色差。" };
}

export function runColorSummary(colors: CanonicalColorRow[], rejected: number): AnalysisResult {
  const keys = [...new Set(colors.map(row => `${row.source}\u0000${row.emotion}`))]; const rows = keys.map(key => { const [source, emotion] = key.split("\u0000"); const group = colors.filter(row => row.source === source && row.emotion === emotion); const lab = meanVector(group.map(row => [row.labL, row.labA, row.labB])); const rgb = labToRgb(lab[0], lab[1], lab[2]); return { 来源: source, 情绪: emotion, N: group.length, 平均HEX: rgbToHex(rgb.r, rgb.g, rgb.b), 平均H: round(group.reduce((sum, row) => sum + row.h, 0) / group.length, 2), 平均S: round(group.reduce((sum, row) => sum + row.s, 0) / group.length), 平均L: round(group.reduce((sum, row) => sum + row.l, 0) / group.length), 平均Lab_L: round(lab[0]), 平均Lab_a: round(lab[1]), 平均Lab_b: round(lab[2]) }; });
  return { id: "task1-summary", title: "来源 × 情绪色彩描述", kind: "colors", rows, summary: [{ label: "有效色彩", value: String(colors.length) }, { label: "组合", value: String(rows.length) }, { label: "拒绝值", value: String(rejected) }] };
}

function normalizeEmotion(value: string) { const exact = GEW_EMOTIONS.find(emotion => emotion.toLowerCase() === value.trim().toLowerCase()); return exact || value.trim(); }
function associations(value: CellValue): Array<{ emotion: string; intensity: number }> | null {
  if (value == null || text(value) === "") return [];
  let parsed: unknown = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { return null; } }
  const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "associations" in parsed ? (parsed as { associations: unknown }).associations : parsed;
  if (Array.isArray(candidate)) return candidate.map(item => { const obj = item as Record<string, unknown>; return { emotion: normalizeEmotion(String(obj.emotion ?? obj.word ?? obj.name ?? "")), intensity: Number(obj.intensity ?? obj.score ?? obj.value ?? 0) }; }).filter(item => item.emotion);
  if (candidate && typeof candidate === "object") return Object.entries(candidate as Record<string, unknown>).map(([emotion, intensity]) => ({ emotion: normalizeEmotion(emotion), intensity: Number(intensity) }));
  return null;
}

export function parseGewRows(rows: DataRow[], columns: string[]): { rows: GewRow[]; sourceRows: number; invalidCells: number } {
  const gewColumns = columns.filter(column => {
    const match = column.match(/^word_data\.(.+)$/i);
    return match ? GEW_COLOURS.includes(match[1] as typeof GEW_COLOURS[number]) : false;
  }); const sourceColumn = findColumn(columns, ALIASES.source); const participantColumn = findColumn(columns, ALIASES.participant); const runColumn = findColumn(columns, ALIASES.run);
  const result: GewRow[] = []; let invalidCells = 0;
  rows.forEach((raw, rowIndex) => gewColumns.forEach(column => {
    const color = column.replace(/^word_data\./i, ""); const parsed = associations(raw[column]); const valid = parsed !== null;
    if (!valid) invalidCells += 1;
    const map = new Map((parsed || []).filter(item => GEW_EMOTIONS.includes(item.emotion as typeof GEW_EMOTIONS[number]) && Number.isFinite(item.intensity)).map(item => [item.emotion, clamp(item.intensity, 0, 5)]));
    GEW_EMOTIONS.forEach(emotion => { const intensity = map.get(emotion) || 0; result.push({ participant: text(participantColumn ? raw[participantColumn] : null, String(rowIndex + 1)), source: text(sourceColumn ? raw[sourceColumn] : null, "未分组"), run: text(runColumn ? raw[runColumn] : null, String(rowIndex + 1)), color, emotion, selected: intensity > 0 ? 1 : 0, intensity, valid }); });
  }));
  return { rows: result, sourceRows: rows.length, invalidCells };
}

export function gewRowsToExport(rows: GewRow[]): ExportRow[] { return rows.map(row => ({ 样本ID: row.participant, 来源: row.source, 轮次: row.run, 颜色: row.color, 情绪: row.emotion, 是否选择: row.selected, 强度: row.intensity, 原始单元格有效: row.valid })); }

export function runGewQc(parsed: ReturnType<typeof parseGewRows>): AnalysisResult {
  const combinations = new Set(parsed.rows.map(row => `${row.source}\u0000${row.color}`)).size;
  return { id: "task2-qc", title: "GEW 解析与质量控制", kind: "table", rows: gewRowsToExport(parsed.rows), summary: [{ label: "源数据行", value: String(parsed.sourceRows) }, { label: "完整网格行", value: String(parsed.rows.length) }, { label: "无效 JSON 单元格", value: String(parsed.invalidCells) }, { label: "来源×颜色", value: String(combinations) }], note: "每个颜色补齐 20 个情绪；未选择项记为 selected=0、intensity=0。" };
}

export function runGewDescriptive(rows: GewRow[]): AnalysisResult {
  const groups = summarizeGew(rows);
  const output = [...groups.entries()].map(([key, group]) => { const [source, color, emotion] = key.split("\u0000"); return { 来源: source, 颜色: color, 情绪: emotion, N: group.n, 选择次数: group.yes, 选择率: round(group.yes / Math.max(1, group.n)), 平均强度_全部: round(group.intensity / Math.max(1, group.n)), 平均强度_已选择: round(group.selectedIntensity / Math.max(1, group.yes)), 价性: VALENCE[emotion] > 0 ? "积极" : "消极" }; });
  return { id: "task2-descriptive", title: "选择率、强度与价性", kind: "statistics", rows: output, summary: [{ label: "来源", value: String(new Set(rows.map(row => row.source)).size) }, { label: "颜色", value: String(new Set(rows.map(row => row.color)).size) }, { label: "统计单元", value: String(output.length) }] };
}

function erf(x: number) { const sign = x < 0 ? -1 : 1; x = Math.abs(x); const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911; const t=1/(1+p*x); return sign*(1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x)); }
function chiSquare2x2(a: number, b: number, c: number, d: number) { const n=a+b+c+d; const denominator=(a+b)*(c+d)*(a+c)*(b+d); return denominator ? n*(a*d-b*c)**2/denominator : 0; }
function bh(values: number[]) { const indexed=values.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value); const adjusted=new Array(values.length).fill(1); let previous=1; for(let i=indexed.length-1;i>=0;i-=1){ previous=Math.min(previous,indexed[i].value*indexed.length/(i+1)); adjusted[indexed[i].index]=previous; } return adjusted; }
function summarizeGew(rows: GewRow[]) {
  const groups = new Map<string, { n: number; yes: number; intensity: number; selectedIntensity: number }>();
  rows.forEach(row => { const key = `${row.source}\u0000${row.color}\u0000${row.emotion}`; const current = groups.get(key) || { n: 0, yes: 0, intensity: 0, selectedIntensity: 0 }; current.n += 1; current.yes += row.selected; current.intensity += row.intensity; if (row.selected) current.selectedIntensity += row.intensity; groups.set(key, current); });
  return groups;
}

export function runGewOmnibus(rows: GewRow[]): AnalysisResult {
  const sources=[...new Set(rows.map(row=>row.source))], counts=summarizeGew(rows); const keys=[...new Set(rows.map(row=>`${row.color}\u0000${row.emotion}`))];
  const raw=keys.map(key=>{ const [color,emotion]=key.split("\u0000"); const groups=sources.map(source=>{ const group=counts.get(`${source}\u0000${color}\u0000${emotion}`) || {n:0,yes:0}; return {source,yes:group.yes,no:group.n-group.yes}; }); const totalYes=groups.reduce((s,g)=>s+g.yes,0), total=groups.reduce((s,g)=>s+g.yes+g.no,0); let chi=0; groups.forEach(group=>{ const n=group.yes+group.no, ey=n*totalYes/Math.max(1,total), en=n*(total-totalYes)/Math.max(1,total); if(ey)chi+=(group.yes-ey)**2/ey;if(en)chi+=(group.no-en)**2/en; }); const df=Math.max(1,sources.length-1); const p=df===2?Math.exp(-chi/2):1-erf(Math.sqrt(chi/2)); return {color,emotion,chi,p,df}; });
  const adjusted=bh(raw.map(row=>row.p)); const output=raw.map((row,index)=>({颜色:row.color,情绪:row.emotion,来源数:sources.length,卡方:round(row.chi,4),自由度:row.df,p值:round(row.p,6),FDR_q值:round(adjusted[index],6),显著:adjusted[index]<.05}));
  return { id:"task2-omnibus", title:"来源间总体差异检验", kind:"statistics", rows:output, summary:[{label:"检验数",value:String(output.length)},{label:"FDR<.05",value:String(output.filter(row=>row.显著).length)},{label:"来源",value:String(sources.length)}], note:"对选择率执行 Pearson 卡方检验，并用 Benjamini–Hochberg 方法控制多重比较。" };
}

export function runGewPairwise(rows: GewRow[]): AnalysisResult {
  const sources=[...new Set(rows.map(row=>row.source))], keys=[...new Set(rows.map(row=>`${row.color}\u0000${row.emotion}`))], counts=summarizeGew(rows); const raw:Array<{color:string;emotion:string;a:string;b:string;rateA:number;rateB:number;chi:number;p:number}>=[];
  keys.forEach(key=>{const[color,emotion]=key.split("\u0000");sources.forEach((a,ai)=>sources.slice(ai+1).forEach(b=>{const ga=counts.get(`${a}\u0000${color}\u0000${emotion}`)||{n:0,yes:0},gb=counts.get(`${b}\u0000${color}\u0000${emotion}`)||{n:0,yes:0};const chi=chiSquare2x2(ga.yes,ga.n-ga.yes,gb.yes,gb.n-gb.yes),p=1-erf(Math.sqrt(chi/2));raw.push({color,emotion,a,b,rateA:ga.yes/Math.max(1,ga.n),rateB:gb.yes/Math.max(1,gb.n),chi,p});}));});
  const adjusted=bh(raw.map(row=>row.p)); const output=raw.map((row,index)=>({颜色:row.color,情绪:row.emotion,来源A:row.a,来源B:row.b,A选择率:round(row.rateA),B选择率:round(row.rateB),选择率差:round(row.rateA-row.rateB),卡方:round(row.chi,4),p值:round(row.p,6),FDR_q值:round(adjusted[index],6),显著:adjusted[index]<.05}));
  return {id:"task2-pairwise",title:"来源两两差异",kind:"statistics",rows:output,summary:[{label:"两两检验",value:String(output.length)},{label:"FDR<.05",value:String(output.filter(row=>row.显著).length)},{label:"来源对",value:String(sources.length*(sources.length-1)/2)}],note:"每个颜色×情绪执行来源两两 2×2 卡方检验，并统一进行 FDR 校正。"};
}

function jsd(p:number[],q:number[]){const sumP=p.reduce((s,v)=>s+v,0)||1,sumQ=q.reduce((s,v)=>s+v,0)||1;const pp=p.map(v=>v/sumP),qq=q.map(v=>v/sumQ),m=pp.map((v,i)=>(v+qq[i])/2);const kl=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(v? v*Math.log2(v/b[i]):0),0);return (kl(pp,m)+kl(qq,m))/2;}
export function runGewJsd(rows:GewRow[]):AnalysisResult{const sources=[...new Set(rows.map(row=>row.source))],colors=[...new Set(rows.map(row=>row.color))],counts=summarizeGew(rows),output:ExportRow[]=[];colors.forEach(color=>sources.forEach((a,ai)=>sources.slice(ai+1).forEach(b=>{const vector=(source:string)=>GEW_EMOTIONS.map(emotion=>{const group=counts.get(`${source}\u0000${color}\u0000${emotion}`)||{n:0,yes:0};return group.yes/Math.max(1,group.n);});output.push({颜色:color,来源A:a,来源B:b,Jensen_Shannon距离:round(Math.sqrt(jsd(vector(a),vector(b))),6)});})));return{id:"task2-jsd",title:"情绪分布距离",kind:"matrix",rows:output,summary:[{label:"来源对×颜色",value:String(output.length)},{label:"颜色",value:String(colors.length)},{label:"距离范围",value:"0–1"}],note:"基于 20 个情绪的选择率向量计算 Jensen–Shannon 距离；越大表示分布差异越明显。"};}

export function toCsv(rows: ExportRow[]) {
  if (!rows.length) return ""; const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))]; const escape=(value:unknown)=>{const string=value==null?"":String(value);return /[",\n]/.test(string)?`"${string.replaceAll('"','""')}"`:string;}; return `\uFEFF${columns.map(escape).join(",")}\n${rows.map(row=>columns.map(column=>escape(row[column])).join(",")).join("\n")}`;
}
