import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python_figures"))
sys.path.insert(0, str(ROOT / "scripts"))

from task2_heterogeneity import COLORS, EMOTIONS, run_task2_heterogeneity
from offline_task2_heterogeneity import PARSER_VERSION, parse_associations


class Task2HeterogeneityTests(unittest.TestCase):
    def test_fixed_offline_parser_has_auditable_version(self):
        self.assertEqual(PARSER_VERSION, "task2-offline-human-casefold-v2-20260825")

    def test_offline_parser_normalizes_human_lowercase_labels(self):
        parsed = parse_associations('[{"emotion":"love","intensity":4},{"emotion":"compassion","intensity":3}]')
        self.assertEqual(parsed, [
            {"emotion": "Love", "intensity": 4},
            {"emotion": "Compassion", "intensity": 3},
        ])

    def test_offline_parser_accepts_known_zero_selection_sentinels(self):
        self.assertEqual(parse_associations('[{"emotion":"None","intensity":1}]'), [])
        self.assertEqual(parse_associations('[{"emotion":"Other","intensity":1}]'), [])

    def test_offline_parser_rejects_unknown_emotion_instead_of_zero_filling(self):
        with self.assertRaisesRegex(ValueError, "outside the fixed GEW list"):
            parse_associations('[{"emotion":"Calm","intensity":4}]')

    def test_offline_parser_supports_web_compatible_field_aliases(self):
        parsed = parse_associations('[{"word":"joy","score":5},{"name":"Fear","value":2}]')
        self.assertEqual(parsed, [
            {"emotion": "Joy", "intensity": 5},
            {"emotion": "Fear", "intensity": 2},
        ])

    def rows(self):
        output = []
        for cohort, sources in (("human", ["CN", "BW", "UK", "US"]), ("ai", ["DeepSeek", "Doubao", "GPT", "Gemini"])):
            for source in sources:
                for unit in range(3):
                    for color_i, color in enumerate(COLORS):
                        for emotion_i, emotion in enumerate(EMOTIONS):
                            intensity = (color_i + emotion_i + unit + len(source)) % 6
                            output.append({"source": source, "cohort": cohort, "participant": str(unit), "run": str(unit), "sourceRow": unit + 1, "identityProvided": True, "color": color, "emotion": emotion, "selected": int(intensity > 0), "intensity": intensity, "valid": True})
        return output

    def test_complete_profiles_and_pair_families(self):
        result = run_task2_heterogeneity({"rows": self.rows(), "options": {"seed": 7, "stability": 2, "permutations": 9, "bootstrap": 10, "hungarian": 2}})
        self.assertEqual(result["qc"]["includedProfiles"], 24)
        self.assertEqual(result["qc"]["dimensions"], 220)
        self.assertEqual(len(result["distribution"]["energy"]), 32)
        self.assertEqual(len(result["distribution"]["mmd"]), 32)
        self.assertEqual(len([row for row in result["distribution"]["energy"] if row["representation"] == "binary"]), 16)
        self.assertTrue(all(row["permutationP"] > 0 for row in result["distribution"]["energy"]))
        self.assertTrue(all("fdrQ" in row for row in result["distribution"]["mmd"]))

    def test_fixed_seed_is_reproducible(self):
        payload = {"rows": self.rows(), "options": {"seed": 11, "stability": 1, "permutations": 9, "bootstrap": 10, "hungarian": 2}}
        first = run_task2_heterogeneity(payload)
        second = run_task2_heterogeneity(payload)
        keys = [(row["energy"], row["permutationP"], row["ciLow"], row["ciHigh"]) for row in first["distribution"]["energy"]]
        self.assertEqual(keys, [(row["energy"], row["permutationP"], row["ciLow"], row["ciHigh"]) for row in second["distribution"]["energy"]])


if __name__ == "__main__":
    unittest.main()
