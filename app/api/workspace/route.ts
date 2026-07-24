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
    db.prepare("CREATE INDEX IF NOT EXISTS trial_project_idx ON trial_results(project_id, task_type)"),
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
    ["shuffle_emotion_order", "ALTER TABLE experiment_settings ADD COLUMN shuffle_emotion_order INTEGER NOT NULL DEFAULT 1"],
    ["shuffle_color_order", "ALTER TABLE experiment_settings ADD COLUMN shuffle_color_order INTEGER NOT NULL DEFAULT 1"],
    ["shuffle_emotion_options", "ALTER TABLE experiment_settings ADD COLUMN shuffle_emotion_options INTEGER NOT NULL DEFAULT 1"],
  ].filter(([column]) => !settingsColumnNames.has(column));
  if (settingsMigrations.length) await db.batch(settingsMigrations.map(([, sql]) => db.prepare(sql)));

  const existing = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(PROJECT_ID).first();
  if (!existing) {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(PROJECT_ID, "Cross-model Emotion–Color Study", "Jianmo", "Standardized English-only comparison of AI emotion–color associations.", "1.0", "GEW-20 v1.0", "Munsell-11 v1.0", "Draft", now, now),
      db.prepare(`INSERT INTO experiment_settings (
        project_id, repetitions, run_word_to_color, run_color_to_emotion, concurrency,
        max_retry, timeout_seconds, save_raw, prompt_seed_enabled, prompt_seed_base,
        native_seed_enabled, prompt_variants_enabled, model_scope, single_model_id,
        shuffle_emotion_order, shuffle_color_order, shuffle_emotion_options
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(PROJECT_ID, 100, 1, 1, 2, 3, 60, 1, 0, 20260715, 0, 0, "all", "model-gpt", 1, 1, 1),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-gpt", PROJECT_ID, "OpenAI", "GPT", "gpt-5.6", "https://api.openai.com/v1", "OpenAI Chat Completions", 500, 0.8, 1, 0, 1, 60, 1, "Not tested", null),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-deepseek", PROJECT_ID, "DeepSeek", "DeepSeek", "deepseek-chat", "https://api.deepseek.com/v1", "OpenAI-compatible", 500, 0.8, 1, 0, 1, 60, 1, "Not tested", null),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-doubao", PROJECT_ID, "ByteDance", "Doubao", "doubao-seed-1-6", "https://ark.cn-beijing.volces.com/api/v3", "OpenAI-compatible", 500, 0.8, 1, 0, 1, 60, 1, "Not tested", null),
      db.prepare(`INSERT INTO model_configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind("model-gemini", PROJECT_ID, "Google", "Gemini", "gemini-2.5-flash", "https://generativelanguage.googleapis.com/v1beta/openai", "OpenAI-compatible", 500, 0.8, 1, 0, 1, 60, 1, "Not tested", null),
    ]);
  }
}

export async function GET() {
  await ensureSchema();
  const db = env.DB;
  const [project, models, settings, results, counts, groupSummaries, nextRun] = await Promise.all([
    db.prepare("SELECT * FROM projects WHERE id = ?").bind(PROJECT_ID).first(),
    db.prepare("SELECT * FROM model_configs WHERE project_id = ? ORDER BY rowid").bind(PROJECT_ID).all(),
    db.prepare("SELECT * FROM experiment_settings WHERE project_id = ?").bind(PROJECT_ID).first(),
    db.prepare("SELECT * FROM trial_results WHERE project_id = ? ORDER BY created_at DESC LIMIT 80").bind(PROJECT_ID).all(),
    db.prepare(`SELECT task_type, validation_status, COUNT(*) AS count
      FROM trial_results WHERE project_id = ? GROUP BY task_type, validation_status`).bind(PROJECT_ID).all(),
    db.prepare(`SELECT model_id, model_alias, run_index,
      COUNT(*) AS request_count,
      SUM(CASE WHEN task_type = 'Word to Color' THEN 1 ELSE 0 END) AS word_count,
      SUM(CASE WHEN task_type = 'Color to Emotion' THEN 1 ELSE 0 END) AS color_count,
      MIN(created_at) AS started_at, MAX(created_at) AS completed_at
      FROM trial_results
      WHERE project_id = ? AND run_index > 0 AND trial_id NOT LIKE 'pilot-%'
      GROUP BY model_id, model_alias, run_index
      ORDER BY model_alias, run_index`).bind(PROJECT_ID).all(),
    db.prepare(`SELECT COALESCE(MAX(run_index), 0) + 1 AS next_run_index
      FROM trial_results
      WHERE project_id = ? AND run_index > 0 AND trial_id NOT LIKE 'pilot-%'`).bind(PROJECT_ID).first(),
  ]);
  return Response.json({ project, models: models.results, settings, results: results.results, counts: counts.results, groupSummaries: groupSummaries.results, nextRunIndex: Number(nextRun?.next_run_index || 1) });
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
      native_seed_enabled=?, prompt_variants_enabled=?, model_scope=?, single_model_id=? WHERE project_id=?`)
      .bind(data.prompt_seed_enabled ? 1 : 0, data.prompt_seed_base,
        data.native_seed_enabled ? 1 : 0, data.prompt_variants_enabled ? 1 : 0,
        data.model_scope === "single" ? "single" : "all", data.single_model_id || "model-gpt", PROJECT_ID).run();
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
