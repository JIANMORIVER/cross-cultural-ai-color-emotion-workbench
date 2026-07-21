import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the Chromalab research workspace and social metadata", async () => {
  const [layout, platform] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Chromalab — 情绪—颜色实验与数据分析平台/);
  assert.match(layout, /og-analysis\.png/);
  assert.match(platform, /定义研究项目/);
  assert.match(platform, /英文情绪词/);
  assert.match(platform, /匿名颜色/);
});

test("provides local multi-file analysis, independent exports, and filtered dashboards", async () => {
  const [platform, analysis, engine] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AnalysisPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/engine.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /数据分析/);
  assert.match(analysis, /multiple/);
  assert.match(analysis, /合并全部文件/);
  assert.match(analysis, /导出 CSV/);
  assert.match(analysis, /数据大屏/);
  assert.match(engine, /task1-cluster/);
  assert.match(engine, /task2-pairwise/);
  assert.match(engine, /Jensen_Shannon距离/);
});

test("removes starter preview markers and keeps API keys out of exports", async () => {
  const [page, layout, platform, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page + layout, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(platform, /sessionStorage\.setItem/);
  assert.match(platform, /safeModels/);
  assert.doesNotMatch(platform, /apiKey:\s*apiKey/);
});

test("exports source-shaped results without expanding emotions or deriving color spaces", async () => {
  const [platform, sourceExport, exportRoute] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/export/source-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/export-data/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /不再每个情绪一行/);
  assert.match(platform, /word_to_color_source/);
  assert.match(sourceExport, /模型 × 重复轮次/);
  assert.match(sourceExport, /不从 HEX 计算 RGB、HSV 或 Lab/);
  assert.match(sourceExport, /buildWordToColorRows/);
  assert.match(sourceExport, /buildColorToEmotionRows/);
  assert.match(exportRoute, /raw_response/);
  assert.doesNotMatch(exportRoute, /api[_-]?key/i);
});

test("provides controllable randomness policies and both reference workbook exports", async () => {
  const [platform, sourceExport, randomness, migration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/export/source-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/randomness.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_huge_living_tribunal.sql", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /随机性控件/);
  assert.match(platform, /提示词随机种子/);
  assert.match(platform, /模型原生 Seed/);
  assert.match(platform, /等价提示词轮换/);
  assert.match(platform, /导出选中轮次/);
  assert.match(platform, /导出选中源文件/);
  assert.match(sourceExport, /SAMPLE_COLUMNS/);
  assert.match(sourceExport, /word_data\.D38/);
  assert.match(sourceExport, /color_data\.\$\{label\}\.\$\{field\}/);
  assert.match(randomness, /Random seed tag/);
  assert.match(randomness, /nativeSeed/);
  assert.match(migration, /prompt_variants_enabled/);
});

test("supports one-model pilots, visible model variants, and a real saved pilot request", async () => {
  const [platform, pilotRoute, migration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pilot-test/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_soft_wiccan.sql", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /具体模型型号/);
  assert.match(platform, /Gemini 3\.5 Flash/);
  assert.match(platform, /DeepSeek V4 Pro/);
  assert.match(platform, /试跑实验一/);
  assert.match(platform, /试跑实验二/);
  assert.match(platform, /单模型模式不会检查、调用或要求其他模型/);
  assert.match(pilotRoute, /INSERT INTO trial_results/);
  assert.match(pilotRoute, /Interest/);
  assert.doesNotMatch(pilotRoute, /INSERT[^;]*apiKey/s);
  assert.match(migration, /model_scope/);
  assert.match(migration, /single_model_id/);
});

test("uses partial 1–5 emotion ratings and reproducible shuffled presentation orders", async () => {
  const [platform, prompts, randomness, pilotRoute, migration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/prompts.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/randomness.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pilot-test/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_material_mantis.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(platform, /0–100 关联强度/);
  assert.match(platform, /1–5 共 5 级关联强度/);
  assert.match(platform, /20 个情绪询问顺序乱序/);
  assert.match(platform, /11 个颜色询问顺序乱序/);
  assert.match(prompts, /Choose any subset/);
  assert.match(prompts, /1 = very weak/);
  assert.match(randomness, /seededShuffle/);
  assert.match(pilotRoute, /intensity < 1 \|\| intensity > 5/);
  assert.match(migration, /shuffle_emotion_order/);
  assert.match(migration, /shuffle_color_order/);
  assert.match(migration, /shuffle_emotion_options/);
});

test("dispatches the full experiment queue with retries, pause support, and saved results", async () => {
  const [platform, runRoute] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/run-trial/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /createTrialQueue/);
  assert.match(platform, /fetch\("\/api\/run-trial"/);
  assert.match(platform, /runnerStateRef\.current === "paused"/);
  assert.match(platform, /settings\.max_retry/);
  assert.match(platform, /waitForRateLimit/);
  assert.match(platform, /Promise\.all\(Array\.from/);
  assert.match(platform, /个请求处理中/);
  assert.match(runRoute, /INSERT OR REPLACE INTO trial_results/);
  assert.match(runRoute, /AbortSignal\.timeout/);
  assert.match(runRoute, /retryable/);
  assert.doesNotMatch(runRoute, /INSERT[^;]*apiKey/s);
});

test("separates complete repetitions and keeps pilots out of formal exports", async () => {
  const [platform, sourceExport] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/export/source-export.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /每个模型的完整实验轮次/);
  assert.match(platform, /100 组正式数据/);
  assert.match(platform, /第 \$\{first\.run_index\} 次完整实验/);
  assert.match(platform, /导出选中轮次/);
  assert.match(sourceExport, /!result\.trial_id\.startsWith\("pilot-"\)/);
  assert.match(sourceExport, /filter\(isFormalResult\)/);
});

test("lets researchers select specific model-run groups for every result export", async () => {
  const [platform, workspaceRoute] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /选择本次要导出的数据/);
  assert.match(platform, /selectedExportGroups/);
  assert.match(platform, /导出选中轮次/);
  assert.match(platform, /selected\.has\(runGroupKey/);
  assert.match(workspaceRoute, /groupSummaries/);
  assert.match(workspaceRoute, /trial_id NOT LIKE 'pilot-%'/);
});

test("counts and exports a group only when all 20 word and 11 color trials exist", async () => {
  const [platform, sourceExport] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/export/source-export.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /每组含 20\/20 词选色 \+ 11\/11 色选词/);
  assert.match(platform, /未完成轮次不会导出/);
  assert.match(platform, /isCompleteRunGroup/);
  assert.match(sourceExport, /group\.word\.size === 20 && group\.color\.size === 11/);
  assert.match(sourceExport, /completeFormalResults/);
});

test("starts every new batch at the next unused run index and defaults exports to all groups", async () => {
  const [platform, workspaceRoute] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /createTrialQueue\(firstRunIndex/);
  assert.match(platform, /sequenceData\.nextRunIndex/);
  assert.match(platform, /为避免覆盖旧数据/);
  assert.match(platform, /setSelectedExportGroups\(null\)/);
  assert.match(workspaceRoute, /MAX\(run_index\)/);
  assert.match(workspaceRoute, /nextRunIndex/);
});
