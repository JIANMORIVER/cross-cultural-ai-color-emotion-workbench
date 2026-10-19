"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisPlatform } from "./AnalysisPlatform";
import { GeminiBatchPanel } from "./GeminiBatchPanel";
import { experimentOrders } from "./experiment/prompts";
import {
  isDoubao21Pro,
  isGemini31Pro,
  isGemini36Flash,
  reasoningModeForModel,
  supportsSamplingControls,
} from "./experiment/model-request";
import {
  effectiveRequestsPerMinute,
  effectiveTimeoutSeconds,
  GEMINI_STABLE_POLICY,
  retryDelayMilliseconds,
  totalAttemptLimit,
  usesGeminiStablePolicy,
} from "./experiment/execution-policy";
import {
  GEMINI_DAILY_COMPLETE_ROUNDS,
  GEMINI_DAILY_FORMAL_REQUESTS,
  GEMINI_DAILY_QUOTA_REFERENCE,
  GEMINI_DAILY_RESERVE,
  summarizeGeminiDailyBudget,
  type GeminiDailyBudget,
} from "./experiment/daily-budget";
import {
  buildColorToEmotionRows,
  buildColorToEmotionSourceRows,
  buildExperimentConditionRows,
  buildSampleManifestRows,
  buildSampleRows,
  buildTrialManifestRows,
  buildWordToColorRows,
  COLOR_TO_EMOTION_COLUMNS,
  SAMPLE_COLUMNS,
  toCsv,
  WORD_TO_COLOR_COLUMNS,
  type ExportPayload,
} from "./export/source-export";

type Project = {
  id: string; name: string; researcher: string; description: string; status: string;
  experiment_version: string; emotion_list_version: string; color_list_version: string;
};

type Model = {
  id: string; provider: string; alias: string; model_id: string; base_url: string;
  api_format: string; max_tokens: number; temperature: number; top_p: number;
  supports_seed: number | boolean; supports_json: number | boolean; rate_limit: number;
  enabled: number | boolean; last_test_status: string; latency_ms: number | null;
};

type Settings = {
  repetitions: number; run_word_to_color: number | boolean; run_color_to_emotion: number | boolean;
  concurrency: number; max_retry: number; timeout_seconds: number; save_raw: number | boolean;
  prompt_seed_enabled: number | boolean; prompt_seed_base: number;
  native_seed_enabled: number | boolean; prompt_variants_enabled: number | boolean;
  model_scope: "all" | "single" | "slots"; single_model_id: string; model_slot_ids: string;
  shuffle_emotion_order: number | boolean; shuffle_color_order: number | boolean;
  shuffle_emotion_options: number | boolean;
};

type ResultRow = {
  trial_id: string; project_id: string; model_id: string; model_alias: string;
  task_type: string; run_index: number; stimulus_id: string; clean_json: string;
  raw_response: string; validation_status: string;
  retry_count: number; latency_ms: number; created_at: string;
};

type RunnerState = "idle" | "ready" | "running" | "paused" | "completed";

type QueueTrial = {
  model: Model;
  task: "word" | "color";
  runIndex: number;
  stimulusId: string;
  stimulusHex?: string;
  stimulusIndex: number;
};

type SubmissionGroup = {
  model: Model;
  task: "word" | "color";
  runIndex: number;
  trials: QueueTrial[];
};

type RunPlan = {
  model: Model;
  rounds: number;
};

type RunStats = {
  completed: number;
  valid: number;
  failed: number;
  retries: number;
  latencyTotal: number;
  active: number;
};

type GeminiRunState = {
  status: "idle" | "ready" | "running" | "cooling";
  consecutiveFailures: number;
  cooldownUntil: number;
};

type ModelRunProgress = Record<string, {
  completed: number;
  valid: number;
  word: number;
  color: number;
}>;

type RunGroupSummary = {
  model_id: string;
  model_alias: string;
  run_index: number;
  request_count: number;
  word_count: number;
  color_count: number;
  failed_attempt_count?: number;
  started_at: string | null;
  completed_at: string | null;
};

type FailureAttempt = {
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

type RepairTrial = {
  logicalTrialId: string;
  batchId: string;
  modelId: string;
  modelAlias: string;
  task: "word" | "color";
  runIndex: number;
  stimulusId: string;
  stimulusHex: string;
  stimulusIndex: number;
  nextAttempt: number;
  maxRetryCount: number;
  model: Model;
  settings: Settings;
};

const EMOTIONS = [
  "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
  "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
];

const COLORS = [
  ["J0", "#262626"], ["A0", "#F2F2F2"], ["G3", "#BB1F23"], ["F17", "#00904A"], ["C9", "#FFBC00"],
  ["F29", "#007FD3"], ["I6", "#4B2819"], ["H35", "#6F2A78"], ["D38", "#F38EBB"], ["F4", "#DD4200"], ["F0", "#808080"],
] as const;

const NAV = [
  ["setup", "01", "项目设置"], ["models", "02", "模型配置"],
  ["experiment", "03", "实验设计"], ["runner", "04", "实验运行"],
  ["batch", "04B", "Gemini Batch"],
  ["review", "05", "数据审阅"], ["export", "06", "导出与归档"],
  ["analysis", "07", "数据分析"],
] as const;

const STATUS_LABELS: Record<string, string> = {
  Draft: "草稿", Ready: "就绪", Running: "运行中", Paused: "已暂停",
  Completed: "已完成", Failed: "失败", Archived: "已归档",
};

const defaultProject: Project = {
  id: "ECX-2026-001", name: "Cross-model Emotion–Color Study", researcher: "Jianmo",
  description: "Standardized English-only comparison of AI emotion–color associations.", status: "Draft",
  experiment_version: "1.1-20x11", emotion_list_version: "GEW-20 v1.0", color_list_version: "Munsell-11 v1.0",
};

const defaultSettings: Settings = {
  repetitions: 100, run_word_to_color: true, run_color_to_emotion: true,
  concurrency: 2, max_retry: 3, timeout_seconds: 180, save_raw: true,
  prompt_seed_enabled: false, prompt_seed_base: 20260715,
  native_seed_enabled: false, prompt_variants_enabled: false,
  model_scope: "all", single_model_id: "model-gpt", model_slot_ids: '["model-gpt"]',
  shuffle_emotion_order: true, shuffle_color_order: true, shuffle_emotion_options: true,
};

const defaultModels: Model[] = [
  { id: "model-gpt", provider: "OpenAI", alias: "GPT", model_id: "gpt-5.6", base_url: "https://api.openai.com/v1", api_format: "OpenAI Chat Completions", max_tokens: 2048, temperature: 1, top_p: 1, supports_seed: false, supports_json: true, rate_limit: 60, enabled: true, last_test_status: "Not tested", latency_ms: null },
  { id: "model-deepseek", provider: "DeepSeek", alias: "DeepSeek", model_id: "deepseek-v4-pro", base_url: "https://api.deepseek.com", api_format: "OpenAI-compatible", max_tokens: 2048, temperature: 1, top_p: 1, supports_seed: false, supports_json: true, rate_limit: 60, enabled: true, last_test_status: "Not tested", latency_ms: null },
  { id: "model-doubao", provider: "ByteDance", alias: "Doubao", model_id: "doubao-seed-2-1-pro-260628", base_url: "https://ark.cn-beijing.volces.com/api/v3", api_format: "OpenAI-compatible", max_tokens: 2048, temperature: 1, top_p: 1, supports_seed: false, supports_json: true, rate_limit: 60, enabled: true, last_test_status: "Not tested", latency_ms: null },
  { id: "model-gemini", provider: "Google", alias: "Gemini", model_id: "gemini-3.1-pro-preview", base_url: "https://generativelanguage.googleapis.com/v1beta", api_format: "Gemini native generateContent", max_tokens: 2048, temperature: 1, top_p: 1, supports_seed: false, supports_json: true, rate_limit: 8, enabled: true, last_test_status: "Not tested", latency_ms: null },
];

const MODEL_VARIANTS = {
  openai: [
    ["GPT 5.6（旗舰别名）", "gpt-5.6"], ["GPT 5.6 Sol", "gpt-5.6-sol"],
    ["GPT 5.6 Terra", "gpt-5.6-terra"], ["GPT 5.6 Luna", "gpt-5.6-luna"],
    ["GPT 4.1 Mini（旧版对照）", "gpt-4.1-mini"],
  ],
  google: [
    ["Gemini 3.6 Flash（稳定版）", "gemini-3.6-flash"],
    ["Gemini 3.1 Pro Preview", "gemini-3.1-pro-preview"],
    ["Gemini 3.5 Flash（旧版对照）", "gemini-3.5-flash"],
    ["Gemini 2.5 Flash（旧版对照）", "gemini-2.5-flash"],
  ],
  deepseek: [
    ["DeepSeek V4 Flash", "deepseek-v4-flash"], ["DeepSeek V4 Pro", "deepseek-v4-pro"],
  ],
  bytedance: [
    ["Doubao Seed 2.1 Pro", "doubao-seed-2-1-pro-260628"],
    ["Doubao Seed 2.0 Pro（旧版对照）", "doubao-seed-2-0-pro-260215"],
    ["Doubao Seed 1.6（旧版对照）", "doubao-seed-1-6"],
  ],
} as const;

function variantsFor(model: Model) {
  const signature = `${model.provider} ${model.base_url}`.toLowerCase();
  if (signature.includes("google") || signature.includes("gemini")) return MODEL_VARIANTS.google;
  if (signature.includes("deepseek")) return MODEL_VARIANTS.deepseek;
  if (signature.includes("byte") || signature.includes("volc") || signature.includes("doubao")) return MODEL_VARIANTS.bytedance;
  return MODEL_VARIANTS.openai;
}

function modelVariantPatch(model: Model, modelId: string): Partial<Model> {
  const gemini = /^gemini-3(?:\.|-)/i.test(modelId);
  return {
    model_id: modelId,
    base_url: gemini ? "https://generativelanguage.googleapis.com/v1beta" : model.base_url,
    api_format: gemini ? "Gemini native generateContent" : modelId.startsWith("gpt-5.6") ? "OpenAI Chat Completions" : model.api_format,
    supports_seed: modelId.startsWith("gpt-5.6") ? false : model.supports_seed,
    max_tokens: 2048,
    temperature: 1,
    top_p: 1,
    last_test_status: "Not tested",
    latency_ms: null,
  };
}

function bool(value: number | boolean) { return value === true || value === 1; }
function number(value: number | string) { return typeof value === "number" ? value : Number(value); }
function executionSettingsForModel(model: Model, settings: Settings) {
  if (!usesGeminiStablePolicy(model)) return settings;
  return {
    ...settings,
    max_retry: totalAttemptLimit(model, settings.max_retry),
    timeout_seconds: effectiveTimeoutSeconds(model, settings.timeout_seconds),
    execution_policy: GEMINI_STABLE_POLICY.id,
    effective_concurrency: GEMINI_STABLE_POLICY.concurrency,
    effective_rate_limit: effectiveRequestsPerMinute(model),
    retry_delays_seconds: GEMINI_STABLE_POLICY.retryDelaysMs.map(delay => delay / 1000),
    cooldown_threshold: GEMINI_STABLE_POLICY.cooldownThreshold,
    cooldown_seconds: GEMINI_STABLE_POLICY.cooldownMs / 1000,
  };
}
function runGroupKey(modelId: string, runIndex: number) { return `${modelId}::${runIndex}`; }
function isCompleteRunGroup(group: RunGroupSummary) { return Number(group.word_count) === 20 && Number(group.color_count) === 11; }
function groupForSubmission(queue: QueueTrial[]) {
  const groups = new Map<string, SubmissionGroup>();
  queue.forEach(trial => {
    const key = `${trial.model.id}\u0000${trial.task}\u0000${trial.runIndex}`;
    const current = groups.get(key) || { model: trial.model, task: trial.task, runIndex: trial.runIndex, trials: [] };
    current.trials.push(trial);
    groups.set(key, current);
  });
  return [...groups.values()];
}
function modelSlotIds(settings: Settings, models: Model[]) {
  if (settings.model_scope === "single") return [settings.single_model_id].filter(Boolean);
  if (settings.model_scope === "slots") {
    try {
      const parsed = JSON.parse(settings.model_slot_ids || "[]");
      if (Array.isArray(parsed)) return [...new Set(parsed.map(String))].filter(id => models.some(model => model.id === id)).slice(0, 4);
    } catch {
      return [];
    }
  }
  return models.filter(model => bool(model.enabled)).slice(0, 4).map(model => model.id);
}

function restoreSessionKeys() {
  if (typeof window === "undefined") return {};
  const restored: Record<string, string> = {};
  defaultModels.forEach(m => {
    const value = sessionStorage.getItem(`chromalab-key-${m.id}`);
    if (value) restored[m.id] = value;
  });
  return restored;
}

function download(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Logo() {
  return <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>CHROMA<em>LAB</em></span></div>;
}

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked} aria-label={label} disabled={disabled}><span /></button>;
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}><span className="dot" />{children}</span>;
}

export function ExperimentPlatform() {
  const [page, setPage] = useState("setup");
  const [project, setProject] = useState<Project>(defaultProject);
  const [models, setModels] = useState<Model[]>(defaultModels);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("model-gpt");
  const [keys, setKeys] = useState<Record<string, string>>(restoreSessionKeys);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [pilotTesting, setPilotTesting] = useState<"" | "word" | "color">("");
  const [runnerState, setRunnerState] = useState<RunnerState>("idle");
  const runnerStateRef = useRef<RunnerState>("idle");
  const activeRunGroupsRef = useRef(0);
  const launchedModelIdsRef = useRef<Set<string>>(new Set());
  const startingModelIdsRef = useRef<Set<string>>(new Set());
  const [launchedModelIds, setLaunchedModelIds] = useState<string[]>([]);
  const [runStats, setRunStats] = useState<RunStats>({ completed: 0, valid: 0, failed: 0, retries: 0, latencyTotal: 0, active: 0 });
  const [modelRunProgress, setModelRunProgress] = useState<ModelRunProgress>({});
  const [scheduledTrialTotal, setScheduledTrialTotal] = useState(0);
  const [plannedRoundsByModel, setPlannedRoundsByModel] = useState<Record<string, number>>({});
  const [lastRunError, setLastRunError] = useState("");
  const [runActivity, setRunActivity] = useState("");
  const [geminiRunState, setGeminiRunState] = useState<GeminiRunState>({ status: "idle", consecutiveFailures: 0, cooldownUntil: 0 });
  const [repairTrials, setRepairTrials] = useState<RepairTrial[]>([]);
  const [repairExhaustedCount, setRepairExhaustedCount] = useState(0);
  const [repairChecking, setRepairChecking] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [groupSummaries, setGroupSummaries] = useState<RunGroupSummary[]>([]);
  const [recentFailures, setRecentFailures] = useState<FailureAttempt[]>([]);
  const [selectedExportGroups, setSelectedExportGroups] = useState<string[] | null>(null);
  const [includeIncompleteExports, setIncludeIncompleteExports] = useState(true);
  const [filterTask, setFilterTask] = useState("All tasks");
  const [filterModel, setFilterModel] = useState("All models");
  const [exporting, setExporting] = useState<"" | "word" | "color" | "sample" | "source">("");

  useEffect(() => {
    fetch("/api/workspace").then(r => r.ok ? r.json() : Promise.reject()).then(data => {
      if (data.project) setProject(data.project);
      if (data.models?.length) setModels(data.models);
      if (data.settings) setSettings(data.settings);
      if (data.results) setResults(data.results);
      if (data.groupSummaries) setGroupSummaries(data.groupSummaries);
      if (data.recentFailures) setRecentFailures(data.recentFailures);
    }).catch(() => setNotice("当前为离线模式——更改只保留在本次预览中。")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (page !== "export") return;
    fetch("/api/workspace", { cache: "no-store" }).then(response => response.ok ? response.json() : Promise.reject()).then(data => {
      if (data.groupSummaries) setGroupSummaries(data.groupSummaries);
      if (data.recentFailures) setRecentFailures(data.recentFailures);
    }).catch(() => setNotice("正式数据组列表刷新失败，请稍后重试。"));
  }, [page]);

  const selectedModel = models.find(m => m.id === selectedModelId) || models[0];
  const geminiBatchModel = models.find(model => isGemini31Pro(model.model_id));
  const selectedRunModelIds = modelSlotIds(settings, models);
  const runModels = models.filter(model => selectedRunModelIds.includes(model.id)).slice(0, 4);
  const pendingRunModels = runModels.filter(model => !launchedModelIds.includes(model.id));
  const wtcRequests = bool(settings.run_word_to_color) ? runModels.length * 20 * settings.repetitions : 0;
  const cteRequests = bool(settings.run_color_to_emotion) ? runModels.length * 11 * settings.repetitions : 0;
  const totalRequests = wtcRequests + cteRequests;
  const requestsPerRound = (bool(settings.run_word_to_color) ? 20 : 0) + (bool(settings.run_color_to_emotion) ? 11 : 0);
  const geminiDailyBudgets = useMemo(() => Object.fromEntries(
    runModels.filter(usesGeminiStablePolicy).map(model => [model.id, summarizeGeminiDailyBudget(model.id, groupSummaries, settings.repetitions)]),
  ), [runModels, groupSummaries, settings.repetitions]);
  const estimatedBatchTotal = runModels.reduce((sum, model) => {
    const rounds = usesGeminiStablePolicy(model)
      ? (geminiDailyBudgets[model.id]?.nextBatchRounds ?? Math.min(settings.repetitions, GEMINI_DAILY_COMPLETE_ROUNDS))
      : settings.repetitions;
    return sum + rounds * requestsPerRound;
  }, 0);
  const runnerRequestTotal = scheduledTrialTotal || estimatedBatchTotal;
  const navigate = (nextPage: string) => {
    if (nextPage === "export") setSelectedExportGroups(null);
    setPage(nextPage);
  };
  const filteredResults = useMemo(() => results.filter(r =>
    (filterTask === "All tasks" || r.task_type === filterTask) &&
    (filterModel === "All models" || r.model_alias === filterModel)
  ), [results, filterTask, filterModel]);

  async function persist(action: string, data: Record<string, unknown>, message: string) {
    setNotice("正在保存…");
    try {
      const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      if (!response.ok) throw new Error();
      setNotice(message);
    } catch { setNotice("本地预览已更新，持久化保存暂时不可用。"); }
    window.setTimeout(() => setNotice(""), 3200);
  }

  function patchModel(patch: Partial<Model>) {
    setModels(current => current.map(m => m.id === selectedModel.id ? { ...m, ...patch } : m));
  }

  async function saveModel() {
    const model = models.find(m => m.id === selectedModel.id)!;
    await persist("saveModel", model as unknown as Record<string, unknown>, `${model.alias} 配置已保存。`);
  }

  async function testConnection() {
    const apiKey = keys[selectedModel.id];
    if (!apiKey) { setNotice("请先输入临时 API Key，再测试连接。"); return; }
    setTesting(true); setNotice("正在发送最小 JSON 请求…");
    try {
      const response = await fetch("/api/model-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model: selectedModel, settings }),
      });
      const data = await response.json();
      const status = data.ok ? "Connected" : "Failed";
      patchModel({ last_test_status: status, latency_ms: data.latencyMs || null });
      await persist("testResult", { id: selectedModel.id, status, latency_ms: data.latencyMs || null }, data.ok ? `连接成功，耗时 ${data.latencyMs} ms。` : data.message || "连接失败。");
    } catch { setNotice("连接测试未收到响应。"); }
    finally { setTesting(false); }
  }

  async function pilotTest(task: "word" | "color") {
    const apiKey = keys[selectedModel.id];
    if (!apiKey) { setNotice("请先为当前模型输入临时 API Key，再进行单模型试跑。"); return; }
    setPilotTesting(task); setNotice(`正在用 ${selectedModel.alias} 试跑${task === "word" ? "实验一" : "实验二"}的 1 个真实请求…`);
    try {
      const response = await fetch("/api/pilot-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model: selectedModel, settings, task }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "试跑失败");
      if (data.result) setResults(current => [data.result, ...current.filter(row => row.trial_id !== data.result.trial_id)]);
      patchModel({ last_test_status: "Connected", latency_ms: data.latencyMs || null });
      setNotice(`单模型试跑成功：${data.summary || "已返回有效 JSON"}，耗时 ${data.latencyMs} ms。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "单模型试跑失败。");
    } finally {
      setPilotTesting("");
      window.setTimeout(() => setNotice(""), 5200);
    }
  }

  function prepareSingleModel(modelId: string) {
    const model = models.find(item => item.id === modelId);
    const currentIds = settings.model_scope === "all" ? [] : modelSlotIds(settings, models);
    if (!currentIds.includes(modelId) && currentIds.length >= 4) {
      setNotice("并行实验组最多 4 个。请先移除一个未运行的模型组，再添加新模型。");
      return;
    }
    const nextIds = [...new Set([...currentIds, modelId])].slice(0, 4);
    const next = {
      ...settings,
      model_scope: "slots" as const,
      single_model_id: modelId,
      model_slot_ids: JSON.stringify(nextIds),
      repetitions: currentIds.length ? settings.repetitions : 1,
      concurrency: Math.max(settings.concurrency, nextIds.length),
    };
    setSettings(next);
    setPage("experiment");
    persist("saveSettings", next as unknown as Record<string, unknown>, `${model?.alias || "当前模型"} 已加入并行实验组（${nextIds.length}/4）；各模型结果会独立分组。`);
  }

  function setKey(value: string) {
    setKeys(current => ({ ...current, [selectedModel.id]: value }));
    if (value) sessionStorage.setItem(`chromalab-key-${selectedModel.id}`, value);
    else sessionStorage.removeItem(`chromalab-key-${selectedModel.id}`);
  }

  function changeRunnerState(next: RunnerState) {
    runnerStateRef.current = next;
    setRunnerState(next);
  }

  function resetRunProgress() {
    setRunStats({ completed: 0, valid: 0, failed: 0, retries: 0, latencyTotal: 0, active: 0 });
    setModelRunProgress(Object.fromEntries(runModels.map(model => [model.id, { completed: 0, valid: 0, word: 0, color: 0 }])));
    setScheduledTrialTotal(0);
    setPlannedRoundsByModel({});
    setLastRunError("");
    setRunActivity("");
    setGeminiRunState({ status: "idle", consecutiveFailures: 0, cooldownUntil: 0 });
    setRepairTrials([]);
    setRepairExhaustedCount(0);
  }

  function createTrialQueue(firstRunIndex: number, plans: RunPlan[]) {
    const queue: QueueTrial[] = [];
    for (const { model, rounds } of plans) {
      for (let offset = 0; offset < rounds; offset += 1) {
        const runIndex = firstRunIndex + offset;
        const orders = experimentOrders(settings, runIndex);
        if (bool(settings.run_word_to_color)) {
          orders.emotions.forEach((emotion, stimulusIndex) => {
            queue.push({ model, task: "word", runIndex, stimulusId: emotion, stimulusIndex });
          });
        }
        if (bool(settings.run_color_to_emotion)) {
          orders.colors.forEach(([stimulusId, stimulusHex], stimulusIndex) => {
            queue.push({ model, task: "color", runIndex, stimulusId, stimulusHex, stimulusIndex });
          });
        }
      }
    }
    return queue;
  }

  function buildQueue() {
    if (runnerStateRef.current === "running") {
      setPage("runner");
      persist("saveSettings", settings as unknown as Record<string, unknown>, pendingRunModels.length
        ? `已新增 ${pendingRunModels.length} 个待启动模型组；点击“启动新增组”即可加入当前并行运行。`
        : "当前选择的模型组都已在本轮运行中。");
      return;
    }
    resetRunProgress();
    launchedModelIdsRef.current = new Set();
    setLaunchedModelIds([]);
    changeRunnerState("ready"); setPage("runner");
    persist("saveSettings", settings as unknown as Record<string, unknown>, `已准备 ${totalRequests.toLocaleString()} 个试次。`);
  }

  async function registerTrialManifest(queue: QueueTrial[], queueModels: Model[]) {
    const batchId = `manifest-${Date.now()}-${crypto.randomUUID()}`;
    for (const model of queueModels) {
      const trials = queue.filter(item => item.model.id === model.id).map(item => ({
        task: item.task,
        runIndex: item.runIndex,
        stimulusId: item.stimulusId,
        stimulusHex: item.stimulusHex || "",
        stimulusIndex: item.stimulusIndex,
      }));
      const response = await fetch("/api/trial-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", batchId, model, settings: executionSettingsForModel(model, settings), trials }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message || `${model.alias} 的试次清单保存失败。`);
    }
  }

  async function scanMissingTrials(modelIds = [...launchedModelIdsRef.current]) {
    if (!modelIds.length) {
      setRepairTrials([]);
      setRepairExhaustedCount(0);
      return;
    }
    setRepairChecking(true);
    try {
      const response = await fetch("/api/trial-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", modelIds }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        repairable?: RepairTrial[];
        exhaustedCount?: number;
        message?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.message || "缺失试次检查失败。");
      setRepairTrials(data.repairable || []);
      setRepairExhaustedCount(Number(data.exhaustedCount || 0));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "缺失试次检查失败。");
    } finally {
      setRepairChecking(false);
    }
  }

  async function repairMissingTrials() {
    const candidates = [...repairTrials];
    if (!candidates.length || repairing) return;
    const missingKeys = [...new Set(candidates.filter(item => !keys[item.modelId]).map(item => item.modelAlias))];
    if (missingKeys.length) {
      setNotice(`补齐前请重新填写 ${missingKeys.join("、")} 的临时 API Key。`);
      return;
    }
    setRepairing(true);
    setNotice(`正在补齐 ${candidates.length} 条技术缺失；有效结果不会重新生成…`);
    try {
      const claimResponse = await fetch("/api/trial-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", logicalTrialIds: candidates.map(item => item.logicalTrialId) }),
      });
      const claim = await claimResponse.json().catch(() => ({})) as { ok?: boolean; claimed?: number; message?: string };
      if (!claimResponse.ok || !claim.ok || Number(claim.claimed) !== candidates.length) {
        throw new Error(claim.message || "部分缺失试次已被其他补齐任务占用，请重新检查。");
      }
      setRunStats(current => ({ ...current, retries: current.retries + candidates.length }));

      let repaired = 0;
      let unresolved = 0;
      const groups = new Map<string, RepairTrial[]>();
      candidates.forEach(item => groups.set(item.modelId, [...(groups.get(item.modelId) || []), item]));
      await Promise.all([...groups.values()].map(async group => {
        const model = group[0].model;
        const interval = Math.ceil(60_000 / effectiveRequestsPerMinute(model));
        for (let index = 0; index < group.length; index += 1) {
          if (index) await new Promise(resolve => window.setTimeout(resolve, interval));
          const item = group[index];
          setRunActivity(`补齐 · ${item.modelAlias} · 第 ${item.runIndex} 轮 · ${item.stimulusId}`);
          try {
            const response = await fetch("/api/run-trial", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                apiKey: keys[item.modelId],
                model: item.model,
                settings: item.settings,
                trial: {
                  task: item.task,
                  runIndex: item.runIndex,
                  stimulusId: item.stimulusId,
                  stimulusHex: item.stimulusHex,
                  stimulusIndex: item.stimulusIndex,
                },
                retryCount: item.nextAttempt,
              }),
            });
            const data = await response.json().catch(() => ({})) as { ok?: boolean; result?: ResultRow };
            if (!response.ok || !data.ok || !data.result) {
              unresolved += 1;
              continue;
            }
            repaired += 1;
            const result = data.result;
            setResults(current => [result, ...current.filter(row => row.trial_id !== result.trial_id)]);
            setRunStats(current => ({
              ...current,
              valid: current.valid + 1,
              failed: Math.max(0, current.failed - 1),
              latencyTotal: current.latencyTotal + result.latency_ms,
            }));
            setModelRunProgress(current => {
              const previous = current[item.modelId] || { completed: 0, valid: 0, word: 0, color: 0 };
              return { ...current, [item.modelId]: { ...previous, valid: previous.valid + 1 } };
            });
          } catch {
            unresolved += 1;
          }
        }
      }));

      const refreshResponse = await fetch("/api/workspace", { cache: "no-store" });
      if (refreshResponse.ok) {
        const refreshed = await refreshResponse.json();
        if (refreshed.results) setResults(refreshed.results);
        if (refreshed.groupSummaries) setGroupSummaries(refreshed.groupSummaries);
        if (refreshed.recentFailures) setRecentFailures(refreshed.recentFailures);
      }
      await scanMissingTrials([...new Set(candidates.map(item => item.modelId))]);
      setNotice(`补齐完成：新增 ${repaired} 条有效结果，仍缺失 ${unresolved} 条；所有尝试已保留在审计记录中。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "缺失项补齐失败。");
    } finally {
      setRepairing(false);
      setRunActivity("");
      window.setTimeout(() => setNotice(""), 5200);
    }
  }

  async function startRun() {
    const joining = runnerStateRef.current === "running";
    const initialCandidateModels = runModels.filter(model =>
      !startingModelIdsRef.current.has(model.id) && (!joining || !launchedModelIdsRef.current.has(model.id)));
    if (!initialCandidateModels.length || !totalRequests) {
      setNotice(joining ? "没有新的模型组可加入；请先在实验设计页添加一个未运行模型。" : "请先选择至少一个模型和一个实验任务，再生成队列。");
      return;
    }
    initialCandidateModels.forEach(model => startingModelIdsRef.current.add(model.id));
    const releaseStarting = () => initialCandidateModels.forEach(model => startingModelIdsRef.current.delete(model.id));

    let firstRunIndex = 1;
    let latestGroups = groupSummaries;
    try {
      const sequenceResponse = await fetch("/api/workspace", { cache: "no-store" });
      if (!sequenceResponse.ok) throw new Error();
      const sequenceData = await sequenceResponse.json() as { nextRunIndex?: number; groupSummaries?: RunGroupSummary[] };
      firstRunIndex = Math.max(1, Number(sequenceData.nextRunIndex) || 1);
      latestGroups = sequenceData.groupSummaries || [];
      setGroupSummaries(latestGroups);
    } catch {
      releaseStarting();
      setNotice("无法读取最新轮次与每日额度状态。为避免覆盖旧数据，本次实验尚未开始。");
      return;
    }

    const plans: RunPlan[] = [];
    const blockedMessages: string[] = [];
    for (const model of initialCandidateModels) {
      if (!usesGeminiStablePolicy(model)) {
        plans.push({ model, rounds: settings.repetitions });
        continue;
      }
      if (!bool(settings.run_word_to_color) || !bool(settings.run_color_to_emotion)) {
        blockedMessages.push(`${model.alias} 的每日保护模式要求同时启用实验一和实验二，以保证每轮都是完整的 31 条数据`);
        continue;
      }
      const budget = summarizeGeminiDailyBudget(model.id, latestGroups, settings.repetitions);
      if (budget.remainingTargetRounds === 0) {
        blockedMessages.push(`${model.alias} 已达到 ${budget.targetRounds} 个目标轮次`);
      } else if (budget.remainingTodayRounds === 0) {
        blockedMessages.push(`${model.alias} 今天已启动 ${GEMINI_DAILY_COMPLETE_ROUNDS} 个完整轮次（${GEMINI_DAILY_FORMAL_REQUESTS} 条正式请求），请在下一个太平洋时间配额日继续`);
      } else {
        plans.push({ model, rounds: budget.nextBatchRounds });
      }
    }
    if (!plans.length) {
      releaseStarting();
      setNotice(blockedMessages.join("；") || "当前没有可启动的实验轮次。");
      return;
    }
    const candidateModels = plans.map(plan => plan.model);
    const missing = candidateModels.filter(m => !keys[m.id]);
    if (missing.length) {
      releaseStarting();
      setNotice(`开始前请为 ${missing.map(m => m.alias).join("、")} 添加临时 API Key。`);
      return;
    }
    setNotice("正在执行正式运行前检查：连接、任务一格式、任务二格式；临时 503/429 将自动退避重试…");
    for (const model of candidateModels) {
      try {
        const preflightResponse = await fetch("/api/model-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: keys[model.id], model, settings }),
        });
        const preflight = await preflightResponse.json().catch(() => ({})) as { ok?: boolean; message?: string };
        if (!preflightResponse.ok || !preflight.ok) {
          releaseStarting();
          setNotice(`${model.alias} 未通过运行前检查：${preflight.message || `HTTP ${preflightResponse.status}`}。队列未启动，避免产生整批失败。`);
          return;
        }
      } catch (error) {
        releaseStarting();
        setNotice(`${model.alias} 运行前检查未完成：${error instanceof Error ? error.message : "网络异常"}。队列未启动。`);
        return;
      }
    }
    const queue = createTrialQueue(firstRunIndex, plans);
    if (!queue.length) {
      releaseStarting();
      setNotice("当前设置没有生成可执行试次。");
      return;
    }
    try {
      await registerTrialManifest(queue, candidateModels);
    } catch (error) {
      releaseStarting();
      setNotice(`${error instanceof Error ? error.message : "试次清单保存失败。"} 为避免无法审计缺失项，队列未启动。`);
      return;
    }

    if (!joining) {
      resetRunProgress();
      launchedModelIdsRef.current = new Set();
      setLaunchedModelIds([]);
      activeRunGroupsRef.current = 0;
    } else {
      setModelRunProgress(current => ({
        ...current,
        ...Object.fromEntries(candidateModels.filter(model => !current[model.id]).map(model => [model.id, { completed: 0, valid: 0, word: 0, color: 0 }])),
      }));
    }
    setScheduledTrialTotal(current => joining ? current + queue.length : queue.length);
    setPlannedRoundsByModel(current => joining
      ? { ...current, ...Object.fromEntries(plans.map(plan => [plan.model.id, plan.rounds])) }
      : Object.fromEntries(plans.map(plan => [plan.model.id, plan.rounds])));
    releaseStarting();
    candidateModels.forEach(model => launchedModelIdsRef.current.add(model.id));
    setLaunchedModelIds([...launchedModelIdsRef.current]);
    activeRunGroupsRef.current += 1;
    changeRunnerState("running");
    setProject(current => ({ ...current, status: "Running" }));
    const finalRunIndex = Math.max(...queue.map(item => item.runIndex));
    persist("setStatus", { status: "Running" }, `${candidateModels.map(model => model.alias).join("、")} ${joining ? "已加入当前并行运行" : "实验已开始"}；本批使用第 ${firstRunIndex}–${finalRunIndex} 轮，跨日结果会按轮次自动合并。`);

    let limiter = Promise.resolve();
    const nextAllowedAt = new Map<string, number>();
    const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
    let geminiConsecutiveFailures = 0;
    let geminiCooldownUntil = 0;

    async function waitForRateLimit(model: Model) {
      let delay = 0;
      limiter = limiter.then(() => {
        const now = Date.now();
        const interval = Math.ceil(60_000 / effectiveRequestsPerMinute(model));
        const available = nextAllowedAt.get(model.id) || now;
        delay = Math.max(0, available - now);
        nextAllowedAt.set(model.id, Math.max(now, available) + interval);
      });
      await limiter;
      if (delay) await wait(delay);
    }

    async function waitForGeminiCooldown(model: Model) {
      if (!usesGeminiStablePolicy(model) || geminiCooldownUntil <= Date.now()) return;
      setGeminiRunState({
        status: "cooling",
        consecutiveFailures: geminiConsecutiveFailures,
        cooldownUntil: geminiCooldownUntil,
      });
      while (geminiCooldownUntil > Date.now()) {
        await wait(Math.min(1_000, geminiCooldownUntil - Date.now()));
      }
      geminiConsecutiveFailures = 0;
      geminiCooldownUntil = 0;
      setGeminiRunState({ status: "ready", consecutiveFailures: 0, cooldownUntil: 0 });
    }

    function registerGeminiTransientFailure(model: Model) {
      if (!usesGeminiStablePolicy(model)) return;
      geminiConsecutiveFailures += 1;
      if (geminiConsecutiveFailures >= GEMINI_STABLE_POLICY.cooldownThreshold) {
        geminiCooldownUntil = Date.now() + GEMINI_STABLE_POLICY.cooldownMs;
        setGeminiRunState({
          status: "cooling",
          consecutiveFailures: geminiConsecutiveFailures,
          cooldownUntil: geminiCooldownUntil,
        });
      } else {
        setGeminiRunState({
          status: "running",
          consecutiveFailures: geminiConsecutiveFailures,
          cooldownUntil: 0,
        });
      }
    }

    function registerGeminiSuccess(model: Model) {
      if (!usesGeminiStablePolicy(model)) return;
      geminiConsecutiveFailures = 0;
      geminiCooldownUntil = 0;
      setGeminiRunState({ status: "running", consecutiveFailures: 0, cooldownUntil: 0 });
    }

    async function executeGroup(group: SubmissionGroup) {
      let lastMessage = "试次执行失败。";
      const attemptLimit = totalAttemptLimit(group.model, settings.max_retry);
      // A complete 20- or 11-question JSON response is materially larger than
      // the former single-item call.  Keep the normal queue policy, but never
      // abort a valid grouped response merely because an older saved setting
      // still contains the 60-second single-question default.
      const modelTimeoutSeconds = Math.max(180, effectiveTimeoutSeconds(group.model, settings.timeout_seconds));
      for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
        await waitForGeminiCooldown(group.model);
        setRunActivity(`${group.model.alias} · 第 ${group.runIndex} 轮 · ${group.task === "word" ? "实验一 20 题整组" : "实验二 11 题整组"} · ${attempt ? `第 ${attempt} 次重试` : "请求中"}`);
        if (usesGeminiStablePolicy(group.model)) {
          setGeminiRunState(current => ({ ...current, status: "running" }));
        }
        await waitForRateLimit(group.model);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), (modelTimeoutSeconds + 5) * 1000);
        try {
          const response = await fetch("/api/run-group", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              apiKey: keys[group.model.id],
              model: group.model,
              settings: executionSettingsForModel(group.model, settings),
              trials: group.trials.map(item => ({ task: item.task, runIndex: item.runIndex, stimulusId: item.stimulusId, stimulusHex: item.stimulusHex, stimulusIndex: item.stimulusIndex })),
              retryCount: attempt,
            }),
          });
          const data = await response.json().catch(() => ({})) as { ok?: boolean; results?: ResultRow[]; message?: string; retryAfter?: string | null; retryable?: boolean; httpStatus?: number };
          if (response.ok && data.ok && data.results?.length === group.trials.length) {
            registerGeminiSuccess(group.model);
            return data.results;
          }
          lastMessage = data.message || `请求失败（HTTP ${response.status}）`;
          if (data.retryable === false) break;
          const transient = response.status === 408 || response.status === 429 || response.status >= 500;
          if (transient) registerGeminiTransientFailure(group.model);
          if (attempt < attemptLimit - 1) {
            setRunStats(current => ({ ...current, retries: current.retries + 1 }));
            await wait(retryDelayMilliseconds(group.model, attempt, data.retryAfter));
          }
        } catch (error) {
          lastMessage = error instanceof DOMException && error.name === "AbortError"
            ? `请求超过 ${modelTimeoutSeconds} 秒未完成`
            : error instanceof Error ? error.message : "网络请求失败。";
          registerGeminiTransientFailure(group.model);
          if (attempt < attemptLimit - 1) {
            setRunStats(current => ({ ...current, retries: current.retries + 1 }));
            await wait(retryDelayMilliseconds(group.model, attempt));
          }
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      throw new Error(lastMessage);
    }

    async function runQueue(targetQueue: SubmissionGroup[], workerCount: number) {
      let cursor = 0;
      async function worker() {
      while (cursor < targetQueue.length) {
        while (runnerStateRef.current === "paused") await wait(200);
        if (runnerStateRef.current !== "running") return;
        const item = targetQueue[cursor];
        cursor += 1;
        setRunStats(current => ({ ...current, active: current.active + 1 }));
        try {
          const results = await executeGroup(item);
          setResults(current => [...results, ...current.filter(row => !results.some(result => result.trial_id === row.trial_id))]);
          const taskCount = results.length;
          setRunStats(current => ({ ...current, completed: current.completed + taskCount, valid: current.valid + taskCount, latencyTotal: current.latencyTotal + results.reduce((sum, result) => sum + result.latency_ms, 0) }));
          setModelRunProgress(current => {
            const previous = current[item.model.id] || { completed: 0, valid: 0, word: 0, color: 0 };
            return { ...current, [item.model.id]: { ...previous, completed: previous.completed + taskCount, valid: previous.valid + taskCount, [item.task]: previous[item.task] + taskCount } };
          });
        } catch (error) {
          const taskCount = item.trials.length;
          const message = `${item.model.alias} · 第 ${item.runIndex} 轮 · ${item.task === "word" ? "实验一整组" : "实验二整组"}：${error instanceof Error ? error.message : "执行失败"}`;
          setLastRunError(message);
          setRunStats(current => ({ ...current, completed: current.completed + taskCount, failed: current.failed + taskCount }));
          setModelRunProgress(current => {
            const previous = current[item.model.id] || { completed: 0, valid: 0, word: 0, color: 0 };
            return { ...current, [item.model.id]: { ...previous, completed: previous.completed + taskCount, [item.task]: previous[item.task] + taskCount } };
          });
        } finally {
          setRunStats(current => ({ ...current, active: Math.max(0, current.active - 1) }));
        }
      }
      }
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    const submissionQueue = groupForSubmission(queue);
    const geminiQueue = submissionQueue.filter(item => usesGeminiStablePolicy(item.model));
    const standardQueue = submissionQueue.filter(item => !usesGeminiStablePolicy(item.model));
    const standardModelCount = new Set(standardQueue.map(item => item.model.id)).size;
    const standardWorkerCount = standardQueue.length
      ? Math.min(standardQueue.length, Math.max(1, Math.min(4, settings.concurrency, standardModelCount)))
      : 0;
    if (geminiQueue.length) setGeminiRunState({ status: "ready", consecutiveFailures: 0, cooldownUntil: 0 });
    await Promise.all([
      standardWorkerCount ? runQueue(standardQueue, standardWorkerCount) : Promise.resolve(),
      geminiQueue.length ? runQueue(geminiQueue, GEMINI_STABLE_POLICY.concurrency) : Promise.resolve(),
    ]);
    activeRunGroupsRef.current = Math.max(0, activeRunGroupsRef.current - 1);
    if (runnerStateRef.current === "running" && activeRunGroupsRef.current === 0) {
      changeRunnerState("completed");
      setRunActivity("");
      setProject(current => ({ ...current, status: "Completed" }));
      await persist("setStatus", { status: "Completed" }, "实验队列已执行完成；有效结果已写入本地数据库。");
      try {
        const refreshResponse = await fetch("/api/workspace", { cache: "no-store" });
        if (refreshResponse.ok) {
          const refreshed = await refreshResponse.json();
          if (refreshed.results) setResults(refreshed.results);
          if (refreshed.groupSummaries) setGroupSummaries(refreshed.groupSummaries);
          if (refreshed.recentFailures) setRecentFailures(refreshed.recentFailures);
        }
      } catch {
        // The saved server data remains authoritative and will refresh on the next page load.
      }
      await scanMissingTrials([...launchedModelIdsRef.current]);
    }
  }

  function exportConfig() {
    const safeModels = models.map(({ ...m }) => m);
    download(`AI_Color_Experiment_${project.name.replace(/\s+/g, "_")}.json`, JSON.stringify({ project, experiment: settings, models: safeModels, emotions: EMOTIONS, colors: COLORS.map(([color_id, hex]) => ({ color_id, hex })) }, null, 2), "application/json");
  }

  function exportCsv(kind: "emotions" | "colors") {
    if (kind === "emotions") download("emotion_list.csv", `emotion_id,emotion_en,display_order,version\n${EMOTIONS.map((e, i) => `E${String(i + 1).padStart(2, "0")},${e},${i + 1},${project.emotion_list_version}`).join("\n")}`, "text/csv;charset=utf-8");
    if (kind === "colors") download("color_list.csv", `color_id,hex,version\n${COLORS.map(([id, hex]) => `${id},${hex},${project.color_list_version}`).join("\n")}`, "text/csv;charset=utf-8");
  }

  async function fetchExportPayload() {
    const eligibleGroups = includeIncompleteExports ? groupSummaries : groupSummaries.filter(isCompleteRunGroup);
    const eligibleKeys = eligibleGroups.map(group => runGroupKey(group.model_id, group.run_index));
    const selected = new Set(selectedExportGroups === null ? eligibleKeys : selectedExportGroups.filter(key => eligibleKeys.includes(key)));
    const selectedGroups = eligibleGroups.filter(group => selected.has(runGroupKey(group.model_id, group.run_index)));
    // D1 has a bound-parameter ceiling. Sending 300+ selected groups in one
    // request produced an HTTP 500 (two bindings per group). Query in small,
    // deterministic chunks and merge the same immutable metadata locally.
    const chunks = Array.from({ length: Math.max(1, Math.ceil(selectedGroups.length / 40)) }, (_, index) => selectedGroups.slice(index * 40, (index + 1) * 40));
    const payloads = await Promise.all(chunks.map(async groups => {
      const params = new URLSearchParams();
      params.set("scope", "selected");
      groups.forEach(group => params.append("group", `${group.model_id}\t${group.run_index}`));
      const response = await fetch(`/api/export-data?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `导出数据读取失败（HTTP ${response.status}）`);
      }
      return response.json() as Promise<ExportPayload>;
    }));
    const payload = {
      ...payloads[0],
      results: payloads.flatMap(item => item.results),
      failures: payloads.flatMap(item => item.failures ?? []),
      manifest: payloads.flatMap(item => item.manifest ?? []),
    } as ExportPayload;
    return {
      ...payload,
      export_scope: includeIncompleteExports ? "available" as const : "complete" as const,
      results: payload.results.filter(result => selected.has(runGroupKey(result.model_id, result.run_index))),
      failures: (payload.failures ?? []).filter(failure => selected.has(runGroupKey(failure.model_id, failure.run_index))),
      manifest: (payload.manifest ?? []).filter(item => selected.has(runGroupKey(item.model_id, item.run_index))),
    };
  }

  async function exportSourceCsv(kind: "word" | "color") {
    setExporting(kind);
    setNotice("正在整理源格式结果…");
    try {
      const payload = await fetchExportPayload();
      const rows = kind === "word"
        ? buildWordToColorRows(payload, EMOTIONS)
        : buildColorToEmotionRows(payload, COLORS);
      const columns = kind === "word" ? WORD_TO_COLOR_COLUMNS : COLOR_TO_EMOTION_COLUMNS;
      const filename = kind === "word" ? "word_to_color_source.csv" : "color_to_emotion_source.csv";
      download(filename, toCsv(rows, columns), "text/csv;charset=utf-8");
      setNotice(`已导出 ${rows.length.toLocaleString()} 行源格式结果；仅包含当前勾选的完整轮次。`);
    } catch (error) {
      setNotice(`导出失败：${error instanceof Error ? error.message : "请确认本地数据库已初始化后重试。"}`);
    } finally {
      setExporting("");
      window.setTimeout(() => setNotice(""), 3200);
    }
  }

  function formatWorkbookSheet(XLSX: typeof import("xlsx"), rows: Record<string, string | number | boolean | null>[]) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    worksheet["!cols"] = headers.map(header => ({
      wch: header.includes("回答") || header.includes("内容") || header.includes("记录") ? 52 : Math.max(12, Math.min(28, header.length * 2 + 4)),
    }));
    return worksheet;
  }

  async function exportSampleWorkbook() {
    setExporting("sample");
    setNotice("正在生成数据格式样本工作簿…");
    try {
      const [payload, XLSX] = await Promise.all([fetchExportPayload(), import("xlsx")]);
      const workbook = XLSX.utils.book_new();
      const sampleRows = buildSampleRows(payload, COLORS);
      const sampleSheet = XLSX.utils.json_to_sheet(sampleRows, { header: [...SAMPLE_COLUMNS] });
      sampleSheet["!cols"] = SAMPLE_COLUMNS.map(column => ({ wch: column.endsWith(".hex") ? 13 : column.startsWith("word_data") ? 36 : 10 }));
      XLSX.utils.book_append_sheet(workbook, sampleSheet, `SurveyResponse_AI_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`.slice(0, 31));
      XLSX.utils.book_append_sheet(workbook, formatWorkbookSheet(XLSX, buildSampleManifestRows(payload)), "row_manifest");
      XLSX.utils.book_append_sheet(workbook, formatWorkbookSheet(XLSX, buildExperimentConditionRows(payload)), "experiment_conditions");
      XLSX.utils.book_append_sheet(workbook, formatWorkbookSheet(XLSX, buildTrialManifestRows(payload)), "trial_manifest");
      const safeName = project.name.replaceAll(/[^\p{L}\p{N}_-]+/gu, "_");
      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      XLSX.writeFile(workbook, `SurveyResponse_AI_${safeName}_${date}.xlsx`, { compression: true });
      setNotice(`样本格式工作簿已生成，共 ${sampleRows.length.toLocaleString()} 条合并观察。`);
    } catch (error) {
      setNotice(`样本格式工作簿生成失败：${error instanceof Error ? error.message : "请稍后重试。"}`);
    } finally {
      setExporting("");
      window.setTimeout(() => setNotice(""), 3200);
    }
  }

  async function exportSourceWorkbook() {
    setExporting("source");
    setNotice("正在生成原始多模型格式工作簿…");
    try {
      const [payload, XLSX] = await Promise.all([fetchExportPayload(), import("xlsx")]);
      const workbook = XLSX.utils.book_new();
      const sourceHeaders = ["实验ID", "平台", "模型", "", "回答内容", "生成时间", "温度", "Top P", "最大输出长度"];
      const toSourceSheet = (rows: Record<string, string | number | boolean | null>[]) => {
        const data = rows.map(row => [row["实验ID"], row["平台"], row["模型"], "", row["回答内容"], row["生成时间"], row["温度"], row["Top P"], row["最大输出长度"]]);
        const sheet = XLSX.utils.aoa_to_sheet([sourceHeaders, ...data]);
        sheet["!cols"] = [{ wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 3 }, { wch: 75 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 16 }];
        sheet["!rows"] = [{ hpt: 22 }, ...data.map(() => ({ hpt: 150 }))];
        return sheet;
      };
      const wordRows = buildWordToColorRows(payload, EMOTIONS);
      const colorRows = buildColorToEmotionSourceRows(payload, COLORS);
      XLSX.utils.book_append_sheet(workbook, toSourceSheet(wordRows), "多模型实验结果_词选色");
      XLSX.utils.book_append_sheet(workbook, toSourceSheet(colorRows), "多模型实验结果_色选词");
      XLSX.utils.book_append_sheet(workbook, formatWorkbookSheet(XLSX, buildExperimentConditionRows(payload)), "实验条件");
      XLSX.utils.book_append_sheet(workbook, formatWorkbookSheet(XLSX, buildTrialManifestRows(payload)), "试次清单与补齐记录");
      const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      XLSX.writeFile(workbook, `多模型实验结果_${date}.xlsx`, { compression: true });
      setNotice(`原始多模型格式工作簿已生成：词选色 ${wordRows.length} 行、色选词 ${colorRows.length} 行；试次清单和补齐记录已附上。`);
    } catch (error) {
      setNotice(`原始多模型格式工作簿生成失败：${error instanceof Error ? error.message : "请稍后重试。"}`);
    } finally {
      setExporting("");
      window.setTimeout(() => setNotice(""), 3200);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <div className="project-context">
          <span className="eyebrow">当前项目</span>
          <strong>{project.name}</strong>
          <span>{project.id} · v{project.experiment_version}</span>
        </div>
        <nav aria-label="Experiment workflow">
          {NAV.map(([id, n, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => navigate(id)}><span>{n}</span><b>{label}</b>{id === "runner" && runnerState === "running" ? <i className="nav-live" /> : null}</button>)}
        </nav>
        <div className="sidebar-foot">
          <div><span className="shield">✓</span><p><b>本地优先安全</b><small>API Key 仅在本次会话中使用，绝不导出。</small></p></div>
          <button onClick={() => setPage("setup")}>研究协议 <span>↗</span></button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumbs">AI 实验 <span>/</span> {NAV.find(n => n[0] === page)?.[2]}</div>
          <div className="top-actions"><Pill tone="green">全部模型整组提交 · Gemini Batch v5</Pill><Pill tone={project.status === "Running" ? "blue" : "amber"}>{STATUS_LABELS[project.status] || project.status}</Pill><button className="icon-button" aria-label="通知">◌</button><div className="avatar">JM</div></div>
        </header>
        {notice ? <div className="toast">{notice}<button onClick={() => setNotice("")}>×</button></div> : null}
        {loading ? <div className="loading-line" /> : null}

        <div className="page-body">
          {page === "setup" && <SetupPage project={project} setProject={setProject} save={() => persist("saveProject", project as unknown as Record<string, unknown>, "项目详情已保存。")} />}
          {page === "models" && <ModelsPage models={models} selected={selectedModel} select={setSelectedModelId} patch={patchModel} save={saveModel} apiKey={keys[selectedModel.id] || ""} setKey={setKey} testing={testing} test={testConnection} pilotTesting={pilotTesting} pilotTest={pilotTest} prepareSingle={() => prepareSingleModel(selectedModel.id)} />}
          {page === "experiment" && <ExperimentPage settings={settings} setSettings={setSettings} models={models} activeModels={runModels} launchedModelIds={launchedModelIds} running={runnerState === "running"} wtc={wtcRequests} cte={cteRequests} total={totalRequests} build={buildQueue} />}
          {page === "runner" && <RunnerPage state={runnerState} setState={changeRunnerState} start={startRun} pendingCount={pendingRunModels.length} total={runnerRequestTotal} stats={runStats} modelProgress={modelRunProgress} plannedRoundsByModel={plannedRoundsByModel} settings={settings} models={runModels} launchedModelIds={launchedModelIds} keys={keys} lastError={lastRunError} activity={runActivity} geminiRunState={geminiRunState} geminiDailyBudgets={geminiDailyBudgets} repairCount={repairTrials.length} repairExhaustedCount={repairExhaustedCount} repairChecking={repairChecking} repairing={repairing} scanMissing={() => scanMissingTrials(runModels.map(model => model.id))} repairMissing={repairMissingTrials} />}
          {page === "batch" && <GeminiBatchPanel model={geminiBatchModel} apiKey={geminiBatchModel ? keys[geminiBatchModel.id] || "" : ""} settings={settings as unknown as Record<string, unknown> & { repetitions: number }} />}
          {page === "review" && <ReviewPage results={filteredResults} failures={recentFailures} models={models} groupSummaries={groupSummaries} filterTask={filterTask} setFilterTask={setFilterTask} filterModel={filterModel} setFilterModel={setFilterModel} />}
          {page === "export" && <ExportPage project={project} results={results} expectedGroups={settings.repetitions * runModels.length} groupSummaries={groupSummaries} selectedGroups={selectedExportGroups} setSelectedGroups={setSelectedExportGroups} includeIncomplete={includeIncompleteExports} setIncludeIncomplete={setIncludeIncompleteExports} exporting={exporting} exportConfig={exportConfig} exportCsv={exportCsv} exportSourceCsv={exportSourceCsv} exportSampleWorkbook={exportSampleWorkbook} exportSourceWorkbook={exportSourceWorkbook} />}
          {page === "analysis" && <AnalysisPlatform />}
        </div>
      </main>
    </div>
  );
}

function PageTitle({ index, title, subtitle, action }: { index: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><span className="eyebrow">步骤 {index} / 07</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function SetupPage({ project, setProject, save }: { project: Project; setProject: (p: Project) => void; save: () => void }) {
  const patch = (key: keyof Project, value: string) => setProject({ ...project, [key]: value });
  return <>
    <PageTitle index="01" title="定义研究项目" subtitle="为实验协议、模型运行和分析数据建立可复现的项目容器。" action={<button className="primary" onClick={save}>保存项目</button>} />
    <section className="protocol-banner">
      <div><span className="kicker">实验协议基础</span><h2>保留人类实验语义，<br />为 AI 试次重新构建。</h2><p>保留原问卷的 20 个 GEW 情绪词与 11 个匿名色码；移除视觉呈现、文化角色设定和对话历史，以保证模型测试标准化。</p></div>
      <div className="protocol-stack">
        <div><span>20</span><p>英文情绪词<small>GEW 顺序已锁定</small></p></div>
        <div><span>11</span><p>匿名颜色<small>仅提供 ID + sRGB HEX</small></p></div>
        <div><span>02</span><p>独立实验任务<small>不共享上下文</small></p></div>
      </div>
    </section>
    <div className="two-columns setup-grid">
      <section className="panel">
        <div className="panel-head"><div><h3>项目信息</h3><p>附加到每个试次与导出文件的元数据。</p></div><Pill tone="green">可自动保存</Pill></div>
        <div className="form-grid">
          <label className="span-2">项目名称<input value={project.name} onChange={e => patch("name", e.target.value)} /></label>
          <label>研究负责人<input value={project.researcher} onChange={e => patch("researcher", e.target.value)} /></label>
          <label>实验版本<input value={project.experiment_version} onChange={e => patch("experiment_version", e.target.value)} /></label>
          <label className="span-2">项目说明<textarea value={project.description} onChange={e => patch("description", e.target.value)} rows={3} /></label>
          <label>情绪词表版本<input value={project.emotion_list_version} onChange={e => patch("emotion_list_version", e.target.value)} /></label>
          <label>色表版本<input value={project.color_list_version} onChange={e => patch("color_list_version", e.target.value)} /></label>
        </div>
      </section>
      <section className="panel library-panel">
        <div className="panel-head"><div><h3>已锁定的实验材料</h3><p>从人类实验参考项目导入。</p></div><span className="lock">已锁定</span></div>
        <div className="emotion-grid">{EMOTIONS.map((e, i) => <span key={e} className={i < 10 ? "positive" : "negative"}>{String(i + 1).padStart(2, "0")} <b>{e}</b></span>)}</div>
        <div className="color-strip">{COLORS.map(([id, hex]) => <div key={id}><i style={{ background: hex }} /><span>{id}<small>{hex}</small></span></div>)}</div>
      </section>
    </div>
    <section className="invariants">
      <div className="section-label">固定实验条件</div>
      {[ ["EN", "仅使用英文", "Prompt 语言"], ["Ø", "无文化角色设定", "身份中立"], ["TXT", "仅文本输入", "不显示色块"], ["↻", "独立上下文", "无对话历史"] ].map(x => <article key={x[1]}><span>{x[0]}</span><div><b>{x[1]}</b><small>{x[2]}</small></div><i>✓</i></article>)}
    </section>
  </>;
}

function ModelsPage({ models, selected, select, patch, save, apiKey, setKey, testing, test, pilotTesting, pilotTest, prepareSingle }: { models: Model[]; selected: Model; select: (id: string) => void; patch: (p: Partial<Model>) => void; save: () => void; apiKey: string; setKey: (v: string) => void; testing: boolean; test: () => void; pilotTesting: "" | "word" | "color"; pilotTest: (task: "word" | "color") => void; prepareSingle: () => void }) {
  const variants = variantsFor(selected);
  const samplingControls = supportsSamplingControls(selected.model_id);
  const gemini36 = isGemini36Flash(selected.model_id);
  const gemini31Pro = isGemini31Pro(selected.model_id);
  const doubao21Pro = isDoubao21Pro(selected.model_id);
  const reasoningMode = reasoningModeForModel(selected.model_id, selected.base_url);
  return <>
    <PageTitle index="02" title="连接模型队列" subtitle="在可比较的参数条件下配置每个模型；凭证仅保留在当前浏览器会话中。" action={<button className="secondary">＋ 添加模型</button>} />
    <div className="model-layout">
      <section className="model-list panel">
        <div className="panel-head"><div><h3>模型队列</h3><p>已启用 {models.filter(m => bool(m.enabled)).length} / {models.length} 个模型</p></div><span className="mini-count">{models.length}</span></div>
        {models.map((m, i) => <button key={m.id} className={`model-row ${selected.id === m.id ? "selected" : ""}`} onClick={() => select(m.id)}>
          <span className={`model-glyph g${i}`}>{m.alias.slice(0, 1)}</span><div><b>{m.alias}</b><small>{m.provider} · {m.model_id}</small></div><Pill tone={m.last_test_status === "Connected" ? "green" : m.last_test_status === "Failed" ? "red" : "neutral"}>{m.last_test_status === "Connected" ? "已连接" : m.last_test_status === "Failed" ? "失败" : "未测试"}</Pill><span className="chev">›</span>
        </button>)}
        <div className="model-note"><span>i</span><p><b>可比较，但并非完全相同</b><small>不支持的 Seed 或 JSON 能力会被记录为模型差异，系统不会静默模拟。</small></p></div>
      </section>
      <section className="panel model-detail">
        <div className="panel-head"><div><span className="eyebrow">模型配置</span><h3>{selected.alias}</h3></div><div className="enabled-control"><span>启用</span><Toggle checked={bool(selected.enabled)} onChange={v => patch({ enabled: v })} label="启用模型" /></div></div>
        <div className="form-grid">
          <label>服务提供商<input value={selected.provider} onChange={e => patch({ provider: e.target.value })} /></label>
          <label>模型别名<input value={selected.alias} onChange={e => patch({ alias: e.target.value })} /></label>
          <div className="model-version-picker span-2">
            <div className="version-picker-head"><div><span className="eyebrow">具体模型型号</span><b>选择 Flash、Pro 或其他版本</b></div><Pill tone="blue">当前：{selected.model_id}</Pill></div>
            <div className="variant-chips">{variants.map(([label, id]) => <button type="button" key={id} className={selected.model_id === id ? "active" : ""} onClick={() => patch(modelVariantPatch(selected, id))}><b>{label}</b><small>{id}</small></button>)}</div>
            <label>自定义 Model ID<input className="mono" value={selected.model_id} onChange={e => patch({ model_id: e.target.value })} /></label>
            <small className="version-note">{gemini36 ? "Gemini 3.6 Flash 为稳定版；该型号已弃用 Temperature 与 Top P，平台会按接口要求省略。" : gemini31Pro ? "Gemini 3.1 Pro 当前为 Preview 且不提供免费 API 层；实时整组、连接测试和缺失项补齐均使用 Google 原生 generateContent 接口，Batch 继续使用原生 Batch API。实时路径要求 JSON 输出并在本地严格校验，避免 Preview 的嵌套 Schema 400。两种方式均固定 Temperature 1.0、Top P 1.0、2048 Token 与 low thinking。" : doubao21Pro ? "Doubao-Seed-2.1-Pro 为文本深度思考模型；本实验固定关闭深度思考。若控制台提供的是推理接入点，请将 Model ID 改为对应的 ep-… ID。" : "列表是快捷选择，也可以直接粘贴服务商控制台提供的 Model ID。火山引擎如使用推理接入点，请填对应的 ep-… ID。"}</small>
          </div>
          <label className="span-2">接口地址 Base URL<input className="mono" value={selected.base_url} onChange={e => patch({ base_url: e.target.value })} /></label>
          <label className="span-2">临时 API Key<div className="secret-field"><input type="password" value={apiKey} placeholder="sk-••••••••••••••••" autoComplete="off" onChange={e => setKey(e.target.value)} /><span>仅本次会话</span></div><small className="field-note">传输过程加密，绝不写入项目数据库或导出文件。</small></label>
          <div className="randomness-parameters span-2">
            <div className="randomness-head"><div><span className="eyebrow">模型采样参数</span><b>随机性控件</b></div><small>每个模型单独保存，并写入导出条件表</small></div>
            <div className="parameter-grid">
              <label className={!samplingControls ? "parameter-locked" : ""}><span>Temperature <b>{samplingControls ? selected.temperature.toFixed(1) : "模型默认"}</b></span><input type="range" min="0" max="2" step="0.1" value={selected.temperature} disabled={!samplingControls} onChange={e => patch({ temperature: number(e.target.value) })} /><small>{samplingControls ? "正式协议默认 1.0" : "当前型号请求中不发送"}</small></label>
              <label className={!samplingControls ? "parameter-locked" : ""}><span>Top P <b>{samplingControls ? selected.top_p.toFixed(2) : "模型默认"}</b></span><input type="range" min="0" max="1" step="0.05" value={selected.top_p} disabled={!samplingControls} onChange={e => patch({ top_p: number(e.target.value) })} /><small>{samplingControls ? "正式协议默认 1.00" : "当前型号请求中不发送"}</small></label>
              <label><span>最大输出 Token <b>{selected.max_tokens}</b></span><input type="number" min="64" max="32768" step="64" value={selected.max_tokens} onChange={e => patch({ max_tokens: number(e.target.value) })} /><small>正式协议默认 2048</small></label>
            </div>
            {gemini36
              ? <div className="parameter-notice"><b>Gemini 3.6 采样策略</b><span>Temperature / Top P 已弃用，平台会完全省略这两个字段；推理模式固定为 low。</span></div>
              : <div className="parameter-notice"><b>{gemini31Pro ? "Gemini 双采集入口" : "统一实验协议"}</b><span>{gemini31Pro ? "实时整组：与其他模型同队列 · Native Batch：在独立页面提交；两者均为 Temperature 1.0 · Top P 1.0 · 2048 Token · low thinking" : `Temperature 1.0 · Top P 1.0 · 2048 Token · 推理模式 ${reasoningMode}`}</span></div>}
          </div>
          <label>每分钟请求上限<input type="number" value={usesGeminiStablePolicy(selected) ? GEMINI_STABLE_POLICY.requestsPerMinute : selected.rate_limit} disabled={usesGeminiStablePolicy(selected)} onChange={e => patch({ rate_limit: number(e.target.value) })} />{usesGeminiStablePolicy(selected) ? <small>Gemini 稳定通道固定为 8 RPM。</small> : null}</label>
        </div>
        <div className="capabilities"><label><input type="checkbox" checked={bool(selected.supports_json)} onChange={e => patch({ supports_json: e.target.checked })} /> JSON 模式</label><label><input type="checkbox" checked={bool(selected.supports_seed)} onChange={e => patch({ supports_seed: e.target.checked })} /> 支持 Seed</label><span>API 格式：{selected.api_format}</span></div>
        <div className="pilot-callout"><div><span className="eyebrow">当前模型实验组</span><b>先验证，再加入并行队列</b><p>可逐个把 DeepSeek、GPT、Doubao、Gemini 加入实验设计，最多 4 组同时运行；结果按模型与轮次独立保存。</p></div><div><button className="secondary" onClick={() => pilotTest("word")} disabled={Boolean(pilotTesting) || testing}>{pilotTesting === "word" ? "实验一试跑中…" : "试跑实验一"}</button><button className="secondary" onClick={() => pilotTest("color")} disabled={Boolean(pilotTesting) || testing}>{pilotTesting === "color" ? "实验二试跑中…" : "试跑实验二"}</button><button className="primary" onClick={prepareSingle}>加入并行实验组 <span>→</span></button></div></div>
        <div className="detail-actions"><button className="secondary" onClick={test} disabled={testing || Boolean(pilotTesting)}>{testing ? "验证中…" : "验证连接与两项格式"}</button><button className="primary" onClick={save}>保存配置</button>{selected.latency_ms ? <span className="latency">最近延迟 <b>{selected.latency_ms} ms</b></span> : null}</div>
      </section>
    </div>
  </>;
}

function ExperimentPage({ settings, setSettings, models, activeModels, launchedModelIds, running, wtc, cte, total, build }: { settings: Settings; setSettings: (s: Settings) => void; models: Model[]; activeModels: Model[]; launchedModelIds: string[]; running: boolean; wtc: number; cte: number; total: number; build: () => void }) {
  const patch = (p: Partial<Settings>) => setSettings({ ...settings, ...p });
  const slotIds = modelSlotIds(settings, models);
  const setSlots = (ids: string[]) => patch({
    model_scope: "slots",
    model_slot_ids: JSON.stringify(ids.slice(0, 4)),
    single_model_id: ids.at(-1) || settings.single_model_id,
    concurrency: Math.max(1, Math.min(4, ids.length || 1)),
  });
  const addSlot = (modelId: string) => {
    if (slotIds.includes(modelId) || slotIds.length >= 4) return;
    setSlots([...slotIds, modelId]);
  };
  const removeSlot = (modelId: string) => {
    if (running && launchedModelIds.includes(modelId)) return;
    setSlots(slotIds.filter(id => id !== modelId));
  };
  const completeGroupMode = bool(settings.run_word_to_color) && bool(settings.run_color_to_emotion);
  const completeGroups = completeGroupMode ? settings.repetitions * activeModels.length : 0;
  const hasGemini = activeModels.some(usesGeminiStablePolicy);
  return <>
    <PageTitle index="03" title="设计实验" subtitle="选择实验任务和采样深度；所有科研不变量在模型之间保持锁定。" />
    <div className="experiment-grid">
      <section className="task-column">
        <div className={`task-card ${bool(settings.run_word_to_color) ? "active" : ""}`}>
          <div className="task-card-head"><span className="task-index">A</span><div><span className="eyebrow">任务一</span><h3>词选色 Word → Color</h3></div><Toggle checked={bool(settings.run_word_to_color)} onChange={v => patch({ run_word_to_color: v })} label="词选色" disabled={running} /></div>
          <p>每轮将 20 个英文情绪词以随机顺序放入同一请求；模型为每个词独立返回一个最直觉相关的 sRGB HEX 颜色。</p>
          <pre><span>输入</span> 20 个乱序情绪词{`\n`}<span>输出</span> {`{ "Admiration": { "hex": "#6A5ACD" }, … }`}</pre>
          <div className="task-math"><span>20 个情绪</span><i>×</i><span>{settings.repetitions} 次</span><i>×</i><span>{activeModels.length} 个模型</span><b>{Math.ceil(wtc / 20).toLocaleString()} 个整组请求</b></div>
        </div>
        <div className={`task-card ${bool(settings.run_color_to_emotion) ? "active" : ""}`}>
          <div className="task-card-head"><span className="task-index">B</span><div><span className="eyebrow">任务二</span><h3>色选词 Color → Emotion</h3></div><Toggle checked={bool(settings.run_color_to_emotion)} onChange={v => patch({ run_color_to_emotion: v })} label="色选词" disabled={running} /></div>
          <p>每轮将 11 个匿名颜色题以随机顺序放入同一请求；每题可选择部分或全部情绪，并为每个已选情绪填写 1–5 共 5 级关联强度。</p>
          <pre><span>输入</span> 11 个乱序颜色题{`\n`}<span>输出</span> {`{ "C9": { "associations": [{ "emotion": "Joy", "intensity": 5 }] }, … }`}</pre>
          <div className="task-math"><span>11 个颜色</span><i>×</i><span>{settings.repetitions} 次</span><i>×</i><span>{activeModels.length} 个模型</span><b>{Math.ceil(cte / 11).toLocaleString()} 个整组请求</b></div>
        </div>
      </section>
      <aside className="configuration-panel panel">
        <div className="panel-head"><div><h3>采样配置</h3><p>先逐个添加模型组，再一起运行；运行中仍可追加未启动模型。</p></div></div>
        <div className="model-scope-control">
          <div className="scope-head"><span className="eyebrow">并行模型实验组</span><Pill tone="blue">{activeModels.length} / 4 组</Pill></div>
          <div className="experiment-slot-list">{activeModels.map((model, index) => {
            const launched = launchedModelIds.includes(model.id);
            return <div className={`experiment-slot ${launched ? "launched" : ""}`} key={model.id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{model.alias}</b><small>{model.model_id} · {launched ? "正在运行或已加入" : "待启动"}</small></div><Pill tone={launched ? "green" : "neutral"}>{launched ? "已隔离运行" : "待运行"}</Pill><button type="button" disabled={running && launched} onClick={() => removeSlot(model.id)} aria-label={`移除 ${model.alias}`}>×</button></div>;
          })}</div>
          {activeModels.length < 4 ? <label>增加一个单模型实验组<select value="" onChange={e => { if (e.target.value) addSlot(e.target.value); }}><option value="">选择模型加入（最多 4 组）</option>{models.filter(model => !slotIds.includes(model.id)).map(model => <option key={model.id} value={model.id}>{model.alias} · {model.model_id}</option>)}</select></label> : null}
          <small className="scope-note">{running ? "已运行的模型组已锁定；仍可添加新的模型组，返回运行页后点击“启动新增组”。" : "每个模型拥有独立进度、轮次记录、失败日志和导出分组；同一模型不会重复加入。"}</small>
        </div>
        <label className="range-label"><span>每个模型的完整实验轮次<b>{settings.repetitions} 组</b></span><input type="range" min="1" max="100" value={settings.repetitions} disabled={running} onChange={e => patch({ repetitions: number(e.target.value) })} /><small><span>1 组测试数据</span><span>100 组正式数据</span></small></label>
        <div className="repetition-presets"><span>快速设置</span>{[1, 10, 50, 100].map(value => <button type="button" key={value} disabled={running} className={settings.repetitions === value ? "active" : ""} onClick={() => patch({ repetitions: value })}>{value} 组</button>)}</div>
        {hasGemini ? <div className="daily-budget-note"><b>Gemini 将按天续跑</b><span>目标仍是每个模型 {settings.repetitions} 个完整轮次；3001 每个配额日最多启动 {GEMINI_DAILY_COMPLETE_ROUNDS} 轮（{GEMINI_DAILY_FORMAL_REQUESTS} 条正式请求），第二天点击继续即可，已有轮次不会重复。</span></div> : null}
        <div className="compact-fields"><label>并行模型组<input type="number" readOnly value={activeModels.length} /></label><label>总重试上限（含补齐）<input type="number" min="0" max="5" disabled={running} value={settings.max_retry} onChange={e => patch({ max_retry: number(e.target.value) })} /></label><label>超时（秒）<input type="number" min="180" disabled={running} value={Math.max(180, settings.timeout_seconds)} onChange={e => patch({ timeout_seconds: Math.max(180, number(e.target.value)) })} /></label></div>
        <div className="order-controls">
          <div className="strategy-title"><div><span className="eyebrow">呈现顺序</span><b>可复现乱序</b></div><small>按基础 Seed 确定每轮顺序</small></div>
          <div className={bool(settings.shuffle_emotion_order) ? "order-row active" : "order-row"}><span>实验一</span><div><b>20 个情绪询问顺序乱序</b><small>每轮以不同顺序逐个询问情绪词，降低固定位置偏差。</small></div><Toggle checked={bool(settings.shuffle_emotion_order)} onChange={v => patch({ shuffle_emotion_order: v })} label="实验一情绪顺序乱序" disabled={running} /></div>
          <div className={bool(settings.shuffle_color_order) ? "order-row active" : "order-row"}><span>实验二</span><div><b>11 个颜色询问顺序乱序</b><small>每轮以不同顺序逐个询问匿名颜色。</small></div><Toggle checked={bool(settings.shuffle_color_order)} onChange={v => patch({ shuffle_color_order: v })} label="实验二颜色顺序乱序" disabled={running} /></div>
          <div className={bool(settings.shuffle_emotion_options) ? "order-row active" : "order-row"}><span>Prompt</span><div><b>实验二的 20 个情绪选项乱序</b><small>每个颜色 Prompt 内的情绪词顺序也独立乱序；顺序本身不代表强度。</small></div><Toggle checked={bool(settings.shuffle_emotion_options)} onChange={v => patch({ shuffle_emotion_options: v })} label="实验二情绪选项乱序" disabled={running} /></div>
        </div>
        <div className="randomness-strategies">
          <div className="strategy-title"><div><span className="eyebrow">随机性方案</span><b>按实验统一启用</b></div><small>每项均可独立关闭</small></div>
          <div className={bool(settings.prompt_seed_enabled) ? "strategy-row active" : "strategy-row"}>
            <span>A</span><div><b>提示词随机种子</b><small>在 Prompt 末尾附加可复现的 Seed 标签。</small>{bool(settings.prompt_seed_enabled) ? <label>基础 Seed<input type="number" disabled={running} value={settings.prompt_seed_base} onChange={e => patch({ prompt_seed_base: number(e.target.value) })} /></label> : null}</div><Toggle checked={bool(settings.prompt_seed_enabled)} onChange={v => patch({ prompt_seed_enabled: v })} label="提示词随机种子" disabled={running} />
          </div>
          <div className={bool(settings.native_seed_enabled) ? "strategy-row active" : "strategy-row"}>
          <span>B</span><div><b>模型原生 Seed</b><small>向支持 Seed 的接口发送同一完整轮次种子；不支持时明确记录。</small><em>{activeModels.filter(model => bool(model.supports_seed)).length} / {activeModels.length} 个本次模型声明支持</em></div><Toggle checked={bool(settings.native_seed_enabled)} onChange={v => patch({ native_seed_enabled: v })} label="模型原生 Seed" disabled={running} />
          </div>
          <div className={bool(settings.prompt_variants_enabled) ? "strategy-row active" : "strategy-row"}>
            <span>C</span><div><b>等价提示词轮换</b><small>按 Seed 在 3 个语义等价的 JSON 指令间确定性轮换。</small></div><Toggle checked={bool(settings.prompt_variants_enabled)} onChange={v => patch({ prompt_variants_enabled: v })} label="等价提示词轮换" disabled={running} />
          </div>
        </div>
        <div className="locked-list"><span className="eyebrow">已锁定条件</span>{[["实验语言", "English"], ["文化角色设定", "无"], ["输入形式", "仅文本"], ["上下文", "相互独立"], ["原始响应", "保存"]].map(([a,b]) => <div key={a}><span>{a}</span><b>{b}</b><i>⌑</i></div>)}</div>
        <div className="queue-summary"><span>预计独立数据组</span><strong>{completeGroups.toLocaleString()}</strong><p>{completeGroupMode ? `${settings.repetitions} 轮 × ${activeModels.length} 个模型实验组；每组严格包含 20 个词选色 + 11 个色选词` : "只有同时启用实验一和实验二，才会形成可导出的完整数据组"}</p><div><span>每个模型按独立轮次保存</span><span>合计 {(Math.ceil(wtc / 20) + Math.ceil(cte / 11)).toLocaleString()} 个 API 请求</span></div><div><span>{Math.ceil(wtc / 20).toLocaleString()} 个词选色整组请求</span><span>{Math.ceil(cte / 11).toLocaleString()} 个色选词整组请求</span></div></div>
        <button className="primary full" disabled={!total} onClick={build}>{running ? "保存新增组并返回运行页" : completeGroupMode ? `生成 ${completeGroups.toLocaleString()} 组独立数据` : "生成单任务队列（不计完整数据组）"} <span>→</span></button>
      </aside>
    </div>
  </>;
}

function RunnerPage({ state, setState, start, pendingCount, total, stats, modelProgress, plannedRoundsByModel, settings, models, launchedModelIds, keys, lastError, activity, geminiRunState, geminiDailyBudgets, repairCount, repairExhaustedCount, repairChecking, repairing, scanMissing, repairMissing }: { state: RunnerState; setState: (s: RunnerState) => void; start: () => void; pendingCount: number; total: number; stats: RunStats; modelProgress: ModelRunProgress; plannedRoundsByModel: Record<string, number>; settings: Settings; models: Model[]; launchedModelIds: string[]; keys: Record<string, string>; lastError: string; activity: string; geminiRunState: GeminiRunState; geminiDailyBudgets: Record<string, GeminiDailyBudget>; repairCount: number; repairExhaustedCount: number; repairChecking: boolean; repairing: boolean; scanMissing: () => void; repairMissing: () => void }) {
  const pct = total ? Math.min(100, stats.completed / total * 100) : 0;
  const averageLatency = stats.valid ? Math.round(stats.latencyTotal / stats.valid) : 0;
  const stateLabel = state === "running" ? "正在派发请求" : state === "paused" ? "队列已暂停" : state === "completed" ? "队列已完成" : "等待开始";
  return <>
    <PageTitle index="04" title="运行试次队列" subtitle="最多四个单模型实验组并行运行；进度、失败与结果按模型独立记录。" action={<div className="runner-actions">{state === "running" ? <><button className="secondary" onClick={() => setState("paused")}>Ⅱ 暂停全部</button>{pendingCount ? <button className="primary" onClick={start}>＋ 启动新增 {pendingCount} 组</button> : <button className="secondary" disabled>已运行 {launchedModelIds.length} / 4 组</button>}</> : <button className="primary" onClick={state === "paused" ? () => setState("running") : start}>{state === "paused" ? "恢复全部运行" : state === "completed" ? "重新运行所选组" : "开始并行实验"}</button>}</div>} />
    <section className="run-hero">
      <div className="run-number"><span>总体进度</span><strong>{stats.completed.toLocaleString()} <em>/ {total.toLocaleString()}</em></strong><div className="progress"><i style={{ width: `${pct}%` }} /></div><small>已完成 {pct.toFixed(1)}% · {stateLabel}{stats.active ? ` · ${stats.active} 个请求处理中` : ""}</small>{activity ? <small className="run-activity">当前：{activity}</small> : null}</div>
      <div className="run-metrics"><div><span>✓</span><p><b>{stats.valid.toLocaleString()}</b><small>有效</small></p></div><div><span>↻</span><p><b>{stats.retries.toLocaleString()}</b><small>已重试</small></p></div><div><span>×</span><p><b>{stats.failed.toLocaleString()}</b><small>失败</small></p></div><div><span>⏱</span><p><b>{averageLatency ? `${averageLatency} ms` : "—"}</b><small>平均延迟</small></p></div></div>
    </section>
    {models.some(usesGeminiStablePolicy) ? <section className={`gemini-policy-panel panel ${geminiRunState.status === "cooling" ? "cooling" : ""}`}>
      <div><span className="eyebrow">Gemini 单项目每日采集保护</span><h3>每天最多 7 个完整轮次 · {GEMINI_DAILY_FORMAL_REQUESTS} 条正式请求</h3><p>每轮固定包含 20 个词选色和 11 个色选词。平台按 Google 太平洋时间配额日计数，次日从新的 run_index 继续；数据库与导出会自动合并跨天结果。以 {GEMINI_DAILY_QUOTA_REFERENCE} RPD 为参考预留 {GEMINI_DAILY_RESERVE} 次给运行前检查和少量技术重试，实际配额仍以 Google Console 为准。</p><div className="gemini-budget-grid">{models.filter(usesGeminiStablePolicy).map(model => { const budget = geminiDailyBudgets[model.id]; const planned = plannedRoundsByModel[model.id] || 0; return <span key={model.id}><b>{model.alias}</b><small>完整 {budget?.completedRounds || 0} / {budget?.targetRounds || settings.repetitions} 轮</small><small>今日已启动 {budget?.todayRounds || 0} / {GEMINI_DAILY_COMPLETE_ROUNDS} 轮{planned ? ` · 本批 ${planned} 轮` : ""}</small></span>; })}</div></div>
      <div className="gemini-policy-status"><Pill tone={geminiRunState.status === "cooling" ? "amber" : geminiRunState.status === "running" ? "green" : "blue"}>{geminiRunState.status === "cooling" ? "冷却中" : geminiRunState.status === "running" ? "采集中" : "每日保护已就绪"}</Pill><small>{geminiRunState.status === "cooling" && geminiRunState.cooldownUntil ? `恢复时间 ${new Date(geminiRunState.cooldownUntil).toLocaleTimeString("zh-CN", { hour12: false })}` : "并发 1 · 8 RPM · 90 秒超时"}</small></div>
    </section> : null}
    {state === "completed" || repairCount || repairExhaustedCount ? <section className="repair-panel panel"><div><span className="eyebrow">结束后完整性检查</span><h3>{repairCount ? `发现 ${repairCount} 条可补齐的技术缺失` : repairExhaustedCount ? `仍有 ${repairExhaustedCount} 条最终缺失` : "当前试次清单完整"}</h3><p>只补齐清单中没有有效结果的逻辑试次；已经有效的回答绝不重新抽样。补齐仅执行一次，并继续使用原模型、原参数、原 Prompt 和原轮次。</p></div><div className="repair-actions"><button className="secondary" onClick={scanMissing} disabled={repairChecking || repairing}>{repairChecking ? "检查中…" : "重新检查缺失项"}</button>{repairCount ? <button className="primary" onClick={repairMissing} disabled={repairing}>{repairing ? "补齐中…" : `补齐 ${repairCount} 条缺失`}</button> : null}</div></section> : null}
    <div className="two-columns runner-grid">
      <section className="panel">
        <div className="panel-head"><div><h3>独立模型实验组</h3><p>每组拥有独立限流、进度和结果分区。</p></div><Pill tone={state === "running" ? "blue" : "neutral"}>{state === "running" ? `${launchedModelIds.length} 组运行中` : "待机"}</Pill></div>
        <div className="model-progress-table"><div className="table-head"><span>实验组 / 模型</span><span>组状态</span><span>词选色</span><span>色选词</span><span>成功率</span></div>{models.map((m, i) => { const progress = modelProgress[m.id] || { completed: 0, valid: 0, word: 0, color: 0 }; const launched = launchedModelIds.includes(m.id); const plannedRounds = plannedRoundsByModel[m.id] || (usesGeminiStablePolicy(m) ? geminiDailyBudgets[m.id]?.nextBatchRounds || 0 : settings.repetitions); const wordTotal = bool(settings.run_word_to_color) ? plannedRounds * 20 : 0; const colorTotal = bool(settings.run_color_to_emotion) ? plannedRounds * 11 : 0; return <div className="table-row" key={m.id}><span><i className={`model-glyph g${i}`}>{i + 1}</i><b>{m.alias}</b></span><span><Pill tone={launched ? "green" : keys[m.id] ? "blue" : "amber"}>{launched ? "独立运行" : keys[m.id] ? "待启动" : "需要 Key"}</Pill></span><span>{progress.word} / {wordTotal || "—"}</span><span>{progress.color} / {colorTotal || "—"}</span><span>{progress.completed ? `${(progress.valid / progress.completed * 100).toFixed(1)}%` : "—"}</span></div>; })}</div>
      </section>
      <section className="panel activity-panel">
        <div className="panel-head"><div><h3>运行就绪检查</h3><p>首次产生费用前的预检查。</p></div></div>
        <div className="check-list"><div className="pass"><i>✓</i><p><b>实验材料已锁定</b><small>20 个情绪 · 11 个颜色</small></p></div><div className="pass"><i>✓</i><p><b>上下文相互独立</b><small>不保留对话历史</small></p></div><div className={models.every(m => keys[m.id]) ? "pass" : "warn"}><i>{models.every(m => keys[m.id]) ? "✓" : "!"}</i><p><b>临时访问凭证</b><small>{models.filter(m => !keys[m.id]).length ? `缺少 ${models.filter(m => !keys[m.id]).length} 个模型的 Key` : "所有已启用模型均已就绪"}</small></p></div><div className="pass"><i>✓</i><p><b>重复答案策略</b><small>保留所有有效重复结果</small></p></div></div>
        {lastError ? <div className="integrity-note"><span>最近一次失败</span><p>{lastError}</p></div> : <div className="integrity-note"><span>研究完整性</span><p>重试仅用于修复无效格式。有效且重复的 HEX 或评分矩阵会被视为有意义的实验观察。</p></div>}
      </section>
    </div>
  </>;
}

function ReviewPage({ results, failures, models, groupSummaries, filterTask, setFilterTask, filterModel, setFilterModel }: { results: ResultRow[]; failures: FailureAttempt[]; models: Model[]; groupSummaries: RunGroupSummary[]; filterTask: string; setFilterTask: (s: string) => void; filterModel: string; setFilterModel: (s: string) => void }) {
  const groupedResults = new Map<string, ResultRow[]>();
  results.forEach(result => {
    const groupName = result.trial_id.startsWith("pilot-") || result.run_index <= 0 ? `${result.model_id}\u0000pilot` : `${result.model_id}\u0000${result.run_index}`;
    groupedResults.set(groupName, [...(groupedResults.get(groupName) || []), result]);
  });
  return <>
    <PageTitle index="05" title="审阅采集数据" subtitle="将每个清洗后的数值追溯至原始响应、Prompt 版本和校验事件。" action={<button className="secondary">＋ 高级筛选</button>} />
    <section className="panel review-panel">
      <div className="filter-bar"><div><label>实验任务<select value={filterTask} onChange={e => setFilterTask(e.target.value)}><option value="All tasks">全部任务</option><option value="Word to Color">词选色</option><option value="Color to Emotion">色选词</option></select></label><label>模型<select value={filterModel} onChange={e => setFilterModel(e.target.value)}><option value="All models">全部模型</option>{models.map(m => <option key={m.id}>{m.alias}</option>)}</select></label><label>校验状态<select><option>全部状态</option><option>有效</option><option>无效</option></select></label></div><span>{groupedResults.size} 组数据 · {results.length} 条底层请求</span></div>
      {failures.length ? <section className="review-run-group incomplete"><div className="review-run-head"><div><span>最近失败记录</span><b>{failures.length} 条可诊断请求</b></div><small>失败请求现在会永久记录；修复后重新运行不会覆盖已有有效结果。</small></div><div className="data-table"><div className="data-head"><span>试次 ID</span><span>模型</span><span>任务</span><span>刺激项</span><span>失败原因</span><span>HTTP</span><span>时间</span></div>{failures.map(failure => <div className="data-row" key={failure.attempt_id}><span className="mono">{failure.logical_trial_id}</span><span>{failure.model_alias}</span><span>{failure.task_type}</span><span>{failure.stimulus_id}</span><span className="truncate" title={failure.error_message}>{failure.error_message}</span><span><Pill tone="red">{failure.http_status || failure.status}</Pill></span><span>{new Date(failure.created_at).toLocaleString("zh-CN")}</span></div>)}</div></section> : null}
      {results.length ? <div className="review-groups">{[...groupedResults.entries()].map(([groupId, group]) => { const first = group[0]; const pilot = groupId.endsWith("\u0000pilot"); const summary = groupSummaries.find(item => item.model_id === first.model_id && Number(item.run_index) === Number(first.run_index)); const wordCount = pilot ? new Set(group.filter(row => row.task_type === "Word to Color").map(row => row.stimulus_id)).size : Number(summary?.word_count || 0); const colorCount = pilot ? new Set(group.filter(row => row.task_type === "Color to Emotion").map(row => row.stimulus_id)).size : Number(summary?.color_count || 0); const complete = wordCount === 20 && colorCount === 11; return <section className={`review-run-group ${complete ? "complete" : "incomplete"}`} key={groupId}><div className="review-run-head"><div><span>{pilot ? "单模型测试" : complete ? `第 ${first.run_index} 次完整实验` : `第 ${first.run_index} 次（未完成）`}</span><b>{first.model_alias}</b></div><small>词选色 {wordCount}/20 · 色选词 {colorCount}/11 · {complete ? "可作为 1 组正式导出" : `可抢救导出 · 已记录失败 ${summary?.failed_attempt_count || 0} 次`}</small></div><div className="data-table"><div className="data-head"><span>试次 ID</span><span>模型</span><span>任务</span><span>刺激项</span><span>清洗结果</span><span>状态</span><span>延迟</span></div>{group.map(r => <div className="data-row" key={r.trial_id}><span className="mono">{r.trial_id}</span><span>{r.model_alias}</span><span>{r.task_type}</span><span>{r.stimulus_id}</span><span className="mono truncate">{r.clean_json}</span><span><Pill tone={r.validation_status === "Valid" ? "green" : "red"}>{r.validation_status === "Valid" ? "有效" : "无效"}</Pill></span><span>{r.latency_ms} ms</span></div>)}</div></section>; })}</div> : failures.length ? null : <div className="empty-state"><div className="empty-orbit"><span>0</span></div><h3>尚无模型观察数据</h3><p>完成一次 Pilot 后，这里会显示可追溯的数据记录。实验配置和研究材料目前已可导出。</p><button className="secondary">打开实验运行页 <span>→</span></button></div>}
    </section>
  </>;
}

function ExportPage({ project, results, expectedGroups, groupSummaries, selectedGroups, setSelectedGroups, includeIncomplete, setIncludeIncomplete, exporting, exportConfig, exportCsv, exportSourceCsv, exportSampleWorkbook, exportSourceWorkbook }: {
  project: Project;
  results: ResultRow[];
  expectedGroups: number;
  groupSummaries: RunGroupSummary[];
  selectedGroups: string[] | null;
  setSelectedGroups: (groups: string[] | null) => void;
  includeIncomplete: boolean;
  setIncludeIncomplete: (include: boolean) => void;
  exporting: "" | "word" | "color" | "sample" | "source";
  exportConfig: () => void;
  exportCsv: (k: "emotions" | "colors") => void;
  exportSourceCsv: (k: "word" | "color") => void;
  exportSampleWorkbook: () => void;
  exportSourceWorkbook: () => void;
}) {
  const completeGroupSummaries = groupSummaries.filter(isCompleteRunGroup);
  const incompleteGroupSummaries = groupSummaries.filter(group => !isCompleteRunGroup(group));
  const eligibleGroupSummaries = includeIncomplete ? groupSummaries : completeGroupSummaries;
  const allGroupKeys = eligibleGroupSummaries.map(group => runGroupKey(group.model_id, group.run_index));
  const selectedSet = new Set(selectedGroups === null ? allGroupKeys : selectedGroups);
  const selectedCount = allGroupKeys.filter(key => selectedSet.has(key)).length;
  const hasSelectedData = selectedCount > 0;
  const toggleGroup = (key: string) => {
    const next = new Set(selectedGroups === null ? allGroupKeys : selectedGroups);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSelectedGroups(next.size === allGroupKeys.length ? null : [...next]);
  };
  return <>
    <PageTitle index="06" title="打包可复现数据" subtitle="不拆分情绪、不换算颜色空间，直接保留模型返回的源色彩字段与评分结构。" />
    <section className="archive-hero"><div><span className="eyebrow">可复现研究包</span><h2>{project.name}</h2><p>{project.id} · 实验版本 v{project.experiment_version} · 已采集 {results.length.toLocaleString()} 条试次记录</p></div><div className="archive-status"><Pill tone="green">已排除 API Key</Pill><Pill tone="green">已附版本信息</Pill><Pill tone="green">UTF-8 编码</Pill></div></section>
    <section className="panel export-selection">
      <div className="panel-head"><div><h3>选择本次要导出的数据</h3><p>抢救模式会保留已有有效值，缺失刺激项留空，并把失败详情写入 invalid_records。</p></div><div className="selection-actions"><button type="button" onClick={() => setSelectedGroups(null)}>全选</button><button type="button" onClick={() => setSelectedGroups([])}>清空</button></div></div>
      <div className="scope-buttons"><button type="button" className={includeIncomplete ? "active" : ""} onClick={() => { setIncludeIncomplete(true); setSelectedGroups(null); }}><b>抢救导出</b><small>包含未完成轮次（推荐）</small></button><button type="button" className={!includeIncomplete ? "active" : ""} onClick={() => { setIncludeIncomplete(false); setSelectedGroups(null); }}><b>严格正式导出</b><small>仅 20/20 + 11/11 完整轮次</small></button></div>
      {groupSummaries.length ? <><div className="selection-summary"><strong>{selectedCount}</strong><span>/ {eligibleGroupSummaries.length} 个轮次已选择</span><small>{includeIncomplete ? "缺失值会留空，失败原因会随工作簿一并导出" : "只导出两项任务均完整的正式轮次"}</small></div>{eligibleGroupSummaries.length ? <div className="export-group-list">{eligibleGroupSummaries.map(group => { const key = runGroupKey(group.model_id, group.run_index); const selected = selectedSet.has(key); const complete = isCompleteRunGroup(group); return <label key={key} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => toggleGroup(key)} /><span><b>{group.model_alias} · 第 {group.run_index} 次{complete ? "完整实验" : "（未完成）"}</b><small>词选色 {group.word_count}/20 · 色选词 {group.color_count}/11 · {complete ? "31 条有效结果" : `失败尝试 ${group.failed_attempt_count || 0} 次`}</small></span></label>; })}</div> : <div className="selection-empty">目前还没有同时集齐 20 个词选色和 11 个色选词的完整数据组。</div>}{!includeIncomplete && incompleteGroupSummaries.length ? <div className="incomplete-groups"><b>{incompleteGroupSummaries.length} 个未完成轮次已被严格模式排除</b>{incompleteGroupSummaries.map(group => <span key={runGroupKey(group.model_id, group.run_index)}>{group.model_alias} 第 {group.run_index} 次：词选色 {group.word_count}/20，色选词 {group.color_count}/11</span>)}</div> : null}</> : <div className="selection-empty">尚无正式实验数据。完成正式运行后，可在这里选择指定轮次导出。</div>}
    </section>
    <div className="export-grid">
      <article><span className="file-type json">{`{ }`}</span><div><h3>实验配置</h3><p>包括项目元数据、模型参数、锁定条件、Prompt 和实验材料版本。</p><small>JSON · 现在可用</small></div><button onClick={exportConfig}>下载 JSON <span>↓</span></button></article>
      <article><span className="file-type csv">CSV</span><div><h3>实验材料</h3><p>用于组成 Prompt 的标准 20 个情绪词和 11 个匿名色码。</p><small>2 个 CSV 文件 · 现在可用</small></div><div className="split-buttons"><button onClick={() => exportCsv("emotions")}>情绪词 ↓</button><button onClick={() => exportCsv("colors")}>颜色 ↓</button></div></article>
      <article className={hasSelectedData ? "" : "muted-card"}><span className="file-type data">源数据</span><div><h3>源格式实验结果</h3><p>词选色按“模型 × 重复轮次”合并，不再每个情绪一行；色选词保留完整评分 JSON。</p><small>{hasSelectedData ? `本次导出 ${selectedCount} 组` : "请先选择数据组"}</small></div><div className="split-buttons"><button disabled={!hasSelectedData || Boolean(exporting)} onClick={() => exportSourceCsv("word")}>{exporting === "word" ? "整理中…" : "导出选中词选色 ↓"}</button><button disabled={!hasSelectedData || Boolean(exporting)} onClick={() => exportSourceCsv("color")}>{exporting === "color" ? "整理中…" : "导出选中色选词 ↓"}</button></div></article>
      <article className={hasSelectedData ? "" : "muted-card"}><span className="file-type xlsx">样本</span><div><h3>按实验轮次导出</h3><p>每个模型的每次实验单独一行；抢救模式下缺失刺激项留空，Pilot 不会混入。</p><small>{hasSelectedData ? `本次导出 ${selectedCount} 行 · 计划总数 ${expectedGroups.toLocaleString()} 行` : "请先选择数据组"}</small></div><button disabled={!hasSelectedData || Boolean(exporting)} onClick={exportSampleWorkbook}>{exporting === "sample" ? "正在生成…" : "导出选中轮次"} <span>↓</span></button></article>
      <article className={hasSelectedData ? "" : "muted-card"}><span className="file-type xlsx">源文件</span><div><h3>原始多模型格式工作簿</h3><p>沿用豆包文件的 9 列主表布局，并附所选轮次的试次清单与补齐记录。</p><small>{hasSelectedData ? `本次导出 ${selectedCount} 组 · 4 个工作表` : "请先选择数据组"}</small></div><button disabled={!hasSelectedData || Boolean(exporting)} onClick={exportSourceWorkbook}>{exporting === "source" ? "正在生成…" : "导出选中源文件"} <span>↓</span></button></article>
    </div>
    <section className="export-manifest panel"><div className="panel-head"><div><h3>实验条件记录</h3><p>两种 XLSX 都记录 Temperature、Top P、最大输出长度、重复次数和 A/B/C 随机性方案开关；API Key 始终排除。</p></div><span className="manifest-id">可复现条件 · 源回答</span></div><div className="manifest-grid">{["sample_91_columns", "row_manifest", "experiment_conditions", "word_to_color_source", "color_to_emotion_source", "randomness_policy"].map((x, i) => <span key={x}><i>{String(i + 1).padStart(2, "0")}</i>{x}<b>{i < 3 || results.length ? "就绪" : "待生成"}</b></span>)}</div></section>
  </>;
}
