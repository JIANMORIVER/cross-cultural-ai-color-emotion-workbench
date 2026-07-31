import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  researcher: text("researcher").notNull(),
  description: text("description").notNull(),
  experimentVersion: text("experiment_version").notNull(),
  emotionListVersion: text("emotion_list_version").notNull(),
  colorListVersion: text("color_list_version").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const modelConfigs = sqliteTable("model_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  alias: text("alias").notNull(),
  modelId: text("model_id").notNull(),
  baseUrl: text("base_url").notNull(),
  apiFormat: text("api_format").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  temperature: real("temperature").notNull(),
  topP: real("top_p").notNull(),
  supportsSeed: integer("supports_seed", { mode: "boolean" }).notNull(),
  supportsJson: integer("supports_json", { mode: "boolean" }).notNull(),
  rateLimit: integer("rate_limit").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  lastTestStatus: text("last_test_status").notNull(),
  latencyMs: integer("latency_ms"),
});

export const experimentSettings = sqliteTable("experiment_settings", {
  projectId: text("project_id").primaryKey(),
  repetitions: integer("repetitions").notNull(),
  runWordToColor: integer("run_word_to_color", { mode: "boolean" }).notNull(),
  runColorToEmotion: integer("run_color_to_emotion", { mode: "boolean" }).notNull(),
  concurrency: integer("concurrency").notNull(),
  maxRetry: integer("max_retry").notNull(),
  timeoutSeconds: integer("timeout_seconds").notNull(),
  saveRaw: integer("save_raw", { mode: "boolean" }).notNull(),
  promptSeedEnabled: integer("prompt_seed_enabled", { mode: "boolean" }).notNull().default(false),
  promptSeedBase: integer("prompt_seed_base").notNull().default(20260715),
  nativeSeedEnabled: integer("native_seed_enabled", { mode: "boolean" }).notNull().default(false),
  promptVariantsEnabled: integer("prompt_variants_enabled", { mode: "boolean" }).notNull().default(false),
  modelScope: text("model_scope").notNull().default("all"),
  singleModelId: text("single_model_id").notNull().default("model-gpt"),
  modelSlotIds: text("model_slot_ids").notNull().default('["model-gpt"]'),
  shuffleEmotionOrder: integer("shuffle_emotion_order", { mode: "boolean" }).notNull().default(true),
  shuffleColorOrder: integer("shuffle_color_order", { mode: "boolean" }).notNull().default(true),
  shuffleEmotionOptions: integer("shuffle_emotion_options", { mode: "boolean" }).notNull().default(true),
});

export const trialResults = sqliteTable("trial_results", {
  trialId: text("trial_id").primaryKey(),
  projectId: text("project_id").notNull(),
  modelId: text("model_id").notNull(),
  modelAlias: text("model_alias").notNull(),
  taskType: text("task_type").notNull(),
  runIndex: integer("run_index").notNull(),
  stimulusId: text("stimulus_id").notNull(),
  cleanJson: text("clean_json").notNull(),
  rawResponse: text("raw_response").notNull(),
  validationStatus: text("validation_status").notNull(),
  retryCount: integer("retry_count").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: text("created_at").notNull(),
});

export const trialAttempts = sqliteTable("trial_attempts", {
  attemptId: text("attempt_id").primaryKey(),
  logicalTrialId: text("logical_trial_id").notNull(),
  projectId: text("project_id").notNull(),
  modelId: text("model_id").notNull(),
  modelAlias: text("model_alias").notNull(),
  taskType: text("task_type").notNull(),
  runIndex: integer("run_index").notNull(),
  stimulusId: text("stimulus_id").notNull(),
  attemptNo: integer("attempt_no").notNull(),
  status: text("status").notNull(),
  httpStatus: integer("http_status"),
  retryable: integer("retryable", { mode: "boolean" }).notNull(),
  errorMessage: text("error_message").notNull(),
  rawResponse: text("raw_response").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: text("created_at").notNull(),
});

export const trialManifest = sqliteTable("trial_manifest", {
  logicalTrialId: text("logical_trial_id").primaryKey(),
  batchId: text("batch_id").notNull(),
  projectId: text("project_id").notNull(),
  modelId: text("model_id").notNull(),
  modelAlias: text("model_alias").notNull(),
  taskType: text("task_type").notNull(),
  runIndex: integer("run_index").notNull(),
  stimulusId: text("stimulus_id").notNull(),
  stimulusHex: text("stimulus_hex").notNull(),
  stimulusIndex: integer("stimulus_index").notNull(),
  modelJson: text("model_json").notNull(),
  settingsJson: text("settings_json").notNull(),
  maxRetryCount: integer("max_retry_count").notNull(),
  createdAt: text("created_at").notNull(),
  repairAttemptedAt: text("repair_attempted_at"),
  completedAt: text("completed_at"),
});

export const appMigrations = sqliteTable("app_migrations", {
  id: text("id").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});
