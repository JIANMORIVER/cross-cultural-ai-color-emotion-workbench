"""Audit participant/run bootstrap support loss for MICD on the current workbook set.

This script intentionally analyses raw colour tokens only. It does not modify
the platform or recompute the formal distance result.
"""

from __future__ import annotations

from collections import defaultdict
import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path("/Users/jianmo/Desktop/数据8-6 2/原始数据")
FILES = {
    "CN": "cn.xlsx", "BW": "bw.xlsx", "UK": "uk.xlsx", "US": "us.xlsx",
    "DeepSeek": "deepseek.xlsx", "Doubao": "doubao.xlsx", "GPT": "gpt.xlsx", "Gemini": "gemini.xlsx",
}
RANDOM_STATE = 20260817
BOOTSTRAP_ITERATIONS = 1000


def _token(row: pd.Series, prefix: str) -> str:
    value = str(row.get(f"{prefix}.hex", "")).strip().upper()
    if value and value != "NAN":
        return value
    return "|".join(str(row.get(f"{prefix}.{channel}", "")) for channel in ("h", "s", "l"))


def main() -> None:
    report: list[dict[str, object]] = []
    for source_index, (source, file_name) in enumerate(FILES.items()):
        frame = pd.read_excel(ROOT / file_name, sheet_name=0)
        prefixes = sorted(
            {str(column)[:-4] for column in frame.columns if str(column).startswith("color_data.") and str(column).endswith(".hex")}
        )
        units = [[_token(row, prefix) for prefix in prefixes] for _, row in frame.iterrows()]
        n = len(units)
        original_support = np.asarray([len({unit[emotion] for unit in units}) for emotion in range(len(prefixes))], dtype=float)
        rng = np.random.default_rng(RANDOM_STATE + 100_000 * (source_index + 1))
        unique_units: list[int] = []
        support_ratios: list[float] = []
        for _ in range(BOOTSTRAP_ITERATIONS):
            indexes = rng.integers(0, n, size=n)
            unique_units.append(len(set(indexes.tolist())))
            sampled_support = np.asarray(
                [len({units[int(index)][emotion] for index in indexes}) for emotion in range(len(prefixes))], dtype=float
            )
            support_ratios.extend((sampled_support / np.maximum(original_support, 1)).tolist())
        report.append({
            "source": source,
            "units": n,
            "original_unique_colours_per_emotion_mean": float(np.mean(original_support)),
            "original_unique_colours_per_emotion_min": int(np.min(original_support)),
            "original_unique_colours_per_emotion_max": int(np.max(original_support)),
            "bootstrap_unique_units_mean": float(np.mean(unique_units)),
            "bootstrap_unique_units_ci": [float(np.quantile(unique_units, .025)), float(np.quantile(unique_units, .975))],
            "bootstrap_colour_support_ratio_mean": float(np.mean(support_ratios)),
            "bootstrap_colour_support_ratio_ci": [float(np.quantile(support_ratios, .025)), float(np.quantile(support_ratios, .975))],
        })
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
