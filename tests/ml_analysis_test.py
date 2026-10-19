import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python_figures"))

from ml_analysis import EMOTIONS, prepare_ml_data, run_first_phase


def synthetic_rows():
    rows = []
    sources = [("CN", "human"), ("BW", "human"), ("DeepSeek", "ai"), ("GPT", "ai")]
    colors = ["RED", "BLUE", "GREEN"]
    for source_index, (source, cohort) in enumerate(sources):
        for unit_index in range(6):
            for color_index, color in enumerate(colors):
                for emotion_index, emotion in enumerate(EMOTIONS):
                    signal = 5 if emotion_index % len(colors) == color_index else 0
                    rows.append({
                        "source": source, "cohort": cohort,
                        "participant": f"p{unit_index}" if cohort == "human" else "unused",
                        "run": f"r{unit_index}" if cohort == "ai" else "unused",
                        "color": color, "emotion": emotion,
                        "intensity": max(0, min(5, signal - ((source_index + unit_index + emotion_index) % 2))), "valid": True,
                    })
    return rows


def test_group_identity_and_oof_diagonal():
    prepared = prepare_ml_data(synthetic_rows())
    assert prepared["data"]["CN"]["unitField"] == "participant"
    assert prepared["data"]["GPT"]["unitField"] == "run/session"
    result = run_first_phase({"rows": synthetic_rows(), "options": {"outerFolds": 3, "innerFolds": 2, "cValues": [1], "gammaValues": ["scale"]}})
    for index, source in enumerate(result["sources"]):
        assert result["crossGeneralization"][index][index] == result["decoding"][source]["accuracy"]
        assert abs(result["normalizedTransfer"][index][index] - 1.0) < 1e-12
        assert result["decoding"][source]["outerFoldsUsed"] == 3
        assert len(result["decoding"][source]["predictions"]) == 18
    assert len(result["humanToAi"]) == 2
    assert len(result["humanToAi"][0]) == 2
    train_index, test_index = 0, 1
    chance = 1 / len(result["colors"])
    expected = (result["crossGeneralization"][train_index][test_index] - chance) / (result["crossGeneralization"][test_index][test_index] - chance)
    assert abs(result["normalizedTransfer"][train_index][test_index] - expected) < 1e-12


if __name__ == "__main__":
    test_group_identity_and_oof_diagonal()
    print("ml analysis test passed")
