export type RandomnessPolicy = {
  prompt_seed_enabled: number | boolean;
  prompt_seed_base: number;
  native_seed_enabled: number | boolean;
  prompt_variants_enabled: number | boolean;
};

const PROMPT_VARIANTS = [
  "Respond using only the requested JSON structure.",
  "Return exactly one valid JSON object and no explanatory text.",
  "Provide the answer as strict JSON without markdown or commentary.",
] as const;

function enabled(value: number | boolean) {
  return value === true || value === 1;
}

export function trialSeed(baseSeed: number, runIndex: number, stimulusIndex: number) {
  return Math.abs((Math.trunc(baseSeed) + runIndex * 1009 + stimulusIndex * 9176) % 2147483647);
}

export function seededShuffle<T>(items: readonly T[], seed: number) {
  const result = [...items];
  let state = Math.max(1, Math.abs(Math.trunc(seed)) % 2147483647);
  const random = () => {
    state = state * 16807 % 2147483647;
    return (state - 1) / 2147483646;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function applyRandomnessPolicy(
  prompt: string,
  policy: RandomnessPolicy,
  runIndex: number,
  stimulusIndex: number,
  modelSupportsSeed: number | boolean,
) {
  const seed = trialSeed(policy.prompt_seed_base, runIndex, stimulusIndex);
  const parts = [prompt];
  let promptVariant = "固定模板";

  if (enabled(policy.prompt_variants_enabled)) {
    promptVariant = PROMPT_VARIANTS[seed % PROMPT_VARIANTS.length];
    parts.push(promptVariant);
  }
  if (enabled(policy.prompt_seed_enabled)) parts.push(`Random seed tag: ${seed}`);

  return {
    prompt: parts.join("\n\n"),
    promptSeed: enabled(policy.prompt_seed_enabled) ? seed : null,
    nativeSeed: enabled(policy.native_seed_enabled) && enabled(modelSupportsSeed) ? seed : null,
    promptVariant,
    nativeSeedSupported: enabled(modelSupportsSeed),
  };
}
