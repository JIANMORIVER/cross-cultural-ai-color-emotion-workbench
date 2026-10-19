import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds browser-side import controls for R9000P gzip result archives", async () => {
  const [helper, continuous, similarity] = await Promise.all([
    readFile(new URL("../app/analysis/offline-result-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/ContinuousDistanceLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis/Task1SimilarityLab.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(helper, /gunzipSync/);
  assert.match(helper, /validateContinuous/);
  assert.match(helper, /validateSimilarity/);
  assert.match(helper, /validateHeterogeneity/);
  assert.match(helper, /normalizeNonFiniteJsonTokens/);
  assert.match(helper, /collapsedHumanPca/);
  assert.match(helper, /旧版全零 Human 结果/);
  assert.match(continuous, /导入离线结果 \.json\.gz/);
  assert.match(continuous, /readOfflineAnalysisResult\(file,"continuous"\)/);
  assert.match(similarity, /导入离线结果 \.json\.gz/);
  assert.match(similarity, /readOfflineAnalysisResult\(file,"similarity"\)/);
});
