"""Run Chromalab Experiment 1 formal analyses without a browser.

Input is the current eight-workbook layout used by the project. Results are
written after each selected analysis, so a browser refresh cannot affect the
calculation or the saved output.
"""

from __future__ import annotations

import argparse
import colorsys
import csv
from datetime import datetime
import gzip
import json
from pathlib import Path
import sys
import time
from typing import Any
import zipfile

import numpy as np
import pandas as pd
from skimage.color import rgb2lab

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "python_figures"))

from continuous_color_distances import run_continuous_distances
from task1_similarity import run_task1_similarity

EMOTIONS = [
    "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
    "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
]
ALIASES = {
    "感兴趣": "Interest", "欢愉": "Amusement", "自豪": "Pride", "欢乐": "Joy", "愉快": "Pleasure",
    "满足": "Contentment", "赞赏": "Admiration", "爱": "Love", "如释重负": "Relief", "同情": "Compassion",
    "悲伤": "Sadness", "内疚": "Guilt", "后悔": "Regret", "羞愧": "Shame", "失望": "Disappointment",
    "恐惧": "Fear", "厌恶": "Disgust", "轻视": "Contempt", "憎恨": "Hate", "忿怒": "Anger",
}
FILES = {
    "CN": "cn.xlsx", "BW": "bw.xlsx", "UK": "uk.xlsx", "US": "us.xlsx",
    "DeepSeek": "deepseek.xlsx", "Doubao": "doubao.xlsx", "GPT": "gpt.xlsx", "Gemini": "gemini.xlsx",
}
HUMANS = {"CN", "BW", "UK", "US"}


def finite(value: Any) -> float | None:
    try:
        number = float(value)
        return number if np.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def rgb_from_hex(value: Any) -> np.ndarray | None:
    text = str(value or "").strip()
    if not text.startswith("#") or len(text) not in (4, 7):
        return None
    if len(text) == 4:
        text = "#" + "".join(character * 2 for character in text[1:])
    try:
        return np.asarray([int(text[index:index + 2], 16) / 255 for index in (1, 3, 5)], dtype=float)
    except ValueError:
        return None


def rgb_from_hsl(row: pd.Series, prefix: str) -> np.ndarray | None:
    h, s, light = (finite(row.get(f"{prefix}.{channel}")) for channel in ("h", "s", "l"))
    if h is None or s is None or light is None:
        return None
    return np.asarray(colorsys.hls_to_rgb((h % 360) / 360, light / 100, s / 100), dtype=float)


def load_rows(input_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    summary: dict[str, Any] = {}
    missing = [file_name for file_name in FILES.values() if not (input_dir / file_name).exists()]
    if missing:
        raise FileNotFoundError("Missing input workbooks: " + ", ".join(missing))
    for source, file_name in FILES.items():
        frame = pd.read_excel(input_dir / file_name, sheet_name=0)
        cohort = "human" if source in HUMANS else "ai"
        prefixes = sorted({str(column)[:-4] for column in frame.columns if str(column).startswith("color_data.") and str(column).endswith(".hex")})
        valid = 0
        for row_index, row in frame.iterrows():
            for prefix in prefixes:
                label = prefix.split(".", 1)[1]
                emotion = ALIASES.get(label, label if label in EMOTIONS else "")
                if not emotion:
                    continue
                hsl_rgb = rgb_from_hsl(row, prefix)
                hex_rgb = rgb_from_hex(row.get(f"{prefix}.hex"))
                rgb = hsl_rgb if cohort == "human" and hsl_rgb is not None else hex_rgb if hex_rgb is not None else hsl_rgb
                if rgb is None or not np.all(np.isfinite(rgb)):
                    continue
                lab = rgb2lab(np.clip(rgb, 0, 1).reshape(1, 1, 3)).reshape(3)
                hue, saturation, value = colorsys.rgb_to_hsv(*np.clip(rgb, 0, 1))
                item = {
                    "source": source, "cohort": cohort, "emotion": emotion,
                    "labL": float(lab[0]), "labA": float(lab[1]), "labB": float(lab[2]),
                    "hsvH": float(hue * 360), "hsvS": float(saturation), "hsvV": float(value),
                }
                item["participant" if cohort == "human" else "run"] = str(row_index + 1)
                rows.append(item); valid += 1
        summary[source] = {"file": file_name, "workbookRows": len(frame), "validColorRows": valid, "completeEquivalentRuns": valid / 20}
    return rows, summary


class ProgressPrinter:
    def __init__(self, label: str) -> None:
        self.label = label
        self.last = ""
        self.last_time = 0.0

    def __call__(self, stage: str, completed: int, total: int) -> None:
        percent = 100 * completed / max(1, total)
        text = f"{self.label} | {stage} | {completed}/{total} | {percent:.1f}%"
        now = time.time()
        if text != self.last and (completed == total or now - self.last_time >= 2):
            print(datetime.now().strftime("%H:%M:%S"), text, flush=True)
            self.last, self.last_time = text, now


def save_json_gz(path: Path, value: Any) -> None:
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)


def csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    if not rows:
        return b""
    keys: list[str] = []
    for row in rows:
        for key in row:
            if key not in keys:
                keys.append(key)
    from io import StringIO
    stream = StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=keys, extrasaction="ignore")
    writer.writeheader(); writer.writerows(rows)
    return stream.getvalue().encode("utf-8-sig")


def save_zip(path: Path, tables: dict[str, list[dict[str, Any]]], metadata: dict[str, Any]) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, rows in tables.items():
            archive.writestr(name, csv_bytes(rows))
        archive.writestr("metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2).encode("utf-8"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Chromalab browser-independent formal analysis")
    parser.add_argument("--input", type=Path, default=PROJECT / "input_data")
    parser.add_argument("--mode", choices=("continuous", "similarity", "both"), required=True)
    parser.add_argument("--bootstrap", type=int, default=1000)
    parser.add_argument("--assignment-repeats", type=int, default=1000)
    parser.add_argument("--permutations", type=int, default=2000)
    parser.add_argument("--inference", type=int, default=1000)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--k", type=int, default=3)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output = PROJECT / "offline_results" / stamp
    output.mkdir(parents=True, exist_ok=False)
    print("Loading eight workbooks from", args.input.resolve(), flush=True)
    rows, summary = load_rows(args.input)
    config = vars(args).copy(); config["input"] = str(args.input.resolve())
    (output / "input_summary.json").write_text(json.dumps({"config": config, "sources": summary, "totalRows": len(rows)}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Loaded {len(rows):,} valid color rows. Results: {output}", flush=True)

    if args.mode in {"continuous", "both"}:
        print("Starting continuous raw-point distance analysis...", flush=True)
        result = run_continuous_distances(
            {"rows": rows, "options": {"bootstrapIterations": args.bootstrap, "assignmentRepeats": args.assignment_repeats, "permutationIterations": args.permutations}},
            progress=ProgressPrinter("CONTINUOUS"),
        )
        save_json_gz(output / "continuous_result.json.gz", result)
        save_zip(output / "continuous_results_csv.zip", {
            "continuous_color_distance_long.csv": result["distanceLong"],
            "ai_human_observed_ranking.csv": result["ranking"],
            "assignment_details.csv": result["assignmentDetails"],
            "within_group_dispersion.csv": result["withinDispersion"],
            "bootstrap_stability_diagnostic.csv": result["closestStability"],
            "human_pairwise_block_permutation.csv": result.get("humanPairwisePermutation", []),
            "human_pairwise_holm_matrices.csv": result.get("formalPairwiseMatrices", []),
            "human_pairwise_compact_letters.csv": result.get("formalPairwiseLetters", []),
            "assignment00_common_m_diagnostics.csv": result.get("assignmentCommonMDiagnostics", []),
            "formal_metric_robustness.csv": result.get("formalMetricRobustness", []),
            "formal_unit_audit.csv": result.get("formalUnitAudit", []),
            "fixed_human_ai_descriptive_only.csv": result.get("aiPairwiseDescriptive", []),
            "energy76_u_results.csv": result.get("energy76UResults", []),
            "energy76_v_legacy.csv": result.get("energy76VLegacy", []),
            "cie76_ciede2000_sensitivity.csv": result.get("metricSensitivity", []),
            "legacy_human_pairwise_bootstrap_NOT_OFFICIAL.csv": result.get("legacyHumanPairwiseBootstrap", []),
            "legacy_ai_pairwise_bootstrap_NOT_OFFICIAL.csv": result.get("legacyAiPairwiseBootstrap", []),
            "micd_directional_asymmetry.csv": result["asymmetry"],
            "metric_agreement.csv": result["metricAgreement"],
            "metric_rank_agreement.csv": result["rankAgreement"],
        }, result["metadata"])
        print("Continuous analysis saved.", flush=True)

    if args.mode in {"similarity", "both"}:
        print("Starting multi-level similarity analysis...", flush=True)
        result = run_task1_similarity(
            {"rows": rows, "options": {"representativeK": args.k, "folds": args.folds, "binSizes": [6, 8, 10], "inferenceIterations": args.inference}},
            progress=ProgressPrinter("SIMILARITY"),
        )
        save_json_gz(output / "similarity_result.json.gz", result)
        save_zip(output / "similarity_results_csv.zip", {
            "processed_continuous_color_features.csv": result["processedRows"],
            "distribution_statistics.csv": result["distributionStatistics"],
            "dominant_region_coverage.csv": result["coverage"]["rows"],
            "distribution_distance_sensitivity.csv": result["distances"]["rows"],
            "pairwise_classifier_separability.csv": result["separability"]["rows"],
            "auc_group_bootstrap_summary.csv": result["separability"]["inference"]["pairSummaries"],
            "auc_group_bootstrap_samples.csv": result["separability"]["inference"]["bootstrapSamples"],
            "auc_group_permutation_samples.csv": result["separability"]["inference"]["permutationSamples"],
            "auc_country_delta_summary.csv": result["separability"]["inference"]["deltaSummaries"],
            "auc_closest_country_stability.csv": result["separability"]["inference"]["closestStability"],
            "auc_closest_country_bootstrap_draws.csv": result["separability"]["inference"]["closestDraws"],
            "human_trained_country_alignment.csv": result["countryAlignment"]["probabilities"],
            "three_evidence_report.csv": result["evidence"],
        }, result["method"])
        print("Similarity analysis saved.", flush=True)

    print("All selected analyses completed:", output.resolve(), flush=True)


if __name__ == "__main__":
    main()
