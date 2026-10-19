import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds the Experiment 1 multi-level similarity framework without a composite score", async () => {
  const [component, analysis, server] = await Promise.all([
    readFile(new URL("../app/analysis/Task1SimilarityLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../python_figures/task1_similarity.py", import.meta.url), "utf8"),
    readFile(new URL("../python_figures/server.py", import.meta.url), "utf8"),
  ]);
  assert.match(component, /DOMINANT-REGION CAPTURE/);
  assert.match(component, /DISTRIBUTION DISTANCE/);
  assert.match(component, /CLASSIFIER SEPARABILITY/);
  assert.match(component, /不计算综合分数/);
  assert.match(analysis, /wasserstein_distance_nd/);
  assert.match(analysis, /StratifiedGroupKFold/);
  assert.match(analysis, /DBSCAN/);
  assert.match(analysis, /No composite similarity score/);
  assert.match(server, /task1-similarity/);
});
