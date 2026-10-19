import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds the raw-point continuous colour distance framework to the 3006 clone", async () => {
  const [component, analysis, server, platform] = await Promise.all([
    readFile(new URL("../app/analysis/ContinuousDistanceLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../python_figures/continuous_color_distances.py", import.meta.url), "utf8"),
    readFile(new URL("../python_figures/server.py", import.meta.url), "utf8"),
    readFile(new URL("../app/AnalysisPlatform.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /连续色彩分布距离比较/);
  assert.match(component, /Bootstrap（仅诊断）/);
  assert.match(component, /导出科研图 PNG/);
  assert.match(component, /FORMAL INFERENCE · BLOCK PERMUTATION · HOLM/);
  assert.match(component, /human_pairwise_block_permutation\.csv/);
  assert.match(component, /fixed_human_ai_descriptive_only\.csv/);
  assert.match(analysis, /def delta_e76_matrix/);
  assert.match(analysis, /def delta_e00_matrix/);
  assert.match(analysis, /linear_sum_assignment/);
  assert.match(analysis, /def energy_distance_cie76/);
  assert.match(analysis, /wasserstein_distance_nd/);
  assert.match(analysis, /def _formal_human_permutation/);
  assert.match(analysis, /shared AI reference/);
  assert.match(analysis, /Energy76-U/);
  assert.match(analysis, /def _pairwise_inference/);
  assert.match(analysis, /def _compact_letters/);
  assert.match(analysis, /def _holm/);
  assert.match(server, /continuous-distances/);
  assert.match(platform, /ContinuousDistanceLab/);
});
