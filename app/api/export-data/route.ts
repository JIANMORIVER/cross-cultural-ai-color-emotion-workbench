import { env } from "cloudflare:workers";

const PROJECT_ID = "ECX-2026-001";

export async function GET() {
  const db = env.DB;
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trial_results'").first();
  if (!table) return Response.json({ error: "Workspace is not initialized." }, { status: 409 });

  const [project, models, settings, results, failures] = await Promise.all([
    db.prepare("SELECT * FROM projects WHERE id = ?").bind(PROJECT_ID).first(),
    db.prepare("SELECT * FROM model_configs WHERE project_id = ? ORDER BY rowid").bind(PROJECT_ID).all(),
    db.prepare(`SELECT repetitions, run_word_to_color, run_color_to_emotion, concurrency,
      max_retry, timeout_seconds, save_raw, prompt_seed_enabled, prompt_seed_base,
      native_seed_enabled, prompt_variants_enabled, model_scope, single_model_id,
      shuffle_emotion_order, shuffle_color_order, shuffle_emotion_options
      FROM experiment_settings WHERE project_id = ?`).bind(PROJECT_ID).first(),
    db.prepare(`SELECT trial_id, project_id, model_id, model_alias, task_type, run_index,
      stimulus_id, clean_json, raw_response, validation_status, retry_count, latency_ms, created_at
      FROM trial_results WHERE project_id = ?
      ORDER BY model_alias, task_type, run_index, stimulus_id`).bind(PROJECT_ID).all(),
    db.prepare(`SELECT attempt_id, logical_trial_id, model_id, model_alias, task_type,
      run_index, stimulus_id, attempt_no, status, http_status, retryable,
      error_message, raw_response, latency_ms, created_at
      FROM trial_attempts
      WHERE project_id = ? AND status != 'success'
      ORDER BY model_alias, run_index, stimulus_id, attempt_no`).bind(PROJECT_ID).all(),
  ]);

  return Response.json({
    project,
    models: models.results,
    settings,
    results: results.results,
    failures: failures.results,
  });
}
