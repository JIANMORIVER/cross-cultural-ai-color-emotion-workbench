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
Return exactly one JSON object in this structure:
{"hex":"#000000"}
The value must be a six-digit sRGB HEX color. Do not add markdown or commentary.`;
}

/** One complete Task 1 round.  The supplied order is intentionally retained in
 * the prompt so that the configured question randomisation remains effective. */
export function buildWordToColorBatchPrompt(emotions: readonly string[]) {
  return `You are participating in an emotion-color association experiment.
Complete all 20 questions below independently. For every English emotion word, choose the single sRGB color you most intuitively associate with it.

Emotion words (this order is randomized and has no meaning):
${emotions.map((emotion, index) => `${index + 1}. ${emotion}`).join("\n")}

Return exactly one JSON object. Its keys must be the exact emotion words above; every value must contain one six-digit sRGB HEX color:
{"Interest":{"hex":"#000000"},"Joy":{"hex":"#FFFFFF"}}
Include every listed emotion exactly once. Do not add markdown, explanations, or other text.`;
}

export function buildColorToEmotionPrompt(colorId: string, hex: string, policy: OrderPolicy, runIndex: number, stimulusIndex: number, outputFormat: "association-list" | "score-map" | "rating-vector" = "association-list") {
  const optionSeed = trialSeed(policy.prompt_seed_base, runIndex, 303 + stimulusIndex);
  const emotionOptions = enabled(policy.shuffle_emotion_options)
    ? seededShuffle(EXPERIMENT_EMOTIONS, optionSeed)
    : [...EXPERIMENT_EMOTIONS];
  const outputInstruction = outputFormat === "rating-vector"
    ? `Return exactly one flat JSON object with the 20 emotion terms as its top-level keys. Every key is mandatory; do not wrap them in another object.
For each emotion use one integer: 0 = not selected / no meaningful association; 1–5 = the selected association intensity defined above.
Do not return a "ratings" wrapper, arrays, null, booleans, labels, explanations, or omit any emotion key.`
    : outputFormat === "score-map"
      ? `Return exactly one JSON object whose "scores" object maps each selected emotion to its integer intensity:
{"scores":{"Joy":5,"Pleasure":4}}`
      : `Return exactly one JSON object in this structure:
{"associations":[{"emotion":"Joy","intensity":5}]}`;
  return {
    prompt: `You are participating in an emotion-color association experiment.
Evaluate the anonymous color ${colorId} with sRGB HEX ${hex}.

Choose any subset of the 20 emotion terms below that you associate with this color. You may select only some terms or all 20 terms. Do not include an emotion when you perceive no meaningful association.
For every selected emotion, assign an integer intensity from 1 to 5:
1 = very weak, 2 = weak, 3 = moderate, 4 = strong, 5 = very strong.

Emotion terms (order is randomized and has no meaning):
${emotionOptions.join(", ")}

${outputInstruction}
Use only the listed English emotion terms. At least one emotion must have a 1–5 association. Do not add markdown or commentary.`,
    emotionOptions,
    optionSeed,
  };
}

/** One complete Task 2 round.  Each colour has its own shuffled emotion list. */
export function buildColorToEmotionBatchPrompt(
  colors: ReadonlyArray<{ stimulusId: string; stimulusHex: string; stimulusIndex: number }>,
  policy: OrderPolicy,
  runIndex: number,
  outputFormat: "association-list" | "rating-vector" = "association-list",
) {
  const questions = colors.map(color => {
    const optionSeed = trialSeed(policy.prompt_seed_base, runIndex, 303 + color.stimulusIndex);
    const emotionOptions = enabled(policy.shuffle_emotion_options)
      ? seededShuffle(EXPERIMENT_EMOTIONS, optionSeed)
      : [...EXPERIMENT_EMOTIONS];
    return { ...color, emotionOptions };
  });
  const outputInstruction = outputFormat === "rating-vector"
    ? `Return exactly one JSON object. Its keys must be the exact colour IDs above. Every colour value must be a flat object containing all 20 emotion terms as mandatory keys. For each emotion use one integer only: 0 = not selected / no meaningful association; 1–5 = selected association intensity.
Example shape: {"J0":{"Interest":0,"Joy":5},"A0":{"Interest":2,"Joy":0}}.
The example is abbreviated only to illustrate nesting; your actual answer must include every listed colour and all 20 fixed emotion keys for each colour. Do not use associations arrays, a ratings wrapper, null, booleans, or omitted keys.`
    : `Return exactly one JSON object. Its keys must be the exact colour IDs above. Every value must contain an associations array:
{"J0":{"associations":[{"emotion":"Joy","intensity":5}]},"A0":{"associations":[{"emotion":"Sadness","intensity":2}]}}`;
  return {
    prompt: `You are participating in an emotion-color association experiment.
Complete all 11 anonymous colour questions below independently. For each colour, choose any subset of the listed emotion terms that you meaningfully associate with it. You may choose only some terms or all 20. For every selected term assign an integer intensity: 1 = very weak, 2 = weak, 3 = moderate, 4 = strong, 5 = very strong.

Colour questions (this order is randomized and has no meaning):
${questions.map((color, index) => `${index + 1}. ${color.stimulusId} · sRGB HEX ${color.stimulusHex}\n   Emotion terms: ${color.emotionOptions.join(", ")}`).join("\n\n")}

${outputInstruction}
Use only the listed English emotion terms, include every colour ID exactly once, and include at least one association for each colour. Do not add markdown, explanations, or other text.`,
    optionSeeds: questions.map(question => ({ colorId: question.stimulusId, optionSeed: trialSeed(policy.prompt_seed_base, runIndex, 303 + question.stimulusIndex) })),
  };
}
