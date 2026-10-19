import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

async function loadExperimentModules() {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const [batch, parser, prompts, sourceExport, modelRequest] = await Promise.all([
      vite.ssrLoadModule("/app/experiment/gemini-batch.ts"),
      vite.ssrLoadModule("/app/experiment/response-parser.ts"),
      vite.ssrLoadModule("/app/experiment/prompts.ts"),
      vite.ssrLoadModule("/app/export/source-export.ts"),
      vite.ssrLoadModule("/app/experiment/model-request.ts"),
    ]);
    return { batch, parser, prompts, sourceExport, modelRequest };
  } finally {
    await vite.close();
  }
}

test("Gemini realtime uses native generateContent with native schema and response parsing", async () => {
  const { modelRequest, prompts } = await loadExperimentModules();
  const model = {
    model_id: "gemini-3.1-pro-preview",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    max_tokens: 2048,
    temperature: 1,
    top_p: 1,
    supports_json: true,
  };
  assert.equal(
    modelRequest.modelEndpoint(model),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
  );
  const headers = modelRequest.modelHeaders(model, "test-key");
  assert.equal(headers["x-goog-api-key"], "test-key");
  assert.equal(headers.Authorization, undefined);
  const request = modelRequest.buildModelRequest(
    model,
    "grouped prompt",
    "word-batch",
    null,
    prompts.EXPERIMENT_EMOTIONS,
  );
  assert.equal(request.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(request.generationConfig.responseJsonSchema, undefined);
  assert.equal(modelRequest.modelResponseText(model.model_id, {
    candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: '{"Interest":{"hex":"#112233"}}' }] } }],
  }), '{"Interest":{"hex":"#112233"}}');
});

test("Gemini Batch v5 sends two complete grouped items per round", async () => {
  const { batch, prompts } = await loadExperimentModules();
  const settings = {
    run_word_to_color: true,
    run_color_to_emotion: true,
    max_retry: 1,
    prompt_seed_enabled: true,
    prompt_seed_base: 20260715,
    native_seed_enabled: false,
    prompt_variants_enabled: false,
    shuffle_emotion_order: true,
    shuffle_color_order: true,
    shuffle_emotion_options: true,
  };
  const trials = batch.buildGeminiBatchTrials(settings, 101, 1);
  assert.equal(trials.length, 2);
  assert.deepEqual(trials.map(trial => trial.stimulusId), ["__WORD_GROUP__", "__COLOR_GROUP__"]);
  const wordTrial = trials.find(trial => trial.task === "word");
  const colorTrial = trials.find(trial => trial.task === "color");
  assert.ok(wordTrial);
  assert.ok(colorTrial);
  const wordRequest = batch.buildGeminiNativeBatchRequest({ model_id: "gemini-3.1-pro-preview" }, wordTrial);
  assert.deepEqual(new Set(wordRequest.generationConfig.responseJsonSchema.required), new Set(prompts.EXPERIMENT_EMOTIONS));
  assert.notDeepEqual(wordRequest.generationConfig.responseJsonSchema.required, [...prompts.EXPERIMENT_EMOTIONS]);
  assert.match(wordRequest.contents[0].parts[0].text, /Complete all 20 questions/);
  const request = batch.buildGeminiNativeBatchRequest({ model_id: "gemini-3.1-pro-preview" }, colorTrial);
  const schema = request.generationConfig.responseJsonSchema;
  assert.equal(schema.required.length, 11);
  assert.deepEqual(new Set(schema.required), new Set(prompts.EXPERIMENT_COLORS.map(([colorId]) => colorId)));
  assert.notDeepEqual(schema.required, prompts.EXPERIMENT_COLORS.map(([colorId]) => colorId));
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  for (const colorId of schema.required) {
    const vector = schema.properties[colorId];
    assert.deepEqual(new Set(vector.required), new Set(prompts.EXPERIMENT_EMOTIONS));
    for (const emotion of vector.required) {
      assert.deepEqual(vector.properties[emotion].enum, [0, 1, 2, 3, 4, 5]);
      assert.equal(vector.properties[emotion].type, "integer");
    }
  }
  assert.match(request.contents[0].parts[0].text, /0 = not selected/);
  assert.doesNotMatch(request.contents[0].parts[0].text, /"associations":\s*\[/);
});

test("Gemini Batch v5 parser validates the complete 11 by 20 matrix", async () => {
  const { parser, prompts } = await loadExperimentModules();
  const ratings = Object.fromEntries(prompts.EXPERIMENT_EMOTIONS.map(emotion => [emotion, 0]));
  ratings.Joy = 5;
  ratings.Relief = 2;
  const parsed = parser.parseRatingVectorResponse(JSON.stringify(ratings));
  assert.deepEqual(parsed, { associations: [
    { emotion: "Joy", intensity: 5 },
    { emotion: "Relief", intensity: 2 },
  ] });

  const missing = { ...ratings };
  delete missing.Anger;
  assert.throws(() => parser.parseRatingVectorResponse(JSON.stringify(missing)), /完整返回 20/);
  assert.throws(() => parser.parseRatingVectorResponse(JSON.stringify({ ...ratings, Joy: true })), /0–5 的整数/);
  assert.throws(() => parser.parseRatingVectorResponse(JSON.stringify(Object.fromEntries(prompts.EXPERIMENT_EMOTIONS.map(emotion => [emotion, 0])))), /至少需要一个/);
  assert.throws(() => parser.parseRatingVectorResponse(JSON.stringify({ ratings })), /顶层 20 键/);

  const matrix = Object.fromEntries(prompts.EXPERIMENT_COLORS.map(([colorId], index) => [colorId, {
    ...ratings,
    Joy: index % 5 + 1,
  }]));
  const grouped = parser.parseRatingVectorBatchResponse(JSON.stringify(matrix), prompts.EXPERIMENT_COLORS.map(([colorId]) => colorId));
  assert.equal(grouped.length, 11);
  assert.equal(grouped[0].association.associations[0].emotion, "Joy");
  const incompleteMatrix = { ...matrix };
  delete incompleteMatrix.F0;
  assert.throws(() => parser.parseRatingVectorBatchResponse(JSON.stringify(incompleteMatrix), prompts.EXPERIMENT_COLORS.map(([colorId]) => colorId)), /完整返回 11/);
});

test("a complete v5 round exports one sample row with all 20 colors and 11 emotion ratings", async () => {
  const { prompts, sourceExport } = await loadExperimentModules();
  const model = {
    id: "model-gemini", provider: "Google", alias: "Gemini", model_id: "gemini-3.1-pro-preview",
    base_url: "https://generativelanguage.googleapis.com/v1beta", api_format: "Gemini",
    max_tokens: 2048, temperature: 1, top_p: 1, supports_seed: false,
    supports_json: true, rate_limit: 8, enabled: true,
  };
  const baseResult = {
    project_id: "ECX-2026-001", model_id: model.id, model_alias: model.alias,
    run_index: 101, validation_status: "Valid", retry_count: 0, latency_ms: 0,
    created_at: "2026-08-04T00:00:00.000Z", collection_mode: "batch", source_job_id: "gb-v3-test",
  };
  const wordResults = prompts.EXPERIMENT_EMOTIONS.map((emotion, index) => ({
    ...baseResult,
    trial_id: `batch-v3-word-${emotion}`,
    task_type: "Word to Color",
    stimulus_id: emotion,
    clean_json: JSON.stringify({ h: index * 10, s: 50, l: 50, hex: "#336699" }),
    raw_response: JSON.stringify({ hex: "#336699" }),
  }));
  const vector = Object.fromEntries(prompts.EXPERIMENT_EMOTIONS.map(emotion => [emotion, emotion === "Joy" ? 5 : 0]));
  const colorResults = prompts.EXPERIMENT_COLORS.map(([colorId]) => ({
    ...baseResult,
    trial_id: `batch-v3-color-${colorId}`,
    task_type: "Color to Emotion",
    stimulus_id: colorId,
    clean_json: JSON.stringify({ associations: [{ emotion: "Joy", intensity: 5 }] }),
    raw_response: JSON.stringify(vector),
  }));
  const payload = {
    project: { id: "ECX-2026-001", name: "test", researcher: "test", description: "", status: "Completed", experiment_version: "v3", emotion_list_version: "v1", color_list_version: "v1" },
    models: [model],
    settings: { repetitions: 100 },
    results: [...wordResults, ...colorResults],
    export_scope: "complete",
  };

  const sampleRows = sourceExport.buildSampleRows(payload, prompts.EXPERIMENT_COLORS);
  assert.equal(sampleRows.length, 1);
  assert.equal(Object.keys(sampleRows[0]).length, sourceExport.SAMPLE_COLUMNS.length);
  for (const [colorId] of prompts.EXPERIMENT_COLORS) {
    assert.deepEqual(JSON.parse(sampleRows[0][`word_data.${colorId}`]), [{ emotion: "Joy", intensity: 5 }]);
  }
  assert.equal(sourceExport.buildWordToColorRows(payload, prompts.EXPERIMENT_EMOTIONS).length, 1);
  assert.equal(sourceExport.buildColorToEmotionRows(payload, prompts.EXPERIMENT_COLORS).length, 11);
  assert.equal(sourceExport.buildColorToEmotionSourceRows(payload, prompts.EXPERIMENT_COLORS).length, 1);
});
