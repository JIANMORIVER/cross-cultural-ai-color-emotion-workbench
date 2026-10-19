import { env } from "cloudflare:workers";

const PROJECT_ID = "ECX-2026-001";

export async function GET(request: Request) {
  const db = env.DB;
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trial_results'").first();
  if (!table) return Response.json({ error: "Workspace is not initialized." }, { status: 409 });

  // A grouped round produces one source response but expands it into 31 result
  // rows. Returning that same long response on every row made a normal export
  // payload tens of megabytes large, which in turn caused browser-side XLSX and
  // ZIP generation to stall or fail. The validated per-stimulus JSON is the
  // canonical export value, so raw text is deliberately opt-in for diagnostics.
  const includeRaw = new URL(request.url).searchParams.get("include_raw") === "1";
  const scopeRequested = new URL(request.url).searchParams.get("scope") === "selected";
  const requestedGroups = new URL(request.url).searchParams.getAll("group")
    .map(value => {
      const divider = value.lastIndexOf("\t");
      const modelId = divider > 0 ? value.slice(0, divider) : "";
      const runIndex = Number(value.slice(divider + 1));
      return modelId && Number.isInteger(runIndex) && runIndex > 0 ? { modelId, runIndex } : null;
    })
    .filter((value): value is { modelId: string; runIndex: number } => Boolean(value));
  const groupWhere = requestedGroups.length
    ? ` AND (${requestedGroups.map(() => "(model_id = ? AND run_index = ?)").join(" OR ")})`
    : scopeRequested ? " AND 1 = 0" : "";
  const groupBindings = requestedGroups.flatMap(group => [group.modelId, group.runIndex]);
  const resultRawColumn = includeRaw ? "raw_response" : "'' AS raw_response";
  const failureRawColumn = includeRaw ? "raw_response" : "'' AS raw_response";

  const [project, models, settings, results, failures, manifest] = await Promise.all([
    db.prepare("SELECT * FROM projects WHERE id = ?").bind(PROJECT_ID).first(),
    db.prepare("SELECT * FROM model_configs WHERE project_id = ? ORDER BY rowid").bind(PROJECT_ID).all(),
    db.prepare(`SELECT repetitions, run_word_to_color, run_color_to_emotion, concurrency,
      max_retry, timeout_seconds, save_raw, prompt_seed_enabled, prompt_seed_base,
      native_seed_enabled, prompt_variants_enabled, model_scope, single_model_id, model_slot_ids,
      shuffle_emotion_order, shuffle_color_order, shuffle_emotion_options
      FROM experiment_settings WHERE project_id = ?`).bind(PROJECT_ID).first(),
    db.prepare(`SELECT trial_id, project_id, model_id, model_alias, task_type, run_index,
      stimulus_id, clean_json, ${resultRawColumn}, validation_status, retry_count, latency_ms, created_at,
      collection_mode, source_job_id, protocol_version
      FROM trial_results WHERE project_id = ?${groupWhere}
      ORDER BY model_alias, task_type, run_index, stimulus_id`).bind(PROJECT_ID, ...groupBindings).all(),
    db.prepare(`SELECT attempt_id, logical_trial_id, model_id, model_alias, task_type,
      run_index, stimulus_id, attempt_no, status, http_status, retryable,
      error_message, ${failureRawColumn}, latency_ms, created_at
      FROM trial_attempts
      WHERE project_id = ? AND status != 'success'${groupWhere}
      ORDER BY model_alias, run_index, stimulus_id, attempt_no`).bind(PROJECT_ID, ...groupBindings).all(),
    db.prepare(`SELECT logical_trial_id, batch_id, model_id, model_alias, task_type,
      run_index, stimulus_id, max_retry_count, created_at, repair_attempted_at, completed_at
      FROM trial_manifest WHERE project_id = ?${groupWhere}
      ORDER BY model_alias, run_index, task_type, stimulus_index`).bind(PROJECT_ID, ...groupBindings).all(),
  ]);

  return Response.json({
    project,
    models: models.results,
    settings,
    results: results.results,
    failures: failures.results,
    manifest: manifest.results,
    raw_response_included: includeRaw,
    selected_group_count: scopeRequested ? requestedGroups.length : null,
  }, {
    headers: {
      // The response can contain thousands of rows; avoid retaining a stale,
      // much larger version while the researcher is choosing export groups.
      "Cache-Control": "no-store",
    },
  });
}
