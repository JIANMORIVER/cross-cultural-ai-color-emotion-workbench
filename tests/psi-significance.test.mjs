import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync(new URL("../app/analysis/engine.ts", import.meta.url), "utf8");
const visual = readFileSync(new URL("../app/analysis/Task2VisualLab.tsx", import.meta.url), "utf8");

test("adds the prespecified 16-pair structured PSI permutation inference", () => {
  assert.match(engine, /runGewPsiAiHumanSignificance/);
  assert.match(engine, /10_000/);
  assert.match(engine, /20_260_823/);
  assert.match(engine, /shuffledIndices\(GEW_COLOURS\.length, random\)/);
  assert.match(engine, /shuffledIndices\(GEW_EMOTIONS\.length, random\)/);
  assert.doesNotMatch(engine, /shuffledIndices\(GEW_COLOURS\.length \* GEW_EMOTIONS\.length/);
  assert.match(engine, /\(1 \+ exceedances\) \/ \(nPermutation \+ 1\)/);
  assert.match(engine, /const adjusted = bh\(raw\.map\(row => row\.p\)\)/);
  assert.match(engine, /output\.length === 16 && uniquePairs === 16/);
  assert.match(engine, /independent color-label and emotion-label permutation/);
});

test("shows FDR stars in the symmetric PSI matrix and a 4 by 4 summary", () => {
  assert.match(visual, /psi_ai_human_significance\.csv/);
  assert.match(visual, /PatternSimilarityMatrix[\s\S]*significanceRows=/);
  assert.match(visual, /4×4 PSI 显著性摘要/);
  assert.match(visual, /BH-FDR family/);
  assert.match(visual, /Bootstrap 95% CI/);
  assert.match(visual, /Permutation p\/q/);
});
