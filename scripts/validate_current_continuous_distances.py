"""Read the current eight-group workbook set and audit observed distance rankings."""

from __future__ import annotations

import colorsys
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd
from skimage.color import rgb2lab

ROOT = Path("/Users/jianmo/Desktop/数据8-6 2/原始数据")
PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "python_figures"))
from continuous_color_distances import EMOTIONS, run_continuous_distances

ALIASES = {
    "感兴趣": "Interest", "欢愉": "Amusement", "自豪": "Pride", "欢乐": "Joy", "愉快": "Pleasure",
    "满足": "Contentment", "赞赏": "Admiration", "爱": "Love", "如释重负": "Relief", "同情": "Compassion",
    "悲伤": "Sadness", "内疚": "Guilt", "后悔": "Regret", "羞愧": "Shame", "失望": "Disappointment",
    "恐惧": "Fear", "厌恶": "Disgust", "轻视": "Contempt", "憎恨": "Hate", "忿怒": "Anger",
}
FILES = {"CN":"cn.xlsx","BW":"bw.xlsx","UK":"uk.xlsx","US":"us.xlsx","DeepSeek":"deepseek.xlsx","Doubao":"doubao.xlsx","GPT":"gpt.xlsx","Gemini":"gemini.xlsx"}


def finite(value):
    try:
        result = float(value)
        return result if np.isfinite(result) else None
    except (TypeError, ValueError): return None


def lab_from_row(row, prefix):
    h, s, light = (finite(row.get(f"{prefix}.{channel}")) for channel in ("h", "s", "l"))
    if h is not None and s is not None and light is not None:
        rgb = np.asarray(colorsys.hls_to_rgb((h % 360) / 360, light / 100, s / 100), dtype=float)
    else:
        value = str(row.get(f"{prefix}.hex", "")).strip()
        if not value.startswith("#") or len(value) not in (4, 7): return None
        if len(value) == 4: value = "#" + "".join(character * 2 for character in value[1:])
        try: rgb = np.asarray([int(value[index:index+2], 16) / 255 for index in (1,3,5)], dtype=float)
        except ValueError: return None
    return rgb2lab(rgb.reshape(1,1,3)).reshape(3)


def load_rows():
    output, counts = [], {}
    for source, file_name in FILES.items():
        frame = pd.read_excel(ROOT / file_name, sheet_name=0)
        cohort = "human" if source in {"CN","BW","UK","US"} else "ai"
        source_rows = 0
        prefixes = sorted({column[:-4] for column in frame.columns if str(column).startswith("color_data.") and str(column).endswith(".hex")})
        for row_index, row in frame.iterrows():
            for prefix in prefixes:
                label = prefix.split(".", 1)[1]; emotion = ALIASES.get(label, label if label in EMOTIONS else "")
                if not emotion: continue
                lab = lab_from_row(row, prefix)
                if lab is None or not np.all(np.isfinite(lab)): continue
                item = {"source": source, "cohort": cohort, "emotion": emotion, "labL": float(lab[0]), "labA": float(lab[1]), "labB": float(lab[2])}
                item["participant" if cohort == "human" else "run"] = str(row_index + 1)
                output.append(item); source_rows += 1
        counts[source] = {"workbookRows": len(frame), "validColorRows": source_rows, "completeEquivalentRuns": source_rows / 20}
    return output, counts


if __name__ == "__main__":
    rows, counts = load_rows()
    result = run_continuous_distances({"rows": rows, "options": {"bootstrapIterations": 0, "assignmentRepeats": 100}})
    closest = [row for row in result["ranking"] if row["rank"] == 1]
    payload = {"sourceCounts": counts, "closest": closest, "metricAgreement": result["metricAgreement"], "rankAgreement": result["rankAgreement"], "metadata": result["metadata"]}
    target = PROJECT / "outputs" / "current_continuous_distance_validation.json"
    target.parent.mkdir(exist_ok=True); target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"target": str(target), "counts": counts, "closest": closest}, ensure_ascii=False, indent=2))
