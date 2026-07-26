import { env } from "cloudflare:workers";

const PROJECT_ID = "ECX-2026-001";

type ManifestModel = {
  id: string;
  alias: string;
  model_id: string;
  base_url: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  supports_seed: number | boolean;
  supports_json: number | boolean;
  rate_limit: number;
};

type ManifestTrial = {
  task: "word" | "color";
  runIndex: number;
  stimulusId: string;
  stimulusHex?: string;
  stimulusIndex: number;
};

async function ensureManifestSchema() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS trial_manifest (
      logical_trial_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, project_id TEXT NOT NULL,
      model_id TEXT NOT NULL, model_alias TEXT NOT NULL, task_type TEXT NOT NULL,
      run_index INTEGER NOT NULL, stimulus_id TEXT NOT NULL, stimulus_hex TEXT NOT NULL,
      stimulus_index INTEGER NOT NULL, model_json TEXT NOT NULL, settings_json TEXT NOT NULL,
      max_retry_count INTEGER NOT NULL, created_at TEXT NOT NULL,
      repair_attempted_at TEXT, completed_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS manifest_project_idx ON trial_manifest(project_id, model_id, run_index)"),
  ]);
}

async function registerManifest(body: {
  batchId?: string;
  model?: ManifestModel;
  settings?: Record<string, unknown> & { max_retry?: number };
  trials?: ManifestTrial[];
}) {
  const model = body.model;
  const settings = body.settings;
  const trials = body.trials || [];
  if (!body.batchId || !model?.id || !model.model_id || !settings || !trials.length || trials.length > 3100) {
    return Response.json({ ok: false, message: "试次清单缺少批次、模型、设置或试次信息。" }, { status: 400 });
  }
  const createdAt = new Date().toISOString();
  const modelJson = JSON.stringify(model);
  const settingsJson = JSON.stringify(settings);
  const maxRetryCount = Math.max(0, Math.min(5, Number(settings.max_retry) || 0));
  const statements = trials.map(trial => {
    if (!["word", "color"].includes(trial.task) || !trial.stimulusId || trial.runIndex < 1) {
      throw new Error("试次清单包含无效任务或刺激项。");
    }
    const logicalTrialId = `batch-${model.id}-${trial.task}-${trial.runIndex}-${trial.stimulusId}`;
    return env.DB.prepare(`INSERT OR IGNORE INTO trial_manifest (
      logical_trial_id, batch_id, project_id, model_id, model_alias, task_type,
      run_index, stimulus_id, stimulus_hex, stimulus_index, model_json, settings_json,
      max_retry_count, created_at, repair_attempted_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
      .bind(
        logicalTrialId, body.batchId, PROJECT_ID, model.id, model.alias,
        trial.task === "word" ? "Word to Color" : "Color to Emotion",
        trial.runIndex, trial.stimulusId, trial.stimulusHex || "",
        trial.stimulusIndex, modelJson, settingsJson, maxRetryCount, createdAt,
      );
  });
  for (let index = 0; index < statements.length; index += 100) {
    await env.DB.batch(statements.slice(index, index + 100));
  }
  return Response.json({ ok: true, registered: trials.length, batchId: body.batchId });
}

async function listMissing(modelIds: string[]) {
  const uniqueModelIds = [...new Set(modelIds.map(String).filter(Boolean))].slice(0, 4);
  const filter = uniqueModelIds.length
    ? ` AND m.model_id IN (${uniqueModelIds.map(() => "?").join(", ")})`
    : "";
  const rows = await env.DB.prepare(`WITH attempt_max AS (
      SELECT logical_trial_id, MAX(attempt_no) AS last_attempt
      FROM trial_attempts WHERE project_id = ? GROUP BY logical_trial_id
    )
    SELECT m.*, COALESCE(a.last_attempt, -1) + 1 AS next_attempt,
      la.retryable AS last_retryable, la.status AS last_status
    FROM trial_manifest m
    LEFT JOIN trial_results r ON r.trial_id = m.logical_trial_id AND r.validation_status = 'Valid'
    LEFT JOIN attempt_max a ON a.logical_trial_id = m.logical_trial_id
    LEFT JOIN trial_attempts la
      ON la.logical_trial_id = m.logical_trial_id AND la.attempt_no = a.last_attempt
    WHERE m.project_id = ? AND r.trial_id IS NULL${filter}
    ORDER BY m.model_alias, m.run_index, m.task_type, m.stimulus_index`)
    .bind(PROJECT_ID, PROJECT_ID, ...uniqueModelIds).all();

  const missing = rows.results.map(row => {
    let model: ManifestModel;
    let settings: Record<string, unknown>;
    try {
      model = JSON.parse(String(row.model_json)) as ManifestModel;
      settings = JSON.parse(String(row.settings_json)) as Record<string, unknown>;
    } catch {
      model = {} as ManifestModel;
      settings = {};
    }
    return {
      logicalTrialId: String(row.logical_trial_id),
      batchId: String(row.batch_id),
      modelId: String(row.model_id),
      modelAlias: String(row.model_alias),
      task: row.task_type === "Word to Color" ? "word" as const : "color" as const,
      runIndex: Number(row.run_index),
      stimulusId: String(row.stimulus_id),
      stimulusHex: String(row.stimulus_hex || ""),
      stimulusIndex: Number(row.stimulus_index),
      nextAttempt: Number(row.next_attempt),
      maxRetryCount: Number(row.max_retry_count),
      repairAttemptedAt: row.repair_attempted_at ? String(row.repair_attempted_at) : "",
      lastRetryable: row.last_retryable === null || row.last_retryable === undefined ? null : Boolean(row.last_retryable),
      lastStatus: row.last_status ? String(row.last_status) : "",
      model,
      settings,
    };
  });
  const repairable = missing.filter(item =>
    item.model?.id && !item.repairAttemptedAt && item.nextAttempt <= item.maxRetryCount
    && (item.nextAttempt === 0 || item.lastRetryable === true));
  return Response.json({
    ok: true,
    repairable,
    exhaustedCount: missing.length - repairable.length,
    totalMissing: missing.length,
  });
}

async function claimRepair(logicalTrialIds: string[]) {
  const ids = [...new Set(logicalTrialIds.map(String).filter(Boolean))].slice(0, 12400);
  if (!ids.length) return Response.json({ ok: true, claimed: 0 });
  const claimedAt = new Date().toISOString();
  const statements = ids.map(id => env.DB.prepare(`UPDATE trial_manifest
    SET repair_attempted_at = ?
    WHERE project_id = ? AND logical_trial_id = ? AND repair_attempted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM trial_results r
        WHERE r.trial_id = trial_manifest.logical_trial_id AND r.validation_status = 'Valid'
      )`).bind(claimedAt, PROJECT_ID, id));
  let claimed = 0;
  for (let index = 0; index < statements.length; index += 100) {
    const results = await env.DB.batch(statements.slice(index, index + 100));
    claimed += results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
  }
  return Response.json({ ok: true, claimed, claimedAt });
}

export async function POST(request: Request) {
  try {
    await ensureManifestSchema();
    const body = await request.json() as {
      action?: "register" | "list" | "claim";
      batchId?: string;
      model?: ManifestModel;
      settings?: Record<string, unknown> & { max_retry?: number };
      trials?: ManifestTrial[];
      modelIds?: string[];
      logicalTrialIds?: string[];
    };
    if (body.action === "register") return registerManifest(body);
    if (body.action === "list") return listMissing(Array.isArray(body.modelIds) ? body.modelIds : []);
    if (body.action === "claim") return claimRepair(Array.isArray(body.logicalTrialIds) ? body.logicalTrialIds : []);
    return Response.json({ ok: false, message: "未知的试次清单操作。" }, { status: 400 });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : "试次清单处理失败。",
    }, { status: 500 });
  }
}
