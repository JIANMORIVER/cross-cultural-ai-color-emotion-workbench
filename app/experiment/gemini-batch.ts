import { applyRandomnessPolicy, type RandomnessPolicy } from "./randomness";
import {
  buildColorToEmotionBatchPrompt,
  buildWordToColorBatchPrompt,
  experimentOrders,
  EXPERIMENT_COLORS,
  EXPERIMENT_EMOTIONS,
  type OrderPolicy,
} from "./prompts";

export const GEMINI_WORD_GROUP_ID = "__WORD_GROUP__";
export const GEMINI_COLOR_GROUP_ID = "__COLOR_GROUP__";

export type GeminiBatchModel = {
  id: string;
  alias: string;
  model_id: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  supports_seed: number | boolean;
};

export type GeminiBatchSettings = OrderPolicy & RandomnessPolicy & {
  run_word_to_color: number | boolean;
  run_color_to_emotion: number | boolean;
  max_retry?: number;
};

export type GeminiBatchTrial = {
  task: "word" | "color";
  runIndex: number;
  stimulusId: string;
  stimulusHex: string;
  stimulusIndex: number;
  prompt: string;
};

function enabled(value: number | boolean) {
  return value === true || value === 1;
}

export function buildGeminiBatchTrials(settings: GeminiBatchSettings, firstRunIndex: number, rounds: number) {
  const trials: GeminiBatchTrial[] = [];
  for (let offset = 0; offset < rounds; offset += 1) {
    const runIndex = firstRunIndex + offset;
    const orders = experimentOrders(settings, runIndex);
    if (enabled(settings.run_word_to_color)) {
      const basePrompt = buildWordToColorBatchPrompt(orders.emotions);
      const policy = applyRandomnessPolicy(basePrompt, settings, runIndex, 0, false);
      trials.push({
        task: "word",
        runIndex,
        stimulusId: GEMINI_WORD_GROUP_ID,
        stimulusHex: "",
        stimulusIndex: 0,
        prompt: policy.prompt,
      });
    }
    if (enabled(settings.run_color_to_emotion)) {
      const colors = orders.colors.map(([stimulusId, stimulusHex], stimulusIndex) => ({ stimulusId, stimulusHex, stimulusIndex }));
      const basePrompt = buildColorToEmotionBatchPrompt(colors, settings, runIndex, "rating-vector").prompt;
      const policy = applyRandomnessPolicy(basePrompt, settings, runIndex, 1, false);
      trials.push({
        task: "color",
        runIndex,
        stimulusId: GEMINI_COLOR_GROUP_ID,
        stimulusHex: "",
        stimulusIndex: 1,
        prompt: policy.prompt,
      });
    }
  }
  return trials;
}

function emotionOrderFromPrompt(prompt: string) {
  const match = prompt.match(/Emotion terms \(order is randomized and has no meaning\):\s*\n([^\n]+)/);
  const parsed = match?.[1]?.split(",").map(value => value.trim()).filter(value => EXPERIMENT_EMOTIONS.includes(value as typeof EXPERIMENT_EMOTIONS[number])) || [];
  return parsed.length === EXPERIMENT_EMOTIONS.length && new Set(parsed).size === EXPERIMENT_EMOTIONS.length
    ? parsed
    : [...EXPERIMENT_EMOTIONS];
}

function legacyResponseJsonSchema(trial: GeminiBatchTrial) {
  if (trial.task === "word") {
    return {
      type: "object",
      properties: { hex: { type: "string", description: "A 6-digit sRGB HEX color beginning with #" } },
      required: ["hex"],
      additionalProperties: false,
    };
  }
  const emotionOrder = emotionOrderFromPrompt(trial.prompt);
  return {
    type: "object",
    properties: Object.fromEntries(emotionOrder.map(emotion => [emotion, {
      type: "integer", enum: [0, 1, 2, 3, 4, 5], minimum: 0, maximum: 5,
    }])),
    required: emotionOrder,
    additionalProperties: false,
  };
}

function groupedWordOrderFromPrompt(prompt: string) {
  const matches = [...prompt.matchAll(/^\d+\.\s+([A-Za-z]+)\s*$/gm)].map(match => match[1]);
  return matches.length === EXPERIMENT_EMOTIONS.length && new Set(matches).size === EXPERIMENT_EMOTIONS.length
    ? matches
    : [...EXPERIMENT_EMOTIONS];
}

function groupedColorOrdersFromPrompt(prompt: string) {
  const sections = [...prompt.matchAll(/^\d+\.\s+([A-Z]\d+)\s+·[^\n]*\n\s+Emotion terms:\s*([^\n]+)/gm)];
  if (sections.length !== EXPERIMENT_COLORS.length) return null;
  const parsed = sections.map(match => ({
    colorId: match[1],
    emotions: match[2].split(",").map(value => value.trim()),
  }));
  const validColors = new Set(parsed.map(value => value.colorId)).size === EXPERIMENT_COLORS.length;
  const validEmotions = parsed.every(value => value.emotions.length === EXPERIMENT_EMOTIONS.length
    && new Set(value.emotions).size === EXPERIMENT_EMOTIONS.length);
  return validColors && validEmotions ? parsed : null;
}

function responseJsonSchema(trial: GeminiBatchTrial) {
  const grouped = trial.stimulusId === GEMINI_WORD_GROUP_ID || trial.stimulusId === GEMINI_COLOR_GROUP_ID;
  if (!grouped) return legacyResponseJsonSchema(trial);
  if (trial.task === "word") {
    const emotionOrder = groupedWordOrderFromPrompt(trial.prompt);
    return {
      type: "object",
      properties: Object.fromEntries(emotionOrder.map(emotion => [emotion, {
        type: "object",
        properties: { hex: { type: "string", description: "A 6-digit sRGB HEX color beginning with #" } },
        required: ["hex"],
        additionalProperties: false,
      }])),
      required: emotionOrder,
      additionalProperties: false,
    };
  }
  const parsedOrders = groupedColorOrdersFromPrompt(trial.prompt)
    || EXPERIMENT_COLORS.map(([colorId]) => ({ colorId, emotions: [...EXPERIMENT_EMOTIONS] }));
  return {
    type: "object",
    properties: Object.fromEntries(parsedOrders.map(({ colorId, emotions }) => [colorId, {
      type: "object",
      properties: Object.fromEntries(emotions.map(emotion => [emotion, {
        type: "integer",
        enum: [0, 1, 2, 3, 4, 5],
        minimum: 0,
        maximum: 5,
        description: "0 means not selected; 1–5 is association intensity",
      }])),
      required: emotions,
      additionalProperties: false,
    }])),
    required: parsedOrders.map(({ colorId }) => colorId),
    additionalProperties: false,
  };
}

export function buildGeminiNativeBatchRequest(model: GeminiBatchModel, trial: GeminiBatchTrial) {
  return {
    contents: [{ role: "user", parts: [{ text: trial.prompt }] }],
    generationConfig: {
      temperature: 1,
      topP: 1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseJsonSchema: responseJsonSchema(trial),
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

export function estimateBatchInputTokens(trials: GeminiBatchTrial[]) {
  const promptCharacters = trials.reduce((sum, trial) => sum + trial.prompt.length, 0);
  const schemaAndEnvelopeAllowance = trials.length * 220;
  return Math.ceil(promptCharacters / 4 + schemaAndEnvelopeAllowance);
}
