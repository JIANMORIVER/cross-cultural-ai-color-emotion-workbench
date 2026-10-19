import { env } from "cloudflare:workers";

const PROJECT_ID = "ECX-2026-001";

async function ensureSchema() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, researcher TEXT NOT NULL,
      description TEXT NOT NULL, experiment_version TEXT NOT NULL,
      emotion_list_version TEXT NOT NULL, color_list_version TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider TEXT NOT NULL,
      alias TEXT NOT NULL, model_id TEXT NOT NULL, base_url TEXT NOT NULL,
      api_format TEXT NOT NULL, max_tokens INTEGER NOT NULL,
      temperature REAL NOT NULL, top_p REAL NOT NULL,
      supports_seed INTEGER NOT NULL, supports_json INTEGER NOT NULL,
      rate_limit INTEGER NOT NULL, enabled INTEGER NOT NULL,
      last_test_status TEXT NOT NULL, latency_ms INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS experiment_settings (
      project_id TEXT PRIMARY KEY, repetitions INTEGER NOT NULL,
      run_word_to_color INTEGER NOT NULL, run_color_to_emotion INTEGER NOT NULL,
      concurrency INTEGER NOT NULL, max_retry INTEGER NOT NULL,
      timeout_seconds INTEGER NOT NULL, save_raw INTEGER NOT NULL,
      prompt_seed_enabled INTEGER NOT NULL DEFAULT 0,
      prompt_seed_base INTEGER NOT NULL DEFAULT 20260715,
      native_seed_enabled INTEGER NOT NULL DEFAULT 0,
      prompt_variants_enabled INTEGER NOT NULL DEFAULT 0,
      model_scope TEXT NOT NULL DEFAULT 'all',
      single_model_id TEXT NOT NULL DEFAULT 'model-gpt',
      model_slot_ids TEXT NOT NULL DEFAULT '["model-gpt"]',
      shuffle_emotion_order INTEGER NOT NULL DEFAULT 1,
      shuffle_color_order INTEGER NOT NULL DEFAULT 1,
      shuffle_emotion_options INTEGER NOT NULL DEFAULT 1
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trial_results (
      trial_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, model_id TEXT NOT NULL,
      model_alias TEXT NOT NULL, task_type TEXT NOT NULL, run_index INTEGER NOT NULL,
      stimulus_id TEXT NOT NULL, clean_json TEXT NOT NULL, raw_response TEXT NOT NULL,
      validation_status TEXT NOT NULL, retry_count INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL, created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trial_attempts (
      attempt_id TEXT PRIMARY KEY, logical_trial_id TEXT NOT NULL,
      project_id TEXT NOT NULL, model_id TEXT NOT NULL, model_alias TEXT NOT NULL,
      task_type TEXT NOT NULL, run_index INTEGER NOT NULL, stimulus_id TEXT NOT NULL,
      attempt_no INTEGER NOT NULL, status TEXT NOT NULL, http_status INTEGER,
      retryable INTEGER NOT NULL, error_message TEXT NOT NULL, raw_response TEXT NOT NULL,
      latency_ms INTEGER NOT NULL, created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS trial_manifest (
      logical_trial_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, project_id TEXT NOT NULL,
      model_id TEXT NOT NULL, model_alias TEXT NOT NULL, task_type TEXT NOT NULL,
      run_index INTEGER NOT NULL, stimulus_id TEXT NOT NULL, stimulus_hex TEXT NOT NULL,
      stimulus_index INTEGER NOT NULL, model_json TEXT NOT NULL, settings_json TEXT NOT NULL,
      max_retry_count INTEGER NOT NULL, created_at TEXT NOT NULL,
      repair_attempted_at TEXT, completed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS trial_project_idx ON trial_results(project_id, task_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS attempt_project_idx ON trial_attempts(project_id, model_id, run_index)"),
    db.prepare("CREATE INDEX IF NOT EXISTS manifest_project_idx ON trial_manifest(project_id, model_id, run_index)"),
  ]);

  const settingsColumns = await db.prepare("PRAGMA table_info(experiment_settings)").all();
  const settingsColumnNames = new Set(settingsColumns.results.map(column => String(column.name)));
  const settingsMigrations = [
    ["prompt_seed_enabled", "ALTER TABLE experiment_settings ADD COLUMN prompt_seed_enabled INTEGER NOT NULL DEFAULT 0"],
    ["prompt_seed_base", "ALTER TABLE experiment_settings ADD COLUMN prompt_seed_base INTEGER NOT NULL DEFAULT 20260715"],
    ["native_seed_enabled", "ALTER TABLE experiment_settings ADD COLUMN native_seed_enabled INTEGER NOT NULL DEFAULT 0"],
    ["prompt_variants_enabled", "ALTER TABLE experiment_settings ADD COLUMN prompt_variants_enabled INTEGER NOT NULL DEFAULT 0"],
    ["model_scope", "ALTER TABLE experiment_settings ADD COLUMN model_scope TEXT NOT NULL DEFAULT 'all'"],
    ["single_model_id", "ALTER TABLE experiment_settings ADD COLUMN single_model_id TEXT NOT NULL DEFAULT 'model-gpt'"],
    ["model_slot_ids", `ALTER TABLE experiment_settings ADD COLUMN model_slot_ids TEXT NOT NULL DEFAULT '["model-gpt"]'`],
    ["shuffle_emotion_order", "ALTER TABLE experiment_settings ADD COLUMN shuffle_emotion_order INTEGER NOT NULL DEFAULT 1"],
    ["shuffle_color_order", "ALTER TABLE experiment_settings ADD COLUMN shuffle_color_order INTEGER NOT NULL DEFAULT 1"],
    ["shuffle_emotion_options", "ALTER TABLE experiment_settings ADD COLUMN shuffle_emotion_options INTEGER NOT NULL DEFAULT 1"],
  ].filter(([column]) => !settingsColumnNames.has(column));
  if (settingsMigrations.length) await db.batch(settingsMigrations.map(([, sql]) => db.prepare(sql)));

  const resultColumns = await db.prepare("PRAGMA table_info(trial_results)").all();
  const resultColumnNames = new Set(resultColumns.results.map(column => String(column.name)));
  const resultMigrations = [
    ["collection_mode", "ALTER TABLE trial_results ADD COLUMN collection_mode TEXT NOT NULL DEFAULT 'realtime'"],
    ["source_job_id", "ALTER TABLE trial_results ADD COLUMN source_job_id TEXT NOT NULL DEFAULT ''"],
    ["protocol_version", "ALTER TABLE trial_results ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'realtime-v1'"],
  ].filter(([column]) => !resultColumnNames.has(column));
  if (resultMigrations.length) await db.batch(resultMigrations.map(([, sql]) => db.prepare(sql)));

  const existing = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(PROJECT_ID).first();
  if (!existing) {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(PROJECT_ID, "Cross-model Emotion–Color Study · 整组提交版", "Jianmo", "20 个词选色与 11 个色选词分别整组提交，逐项解析入库的标准化 AI 情绪—颜色比较。", "1.1-20x11", "GEW-20 v1.0", "Munsell-11 v1.0", "Draft", now, now),
      db.prepare(`INSERT INTO experiment_settings (
        project_id, repetitions, run_word_to_color, run_color_to_emotion, concurrency,
        max_retry, timeout_seconds, save_raw, prompt_seed_enabled, prompt_seed_base,
        native_seed_enabled, prompt_variants_enabled, model_scope, single_model_id,
        model_slot_ids, shuffle_emotion_order, shuffle_color_order, shuffle_emotion_options
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(PROJECT_ID, 100, 1, 1, 2, 3, 180, 1, 0, 20260715, 0, 0, "all", "model-gpt", '["model-gpt"]', 1, 1, 1),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-gpt", PROJECT_ID, "OpenAI", "GPT", "gpt-5.6", "https://api.openai.com/v1", "OpenAI Chat Completions", 2048, 1, 1, 0, 1, 60, 1, "Not tested", null),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-deepseek", PROJECT_ID, "DeepSeek", "DeepSeek", "deepseek-v4-pro", "https://api.deepseek.com", "OpenAI-compatible", 2048, 1, 1, 0, 1, 60, 1, "Not tested", null),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-doubao", PROJECT_ID, "ByteDance", "Doubao", "doubao-seed-2-1-pro-260628", "https://ark.cn-beijing.volces.com/api/v3", "OpenAI-compatible", 2048, 1, 1, 0, 1, 60, 1, "Not tested", null),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-gemini", PROJECT_ID, "Google", "Gemini", "gemini-3.1-pro-preview", "https://generativelanguage.googleapis.com/v1beta", "Gemini native generateContent", 2048, 1, 1, 0, 1, 8, 1, "Not tested", null),
    ]);
  }
  await db.prepare(`UPDATE model_configs
    SET model_id = 'gemini-3.6-flash', last_test_status = 'Not tested', latency_ms = NULL
    WHERE id = 'model-gemini'
      AND model_id IN ('gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-flash-latest')`).run();
  await db.prepare(`UPDATE model_configs
    SET model_id = 'gemini-3.1-pro-preview', last_test_status = 'Not tested', latency_ms = NULL
    WHERE id = 'model-gemini'
      AND model_id IN ('gemini-2.5-pro', 'gemini-pro-latest')`).run();
  await db.prepare(`UPDATE model_configs
    SET max_tokens = 2048
    WHERE id = 'model-gemini'
      AND model_id = 'gemini-3.1-pro-preview'
      AND max_tokens < 2048`).run();

  const geminiNativeMigrationId = "gemini-native-generate-content-v1";
  const geminiNativeMigrated = await db.prepare("SELECT id FROM app_migrations WHERE id = ?")
    .bind(geminiNativeMigrationId).first();
  if (!geminiNativeMigrated) {
    const migratedAt = new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE model_configs
        SET base_url='https://generativelanguage.googleapis.com/v1beta',
            api_format='Gemini native generateContent', last_test_status='Not tested', latency_ms=NULL
        WHERE project_id=? AND model_id LIKE 'gemini-3%'`).bind(PROJECT_ID),
      db.prepare("INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)")
        .bind(geminiNativeMigrationId, migratedAt),
    ]);
  }

  const protocolMigrationId = "model-protocol-t1-p1-2048-low-reasoning-v1";
  const protocolMigrated = await db.prepare("SELECT id FROM app_migrations WHERE id = ?")
    .bind(protocolMigrationId).first();
  if (!protocolMigrated) {
    await db.batch([
      db.prepare(`UPDATE model_configs
        SET temperature = 1, top_p = 1, max_tokens = 2048
        WHERE project_id = ?`).bind(PROJECT_ID),
      db.prepare(`UPDATE model_configs
        SET model_id = 'deepseek-v4-pro', base_url = 'https://api.deepseek.com',
            last_test_status = 'Not tested', latency_ms = NULL
        WHERE id = 'model-deepseek' AND model_id = 'deepseek-chat'`),
      db.prepare(`UPDATE model_configs
        SET model_id = 'doubao-seed-2-0-pro-260215',
            last_test_status = 'Not tested', latency_ms = NULL
        WHERE id = 'model-doubao' AND model_id = 'doubao-seed-1-6'`),
      db.prepare(`INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)`)
        .bind(protocolMigrationId, new Date().toISOString()),
    ]);
  }

  const geminiProtocolMigrationId = "gemini-pro-t1-p1-low-reasoning-v1";
  const geminiProtocolMigrated = await db.prepare("SELECT id FROM app_migrations WHERE id = ?")
    .bind(geminiProtocolMigrationId).first();
  if (!geminiProtocolMigrated) {
    await db.batch([
      db.prepare(`UPDATE model_configs
        SET model_id = 'gemini-3.1-pro-preview', temperature = 1, top_p = 1,
            max_tokens = 2048, last_test_status = 'Not tested', latency_ms = NULL
        WHERE id = 'model-gemini'`),
      db.prepare(`INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)`)
        .bind(geminiProtocolMigrationId, new Date().toISOString()),
    ]);
  }

  const geminiStableQueueMigrationId = "gemini-stable-queue-v1";
  const geminiStableQueueMigrated = await db.prepare("SELECT id FROM app_migrations WHERE id = ?")
    .bind(geminiStableQueueMigrationId).first();
  if (!geminiStableQueueMigrated) {
    await db.batch([
      db.prepare(`UPDATE model_configs
        SET rate_limit = 8
        WHERE id = 'model-gemini'`),
      db.prepare(`INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)`)
        .bind(geminiStableQueueMigrationId, new Date().toISOString()),
    ]);
  }

  const doubao21MigrationId = "doubao-seed-2-1-pro-260628-v1";
  const doubao21Migrated = await db.prepare("SELECT id FROM app_migrations WHERE id = ?")
    .bind(doubao21MigrationId).first();
  if (!doubao21Migrated) {
    await db.batch([
      db.prepare(`UPDATE model_configs
        SET model_id = 'doubao-seed-2-1-pro-260628',
            base_url = 'https://ark.cn-beijing.volces.com/api/v3',
            temperature = 1, top_p = 1, max_tokens = 2048,
            last_test_status = 'Not tested', latency_ms = NULL
        WHERE id = 'model-doubao'
          AND model_id IN (
            'doubao-seed-1-6',
            'doubao-seed-2-0-pro-260215',
            'seedance2.1pro',
            'doubao-seedance-2.1-pro'
          )`),
      db.prepare(`INSERT INTO app_migrations (id, applied_at) VALUES (?, ?)`)
        .bind(doubao21MigrationId, new Date().toISOString()),
    ]);
  }
}

export async function GET() {
  await ensureSchema();
  const db = env.DB;
  const [project, models, settings, results, counts, groupSummaries, nextRun, recentFailures] = await Promise.all([
    db.prepare("SELECT * FROM projects WHERE id = ?").bind(PROJECT_ID).first(),
    db.prepare("SELECT * FROM model_configs WHERE project_id = ? ORDER BY rowid").bind(PROJECT_ID).all(),
    db.prepare("SELECT * FROM experiment_settings WHERE project_id = ?").bind(PROJECT_ID).first(),
    db.prepare("SELECT * FROM trial_results WHERE project_id = ? ORDER BY created_at DESC LIMIT 80").bind(PROJECT_ID).all(),
    db.prepare(`SELECT task_type, validation_status, COUNT(*) AS count
      FROM trial_results WHERE project_id = ? GROUP BY task_type, validation_status`).bind(PROJECT_ID).all(),
    db.prepare(`WITH run_groups AS (
        SELECT model_id, model_alias, run_index FROM trial_results
        WHERE project_id = ? AND run_index > 0 AND trial_id NOT LIKE 'pilot-%'
        UNION
        SELECT model_id, model_alias, run_index FROM trial_attempts
        WHERE project_id = ? AND run_index > 0
        UNION
        SELECT model_id, model_alias, run_index FROM trial_manifest
        WHERE project_id = ? AND run_index > 0
      )
      SELECT g.model_id, g.model_alias, g.run_index,
        (SELECT COUNT(*) FROM trial_results r
          WHERE r.project_id = ? AND r.model_id = g.model_id AND r.run_index = g.run_index
            AND r.validation_status = 'Valid') AS request_count,
        (SELECT COUNT(*) FROM trial_results r
          WHERE r.project_id = ? AND r.model_id = g.model_id AND r.run_index = g.run_index
            AND r.validation_status = 'Valid' AND r.task_type = 'Word to Color') AS word_count,
        (SELECT COUNT(*) FROM trial_results r
          WHERE r.project_id = ? AND r.model_id = g.model_id AND r.run_index = g.run_index
            AND r.validation_status = 'Valid' AND r.task_type = 'Color to Emotion') AS color_count,
        (SELECT COUNT(*) FROM trial_attempts a
          WHERE a.project_id = ? AND a.model_id = g.model_id AND a.run_index = g.run_index
            AND a.status != 'success') AS failed_attempt_count,
        COALESCE(
          (SELECT MIN(created_at) FROM trial_attempts a WHERE a.project_id = ? AND a.model_id = g.model_id AND a.run_index = g.run_index),
          (SELECT MIN(created_at) FROM trial_results r WHERE r.project_id = ? AND r.model_id = g.model_id AND r.run_index = g.run_index),
          (SELECT MIN(created_at) FROM trial_manifest m WHERE m.project_id = ? AND m.model_id = g.model_id AND m.run_index = g.run_index)
        ) AS started_at,
        COALESCE(
          (SELECT MAX(created_at) FROM trial_attempts a WHERE a.project_id = ? AND a.model_id = g.model_id AND a.run_index = g.run_index),
          (SELECT MAX(created_at) FROM trial_results r WHERE r.project_id = ? AND r.model_id = g.model_id AND r.run_index = g.run_index)
        ) AS completed_at
      FROM run_groups g
      ORDER BY g.model_alias, g.run_index`)
      .bind(PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID,
        PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID, PROJECT_ID).all(),
    db.prepare(`SELECT COALESCE(MAX(run_index), 0) + 1 AS next_run_index FROM (
      SELECT run_index FROM trial_results
      WHERE project_id = ? AND run_index > 0 AND trial_id NOT LIKE 'pilot-%'
      UNION ALL
      SELECT run_index FROM trial_manifest WHERE project_id = ? AND run_index > 0
    )`).bind(PROJECT_ID, PROJECT_ID).first(),
    db.prepare(`SELECT attempt_id, logical_trial_id, model_id, model_alias, task_type,
      run_index, stimulus_id, attempt_no, status, http_status, retryable,
      error_message, raw_response, latency_ms, created_at
      FROM trial_attempts
      WHERE project_id = ? AND status != 'success'
      ORDER BY created_at DESC LIMIT 50`).bind(PROJECT_ID).all(),
  ]);
  return Response.json({
    project, models: models.results, settings, results: results.results,
    counts: counts.results, groupSummaries: groupSummaries.results,
    nextRunIndex: Number(nextRun?.next_run_index || 1),
    recentFailures: recentFailures.results,
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const db = env.DB;
  const body = await request.json() as { action: string; data: Record<string, unknown> };
  const data = body.data;

  if (body.action === "saveProject") {
    await db.prepare(`UPDATE projects SET name=?, researcher=?, description=?, experiment_version=?,
      emotion_list_version=?, color_list_version=?, updated_at=? WHERE id=?`)
      .bind(data.name, data.researcher, data.description, data.experiment_version,
        data.emotion_list_version, data.color_list_version, new Date().toISOString(), PROJECT_ID).run();
  } else if (body.action === "saveSettings") {
    await db.prepare(`UPDATE experiment_settings SET repetitions=?, run_word_to_color=?,
      run_color_to_emotion=?, concurrency=?, max_retry=?, timeout_seconds=?, save_raw=? WHERE project_id=?`)
      .bind(data.repetitions, data.run_word_to_color ? 1 : 0, data.run_color_to_emotion ? 1 : 0,
        data.concurrency, data.max_retry, data.timeout_seconds, data.save_raw ? 1 : 0, PROJECT_ID).run();
    await db.prepare(`UPDATE experiment_settings SET prompt_seed_enabled=?, prompt_seed_base=?,
      native_seed_enabled=?, prompt_variants_enabled=?, model_scope=?, single_model_id=?,
      model_slot_ids=? WHERE project_id=?`)
      .bind(data.prompt_seed_enabled ? 1 : 0, data.prompt_seed_base,
        data.native_seed_enabled ? 1 : 0, data.prompt_variants_enabled ? 1 : 0,
        ["single", "slots"].includes(String(data.model_scope)) ? data.model_scope : "all",
        data.single_model_id || "model-gpt", typeof data.model_slot_ids === "string" ? data.model_slot_ids : '["model-gpt"]',
        PROJECT_ID).run();
    await db.prepare(`UPDATE experiment_settings SET shuffle_emotion_order=?, shuffle_color_order=?,
      shuffle_emotion_options=? WHERE project_id=?`)
      .bind(data.shuffle_emotion_order ? 1 : 0, data.shuffle_color_order ? 1 : 0,
        data.shuffle_emotion_options ? 1 : 0, PROJECT_ID).run();
  } else if (body.action === "saveModel") {
    await db.prepare(`UPDATE model_configs SET provider=?, alias=?, model_id=?, base_url=?, api_format=?,
      max_tokens=?, temperature=?, top_p=?, supports_seed=?, supports_json=?, rate_limit=?, enabled=? WHERE id=?`)
      .bind(data.provider, data.alias, data.model_id, data.base_url, data.api_format, data.max_tokens,
        data.temperature, data.top_p, data.supports_seed ? 1 : 0, data.supports_json ? 1 : 0,
        data.rate_limit, data.enabled ? 1 : 0, data.id).run();
  } else if (body.action === "testResult") {
    await db.prepare("UPDATE model_configs SET last_test_status=?, latency_ms=? WHERE id=?")
      .bind(data.status, data.latency_ms, data.id).run();
  } else if (body.action === "setStatus") {
    await db.prepare("UPDATE projects SET status=?, updated_at=? WHERE id=?")
      .bind(data.status, new Date().toISOString(), PROJECT_ID).run();
  }
  return Response.json({ ok: true });
}
