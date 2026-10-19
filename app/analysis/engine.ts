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
  cohort: "human" | "ai" | "unspecified";
  participant: string;
  run: string;
  sourceRow: number;
  identityProvided: boolean;
  identitySource: "original" | "generated-wide-row" | "missing";
  emotion: string;
  inputFormat: ColorFormat;
  conversionPath: string;
  consistencyDeltaE: number | null;
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
  cohort: "human" | "ai" | "unspecified";
  run: string;
  color: string;
  emotion: string;
  selected: number;
  intensity: number;
  valid: boolean;
  identityProvided: boolean;
  sourceRow: number;
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
export const GEW_COLOR_HEX: Record<typeof GEW_COLOURS[number], string> = {
  D38: "#F38EBB", F17: "#00904A", F4: "#DD4200", J0: "#262626", F0: "#808080",
  F29: "#007FD3", A0: "#F2F2F2", H35: "#6F2A78", I6: "#4B2819", G3: "#BB1F23", C9: "#FFBC00",
};

export const VALENCE: Record<string, number> = Object.fromEntries(GEW_EMOTIONS.map((emotion, index) => [emotion, index < 10 ? 1 : -1]));
const TASK1_EMOTION_ALIASES: Record<string, string> = {
  "感兴趣": "Interest", "欢愉": "Amusement", "自豪": "Pride", "欢乐": "Joy", "愉快": "Pleasure",
  "满足": "Contentment", "赞赏": "Admiration", "爱": "Love", "如释重负": "Relief", "同情": "Compassion",
  "悲伤": "Sadness", "内疚": "Guilt", "后悔": "Regret", "羞愧": "Shame", "失望": "Disappointment",
  "恐惧": "Fear", "厌恶": "Disgust", "轻视": "Contempt", "憎恨": "Hate", "忿怒": "Anger",
};
function normalizeTask1Emotion(value: string) {
  return TASK1_EMOTION_ALIASES[value.trim()] || GEW_EMOTIONS.find(emotion => emotion.toLowerCase() === value.trim().toLowerCase()) || value.trim();
}

const ALIASES = {
  source: ["_analysis_group", "source", "group", "model", "model_alias", "platform", "_source_file", "平台", "模型", "来源", "组别"],
  emotion: ["emotion", "word", "emotion_word", "情绪", "情绪词"],
  hex: ["hex", "color", "colour", "hex_color", "hex colour", "色值", "颜色"],
  r: ["r", "red", "rgb_r"], g: ["g", "green", "rgb_g"], b: ["b", "blue", "rgb_b"],
  h: ["h_hsl", "hsl_h", "hue_hsl", "h", "hue"], s: ["s_hsl", "hsl_s", "saturation_hsl", "s", "saturation"], l: ["l_hsl", "hsl_l", "lightness_hsl", "lightness", "l"],
  hh: ["h_hsv", "hsv_h", "hue_hsv"], ss: ["s_hsv", "hsv_s", "saturation_hsv"], v: ["v", "value", "hsv_v"],
  labL: ["l*", "lab_l", "l_lab", "cie_l"], labA: ["a*", "lab_a", "a_lab", "cie_a"], labB: ["b*", "lab_b", "b_lab", "cie_b"],
  participant: ["_analysis_participant_id", "participant", "participant_id", "sample_id", "id", "trial_id", "objectid", "object_id", "实验id", "样本id"],
  run: ["_analysis_run_id", "run", "run_id", "run_index", "repetition", "轮次", "重复轮次"],
  cohort: ["_analysis_cohort", "cohort", "participant_type", "source_type", "样本类型", "组类型"],
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
function finiteColumnValues(rows: DataRow[], column?: string) {
  return column ? rows.map(row => num(row[column])).filter(Number.isFinite) : [];
}
function usesUnitInterval(rows: DataRow[], columns: Array<string | undefined>) {
  const values = columns.flatMap(column => finiteColumnValues(rows, column));
  return values.length > 0 && values.every(value => Math.abs(value) <= 1);
}
function normalizeHue(value: number, unitInterval: boolean) { return unitInterval ? value * 360 : value; }
function normalizeProportion(value: number, unitInterval: boolean) { return unitInterval ? value : value / 100; }
function normalizeCohort(value: CellValue): CanonicalColorRow["cohort"] {
  const normalized = text(value).toLowerCase();
  if (["human", "人类", "participant", "participants"].includes(normalized)) return "human";
  if (["ai", "model", "模型", "人工智能"].includes(normalized)) return "ai";
  return "unspecified";
}

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
  const labAColumn = findColumn(columns, ALIASES.labA), labBColumn = findColumn(columns, ALIASES.labB);
  const labLColumn = findColumn(columns, ALIASES.labL) || (labAColumn && labBColumn ? columns.find(column => cleanName(column) === "l") : undefined);
  if (labLColumn && labAColumn && labBColumn) {
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
  if (s === 0) { const gray = l * 255; return { r: gray, g: gray, b: gray }; }
  const q = l < .5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
  const channel = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
}
function hsvToRgb(h: number, s: number, v: number) {
  h = ((h % 360) + 360) % 360; s = clamp(s); v = clamp(v);
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [rp, gp, bp] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
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
  const r = x * 3.2404542 + y * -1.5371385 + z * -.4985314;
  const g = x * -.969266 + y * 1.8760108 + z * .0415560;
  const bl = x * .0556434 + y * -.2040259 + z * 1.0572252;
  const gamma = (value: number) => 255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055);
  return { r: clamp(gamma(r), 0, 255), g: clamp(gamma(g), 0, 255), b: clamp(gamma(bl), 0, 255) };
}

function canonical(
  row: number,
  source: string,
  cohort: CanonicalColorRow["cohort"],
  emotion: string,
  rgb: { r: number; g: number; b: number },
  inputFormat: ColorFormat,
  conversionPath: string,
  consistencyDeltaE: number | null = null,
  authoritativeLab?: { l: number; a: number; b: number },
  unit?: { participant?: string; run?: string; identitySource?: CanonicalColorRow["identitySource"] },
): CanonicalColorRow {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b), hsv = rgbToHsv(rgb.r, rgb.g, rgb.b), lab = authoritativeLab || rgbToLab(rgb.r, rgb.g, rgb.b);
  const identitySource = unit?.identitySource || (unit?.participant || unit?.run ? "original" : "missing");
  return { row, source, cohort, participant: unit?.participant || "", run: unit?.run || "", sourceRow: row, identityProvided: Boolean(unit?.participant || unit?.run), identitySource, emotion, inputFormat, conversionPath, consistencyDeltaE, hex: rgbToHex(rgb.r, rgb.g, rgb.b), r: Math.round(rgb.r), g: Math.round(rgb.g), b: Math.round(rgb.b), h: hsl.h, s: hsl.s, l: hsl.l, hsvH: hsv.h, hsvS: hsv.s, hsvV: hsv.v, labL: lab.l, labA: lab.a, labB: lab.b };
}

function rgbDeltaE(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const aa = rgbToLab(a.r, a.g, a.b), bb = rgbToLab(b.r, b.g, b.b);
  return Math.sqrt((aa.l - bb.l) ** 2 + (aa.a - bb.a) ** 2 + (aa.b - bb.b) ** 2);
}

export function deltaE2000(
  first: { l: number; a: number; b: number },
  second: { l: number; a: number; b: number },
) {
  const degrees = (radians: number) => radians * 180 / Math.PI;
  const radians = (value: number) => value * Math.PI / 180;
  const c1 = Math.hypot(first.a, first.b), c2 = Math.hypot(second.a, second.b), meanC = (c1 + c2) / 2;
  const g = .5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const a1p = (1 + g) * first.a, a2p = (1 + g) * second.a;
  const c1p = Math.hypot(a1p, first.b), c2p = Math.hypot(a2p, second.b);
  const hue = (a: number, b: number) => {
    const value = degrees(Math.atan2(b, a));
    return value < 0 ? value + 360 : value;
  };
  const h1p = c1p < 1e-12 ? 0 : hue(a1p, first.b), h2p = c2p < 1e-12 ? 0 : hue(a2p, second.b);
  const deltaL = second.l - first.l, deltaC = c2p - c1p;
  let deltaHAngle = h2p - h1p;
  if (c1p * c2p === 0) deltaHAngle = 0;
  else if (deltaHAngle > 180) deltaHAngle -= 360;
  else if (deltaHAngle < -180) deltaHAngle += 360;
  const deltaH = 2 * Math.sqrt(c1p * c2p) * Math.sin(radians(deltaHAngle / 2));
  const meanL = (first.l + second.l) / 2, meanCp = (c1p + c2p) / 2;
  let meanH = h1p + h2p;
  if (c1p * c2p === 0) meanH = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) meanH /= 2;
  else meanH = (meanH + (meanH < 360 ? 360 : -360)) / 2;
  const t = 1
    - .17 * Math.cos(radians(meanH - 30))
    + .24 * Math.cos(radians(2 * meanH))
    + .32 * Math.cos(radians(3 * meanH + 6))
    - .20 * Math.cos(radians(4 * meanH - 63));
  const sl = 1 + .015 * (meanL - 50) ** 2 / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + .045 * meanCp, sh = 1 + .015 * meanCp * t;
  const deltaTheta = 30 * Math.exp(-1 * ((meanH - 275) / 25) ** 2);
  const rc = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7));
  const rt = -rc * Math.sin(radians(2 * deltaTheta));
  const lTerm = deltaL / sl, cTerm = deltaC / sc, hTerm = deltaH / sh;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rt * cTerm * hTerm);
}

export function parseColorRows(rows: DataRow[], columns: string[], schema: SchemaKind): { rows: CanonicalColorRow[]; rejected: number } {
  const result: CanonicalColorRow[] = []; let rejected = 0;
  const sourceColumn = findColumn(columns, ALIASES.source);
  const cohortColumn = findColumn(columns, ALIASES.cohort);
  const participantColumn = findColumn(columns, ALIASES.participant);
  const runColumn = findColumn(columns, ALIASES.run);
  const identitySourceOf = (raw: DataRow): CanonicalColorRow["identitySource"] => {
    const value = text(raw._analysis_identity_origin);
    return value === "generated-wide-row" || value === "original" ? value : "missing";
  };
  const sourceRowOf = (raw: DataRow, fallback: number) => {
    const value = num(raw._analysis_source_row);
    return Number.isFinite(value) ? value : fallback;
  };
  if (schema === "task1-wide" || schema === "mixed") {
    const emotions = [...new Set(columns.map(column => column.match(/^color_data\.(.+)\.(h|s|l|hex)$/i)?.[1]).filter((value): value is string => Boolean(value)))];
    rows.forEach((raw, index) => emotions.forEach(emotion => {
      const key = (channel: string) => columns.find(column => cleanName(column) === cleanName(`color_data.${emotion}.${channel}`));
      const hex = key("hex") ? hexToRgb(text(raw[key("hex")!])) : null;
      const h = num(raw[key("h") || ""]), s = num(raw[key("s") || ""]), l = num(raw[key("l") || ""]);
      // Historical SurveyResponse/Bias_OriginalData.py contract is fixed:
      // H is degrees (0–360), S/L are percentages (0–100). Do not infer
      // units per cell: H=1° and S=1% are valid observations, not 1 turn/100%.
      const hslRgb = [h, s, l].every(Number.isFinite) ? hslToRgb(h, s / 100, l / 100) : null;
      const rgb = hslRgb || hex;
      if (rgb) {
        const inputFormat: ColorFormat = hslRgb ? "HSL" : "HEX";
        const mismatch = hslRgb && hex ? rgbDeltaE(hslRgb, hex) : null;
        result.push(canonical(
          sourceRowOf(raw, index + 1),
          text(sourceColumn ? raw[sourceColumn] : null, "未分组"),
          normalizeCohort(cohortColumn ? raw[cohortColumn] : null),
          normalizeTask1Emotion(emotion),
          rgb,
          inputFormat,
          hslRgb ? "HSL → sRGB (D65) → CIELAB / HSV" : "HEX → sRGB → HSL / HSV / CIELAB (D65)",
          mismatch,
          undefined,
          { participant: text(participantColumn ? raw[participantColumn] : null), run: text(runColumn ? raw[runColumn] : null), identitySource: identitySourceOf(raw) },
        ));
      } else rejected += 1;
    }));
    return { rows: result, rejected };
  }

  const emotionColumn = findColumn(columns, ALIASES.emotion);
  const hexColumn = findColumn(columns, ALIASES.hex);
  const rCol = findColumn(columns, ALIASES.r), gCol = findColumn(columns, ALIASES.g), bCol = findColumn(columns, ALIASES.b);
  const labACol = findColumn(columns, ALIASES.labA), labBCol = findColumn(columns, ALIASES.labB);
  // Historical normalized files use exactly "L", "a*", "b*" for CIELAB,
  // while HSL lightness is stored separately as "L_hsl".
  const labLCol = findColumn(columns, ALIASES.labL) || (labACol && labBCol ? columns.find(column => cleanName(column) === "l") : undefined);
  const hCol = findColumn(columns, ALIASES.h), sCol = findColumn(columns, ALIASES.s);
  const lCandidate = findColumn(columns, ALIASES.l);
  const lCol = lCandidate && lCandidate === labLCol ? undefined : lCandidate;
  const hhCol = findColumn(columns, ALIASES.hh) || hCol, ssCol = findColumn(columns, ALIASES.ss) || sCol, vCol = findColumn(columns, ALIASES.v);
  const rgbUnitInterval = usesUnitInterval(rows, [rCol, gCol, bCol]);
  const legacyHslContract = cleanName(hCol || "") === "h" && cleanName(sCol || "") === "s" && cleanName(lCol || "") === "l_hsl";
  const hslHueExplicitDegrees = ["h_hsl", "hue_hsl"].includes(cleanName(hCol || "")) || legacyHslContract;
  const hsvHueExplicitDegrees = ["h_hsv", "hue_hsv"].includes(cleanName(hhCol || ""));
  const hslHueUnitInterval = !hslHueExplicitDegrees && usesUnitInterval(rows, [hCol]);
  const hslUnitInterval = !legacyHslContract && usesUnitInterval(rows, [sCol, lCol]);
  const hsvHueUnitInterval = !hsvHueExplicitDegrees && usesUnitInterval(rows, [hhCol]);
  const hsvUnitInterval = usesUnitInterval(rows, [ssCol, vCol]);
  rows.forEach((raw, index) => {
    const hexRgb = hexColumn ? hexToRgb(text(raw[hexColumn])) : null;
    const rgbValues = [num(raw[rCol || ""]), num(raw[gCol || ""]), num(raw[bCol || ""])];
    const directRgb = rgbValues.every(Number.isFinite) ? {
      r: rgbValues[0] * (rgbUnitInterval ? 255 : 1),
      g: rgbValues[1] * (rgbUnitInterval ? 255 : 1),
      b: rgbValues[2] * (rgbUnitInterval ? 255 : 1),
    } : null;
    const hslValues = [num(raw[hCol || ""]), num(raw[sCol || ""]), num(raw[lCol || ""])];
    const hslRgb = hslValues.every(Number.isFinite) ? hslToRgb(normalizeHue(hslValues[0], hslHueUnitInterval), normalizeProportion(hslValues[1], hslUnitInterval), normalizeProportion(hslValues[2], hslUnitInterval)) : null;
    const hsvValues = [num(raw[hhCol || ""]), num(raw[ssCol || ""]), num(raw[vCol || ""])];
    const hsvRgb = hsvValues.every(Number.isFinite) ? hsvToRgb(normalizeHue(hsvValues[0], hsvHueUnitInterval), normalizeProportion(hsvValues[1], hsvUnitInterval), normalizeProportion(hsvValues[2], hsvUnitInterval)) : null;
    const labValues = [num(raw[labLCol || ""]), num(raw[labACol || ""]), num(raw[labBCol || ""])];
    const labRgb = labValues.every(Number.isFinite) ? labToRgb(labValues[0], labValues[1], labValues[2]) : null;
    const selected = hslRgb
      ? { rgb: hslRgb, format: "HSL" as const, path: "HSL → sRGB (D65) → CIELAB / HSV" }
      : directRgb
        ? { rgb: directRgb, format: "RGB" as const, path: "sRGB → HSL / HSV / CIELAB (D65)" }
        : hexRgb
          ? { rgb: hexRgb, format: "HEX" as const, path: "HEX → sRGB → HSL / HSV / CIELAB (D65)" }
          : hsvRgb
            ? { rgb: hsvRgb, format: "HSV" as const, path: "HSV → sRGB → HSL / CIELAB (D65)" }
            : labRgb
              ? { rgb: labRgb, format: "Lab" as const, path: "CIELAB (D65) → sRGB → HSL / HSV" }
              : null;
    if (selected) {
      const comparison = [directRgb, hexRgb, hsvRgb, labRgb].find(candidate => candidate && candidate !== selected.rgb);
      result.push(canonical(
        sourceRowOf(raw, index + 1),
        text(sourceColumn ? raw[sourceColumn] : null, "未分组"),
        normalizeCohort(cohortColumn ? raw[cohortColumn] : null),
        normalizeTask1Emotion(text(emotionColumn ? raw[emotionColumn] : null, "未标注")),
        selected.rgb,
        selected.format,
        selected.path,
        comparison ? rgbDeltaE(selected.rgb, comparison) : null,
        selected.format === "Lab" ? { l: labValues[0], a: labValues[1], b: labValues[2] } : undefined,
        { participant: text(participantColumn ? raw[participantColumn] : null), run: text(runColumn ? raw[runColumn] : null), identitySource: identitySourceOf(raw) },
      ));
    } else rejected += 1;
  });
  return { rows: result, rejected };
}

export function colorRowsToExport(rows: CanonicalColorRow[]): ExportRow[] {
  return rows.map(row => ({ 行号: row.row, 来源: row.source, 组类型: row.cohort, 分组CV身份ID: row.participant || row.run, participant_id: row.participant, run_id: row.run, 原始行配对号: row.sourceRow, 身份ID来源: row.identitySource, 可用于分组CV: row.identityProvided, 原始ID存在: row.identitySource === "original", 情绪: row.emotion, 原始权威格式: row.inputFormat, 转换路径: row.conversionPath, 多格式一致性ΔE76: row.consistencyDeltaE == null ? null : round(row.consistencyDeltaE, 4), HEX: row.hex, R: row.r, G: row.g, B: row.b, H_HSL: round(row.h, 2), S_HSL: round(row.s, 4), L_HSL: round(row.l, 4), H_HSV: round(row.hsvH, 2), S_HSV: round(row.hsvS, 4), V_HSV: round(row.hsvV, 4), L_Lab: round(row.labL, 3), a_Lab: round(row.labA, 3), b_Lab: round(row.labB, 3) }));
}

function distance(a: CanonicalColorRow | number[], b: CanonicalColorRow | number[]) {
  const aa = Array.isArray(a) ? a : [a.labL, a.labA, a.labB]; const bb = Array.isArray(b) ? b : [b.labL, b.labA, b.labB];
  return Math.sqrt(aa.reduce((sum, value, index) => sum + (value - bb[index]) ** 2, 0));
}
function meanVector(points: number[][]) { return [0, 1, 2].map(index => points.reduce((sum, point) => sum + point[index], 0) / points.length); }
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}
function kmeansOnce(points: number[][], k: number, seed: number) {
  const random = seededRandom(seed), centers: number[][] = [points[Math.floor(random() * points.length)].slice()];
  while (centers.length < k) {
    const weights = points.map(point => Math.min(...centers.map(center => distance(point, center) ** 2))), total = weights.reduce((sum, value) => sum + value, 0);
    if (!total) {
      const unused = points.find(point => !centers.some(center => distance(point, center) === 0));
      if (!unused) break;
      centers.push(unused.slice()); continue;
    }
    let threshold = random() * total, chosen = points.length - 1;
    for (let index = 0; index < points.length; index += 1) { threshold -= weights[index]; if (threshold <= 0) { chosen = index; break; } }
    centers.push(points[chosen].slice());
  }
  let labels = new Array(points.length).fill(0);
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const next = points.map(point => centers.reduce((best, center, index) => distance(point, center) < distance(point, centers[best]) ? index : best, 0));
    const changed = next.some((value, index) => value !== labels[index]); labels = next;
    centers.forEach((center, index) => { const cluster = points.filter((_, pointIndex) => labels[pointIndex] === index); centers[index] = cluster.length ? meanVector(cluster) : center; });
    if (!changed && iteration > 0) break;
  }
  const inertia = points.reduce((sum, point, index) => sum + distance(point, centers[labels[index]]) ** 2, 0);
  return { labels, centers, inertia };
}
function kmeans(points: number[][], k: number) {
  let best = kmeansOnce(points, k, 42 + k * 1009);
  // Match the historical sklearn intent (random_state=42, n_init=10):
  // ten deterministic k-means++ starts, retaining minimum within-cluster SS.
  for (let start = 1; start < 10; start += 1) {
    const candidate = kmeansOnce(points, k, 42 + k * 1009 + start * 7919);
    if (candidate.inertia < best.inertia) best = candidate;
  }
  return best;
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
    const uniquePoints = new Set(points.map(point => point.map(value => value.toFixed(8)).join("\u0000"))).size;
    if (points.length < 5 || uniquePoints < 2) return;
    let bestK = 2, bestScore = -Infinity, best = kmeans(points, 2); const maxK = Math.min(5, points.length - 1, uniquePoints);
    for (let k = 2; k <= maxK; k += 1) { const candidate = kmeans(points, k); const score = silhouette(points, candidate.labels, k); if (score > bestScore) { bestK = k; bestScore = score; best = candidate; } }
    best.centers.forEach((center, cluster) => { const count = best.labels.filter(label => label === cluster).length; const rgb = labToRgb(center[0], center[1], center[2]); rows.push({ 来源: source, 情绪: emotion, 样本数: points.length, 最佳K: bestK, 轮廓系数: round(bestScore), 簇: cluster + 1, 簇权重: round(count / points.length), 中心HEX: rgbToHex(rgb.r, rgb.g, rgb.b), 中心L: round(center[0]), 中心a: round(center[1]), 中心b: round(center[2]) }); });
  });
  return { id: "task1-cluster", title: "最佳 K 与 Lab 色彩聚类", kind: "colors", rows, summary: [{ label: "来源×情绪组合", value: String(keys.length) }, { label: "聚类中心", value: String(rows.length) }, { label: "K 搜索范围", value: "2–5" }], note: "沿用 Bias_kNumbers.py 的规则：样本数不足 5 的组合跳过；其余在 CIE Lab 空间搜索 K=2–5，并用平均轮廓系数选择最佳 K。每个K执行10次确定性k-means++初始化并保留组内平方和最小解，对齐历史 sklearn n_init=10 的分析意图。" };
}

/**
 * Fixed-K representative colours for descriptive palettes.
 * This is deliberately separate from runColorClustering(): the centres are
 * communication aids, not evidence that the observations form "true" groups.
 */
export function runRepresentativeColors(colors: CanonicalColorRow[], requestedK = 3): AnalysisResult {
  const rows: ExportRow[] = [];
  const keys = [...new Set(colors.map(row => `${row.source}\u0000${row.emotion}`))];
  keys.forEach(key => {
    const [source, emotion] = key.split("\u0000");
    const group = colors.filter(row => row.source === source && row.emotion === emotion);
    const points = group.map(row => [row.labL, row.labA, row.labB]);
    const uniquePoints = new Set(points.map(point => point.map(value => value.toFixed(8)).join("\u0000"))).size;
    if (!points.length || !uniquePoints) return;
    const k = Math.max(1, Math.min(requestedK, points.length, uniquePoints));
    const fitted = kmeans(points, k);
    const ranked = fitted.centers.map((center, cluster) => ({
      center,
      count: fitted.labels.filter(label => label === cluster).length,
    })).sort((a, b) => b.count - a.count);
    ranked.forEach((item, index) => {
      const rgb = labToRgb(item.center[0], item.center[1], item.center[2]);
      rows.push({
        来源: source,
        组类型: group[0]?.cohort || "unspecified",
        情绪: emotion,
        样本数: points.length,
        代表色序号: index + 1,
        代表色数量: k,
        比例: round(item.count / points.length, 6),
        中心HEX: rgbToHex(rgb.r, rgb.g, rgb.b),
        中心L: round(item.center[0], 4),
        中心a: round(item.center[1], 4),
        中心b: round(item.center[2], 4),
      });
    });
  });
  return {
    id: "task1-representative-colors",
    title: "Representative Colors（解释性代表色）",
    kind: "colors",
    rows,
    summary: [
      { label: "固定代表色数", value: String(requestedK) },
      { label: "来源×情绪", value: String(keys.length) },
      { label: "颜色空间", value: "CIELAB" },
    ],
    note: "每个来源×情绪在连续 CIELAB 中固定提取最多 3 个代表色，并报告样本比例。KMeans 仅用于压缩展示，不作为主要推断统计，也不把连续颜色解释为天然类别。",
  };
}

export function runContinuousHueEntropy(colors: CanonicalColorRow[], bins = 36): AnalysisResult {
  const keys = [...new Set(colors.map(row => `${row.source}\u0000${row.emotion}`))];
  const rows: ExportRow[] = keys.map(key => {
    const [source, emotion] = key.split("\u0000");
    const group = colors.filter(row => row.source === source && row.emotion === emotion);
    const chromatic = group.filter(row => row.hsvS > .01);
    const counts = hueHistogram(group, bins);
    const entropy = counts.reduce((sum, count) => {
      const probability = count / Math.max(1, chromatic.length);
      return probability ? sum - probability * Math.log2(probability) : sum;
    }, 0);
    const maxEntropy = Math.log2(bins);
    return {
      来源: source,
      组类型: group[0]?.cohort || "unspecified",
      情绪: emotion,
      N: group.length,
      有效色相N: chromatic.length,
      无彩色N: group.length - chromatic.length,
      色相熵_bits: round(entropy, 6),
      标准化色相熵: round(maxEntropy ? entropy / maxEntropy : 0, 6),
      有效色相箱数: round(2 ** entropy, 4),
      分箱宽度_度: round(360 / bins, 3),
    };
  });
  return {
    id: "task1-continuous-hue-entropy",
    title: "连续 Hue 分布熵",
    kind: "statistics",
    rows,
    summary: [
      { label: "来源×情绪", value: String(rows.length) },
      { label: "Hue 分箱", value: `${bins} × ${round(360 / bins, 1)}°` },
      { label: "无彩色处理", value: "单独计数" },
    ],
    note: "Hue 图仍按连续角度呈现；熵作为分布估计量使用固定 10° 圆周分箱。S≤0.01 的无彩色样本不被错误记作 0° 红色，而是单独报告。标准化熵范围 0–1，仅表示分散程度，不表示颜色选择更正确。",
  };
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
    if (Number.isFinite(delta)) rows.push({ 情绪: emotion, 来源A: sourceA, 来源B: sourceB, A样本数: a.length, B样本数: b.length, 对称最小ΔE76: round(delta, 3), 指标类型: "对称最近邻（Chamfer 型）", 解释限制: "支持集邻近度；非均值色差、非EMD、非单色感知阈值" });
  })));
  return { id: "task1-delta", title: "跨来源对称最近邻 ΔE（补充）", kind: "matrix", rows, summary: [{ label: "来源", value: String(sources.length) }, { label: "情绪", value: String(emotions.length) }, { label: "有效比较", value: String(rows.length) }, { label: "指标性质", value: "Chamfer 型支持集距离" }], note: "公式为 ½[meanₐ minᵦ ΔE76(a,b) + meanᵦ minₐ ΔE76(b,a)]。它只衡量两组色点支持集是否彼此靠近，会受分布覆盖范围、重复点和样本密度影响；不能使用 ΔE=2.3 等单色感知阈值解释，也不应作为 Human–AI 分布相似性的主指标。主相似性分析请使用 EMD/JSD，并同时报告 coverage 与 classifier AUC。" };
}

export function runColorSummary(colors: CanonicalColorRow[], rejected: number): AnalysisResult {
  const keys = [...new Set(colors.map(row => `${row.source}\u0000${row.emotion}`))]; const rows = keys.map(key => {
    const [source, emotion] = key.split("\u0000");
    const group = colors.filter(row => row.source === source && row.emotion === emotion);
    const lab = meanVector(group.map(row => [row.labL, row.labA, row.labB])), rgb = labToRgb(lab[0], lab[1], lab[2]);
    const chromatic = group.filter(row => row.hsvS > .01), angles = chromatic.map(row => row.h / 180 * Math.PI);
    const meanHue = angles.length ? ((Math.atan2(angles.reduce((sum, value) => sum + Math.sin(value), 0), angles.reduce((sum, value) => sum + Math.cos(value), 0)) * 180 / Math.PI) + 360) % 360 : null;
    return { 来源: source, 情绪: emotion, N: group.length, 有效色相N: chromatic.length, 平均HEX: rgbToHex(rgb.r, rgb.g, rgb.b), HSL圆均值H: meanHue == null ? null : round(meanHue, 2), 平均S_HSL: round(group.reduce((sum, row) => sum + row.s, 0) / group.length), 平均L_HSL: round(group.reduce((sum, row) => sum + row.l, 0) / group.length), 平均Lab_L: round(lab[0]), 平均Lab_a: round(lab[1]), 平均Lab_b: round(lab[2]) };
  });
  return { id: "task1-summary", title: "来源 × 情绪色彩描述", kind: "colors", rows, summary: [{ label: "有效色彩", value: String(colors.length) }, { label: "组合", value: String(rows.length) }, { label: "拒绝值", value: String(rejected) }] };
}

export function runHsvDistribution(colors: CanonicalColorRow[]): AnalysisResult {
  const rows: ExportRow[] = colors.map(row => ({ 来源: row.source, 情绪: row.emotion, HEX: row.hex, H_HSV_度: round(row.hsvH, 3), S_HSV: round(row.hsvS, 5), V_HSV: round(row.hsvV, 5) }));
  return { id: "task1-hsv", title: "HSV 分布与 H–S / V–S 图", kind: "colors", rows, summary: [{ label: "有效观察", value: String(rows.length) }, { label: "来源", value: String(new Set(colors.map(row => row.source)).size) }, { label: "情绪", value: String(new Set(colors.map(row => row.emotion)).size) }], note: "严格沿用 hsvplot.py：由标准 RGB 转换到 HSV，H 为 0–360°，S 与 V 为 0–1。" };
}

export function runWithinGroupDelta(colors: CanonicalColorRow[]): AnalysisResult {
  const keys = [...new Set(colors.map(row => `${row.source}\u0000${row.emotion}`))];
  const rows: ExportRow[] = [];
  keys.forEach(key => {
    const [source, emotion] = key.split("\u0000"); const group = colors.filter(row => row.source === source && row.emotion === emotion);
    if (group.length < 2) return;
    let total = 0, pairs = 0; const nearest = new Array(group.length).fill(Infinity);
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) { const value = distance(group[i], group[j]); total += value; pairs += 1; nearest[i] = Math.min(nearest[i], value); nearest[j] = Math.min(nearest[j], value); }
    rows.push({ 来源: source, 情绪: emotion, 样本数: group.length, 平均最近邻ΔE76: round(nearest.reduce((sum, value) => sum + value, 0) / group.length, 4), 全部样本对平均ΔE76: round(total / Math.max(1, pairs), 4), 样本对数量: pairs });
  });
  return { id: "task1-within-delta", title: "组内色差矩阵与一致性", kind: "statistics", rows, summary: [{ label: "来源×情绪", value: String(rows.length) }, { label: "来源", value: String(new Set(colors.map(row => row.source)).size) }, { label: "有效色彩", value: String(colors.length) }], note: "对应 demac.py 与 de2mac.py：对角线排除，汇总平均最近邻色差和全部样本对平均色差。" };
}

function hueHistogram(rows: CanonicalColorRow[], bins = 12) {
  const counts = new Array(bins).fill(0);
  // Hue is undefined for achromatic samples. Treating every grey as H=0 would
  // manufacture a red peak and bias entropy/JSD.
  rows.filter(row => row.hsvS > .01).forEach(row => { counts[Math.min(bins - 1, Math.floor((((row.hsvH % 360) + 360) % 360) / 360 * bins))] += 1; });
  return counts;
}

export function runColorDiversity(colors: CanonicalColorRow[]): AnalysisResult {
  const keys = [...new Set(colors.map(row => `${row.source}\u0000${row.emotion}`))];
  const rows: ExportRow[] = keys.map(key => {
    const [source, emotion] = key.split("\u0000"), group = colors.filter(row => row.source === source && row.emotion === emotion);
    const chromatic = group.filter(row => row.hsvS > .01);
    const angles = chromatic.map(row => row.hsvH / 180 * Math.PI);
    const meanSin = angles.length ? angles.reduce((sum, value) => sum + Math.sin(value), 0) / angles.length : 0;
    const meanCos = angles.length ? angles.reduce((sum, value) => sum + Math.cos(value), 0) / angles.length : 0;
    const resultant = Math.sqrt(meanSin ** 2 + meanCos ** 2);
    const meanHue = angles.length ? ((Math.atan2(meanSin, meanCos) * 180 / Math.PI) + 360) % 360 : null;
    const histogram = hueHistogram(group), entropy = histogram.reduce((sum, count) => {
      const probability = count / Math.max(1, chromatic.length);
      return probability ? sum - probability * Math.log2(probability) : sum;
    }, 0);
    const centroid = meanVector(group.map(row => [row.labL, row.labA, row.labB]));
    const rms = Math.sqrt(group.reduce((sum, row) => sum + distance(row, centroid) ** 2, 0) / group.length);
    return {
      来源: source,
      组类型: group[0]?.cohort || "unspecified",
      情绪: emotion,
      N: group.length,
      有效色相N: chromatic.length,
      HSV圆均值H_度: meanHue == null ? null : round(meanHue, 3),
      色相圆方差: angles.length ? round(1 - resultant, 6) : null,
      色相熵_12箱: round(entropy, 6),
      有效色相数: round(2 ** entropy, 4),
      平均HSV_S: round(group.reduce((sum, row) => sum + row.hsvS, 0) / group.length, 5),
      平均HSV_V: round(group.reduce((sum, row) => sum + row.hsvV, 0) / group.length, 5),
      Lab质心RMS色差: round(rms, 5),
    };
  });
  return { id: "task1-diversity", title: "色相圆统计与色彩多样性", kind: "statistics", rows, summary: [{ label: "来源×情绪", value: String(rows.length) }, { label: "色相分箱", value: "12" }, { label: "空间", value: "HSV + Lab" }], note: "色相按圆变量处理，避免 0°/360°断点；熵反映色相覆盖，Lab 质心 RMS 色差反映整体离散度。" };
}

export function runHueDistributionDistance(colors: CanonicalColorRow[]): AnalysisResult {
  const sources = [...new Set(colors.map(row => row.source))], emotions = [...new Set(colors.map(row => row.emotion))], rows: ExportRow[] = [];
  emotions.forEach(emotion => sources.forEach((sourceA, index) => sources.slice(index + 1).forEach(sourceB => {
    const a = colors.filter(row => row.source === sourceA && row.emotion === emotion), b = colors.filter(row => row.source === sourceB && row.emotion === emotion);
    const histogramA = hueHistogram(a), histogramB = hueHistogram(b);
    const chromaticA = histogramA.reduce((sum, value) => sum + value, 0), chromaticB = histogramB.reduce((sum, value) => sum + value, 0);
    if (chromaticA && chromaticB) rows.push({ 情绪: emotion, 来源A: sourceA, 来源B: sourceB, A样本数: a.length, B样本数: b.length, A有效色相N: chromaticA, B有效色相N: chromaticB, 色相Jensen_Shannon距离: round(Math.sqrt(jsd(histogramA, histogramB)), 6) });
  })));
  return { id: "task1-hue-jsd", title: "色相分布距离", kind: "matrix", rows, summary: [{ label: "来源对×情绪", value: String(rows.length) }, { label: "距离范围", value: "0–1" }, { label: "色相分箱", value: "12" }], note: "将 HSV 色相映射为 12 个圆周分箱后计算 Jensen–Shannon 距离，补充 Lab 色差对分布形状不敏感的问题。" };
}

export function runHumanAiColorAlignment(colors: CanonicalColorRow[]): AnalysisResult {
  const humanSources = [...new Set(colors.filter(row => row.cohort === "human").map(row => row.source))];
  const aiSources = [...new Set(colors.filter(row => row.cohort === "ai").map(row => row.source))];
  const emotions = [...new Set(colors.map(row => row.emotion))], rows: ExportRow[] = [];
  emotions.forEach(emotion => {
    const baselines: number[] = [];
    humanSources.forEach((sourceA, index) => humanSources.slice(index + 1).forEach(sourceB => {
      const value = symmetricMinDistance(colors.filter(row => row.source === sourceA && row.emotion === emotion), colors.filter(row => row.source === sourceB && row.emotion === emotion));
      if (Number.isFinite(value)) baselines.push(value);
    }));
    const sorted = baselines.sort((a, b) => a - b), baseline = sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
    aiSources.forEach(aiSource => {
      const comparisons = humanSources.map(humanSource => ({ humanSource, value: symmetricMinDistance(colors.filter(row => row.source === aiSource && row.emotion === emotion), colors.filter(row => row.source === humanSource && row.emotion === emotion)) })).filter(item => Number.isFinite(item.value)).sort((a, b) => a.value - b.value);
      if (!comparisons.length) return;
      rows.push({ 情绪: emotion, AI来源: aiSource, 最近人类组: comparisons[0].humanSource, 最近人类组ΔE76: round(comparisons[0].value, 4), 人类组间基线中位ΔE76: Number.isFinite(baseline) ? round(baseline, 4) : null, 相对人类基线比: Number.isFinite(baseline) && baseline > 0 ? round(comparisons[0].value / baseline, 5) : null, 比人类组间基线更接近: Number.isFinite(baseline) ? comparisons[0].value <= baseline : false });
    });
  });
  return { id: "task1-human-ai", title: "人类–AI色彩对齐", kind: "statistics", rows, summary: [{ label: "人类组", value: String(humanSources.length) }, { label: "AI组", value: String(aiSources.length) }, { label: "对齐单元", value: String(rows.length) }], note: "对每个 AI×情绪寻找最近的人类文化组，并以同一情绪下人类组间距离中位数作为可解释基线。该结果是探索性对齐指标，不替代预注册推断检验。" };
}

function combinations(size: number, choose: number) {
  const output: number[][] = [], current: number[] = [];
  const visit = (start: number) => {
    if (current.length === choose) { output.push(current.slice()); return; }
    for (let index = start; index <= size - (choose - current.length); index += 1) {
      current.push(index); visit(index + 1); current.pop();
    }
  };
  visit(0);
  return output;
}

function exactVectorPermutationP(vectors: number[][], firstGroupSize: number) {
  if (!firstGroupSize || firstGroupSize >= vectors.length) return NaN;
  const observedFirst = meanVector(vectors.slice(0, firstGroupSize));
  const observedSecond = meanVector(vectors.slice(firstGroupSize));
  const observed = distance(observedFirst, observedSecond);
  const assignments = combinations(vectors.length, firstGroupSize);
  if (assignments.length > 5000) return NaN;
  let extreme = 0;
  assignments.forEach(indices => {
    const selected = new Set(indices), first = vectors.filter((_, index) => selected.has(index)), second = vectors.filter((_, index) => !selected.has(index));
    if (distance(meanVector(first), meanVector(second)) >= observed - 1e-12) extreme += 1;
  });
  return extreme / assignments.length;
}

function exactScalarPermutationP(values: number[], firstGroupSize: number) {
  if (!firstGroupSize || firstGroupSize >= values.length) return NaN;
  const average = (items: number[]) => items.reduce((sum, value) => sum + value, 0) / items.length;
  const observed = Math.abs(average(values.slice(0, firstGroupSize)) - average(values.slice(firstGroupSize)));
  const assignments = combinations(values.length, firstGroupSize);
  if (assignments.length > 5000) return NaN;
  let extreme = 0;
  assignments.forEach(indices => {
    const selected = new Set(indices), first = values.filter((_, index) => selected.has(index)), second = values.filter((_, index) => !selected.has(index));
    if (Math.abs(average(first) - average(second)) >= observed - 1e-12) extreme += 1;
  });
  return extreme / assignments.length;
}

export function runHumanAiColorCohortTest(colors: CanonicalColorRow[]): AnalysisResult {
  const emotions = [...new Set(colors.map(row => row.emotion))];
  const raw = emotions.flatMap(emotion => {
    const emotionRows = colors.filter(row => row.emotion === emotion && row.cohort !== "unspecified");
    const sourceKeys = [...new Set(emotionRows.map(row => `${row.cohort}\u0000${row.source}`))];
    const sourceCentroids = sourceKeys.map(key => {
      const [cohort, source] = key.split("\u0000");
      const group = emotionRows.filter(row => row.cohort === cohort && row.source === source);
      return { cohort, source, n: group.length, centroid: meanVector(group.map(row => [row.labL, row.labA, row.labB])) };
    });
    const human = sourceCentroids.filter(item => item.cohort === "human"), ai = sourceCentroids.filter(item => item.cohort === "ai");
    if (!human.length || !ai.length) return [];
    const humanCentroid = meanVector(human.map(item => item.centroid)), aiCentroid = meanVector(ai.map(item => item.centroid));
    return [{
      emotion, human, ai,
      delta: distance(humanCentroid, aiCentroid),
      p: exactVectorPermutationP([...human.map(item => item.centroid), ...ai.map(item => item.centroid)], human.length),
    }];
  });
  const finiteP = raw.map(item => item.p).filter(Number.isFinite), adjusted = bh(finiteP);
  let pIndex = 0;
  const rows: ExportRow[] = raw.map(item => {
    const q = Number.isFinite(item.p) ? adjusted[pIndex++] : NaN;
    return {
      情绪: item.emotion,
      人类来源数: item.human.length,
      AI来源数: item.ai.length,
      人类样本数: item.human.reduce((sum, group) => sum + group.n, 0),
      AI样本数: item.ai.reduce((sum, group) => sum + group.n, 0),
      人类_AI来源质心ΔE76: round(item.delta, 5),
      精确置换p值: Number.isFinite(item.p) ? round(item.p, 6) : null,
      FDR_q值: Number.isFinite(q) ? round(q, 6) : null,
      FDR显著: Number.isFinite(q) ? q < .05 : false,
    };
  });
  return { id: "task1-cohort-test", title: "人类–AI来源级精确比较", kind: "statistics", rows, summary: [{ label: "情绪", value: String(rows.length) }, { label: "分析单位", value: "来源质心" }, { label: "多重校正", value: "BH-FDR" }], note: "先把每个来源在每个情绪的样本汇总为一个 Lab 质心，再以来源为独立分析单位执行人类/AI标签的双侧精确置换检验。4个人类组+4个AI组时穷举全部70种分组，避免把同一来源内重复回答误当独立样本。" };
}

export function runCulturalBias(colors: CanonicalColorRow[]): AnalysisResult {
  const sources = [...new Set(colors.map(row => row.source))], emotions = [...new Set(colors.map(row => row.emotion))]; const rows: ExportRow[] = [];
  emotions.forEach(emotion => sources.forEach((target, targetIndex) => {
    const references = sources.filter((_, index) => index !== targetIndex);
    for (let i = 0; i < references.length; i += 1) for (let j = i + 1; j < references.length; j += 1) {
      const referenceA = references[i], referenceB = references[j];
      const targetRows = colors.filter(row => row.source === target && row.emotion === emotion);
      const aRows = colors.filter(row => row.source === referenceA && row.emotion === emotion);
      const bRows = colors.filter(row => row.source === referenceB && row.emotion === emotion);
      const distanceA = symmetricMinDistance(aRows, targetRows), distanceB = symmetricMinDistance(bRows, targetRows);
      if (!Number.isFinite(distanceA) || !Number.isFinite(distanceB)) continue;
      const bias = distanceB - distanceA;
      rows.push({ 情绪: emotion, 参照A: referenceA, 参照B: referenceB, 目标来源: target, 目标至A_ΔE: round(distanceA, 4), 目标至B_ΔE: round(distanceB, 4), 偏置指数_B减A: round(bias, 4), 更接近: Math.abs(bias) < .001 ? "中立" : bias > 0 ? referenceA : referenceB });
    }
  }));
  return { id: "task1-bias", title: "跨文化引力与偏置指数", kind: "statistics", rows, summary: [{ label: "偏置观察", value: String(rows.length) }, { label: "来源", value: String(sources.length) }, { label: "情绪", value: String(emotions.length) }], note: "泛化 de6mac.py / de7mac.py：Bias = 目标至参照B ΔE − 目标至参照A ΔE；正值表示更接近参照A。" };
}

function normalizeEmotion(value: string) { const exact = GEW_EMOTIONS.find(emotion => emotion.toLowerCase() === value.trim().toLowerCase()); return exact || value.trim(); }
function associations(value: CellValue): Array<{ emotion: string; intensity: number }> | null {
  if (value == null || text(value) === "") return null;
  let parsed: unknown = value;
  if (typeof value === "string") { try { parsed = JSON.parse(value); } catch { return null; } }
  const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "associations" in parsed ? (parsed as { associations: unknown }).associations : parsed;
  if (Array.isArray(candidate)) return candidate.map(item => { const obj = item as Record<string, unknown>; return { emotion: normalizeEmotion(String(obj.emotion ?? obj.word ?? obj.name ?? "")), intensity: Number(obj.intensity ?? obj.score ?? obj.value ?? 0) }; }).filter(item => item.emotion);
  if (candidate && typeof candidate === "object") return Object.entries(candidate as Record<string, unknown>).map(([emotion, intensity]) => ({ emotion: normalizeEmotion(emotion), intensity: Number(intensity) }));
  return null;
}

export type RowQuality = {
  row: number;
  task1ValidColors: number;
  task1ExpectedColors: number;
  task2PresentCells: number;
  task2ValidCells: number;
  task2ExpectedCells: number;
  related: boolean;
  completeTask1: boolean;
  completeTask2: boolean;
};

export function inspectRowQuality(rows: DataRow[], columns: string[]): RowQuality[] {
  const detection = detectDataset(rows, columns);
  const task1ExpectedColors = detection.schema === "task1-long"
    ? 1
    : new Set(columns.map(column => column.match(/^color_data\.(.+)\.(?:h|s|l|hex)$/i)?.[1]).filter(Boolean)).size;
  const gewColumns = columns.filter(column => {
    const match = column.match(/^word_data\.(.+)$/i);
    return match ? GEW_COLOURS.includes(match[1] as typeof GEW_COLOURS[number]) : false;
  });
  return rows.map((raw, index) => {
    const parsedColor = parseColorRows([raw], columns, detection.schema);
    const task2PresentCells = gewColumns.filter(column => text(raw[column]) !== "").length;
    const task2ValidCells = gewColumns.filter(column => text(raw[column]) !== "" && associations(raw[column]) !== null).length;
    const task1ValidColors = parsedColor.rows.length;
    return {
      row: index + 1,
      task1ValidColors,
      task1ExpectedColors,
      task2PresentCells,
      task2ValidCells,
      task2ExpectedCells: gewColumns.length,
      related: task1ValidColors > 0 || task2PresentCells > 0,
      completeTask1: task1ExpectedColors > 0 && task1ValidColors >= task1ExpectedColors,
      completeTask2: gewColumns.length > 0 && task2ValidCells >= gewColumns.length,
    };
  });
}

export function parseGewRows(rows: DataRow[], columns: string[]): { rows: GewRow[]; sourceRows: number; invalidCells: number } {
  const gewColumns = columns.filter(column => {
    const match = column.match(/^word_data\.(.+)$/i);
    return match ? GEW_COLOURS.includes(match[1] as typeof GEW_COLOURS[number]) : false;
  }); const sourceColumn = findColumn(columns, ALIASES.source); const participantColumn = findColumn(columns, ALIASES.participant); const runColumn = findColumn(columns, ALIASES.run); const cohortColumn = findColumn(columns, ALIASES.cohort);
  const result: GewRow[] = []; let invalidCells = 0, sourceRows = 0;
  rows.forEach((raw, rowIndex) => {
    if (!gewColumns.some(column => text(raw[column]) !== "")) return;
    sourceRows += 1;
    gewColumns.forEach(column => {
    const color = column.replace(/^word_data\./i, ""); const parsed = associations(raw[column]); const valid = parsed !== null;
    if (!valid) invalidCells += 1;
    const map = new Map((parsed || []).filter(item => GEW_EMOTIONS.includes(item.emotion as typeof GEW_EMOTIONS[number]) && Number.isFinite(item.intensity)).map(item => [item.emotion, clamp(item.intensity, 0, 5)]));
    const participant = text(participantColumn ? raw[participantColumn] : null), run = text(runColumn ? raw[runColumn] : null);
    GEW_EMOTIONS.forEach(emotion => { const intensity = map.get(emotion) || 0; result.push({ participant: participant || String(rowIndex + 1), source: text(sourceColumn ? raw[sourceColumn] : null, "未分组"), cohort: normalizeCohort(cohortColumn ? raw[cohortColumn] : null), run: run || String(rowIndex + 1), color, emotion, selected: intensity > 0 ? 1 : 0, intensity, valid, identityProvided: Boolean(participant || run), sourceRow: rowIndex + 1 }); });
    });
  });
  return { rows: result, sourceRows, invalidCells };
}

export function gewRowsToExport(rows: GewRow[]): ExportRow[] { return rows.map(row => ({ 样本ID: row.participant, 来源: row.source, 组类型: row.cohort, 轮次: row.run, 原始行配对号: row.sourceRow, 颜色: row.color, 情绪: row.emotion, 是否选择: row.selected, 强度: row.intensity, 原始单元格有效: row.valid, 原始ID存在: row.identityProvided })); }

export function runGewQc(parsed: ReturnType<typeof parseGewRows>): AnalysisResult {
  const combinations = new Set(parsed.rows.map(row => `${row.source}\u0000${row.color}`)).size;
  return { id: "task2-qc", title: "GEW 解析与质量控制", kind: "table", rows: gewRowsToExport(parsed.rows), summary: [{ label: "源数据行", value: String(parsed.sourceRows) }, { label: "完整网格行", value: String(parsed.rows.length) }, { label: "无效 JSON 单元格", value: String(parsed.invalidCells) }, { label: "来源×颜色", value: String(combinations) }], note: "每个颜色补齐 20 个情绪；未选择项记为 selected=0、intensity=0。" };
}

export function runGewDescriptive(rows: GewRow[]): AnalysisResult {
  const validRows = rows.filter(row => row.valid), groups = summarizeGew(validRows);
  const output = [...groups.entries()].map(([key, group]) => { const [source, color, emotion] = key.split("\u0000"); return { 来源: source, 颜色: color, 情绪: emotion, N: group.n, 选择次数: group.yes, 选择率: round(group.yes / Math.max(1, group.n)), 平均强度_全部: round(group.intensity / Math.max(1, group.n)), 平均强度_已选择: round(group.selectedIntensity / Math.max(1, group.yes)), 价性: VALENCE[emotion] > 0 ? "积极" : "消极" }; });
  return { id: "task2-descriptive", title: "选择率、强度与价性", kind: "statistics", rows: output, summary: [{ label: "来源", value: String(new Set(validRows.map(row => row.source)).size) }, { label: "颜色", value: String(new Set(validRows.map(row => row.color)).size) }, { label: "统计单元", value: String(output.length) }] };
}

function erf(x: number) { const sign = x < 0 ? -1 : 1; x = Math.abs(x); const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911; const t=1/(1+p*x); return sign*(1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x)); }
function chiSquare2x2(a: number, b: number, c: number, d: number) { const n=a+b+c+d; const denominator=(a+b)*(c+d)*(a+c)*(b+d); return denominator ? n*(a*d-b*c)**2/denominator : 0; }
function bh(values: number[]) { const indexed=values.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value); const adjusted=new Array(values.length).fill(1); let previous=1; for(let i=indexed.length-1;i>=0;i-=1){ previous=Math.min(previous,indexed[i].value*indexed.length/(i+1)); adjusted[indexed[i].index]=previous; } return adjusted; }
function logGamma(value: number): number {
  const coefficients = [676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (value < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = .99999999999980993; const z = value - 1;
  coefficients.forEach((coefficient, index) => { x += coefficient / (z + index + 1); });
  const t = z + coefficients.length - .5;
  return .5 * Math.log(2 * Math.PI) + (z + .5) * Math.log(t) - t + Math.log(x);
}
function regularizedGammaQ(shape: number, value: number) {
  if (!(shape > 0) || value < 0) return NaN;
  if (value === 0) return 1;
  const epsilon = 1e-14, tiny = 1e-300, maxIterations = 200;
  if (value < shape + 1) {
    let term = 1 / shape, sum = term;
    for (let n = 1; n <= maxIterations; n += 1) {
      term *= value / (shape + n); sum += term;
      if (Math.abs(term) < Math.abs(sum) * epsilon) break;
    }
    const p = sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
    return clamp(1 - p);
  }
  let b = value + 1 - shape, c = 1 / tiny, d = 1 / Math.max(tiny, b), h = d;
  for (let i = 1; i <= maxIterations; i += 1) {
    const an = -i * (i - shape); b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny; d = 1 / d;
    const delta = d * c; h *= delta; if (Math.abs(delta - 1) < epsilon) break;
  }
  return clamp(Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * h);
}
function chiSquareSurvival(chiSquare: number, degreesOfFreedom: number) {
  return regularizedGammaQ(degreesOfFreedom / 2, Math.max(0, chiSquare) / 2);
}
function summarizeGew(rows: GewRow[]) {
  const groups = new Map<string, { n: number; yes: number; intensity: number; selectedIntensity: number }>();
  rows.forEach(row => { const key = `${row.source}\u0000${row.color}\u0000${row.emotion}`; const current = groups.get(key) || { n: 0, yes: 0, intensity: 0, selectedIntensity: 0 }; current.n += 1; current.yes += row.selected; current.intensity += row.intensity; if (row.selected) current.selectedIntensity += row.intensity; groups.set(key, current); });
  return groups;
}

export function runGewOmnibus(rows: GewRow[]): AnalysisResult {
  rows=rows.filter(row=>row.valid); const sources=[...new Set(rows.map(row=>row.source))], counts=summarizeGew(rows); const keys=[...new Set(rows.map(row=>`${row.color}\u0000${row.emotion}`))];
  const raw=keys.map(key=>{ const [color,emotion]=key.split("\u0000"); const groups=sources.map(source=>{ const group=counts.get(`${source}\u0000${color}\u0000${emotion}`) || {n:0,yes:0}; return {source,yes:group.yes,no:group.n-group.yes}; }).filter(group=>group.yes+group.no>0); const totalYes=groups.reduce((s,g)=>s+g.yes,0), total=groups.reduce((s,g)=>s+g.yes+g.no,0); let chi=0,minExpected=Infinity; groups.forEach(group=>{ const n=group.yes+group.no, ey=n*totalYes/Math.max(1,total), en=n*(total-totalYes)/Math.max(1,total); minExpected=Math.min(minExpected,ey,en);if(ey)chi+=(group.yes-ey)**2/ey;if(en)chi+=(group.no-en)**2/en; }); const df=Math.max(1,groups.length-1),p=groups.length>1?chiSquareSurvival(chi,df):1; return {color,emotion,chi,p,df,minExpected,sourceCount:groups.length,total}; });
  const adjusted=bh(raw.map(row=>row.p)); const output=raw.map((row,index)=>({颜色:row.color,情绪:row.emotion,来源数:row.sourceCount,卡方:round(row.chi,4),自由度:row.df,Cramér_V:round(Math.sqrt(row.chi/Math.max(1,row.total)),6),最小期望频数:Number.isFinite(row.minExpected)?round(row.minExpected,3):null,卡方近似可靠:row.minExpected>=5,p值:round(row.p,6),FDR_q值:round(adjusted[index],6),显著:adjusted[index]<.05}));
  return { id:"task2-omnibus", title:"来源间总体差异检验", kind:"statistics", rows:output, summary:[{label:"检验数",value:String(output.length)},{label:"FDR<.05",value:String(output.filter(row=>row.显著).length)},{label:"来源",value:String(sources.length)}], note:"对选择率执行 Pearson 卡方检验，按实际自由度计算卡方分布右尾概率，并用 Benjamini–Hochberg 方法控制多重比较；最小期望频数 <5 的单元应改用置换/精确检验复核。" };
}

export function runGewPairwise(rows: GewRow[]): AnalysisResult {
  rows=rows.filter(row=>row.valid); const sources=[...new Set(rows.map(row=>row.source))], keys=[...new Set(rows.map(row=>`${row.color}\u0000${row.emotion}`))], counts=summarizeGew(rows); const raw:Array<{color:string;emotion:string;a:string;b:string;rateA:number;rateB:number;chi:number;p:number;oddsRatio:number;ciLow:number;ciHigh:number;phi:number}>=[];
  keys.forEach(key=>{const[color,emotion]=key.split("\u0000");sources.forEach((a,ai)=>sources.slice(ai+1).forEach(b=>{const ga=counts.get(`${a}\u0000${color}\u0000${emotion}`)||{n:0,yes:0},gb=counts.get(`${b}\u0000${color}\u0000${emotion}`)||{n:0,yes:0};const noA=ga.n-ga.yes,noB=gb.n-gb.yes,chi=chiSquare2x2(ga.yes,noA,gb.yes,noB),p=1-erf(Math.sqrt(chi/2));const aa=ga.yes+.5,bb=noA+.5,cc=gb.yes+.5,dd=noB+.5,oddsRatio=aa*dd/(bb*cc),se=Math.sqrt(1/aa+1/bb+1/cc+1/dd);raw.push({color,emotion,a,b,rateA:ga.yes/Math.max(1,ga.n),rateB:gb.yes/Math.max(1,gb.n),chi,p,oddsRatio,ciLow:Math.exp(Math.log(oddsRatio)-1.96*se),ciHigh:Math.exp(Math.log(oddsRatio)+1.96*se),phi:Math.sqrt(chi/Math.max(1,ga.n+gb.n))});}));});
  const adjusted=bh(raw.map(row=>row.p)); const output=raw.map((row,index)=>({颜色:row.color,情绪:row.emotion,来源A:row.a,来源B:row.b,A选择率:round(row.rateA),B选择率:round(row.rateB),选择率差:round(row.rateA-row.rateB),优势比_OR:round(row.oddsRatio,5),OR_95CI下限:round(row.ciLow,5),OR_95CI上限:round(row.ciHigh,5),Phi效应量:round(row.phi,5),卡方:round(row.chi,4),p值:round(row.p,6),FDR_q值:round(adjusted[index],6),显著:adjusted[index]<.05}));
  return {id:"task2-pairwise",title:"来源两两差异",kind:"statistics",rows:output,summary:[{label:"两两检验",value:String(output.length)},{label:"FDR<.05",value:String(output.filter(row=>row.显著).length)},{label:"来源对",value:String(sources.length*(sources.length-1)/2)}],note:"每个颜色×情绪执行来源两两 2×2 卡方检验，并统一进行 FDR 校正。"};
}

function jsd(p:number[],q:number[]){const sumP=p.reduce((s,v)=>s+v,0)||1,sumQ=q.reduce((s,v)=>s+v,0)||1;const pp=p.map(v=>v/sumP),qq=q.map(v=>v/sumQ),m=pp.map((v,i)=>(v+qq[i])/2);const kl=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+(v? v*Math.log2(v/b[i]):0),0);return (kl(pp,m)+kl(qq,m))/2;}

/**
 * Compute one JSD distance for every source pair within every standard color.
 * The input vectors are source-level emotion selection rates, not participant
 * rows.  A zero-sum 20-emotion profile is explicitly reported as NA instead
 * of being silently converted to a degenerate distribution.
 */
export function computeColorwiseJsdPairs(rows: GewRow[]): ExportRow[] {
  const validRows = rows.filter(row => row.valid);
  const sources = [...new Set(validRows.map(row => row.source))];
  const observedColors = [...new Set(validRows.map(row => row.color))];
  const colors = [...GEW_COLOURS.filter(color => observedColors.includes(color)), ...observedColors.filter(color => !GEW_COLOURS.includes(color as typeof GEW_COLOURS[number]))];
  const counts = summarizeGew(validRows);
  const cohorts = new Map(validRows.map(row => [row.source, row.cohort]));
  const vector = (source: string, color: string) => GEW_EMOTIONS.map(emotion => {
    const group = counts.get(`${source}\u0000${color}\u0000${emotion}`) || { n: 0, yes: 0 };
    return group.n > 0 ? group.yes / group.n : 0;
  });
  const output: ExportRow[] = [];
  colors.forEach(color => sources.forEach((sourceA, sourceIndex) => sources.slice(sourceIndex + 1).forEach(sourceB => {
    const profileA = vector(sourceA, color), profileB = vector(sourceB, color);
    const sumA = profileA.reduce((sum, value) => sum + value, 0), sumB = profileB.reduce((sum, value) => sum + value, 0);
    const computable = sumA > 0 && sumB > 0;
    output.push({
      颜色: color,
      来源A: sourceA,
      来源B: sourceB,
      来源A组类型: cohorts.get(sourceA) || "unspecified",
      来源B组类型: cohorts.get(sourceB) || "unspecified",
      A选择率总和: round(sumA, 6),
      B选择率总和: round(sumB, 6),
      Jensen_Shannon距离: computable ? round(Math.sqrt(jsd(profileA, profileB)), 6) : null,
      计算状态: computable ? "ok" : sumA <= 0 && sumB <= 0 ? "both_zero_sum" : sumA <= 0 ? "source_a_zero_sum" : "source_b_zero_sum",
    });
  })));
  return output;
}

export function runGewJsd(rows:GewRow[]):AnalysisResult {
  const output = computeColorwiseJsdPairs(rows);
  const colors = new Set(output.map(row => String(row["颜色"] || "")));
  const missing = output.filter(row => row["Jensen_Shannon距离"] === null).length;
  return {
    id:"task2-jsd", title:"情绪分布距离", kind:"matrix", rows:output,
    summary:[{label:"来源对×颜色",value:String(output.length)},{label:"颜色",value:String(colors.size)},{label:"距离范围",value:"0–1"},{label:"不可计算",value:String(missing)}],
    note:"每个来源×颜色先形成20维情绪选择率向量并归一化，再计算以2为底的 Jensen–Shannon distance；越小表示该颜色的情绪轮廓越相似。20维选择率总和为0的来源×颜色明确记为NA。",
  };
}

export function runGewValenceProfile(rows: GewRow[]): AnalysisResult {
  rows = rows.filter(row => row.valid);
  const keys = [...new Set(rows.map(row => `${row.source}\u0000${row.color}`))];
  const output: ExportRow[] = keys.map(key => {
    const [source, color] = key.split("\u0000"), group = rows.filter(row => row.source === source && row.color === color);
    const positive = group.filter(row => VALENCE[row.emotion] > 0), negative = group.filter(row => VALENCE[row.emotion] < 0);
    const summarize = (items: GewRow[]) => ({ rate: items.reduce((sum, row) => sum + row.selected, 0) / Math.max(1, items.length), intensity: items.reduce((sum, row) => sum + row.intensity, 0) / Math.max(1, items.length) });
    const pos = summarize(positive), neg = summarize(negative);
    return { 来源: source, 组类型: group[0]?.cohort || "unspecified", 颜色: color, 积极情绪选择率: round(pos.rate, 6), 消极情绪选择率: round(neg.rate, 6), 价性选择差_积极减消极: round(pos.rate - neg.rate, 6), 积极情绪平均强度: round(pos.intensity, 6), 消极情绪平均强度: round(neg.intensity, 6), 价性强度差_积极减消极: round(pos.intensity - neg.intensity, 6) };
  });
  return { id: "task2-valence", title: "积极–消极价性结构", kind: "statistics", rows: output, summary: [{ label: "来源×颜色", value: String(output.length) }, { label: "积极情绪", value: "10" }, { label: "消极情绪", value: "10" }], note: "按 GEW 的前 10 个积极、后 10 个消极情绪汇总选择率与强度，适合检查人类与 AI 的总体价性偏移。" };
}

export function runGewConcentration(rows: GewRow[]): AnalysisResult {
  rows = rows.filter(row => row.valid);
  const counts = summarizeGew(rows), sources = [...new Set(rows.map(row => row.source))], colors = [...new Set(rows.map(row => row.color))], output: ExportRow[] = [];
  sources.forEach(source => colors.forEach(color => {
    const rates = GEW_EMOTIONS.map(emotion => { const group = counts.get(`${source}\u0000${color}\u0000${emotion}`) || { n: 0, yes: 0 }; return group.yes / Math.max(1, group.n); });
    const total = rates.reduce((sum, value) => sum + value, 0);
    if (!total) return;
    const probabilities = rates.map(value => value / total), entropy = probabilities.reduce((sum, value) => value ? sum - value * Math.log2(value) : sum, 0);
    const topIndex = rates.reduce((best, value, index) => value > rates[best] ? index : best, 0);
    const sourceRows = rows.filter(row => row.source === source && row.color === color);
    output.push({ 来源: source, 组类型: sourceRows[0]?.cohort || "unspecified", 颜色: color, Shannon熵: round(entropy, 6), 有效情绪数: round(2 ** entropy, 5), 归一化多样性: round(entropy / Math.log2(GEW_EMOTIONS.length), 6), 最高选择情绪: GEW_EMOTIONS[topIndex], 最高情绪选择率: round(rates[topIndex], 6), 最高情绪份额: round(probabilities[topIndex], 6) });
  }));
  return { id: "task2-concentration", title: "情绪集中度与多样性", kind: "statistics", rows: output, summary: [{ label: "来源×颜色", value: String(output.length) }, { label: "有效情绪范围", value: "1–20" }, { label: "输入", value: "选择率分布" }], note: "Shannon 熵与有效情绪数刻画一个颜色引发的情绪分布是集中还是分散，可检验 AI 是否比人类呈现更刻板的少数情绪。" };
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function percentile(values: number[], probability: number) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), upper = Math.ceil(position), weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function bootstrapMeanInterval(values: number[], seed: string, iterations = 500) {
  if (!values.length) return { mean: NaN, low: NaN, high: NaN };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1) return { mean, low: mean, high: mean };
  const random = seededRandom(hashSeed(seed)), estimates: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) total += values[Math.floor(random() * values.length)];
    estimates.push(total / values.length);
  }
  return { mean, low: percentile(estimates, .025), high: percentile(estimates, .975) };
}

export function runGewCompositeIndicators(rows: GewRow[], bootstrapIterations = 500): AnalysisResult {
  const valid = rows.filter(row => row.valid);
  const sampleGroups = new Map<string, GewRow[]>();
  valid.forEach(row => {
    const key = `${row.source}\u0000${row.participant}\u0000${row.run}\u0000${row.color}`;
    const group = sampleGroups.get(key) || [];
    group.push(row); sampleGroups.set(key, group);
  });
  const samples = [...sampleGroups.entries()].map(([key, group]) => {
    const [source, participant, run, color] = key.split("\u0000");
    const selected = group.filter(row => row.selected > 0);
    const positive = selected.filter(row => VALENCE[row.emotion] > 0).length;
    const negative = selected.filter(row => VALENCE[row.emotion] < 0).length;
    return {
      source, participant, run, color, cohort: group[0]?.cohort || "unspecified",
      broadness: selected.length,
      conditionalIntensity: selected.length ? selected.reduce((sum, row) => sum + row.intensity, 0) / selected.length : null,
      valenceBias: positive + negative ? (positive - negative) / (positive + negative) : null,
    };
  });
  const groupKeys = [...new Set(samples.map(sample => `${sample.source}\u0000${sample.color}`))], output: ExportRow[] = [];
  groupKeys.forEach(key => {
    const [source, color] = key.split("\u0000"), group = samples.filter(sample => sample.source === source && sample.color === color);
    const broadness = bootstrapMeanInterval(group.map(sample => sample.broadness), `${key}-broadness`, bootstrapIterations);
    const intensity = bootstrapMeanInterval(group.flatMap(sample => sample.conditionalIntensity === null ? [] : [sample.conditionalIntensity]), `${key}-intensity`, bootstrapIterations);
    const valence = bootstrapMeanInterval(group.flatMap(sample => sample.valenceBias === null ? [] : [sample.valenceBias]), `${key}-valence`, bootstrapIterations);
    output.push({
      来源: source, 组类型: group[0]?.cohort || "unspecified", 颜色: color, 独立样本数: group.length,
      平均情绪广度: round(broadness.mean, 6), 广度95CI下限: round(broadness.low, 6), 广度95CI上限: round(broadness.high, 6),
      平均条件强度: Number.isFinite(intensity.mean) ? round(intensity.mean, 6) : null,
      条件强度95CI下限: Number.isFinite(intensity.low) ? round(intensity.low, 6) : null,
      条件强度95CI上限: Number.isFinite(intensity.high) ? round(intensity.high, 6) : null,
      平均效价偏向: Number.isFinite(valence.mean) ? round(valence.mean, 6) : null,
      效价偏向95CI下限: Number.isFinite(valence.low) ? round(valence.low, 6) : null,
      效价偏向95CI上限: Number.isFinite(valence.high) ? round(valence.high, 6) : null,
    });
  });
  return {
    id: "task2-indicators", title: "GEW 广度、条件强度与效价偏向", kind: "statistics", rows: output,
    summary: [{ label: "独立样本×颜色", value: String(samples.length) }, { label: "来源×颜色", value: String(output.length) }, { label: "区间估计", value: `${bootstrapIterations}次 Bootstrap` }],
    note: `以 participant×run×color 为独立单位：Broadness 为选择情绪数（0–20），条件强度仅在已选择情绪中计算，效价偏向=(正向数−负向数)/(正向数+负向数)。区间为固定随机种子的${bootstrapIterations}次百分位Bootstrap。未加入唤醒度/力量偏向，因为当前数据未提供经验证的GEW维度坐标。`,
  };
}

function pearson(a: number[], b: number[]) {
  const meanA = a.reduce((sum, value) => sum + value, 0) / Math.max(1, a.length), meanB = b.reduce((sum, value) => sum + value, 0) / Math.max(1, b.length);
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0) * b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominator ? numerator / denominator : 0;
}

function profileMean(profiles: number[][]) {
  if (!profiles.length) return [];
  return profiles[0].map((_, index) => profiles.reduce((sum, profile) => sum + profile[index], 0) / profiles.length);
}

function validCorrelation(first: number[], second: number[]) {
  if (!first.length || first.length !== second.length) return NaN;
  const firstVaries = first.some(value => Math.abs(value - first[0]) > 1e-12);
  const secondVaries = second.some(value => Math.abs(value - second[0]) > 1e-12);
  return firstVaries && secondVaries ? pearson(first, second) : NaN;
}

export function runGewPatternSimilarity(rows: GewRow[], bootstrapIterations = 500): AnalysisResult {
  const valid = rows.filter(row => row.valid);
  const dimensions = GEW_COLOURS.flatMap(color => GEW_EMOTIONS.map(emotion => `${color}\u0000${emotion}`));
  const sampleGroups = new Map<string, GewRow[]>();
  valid.forEach(row => {
    const key = `${row.source}\u0000${row.participant}\u0000${row.run}`;
    const group = sampleGroups.get(key) || [];
    group.push(row); sampleGroups.set(key, group);
  });
  const sourceProfiles = new Map<string, number[][]>(), sourceCohorts = new Map<string, GewRow["cohort"]>();
  sampleGroups.forEach((group, key) => {
    const [source] = key.split("\u0000"), lookup = new Map(group.map(row => [`${row.color}\u0000${row.emotion}`, row.selected]));
    const profiles = sourceProfiles.get(source) || [];
    profiles.push(dimensions.map(dimension => lookup.get(dimension) || 0));
    sourceProfiles.set(source, profiles);
    sourceCohorts.set(source, group.find(row => row.cohort !== "unspecified")?.cohort || group[0]?.cohort || "unspecified");
  });
  const sources = [...sourceProfiles.keys()], output: ExportRow[] = [];
  const observedProfiles = new Map(sources.map(source => [source, profileMean(sourceProfiles.get(source) || [])]));
  const bootstrapProfiles = new Map<string, number[][]>();
  if (bootstrapIterations > 0) sources.forEach(source => {
    const profiles = sourceProfiles.get(source) || [], random = seededRandom(hashSeed(`${source}-pattern-bootstrap`)), estimates: number[][] = [];
    for (let iteration = 0; iteration < bootstrapIterations; iteration += 1) {
      const mean = new Array(dimensions.length).fill(0);
      for (let draw = 0; draw < profiles.length; draw += 1) {
        const profile = profiles[Math.floor(random() * profiles.length)];
        for (let dimension = 0; dimension < mean.length; dimension += 1) mean[dimension] += profile[dimension] / profiles.length;
      }
      estimates.push(mean);
    }
    bootstrapProfiles.set(source, estimates);
  });
  sources.forEach((sourceA, sourceIndex) => sources.slice(sourceIndex + 1).forEach(sourceB => {
    const profilesA = sourceProfiles.get(sourceA) || [], profilesB = sourceProfiles.get(sourceB) || [];
    const observed = validCorrelation(observedProfiles.get(sourceA) || [], observedProfiles.get(sourceB) || []);
    const bootA = bootstrapProfiles.get(sourceA) || [], bootB = bootstrapProfiles.get(sourceB) || [], estimates: number[] = [];
    for (let iteration = 0; iteration < Math.min(bootA.length, bootB.length); iteration += 1) {
      const estimate = validCorrelation(bootA[iteration], bootB[iteration]);
      if (Number.isFinite(estimate)) estimates.push(estimate);
    }
    const cohortA = sourceCohorts.get(sourceA) || "unspecified", cohortB = sourceCohorts.get(sourceB) || "unspecified";
    output.push({
      来源A: sourceA, A组类型: cohortA, A独立样本数: profilesA.length,
      来源B: sourceB, B组类型: cohortB, B独立样本数: profilesB.length,
      来源关系: cohortA === cohortB ? `${cohortA}内部` : "人类_AI",
      颜色情绪矩阵Pearson_r: Number.isFinite(observed) ? round(observed, 6) : null,
      Bootstrap95CI下限: estimates.length ? round(percentile(estimates, .025), 6) : null,
      Bootstrap95CI上限: estimates.length ? round(percentile(estimates, .975), 6) : null,
      Bootstrap有效次数: estimates.length,
      矩阵维度: dimensions.length,
    });
  }));
  return {
    id: "task2-pattern", title: "11×20 颜色—情绪模式相似性", kind: "matrix", rows: output,
    summary: [{ label: "来源", value: String(sources.length) }, { label: "来源对", value: String(output.length) }, { label: "矩阵维度", value: String(dimensions.length) }],
    note: `将每个来源的11×20关联概率矩阵展平为220维向量，计算来源对Pearson模式相似性；95%区间以participant×run为抽样单位分别在两个来源内进行${bootstrapIterations}次固定种子Bootstrap。该指标回答整体结构相似性，不替代具体单元格差异检验。`,
  };
}

function psiCanonicalSource(value: string) {
  const token = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (token === "cn" || token.includes("china")) return "CN";
  if (token === "bw") return "BW";
  if (token === "uk") return "UK";
  if (token === "us" || token === "usa") return "US";
  if (token.includes("deepseek")) return "DeepSeek";
  if (token.includes("doubao")) return "Doubao";
  if (token === "gpt" || token.includes("openai")) return "GPT";
  if (token.includes("gemini")) return "Gemini";
  return value;
}

function psiOrderedSources(values: string[], desired: string[]) {
  const ordered: string[] = [];
  desired.forEach(name => {
    const match = values.find(value => psiCanonicalSource(value).toLowerCase() === name.toLowerCase());
    if (match && !ordered.includes(match)) ordered.push(match);
  });
  return ordered;
}

function shuffledIndices(length: number, random: () => number) {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [indices[index], indices[swap]] = [indices[swap], indices[index]];
  }
  return indices;
}

function optionalFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * One-sided structured semantic-alignment test for the 16 prespecified
 * AI–Human PSI pairs.  The existing Pearson point estimate and participant /
 * run bootstrap are obtained unchanged from runGewPatternSimilarity().  Only
 * the new null layer permutes the 11 row labels and 20 column labels; it never
 * shuffles 220 cells independently.
 */
export function runGewPsiAiHumanSignificance(
  rows: GewRow[],
  permutationIterations = 10_000,
  randomSeed = 20_260_823,
  bootstrapIterations = 500,
): AnalysisResult {
  const valid = rows.filter(row => row.valid);
  const sources = [...new Set(valid.map(row => row.source))];
  const humanSources = psiOrderedSources(sources.filter(source => valid.some(row => row.source === source && row.cohort === "human")), ["UK", "US", "CN", "BW"]);
  const aiSources = psiOrderedSources(sources.filter(source => valid.some(row => row.source === source && row.cohort === "ai")), ["Doubao", "DeepSeek", "GPT", "Gemini"]);
  if (humanSources.length !== 4 || aiSources.length !== 4) {
    throw new Error(`PSI显著性检验需要固定4个AI与4个人类来源；当前识别到 ${aiSources.length} AI + ${humanSources.length} Human。`);
  }
  const nPermutation = Math.max(1, Math.floor(permutationIterations));
  const existing = runGewPatternSimilarity(valid, bootstrapIterations);
  const counts = summarizeGew(valid);
  const profile = (source: string) => GEW_COLOURS.flatMap(color => GEW_EMOTIONS.map(emotion => {
    const group = counts.get(`${source}\u0000${color}\u0000${emotion}`) || { n: 0, yes: 0 };
    return group.n ? group.yes / group.n : 0;
  }));
  const observedProfiles = new Map(sources.map(source => [source, profile(source)]));
  const pairs = aiSources.flatMap(aiSource => humanSources.map(humanSource => ({ aiSource, humanSource })));
  const raw = pairs.map(({ aiSource, humanSource }) => {
    const existingRow = existing.rows.find(row => (row["来源A"] === aiSource && row["来源B"] === humanSource) || (row["来源A"] === humanSource && row["来源B"] === aiSource));
    const observed = optionalFiniteNumber(existingRow?.["颜色情绪矩阵Pearson_r"]);
    const aiProfile = observedProfiles.get(aiSource) || [], humanProfile = observedProfiles.get(humanSource) || [];
    const directObserved = validCorrelation(aiProfile, humanProfile);
    if (observed === null || !Number.isFinite(directObserved) || Math.abs(observed - directObserved) > 1e-5) {
      throw new Error(`PSI点估计审计失败：${aiSource}–${humanSource} 的正式PSI与置换输入不一致。`);
    }
    const random = seededRandom(hashSeed(`${randomSeed}\u0000${psiCanonicalSource(aiSource)}\u0000${psiCanonicalSource(humanSource)}\u0000psi-structured-permutation`));
    const nullValues = new Array<number>(nPermutation);
    let exceedances = 0;
    for (let iteration = 0; iteration < nPermutation; iteration += 1) {
      const colorOrder = shuffledIndices(GEW_COLOURS.length, random), emotionOrder = shuffledIndices(GEW_EMOTIONS.length, random);
      const permuted = new Array<number>(GEW_COLOURS.length * GEW_EMOTIONS.length);
      let target = 0;
      for (let colorIndex = 0; colorIndex < GEW_COLOURS.length; colorIndex += 1) {
        for (let emotionIndex = 0; emotionIndex < GEW_EMOTIONS.length; emotionIndex += 1) {
          permuted[target] = humanProfile[colorOrder[colorIndex] * GEW_EMOTIONS.length + emotionOrder[emotionIndex]];
          target += 1;
        }
      }
      const estimate = validCorrelation(aiProfile, permuted);
      nullValues[iteration] = estimate;
      if (estimate >= observed) exceedances += 1;
    }
    const nullMean = nullValues.reduce((sum, value) => sum + value, 0) / nullValues.length;
    const nullSd = Math.sqrt(nullValues.reduce((sum, value) => sum + (value - nullMean) ** 2, 0) / Math.max(1, nullValues.length - 1));
    return {
      aiSource, humanSource, observed,
      ciLow: optionalFiniteNumber(existingRow?.["Bootstrap95CI下限"]),
      ciHigh: optionalFiniteNumber(existingRow?.["Bootstrap95CI上限"]),
      bootstrapValid: optionalFiniteNumber(existingRow?.["Bootstrap有效次数"]) ?? 0,
      p: (1 + exceedances) / (nPermutation + 1),
      permMean: nullMean, permSd: nullSd, permQ025: percentile(nullValues, .025), permQ975: percentile(nullValues, .975),
    };
  });
  const adjusted = bh(raw.map(row => row.p));
  const output: ExportRow[] = raw.map((row, index) => ({
    ai_source: row.aiSource,
    human_source: row.humanSource,
    psi: round(row.observed, 6),
    bootstrap_ci_low: row.ciLow === null ? null : round(row.ciLow, 6),
    bootstrap_ci_high: row.ciHigh === null ? null : round(row.ciHigh, 6),
    n_bootstrap: bootstrapIterations,
    bootstrap_valid: row.bootstrapValid,
    permutation_p: round(row.p, 8),
    fdr_q: round(adjusted[index], 8),
    n_permutation: nPermutation,
    significant_fdr: adjusted[index] < .05,
    significance_stars: adjusted[index] < .001 ? "***" : adjusted[index] < .01 ? "**" : adjusted[index] < .05 ? "*" : "",
    random_seed: randomSeed,
    null_model: "independent color-label and emotion-label permutation",
    perm_mean: round(row.permMean, 6),
    perm_sd: round(row.permSd, 6),
    perm_q025: round(row.permQ025, 6),
    perm_q975: round(row.permQ975, 6),
    audit_unique_pair: `${psiCanonicalSource(row.aiSource)}–${psiCanonicalSource(row.humanSource)}`,
    audit_permutation_unit: "11 color rows + 20 emotion columns",
  }));
  const uniquePairs = new Set(output.map(row => String(row["audit_unique_pair"]))).size;
  const auditOk = output.length === 16 && uniquePairs === 16 && output.every(row => row["permutation_p"] !== null && Number(row["permutation_p"]) > 0 && Number(row["n_permutation"]) === nPermutation);
  if (!auditOk) throw new Error("PSI显著性统计审计失败：结果不是16个唯一AI–Human pair，或置换次数/p值不合规。");
  return {
    id: "task2-psi-ai-human-significance", title: "AI–Human PSI结构保持置换检验", kind: "statistics", rows: output,
    summary: [
      { label: "唯一AI–Human pair", value: String(uniquePairs) },
      { label: "BH-FDR family", value: String(adjusted.length) },
      { label: "每pair置换", value: String(nPermutation) },
      { label: "固定随机种子", value: String(randomSeed) },
      { label: "统计审计", value: auditOk ? "通过" : "失败" },
    ],
    note: `PSI点估计与participant/run层级${bootstrapIterations}次Bootstrap CI原样复用现有实现。单侧置换检验固定AI矩阵，仅对Human矩阵独立置换11个颜色行标签与20个情绪列标签；不独立打乱220个cell。16个预定义AI–Human pair统一进行BH-FDR校正。`,
  };
}

export function runHumanAiGewAlignment(rows: GewRow[]): AnalysisResult {
  rows = rows.filter(row => row.valid);
  const counts = summarizeGew(rows), humanSources = [...new Set(rows.filter(row => row.cohort === "human").map(row => row.source))], aiSources = [...new Set(rows.filter(row => row.cohort === "ai").map(row => row.source))], colors = [...new Set(rows.map(row => row.color))], output: ExportRow[] = [];
  const vector = (source: string, color: string) => GEW_EMOTIONS.map(emotion => { const group = counts.get(`${source}\u0000${color}\u0000${emotion}`) || { n: 0, yes: 0 }; return group.yes / Math.max(1, group.n); });
  aiSources.forEach(aiSource => colors.forEach(color => {
    const aiVector = vector(aiSource, color);
    const comparisons = humanSources.map(humanSource => {
      const humanVector = vector(humanSource, color);
      return { humanSource, jsDistance: Math.sqrt(jsd(aiVector, humanVector)), correlation: pearson(aiVector, humanVector) };
    }).sort((a, b) => a.jsDistance - b.jsDistance);
    if (!comparisons.length) return;
    output.push({ AI来源: aiSource, 颜色: color, 最近人类组: comparisons[0].humanSource, 最近人类组JSD: round(comparisons[0].jsDistance, 6), 选择率Pearson相关: round(comparisons[0].correlation, 6), 人类组平均JSD: round(comparisons.reduce((sum, item) => sum + item.jsDistance, 0) / comparisons.length, 6) });
  }));
  return { id: "task2-human-ai", title: "人类–AI情绪轮对齐", kind: "statistics", rows: output, summary: [{ label: "人类组", value: String(humanSources.length) }, { label: "AI组", value: String(aiSources.length) }, { label: "AI×颜色", value: String(output.length) }], note: "同时报告 JSD（分布距离）与 Pearson 相关（轮廓相似度），避免仅用单一指标判断 AI 与哪一组人类更接近。" };
}

export function runHumanAiGewCohortTest(rows: GewRow[]): AnalysisResult {
  rows = rows.filter(row => row.valid && row.cohort !== "unspecified");
  const counts = summarizeGew(rows), colors = [...new Set(rows.map(row => row.color))], outputRaw: Array<{
    color: string; emotion: string; human: Array<{ source: string; rate: number; intensity: number; conditional: number; n: number }>; ai: Array<{ source: string; rate: number; intensity: number; conditional: number; n: number }>;
    rateDifference: number; intensityDifference: number; conditionalDifference: number; rateP: number; intensityP: number; conditionalP: number;
  }> = [];
  colors.forEach(color => GEW_EMOTIONS.forEach(emotion => {
    const sourceRows = [...new Set(rows.filter(row => row.color === color && row.emotion === emotion).map(row => `${row.cohort}\u0000${row.source}`))].map(key => {
      const [cohort, source] = key.split("\u0000"), group = counts.get(`${source}\u0000${color}\u0000${emotion}`);
      return group && group.n ? { cohort, source, n: group.n, rate: group.yes / group.n, intensity: group.intensity / group.n, conditional: group.yes ? group.selectedIntensity / group.yes : NaN } : null;
    }).filter((item): item is { cohort: string; source: string; n: number; rate: number; intensity: number; conditional: number } => Boolean(item));
    const human = sourceRows.filter(item => item.cohort === "human"), ai = sourceRows.filter(item => item.cohort === "ai");
    if (!human.length || !ai.length) return;
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const rates = [...human.map(item => item.rate), ...ai.map(item => item.rate)], intensities = [...human.map(item => item.intensity), ...ai.map(item => item.intensity)];
    const humanConditional = human.map(item => item.conditional).filter(Number.isFinite), aiConditional = ai.map(item => item.conditional).filter(Number.isFinite);
    const conditionals = [...humanConditional, ...aiConditional];
    outputRaw.push({
      color, emotion, human, ai,
      rateDifference: mean(ai.map(item => item.rate)) - mean(human.map(item => item.rate)),
      intensityDifference: mean(ai.map(item => item.intensity)) - mean(human.map(item => item.intensity)),
      conditionalDifference: humanConditional.length && aiConditional.length ? mean(aiConditional) - mean(humanConditional) : NaN,
      rateP: exactScalarPermutationP(rates, human.length),
      intensityP: exactScalarPermutationP(intensities, human.length),
      conditionalP: humanConditional.length && aiConditional.length ? exactScalarPermutationP(conditionals, humanConditional.length) : NaN,
    });
  }));
  const rateAdjusted = bh(outputRaw.map(item => item.rateP).filter(Number.isFinite)), intensityAdjusted = bh(outputRaw.map(item => item.intensityP).filter(Number.isFinite)), conditionalAdjusted = bh(outputRaw.map(item => item.conditionalP).filter(Number.isFinite));
  let rateIndex = 0, intensityIndex = 0, conditionalIndex = 0;
  const output: ExportRow[] = outputRaw.map(item => {
    const rateQ = Number.isFinite(item.rateP) ? rateAdjusted[rateIndex++] : NaN, intensityQ = Number.isFinite(item.intensityP) ? intensityAdjusted[intensityIndex++] : NaN, conditionalQ = Number.isFinite(item.conditionalP) ? conditionalAdjusted[conditionalIndex++] : NaN;
    return {
      颜色: item.color, 情绪: item.emotion, 人类来源数: item.human.length, AI来源数: item.ai.length,
      AI减人类_来源平均选择率差: round(item.rateDifference, 6), 选择率精确置换p值: Number.isFinite(item.rateP) ? round(item.rateP, 6) : null, 选择率FDR_q值: Number.isFinite(rateQ) ? round(rateQ, 6) : null,
      AI减人类_来源平均条件强度差: Number.isFinite(item.conditionalDifference) ? round(item.conditionalDifference, 6) : null, 条件强度精确置换p值: Number.isFinite(item.conditionalP) ? round(item.conditionalP, 6) : null, 条件强度FDR_q值: Number.isFinite(conditionalQ) ? round(conditionalQ, 6) : null,
      AI减人类_来源平均强度差: round(item.intensityDifference, 6), 强度精确置换p值: Number.isFinite(item.intensityP) ? round(item.intensityP, 6) : null, 强度FDR_q值: Number.isFinite(intensityQ) ? round(intensityQ, 6) : null,
    };
  });
  return { id: "task2-cohort-test", title: "人类–AI情绪轮来源级精确比较", kind: "statistics", rows: output, summary: [{ label: "颜色×情绪", value: String(output.length) }, { label: "分析单位", value: "来源" }, { label: "多重校正", value: "BH-FDR" }], note: "先在每个来源内计算颜色×情绪的选择率、条件强度与零值纳入强度，再以来源为独立单位进行人类/AI双侧精确置换检验。4+4来源且数据完整时每项穷举70种标签分配；三类指标分别进行BH-FDR校正。" };
}

function ranksWithTies(values: number[]) {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length).fill(0);
  for (let start = 0; start < indexed.length;) {
    let end = start + 1;
    while (end < indexed.length && Math.abs(indexed[end].value - indexed[start].value) < 1e-12) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index += 1) ranks[indexed[index].index] = rank;
    start = end;
  }
  return ranks;
}

function normalizeDistribution(values: number[]) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  return total ? values.map(value => Math.max(0, value) / total) : values.map(() => 0);
}

function spearmanWithTies(first: number[], second: number[]) {
  const firstRanks = ranksWithTies(first), secondRanks = ranksWithTies(second);
  const firstVaries = firstRanks.some(value => Math.abs(value - firstRanks[0]) > 1e-12);
  const secondVaries = secondRanks.some(value => Math.abs(value - secondRanks[0]) > 1e-12);
  return firstVaries && secondVaries ? pearson(firstRanks, secondRanks) : NaN;
}

export function runBidirectionalConsistency(colors: CanonicalColorRow[], gewRows: GewRow[]): AnalysisResult {
  const validGew = gewRows.filter(row => row.valid);
  const colorSources = new Set(colors.map(row => row.source));
  const sources = [...new Set(validGew.map(row => row.source))].filter(source => colorSources.has(source));
  const standardLabs = GEW_COLOURS.map(code => {
    const rgb = hexToRgb(GEW_COLOR_HEX[code])!;
    return { code, hex: GEW_COLOR_HEX[code], lab: rgbToLab(rgb.r, rgb.g, rgb.b) };
  });
  const counts = summarizeGew(validGew), output: ExportRow[] = [];
  let mappedColors = 0, mappingDistanceTotal = 0;

  sources.forEach(source => {
    const sourceColors = colors.filter(row => row.source === source);
    const sourceGew = validGew.filter(row => row.source === source);
    const cohort = sourceColors.find(row => row.cohort !== "unspecified")?.cohort
      || sourceGew.find(row => row.cohort !== "unspecified")?.cohort
      || "unspecified";
    const mapped = sourceColors.map(row => {
      const matches = standardLabs.map(standard => ({
        ...standard,
        delta: deltaE2000(
          { l: row.labL, a: row.labA, b: row.labB },
          standard.lab,
        ),
      })).sort((a, b) => a.delta - b.delta);
      mappedColors += 1; mappingDistanceTotal += matches[0].delta;
      return { row, code: matches[0].code, delta: matches[0].delta };
    });

    const gewProfiles = new Map<string, { probability: number; conditional: number; total: number }>();
    GEW_COLOURS.forEach(code => GEW_EMOTIONS.forEach(emotion => {
      const group = counts.get(`${source}\u0000${code}\u0000${emotion}`) || { n: 0, yes: 0, intensity: 0, selectedIntensity: 0 };
      gewProfiles.set(`${code}\u0000${emotion}`, {
        probability: group.yes / Math.max(1, group.n),
        conditional: group.selectedIntensity / Math.max(1, group.yes),
        total: group.intensity / Math.max(1, group.n),
      });
    }));

    GEW_EMOTIONS.forEach(emotion => {
      const emotionMapped = mapped.filter(item => item.row.emotion === emotion);
      if (!emotionMapped.length) return;
      const wordCounts = GEW_COLOURS.map(code => emotionMapped.filter(item => item.code === code).length);
      const wordDistribution = normalizeDistribution(wordCounts);
      const probabilityRaw = GEW_COLOURS.map(code => gewProfiles.get(`${code}\u0000${emotion}`)?.probability || 0);
      const totalRaw = GEW_COLOURS.map(code => gewProfiles.get(`${code}\u0000${emotion}`)?.total || 0);
      const conditionalRaw = GEW_COLOURS.map(code => gewProfiles.get(`${code}\u0000${emotion}`)?.conditional || 0);
      const probabilityDistribution = normalizeDistribution(probabilityRaw);
      const totalDistribution = normalizeDistribution(totalRaw);
      const conditionalDistribution = normalizeDistribution(conditionalRaw);
      const totalAvailable = totalRaw.some(value => value > 0), probabilityAvailable = probabilityRaw.some(value => value > 0), conditionalAvailable = conditionalRaw.some(value => value > 0);
      const topWord = [...wordDistribution.keys()].sort((a, b) => wordDistribution[b] - wordDistribution[a]);
      const topEmotionForColor = (colorIndex: number, limit: number) => [...GEW_EMOTIONS]
        .map((candidate, index) => ({ candidate, index, value: gewProfiles.get(`${GEW_COLOURS[colorIndex]}\u0000${candidate}`)?.total || 0 }))
        .sort((a, b) => b.value - a.value || a.index - b.index)
        .slice(0, limit)
        .map(item => item.candidate);
      const top1Mutual = totalAvailable && topEmotionForColor(topWord[0], 1).includes(emotion);
      const top3Mutual = topWord.slice(0, 3).filter(index => topEmotionForColor(index, 3).includes(emotion)).length / 3;
      const rankTotal = totalAvailable ? spearmanWithTies(wordDistribution, totalDistribution) : NaN;
      const rankProbability = probabilityAvailable ? spearmanWithTies(wordDistribution, probabilityDistribution) : NaN;
      const rankConditional = conditionalAvailable ? spearmanWithTies(wordDistribution, conditionalDistribution) : NaN;
      const jsdSimilarity = totalAvailable ? 1 - jsd(wordDistribution, totalDistribution) : NaN;
      const jsdProbability = probabilityAvailable ? 1 - jsd(wordDistribution, probabilityDistribution) : NaN;
      const jsdConditional = conditionalAvailable ? 1 - jsd(wordDistribution, conditionalDistribution) : NaN;
      const meanAbsoluteAsymmetry = totalAvailable
        ? wordDistribution.reduce((sum, value, index) => sum + Math.abs(value - totalDistribution[index]), 0) / GEW_COLOURS.length
        : NaN;

      GEW_COLOURS.forEach((code, index) => {
        const p = wordDistribution[index], q = totalDistribution[index];
        output.push({
          来源: source,
          组类型: cohort,
          情绪: emotion,
          标准色码: code,
          标准HEX: GEW_COLOR_HEX[code],
          词选色映射样本数: wordCounts[index],
          词选色概率_P: round(p, 6),
          色选词关联概率: round(probabilityRaw[index], 6),
          色选词条件强度: round(conditionalRaw[index], 6),
          色选词综合均值: round(totalRaw[index], 6),
          色选词归一化综合_Q: round(q, 6),
          色选词归一化概率: round(probabilityDistribution[index], 6),
          色选词归一化条件强度: round(conditionalDistribution[index], 6),
          方向差_P减Q: totalAvailable ? round(p - q, 6) : null,
          双向调和强度: totalAvailable && p + q ? round(2 * p * q / (p + q), 6) : 0,
          情绪颜色排序Spearman_综合: Number.isFinite(rankTotal) ? round(rankTotal, 6) : null,
          情绪颜色排序Spearman_概率: Number.isFinite(rankProbability) ? round(rankProbability, 6) : null,
          情绪颜色排序Spearman_条件强度: Number.isFinite(rankConditional) ? round(rankConditional, 6) : null,
          JSD相似度_综合: Number.isFinite(jsdSimilarity) ? round(jsdSimilarity, 6) : null,
          JSD相似度_关联概率: Number.isFinite(jsdProbability) ? round(jsdProbability, 6) : null,
          JSD相似度_条件强度: Number.isFinite(jsdConditional) ? round(jsdConditional, 6) : null,
          Top1相互首选: top1Mutual,
          Top3相互比例: totalAvailable ? round(top3Mutual, 6) : null,
          平均绝对非对称: Number.isFinite(meanAbsoluteAsymmetry) ? round(meanAbsoluteAsymmetry, 6) : null,
          映射平均ΔE00: round(emotionMapped.reduce((sum, item) => sum + item.delta, 0) / emotionMapped.length, 5),
        });
      });
    });
  });
  const sourceEmotionCount = new Set(output.map(row => `${row["来源"]}\u0000${row["情绪"]}`)).size;
  return {
    id: "task-cross-bidirectional",
    title: "双向情绪—颜色一致性与非对称性",
    kind: "statistics",
    rows: output,
    summary: [
      { label: "可配对来源", value: String(sources.length) },
      { label: "来源×情绪", value: String(sourceEmotionCount) },
      { label: "硬映射色彩", value: String(mappedColors) },
      { label: "平均映射ΔE00", value: mappedColors ? round(mappingDistanceTotal / mappedColors, 3).toFixed(3) : "—" },
    ],
    note: "将自由词选色以 CIEDE2000 硬映射到实验二的 11 个标准色，再按同名来源构造 20×11 双向矩阵。实验二方向分别保留关联概率、已选择条件强度和零值纳入综合强度三种口径，并输出对应Spearman与JSD相似度；Top-1/Top-3、P−Q与调和互惠强度默认基于综合强度。该结果是主流GEW分析之后的来源级探索扩展，不应在缺少共同participant/run标识时解释为个体回认。",
  };
}

export function runBidirectionalGroupComparison(rows: ExportRow[]): AnalysisResult {
  const unique = new Map<string, ExportRow>();
  rows.forEach(row => {
    const source = String(row["来源"] || ""), emotion = String(row["情绪"] || "");
    if (source && emotion) unique.set(`${source}\u0000${emotion}`, row);
  });
  const metrics: Array<{ key: string; label: string; read: (row: ExportRow) => number | null }> = [
    { key: "rank_probability", label: "排序一致性_关联概率", read: row => finiteExportNumber(row["情绪颜色排序Spearman_概率"]) },
    { key: "rank_conditional", label: "排序一致性_条件强度", read: row => finiteExportNumber(row["情绪颜色排序Spearman_条件强度"]) },
    { key: "rank_overall", label: "排序一致性_综合强度", read: row => finiteExportNumber(row["情绪颜色排序Spearman_综合"]) },
    { key: "jsd_probability", label: "分布相似度_关联概率", read: row => finiteExportNumber(row["JSD相似度_关联概率"]) },
    { key: "jsd_conditional", label: "分布相似度_条件强度", read: row => finiteExportNumber(row["JSD相似度_条件强度"]) },
    { key: "jsd_overall", label: "分布相似度_综合强度", read: row => finiteExportNumber(row["JSD相似度_综合"]) },
    { key: "top1", label: "Top1相互首选率", read: row => row["Top1相互首选"] === null || row["Top1相互首选"] === undefined ? null : row["Top1相互首选"] ? 1 : 0 },
    { key: "asymmetry", label: "平均绝对非对称", read: row => finiteExportNumber(row["平均绝对非对称"]) },
  ];
  const sources = [...new Set([...unique.values()].map(row => String(row["来源"] || "")))].filter(Boolean);
  const cohortFor = (source: string) => String([...unique.values()].find(row => row["来源"] === source)?.["组类型"] || "unspecified");
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const output: ExportRow[] = [];
  metrics.forEach(metric => sources.forEach((sourceA, sourceIndex) => sources.slice(sourceIndex + 1).forEach(sourceB => {
    const pairs = GEW_EMOTIONS.flatMap(emotion => {
      const a = metric.read(unique.get(`${sourceA}\u0000${emotion}`) || {}), b = metric.read(unique.get(`${sourceB}\u0000${emotion}`) || {});
      return a === null || b === null ? [] : [{ a, b }];
    });
    if (!pairs.length) return;
    const vectorA = pairs.map(pair => pair.a), vectorB = pairs.map(pair => pair.b);
    const differences = pairs.map(pair => pair.a - pair.b);
    const correlation = validCorrelation(vectorA, vectorB);
    output.push({
      指标: metric.label,
      来源A: sourceA, A组类型: cohortFor(sourceA),
      来源B: sourceB, B组类型: cohortFor(sourceB),
      有效情绪数: pairs.length,
      A跨情绪均值: round(mean(vectorA), 6),
      B跨情绪均值: round(mean(vectorB), 6),
      A减B平均差: round(mean(differences), 6),
      平均绝对差_MAE: round(mean(differences.map(Math.abs)), 6),
      情绪轮廓Pearson_r: Number.isFinite(correlation) ? round(correlation, 6) : null,
    });
  })));
  return {
    id: "task-cross-groups", title: "双向整合八组两两比较", kind: "matrix", rows: output,
    summary: [{ label: "组数", value: String(sources.length) }, { label: "组对", value: String(sources.length * (sources.length - 1) / 2) }, { label: "指标", value: String(metrics.length) }],
    note: "把4个人类组和4个AI组保留为8个独立组，对全部28个组对比较20情绪双向指标轮廓，输出组间平均差、MAE与Pearson相关。人类/AI仅作为组标签，不在本分析中合并。由于双向指标已是组级聚合，结果按描述性来源比较解释，不伪造参与者级显著性。",
  };
}

function finiteExportNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toCsv(rows: ExportRow[]) {
  if (!rows.length) return ""; const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))]; const escape=(value:unknown)=>{const string=value==null?"":String(value);return /[",\n]/.test(string)?`"${string.replaceAll('"','""')}"`:string;}; return `\uFEFF${columns.map(escape).join(",")}\n${rows.map(row=>columns.map(column=>escape(row[column])).join(",")).join("\n")}`;
}
