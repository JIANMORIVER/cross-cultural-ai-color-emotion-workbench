import { env } from "cloudflare:workers";
import {
  buildGeminiBatchTrials,
  buildGeminiNativeBatchRequest,
  estimateBatchInputTokens,
  GEMINI_COLOR_GROUP_ID,
  GEMINI_WORD_GROUP_ID,
  type GeminiBatchModel,
  type GeminiBatchSettings,
} from "../../experiment/gemini-batch";
import { experimentOrders } from "../../experiment/prompts";
import { parseAssociationResponse, parseAssociationResponseWithProvenance, parseColorBatchResponse, parseColorResponse, parseRatingVectorBatchResponse, parseRatingVectorResponse } from "../../experiment/response-parser";

const PROJECT_ID = "ECX-2026-001";
const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const COLOR_PROTOCOL = "grouped-round-v5";
const LEGACY_VECTOR_PROTOCOL = "rating-vector-v4";
const ACTIVE_STATES = ["SUBMITTING", "JOB_STATE_PENDING", "JOB_STATE_RUNNING", "JOB_STATE_CANCELLING"];

type BatchMode = "pilot" | "formal" | "repair";

type BatchItemRow = {
  item_id: string;
  local_job_id: string;
  request_key: string;
  position: number;
  task_type: string;
  run_index: number;
  stimulus_id: string;
  stimulus_hex: string;
  stimulus_index: number;
  prompt: string;
};

type BatchJobRow = {
  local_id: string;
  google_job_name: string | null;
  mode: BatchMode;
  model_config_id: string;
  model_alias: string;
  model_version: string;
  state: string;
  settings_json: string;
  api_key_fingerprint: string;
  start_run_index: number;
  round_count: number;
};

type RecoveryItemRow = BatchItemRow & {
  raw_response: string;
  previous_error: string;
  item_updated_at: string;
  mode: BatchMode;
  model_config_id: string;
  model_alias: string;
  completed_at: string | null;
};

type GoogleBatchResponse = {
  name?: string;
  state?: string;
  error?: { code?: number; message?: string; status?: string };
  metadata?: {
    state?: string;
    error?: { code?: number; message?: string; status?: string };
    dest?: { inlinedResponses?: unknown; inlined_responses?: unknown };
    endTime?: string;
  };
  dest?: { inlinedResponses?: unknown; inlined_responses?: unknown };
  response?: {
    inlinedResponses?: unknown;
    inlined_responses?: unknown;
    dest?: { inlinedResponses?: unknown; inlined_responses?: unknown };
  };
  createTime?: string;
  endTime?: string;
};

async function ensureBatchSchema() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS gemini_batch_jobs (
      local_id TEXT PRIMARY KEY, google_job_name TEXT UNIQUE, project_id TEXT NOT NULL,
      model_config_id TEXT NOT NULL, model_alias TEXT NOT NULL, model_version TEXT NOT NULL,
      mode TEXT NOT NULL, start_run_index INTEGER NOT NULL, round_count INTEGER NOT NULL,
      request_count INTEGER NOT NULL, estimated_input_tokens INTEGER NOT NULL,
      input_bytes INTEGER NOT NULL, state TEXT NOT NULL, settings_json TEXT NOT NULL,
      api_key_fingerprint TEXT NOT NULL, submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      completed_at TEXT, imported_at TEXT, valid_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0, error_message TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gemini_batch_items (
      item_id TEXT PRIMARY KEY, local_job_id TEXT NOT NULL, request_key TEXT NOT NULL,
      position INTEGER NOT NULL, task_type TEXT NOT NULL, run_index INTEGER NOT NULL,
      stimulus_id TEXT NOT NULL, stimulus_hex TEXT NOT NULL, stimulus_index INTEGER NOT NULL,
      prompt TEXT NOT NULL, status TEXT NOT NULL, clean_json TEXT NOT NULL DEFAULT '',
      raw_response TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
      imported INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(local_job_id, request_key)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_gemini_batch_jobs_state ON gemini_batch_jobs(project_id, state)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_gemini_batch_items_job ON gemini_batch_items(local_job_id, position)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS gemini_batch_recovery_audit (
      item_id TEXT PRIMARY KEY, local_job_id TEXT NOT NULL, task_type TEXT NOT NULL,
      run_index INTEGER NOT NULL, stimulus_id TEXT NOT NULL, previous_error TEXT NOT NULL,
      parser_version TEXT NOT NULL, source_format TEXT NOT NULL, recovered_at TEXT NOT NULL
    )`),
  ]);

  const resultColumns = await db.prepare("PRAGMA table_info(trial_results)").all();
  const names = new Set(resultColumns.results.map(column => String(column.name)));
  if (!names.has("collection_mode")) {
    await db.prepare("ALTER TABLE trial_results ADD COLUMN collection_mode TEXT NOT NULL DEFAULT 'realtime'").run();
  }
  if (!names.has("source_job_id")) {
    await db.prepare("ALTER TABLE trial_results ADD COLUMN source_job_id TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has("protocol_version")) {
    await db.prepare("ALTER TABLE trial_results ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'realtime-v1'").run();
  }
  await db.prepare(`UPDATE trial_results SET protocol_version='legacy-batch-v1'
    WHERE collection_mode='batch' AND protocol_version='realtime-v1'`).run();
  await db.prepare(`UPDATE gemini_batch_jobs
    SET state = 'JOB_STATE_' || SUBSTR(state, LENGTH('BATCH_STATE_') + 1)
    WHERE state LIKE 'BATCH_STATE_%'`).run();
}

function normalizeBatchState(value: string) {
  return value.startsWith("BATCH_STATE_") ? `JOB_STATE_${value.slice("BATCH_STATE_".length)}` : value;
}

function colorProtocol(settingsJson: string) {
  try {
    const snapshot = JSON.parse(settingsJson) as { protocol?: { color_response_schema?: string } };
    return String(snapshot.protocol?.color_response_schema || "legacy");
  } catch {
    return "legacy";
  }
}

function settingsSnapshot(settingsJson: string) {
  try {
    return JSON.parse(settingsJson) as { settings?: GeminiBatchSettings };
  } catch {
    return {};
  }
}

function isGroupedJob(job: Pick<BatchJobRow, "settings_json">, item?: Pick<BatchItemRow, "stimulus_id">) {
  return colorProtocol(job.settings_json) === COLOR_PROTOCOL
    || item?.stimulus_id === GEMINI_WORD_GROUP_ID
    || item?.stimulus_id === GEMINI_COLOR_GROUP_ID;
}

function expandedTrials(trials: ReturnType<typeof buildGeminiBatchTrials>, settings: GeminiBatchSettings) {
  return trials.flatMap(trial => {
    const orders = experimentOrders(settings, trial.runIndex);
    if (trial.task === "word") {
      return orders.emotions.map((emotion, stimulusIndex) => ({
        task: "word" as const,
        runIndex: trial.runIndex,
        stimulusId: emotion,
        stimulusHex: "",
        stimulusIndex,
      }));
    }
    return orders.colors.map(([stimulusId, stimulusHex], stimulusIndex) => ({
      task: "color" as const,
      runIndex: trial.runIndex,
      stimulusId,
      stimulusHex,
      stimulusIndex,
    }));
  });
}

function googleState(payload: GoogleBatchResponse, fallback = "JOB_STATE_PENDING") {
  return normalizeBatchState(String(payload.state || payload.metadata?.state || fallback));
}

function googleError(payload: GoogleBatchResponse, fallback: string) {
  return String(payload.error?.message || payload.metadata?.error?.message || fallback);
}

function inlineResponses(payload: GoogleBatchResponse) {
  const unwrap = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const wrapper = value as { inlinedResponses?: unknown; inlined_responses?: unknown };
    if (Array.isArray(wrapper.inlinedResponses)) return wrapper.inlinedResponses;
    if (Array.isArray(wrapper.inlined_responses)) return wrapper.inlined_responses;
    return [];
  };
  const candidates = [
    payload.dest?.inlinedResponses,
    payload.dest?.inlined_responses,
    payload.metadata?.dest?.inlinedResponses,
    payload.metadata?.dest?.inlined_responses,
    payload.response?.inlinedResponses,
    payload.response?.inlined_responses,
    payload.response?.dest?.inlinedResponses,
    payload.response?.dest?.inlined_responses,
  ];
  for (const candidate of candidates) {
    const responses = unwrap(candidate);
    if (responses.length) return responses;
  }
  return [];
}

function resultText(entry: unknown) {
  const wrapper = (entry || {}) as {
    response?: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  };
  const parts = wrapper.response?.candidates?.[0]?.content?.parts || [];
  return parts.filter(part => !part.thought && typeof part.text === "string").map(part => part.text).join("").trim();
}

function resultKey(entry: unknown) {
  const wrapper = (entry || {}) as {
    metadata?: { key?: string };
    requestMetadata?: { key?: string };
    request_metadata?: { key?: string };
  };
  return String(wrapper.metadata?.key || wrapper.requestMetadata?.key || wrapper.request_metadata?.key || "");
}

function resultError(entry: unknown) {
  const wrapper = (entry || {}) as { error?: { message?: string; code?: number; status?: string } };
  if (!wrapper.error) return "";
  return String(wrapper.error.message || wrapper.error.status || `Batch item error ${wrapper.error.code || ""}`).trim();
}

async function keyFingerprint(apiKey: string) {
  const bytes = new TextEncoder().encode(apiKey.trim());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).slice(0, 8).map(value => value.toString(16).padStart(2, "0")).join("");
}

async function nextFormalRunIndex(modelConfigId: string) {
  const row = await env.DB.prepare(`SELECT COALESCE(MAX(run_index), 0) + 1 AS next_run_index FROM (
    SELECT run_index FROM trial_results
      WHERE project_id = ? AND model_id = ? AND run_index > 0 AND trial_id NOT LIKE 'pilot-%'
    UNION ALL
    SELECT run_index FROM trial_manifest
      WHERE project_id = ? AND model_id = ? AND run_index > 0
  )`).bind(PROJECT_ID, modelConfigId, PROJECT_ID, modelConfigId).first();
  return Math.max(1, Number(row?.next_run_index || 1));
}

async function saveStatements(statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 75) {
    await env.DB.batch(statements.slice(index, index + 75));
  }
}

async function submitBatch(body: {
  apiKey?: string;
  model?: GeminiBatchModel;
  settings?: GeminiBatchSettings;
  mode?: BatchMode;
  rounds?: number;
}) {
  const apiKey = String(body.apiKey || "").trim();
  const model = body.model;
  const settings = body.settings;
  const mode: BatchMode = body.mode === "pilot" ? "pilot" : "formal";
  const requestedRounds = Math.floor(Number(body.rounds || 0));
  const maximumRounds = mode === "pilot" ? 2 : 10;
  const rounds = Math.max(1, Math.min(maximumRounds, requestedRounds));
  if (!apiKey || !model?.id || !settings) {
    return Response.json({ ok: false, message: "提交 Batch 前需要 Gemini API Key、模型和实验设置。" }, { status: 400 });
  }
  if (model.model_id !== "gemini-3.1-pro-preview") {
    return Response.json({ ok: false, message: "Batch 正式通道固定使用 gemini-3.1-pro-preview。" }, { status: 400 });
  }
  if (!(settings.run_word_to_color === true || settings.run_word_to_color === 1)
    || !(settings.run_color_to_emotion === true || settings.run_color_to_emotion === 1)) {
    return Response.json({ ok: false, message: "Batch 每轮必须同时包含 20 条词选色和 11 条色选词。" }, { status: 400 });
  }
  if (mode === "pilot" && requestedRounds !== 2) {
    return Response.json({ ok: false, message: "整组 Batch 必须先完成固定 2 轮（4 个整组 item、覆盖 62 项回答）的格式预检。" }, { status: 400 });
  }

  const fingerprint = await keyFingerprint(apiKey);
  if (mode === "formal") {
    const qualifiedPilot = await env.DB.prepare(`SELECT local_id FROM gemini_batch_jobs
      WHERE project_id=? AND mode='pilot' AND model_version=? AND api_key_fingerprint=?
        AND state='JOB_STATE_SUCCEEDED' AND imported_at IS NOT NULL
        AND request_count=4 AND valid_count=4 AND failed_count=0
        AND settings_json LIKE ?
      ORDER BY imported_at DESC LIMIT 1`).bind(
        PROJECT_ID, model.model_id, fingerprint, `%${COLOR_PROTOCOL}%`,
      ).first();
    if (!qualifiedPilot) {
      return Response.json({
        ok: false,
        code: "BATCH_VECTOR_PILOT_REQUIRED",
        message: "正式 Batch 已锁定：请先用当前项目 Key 完成 2 轮整组试跑，并达到 4/4 个整组 item 全部有效后再提交。",
      }, { status: 409 });
    }
  }

  const firstRunIndex = mode === "formal" ? await nextFormalRunIndex(model.id) : 1;
  const trials = buildGeminiBatchTrials(settings, firstRunIndex, rounds);
  if (trials.length !== rounds * 2) {
    return Response.json({ ok: false, message: "Batch 试次清单不完整，未向 Google 提交。" }, { status: 400 });
  }

  const localId = `gb-${Date.now()}-${crypto.randomUUID()}`;
  const shortId = localId.slice(-12).replaceAll("-", "");
  const displayName = `chromalab-${mode}-${firstRunIndex}-${firstRunIndex + rounds - 1}-${shortId}`;
  const requests = trials.map((trial, position) => ({
    request: buildGeminiNativeBatchRequest(model, trial),
    metadata: { key: `${mode === "pilot" ? "p" : "f"}-${shortId}-${String(position + 1).padStart(4, "0")}` },
  }));
  const requestBody = {
    batch: {
      display_name: displayName,
      input_config: { requests: { requests } },
    },
  };
  const serialized = JSON.stringify(requestBody);
  const inputBytes = new TextEncoder().encode(serialized).byteLength;
  if (inputBytes >= 20 * 1024 * 1024) {
    return Response.json({ ok: false, message: "当前 Batch 超过 20MB Inline 上限，请减少每批轮次。" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const settingsSnapshot = JSON.stringify({
    model,
    settings,
    protocol: {
      inference_mode: "batch",
      temperature: 1,
      top_p: 1,
      max_output_tokens: 2048,
      thinking_level: "low",
      requests_per_complete_round: 2,
      answers_per_complete_round: 31,
      color_response_schema: COLOR_PROTOCOL,
      color_missing_encoding: "0=not-selected;1-5=intensity",
      color_required_keys: 20,
    },
  });
  await env.DB.prepare(`INSERT INTO gemini_batch_jobs (
    local_id, google_job_name, project_id, model_config_id, model_alias, model_version,
    mode, start_run_index, round_count, request_count, estimated_input_tokens,
    input_bytes, state, settings_json, api_key_fingerprint, submitted_at, updated_at,
    completed_at, imported_at, valid_count, failed_count, error_message
  ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?, ?, NULL, NULL, 0, 0, '')`)
    .bind(
      localId, PROJECT_ID, model.id, model.alias, model.model_id, mode, firstRunIndex,
      rounds, trials.length, estimateBatchInputTokens(trials), inputBytes,
      settingsSnapshot, fingerprint, now, now,
    ).run();

  const itemStatements = trials.map((trial, position) => env.DB.prepare(`INSERT INTO gemini_batch_items (
    item_id, local_job_id, request_key, position, task_type, run_index, stimulus_id,
    stimulus_hex, stimulus_index, prompt, status, clean_json, raw_response,
    error_message, imported, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '', '', '', 0, ?, ?)`)
    .bind(
      `${localId}-item-${position + 1}`, localId, requests[position].metadata.key, position,
      trial.task === "word" ? "Word to Color" : "Color to Emotion", trial.runIndex,
      trial.stimulusId, trial.stimulusHex, trial.stimulusIndex, trial.prompt, now, now,
    ));
  await saveStatements(itemStatements);

  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_ROOT}/models/${model.model_id}:batchGenerateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: serialized,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch 提交网络失败。";
    await env.DB.prepare("UPDATE gemini_batch_jobs SET state='SUBMIT_FAILED', error_message=?, updated_at=? WHERE local_id=?")
      .bind(message, new Date().toISOString(), localId).run();
    return Response.json({ ok: false, message, localId }, { status: 503 });
  }
  const payloadText = await response.text();
  let payload: GoogleBatchResponse = {};
  try { payload = JSON.parse(payloadText) as GoogleBatchResponse; } catch { /* keep empty */ }
  if (!response.ok || !payload.name) {
    const message = googleError(payload, `Google Batch API 返回 HTTP ${response.status}`);
    await env.DB.prepare("UPDATE gemini_batch_jobs SET state='SUBMIT_FAILED', error_message=?, updated_at=? WHERE local_id=?")
      .bind(message, new Date().toISOString(), localId).run();
    return Response.json({ ok: false, message, localId, httpStatus: response.status }, { status: response.status || 502 });
  }

  const state = googleState(payload);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`UPDATE gemini_batch_jobs
    SET google_job_name=?, state=?, updated_at=?, error_message=''
    WHERE local_id=?`).bind(payload.name, state, updatedAt, localId).run();

  if (mode === "formal") {
    const maxRetryCount = 1;
    const modelJson = JSON.stringify(model);
    const manifestSettings = JSON.stringify({ ...settings, inference_mode: "batch", source_job_id: localId, color_response_schema: COLOR_PROTOCOL });
    const manifestStatements = expandedTrials(trials, settings).map(trial => {
      const logicalTrialId = `batch-${model.id}-${trial.task}-${trial.runIndex}-${trial.stimulusId}`;
      return env.DB.prepare(`INSERT OR IGNORE INTO trial_manifest (
        logical_trial_id, batch_id, project_id, model_id, model_alias, task_type,
        run_index, stimulus_id, stimulus_hex, stimulus_index, model_json, settings_json,
        max_retry_count, created_at, repair_attempted_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
        .bind(
          logicalTrialId, localId, PROJECT_ID, model.id, model.alias,
          trial.task === "word" ? "Word to Color" : "Color to Emotion", trial.runIndex,
          trial.stimulusId, trial.stimulusHex, trial.stimulusIndex, modelJson,
          manifestSettings, maxRetryCount, updatedAt,
        );
    });
    await saveStatements(manifestStatements);
  }

  return Response.json({
    ok: true,
    localId,
    googleJobName: payload.name,
    state,
    mode,
    startRunIndex: firstRunIndex,
    endRunIndex: firstRunIndex + rounds - 1,
    requestCount: trials.length,
  });
}

async function retryFailedBatch(body: { apiKey?: string; localId?: string }) {
  const apiKey = String(body.apiKey || "").trim();
  const sourceId = String(body.localId || "");
  if (!apiKey || !sourceId) {
    return Response.json({ ok: false, message: "修复 Batch 需要原项目 API Key 和来源 Job ID。" }, { status: 400 });
  }
  const source = await env.DB.prepare("SELECT * FROM gemini_batch_jobs WHERE project_id=? AND local_id=?")
    .bind(PROJECT_ID, sourceId).first<BatchJobRow>();
  if (!source || source.mode === "pilot") {
    return Response.json({ ok: false, message: "只有正式 Batch 的异常项可以创建修复 Batch。" }, { status: 400 });
  }
  if (!["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_EXPIRED"].includes(normalizeBatchState(source.state))) {
    return Response.json({ ok: false, message: "来源 Job 尚未结束，暂时不能创建修复 Batch。" }, { status: 409 });
  }
  const activeRepair = await env.DB.prepare(`SELECT local_id FROM gemini_batch_jobs
    WHERE project_id=? AND mode='repair' AND model_config_id=?
      AND start_run_index=? AND round_count=?
      AND state IN ('SUBMITTING', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING', 'JOB_STATE_CANCELLING')
    LIMIT 1`).bind(
      PROJECT_ID, source.model_config_id, source.start_run_index, source.round_count,
    ).first<{ local_id: string }>();
  if (activeRepair) {
    return Response.json({
      ok: false,
      message: `这组数据已有修复 Batch 正在运行（${activeRepair.local_id}），请勿重复提交。`,
    }, { status: 409 });
  }
  const pending = await env.DB.prepare(`SELECT i.item_id, i.local_job_id, i.request_key, i.position,
    i.task_type, i.run_index, i.stimulus_id, i.stimulus_hex, i.stimulus_index, i.prompt
    FROM gemini_batch_items i
    WHERE i.local_job_id=? AND i.status!='VALID'
      AND NOT EXISTS (
        SELECT 1 FROM trial_results r
        WHERE r.project_id=? AND r.model_id=? AND r.run_index=i.run_index
          AND r.stimulus_id=i.stimulus_id AND r.task_type=i.task_type
          AND r.validation_status='Valid'
      )
    ORDER BY i.position`).bind(sourceId, PROJECT_ID, source.model_config_id).all<BatchItemRow>();
  if (!pending.results.length) {
    return Response.json({ ok: false, message: "该 Job 没有需要重新提交的异常项。" }, { status: 409 });
  }

  let snapshot: { model?: GeminiBatchModel; settings?: GeminiBatchSettings } = {};
  try { snapshot = JSON.parse(source.settings_json) as typeof snapshot; } catch { /* handled below */ }
  const model = snapshot.model;
  if (!model || model.model_id !== "gemini-3.1-pro-preview") {
    return Response.json({ ok: false, message: "来源 Job 缺少可恢复的 Gemini 3.1 Pro 参数快照。" }, { status: 409 });
  }

  const localId = `gb-${Date.now()}-${crypto.randomUUID()}`;
  const shortId = localId.slice(-12).replaceAll("-", "");
  const trials = pending.results.map(item => ({
    task: item.task_type === "Word to Color" ? "word" as const : "color" as const,
    runIndex: Number(item.run_index),
    stimulusId: String(item.stimulus_id),
    stimulusHex: String(item.stimulus_hex || ""),
    stimulusIndex: Number(item.stimulus_index),
    prompt: String(item.prompt),
  }));
  const requests = trials.map((trial, position) => ({
    request: buildGeminiNativeBatchRequest(model, trial),
    metadata: { key: `r-${shortId}-${String(position + 1).padStart(4, "0")}` },
  }));
  const requestBody = {
    batch: {
      display_name: `chromalab-repair-${source.start_run_index}-${shortId}`,
      input_config: { requests: { requests } },
    },
  };
  const serialized = JSON.stringify(requestBody);
  const now = new Date().toISOString();
  const runIndices = [...new Set(trials.map(trial => trial.runIndex))];
  const repairSettings = JSON.stringify({
    ...snapshot,
    protocol: {
      ...((snapshot as { protocol?: Record<string, unknown> }).protocol || {}),
      color_response_schema: colorProtocol(source.settings_json),
      color_missing_encoding: "0=not-selected;1-5=intensity",
      color_required_keys: 20,
      repair_of: sourceId,
    },
  });
  await env.DB.prepare(`INSERT INTO gemini_batch_jobs (
    local_id, google_job_name, project_id, model_config_id, model_alias, model_version,
    mode, start_run_index, round_count, request_count, estimated_input_tokens,
    input_bytes, state, settings_json, api_key_fingerprint, submitted_at, updated_at,
    completed_at, imported_at, valid_count, failed_count, error_message
  ) VALUES (?, NULL, ?, ?, ?, ?, 'repair', ?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?, ?, NULL, NULL, 0, 0, '')`)
    .bind(
      localId, PROJECT_ID, source.model_config_id, source.model_alias, source.model_version,
      Math.min(...runIndices), runIndices.length, trials.length, estimateBatchInputTokens(trials),
      new TextEncoder().encode(serialized).byteLength, repairSettings,
      await keyFingerprint(apiKey), now, now,
    ).run();
  await saveStatements(trials.map((trial, position) => env.DB.prepare(`INSERT INTO gemini_batch_items (
    item_id, local_job_id, request_key, position, task_type, run_index, stimulus_id,
    stimulus_hex, stimulus_index, prompt, status, clean_json, raw_response,
    error_message, imported, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '', '', '', 0, ?, ?)`)
    .bind(
      `${localId}-item-${position + 1}`, localId, requests[position].metadata.key, position,
      trial.task === "word" ? "Word to Color" : "Color to Emotion", trial.runIndex,
      trial.stimulusId, trial.stimulusHex, trial.stimulusIndex, trial.prompt, now, now,
    )));

  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_ROOT}/models/${model.model_id}:batchGenerateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: serialized,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "修复 Batch 提交时网络连接失败。";
    await env.DB.prepare("UPDATE gemini_batch_jobs SET state='SUBMIT_FAILED', error_message=?, updated_at=? WHERE local_id=?")
      .bind(message, new Date().toISOString(), localId).run();
    return Response.json({ ok: false, message, localId }, { status: 503 });
  }
  const payloadText = await response.text();
  let payload: GoogleBatchResponse = {};
  try { payload = JSON.parse(payloadText) as GoogleBatchResponse; } catch { /* keep empty */ }
  if (!response.ok || !payload.name) {
    const message = googleError(payload, `修复 Batch 提交返回 HTTP ${response.status}`);
    await env.DB.prepare("UPDATE gemini_batch_jobs SET state='SUBMIT_FAILED', error_message=?, updated_at=? WHERE local_id=?")
      .bind(message, new Date().toISOString(), localId).run();
    return Response.json({ ok: false, message, localId }, { status: response.status || 502 });
  }
  const state = googleState(payload);
  await env.DB.prepare("UPDATE gemini_batch_jobs SET google_job_name=?, state=?, updated_at=? WHERE local_id=?")
    .bind(payload.name, state, new Date().toISOString(), localId).run();
  return Response.json({ ok: true, localId, googleJobName: payload.name, state, requestCount: trials.length });
}

async function importCompletedJob(job: BatchJobRow, payload: GoogleBatchResponse) {
  const itemRows = await env.DB.prepare(`SELECT item_id, local_job_id, request_key, position,
    task_type, run_index, stimulus_id, stimulus_hex, stimulus_index, prompt
    FROM gemini_batch_items WHERE local_job_id=? ORDER BY position`).bind(job.local_id).all<BatchItemRow>();
  const items = itemRows.results;
  const byKey = new Map(items.map(item => [item.request_key, item]));
  const responses = inlineResponses(payload);
  if (!responses.length) throw new Error("Batch 已完成，但没有找到 Inline 结果；请保留 Job ID 并稍后重试导入。");

  const now = new Date().toISOString();
  const createdAt = payload.endTime || now;
  const statements: D1PreparedStatement[] = [];
  const resultInsertMode = job.mode === "repair" ? "INSERT OR IGNORE" : "INSERT OR REPLACE";
  const protocol = colorProtocol(job.settings_json);
  const strictRatingVector = protocol === COLOR_PROTOCOL || protocol === LEGACY_VECTOR_PROTOCOL;
  const snapshot = settingsSnapshot(job.settings_json);
  let validCount = 0;
  let failedCount = 0;

  responses.forEach((entry, position) => {
    const item = byKey.get(resultKey(entry)) || items[position];
    if (!item) return;
    const rawResponse = resultText(entry);
    const responseError = resultError(entry);
    const task = item.task_type === "Word to Color" ? "word" : "color";
    const attemptNo = job.mode === "repair" ? 1 : 0;
    const grouped = isGroupedJob(job, item);
    const orders = grouped && snapshot.settings ? experimentOrders(snapshot.settings, item.run_index) : null;
    const expectedChildren = task === "word"
      ? (orders?.emotions || [item.stimulus_id]).map((stimulusId, stimulusIndex) => ({ stimulusId, stimulusIndex }))
      : (orders?.colors || [[item.stimulus_id, item.stimulus_hex] as const]).map(([stimulusId], stimulusIndex) => ({ stimulusId, stimulusIndex }));
    if (responseError || !rawResponse) {
      failedCount += 1;
      const message = responseError || "Batch 返回空回答。";
      statements.push(env.DB.prepare(`UPDATE gemini_batch_items
        SET status='ERROR', raw_response=?, error_message=?, imported=0, updated_at=? WHERE item_id=?`)
        .bind(rawResponse, message, now, item.item_id));
      if (job.mode !== "pilot") {
        expectedChildren.forEach(child => {
          const logicalTrialId = `batch-${job.model_config_id}-${task}-${item.run_index}-${child.stimulusId}`;
          statements.push(env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (
            attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type,
            run_index, stimulus_id, attempt_no, status, http_status, retryable,
            error_message, raw_response, latency_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api_error', NULL, 1, ?, ?, 0, ?)`)
            .bind(`${logicalTrialId}-attempt-batch-${attemptNo}`, logicalTrialId, PROJECT_ID,
              job.model_config_id, job.model_alias, item.task_type, item.run_index,
              child.stimulusId, attemptNo, message, rawResponse.slice(0, 12000), createdAt));
        });
      }
      return;
    }

    try {
      const children = grouped
        ? (() => {
            if (!orders) throw new Error("整组 Batch 缺少可复现的随机顺序设置，无法安全拆分。");
            if (task === "word") {
              return parseColorBatchResponse(rawResponse, orders.emotions).map(answer => ({
                stimulusId: answer.emotion,
                clean: answer.color,
              }));
            }
            return parseRatingVectorBatchResponse(rawResponse, orders.colors.map(([colorId]) => colorId)).map(answer => ({
              stimulusId: answer.colorId,
              clean: answer.association,
            }));
          })()
        : [{
            stimulusId: item.stimulus_id,
            clean: task === "word"
              ? parseColorResponse(rawResponse, item.stimulus_id)
              : strictRatingVector
                ? parseRatingVectorResponse(rawResponse)
                : parseAssociationResponse(rawResponse),
          }];
      const cleanJson = JSON.stringify(Object.fromEntries(children.map(child => [child.stimulusId, child.clean])));
      validCount += 1;
      statements.push(env.DB.prepare(`UPDATE gemini_batch_items
        SET status='VALID', clean_json=?, raw_response=?, error_message='', imported=1, updated_at=? WHERE item_id=?`)
        .bind(cleanJson, rawResponse, now, item.item_id));
      if (job.mode !== "pilot") {
        children.forEach(child => {
          const logicalTrialId = `batch-${job.model_config_id}-${task}-${item.run_index}-${child.stimulusId}`;
          const childCleanJson = JSON.stringify(child.clean);
          statements.push(
            env.DB.prepare(`${resultInsertMode} INTO trial_results (
              trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id,
              clean_json, raw_response, validation_status, retry_count, latency_ms, created_at,
              collection_mode, source_job_id, protocol_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Valid', 0, 0, ?, 'batch', ?, ?)`)
              .bind(logicalTrialId, PROJECT_ID, job.model_config_id, job.model_alias,
                item.task_type, item.run_index, child.stimulusId, childCleanJson, rawResponse,
                createdAt, job.local_id, grouped ? COLOR_PROTOCOL : strictRatingVector ? LEGACY_VECTOR_PROTOCOL : "legacy-batch-v1"),
            env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (
              attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type,
              run_index, stimulus_id, attempt_no, status, http_status, retryable,
              error_message, raw_response, latency_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', 200, 0, '', ?, 0, ?)`)
              .bind(`${logicalTrialId}-attempt-batch-${attemptNo}`, logicalTrialId, PROJECT_ID,
                job.model_config_id, job.model_alias, item.task_type, item.run_index,
                child.stimulusId, attemptNo, rawResponse.slice(0, 12000), createdAt),
            env.DB.prepare("UPDATE trial_manifest SET completed_at=? WHERE logical_trial_id=?")
              .bind(createdAt, logicalTrialId),
          );
        });
      }
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Batch 回答格式校验失败。";
      statements.push(env.DB.prepare(`UPDATE gemini_batch_items
        SET status='INVALID', raw_response=?, error_message=?, imported=0, updated_at=? WHERE item_id=?`)
        .bind(rawResponse, message, now, item.item_id));
      if (job.mode !== "pilot") {
        expectedChildren.forEach(child => {
          const logicalTrialId = `batch-${job.model_config_id}-${task}-${item.run_index}-${child.stimulusId}`;
          statements.push(env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (
            attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type,
            run_index, stimulus_id, attempt_no, status, http_status, retryable,
            error_message, raw_response, latency_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'validation_error', 200, 1, ?, ?, 0, ?)`)
            .bind(`${logicalTrialId}-attempt-batch-${attemptNo}`, logicalTrialId, PROJECT_ID,
              job.model_config_id, job.model_alias, item.task_type, item.run_index,
              child.stimulusId, attemptNo, message, rawResponse.slice(0, 12000), createdAt));
        });
      }
    }
  });

  if (responses.length < items.length) {
    failedCount += items.length - responses.length;
  }
  await saveStatements(statements);
  await env.DB.prepare(`UPDATE gemini_batch_jobs
    SET valid_count=?, failed_count=?, imported_at=?, completed_at=COALESCE(completed_at, ?), updated_at=?, error_message=?
    WHERE local_id=?`).bind(
      validCount, failedCount, now, createdAt, now,
      responses.length < items.length ? `仅返回 ${responses.length}/${items.length} 条结果。` : "",
      job.local_id,
    ).run();
  return { validCount, failedCount, responseCount: responses.length };
}

async function recoverStoredBatchResponses() {
  const candidates = await env.DB.prepare(`SELECT
      i.item_id, i.local_job_id, i.request_key, i.position, i.task_type, i.run_index,
      i.stimulus_id, i.stimulus_hex, i.stimulus_index, i.prompt,
      i.raw_response, i.error_message AS previous_error, i.updated_at AS item_updated_at,
      j.mode, j.model_config_id, j.model_alias, j.completed_at
    FROM gemini_batch_items i
    JOIN gemini_batch_jobs j ON j.local_id=i.local_job_id
    WHERE i.task_type='Color to Emotion' AND i.status='INVALID' AND i.raw_response!=''
      AND j.settings_json NOT LIKE '%grouped-round-v5%'
    ORDER BY j.submitted_at, i.position`).all<RecoveryItemRow>();

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const affectedJobs = new Set<string>();
  const formats: Record<string, number> = {};
  let recovered = 0;

  for (const item of candidates.results) {
    try {
      const parsed = parseAssociationResponseWithProvenance(item.raw_response);
      const cleanJson = JSON.stringify(parsed.clean);
      const logicalTrialId = `batch-${item.model_config_id}-color-${item.run_index}-${item.stimulus_id}`;
      const createdAt = item.completed_at || item.item_updated_at || now;
      recovered += 1;
      formats[parsed.format] = (formats[parsed.format] || 0) + 1;
      affectedJobs.add(item.local_job_id);
      statements.push(
        env.DB.prepare(`UPDATE gemini_batch_items SET status='VALID', clean_json=?,
          error_message='', imported=1, updated_at=? WHERE item_id=?`)
          .bind(cleanJson, now, item.item_id),
        env.DB.prepare(`INSERT OR REPLACE INTO gemini_batch_recovery_audit (
          item_id, local_job_id, task_type, run_index, stimulus_id, previous_error,
          parser_version, source_format, recovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'association-parser-v2', ?, ?)`)
          .bind(item.item_id, item.local_job_id, item.task_type, item.run_index,
            item.stimulus_id, item.previous_error, parsed.format, now),
      );
      if (item.mode !== "pilot") {
        statements.push(
          env.DB.prepare(`INSERT OR REPLACE INTO trial_results (
            trial_id, project_id, model_id, model_alias, task_type, run_index, stimulus_id,
            clean_json, raw_response, validation_status, retry_count, latency_ms, created_at,
            collection_mode, source_job_id, protocol_version
          ) VALUES (?, ?, ?, ?, 'Color to Emotion', ?, ?, ?, ?, 'Valid', 0, 0, ?, 'batch', ?, 'legacy-recovered-v2')`)
            .bind(logicalTrialId, PROJECT_ID, item.model_config_id, item.model_alias,
              item.run_index, item.stimulus_id, cleanJson, item.raw_response, createdAt, item.local_job_id),
          env.DB.prepare(`INSERT OR REPLACE INTO trial_attempts (
            attempt_id, logical_trial_id, project_id, model_id, model_alias, task_type,
            run_index, stimulus_id, attempt_no, status, http_status, retryable,
            error_message, raw_response, latency_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, 'Color to Emotion', ?, ?, 0, 'success', 200, 0, '', ?, 0, ?)`)
            .bind(`${logicalTrialId}-attempt-batch-0`, logicalTrialId, PROJECT_ID,
              item.model_config_id, item.model_alias, item.run_index, item.stimulus_id,
              item.raw_response.slice(0, 12000), createdAt),
          env.DB.prepare("UPDATE trial_manifest SET completed_at=? WHERE logical_trial_id=?")
            .bind(createdAt, logicalTrialId),
        );
      }
    } catch {
      // Ambiguous or incomplete responses remain invalid and are never imputed.
    }
  }

  await saveStatements(statements);
  for (const localId of affectedJobs) {
    await env.DB.prepare(`UPDATE gemini_batch_jobs SET
      valid_count=(SELECT COUNT(*) FROM gemini_batch_items WHERE local_job_id=? AND status='VALID'),
      failed_count=(SELECT COUNT(*) FROM gemini_batch_items WHERE local_job_id=? AND status IN ('INVALID','ERROR')),
      updated_at=? WHERE local_id=?`).bind(localId, localId, now, localId).run();
  }
  const cumulative = await env.DB.prepare(`SELECT COUNT(*) AS total_recovered,
    SUM(CASE WHEN j.mode!='pilot' THEN 1 ELSE 0 END) AS formal_recovered
    FROM gemini_batch_recovery_audit a
    JOIN gemini_batch_jobs j ON j.local_id=a.local_job_id
    WHERE j.project_id=?`).bind(PROJECT_ID).first();
  const outstanding = await env.DB.prepare(`SELECT
    SUM(CASE WHEN j.mode!='pilot' AND i.task_type='Color to Emotion'
      AND i.status IN ('INVALID','ERROR') THEN 1 ELSE 0 END) AS formal_color_remaining,
    SUM(CASE WHEN j.mode!='pilot' AND i.task_type='Word to Color'
      AND i.status IN ('INVALID','ERROR') THEN 1 ELSE 0 END) AS formal_word_remaining,
    SUM(CASE WHEN j.mode='pilot' AND i.task_type='Color to Emotion'
      AND i.status IN ('INVALID','ERROR') THEN 1 ELSE 0 END) AS pilot_color_remaining
    FROM gemini_batch_items i
    JOIN gemini_batch_jobs j ON j.local_id=i.local_job_id
    WHERE j.project_id=?`).bind(PROJECT_ID).first();
  return {
    ok: true,
    parserVersion: "association-parser-v2",
    candidates: candidates.results.length,
    recovered,
    remaining: candidates.results.length - recovered,
    cumulativeRecovered: Number(cumulative?.total_recovered || 0),
    formalRecovered: Number(cumulative?.formal_recovered || 0),
    formalColorRemaining: Number(outstanding?.formal_color_remaining || 0),
    formalWordRemaining: Number(outstanding?.formal_word_remaining || 0),
    pilotColorRemaining: Number(outstanding?.pilot_color_remaining || 0),
    formats,
  };
}

async function refreshBatch(body: { apiKey?: string; localId?: string }) {
  const apiKey = String(body.apiKey || "").trim();
  const localId = String(body.localId || "");
  if (!apiKey || !localId) {
    return Response.json({ ok: false, message: "查询 Batch 需要原项目 API Key 和本地 Job ID。" }, { status: 400 });
  }
  const job = await env.DB.prepare("SELECT * FROM gemini_batch_jobs WHERE project_id=? AND local_id=?")
    .bind(PROJECT_ID, localId).first<BatchJobRow>();
  if (!job?.google_job_name || !job.google_job_name.startsWith("batches/")) {
    return Response.json({ ok: false, message: "该任务尚未获得有效的 Google Batch Job ID。" }, { status: 400 });
  }
  if (job.api_key_fingerprint && await keyFingerprint(apiKey) !== job.api_key_fingerprint) {
    return Response.json({
      ok: false,
      code: "BATCH_KEY_MISMATCH",
      message: `当前 Gemini Key 不是提交该 Job 时使用的项目 Key（任务指纹 ${job.api_key_fingerprint}）。请换回原项目 Key 后再查询。`,
    }, { status: 409 });
  }
  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_ROOT}/${job.google_job_name}`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接 Google Batch 查询接口失败。";
    return Response.json({ ok: false, code: "BATCH_QUERY_NETWORK", message }, { status: 503 });
  }
  const payloadText = await response.text();
  let payload: GoogleBatchResponse = {};
  try { payload = JSON.parse(payloadText) as GoogleBatchResponse; } catch { /* keep empty */ }
  if (!response.ok) {
    return Response.json({ ok: false, message: googleError(payload, `Batch 查询返回 HTTP ${response.status}`) }, { status: response.status });
  }
  const state = googleState(payload, job.state);
  const now = new Date().toISOString();
  const terminalError = ["JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"].includes(state)
    ? googleError(payload, `Batch 结束状态：${state}`)
    : "";
  await env.DB.prepare(`UPDATE gemini_batch_jobs SET state=?, updated_at=?, completed_at=?, error_message=? WHERE local_id=?`)
    .bind(
      state,
      now,
      ["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"].includes(state) ? (payload.endTime || payload.metadata?.endTime || now) : null,
      terminalError,
      localId,
    ).run();

  let imported: { validCount: number; failedCount: number; responseCount: number } | null = null;
  if (state === "JOB_STATE_SUCCEEDED") {
    try {
      imported = await importCompletedJob({ ...job, state }, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Batch 完成结果读取失败。";
      await env.DB.prepare("UPDATE gemini_batch_jobs SET error_message=?, updated_at=? WHERE local_id=?")
        .bind(message, new Date().toISOString(), localId).run();
      return Response.json({ ok: false, code: "BATCH_IMPORT_FAILED", message }, { status: 502 });
    }
  }
  return Response.json({ ok: true, localId, state, imported });
}

async function cancelBatch(body: { apiKey?: string; localId?: string }) {
  const apiKey = String(body.apiKey || "").trim();
  const localId = String(body.localId || "");
  const job = await env.DB.prepare("SELECT * FROM gemini_batch_jobs WHERE project_id=? AND local_id=?")
    .bind(PROJECT_ID, localId).first<BatchJobRow>();
  if (!apiKey || !job?.google_job_name || !job.google_job_name.startsWith("batches/")) {
    return Response.json({ ok: false, message: "取消任务需要原项目 API Key 和有效 Job ID。" }, { status: 400 });
  }
  const response = await fetch(`${GEMINI_API_ROOT}/${job.google_job_name}:cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: "{}",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as GoogleBatchResponse;
    return Response.json({ ok: false, message: googleError(payload, `取消请求返回 HTTP ${response.status}`) }, { status: response.status });
  }
  await env.DB.prepare("UPDATE gemini_batch_jobs SET state='JOB_STATE_CANCELLING', updated_at=? WHERE local_id=?")
    .bind(new Date().toISOString(), localId).run();
  return Response.json({ ok: true, localId, state: "JOB_STATE_CANCELLING" });
}

export async function GET() {
  await ensureBatchSchema();
  const jobs = await env.DB.prepare(`SELECT local_id, google_job_name, model_alias, model_version,
    mode, start_run_index, round_count, request_count, estimated_input_tokens,
    input_bytes, state, submitted_at, updated_at, completed_at, imported_at,
    valid_count, failed_count, error_message
    FROM gemini_batch_jobs WHERE project_id=? ORDER BY submitted_at DESC LIMIT 100`)
    .bind(PROJECT_ID).all();
  const activePlaceholders = ACTIVE_STATES.map(() => "?").join(", ");
  const quota = await env.DB.prepare(`SELECT COUNT(*) AS active_jobs,
    COALESCE(SUM(estimated_input_tokens), 0) AS active_tokens
    FROM gemini_batch_jobs WHERE project_id=? AND state IN (${activePlaceholders})`)
    .bind(PROJECT_ID, ...ACTIVE_STATES).first();
  const latestVectorPilot = await env.DB.prepare(`SELECT local_id, state, request_count,
    valid_count, failed_count, imported_at, submitted_at
    FROM gemini_batch_jobs
    WHERE project_id=? AND mode='pilot' AND settings_json LIKE ?
    ORDER BY submitted_at DESC LIMIT 1`).bind(PROJECT_ID, `%${COLOR_PROTOCOL}%`).first();
  const qualifiedVectorPilot = await env.DB.prepare(`SELECT local_id
    FROM gemini_batch_jobs
    WHERE project_id=? AND mode='pilot' AND settings_json LIKE ?
      AND state='JOB_STATE_SUCCEEDED' AND imported_at IS NOT NULL
      AND request_count=4 AND valid_count=4 AND failed_count=0
    ORDER BY imported_at DESC LIMIT 1`).bind(PROJECT_ID, `%${COLOR_PROTOCOL}%`).first();
  // A later failed re-check must not invalidate an earlier 4/4 grouped protocol qualification.
  // The submit endpoint still performs the stricter same-model + same-Key-fingerprint check.
  const protocolReady = Boolean(qualifiedVectorPilot);
  return Response.json({
    ok: true,
    jobs: jobs.results,
    quota: {
      activeJobs: Number(quota?.active_jobs || 0),
      activeTokens: Number(quota?.active_tokens || 0),
      jobLimit: 100,
      tokenLimit: 5_000_000,
      protocolVersion: COLOR_PROTOCOL,
      protocolReady,
      pilotValidCount: Number(latestVectorPilot?.valid_count || 0),
      pilotRequestCount: Number(latestVectorPilot?.request_count || 4),
      pilotState: String(latestVectorPilot?.state || "NOT_STARTED"),
    },
  });
}

export async function POST(request: Request) {
  await ensureBatchSchema();
  try {
    const body = await request.json() as {
      action?: "submit" | "refresh" | "cancel" | "retry" | "recover";
      apiKey?: string;
      localId?: string;
      model?: GeminiBatchModel;
      settings?: GeminiBatchSettings;
      mode?: BatchMode;
      rounds?: number;
    };
    if (body.action === "submit") return submitBatch(body);
    if (body.action === "refresh") return refreshBatch(body);
    if (body.action === "cancel") return cancelBatch(body);
    if (body.action === "retry") return retryFailedBatch(body);
    if (body.action === "recover") return Response.json(await recoverStoredBatchResponses());
    return Response.json({ ok: false, message: "未知的 Gemini Batch 操作。" }, { status: 400 });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : "Gemini Batch 操作失败。",
    }, { status: 500 });
  }
}
