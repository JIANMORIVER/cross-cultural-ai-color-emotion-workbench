import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the Chromalab research workspace and social metadata", async () => {
  const [layout, platform] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Chromalab 3006 · 连续色彩分布距离版/);
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
  assert.match(engine, /task2-indicators/);
  assert.match(engine, /task2-pattern/);
  assert.match(engine, /task2-human-ai/);
  assert.match(engine, /task2-cohort-test/);
  assert.match(engine, /task-cross-bidirectional/);
  assert.match(engine, /task-cross-groups/);
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
  assert.match(task1Visuals, /导出科研图|exportCurrentFigure/);
  assert.match(task2Visuals, /关联概率与条件强度/);
  assert.match(task2Visuals, /各来源颜色—情绪气泡点阵/);
  assert.match(task2Visuals, /所有来源采用同一尺度/);
  assert.match(task2Visuals, /八来源 × 标准色的 0–5 评分分布/);
  assert.match(task2Visuals, /来源为行、颜色为列/);
  assert.match(task2Visuals, /各来源 GEW 颜色面积扇区轮/);
  assert.match(task2Visuals, /小扇片面积与当前指标成正比/);
  assert.match(task2Visuals, /广度、条件强度与效价偏向/);
  assert.match(task2Visuals, /完整 11×20 矩阵模式相似性/);
  assert.match(task2Visuals, /指定颜色×情绪的八组并列比较/);
  assert.match(task2Visuals, /指定单元的八组两两差值矩阵/);
  assert.match(task2Visuals, /覆盖全部28个组对/);
  assert.match(task2Visuals, /单一来源、单一颜色的情绪画像/);
  assert.match(task2Visuals, /两个指定来源的差值热力图/);
  assert.match(bidirectionalVisuals, /participant \/ AI run 配对/);
  assert.match(bidirectionalVisuals, /矩阵 A/);
  assert.match(bidirectionalVisuals, /矩阵 B/);
  assert.match(bidirectionalVisuals, /Cycle/);
  assert.match(bidirectionalVisuals, /Permutation/);
  assert.match(bidirectionalVisuals, /八组比较/);
  assert.match(bidirectionalVisuals, /对角优势/);
  assert.match(bidirectionalVisuals, /结构距离/);
  assert.match(bidirectionalVisuals, /Cross-task ML/);
  assert.match(analysis, /05 双向颜色—情绪探索/);
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
  assert.match(platform, /Gemini 3\.6 Flash（稳定版）/);
  assert.match(platform, /gemini-3\.1-pro-preview/);
  assert.match(platform, /DeepSeek V4 Pro/);
  assert.match(platform, /Doubao Seed 2\.1 Pro/);
  assert.match(platform, /doubao-seed-2-1-pro-260628/);
  assert.match(platform, /试跑实验一/);
  assert.match(platform, /试跑实验二/);
  assert.match(platform, /加入并行实验组/);
  assert.match(pilotRoute, /INSERT INTO trial_results/);
  assert.match(pilotRoute, /buildModelRequest/);
  assert.match(runRoute, /buildModelRequest/);
  assert.match(modelTestRoute, /buildModelRequest/);
  assert.match(modelTestRoute, /MAX_PROBE_ATTEMPTS = 4/);
  assert.match(modelTestRoute, /retry-after/);
  assert.match(modelTestRoute, /1000 \* 2 \*\* attempt/);
  assert.match(modelTestRoute, /自动指数退避重试/);
  assert.match(modelRequest, /max_completion_tokens/);
  assert.match(modelRequest, /reasoning_effort = "none"/);
  assert.match(modelRequest, /isGemini36Flash/);
  assert.match(modelRequest, /supportsSamplingControls/);
  assert.match(modelRequest, /thinkingConfig: \{ thinkingLevel: "low" \}/);
  assert.match(modelRequest, /:generateContent/);
  assert.match(modelRequest, /"x-goog-api-key"/);
  assert.match(modelRequest, /body\.thinking = \{ type: "disabled" \}/);
  assert.match(modelRequest, /Doubao-Seed-2\.1-Pro 当前不可用/);
  assert.match(modelRequest, /body\.top_p = topP/);
  assert.match(modelRequest, /gpt56 \|\| gemini3/);
  assert.match(modelRequest, /Gemini 3\.1 Pro Preview 不提供免费 API 层/);
  assert.match(modelRequest, /暂时过载或服务不可用（HTTP 503）/);
  assert.match(platform, /不提供免费 API 层/);
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
  const [platform, manifestRoute, runRoute, groupRoute, workspaceRoute, migration] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/trial-manifest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/run-trial/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/run-group/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_wandering_vivisector.sql", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /registerTrialManifest/);
  assert.match(platform, /groupForSubmission/);
  assert.match(platform, /const attemptLimit = totalAttemptLimit\(group\.model, settings\.max_retry\)/);
  assert.match(platform, /repairMissingTrials/);
  assert.match(platform, /已经有效的回答绝不重新抽样/);
  assert.match(manifestRoute, /LEFT JOIN trial_results/);
  assert.match(manifestRoute, /repair_attempted_at IS NULL/);
  assert.match(manifestRoute, /item\.lastRetryable === true/);
  assert.match(runRoute, /const retryable = !refusal/);
  assert.match(groupRoute, /整组词选色缺少|parseColorBatchResponse/);
  assert.match(groupRoute, /整组色选词缺少|parseAssociationBatchResponse/);
  assert.match(workspaceRoute, /CREATE TABLE IF NOT EXISTS trial_manifest/);
  assert.match(migration, /CREATE TABLE `trial_manifest`/);
});

test("supports both realtime grouped Gemini runs and two-item native Batch rounds", async () => {
  const [platform, batchPanel, batchRoute, batchBuilder, modelTest, sourceExport] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/GeminiBatchPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/gemini-batch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/gemini-batch.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/model-test/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/export/source-export.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /isGemini31Pro/);
  assert.match(platform, /page === "batch"/);
  assert.doesNotMatch(platform, /runModels\.filter\(model => !isGemini31Pro/);
  assert.match(platform, /const pendingRunModels = runModels\.filter\(model => !launchedModelIds\.includes/);
  assert.match(platform, /实时整组、连接测试和缺失项补齐均使用 Google 原生 generateContent 接口/);
  assert.match(batchPanel, /Batch 每轮提交 2 个 item/);
  assert.match(batchRoute, /rounds \* 2/);
  assert.match(batchRoute, /parseColorBatchResponse/);
  assert.match(batchRoute, /parseRatingVectorBatchResponse/);
  assert.match(batchRoute, /grouped-round-v5/);
  assert.match(batchBuilder, /GEMINI_WORD_GROUP_ID/);
  assert.match(batchBuilder, /GEMINI_COLOR_GROUP_ID/);
  assert.match(modelTest, /usesGeminiStablePolicy/);
  assert.match(sourceExport, /collection_mode/);
});

test("keeps run indexes continuous without applying a Gemini-specific daily gate", async () => {
  const [platform, budget, workspaceRoute] = await Promise.all([
    readFile(new URL("../app/ExperimentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/experiment/daily-budget.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(budget, /COMPLETE_ROUND_REQUESTS = 31/);
  assert.match(platform, /createTrialQueue\(firstRunIndex, plans\)/);
  assert.match(platform, /跨日结果会按轮次自动合并/);
  assert.match(workspaceRoute, /FROM trial_manifest m/);
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

test("exports standalone Matplotlib publication figures rather than dashboard snapshots", async () => {
  const [client, server, renderer, task1, task2, bidirectional] = await Promise.all([
    readFile(new URL("../app/analysis/python-figures.ts", import.meta.url), "utf8"),
    readFile(new URL("../python_figures/server.py", import.meta.url), "utf8"),
    readFile(new URL("../python_figures/publication.py", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/Task1VisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/Task2VisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/BidirectionalVisualLab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(client, /renderPublicationFigure/);
  assert.match(client, /PublicationFigureFormat = "png" \| "svg"/);
  assert.match(server, /render_publication_figure/);
  assert.match(server, /image\/svg\+xml/);
  assert.match(renderer, /matplotlib\.use\("Agg"\)/);
  assert.match(renderer, /"svg\.fonttype": "none"/);
  assert.match(renderer, /"dpi"/);
  assert.match(task1, /renderPublicationFigure/);
  assert.match(task2, /renderPublicationFigure/);
  assert.match(bidirectional, /renderPublicationFigure/);
  assert.doesNotMatch(task1, /downloadPublicationPng/);
  assert.doesNotMatch(task2, /downloadPublicationPng|downloadElementPng/);
});

test("matches the Python paper-style emotion facets and exports every dashboard view independently", async () => {
  const [task1, task2, bidirectional, controls, styles, pythonClient, pythonPlot, packageJson] = await Promise.all([
    readFile(new URL("../app/analysis/Task1VisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/Task2VisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/BidirectionalVisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/FigureExportControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/visuals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/python-figures.ts", import.meta.url), "utf8"),
    readFile(new URL("../python_figures/hsvplot.py", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(task1, /GEW_EMOTIONS\.filter/);
  assert.match(task1, /emotionFaceted/);
  assert.match(task1, /批量导出 \$\{availableEmotions\.length\} 个情绪 ZIP/);
  assert.match(task1, /20-emotions-\$\{exportStyle\.format\}/);
  assert.match(task1, /对应 hsvplot\.py/);
  assert.match(task2, /导出此科研图/);
  assert.match(task2, /Task2FigureExportContext/);
  assert.match(bidirectional, /FigureExportControls/);
  assert.match(bidirectional, /VIEWS/);
  assert.match(controls, /每行分面/);
  assert.match(controls, /高精印刷 · 3×/);
  assert.match(controls, /保留标题与说明/);
  assert.match(styles, /--figure-columns/);
  assert.match(styles, /PYTHON PAPER STYLE|python-paper-view/);
  assert.match(task1, /columns: 5, width: 4500/);
  assert.match(task1, /renderPublicationFigure/);
  assert.match(task1, /导出科研图/);
  assert.match(pythonClient, /127\.0\.0\.1:8773/);
  assert.match(pythonPlot, /projection.*polar/);
  assert.match(pythonPlot, /sns\.color_palette\("husl"/);
  assert.match(pythonPlot, /target_width/);
  assert.match(packageJson, /scripts\/dev-local\.mjs/);
});

test("packages every available publication figure as native PNG and SVG", async () => {
  const analysis = await readFile(new URL("../app/AnalysisPlatform.tsx", import.meta.url), "utf8");
  assert.match(analysis, /exportPublicationFigures/);
  assert.match(analysis, /一键导出全部论文图表/);
  assert.match(analysis, /renderPublicationFigure/);
  assert.match(analysis, /Matplotlib/);
  assert.match(analysis, /\["png", "svg"\]/);
  assert.match(analysis, /figures\/\$\{job\.scope\}/);
  assert.match(analysis, /图表目录\.csv/);
  assert.match(analysis, /README\.txt/);
  assert.match(analysis, /publication-figures_PNG_SVG\.zip/);
  assert.doesNotMatch(analysis, /elementToPngBlob|publication-export-stage|document\.getElementById\("publication-export-stage"\)/);
});

test("exports a self-contained interactive HTML analysis report without credentials", async () => {
  const [platform, report] = await Promise.all([
    readFile(new URL("../app/AnalysisPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/html-report.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /exportInteractiveReport/);
  assert.match(platform, /calculateTask/);
  assert.match(platform, /TASKS\.filter\(task => taskAvailable\(task\.id\)\)/);
  assert.match(platform, /methods: TASKS\.map/);
  assert.match(platform, /导出交互式 HTML/);
  assert.match(report, /buildInteractiveHtmlReport/);
  assert.match(report, /type="application\/json"/);
  assert.match(report, /实验二仅嵌入聚合统计/);
  assert.match(report, /完整分析目录/);
  assert.match(report, /当前不适用/);
  assert.match(report, /rows: result\.rows/);
  assert.match(report, /downloadCsv/);
  assert.match(report, /drawHs/);
  assert.match(report, /drawBi/);
  assert.doesNotMatch(report, /MAX_RESULT_ROWS|slice\(0, MAX_RESULT_ROWS\)|truncated/);
  assert.doesNotMatch(report, /apiKey|Authorization|Bearer /);
  assert.doesNotMatch(report, /https?:\/\//);
});

test("explains filtered dashboard data and optionally reveals overlapping HSV observations", async () => {
  const [platform, insights, task1, styles, visualStyles] = await Promise.all([
    readFile(new URL("../app/AnalysisPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/DashboardInsights.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/Task1VisualLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/visuals.css", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /Task1Insights/);
  assert.match(platform, /Task2Insights/);
  assert.match(platform, /BidirectionalVisualLab/);
  assert.match(insights, /规则计算 · 非生成式 AI/);
  assert.match(insights, /描述性辅助阅读/);
  assert.match(insights, /重叠诊断/);
  assert.match(insights, /JSD 相似度/);
  assert.match(task1, /导出重叠呈现/);
  assert.match(task1, /空心计数气泡/);
  assert.match(task1, /气泡面积编码/);
  assert.match(task1, /密度 \/ hexbin/);
  assert.match(task1, /overlapLayout/);
  assert.match(task1, /显示位移不进入统计或导出数据/);
  assert.match(task1, /overlap-count-label/);
  assert.match(styles, /\.dashboard-insights/);
  assert.match(visualStyles, /\.overlap-display-toggle/);
  assert.match(visualStyles, /\.overlap-count-label/);
});

test("adds a leakage-safe phase-one machine learning workspace", async () => {
  const analysis = await readFile(new URL("../app/AnalysisPlatform.tsx", import.meta.url), "utf8");
  const lab = await readFile(new URL("../app/analysis/MachineLearningLab.tsx", import.meta.url), "utf8");
  const python = await readFile(new URL("../python_figures/ml_analysis.py", import.meta.url), "utf8");
  assert.match(analysis, /machine-learning/);
  assert.match(analysis, /MachineLearningLab/);
  assert.match(lab, /Cross-Generalization/);
  assert.match(lab, /Human → AI/);
  assert.match(python, /GroupKFold/);
  assert.match(python, /train_groups & test_groups/);
  assert.match(python, /predictions\[test\]/);
  assert.match(python, /normalizedTransfer/);
});

test("keeps the task-two rating distribution as source rows by color columns", async () => {
  const task2 = await readFile(new URL("../app/analysis/Task2VisualLab.tsx", import.meta.url), "utf8");
  const python = await readFile(new URL("../python_figures/publication.py", import.meta.url), "utf8");
  assert.match(task2, /8行×11列/);
  assert.match(task2, /sourcesFor\("06"\)\.length\} 行 × \{colors\.length\} 列/);
  assert.match(python, /nrows, columns = max\(1, len\(sources\)\), max\(1, len\(colors\)\)/);
  assert.match(python, /axes\[source_index, color_index\]/);
  assert.doesNotMatch(python, /columns = max\(1, min\(5, int\(options\.get\("columns"/);
});
