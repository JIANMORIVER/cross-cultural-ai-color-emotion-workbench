import { seededShuffle, trialSeed, type RandomnessPolicy } from "./randomness";

export const EXPERIMENT_EMOTIONS = [
  "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
  "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
] as const;

export const EXPERIMENT_COLORS = [
  ["J0", "#262626"], ["A0", "#F2F2F2"], ["G3", "#BB1F23"], ["F17", "#00904A"], ["C9", "#FFBC00"],
  ["F29", "#007FD3"], ["I6", "#4B2819"], ["H35", "#6F2A78"], ["D38", "#F38EBB"], ["F4", "#DD4200"], ["F0", "#808080"],
] as const;

export type OrderPolicy = RandomnessPolicy & {
  shuffle_emotion_order: number | boolean;
  shuffle_color_order: number | boolean;
  shuffle_emotion_options: number | boolean;
};

function enabled(value: number | boolean) {
  return value === true || value === 1;
}

export function experimentOrders(policy: OrderPolicy, runIndex: number) {
  const emotionSeed = trialSeed(policy.prompt_seed_base, runIndex, 101);
  const colorSeed = trialSeed(policy.prompt_seed_base, runIndex, 202);
  return {
    emotions: enabled(policy.shuffle_emotion_order) ? seededShuffle(EXPERIMENT_EMOTIONS, emotionSeed) : [...EXPERIMENT_EMOTIONS],
    colors: enabled(policy.shuffle_color_order) ? seededShuffle(EXPERIMENT_COLORS, colorSeed) : [...EXPERIMENT_COLORS],
    emotionSeed,
    colorSeed,
  };
}

export function buildWordToColorPrompt(emotion: string) {
  return `You are participating in an emotion-color association experiment.
For the English emotion word "${emotion}", choose the single sRGB color you most intuitively associate with it.
Return exactly one JSON object with the model's original color fields in this structure:
{"h": 0, "s": 0, "l": 0, "hex": "#000000"}
h must be 0-360; s and l must be 0-100. Do not add markdown or commentary.`;
}

export function buildColorToEmotionPrompt(colorId: string, hex: string, policy: OrderPolicy, runIndex: number, stimulusIndex: number) {
  const optionSeed = trialSeed(policy.prompt_seed_base, runIndex, 303 + stimulusIndex);
  const emotionOptions = enabled(policy.shuffle_emotion_options)
    ? seededShuffle(EXPERIMENT_EMOTIONS, optionSeed)
    : [...EXPERIMENT_EMOTIONS];
  return {
    prompt: `You are participating in an emotion-color association experiment.
Evaluate the anonymous color ${colorId} with sRGB HEX ${hex}.

Choose any subset of the 20 emotion terms below that you associate with this color. You may select only some terms or all 20 terms. Do not include an emotion when you perceive no meaningful association.
For every selected emotion, assign an integer intensity from 1 to 5:
1 = very weak, 2 = weak, 3 = moderate, 4 = strong, 5 = very strong.

Emotion terms (order is randomized and has no meaning):
${emotionOptions.join(", ")}

Return exactly one JSON object in this structure:
{"associations":[{"emotion":"Joy","intensity":5}]}
Use only the listed English emotion terms. Include at least one association. Do not add markdown or commentary.`,
    emotionOptions,
    optionSeed,
  };
}
