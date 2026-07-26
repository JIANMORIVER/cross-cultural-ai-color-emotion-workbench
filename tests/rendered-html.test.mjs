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
  const [platform, analysis, engine, task1Visuals, task2Visuals, bidirectionalVisuals] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AnalysisPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/Task1VisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/Task2VisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/BidirectionalVisualLab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /数据分析/);
  assert.match(analysis, /multiple/);
  assert.match(analysis, /实验组队列/);
  assert.match(analysis, /合并已启用组/);
  assert.match(analysis, /仅当前设置组/);
  assert.match(analysis, /运行全部可用分析/);
  assert.match(analysis, /一键筛除无关\/隐藏行/);
  assert.match(analysis, /一键筛去无关列/);
  assert.match(analysis, /全部组智能筛列/);
  assert.match(analysis, /一键导出归档 ZIP/);
  assert.match(analysis, /导入配置 JSON/);
  assert.match(analysis, /导出配置 JSON/);
  assert.match(analysis, /_analysis_cohort/);
  assert.match(analysis, /HSL 为权威/);
  assert.match(analysis, /浮点 sRGB/);
  assert.match(analysis, /CIELAB D65 · ΔE76/);
  assert.match(analysis, /analysis_manifest/);
  assert.match(analysis, /导出全部结果 XLSX/);
  assert.match(analysis, /导出 CSV/);
  assert.match(analysis, /数据大屏/);
  assert.match(engine, /task1-cluster/);
  assert.match(engine, /task2-pairwise/);
  assert.match(engine, /Jensen_Shannon距离/);
  assert.match(engine, /task1-hsv/);
  assert.match(engine, /task1-within-delta/);
  assert.match(engine, /task1-bias/);
  assert.match(engine, /task1-diversity/);
  assert.match(engine, /task1-hue-jsd/);
  assert.match(engine, /task1-human-ai/);
  assert.match(engine, /task1-cohort-test/);
  assert.match(engine, /task2-valence/);
  assert.match(engine, /task2-concentration/);
  assert.match(engine, /task2-human-ai/);
  assert.match(engine, /task2-cohort-test/);
  assert.match(engine, /task-cross-bidirectional/);
  assert.match(engine, /deltaE2000/);
  assert.match(engine, /JSD相似度_综合/);
  assert.match(engine, /regularizedGammaQ/);
  assert.match(engine, /conversionPath/);
  assert.match(engine, /consistencyDeltaE/);
  assert.match(task1Visuals, /H–S 极坐标分面/);
  assert.match(task1Visuals, /V–S 密度散点分面/);
  assert.match(task1Visuals, /K-means 权重色带/);
  assert.match(task1Visuals, /来源对平均 ΔE 与基线/);
  assert.match(task1Visuals, /情绪–来源难度聚类热图/);
  assert.match(task1Visuals, /文化引力场散点图/);
  assert.match(task1Visuals, /文化距离斜率图/);
  assert.match(task1Visuals, /a\*–b\* 色域密度分面/);
  assert.match(task1Visuals, /L\* 与色度分布 \/ 集中度/);
  assert.match(task1Visuals, /导出图表 PNG/);
  assert.match(task2Visuals, /关联概率与条件强度/);
  assert.match(task2Visuals, /颜色—情绪气泡点阵分面/);
  assert.match(task2Visuals, /每个来源一张同尺度点阵/);
  assert.match(task2Visuals, /单一颜色的 20 情绪径向画像/);
  assert.match(task2Visuals, /来源差值热力图/);
  assert.match(bidirectionalVisuals, /P \/ Q 直接展陈/);
  assert.match(bidirectionalVisuals, /同一情绪的双向概率色带/);
  assert.match(bidirectionalVisuals, /方向差热图/);
  assert.match(bidirectionalVisuals, /双向散点/);
  assert.match(analysis, /双向整合 · 探索/);
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

test("supports one-model pilots, current GPT-5.6 variants, and a real saved pilot request", async () => {
  const [platform, pilotRoute, runRoute, modelTestRoute, modelRequest, migration, modelMigration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pilot-test/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/run-trial/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/model-test/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/model-request.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_soft_wiccan.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_upgrade_gpt56.sql", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /具体模型型号/);
  assert.match(platform, /GPT 5\.6（旗舰别名）/);
  assert.match(platform, /gpt-5\.6-sol/);
  assert.match(platform, /gpt-5\.6-terra/);
  assert.match(platform, /gpt-5\.6-luna/);
  assert.match(platform, /Gemini 3\.5 Flash/);
  assert.match(platform, /DeepSeek V4 Pro/);
  assert.match(platform, /试跑实验一/);
  assert.match(platform, /试跑实验二/);
  assert.match(platform, /加入并行实验组/);
  assert.match(pilotRoute, /INSERT INTO trial_results/);
  assert.match(pilotRoute, /buildChatRequest/);
  assert.match(runRoute, /buildChatRequest/);
  assert.match(modelTestRoute, /buildChatRequest/);
  assert.match(modelRequest, /max_completion_tokens/);
  assert.match(modelRequest, /reasoning_effort = "none"/);
  assert.match(modelRequest, /type: "json_schema"/);
  assert.match(pilotRoute, /Interest/);
  assert.doesNotMatch(pilotRoute, /INSERT[^;]*apiKey/s);
  assert.match(migration, /model_scope/);
  assert.match(migration, /single_model_id/);
  assert.match(modelMigration, /gpt-5\.6/);
});

test("supports up to four incremental model experiment slots with isolated results", async () => {
  const [platform, workspaceRoute, exportSource, migration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/export/source-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_nappy_darkstar.sql", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /并行模型实验组/);
  assert.match(platform, /slice\(0, 4\)/);
  assert.match(platform, /启动新增 \{pendingCount\} 组/);
  assert.match(platform, /activeRunGroupsRef/);
  assert.match(platform, /launchedModelIdsRef/);
  assert.match(platform, /每个模型按独立轮次保存/);
  assert.match(workspaceRoute, /model_slot_ids/);
  assert.match(exportSource, /并行模型组ID/);
  assert.match(migration, /model_slot_ids/);
});

test("uses partial 1–5 emotion ratings and reproducible shuffled presentation orders", async () => {
  const [platform, prompts, randomness, responseParser, migration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/prompts.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/randomness.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/response-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_material_mantis.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(platform, /0–100 关联强度/);
  assert.match(platform, /1–5 共 5 级关联强度/);
  assert.match(platform, /20 个情绪询问顺序乱序/);
  assert.match(platform, /11 个颜色询问顺序乱序/);
  assert.match(prompts, /Choose any subset/);
  assert.match(prompts, /1 = very weak/);
  assert.match(randomness, /seededShuffle/);
  assert.match(responseParser, /numeric < 1 \|\| numeric > 5/);
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

test("supports strict complete exports and rescue exports for incomplete runs", async () => {
  const [platform, sourceExport] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/export/source-export.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /严格正式导出/);
  assert.match(platform, /抢救导出/);
  assert.match(platform, /invalid_records/);
  assert.match(platform, /isCompleteRunGroup/);
  assert.match(sourceExport, /group\.word\.size === 20 && group\.color\.size === 11/);
  assert.match(sourceExport, /completeFormalResults/);
  assert.match(sourceExport, /payload\.export_scope === "available"/);
});

test("persists exact failed attempts and uses tolerant validated response parsing", async () => {
  const [runRoute, workspaceRoute, parser, migration] = await Promise.all([
    readFile(new URL("../app/api/run-trial/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/response-parser.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_orange_thor_girl.sql", import.meta.url), "utf8"),
  ]);
  assert.match(runRoute, /saveAttempt/);
  assert.match(runRoute, /validation_error/);
  assert.match(runRoute, /request_error/);
  assert.match(workspaceRoute, /recentFailures/);
  assert.match(parser, /extractBalancedJson/);
  assert.match(parser, /normalizeHex/);
  assert.match(parser, /normalizedIntensity/);
  assert.match(migration, /CREATE TABLE `trial_attempts`/);
});

test("registers an a-priori trial manifest and allows one capped post-run repair only for retryable missing trials", async () => {
  const [platform, manifestRoute, runRoute, workspaceRoute, migration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/trial-manifest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/run-trial/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_wandering_vivisector.sql", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /registerTrialManifest/);
  assert.match(platform, /immediateRetryLimit = Math\.max\(0, settings\.max_retry - 1\)/);
  assert.match(platform, /repairMissingTrials/);
  assert.match(platform, /已经有效的回答绝不重新抽样/);
  assert.match(manifestRoute, /LEFT JOIN trial_results/);
  assert.match(manifestRoute, /repair_attempted_at IS NULL/);
  assert.match(manifestRoute, /item\.lastRetryable === true/);
  assert.match(runRoute, /const retryable = !refusal/);
  assert.match(workspaceRoute, /CREATE TABLE IF NOT EXISTS trial_manifest/);
  assert.match(migration, /CREATE TABLE `trial_manifest`/);
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
