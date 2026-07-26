export type ExportProject = {
  id: string;
  name: string;
  researcher: string;
  description: string;
  status: string;
  experiment_version: string;
  emotion_list_version: string;
  color_list_version: string;
};

export type ExportModel = {
  id: string;
  provider: string;
  alias: string;
  model_id: string;
  base_url: string;
  api_format: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  supports_seed: number | boolean;
  supports_json: number | boolean;
  rate_limit: number;
  enabled: number | boolean;
};

export type ExportSettings = {
  repetitions: number;
  run_word_to_color: number | boolean;
  run_color_to_emotion: number | boolean;
  concurrency: number;
  max_retry: number;
  timeout_seconds: number;
  save_raw: number | boolean;
  prompt_seed_enabled: number | boolean;
  prompt_seed_base: number;
  native_seed_enabled: number | boolean;
  prompt_variants_enabled: number | boolean;
  model_scope: "all" | "single" | "slots";
  single_model_id: string;
  model_slot_ids: string;
  shuffle_emotion_order: number | boolean;
  shuffle_color_order: number | boolean;
  shuffle_emotion_options: number | boolean;
};

export type ExportResult = {
  trial_id: string;
  project_id: string;
  model_id: string;
  model_alias: string;
  task_type: string;
  run_index: number;
  stimulus_id: string;
  clean_json: string;
  raw_response: string;
  validation_status: string;
  retry_count: number;
  latency_ms: number;
  created_at: string;
};

export type ExportPayload = {
  project: ExportProject;
  models: ExportModel[];
  settings: ExportSettings;
  results: ExportResult[];
  failures?: ExportFailure[];
  manifest?: ExportManifest[];
  export_scope?: "complete" | "available";
};

export type ExportManifest = {
  logical_trial_id: string;
  batch_id: string;
  model_id: string;
  model_alias: string;
  task_type: string;
  run_index: number;
  stimulus_id: string;
  max_retry_count: number;
  created_at: string;
  repair_attempted_at: string | null;
  completed_at: string | null;
};

export type ExportFailure = {
  attempt_id: string;
  logical_trial_id: string;
  model_id: string;
  model_alias: string;
  task_type: string;
  run_index: number;
  stimulus_id: string;
  attempt_no: number;
  status: string;
  http_status: number | null;
  retryable: number | boolean;
  error_message: string;
  raw_response: string;
  latency_ms: number;
  created_at: string;
};

export const WORD_TO_COLOR_COLUMNS = [
  "实验ID", "平台", "模型", "模型别名", "回答内容", "生成时间", "温度", "Top P",
  "最大输出长度", "源请求数", "校验状态", "重试次数", "平均延迟(ms)",
] as const;

export const COLOR_TO_EMOTION_COLUMNS = [
  "实验ID", "平台", "模型", "模型别名", "颜色ID", "颜色HEX", "回答内容", "生成时间",
  "温度", "Top P", "最大输出长度", "校验状态", "重试次数", "延迟(ms)",
] as const;

export const SAMPLE_EMOTIONS = [
  ["后悔", "Regret"], ["赞赏", "Admiration"], ["羞愧", "Shame"], ["憎恨", "Hate"],
  ["满足", "Contentment"], ["同情", "Compassion"], ["自豪", "Pride"], ["欢乐", "Amusement"],
  ["愉快", "Pleasure"], ["失望", "Disappointment"], ["轻视", "Contempt"], ["悲伤", "Sadness"],
  ["如释重负", "Relief"], ["恐惧", "Fear"], ["欢愉", "Joy"], ["爱", "Love"],
  ["内疚", "Guilt"], ["感兴趣", "Interest"], ["忿怒", "Anger"], ["厌恶", "Disgust"],
] as const;

export const SAMPLE_COLUMNS = [
  ...SAMPLE_EMOTIONS.flatMap(([label]) => [
    `color_data.${label}.h`, `color_data.${label}.s`, `color_data.${label}.l`, `color_data.${label}.hex`,
  ]),
  "word_data.D38", "word_data.F17", "word_data.F4", "word_data.J0", "word_data.F0", "word_data.F29",
  "word_data.A0", "word_data.H35", "word_data.I6", "word_data.G3", "word_data.C9",
] as const;

type ExportCell = string | number | boolean | null;
export type ExportSheetRow = Record<string, ExportCell>;

function normalizeTask(task: string) {
  return task.toLowerCase().replaceAll(/[^a-z]/g, "");
}

function isWordToColor(task: string) {
  const value = normalizeTask(task);
  return value === "wordtocolor" || value === "wtc";
}

function isColorToEmotion(task: string) {
  const value = normalizeTask(task);
  return value === "colortoemotion" || value === "cte";
}

function isFormalResult(result: ExportResult) {
  return result.run_index > 0 && !result.trial_id.startsWith("pilot-");
}

function completeFormalResults(results: ExportResult[]) {
  const formal = results.filter(isFormalResult);
  const groups = new Map<string, { word: Set<string>; color: Set<string> }>();
  formal.forEach(result => {
    const key = `${result.model_id || result.model_alias}\u0000${result.run_index}`;
    const group = groups.get(key) || { word: new Set<string>(), color: new Set<string>() };
    if (isWordToColor(result.task_type)) group.word.add(result.stimulus_id);
    if (isColorToEmotion(result.task_type)) group.color.add(result.stimulus_id);
    groups.set(key, group);
  });
  const completeKeys = new Set([...groups.entries()]
    .filter(([, group]) => group.word.size === 20 && group.color.size === 11)
    .map(([key]) => key));
  return formal.filter(result => completeKeys.has(`${result.model_id || result.model_alias}\u0000${result.run_index}`));
}

function exportableFormalResults(payload: ExportPayload) {
  return payload.export_scope === "available"
    ? payload.results.filter(isFormalResult)
    : completeFormalResults(payload.results);
}

function parseJsonText(value: string): unknown {
  const trimmed = (value || "").trim();
  if (!trimmed) return undefined;

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [withoutFence];
  const objectStart = withoutFence.indexOf("{");
  const objectEnd = withoutFence.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(withoutFence.slice(objectStart, objectEnd + 1));
  const arrayStart = withoutFence.indexOf("[");
  const arrayEnd = withoutFence.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(withoutFence.slice(arrayStart, arrayEnd + 1));

  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try the next source-shaped candidate */ }
  }
  return undefined;
}

function sourceResponse(result: ExportResult): unknown {
  const raw = parseJsonText(result.raw_response);
  const clean = parseJsonText(result.clean_json);
  const parsed = raw ?? clean;

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const object = parsed as Record<string, unknown>;
    if (result.stimulus_id in object) return object[result.stimulus_id];
  }
  return parsed ?? result.raw_response ?? result.clean_json;
}

function jsonCell(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

function modelFor(payload: ExportPayload, result: ExportResult) {
  return payload.models.find(model => model.id === result.model_id)
    ?? payload.models.find(model => model.alias === result.model_alias);
}

function resultStatus(results: ExportResult[]) {
  return results.every(result => result.validation_status === "Valid") ? "Valid" : "包含无效记录";
}

function asCell(value: unknown): ExportCell {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return jsonCell(value);
}

function findStimulus(results: ExportResult[], stimulus: string) {
  const normalized = stimulus.toLowerCase();
  return results.find(result => result.stimulus_id.toLowerCase() === normalized);
}

function colorFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, unknown>;
  const object = value as Record<string, unknown>;
  const nested = object.color;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : object;
}

function scoreList(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.associations)) return object.associations;
  const scores = object.scores && typeof object.scores === "object" && !Array.isArray(object.scores)
    ? object.scores as Record<string, unknown>
    : object;
  return Object.entries(scores).map(([emotion, intensity]) => ({ emotion: emotion.toLowerCase(), intensity }));
}

export function buildWordToColorRows(payload: ExportPayload, emotions: readonly string[]): ExportSheetRow[] {
  const groups = new Map<string, ExportResult[]>();
  exportableFormalResults(payload).filter(result => isWordToColor(result.task_type)).forEach(result => {
    const key = `${result.model_id || result.model_alias}\u0000${result.run_index}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  });

  return [...groups.values()].map(group => {
    const first = group[0];
    const model = modelFor(payload, first);
    const byStimulus = new Map(group.map(result => [result.stimulus_id, result]));
    const answers: Record<string, unknown> = {};

    emotions.forEach(emotion => {
      const result = byStimulus.get(emotion);
      if (result) answers[emotion] = sourceResponse(result);
    });
    group.forEach(result => {
      if (!(result.stimulus_id in answers)) answers[result.stimulus_id] = sourceResponse(result);
    });

    const totalLatency = group.reduce((sum, result) => sum + Number(result.latency_ms || 0), 0);
    return {
      "实验ID": first.run_index,
      "平台": model?.provider ?? "",
      "模型": model?.model_id ?? first.model_id,
      "模型别名": model?.alias ?? first.model_alias,
      "回答内容": jsonCell(answers),
      "生成时间": group.map(result => result.created_at).sort().at(-1) ?? "",
      "温度": model?.temperature ?? "",
      "Top P": model?.top_p ?? "",
      "最大输出长度": model?.max_tokens ?? "",
      "源请求数": group.length,
      "校验状态": resultStatus(group),
      "重试次数": group.reduce((sum, result) => sum + Number(result.retry_count || 0), 0),
      "平均延迟(ms)": group.length ? Math.round(totalLatency / group.length) : 0,
    };
  }).sort((a, b) => String(a["模型别名"]).localeCompare(String(b["模型别名"])) || Number(a["实验ID"]) - Number(b["实验ID"]));
}

export function buildColorToEmotionRows(payload: ExportPayload, colors: ReadonlyArray<readonly [string, string]>): ExportSheetRow[] {
  const colorMap = new Map(colors);
  return exportableFormalResults(payload).filter(result => isColorToEmotion(result.task_type)).map(result => {
    const model = modelFor(payload, result);
    return {
      "实验ID": result.run_index,
      "平台": model?.provider ?? "",
      "模型": model?.model_id ?? result.model_id,
      "模型别名": model?.alias ?? result.model_alias,
      "颜色ID": result.stimulus_id,
      "颜色HEX": colorMap.get(result.stimulus_id) ?? "",
      "回答内容": jsonCell(sourceResponse(result)),
      "生成时间": result.created_at,
      "温度": model?.temperature ?? "",
      "Top P": model?.top_p ?? "",
      "最大输出长度": model?.max_tokens ?? "",
      "校验状态": result.validation_status,
      "重试次数": result.retry_count,
      "延迟(ms)": result.latency_ms,
    };
  }).sort((a, b) => String(a["模型别名"]).localeCompare(String(b["模型别名"])) || Number(a["实验ID"]) - Number(b["实验ID"]) || String(a["颜色ID"]).localeCompare(String(b["颜色ID"])));
}

export function buildColorToEmotionSourceRows(payload: ExportPayload, colors: ReadonlyArray<readonly [string, string]>): ExportSheetRow[] {
  const groups = new Map<string, ExportResult[]>();
  exportableFormalResults(payload).filter(result => isColorToEmotion(result.task_type)).forEach(result => {
    const key = `${result.model_id || result.model_alias}\u0000${result.run_index}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  });
  return [...groups.values()].map(group => {
    const first = group[0];
    const model = modelFor(payload, first);
    const answers: Record<string, unknown> = {};
    colors.forEach(([colorId]) => {
      const result = findStimulus(group, colorId);
      if (result) answers[colorId] = sourceResponse(result);
    });
    return {
      "实验ID": first.run_index,
      "平台": model?.provider ?? "",
      "模型": model?.model_id ?? first.model_id,
      "回答内容": jsonCell(answers),
      "生成时间": group.map(result => result.created_at).sort().at(-1) ?? "",
      "温度": model?.temperature ?? "",
      "Top P": model?.top_p ?? "",
      "最大输出长度": model?.max_tokens ?? "",
    };
  });
}

export function buildSampleRows(payload: ExportPayload, colors: ReadonlyArray<readonly [string, string]>): ExportSheetRow[] {
  const groups = new Map<string, ExportResult[]>();
  exportableFormalResults(payload).forEach(result => {
    const key = `${result.model_id || result.model_alias}\u0000${result.run_index}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  });

  return [...groups.values()].map(group => {
    const row: ExportSheetRow = Object.fromEntries(SAMPLE_COLUMNS.map(column => [column, ""]));
    const wordResults = group.filter(result => isWordToColor(result.task_type));
    const colorResults = group.filter(result => isColorToEmotion(result.task_type));

    SAMPLE_EMOTIONS.forEach(([label, emotion]) => {
      const result = findStimulus(wordResults, emotion);
      if (!result) return;
      const fields = colorFields(sourceResponse(result));
      (["h", "s", "l", "hex"] as const).forEach(field => {
        row[`color_data.${label}.${field}`] = asCell(fields[field]);
      });
    });

    colors.forEach(([colorId]) => {
      const result = findStimulus(colorResults, colorId);
      if (result) row[`word_data.${colorId}`] = jsonCell(scoreList(sourceResponse(result)));
    });
    return row;
  });
}

export function buildSampleManifestRows(payload: ExportPayload): ExportSheetRow[] {
  const groups = new Map<string, ExportResult[]>();
  exportableFormalResults(payload).forEach(result => {
    const key = `${result.model_id || result.model_alias}\u0000${result.run_index}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  });
  return [...groups.values()].map((group, index) => {
    const first = group[0];
    const model = modelFor(payload, first);
    return {
      "样本数据行": index + 2,
      "实验ID": first.run_index,
      "平台": model?.provider ?? "",
      "模型": model?.model_id ?? first.model_id,
      "模型别名": model?.alias ?? first.model_alias,
      "词选色源请求数": group.filter(result => isWordToColor(result.task_type)).length,
      "色选词源请求数": group.filter(result => isColorToEmotion(result.task_type)).length,
      "校验状态": resultStatus(group),
      "重试次数": group.reduce((sum, result) => sum + Number(result.retry_count || 0), 0),
      "生成时间": group.map(result => result.created_at).sort().at(-1) ?? "",
    };
  });
}

export function buildExperimentConditionRows(payload: ExportPayload): ExportSheetRow[] {
  return payload.models.map(model => ({
    "项目ID": payload.project.id,
    "项目名称": payload.project.name,
    "实验版本": payload.project.experiment_version,
    "平台": model.provider,
    "模型": model.model_id,
    "模型别名": model.alias,
    "模型启用": Boolean(model.enabled),
    "Temperature": model.temperature,
    "Top P": model.top_p,
    "最大输出长度": model.max_tokens,
    "重复次数": payload.settings.repetitions,
    "并发数": payload.settings.concurrency,
    "最大重试": payload.settings.max_retry,
    "运行中即时重试上限": Math.max(0, payload.settings.max_retry - 1),
    "结束后补齐上限": payload.settings.max_retry > 0 ? 1 : 0,
    "补齐规则": "仅技术失败或未发出的缺失试次；有效结果不重抽",
    "超时(秒)": payload.settings.timeout_seconds,
    "提示词随机种子": Boolean(payload.settings.prompt_seed_enabled),
    "基础Seed": payload.settings.prompt_seed_base,
    "模型原生Seed": Boolean(payload.settings.native_seed_enabled),
    "模型声明支持Seed": Boolean(model.supports_seed),
    "等价提示词轮换": Boolean(payload.settings.prompt_variants_enabled),
    "运行模型范围": payload.settings.model_scope === "slots" ? "并行独立模型组" : payload.settings.model_scope === "single" ? "单模型" : "全部已启用模型",
    "单模型ID": payload.settings.model_scope === "single" ? payload.settings.single_model_id : "",
    "并行模型组ID": payload.settings.model_scope === "slots" ? payload.settings.model_slot_ids : "",
    "实验一情绪询问乱序": Boolean(payload.settings.shuffle_emotion_order),
    "实验二颜色询问乱序": Boolean(payload.settings.shuffle_color_order),
    "实验二情绪选项乱序": Boolean(payload.settings.shuffle_emotion_options),
    "提示词变体数量": 3,
    "实验语言": "English",
    "文化角色设定": "无",
    "输入形式": "仅文本",
    "上下文": "相互独立",
    "原始响应": Boolean(payload.settings.save_raw),
  }));
}

export function buildTrialManifestRows(payload: ExportPayload): ExportSheetRow[] {
  return (payload.manifest ?? []).map(item => ({
    "逻辑试次ID": item.logical_trial_id,
    "批次ID": item.batch_id,
    "模型ID": item.model_id,
    "模型别名": item.model_alias,
    "任务": item.task_type,
    "重复轮次": item.run_index,
    "刺激项": item.stimulus_id,
    "总重试上限": item.max_retry_count,
    "清单登记时间": item.created_at,
    "结束后补齐时间": item.repair_attempted_at ?? "",
    "有效结果时间": item.completed_at ?? "",
    "最终状态": item.completed_at ? "Valid" : item.repair_attempted_at ? "补齐后仍缺失" : "待检查",
  }));
}

export function buildWorkbookSheets(payload: ExportPayload, emotions: readonly string[], colors: ReadonlyArray<readonly [string, string]>) {
  const wordRows = buildWordToColorRows(payload, emotions);
  const colorRows = buildColorToEmotionRows(payload, colors);
  return {
    README: [
      { "项目": "导出说明", "内容": "词选色按“模型 × 重复轮次”合并为一行；色选词按源请求保留一行。" },
      { "项目": "颜色格式", "内容": "保留模型返回的源色彩字段，不从 HEX 计算 RGB、HSV 或 Lab。" },
      { "项目": "回答内容", "内容": "JSON 文本保留源字段结构，便于与原始多模型实验结果直接对照。" },
      { "项目": "安全", "内容": "API Key 不写入数据库，也不包含在任何导出文件中。" },
      { "项目": "缺失补齐", "内容": "仅对清单中无有效结果且最后错误可重试的试次执行一次；有效回答绝不重新抽样。" },
      { "项目": "项目ID", "内容": payload.project.id },
      { "项目": "实验版本", "内容": payload.project.experiment_version },
    ],
    experiment_config: [
      { "配置项": "项目名称", "值": payload.project.name },
      { "配置项": "研究负责人", "值": payload.project.researcher },
      { "配置项": "项目说明", "值": payload.project.description },
      { "配置项": "项目状态", "值": payload.project.status },
      { "配置项": "重复次数", "值": payload.settings.repetitions },
      { "配置项": "运行词选色", "值": Boolean(payload.settings.run_word_to_color) },
      { "配置项": "运行色选词", "值": Boolean(payload.settings.run_color_to_emotion) },
      { "配置项": "并发数", "值": payload.settings.concurrency },
      { "配置项": "并行模型组ID", "值": payload.settings.model_slot_ids || "" },
      { "配置项": "最大重试", "值": payload.settings.max_retry },
      { "配置项": "运行中即时重试上限", "值": Math.max(0, payload.settings.max_retry - 1) },
      { "配置项": "结束后补齐上限", "值": payload.settings.max_retry > 0 ? 1 : 0 },
      { "配置项": "超时（秒）", "值": payload.settings.timeout_seconds },
      { "配置项": "提示词随机种子", "值": Boolean(payload.settings.prompt_seed_enabled) },
      { "配置项": "基础 Seed", "值": payload.settings.prompt_seed_base },
      { "配置项": "模型原生 Seed", "值": Boolean(payload.settings.native_seed_enabled) },
      { "配置项": "等价提示词轮换", "值": Boolean(payload.settings.prompt_variants_enabled) },
    ],
    model_config: payload.models.map(model => ({
      "平台": model.provider, "模型别名": model.alias, "模型": model.model_id,
      "API 格式": model.api_format, "Base URL": model.base_url, "温度": model.temperature,
      "Top P": model.top_p, "最大输出长度": model.max_tokens, "限速/分钟": model.rate_limit,
      "启用": Boolean(model.enabled),
    })),
    emotion_list: emotions.map((emotion, index) => ({
      "情绪ID": `E${String(index + 1).padStart(2, "0")}`, "情绪词": emotion,
      "顺序": index + 1, "版本": payload.project.emotion_list_version,
    })),
    color_list: colors.map(([id, hex], index) => ({
      "颜色ID": id, "HEX": hex, "顺序": index + 1, "版本": payload.project.color_list_version,
    })),
    word_to_color_source: wordRows,
    color_to_emotion_source: colorRows,
    trial_manifest: buildTrialManifestRows(payload),
    invalid_records: (payload.failures ?? []).map(failure => ({
      "尝试ID": failure.attempt_id,
      "试次ID": failure.logical_trial_id,
      "模型别名": failure.model_alias,
      "任务": failure.task_type,
      "重复轮次": failure.run_index,
      "刺激项": failure.stimulus_id,
      "尝试次数": failure.attempt_no + 1,
      "失败类别": failure.status,
      "HTTP状态": failure.http_status,
      "可重试": Boolean(failure.retryable),
      "失败原因": failure.error_message,
      "源回答": failure.raw_response,
      "延迟(ms)": failure.latency_ms,
      "生成时间": failure.created_at,
    })),
  } satisfies Record<string, ExportSheetRow[]>;
}

export function toCsv(rows: ExportSheetRow[], columns: readonly string[]) {
  const escape = (value: ExportCell | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `\uFEFF${columns.map(escape).join(",")}\n${rows.map(row => columns.map(column => escape(row[column])).join(",")).join("\n")}`;
}
