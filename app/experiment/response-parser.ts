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
