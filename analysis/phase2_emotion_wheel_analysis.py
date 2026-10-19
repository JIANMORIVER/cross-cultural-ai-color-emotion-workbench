#!/usr/bin/env python3
"""Task 2: analyse Geneva Emotion Wheel responses to 11 Munsell colours.

The input is one or more SurveyResponse_*.csv files. Each ``word_data.<code>``
cell contains a JSON list such as::

    [{"emotion": "joy", "intensity": 4}, {"emotion": "love", "intensity": 2}]

The script creates participant-level QC, a complete participant x colour x
emotion grid, descriptive statistics, corrected group tests, distances, plots,
and a concise Markdown summary.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "emotion-wheel-matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", str(Path(tempfile.gettempdir()) / "emotion-wheel-cache"))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy.spatial.distance import jensenshannon
from scipy.stats import chi2_contingency, fisher_exact, kruskal, mannwhitneyu


COLOUR_CODES = ["D38", "F17", "F4", "J0", "F0", "F29", "A0", "H35", "I6", "G3", "C9"]
POSITIVE_EMOTIONS = [
    "interest", "amusement", "pride", "joy", "pleasure", "contentment",
    "admiration", "love", "relief", "compassion",
]
NEGATIVE_EMOTIONS = [
    "sadness", "guilt", "regret", "shame", "disappointment", "fear",
    "disgust", "contempt", "hate", "anger",
]
EMOTIONS = POSITIVE_EMOTIONS + NEGATIVE_EMOTIONS
GROUPS = ["BW", "CN", "UK"]
SPECIAL_EMOTIONS = {"none", "other"}
EMOTION_ALIASES = {
    "interested": "interest",
    "amused": "amusement",
    "proud": "pride",
    "joyful": "joy",
    "content": "contentment",
    "admire": "admiration",
    "loving": "love",
    "relieved": "relief",
    "compassionate": "compassion",
    "sad": "sadness",
    "guilty": "guilt",
    "regretful": "regret",
    "ashamed": "shame",
    "disappointed": "disappointment",
    "afraid": "fear",
    "disgusted": "disgust",
    "contemptuous": "contempt",
    "hateful": "hate",
    "angry": "anger",
}
RESIDENCE_CODES = {
    "BW": {"bw", "botswana"},
    "CN": {"cn", "china"},
    "UK": {"gb", "uk", "united kingdom"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyse Task 2 Geneva Emotion Wheel survey data.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--input-dir", type=Path, required=True, help="Directory containing SurveyResponse_*.csv")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/phase2"), help="Output directory")
    parser.add_argument("--pattern", default="SurveyResponse_*.csv", help="Input filename glob")
    parser.add_argument("--colour-map", type=Path, help="Optional CSV with code,label,hex columns")
    parser.add_argument("--age-min", type=int, default=18)
    parser.add_argument("--age-max", type=int, default=60)
    parser.add_argument("--min-duration", type=float, default=0.0, help="Exclude records faster than this many seconds; 0 disables")
    parser.add_argument("--require-residence-match", action="store_true", help="Also require residence to match the cohort")
    parser.add_argument("--include-age-outliers", action="store_true", help="Do not exclude implausible/out-of-range ages")
    parser.add_argument("--alpha", type=float, default=0.05, help="FDR threshold for summaries")
    return parser.parse_args()


def normalize_bool(value: Any) -> bool | None:
    if pd.isna(value):
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    return None


def normalize_emotion(value: Any) -> str:
    text = re.sub(r"[\s_-]+", " ", str(value).strip().lower())
    text = EMOTION_ALIASES.get(text, text)
    return text


def load_colour_map(path: Path | None) -> pd.DataFrame:
    mapping = pd.DataFrame({"code": COLOUR_CODES, "label": COLOUR_CODES, "hex": ""})
    if path is None:
        return mapping
    supplied = pd.read_csv(path, dtype=str).fillna("")
    required = {"code", "label", "hex"}
    missing = required - set(supplied.columns)
    if missing:
        raise ValueError(f"Colour map is missing columns: {sorted(missing)}")
    supplied = supplied[supplied["code"].isin(COLOUR_CODES)].drop_duplicates("code", keep="last")
    mapping = mapping.set_index("code")
    for _, row in supplied.iterrows():
        code = row["code"]
        mapping.loc[code, "label"] = row["label"] or code
        mapping.loc[code, "hex"] = row["hex"]
    return mapping.reset_index()


def load_inputs(input_dir: Path, pattern: str) -> pd.DataFrame:
    files = sorted(input_dir.glob(pattern))
    if not files:
        raise FileNotFoundError(f"No files matched {input_dir / pattern}")
    frames: list[pd.DataFrame] = []
    for file in files:
        frame = pd.read_csv(file, encoding="utf-8-sig", low_memory=False)
        frame["source_file"] = file.name
        frame["source_row"] = np.arange(2, len(frame) + 2)
        frames.append(frame)
    data = pd.concat(frames, ignore_index=True, sort=False)
    for code in COLOUR_CODES:
        column = f"word_data.{code}"
        if column not in data:
            data[column] = np.nan
    return data


def parse_response_cell(value: Any) -> tuple[dict[str, float], dict[str, Any]]:
    flags = {
        "missing": False,
        "invalid_json": False,
        "invalid_item_count": 0,
        "unknown_emotions": [],
        "duplicate_emotions": 0,
        "none_with_other": False,
        "special_emotions": [],
    }
    if pd.isna(value) or not str(value).strip():
        flags["missing"] = True
        return {}, flags
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (json.JSONDecodeError, TypeError):
        flags["invalid_json"] = True
        return {}, flags
    if isinstance(parsed, dict):
        parsed = [parsed]
    if not isinstance(parsed, list):
        flags["invalid_json"] = True
        return {}, flags

    responses: dict[str, float] = {}
    seen_special: set[str] = set()
    for item in parsed:
        if not isinstance(item, dict) or "emotion" not in item or "intensity" not in item:
            flags["invalid_item_count"] += 1
            continue
        emotion = normalize_emotion(item["emotion"])
        try:
            intensity = float(item["intensity"])
        except (TypeError, ValueError):
            flags["invalid_item_count"] += 1
            continue
        if not np.isfinite(intensity) or not 0 <= intensity <= 5:
            flags["invalid_item_count"] += 1
            continue
        if emotion in SPECIAL_EMOTIONS:
            seen_special.add(emotion)
            continue
        if emotion not in EMOTIONS:
            flags["unknown_emotions"].append(emotion)
            continue
        if emotion in responses:
            flags["duplicate_emotions"] += 1
        responses[emotion] = max(responses.get(emotion, 0.0), intensity)
    flags["special_emotions"] = sorted(seen_special)
    flags["none_with_other"] = "none" in seen_special and bool(responses)
    return responses, flags


def residence_matches(group: Any, residence: Any) -> bool:
    if pd.isna(group) or pd.isna(residence):
        return False
    return str(residence).strip().lower() in RESIDENCE_CODES.get(str(group).strip().upper(), set())


def prepare_participants(raw: pd.DataFrame, args: argparse.Namespace) -> tuple[pd.DataFrame, dict[tuple[int, str], dict[str, float]]]:
    data = raw.copy()
    data["group_normalized"] = data.get("group", pd.Series(index=data.index, dtype=object)).astype(str).str.strip().str.upper()
    data["updated_sort"] = pd.to_datetime(data.get("updatedAt"), errors="coerce", utc=True)
    data = data.sort_values(["updated_sort", "source_file", "source_row"], na_position="first").reset_index(drop=True)

    object_ids = data.get("objectId", pd.Series(index=data.index, dtype=object)).astype("string")
    missing_ids = object_ids.isna() | object_ids.str.strip().eq("")
    data["participant_id"] = object_ids
    data.loc[missing_ids, "participant_id"] = data.loc[missing_ids].apply(
        lambda row: f"missing-id::{row['source_file']}::{row['source_row']}", axis=1
    )
    data["duplicate_object_id"] = data["participant_id"].duplicated(keep=False)
    data["dedupe_keep"] = ~data["participant_id"].duplicated(keep="last")

    birth_year = pd.to_numeric(data.get("user_info.birth_year"), errors="coerce")
    survey_year = pd.to_datetime(data.get("createdAt"), errors="coerce", utc=True).dt.year
    survey_year = survey_year.fillna(pd.Timestamp.now(tz="UTC").year)
    data["age"] = survey_year - birth_year
    data["age_eligible"] = data["age"].between(args.age_min, args.age_max, inclusive="both")
    data["completed_phase2_normalized"] = data.get("completed_phase2", False).map(normalize_bool).fillna(False)
    data["no_colour_blindness"] = data.get("user_info.has_color_blindness", np.nan).map(normalize_bool).eq(False)
    data["residence_group_match"] = [
        residence_matches(group, residence)
        for group, residence in zip(data["group_normalized"], data.get("user_info.residence", np.nan))
    ]
    data["duration_seconds"] = pd.to_numeric(data.get("duration"), errors="coerce")
    data["fast_under_60s"] = data["duration_seconds"].lt(60)

    parsed_by_cell: dict[tuple[int, str], dict[str, float]] = {}
    qc_rows: list[dict[str, Any]] = []
    for index, row in data.iterrows():
        complete = True
        valid = True
        selected_total = 0
        invalid_cells = 0
        invalid_items = 0
        unknown: set[str] = set()
        specials: set[str] = set()
        duplicate_emotions = 0
        none_conflicts = 0
        signatures: list[tuple[tuple[str, float], ...]] = []
        for code in COLOUR_CODES:
            column = f"word_data.{code}"
            responses, flags = parse_response_cell(row.get(column, np.nan))
            parsed_by_cell[(index, code)] = responses
            if flags["missing"]:
                complete = False
            if flags["invalid_json"]:
                invalid_cells += 1
                valid = False
            if flags["invalid_item_count"]:
                invalid_items += int(flags["invalid_item_count"])
                valid = False
            if flags["unknown_emotions"]:
                unknown.update(flags["unknown_emotions"])
                valid = False
            specials.update(flags["special_emotions"])
            duplicate_emotions += int(flags["duplicate_emotions"])
            none_conflicts += int(flags["none_with_other"])
            selected_total += len(responses)
            signatures.append(tuple(sorted(responses.items())))
        qc_rows.append({
            "complete_11_colours": complete,
            "valid_11_json": valid,
            "invalid_json_cells": invalid_cells,
            "invalid_items": invalid_items,
            "unknown_emotions": "|".join(sorted(unknown)),
            "special_emotions_seen": "|".join(sorted(specials)),
            "duplicate_emotions_within_cell": duplicate_emotions,
            "none_with_other_count": none_conflicts,
            "selected_emotions_total": selected_total,
            "mean_selected_emotions_per_colour": selected_total / len(COLOUR_CODES),
            "straightline_identical_11_colours": complete and len(set(signatures)) == 1,
        })
    data = pd.concat([data, pd.DataFrame(qc_rows)], axis=1)
    has_named_version = data.filter(regex=r"^word_data\.(Orange|Purple|Light Blue|Pink|Blue|Black|Grey|White|Lilac|Red|Yellow|Brown|Green)$").notna().any(axis=1)
    has_munsell_version = data[[f"word_data.{code}" for code in COLOUR_CODES]].notna().any(axis=1)
    data["data_version"] = np.select(
        [has_munsell_version & has_named_version, has_munsell_version, has_named_version],
        ["both", "munsell_11", "named_13"],
        default="no_phase2_data",
    )

    eligible = (
        data["dedupe_keep"]
        & data["group_normalized"].isin(GROUPS)
        & data["completed_phase2_normalized"]
        & data["complete_11_colours"]
        & data["valid_11_json"]
        & data["no_colour_blindness"]
    )
    if not args.include_age_outliers:
        eligible &= data["age_eligible"]
    if args.min_duration > 0:
        eligible &= data["duration_seconds"].ge(args.min_duration)
    if args.require_residence_match:
        eligible &= data["residence_group_match"]
    data["analysis_eligible"] = eligible
    return data, parsed_by_cell


def build_grid(participants: pd.DataFrame, parsed: dict[tuple[int, str], dict[str, float]], colour_map: pd.DataFrame) -> pd.DataFrame:
    label_map = colour_map.set_index("code")["label"].to_dict()
    rows: list[dict[str, Any]] = []
    eligible = participants[participants["analysis_eligible"]]
    for index, participant in eligible.iterrows():
        for code in COLOUR_CODES:
            responses = parsed[(index, code)]
            for emotion in EMOTIONS:
                selected = emotion in responses
                rows.append({
                    "participant_id": participant["participant_id"],
                    "group": participant["group_normalized"],
                    "age": participant["age"],
                    "gender": participant.get("user_info.gender", np.nan),
                    "residence": participant.get("user_info.residence", np.nan),
                    "nationality": participant.get("user_info.nationality", np.nan),
                    "native_language": participant.get("user_info.native_lang", np.nan),
                    "is_designer": participant.get("user_info.is_designer", np.nan),
                    "duration_seconds": participant["duration_seconds"],
                    "source_file": participant["source_file"],
                    "colour_code": code,
                    "colour_label": label_map.get(code, code),
                    "emotion": emotion,
                    "valence": "positive" if emotion in POSITIVE_EMOTIONS else "negative",
                    "selected": int(selected),
                    "intensity": float(responses.get(emotion, 0.0)),
                })
    return pd.DataFrame(rows)


def wilson_interval(successes: int, total: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if total == 0:
        return np.nan, np.nan
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return center - half, center + half


def descriptive_statistics(grid: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for keys, values in grid.groupby(["group", "colour_code", "colour_label", "emotion", "valence"], sort=False):
        group, code, label, emotion, valence = keys
        selected = values["selected"].to_numpy()
        intensity = values["intensity"].to_numpy()
        chosen_intensity = intensity[selected == 1]
        n = len(values)
        chosen = int(selected.sum())
        low, high = wilson_interval(chosen, n)
        rows.append({
            "group": group,
            "colour_code": code,
            "colour_label": label,
            "emotion": emotion,
            "valence": valence,
            "n_participants": n,
            "selected_n": chosen,
            "prevalence": chosen / n if n else np.nan,
            "prevalence_ci_low": low,
            "prevalence_ci_high": high,
            "mean_intensity_all": float(np.mean(intensity)) if n else np.nan,
            "sd_intensity_all": float(np.std(intensity, ddof=1)) if n > 1 else np.nan,
            "mean_intensity_selected": float(np.mean(chosen_intensity)) if len(chosen_intensity) else np.nan,
            "median_intensity_selected": float(np.median(chosen_intensity)) if len(chosen_intensity) else np.nan,
        })
    result = pd.DataFrame(rows)
    result["colour_code"] = pd.Categorical(result["colour_code"], COLOUR_CODES, ordered=True)
    result["emotion"] = pd.Categorical(result["emotion"], EMOTIONS, ordered=True)
    return result.sort_values(["group", "colour_code", "emotion"]).reset_index(drop=True)


def bh_adjust(pvalues: pd.Series) -> pd.Series:
    values = pd.to_numeric(pvalues, errors="coerce").to_numpy(dtype=float)
    adjusted = np.full(len(values), np.nan)
    valid = np.isfinite(values)
    if not valid.any():
        return pd.Series(adjusted, index=pvalues.index)
    pv = values[valid]
    order = np.argsort(pv)
    ranked = pv[order]
    corrected = ranked * len(ranked) / np.arange(1, len(ranked) + 1)
    corrected = np.minimum.accumulate(corrected[::-1])[::-1]
    corrected = np.clip(corrected, 0, 1)
    back = np.empty_like(corrected)
    back[order] = corrected
    adjusted[valid] = back
    return pd.Series(adjusted, index=pvalues.index)


def safe_kruskal(samples: list[np.ndarray]) -> tuple[float, float]:
    if any(len(sample) == 0 for sample in samples):
        return np.nan, np.nan
    combined = np.concatenate(samples)
    if len(np.unique(combined)) < 2:
        return 0.0, 1.0
    statistic, pvalue = kruskal(*samples)
    return float(statistic), float(pvalue)


def omnibus_tests(grid: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for (code, label, emotion), cell in grid.groupby(["colour_code", "colour_label", "emotion"], sort=False):
        observed = []
        intensity_samples = []
        prevalences = []
        for group in GROUPS:
            sample = cell[cell["group"] == group]
            selected = int(sample["selected"].sum())
            n = len(sample)
            observed.append([selected, n - selected])
            intensity_samples.append(sample["intensity"].to_numpy())
            prevalences.append(selected / n if n else np.nan)
        observed_array = np.asarray(observed)
        if (observed_array.sum(axis=1) == 0).any() or (observed_array.sum(axis=0) == 0).any():
            chi2, p_selection, expected_min = 0.0, 1.0, 0.0
        else:
            chi2, p_selection, _, expected = chi2_contingency(observed_array, correction=False)
            expected_min = float(expected.min())
        total = observed_array.sum()
        cramer_v = math.sqrt(chi2 / total) if total else np.nan
        h_stat, p_intensity = safe_kruskal(intensity_samples)
        rows.append({
            "colour_code": code,
            "colour_label": label,
            "emotion": emotion,
            "chi2_selection": chi2,
            "p_selection": p_selection,
            "cramers_v": cramer_v,
            "minimum_expected_count": expected_min,
            "prevalence_range": np.nanmax(prevalences) - np.nanmin(prevalences),
            "kruskal_h_intensity": h_stat,
            "p_intensity": p_intensity,
        })
    result = pd.DataFrame(rows)
    result["q_selection_bh"] = bh_adjust(result["p_selection"])
    result["q_intensity_bh"] = bh_adjust(result["p_intensity"])
    return result


def pairwise_tests(grid: pd.DataFrame) -> pd.DataFrame:
    pairs = [("CN", "BW"), ("UK", "BW"), ("CN", "UK")]
    rows: list[dict[str, Any]] = []
    for (code, label, emotion), cell in grid.groupby(["colour_code", "colour_label", "emotion"], sort=False):
        for group_a, group_b in pairs:
            a = cell[cell["group"] == group_a]
            b = cell[cell["group"] == group_b]
            a_selected, b_selected = int(a["selected"].sum()), int(b["selected"].sum())
            table = [[a_selected, len(a) - a_selected], [b_selected, len(b) - b_selected]]
            odds_ratio, p_selection = fisher_exact(table, alternative="two-sided")
            prevalence_a = a_selected / len(a) if len(a) else np.nan
            prevalence_b = b_selected / len(b) if len(b) else np.nan
            a_intensity, b_intensity = a["intensity"].to_numpy(), b["intensity"].to_numpy()
            if len(np.unique(np.concatenate([a_intensity, b_intensity]))) < 2:
                u_stat, p_intensity, rank_biserial = len(a) * len(b) / 2, 1.0, 0.0
            else:
                test = mannwhitneyu(a_intensity, b_intensity, alternative="two-sided", method="asymptotic")
                u_stat, p_intensity = float(test.statistic), float(test.pvalue)
                rank_biserial = 2 * u_stat / (len(a) * len(b)) - 1
            rows.append({
                "colour_code": code,
                "colour_label": label,
                "emotion": emotion,
                "group_a": group_a,
                "group_b": group_b,
                "n_a": len(a),
                "n_b": len(b),
                "prevalence_a": prevalence_a,
                "prevalence_b": prevalence_b,
                "prevalence_difference_a_minus_b": prevalence_a - prevalence_b,
                "odds_ratio": odds_ratio,
                "p_selection_fisher": p_selection,
                "mean_intensity_a": float(a_intensity.mean()),
                "mean_intensity_b": float(b_intensity.mean()),
                "mean_intensity_difference_a_minus_b": float(a_intensity.mean() - b_intensity.mean()),
                "mann_whitney_u": u_stat,
                "rank_biserial_a_vs_b": rank_biserial,
                "p_intensity_mann_whitney": p_intensity,
            })
    result = pd.DataFrame(rows)
    result["q_selection_bh"] = bh_adjust(result["p_selection_fisher"])
    result["q_intensity_bh"] = bh_adjust(result["p_intensity_mann_whitney"])
    return result


def valence_summary(grid: pd.DataFrame) -> pd.DataFrame:
    per_person = (
        grid.groupby(["participant_id", "group", "colour_code", "colour_label", "valence"], as_index=False)
        .agg(selected_emotions=("selected", "sum"), total_intensity=("intensity", "sum"), mean_intensity=("intensity", "mean"))
    )
    return (
        per_person.groupby(["group", "colour_code", "colour_label", "valence"], as_index=False)
        .agg(
            n_participants=("participant_id", "nunique"),
            mean_selected_emotions=("selected_emotions", "mean"),
            sd_selected_emotions=("selected_emotions", "std"),
            mean_total_intensity=("total_intensity", "mean"),
            mean_intensity_per_opportunity=("mean_intensity", "mean"),
        )
    )


def group_distances(descriptive: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (code, label), colour in descriptive.groupby(["colour_code", "colour_label"], sort=False, observed=True):
        vectors = {}
        for group in GROUPS:
            vector = (
                colour[colour["group"] == group]
                .set_index("emotion")
                .reindex(EMOTIONS)["prevalence"]
                .fillna(0)
                .to_numpy(dtype=float)
            )
            vector = vector + 1e-12
            vectors[group] = vector / vector.sum()
        for group_a, group_b in [("CN", "BW"), ("UK", "BW"), ("CN", "UK")]:
            rows.append({
                "colour_code": code,
                "colour_label": label,
                "group_a": group_a,
                "group_b": group_b,
                "jensen_shannon_distance": float(jensenshannon(vectors[group_a], vectors[group_b], base=2)),
            })
    return pd.DataFrame(rows)


def plot_heatmaps(descriptive: pd.DataFrame, pairwise: pd.DataFrame, omnibus: pd.DataFrame, distances: pd.DataFrame, output_dir: Path) -> None:
    plot_dir = output_dir / "plots"
    plot_dir.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="white", font_scale=0.85)
    emotion_labels = [emotion.title() for emotion in EMOTIONS]
    label_map = (
        descriptive.assign(colour_code=descriptive["colour_code"].astype(str))
        .drop_duplicates("colour_code")
        .set_index("colour_code")["colour_label"]
        .to_dict()
    )
    colour_labels = [label_map.get(code, code) for code in COLOUR_CODES]

    fig, axes = plt.subplots(3, 1, figsize=(16, 12), constrained_layout=True)
    for ax, group in zip(axes, GROUPS):
        matrix = (
            descriptive[descriptive["group"] == group]
            .assign(colour_code=lambda frame: frame["colour_code"].astype(str))
            .pivot(index="colour_code", columns="emotion", values="prevalence")
            .reindex(index=COLOUR_CODES, columns=EMOTIONS)
        )
        sns.heatmap(matrix, ax=ax, cmap="YlGnBu", vmin=0, vmax=1, cbar_kws={"label": "Selection prevalence"})
        ax.set_title(f"{group}: emotion selection prevalence")
        ax.set_xlabel("")
        ax.set_ylabel("Colour")
        ax.set_yticklabels(colour_labels, rotation=0)
        ax.set_xticklabels(emotion_labels, rotation=45, ha="right")
    fig.savefig(plot_dir / "01_prevalence_heatmaps.png", dpi=300, bbox_inches="tight")
    plt.close(fig)

    pairs = [("CN", "BW"), ("UK", "BW"), ("CN", "UK")]
    fig, axes = plt.subplots(3, 1, figsize=(16, 12), constrained_layout=True)
    max_abs = max(0.05, float(pairwise["prevalence_difference_a_minus_b"].abs().max()))
    for ax, (group_a, group_b) in zip(axes, pairs):
        subset = pairwise[(pairwise["group_a"] == group_a) & (pairwise["group_b"] == group_b)]
        matrix = (
            subset.assign(colour_code=subset["colour_code"].astype(str))
            .pivot(index="colour_code", columns="emotion", values="prevalence_difference_a_minus_b")
            .reindex(index=COLOUR_CODES, columns=EMOTIONS)
        )
        sns.heatmap(matrix, ax=ax, cmap="RdBu_r", center=0, vmin=-max_abs, vmax=max_abs, cbar_kws={"label": "Prevalence difference"})
        ax.set_title(f"{group_a} minus {group_b}")
        ax.set_xlabel("")
        ax.set_ylabel("Colour")
        ax.set_yticklabels(colour_labels, rotation=0)
        ax.set_xticklabels(emotion_labels, rotation=45, ha="right")
    fig.savefig(plot_dir / "02_prevalence_differences.png", dpi=300, bbox_inches="tight")
    plt.close(fig)

    q_matrix = (
        omnibus.assign(colour_code=omnibus["colour_code"].astype(str))
        .pivot(index="colour_code", columns="emotion", values="q_selection_bh")
        .reindex(index=COLOUR_CODES, columns=EMOTIONS)
    )
    score = -np.log10(q_matrix.clip(lower=1e-12))
    annotations = q_matrix.apply(lambda column: column.map(lambda value: "*" if pd.notna(value) and value < 0.05 else ""))
    fig, ax = plt.subplots(figsize=(16, 5.5), constrained_layout=True)
    sns.heatmap(score, ax=ax, cmap="magma", annot=annotations, fmt="", cbar_kws={"label": "-log10(BH q)"})
    ax.set_title("Omnibus group differences in emotion selection (* q < .05)")
    ax.set_xlabel("Emotion")
    ax.set_ylabel("Colour")
    ax.set_yticklabels(colour_labels, rotation=0)
    ax.set_xticklabels(emotion_labels, rotation=45, ha="right")
    fig.savefig(plot_dir / "03_omnibus_significance.png", dpi=300, bbox_inches="tight")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(11, 5.5), constrained_layout=True)
    pair_names = distances["group_a"] + " vs " + distances["group_b"]
    plot_data = distances.assign(pair=pair_names)
    labels = colour_labels
    x = np.arange(len(labels))
    width = 0.25
    for offset, pair in zip([-1, 0, 1], ["CN vs BW", "UK vs BW", "CN vs UK"]):
        subset = plot_data[plot_data["pair"] == pair].set_index("colour_label").reindex(labels)
        ax.bar(x + offset * width, subset["jensen_shannon_distance"], width, label=pair)
    ax.set_xticks(x, labels)
    ax.set_ylabel("Jensen-Shannon distance")
    ax.set_title("Distance between normalized 20-emotion profiles")
    ax.legend(frameon=False)
    fig.savefig(plot_dir / "04_group_profile_distances.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


def write_summary(participants: pd.DataFrame, descriptive: pd.DataFrame, omnibus: pd.DataFrame, pairwise: pd.DataFrame, args: argparse.Namespace, output_dir: Path) -> None:
    eligible = participants[participants["analysis_eligible"]]
    counts = eligible["group_normalized"].value_counts().reindex(GROUPS, fill_value=0)
    significant_selection = int((omnibus["q_selection_bh"] < args.alpha).sum())
    significant_intensity = int((omnibus["q_intensity_bh"] < args.alpha).sum())
    top = omnibus.sort_values(["prevalence_range", "cramers_v"], ascending=False).head(10)
    top_pair = pairwise.loc[pairwise["q_selection_bh"] < args.alpha].copy()
    top_pair = top_pair.reindex(top_pair["prevalence_difference_a_minus_b"].abs().sort_values(ascending=False).index).head(10)
    exclusions = participants.loc[~participants["analysis_eligible"], "data_version"].value_counts()
    otherwise_formal = (
        participants["dedupe_keep"]
        & participants["group_normalized"].isin(GROUPS)
        & participants["completed_phase2_normalized"]
        & participants["complete_11_colours"]
        & participants["valid_11_json"]
        & participants["no_colour_blindness"]
    )
    age_excluded = int((otherwise_formal & ~participants["age_eligible"]).sum()) if not args.include_age_outliers else 0

    lines = [
        "# Task 2 analysis summary",
        "",
        "## Analytic sample",
        "",
        f"- Total raw rows: {len(participants)}",
        f"- Eligible Munsell-11 rows: {len(eligible)}",
        *[f"- {group}: {int(counts[group])}" for group in GROUPS],
        f"- Formal Munsell-11 rows excluded for age outliers/missing age: {age_excluded}",
        f"- Named-colour legacy rows (not mixed into Munsell analysis): {int((participants['data_version'] == 'named_13').sum())}",
        f"- Straightline responses flagged but retained: {int(eligible['straightline_identical_11_colours'].sum())}",
        "",
        "The primary outcome is emotion selection prevalence. Intensity is analysed on a 0-5 grid, with an unselected emotion coded as 0. `None` and `Other` are retained in QC flags but excluded from the 20-emotion inferential grid.",
        "",
        "## Omnibus results",
        "",
        f"- Selection cells significant after BH-FDR (q < {args.alpha:g}): {significant_selection} / {len(omnibus)}",
        f"- Zero-inclusive intensity cells significant after BH-FDR (q < {args.alpha:g}): {significant_intensity} / {len(omnibus)}",
        "",
        "Largest cross-group prevalence ranges:",
        "",
        "| Colour | Emotion | Range | Cramer's V | q |",
        "|---|---:|---:|---:|---:|",
    ]
    for _, row in top.iterrows():
        lines.append(f"| {row['colour_label']} | {str(row['emotion']).title()} | {row['prevalence_range']:.3f} | {row['cramers_v']:.3f} | {row['q_selection_bh']:.3g} |")
    lines.extend(["", "Largest significant pairwise prevalence differences:", "", "| Colour | Emotion | Contrast | Difference | q |", "|---|---|---|---:|---:|"])
    if top_pair.empty:
        lines.append("| - | - | No pairwise result passed FDR | - | - |")
    else:
        for _, row in top_pair.iterrows():
            lines.append(f"| {row['colour_label']} | {str(row['emotion']).title()} | {row['group_a']} - {row['group_b']} | {row['prevalence_difference_a_minus_b']:.3f} | {row['q_selection_bh']:.3g} |")
    lines.extend([
        "",
        "## Interpretation cautions",
        "",
        "- Each participant supplies repeated responses across colours and emotions. These cell-wise tests are descriptive/exploratory and use BH correction, but they do not replace a preregistered multilevel model.",
        "- Conditional mean intensity among selectors is descriptive only. The inferential intensity test uses 0 for unselected emotions so that selection and strength are not separated in a biased subset.",
        "- Residence mismatch and straightlining are flags, not automatic exclusions, unless the corresponding command-line option is used.",
        "- Replace colour codes with verified Munsell labels/hex values through `--colour-map`; the code never guesses the mapping.",
        "",
        "## Exclusion-version counts",
        "",
    ])
    lines.extend([f"- {version}: {int(count)}" for version, count in exclusions.items()])
    (output_dir / "analysis_summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def save_outputs(participants: pd.DataFrame, grid: pd.DataFrame, descriptive: pd.DataFrame, omnibus: pd.DataFrame, pairwise: pd.DataFrame, valence: pd.DataFrame, distances: pd.DataFrame, colour_map: pd.DataFrame, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    qc_columns = [
        "participant_id", "source_file", "source_row", "group_normalized", "data_version",
        "completed_phase2_normalized", "age", "age_eligible", "no_colour_blindness",
        "residence_group_match", "duration_seconds", "fast_under_60s", "duplicate_object_id",
        "dedupe_keep", "complete_11_colours", "valid_11_json", "invalid_json_cells",
        "invalid_items", "unknown_emotions", "special_emotions_seen",
        "duplicate_emotions_within_cell", "none_with_other_count", "selected_emotions_total",
        "mean_selected_emotions_per_colour", "straightline_identical_11_colours", "analysis_eligible",
    ]
    participants[qc_columns].to_csv(output_dir / "01_participant_qc.csv", index=False, encoding="utf-8-sig")
    grid.to_csv(output_dir / "02_complete_emotion_grid.csv.gz", index=False, compression="gzip")
    grid.loc[grid["selected"].eq(1)].to_csv(output_dir / "02_selected_responses.csv", index=False, encoding="utf-8-sig")
    descriptive.to_csv(output_dir / "03_descriptive_statistics.csv", index=False, encoding="utf-8-sig")
    valence.to_csv(output_dir / "04_valence_summary.csv", index=False, encoding="utf-8-sig")
    omnibus.to_csv(output_dir / "05_omnibus_tests.csv", index=False, encoding="utf-8-sig")
    pairwise.to_csv(output_dir / "06_pairwise_tests.csv", index=False, encoding="utf-8-sig")
    distances.to_csv(output_dir / "07_group_distances.csv", index=False, encoding="utf-8-sig")
    colour_map.to_csv(output_dir / "colour_map_used.csv", index=False, encoding="utf-8-sig")


def main() -> int:
    args = parse_args()
    try:
        colour_map = load_colour_map(args.colour_map)
        raw = load_inputs(args.input_dir, args.pattern)
        participants, parsed = prepare_participants(raw, args)
        grid = build_grid(participants, parsed, colour_map)
        if grid.empty:
            raise ValueError("No eligible Munsell-11 records remained after QC. Inspect 01_participant_qc.csv or relax explicit filters.")
        missing_groups = [group for group in GROUPS if group not in set(grid["group"])]
        if missing_groups:
            raise ValueError(f"The analysis requires BW, CN and UK data; missing groups: {missing_groups}")
        descriptive = descriptive_statistics(grid)
        valence = valence_summary(grid)
        omnibus = omnibus_tests(grid)
        pairwise = pairwise_tests(grid)
        distances = group_distances(descriptive)
        save_outputs(participants, grid, descriptive, omnibus, pairwise, valence, distances, colour_map, args.output_dir)
        plot_heatmaps(descriptive, pairwise, omnibus, distances, args.output_dir)
        write_summary(participants, descriptive, omnibus, pairwise, args, args.output_dir)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    counts = participants.loc[participants["analysis_eligible"], "group_normalized"].value_counts().reindex(GROUPS, fill_value=0)
    print(f"Analysis complete: {int(counts.sum())} participants ({', '.join(f'{g}={int(counts[g])}' for g in GROUPS)})")
    print(f"Outputs: {args.output_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
