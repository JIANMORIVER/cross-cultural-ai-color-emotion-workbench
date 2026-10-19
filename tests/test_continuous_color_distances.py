import os, sys, unittest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python_figures"))
from continuous_color_distances import (
    _compact_letters, _holm, _pairwise_inference,
    EMOTIONS, assignment_common_m_contrast, assignment_distance, energy_distance_cie76, micd,
    render_continuous_distance_figure, run_continuous_distances, wasserstein_raw,
)


class ContinuousDistanceToyTests(unittest.TestCase):
    def test_identical_sets_are_zero(self):
        a = np.array([[50., 20., 30.], [70., -10., 5.], [30., 0., -20.]])
        self.assertLess(micd(a, a, "cie76")["symmetric"], 1e-12)
        self.assertLess(micd(a, a, "ciede2000")["symmetric"], 1e-12)
        self.assertLess(assignment_distance(a, a, "cie76")["mean"], 1e-12)
        self.assertLess(abs(energy_distance_cie76(a, a)["energy"]), 1e-12)
        self.assertLess(wasserstein_raw(a, a), 1e-12)

    def test_translation_increases_all_distances(self):
        a = np.array([[40., -5., 10.], [60., 5., -10.], [50., 0., 0.]])
        b = a + np.array([10., 4., -3.])
        self.assertGreater(micd(a, b)["symmetric"], 0)
        self.assertGreater(assignment_distance(a, b, "cie76")["mean"], 0)
        self.assertGreater(energy_distance_cie76(a, b)["energy"], 0)
        self.assertGreater(wasserstein_raw(a, b), 0)

    def test_energy_u_excludes_diagonal_and_v_retains_it(self):
        a = np.array([[0., 0., 0.], [2., 0., 0.]])
        b = np.array([[10., 0., 0.], [12., 0., 0.]])
        u = energy_distance_cie76(a, b, "u")
        v = energy_distance_cie76(a, b, "v")
        self.assertAlmostEqual(u["withinA"], 2.0)
        self.assertAlmostEqual(v["withinA"], 1.0)
        self.assertNotEqual(u["energy"], v["energy"])

    def test_assignment_common_m_is_deterministic_and_uses_smallest_group(self):
        def blocks(count, offset):
            return [{emotion: np.array([50., offset + index, emotion_index / 10]) for emotion_index, emotion in enumerate(EMOTIONS)} for index in range(count)]
        first = assignment_common_m_contrast(blocks(5, 0), blocks(3, 2), blocks(4, 5), 20, 123)
        second = assignment_common_m_contrast(blocks(5, 0), blocks(3, 2), blocks(4, 5), 20, 123)
        self.assertEqual(first["commonM"], 3)
        self.assertEqual(first["deltaDraws"], second["deltaDraws"])

    def test_support_asymmetry_is_directional(self):
        dispersed = np.array([[50., -40., 0.], [50., 0., 0.], [50., 40., 0.], [50., 0., 40.]])
        concentrated = np.array([[50., 0., 0.], [50., 1., 0.], [50., -1., 0.]])
        result = micd(dispersed, concentrated)
        self.assertGreater(result["aToB"], result["bToA"])

    def test_proportion_reversal_separates_density_sensitive_metrics(self):
        yellow = np.array([80., 0., 80.]); blue = np.array([35., 20., -70.])
        a = np.vstack([np.repeat(yellow[None, :], 9, axis=0), blue])
        b = np.vstack([yellow, np.repeat(blue[None, :], 9, axis=0)])
        self.assertLess(micd(a, b)["symmetric"], 1e-12)
        self.assertGreater(assignment_distance(a, b, "cie76")["mean"], 20)
        self.assertGreater(energy_distance_cie76(a, b)["energy"], 20)
        self.assertGreater(wasserstein_raw(a, b), 20)

    def test_holm_is_scoped_and_monotonic(self):
        rows = [{"p_raw": value} for value in [.01, .02, .20, .04, .50, .001]]
        _holm(rows)
        ordered = sorted(rows, key=lambda row: row["p_raw"])
        self.assertTrue(all(ordered[index]["p_holm"] <= ordered[index + 1]["p_holm"] for index in range(len(ordered) - 1)))
        self.assertAlmostEqual(next(row for row in rows if row["p_raw"] == .001)["p_holm"], .006)

    def test_compact_letters_preserve_every_pairwise_decision(self):
        groups = ["CN", "BW", "UK", "US"]
        significant = {frozenset(("CN", "UK")), frozenset(("CN", "US")), frozenset(("BW", "US"))}
        letters = _compact_letters(groups, significant, groups)
        for left_index, left in enumerate(groups):
            for right in groups[left_index + 1:]:
                shared = bool(set(letters[left]) & set(letters[right]))
                self.assertEqual(shared, frozenset((left, right)) not in significant)

    def test_pairwise_module_outputs_all_six_contrasts_in_both_directions(self):
        humans = ["CN", "BW", "UK", "US"]; ais = ["DeepSeek", "Doubao", "GPT", "Gemini"]
        ranking = []
        bootstrap = {}
        for ai_index, ai in enumerate(ais):
            for human_index, human in enumerate(humans):
                for metric_index, metric in enumerate(["Assignment00", "Energy76-V"]):
                    distance = 10 + ai_index * 2 + human_index + metric_index * .5
                    ranking.append({"ai_group": ai, "human_group": human, "metric": metric, "mean_distance": distance, "ci_low": distance - .3, "ci_high": distance + .3})
                    bootstrap[(ai, human, metric)] = [distance + offset for offset in [-.2, -.1, 0, .1, .2]]
        human_rows, ai_rows, letters, matrices, robustness = _pairwise_inference(humans, ais, ranking, bootstrap, 5)
        self.assertEqual(len(human_rows), 4 * 2 * 6)
        self.assertEqual(len(ai_rows), 4 * 2 * 6)
        self.assertEqual(len(letters), (4 * 2 * 4) * 2)
        self.assertEqual(len(matrices), (4 * 2 * 16) * 2)
        self.assertEqual(len(robustness), 4 * 6 * 2)
        self.assertTrue(all(row["n_bootstrap"] == 5 for row in human_rows + ai_rows))

    def test_end_to_end_result_contains_version_three_formal_outputs(self):
        humans = ["CN", "BW", "UK", "US"]; ais = ["DeepSeek", "Doubao", "GPT", "Gemini"]
        rows = []
        for source_index, source in enumerate(humans + ais):
            cohort = "human" if source in humans else "ai"
            for unit_index in range(2):
                for emotion_index, emotion in enumerate(EMOTIONS):
                    rows.append({"source": source, "cohort": cohort, "emotion": emotion, "labL": 50 + source_index, "labA": source_index * 2 + unit_index, "labB": -source_index + emotion_index / 20, "participant": f"p{unit_index}" if cohort == "human" else "", "run": f"r{unit_index}" if cohort == "ai" else ""})
        result = run_continuous_distances({"rows": rows, "options": {"bootstrapIterations": 0, "assignmentRepeats": 2, "permutationIterations": 2}})
        self.assertEqual(result["version"], 3)
        self.assertEqual(len(result["humanPairwisePermutation"]), 4 * 3 * 6)
        self.assertEqual(len(result["formalMetricRobustness"]), 4 * 6)
        self.assertTrue(all(row["n_permutations"] == 2 for row in result["humanPairwisePermutation"]))
        self.assertIn("shared AI reference", result["metadata"]["assignment"])
        for kind in ["formal-observed-significance", "formal-pairwise-effect", "formal-robustness"]:
            image = render_continuous_distance_figure({"result": result, "kind": kind, "metric": "MICD00", "format": "png"})
            self.assertGreater(len(image), 1000)


if __name__ == "__main__": unittest.main()
