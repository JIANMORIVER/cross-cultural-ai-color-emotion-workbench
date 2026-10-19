import { EXPERIMENT_EMOTIONS } from "./prompts";

type JsonRecord = Record<string, unknown>;

function extractBalancedJson(text: string): unknown {
  const source = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!source) throw new Error("模型响应为空。");

  try {
    return JSON.parse(source);
  } catch {
    // Continue with a bounded scan so harmless prose/code fences do not discard a valid answer.
  }

  const candidates: unknown[] = [];
  for (let start = 0; start < source.length; start += 1) {
    const opening = source[start];
    if (opening !== "{" && opening !== "[") continue;
    const closing = opening === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === opening) depth += 1;
      if (character === closing) depth -= 1;
      if (depth === 0) {
        try {
          candidates.push(JSON.parse(source.slice(start, index + 1)));
        } catch {
          // Ignore malformed candidates and continue scanning.
        }
        start = index;
        break;
      }
    }
  }

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new Error("模型响应包含多个 JSON 候选，无法确定哪一个是正式回答。");
  throw new Error("模型响应不是可读取的 JSON。");
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function findHexCandidate(value: unknown, emotion: string) {
  const root = asRecord(value);
  if (!root) return "";
  const nestedCandidates = [
    root,
    asRecord(root[emotion]),
    asRecord(root.color),
    asRecord(root.colour),
    asRecord(root.response),
    asRecord(root.answer),
  ].filter((candidate): candidate is JsonRecord => Boolean(candidate));

  for (const candidate of nestedCandidates) {
    const raw = candidate.hex ?? candidate.HEX ?? candidate.Hex;
    if (typeof raw === "string") return raw.trim();
  }
  return "";
}

function normalizeHex(raw: string) {
  const compact = raw.replace(/\s+/g, "");
  const withHash = compact.startsWith("#") ? compact : `#${compact}`;
  if (!/^#[0-9A-F]{6}$/i.test(withHash)) {
    throw new Error("模型没有返回有效的六位 sRGB HEX 色值。");
  }
  return withHash.toUpperCase();
}

function hexToHsl(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    h: Math.round(hue * 100) / 100,
    s: Math.round(saturation * 10000) / 100,
    l: Math.round(lightness * 10000) / 100,
    hex,
  };
}

export function parseColorResponse(content: string, emotion: string) {
  const parsed = extractBalancedJson(content);
  return hexToHsl(normalizeHex(findHexCandidate(parsed, emotion)));
}

export function parseColorBatchResponse(content: string, emotions: readonly string[]) {
  const root = asRecord(extractBalancedJson(content));
  if (!root) throw new Error("整组词选色回答必须为 JSON 对象。");
  const canonical = new Map(emotions.map(emotion => [emotion.toLowerCase(), emotion]));
  const answers = new Map<string, ReturnType<typeof hexToHsl>>();
  for (const [key, value] of Object.entries(root)) {
    const emotion = canonical.get(key.trim().toLowerCase());
    if (!emotion) throw new Error(`整组词选色出现未请求的情绪：${key}。`);
    if (answers.has(emotion)) throw new Error(`整组词选色重复回答：${emotion}。`);
    answers.set(emotion, hexToHsl(normalizeHex(findHexCandidate(value, emotion))));
  }
  const missing = emotions.filter(emotion => !answers.has(emotion));
  if (missing.length) throw new Error(`整组词选色缺少 ${missing.length} 个情绪：${missing.join(", ")}。`);
  return emotions.map(emotion => ({ emotion, color: answers.get(emotion)! }));
}

function associationSource(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  const object = asRecord(value);
  if (!object) return value;
  if (Array.isArray(object.associations)) return object.associations;
  if (object.scores && asRecord(object.scores)) return object.scores;
  return object;
}

function normalizedIntensity(value: unknown, emotion: string) {
  const numeric = typeof value === "string" && value.trim() ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
    throw new Error(`${emotion} 的强度必须是 1–5 的整数。`);
  }
  return numeric;
}

export function parseAssociationResponse(content: string) {
  const source = associationSource(extractBalancedJson(content));
  const canonical = new Map(EXPERIMENT_EMOTIONS.map(emotion => [emotion.toLowerCase(), emotion]));
  const entries = Array.isArray(source)
    ? source
    : asRecord(source)
      ? Object.entries(source).map(([emotion, intensity]) => ({ emotion, intensity }))
      : [];

  if (entries.length < 1 || entries.length > EXPERIMENT_EMOTIONS.length) {
    throw new Error("关联结果必须包含 1–20 个情绪。");
  }

  const used = new Map<string, number>();
  for (const value of entries) {
    if (!value || typeof value !== "object") throw new Error("情绪关联项格式无效。");
    const item = value as JsonRecord;
    const emotionText = String(item.emotion ?? "").trim();
    const emotion = canonical.get(emotionText.toLowerCase());
    if (!emotion) throw new Error(`出现词表之外的情绪：${emotionText || "空值"}`);
    const intensity = normalizedIntensity(item.intensity, emotion);
    const previous = used.get(emotion);
    if (previous !== undefined && previous !== intensity) throw new Error(`情绪 ${emotion} 出现冲突强度。`);
    used.set(emotion, intensity);
  }

  return {
    associations: [...used.entries()].map(([emotion, intensity]) => ({ emotion, intensity })),
  };
}

export type AssociationParseFormat = "object-array" | "score-map" | "root-score-fields";

export function parseAssociationResponseWithProvenance(content: string) {
  const clean = parseAssociationResponse(content);
  const parsed = extractBalancedJson(content);
  const record = asRecord(parsed);
  const format: AssociationParseFormat = Array.isArray(parsed) || Array.isArray(record?.associations)
    ? "object-array"
    : record?.scores && asRecord(record.scores)
      ? "score-map"
      : "root-score-fields";
  return { clean, format };
}

export function parseRatingVectorResponse(content: string) {
  const parsed = asRecord(extractBalancedJson(content));
  if (!parsed) throw new Error("新版色选词回答必须是 JSON 对象。");
  if (Object.prototype.hasOwnProperty.call(parsed, "ratings")) throw new Error("新版色选词必须是顶层 20 键对象，不能使用 ratings 包装层。");
  const canonical = new Map(EXPERIMENT_EMOTIONS.map(emotion => [emotion.toLowerCase(), emotion]));
  const keys = Object.keys(parsed);
  const unknown = keys.filter(key => !canonical.has(key.toLowerCase()));
  const missing = EXPERIMENT_EMOTIONS.filter(emotion => !keys.some(key => key.toLowerCase() === emotion.toLowerCase()));
  if (unknown.length || missing.length || keys.length !== EXPERIMENT_EMOTIONS.length) {
    throw new Error(`新版色选词必须完整返回 20 个固定情绪键；缺失 ${missing.length}，额外 ${unknown.length}。`);
  }
  const associations: Array<{ emotion: string; intensity: number }> = [];
  for (const [rawEmotion, rawIntensity] of Object.entries(parsed)) {
    const emotion = canonical.get(rawEmotion.toLowerCase());
    if (!emotion) continue;
    if (typeof rawIntensity !== "number" || !Number.isInteger(rawIntensity) || rawIntensity < 0 || rawIntensity > 5) throw new Error(`${emotion} 必须是 0–5 的整数编码。`);
    if (rawIntensity > 0) associations.push({ emotion, intensity: rawIntensity });
  }
  if (!associations.length) throw new Error("新版色选词至少需要一个 1–5 的有效关联。");
  associations.sort((a, b) => EXPERIMENT_EMOTIONS.indexOf(a.emotion as typeof EXPERIMENT_EMOTIONS[number]) - EXPERIMENT_EMOTIONS.indexOf(b.emotion as typeof EXPERIMENT_EMOTIONS[number]));
  return { associations };
}

export function parseAssociationBatchResponse(content: string, colorIds: readonly string[]) {
  const root = asRecord(extractBalancedJson(content));
  if (!root) throw new Error("整组色选词回答必须为 JSON 对象。");
  const canonical = new Map(colorIds.map(colorId => [colorId.toLowerCase(), colorId]));
  const answers = new Map<string, ReturnType<typeof parseAssociationResponse>>();
  for (const [key, value] of Object.entries(root)) {
    const colorId = canonical.get(key.trim().toLowerCase());
    if (!colorId) throw new Error(`整组色选词出现未请求的颜色：${key}。`);
    if (answers.has(colorId)) throw new Error(`整组色选词重复回答：${colorId}。`);
    answers.set(colorId, parseAssociationResponse(JSON.stringify(value)));
  }
  const missing = colorIds.filter(colorId => !answers.has(colorId));
  if (missing.length) throw new Error(`整组色选词缺少 ${missing.length} 个颜色：${missing.join(", ")}。`);
  return colorIds.map(colorId => ({ colorId, association: answers.get(colorId)! }));
}

export function parseRatingVectorBatchResponse(content: string, colorIds: readonly string[]) {
  const root = asRecord(extractBalancedJson(content));
  if (!root) throw new Error("整组色选词回答必须为 JSON 对象。");
  const canonical = new Map(colorIds.map(colorId => [colorId.toLowerCase(), colorId]));
  const answers = new Map<string, ReturnType<typeof parseRatingVectorResponse>>();
  for (const [key, value] of Object.entries(root)) {
    const colorId = canonical.get(key.trim().toLowerCase());
    if (!colorId) throw new Error(`整组色选词出现未请求的颜色：${key}。`);
    if (answers.has(colorId)) throw new Error(`整组色选词重复回答：${colorId}。`);
    answers.set(colorId, parseRatingVectorResponse(JSON.stringify(value)));
  }
  const missing = colorIds.filter(colorId => !answers.has(colorId));
  if (missing.length || Object.keys(root).length !== colorIds.length) {
    throw new Error(`整组色选词必须完整返回 ${colorIds.length} 个颜色；缺少 ${missing.length} 个。`);
  }
  return colorIds.map(colorId => ({ colorId, association: answers.get(colorId)! }));
}
