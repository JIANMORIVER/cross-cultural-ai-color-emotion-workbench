"""Continuous raw-point colour-distribution distances for Experiment 1.

All public metric functions accept finite numpy arrays shaped (n_samples, 3)
whose columns are CIELAB L*, a*, b*. No binning, clustering, or colour
quantisation is used by this module.
"""

from __future__ import annotations

from collections import defaultdict
from io import BytesIO
from itertools import combinations
import json
from typing import Any, Callable

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial.distance import cdist, pdist
from scipy.stats import pearsonr, spearmanr, wasserstein_distance_nd
from skimage.color import deltaE_ciede2000


EMOTIONS = [
    "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
    "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
]
HUMANS = ["CN", "BW", "UK", "US"]
AIS = ["DeepSeek", "Doubao", "GPT", "Gemini"]
METRICS = ["MICD76", "MICD00", "Assignment76", "Assignment00", "Energy76-U", "Energy76-V", "OT76"]
FORMAL_METRICS = ["MICD00", "Assignment00", "Energy76-U"]
RANDOM_STATE = 20260817


class AnalysisCancelled(RuntimeError):
    pass


def _report(progress: Callable[[str, int, int], None] | None, stage: str, completed: int, total: int) -> None:
    if progress:
        progress(stage, completed, total)


def _check_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled and cancelled():
        raise AnalysisCancelled("分析已由用户取消。")


def _validate_lab(values: np.ndarray, name: str = "Lab") -> np.ndarray:
    result = np.asarray(values, dtype=float)
    if result.ndim != 2 or result.shape[1] != 3 or not len(result):
        raise ValueError(f"{name} 必须是非空 (n_samples, 3) CIELAB 数组。")
    if not np.all(np.isfinite(result)):
        raise ValueError(f"{name} 包含 NaN 或 inf。")
    return result


def delta_e76_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return cdist(_validate_lab(a, "A"), _validate_lab(b, "B"), metric="euclidean")


def delta_e00_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    left, right = _validate_lab(a, "A"), _validate_lab(b, "B")
    return np.asarray(deltaE_ciede2000(left[:, None, :], right[None, :, :]), dtype=float)


def micd(a: np.ndarray, b: np.ndarray, metric: str = "cie76") -> dict[str, float]:
    costs = delta_e76_matrix(a, b) if metric == "cie76" else delta_e00_matrix(a, b)
    a_to_b = float(np.mean(np.min(costs, axis=1)))
    b_to_a = float(np.mean(np.min(costs, axis=0)))
    return {"aToB": a_to_b, "bToA": b_to_a, "symmetric": (a_to_b + b_to_a) / 2}


def assignment_distance(
    a: np.ndarray, b: np.ndarray, metric: str = "ciede2000", repeats: int = 1000,
    rng: np.random.Generator | None = None, keep_details: bool = True,
) -> dict[str, Any]:
    left, right = _validate_lab(a, "A"), _validate_lab(b, "B")
    cost_fn = delta_e76_matrix if metric == "cie76" else delta_e00_matrix
    rng = rng or np.random.default_rng(RANDOM_STATE)
    draws = max(1, repeats if len(left) != len(right) else 1)
    means: list[float] = []
    medians: list[float] = []
    first_costs: list[float] = []
    first_pairs: list[list[int]] = []
    for draw in range(draws):
        if len(left) > len(right):
            left_indexes, right_indexes = np.sort(rng.choice(len(left), len(right), replace=False)), np.arange(len(right))
        elif len(right) > len(left):
            left_indexes, right_indexes = np.arange(len(left)), np.sort(rng.choice(len(right), len(left), replace=False))
        else:
            left_indexes, right_indexes = np.arange(len(left)), np.arange(len(right))
        costs = cost_fn(left[left_indexes], right[right_indexes])
        row_index, column_index = linear_sum_assignment(costs)
        matched = costs[row_index, column_index]
        means.append(float(np.mean(matched))); medians.append(float(np.median(matched)))
        if draw == 0 and keep_details:
            first_costs = matched.astype(float).tolist()
            first_pairs = [[int(left_indexes[i]), int(right_indexes[j])] for i, j in zip(row_index, column_index)]
    return {
        "mean": float(np.mean(means)), "median": float(np.mean(medians)),
        "subsampleCiLow": float(np.quantile(means, .025)), "subsampleCiHigh": float(np.quantile(means, .975)),
        "repeats": draws, "costs": first_costs, "pairs": first_pairs,
    }


def energy_distance_cie76(a: np.ndarray, b: np.ndarray, estimator: str = "v") -> dict[str, float | None]:
    """Energy distance with an explicit U- or V-statistic within-group term."""
    left, right = _validate_lab(a, "A"), _validate_lab(b, "B")
    if len(left) < 2 or len(right) < 2:
        return {"energy": None, "cross": None, "withinA": None, "withinB": None}
    cross = float(np.mean(delta_e76_matrix(left, right)))
    if estimator.lower() == "u":
        within_a = float(np.sum(delta_e76_matrix(left, left)) / (len(left) * (len(left) - 1)))
        within_b = float(np.sum(delta_e76_matrix(right, right)) / (len(right) * (len(right) - 1)))
    elif estimator.lower() == "v":
        within_a = float(np.mean(delta_e76_matrix(left, left)))
        within_b = float(np.mean(delta_e76_matrix(right, right)))
    else:
        raise ValueError(f"未知 Energy76 estimator：{estimator}")
    return {"energy": 2 * cross - within_a - within_b, "cross": cross, "withinA": within_a, "withinB": within_b}


def wasserstein_raw(a: np.ndarray, b: np.ndarray, metric: str = "cie76") -> float:
    if metric != "cie76":
        raise ValueError("Raw OT 当前仅支持 CIE76 ground cost。")
    left, right = _validate_lab(a, "A"), _validate_lab(b, "B")
    if len(left) == len(right):
        costs = delta_e76_matrix(left, right)
        rows, columns = linear_sum_assignment(costs)
        return float(np.mean(costs[rows, columns]))
    return float(wasserstein_distance_nd(left, right))


def within_group_dispersion(a: np.ndarray) -> dict[str, float | None]:
    values = _validate_lab(a)
    if len(values) < 2:
        return {"meanPairwiseDeltaE76": None, "medianPairwiseDeltaE76": None, "generalizedVariance": None, "meanDistanceToCentroid": 0.0, "medianDistanceToCentroid": 0.0}
    pairwise = pdist(values, metric="euclidean")
    centroid_distances = np.linalg.norm(values - np.mean(values, axis=0), axis=1)
    covariance = np.cov(values, rowvar=False)
    return {
        "meanPairwiseDeltaE76": float(np.mean(pairwise)), "medianPairwiseDeltaE76": float(np.median(pairwise)),
        "generalizedVariance": float(max(0.0, np.linalg.det(covariance))),
        "meanDistanceToCentroid": float(np.mean(centroid_distances)), "medianDistanceToCentroid": float(np.median(centroid_distances)),
    }


def within_metric_distance(a: np.ndarray, metric: str, repeats: int = 32, seed: int = RANDOM_STATE) -> dict[str, Any]:
    """Calculate a non-trivial within-group distance by split-half resampling."""
    values = _validate_lab(a)
    half = len(values) // 2
    if half < 1:
        return {"metric": metric, "mean": None, "median": None, "sd": None, "repeats": 0, "definition": "split-half"}
    rng = np.random.default_rng(seed)
    distances: list[float] = []
    for _ in range(max(1, repeats)):
        indexes = rng.permutation(len(values))[: 2 * half]
        left, right = values[indexes[:half]], values[indexes[half:]]
        if metric == "MICD76": value = micd(left, right, "cie76")["symmetric"]
        elif metric == "MICD00": value = micd(left, right, "ciede2000")["symmetric"]
        elif metric == "Assignment76": value = assignment_distance(left, right, "cie76", 1, rng, False)["mean"]
        elif metric == "Assignment00": value = assignment_distance(left, right, "ciede2000", 1, rng, False)["mean"]
        elif metric == "Energy76-U": value = energy_distance_cie76(left, right, "u")["energy"]
        elif metric == "Energy76-V": value = energy_distance_cie76(left, right, "v")["energy"]
        elif metric == "OT76": value = wasserstein_raw(left, right, "cie76")
        else: raise ValueError(f"未知的组内距离指标：{metric}")
        if value is not None and np.isfinite(value): distances.append(float(value))
    return {"metric": metric, "mean": float(np.mean(distances)) if distances else None, "median": float(np.median(distances)) if distances else None, "sd": float(np.std(distances, ddof=1)) if len(distances) > 1 else 0.0 if distances else None, "repeats": len(distances), "definition": "split-half"}


def _text(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _number(row: dict[str, Any], *keys: str) -> float:
    for key in keys:
        try:
            value = float(row.get(key))
            if np.isfinite(value): return value
        except (TypeError, ValueError): pass
    return float("nan")


def prepare_rows(raw_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    aliases = {value.lower(): value for value in HUMANS + AIS}
    rows: list[dict[str, Any]] = []
    missing_identity: set[str] = set()
    for index, row in enumerate(raw_rows):
        source = aliases.get(_text(row, "source", "来源").lower(), _text(row, "source", "来源"))
        cohort = _text(row, "cohort", "组类型").lower()
        emotion = _text(row, "emotion", "情绪")
        lab = np.asarray([_number(row, "labL", "L_Lab"), _number(row, "labA", "a_Lab"), _number(row, "labB", "b_Lab")])
        if not source or cohort not in {"human", "ai"} or emotion not in EMOTIONS or not np.all(np.isfinite(lab)):
            continue
        unit = _text(row, "participant", "participant_id") if cohort == "human" else _text(row, "run", "run_id")
        if not unit:
            missing_identity.add(source); unit = f"missing-{index}"
        rows.append({"source": source, "cohort": cohort, "emotion": emotion, "unit": unit, "lab": lab})
    if not rows: raise ValueError("未识别到实验一连续 CIELAB 数据。")
    sources = [source for source in HUMANS + AIS if any(row["source"] == source for row in rows)]
    sources += sorted({row["source"] for row in rows} - set(sources))
    return rows, sources, sorted(missing_identity)


def _group_points(rows: list[dict[str, Any]]) -> dict[tuple[str, str], np.ndarray]:
    grouped: dict[tuple[str, str], list[np.ndarray]] = defaultdict(list)
    for row in rows: grouped[(row["source"], row["emotion"])].append(row["lab"])
    return {key: np.asarray(values, dtype=float) for key, values in grouped.items()}


def _all_metrics(a: np.ndarray, b: np.ndarray, assignment_repeats: int, seed: int, details: bool) -> tuple[dict[str, float | None], list[dict[str, Any]]]:
    micd76, micd00 = micd(a, b, "cie76"), micd(a, b, "ciede2000")
    assignment76 = assignment_distance(a, b, "cie76", assignment_repeats, np.random.default_rng(seed), details)
    assignment00 = assignment_distance(a, b, "ciede2000", assignment_repeats, np.random.default_rng(seed + 1), details)
    energy_u = energy_distance_cie76(a, b, "u")
    energy_v = energy_distance_cie76(a, b, "v")
    ot = wasserstein_raw(a, b)
    values = {
        "MICD76": micd76["symmetric"], "MICD00": micd00["symmetric"],
        "Assignment76": assignment76["mean"], "Assignment00": assignment00["mean"],
        "Energy76-U": energy_u["energy"], "Energy76-V": energy_v["energy"], "OT76": ot,
        "MICD76_AtoB": micd76["aToB"], "MICD76_BtoA": micd76["bToA"],
        "MICD00_AtoB": micd00["aToB"], "MICD00_BtoA": micd00["bToA"],
    }
    detail_rows = []
    if details:
        for name, item in (("Assignment76", assignment76), ("Assignment00", assignment00)):
            detail_rows.append({"metric": name, "mean": item["mean"], "median": item["median"], "subsampleCiLow": item["subsampleCiLow"], "subsampleCiHigh": item["subsampleCiHigh"], "repeats": item["repeats"], "costDistributionJson": json.dumps(item["costs"]), "optimalPairsJson": json.dumps(item["pairs"])})
    return values, detail_rows


def _sample_source(rows: list[dict[str, Any]], source: str, rng: np.random.Generator) -> list[dict[str, Any]]:
    units: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row["source"] == source: units[row["unit"]].append(row)
    names = list(units)
    indexes = rng.integers(0, len(names), size=len(names))
    return [row for index in indexes for row in units[names[int(index)]]]


def _summary(values: list[float]) -> dict[str, float | None]:
    finite = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if not len(finite): return {"bootstrapMean": None, "bootstrapMedian": None, "bootstrapSd": None, "ciLow": None, "ciHigh": None}
    return {"bootstrapMean": float(np.mean(finite)), "bootstrapMedian": float(np.median(finite)), "bootstrapSd": float(np.std(finite, ddof=1)) if len(finite) > 1 else 0.0, "ciLow": float(np.quantile(finite, .025)), "ciHigh": float(np.quantile(finite, .975))}


def _complete_unit_blocks(rows: list[dict[str, Any]], source: str) -> tuple[list[dict[str, np.ndarray]], int]:
    grouped: dict[str, dict[str, list[np.ndarray]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row["source"] == source:
            grouped[row["unit"]][row["emotion"]].append(row["lab"])
    complete: list[dict[str, np.ndarray]] = []
    for unit in sorted(grouped):
        emotions = grouped[unit]
        if all(len(emotions.get(emotion, [])) == 1 for emotion in EMOTIONS):
            complete.append({emotion: np.asarray(emotions[emotion][0], dtype=float) for emotion in EMOTIONS})
    return complete, len(grouped) - len(complete)


def _block_points(blocks: list[dict[str, np.ndarray]], emotion: str) -> np.ndarray:
    return np.asarray([block[emotion] for block in blocks], dtype=float)


def _overall_block_distance(ai_blocks: list[dict[str, np.ndarray]], human_blocks: list[dict[str, np.ndarray]], metric: str) -> float:
    values: list[float] = []
    for emotion in EMOTIONS:
        ai_points, human_points = _block_points(ai_blocks, emotion), _block_points(human_blocks, emotion)
        if metric == "MICD00":
            value = micd(ai_points, human_points, "ciede2000")["symmetric"]
        elif metric == "Energy76-U":
            value = energy_distance_cie76(ai_points, human_points, "u")["energy"]
        else:
            raise ValueError(f"不支持的正式 block distance：{metric}")
        if value is not None and np.isfinite(value): values.append(float(value))
    if len(values) != len(EMOTIONS):
        raise ValueError(f"{metric} 未得到完整的 20 emotion block distance。")
    return float(np.mean(values))


def _assignment_pair_from_blocks(ai_blocks: list[dict[str, np.ndarray]], human_blocks: list[dict[str, np.ndarray]]) -> float:
    values = []
    for emotion in EMOTIONS:
        costs = delta_e00_matrix(_block_points(ai_blocks, emotion), _block_points(human_blocks, emotion))
        row_index, column_index = linear_sum_assignment(costs)
        values.append(float(np.mean(costs[row_index, column_index])))
    return float(np.mean(values))


def assignment_common_m_contrast(
    ai_blocks: list[dict[str, np.ndarray]], human_a_blocks: list[dict[str, np.ndarray]], human_b_blocks: list[dict[str, np.ndarray]],
    repeats: int, seed: int,
) -> dict[str, Any]:
    """Paired Assignment00 contrast with one common m and one shared AI draw."""
    if not ai_blocks or not human_a_blocks or not human_b_blocks:
        raise ValueError("Assignment common-m 需要三个非空、完整的 unit block 集合。")
    common_m = min(len(ai_blocks), len(human_a_blocks), len(human_b_blocks))
    repeats = max(1, int(repeats)); rng = np.random.default_rng(seed)

    def select(blocks: list[dict[str, np.ndarray]]) -> list[dict[str, np.ndarray]]:
        if len(blocks) == common_m: return blocks
        indexes = np.sort(rng.choice(len(blocks), common_m, replace=False))
        return [blocks[int(index)] for index in indexes]

    no_subsampling = all(len(blocks) == common_m for blocks in (ai_blocks, human_a_blocks, human_b_blocks))
    effective_draws = 1 if no_subsampling else repeats
    distance_a_draws: list[float] = []; distance_b_draws: list[float] = []
    for _ in range(effective_draws):
        selected_ai = select(ai_blocks)
        selected_a = select(human_a_blocks)
        selected_b = select(human_b_blocks)
        distance_a_draws.append(_assignment_pair_from_blocks(selected_ai, selected_a))
        distance_b_draws.append(_assignment_pair_from_blocks(selected_ai, selected_b))
    if no_subsampling and repeats > 1:
        distance_a_draws *= repeats; distance_b_draws *= repeats
    delta_draws = [a - b for a, b in zip(distance_a_draws, distance_b_draws)]
    return {
        "commonM": common_m, "repeats": repeats,
        "distanceA": float(np.mean(distance_a_draws)), "distanceB": float(np.mean(distance_b_draws)),
        "delta": float(np.mean(delta_draws)), "monteCarloSd": float(np.std(delta_draws, ddof=1)) if len(delta_draws) > 1 else 0.0,
        "distanceADraws": distance_a_draws, "distanceBDraws": distance_b_draws, "deltaDraws": delta_draws,
    }


def _permutation_p_value(values: list[float], observed: float) -> float | None:
    finite = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if not len(finite): return None
    return float((1 + np.sum(np.abs(finite) >= abs(observed))) / (len(finite) + 1))


def _formal_human_permutation(
    rows: list[dict[str, Any]], humans: list[str], ais: list[str], permutations: int, assignment_repeats: int,
    progress: Callable[[str, int, int], None] | None = None, cancelled: Callable[[], bool] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    blocks: dict[str, list[dict[str, np.ndarray]]] = {}; incomplete_rows: list[dict[str, Any]] = []
    for source in humans + ais:
        blocks[source], excluded = _complete_unit_blocks(rows, source)
        incomplete_rows.append({"source": source, "complete_units": len(blocks[source]), "excluded_incomplete_units": excluded})
    pairwise_rows: list[dict[str, Any]] = []; diagnostics: list[dict[str, Any]] = []
    total = max(1, len(ais) * len(list(combinations(humans, 2))) * max(1, permutations)); completed = 0
    _report(progress, "Human group block permutation", 0, total)
    for ai_index, ai in enumerate(ais):
        ai_blocks = blocks[ai]
        for pair_index, (human_a, human_b) in enumerate(combinations(humans, 2)):
            _check_cancelled(cancelled)
            human_a_blocks, human_b_blocks = blocks[human_a], blocks[human_b]
            if not ai_blocks or not human_a_blocks or not human_b_blocks: continue
            convergence = assignment_common_m_contrast(ai_blocks, human_a_blocks, human_b_blocks, 100, RANDOM_STATE + ai_index * 1000 + pair_index)
            delta_draws = convergence["deltaDraws"]
            diagnostics.append({
                "ai_group": ai, "human_a": human_a, "human_b": human_b, "common_m": convergence["commonM"], "R": 100,
                "delta_observed": convergence["delta"], "monte_carlo_sd": convergence["monteCarloSd"],
                "result_R20": float(np.mean(delta_draws[:20])), "result_R50": float(np.mean(delta_draws[:50])), "result_R100": float(np.mean(delta_draws[:100])),
                "abs_R50_minus_R100": abs(float(np.mean(delta_draws[:50])) - float(np.mean(delta_draws[:100]))),
            })
            observed: dict[str, tuple[float, float, float, int | None]] = {
                "MICD00": (
                    _overall_block_distance(ai_blocks, human_a_blocks, "MICD00"),
                    _overall_block_distance(ai_blocks, human_b_blocks, "MICD00"), 0.0, None,
                ),
                "Energy76-U": (
                    _overall_block_distance(ai_blocks, human_a_blocks, "Energy76-U"),
                    _overall_block_distance(ai_blocks, human_b_blocks, "Energy76-U"), 0.0, None,
                ),
            }
            observed_draws = min(max(1, assignment_repeats), len(convergence["deltaDraws"]))
            observed_assignment = {
                "distanceA": float(np.mean(convergence["distanceADraws"][:observed_draws])),
                "distanceB": float(np.mean(convergence["distanceBDraws"][:observed_draws])),
                "monteCarloSd": float(np.std(convergence["deltaDraws"][:observed_draws], ddof=1)) if observed_draws > 1 else 0.0,
                "commonM": convergence["commonM"],
            }
            observed["Assignment00"] = (
                observed_assignment["distanceA"], observed_assignment["distanceB"], observed_assignment["monteCarloSd"], observed_assignment["commonM"],
            )
            nulls: dict[str, list[float]] = {metric: [] for metric in FORMAL_METRICS}
            pooled = [(human_a, block) for block in human_a_blocks] + [(human_b, block) for block in human_b_blocks]
            n_a = len(human_a_blocks)
            rng = np.random.default_rng(RANDOM_STATE + 1_000_000 + ai_index * 100_000 + pair_index * 10_000)
            for permutation in range(permutations):
                _check_cancelled(cancelled)
                order = rng.permutation(len(pooled))
                perm_a = [pooled[int(index)][1] for index in order[:n_a]]
                perm_b = [pooled[int(index)][1] for index in order[n_a:]]
                for metric in ("MICD00", "Energy76-U"):
                    nulls[metric].append(_overall_block_distance(ai_blocks, perm_a, metric) - _overall_block_distance(ai_blocks, perm_b, metric))
                assignment = assignment_common_m_contrast(
                    ai_blocks, perm_a, perm_b, assignment_repeats,
                    RANDOM_STATE + 2_000_000 + ai_index * 1_000_000 + pair_index * 100_000 + permutation,
                )
                nulls["Assignment00"].append(assignment["delta"])
                completed += 1; _report(progress, "Human group block permutation", completed, total)
            for metric in FORMAL_METRICS:
                distance_a, distance_b, mc_sd, common_m = observed[metric]
                delta = distance_a - distance_b; denominator = (distance_a + distance_b) / 2
                permutation_summary = _summary(nulls[metric])
                pairwise_rows.append({
                    "metric": metric, "ai_group": ai, "human_a": human_a, "human_b": human_b,
                    "distance_a": distance_a, "distance_b": distance_b, "delta_observed": delta, "abs_delta": abs(delta),
                    "relative_difference_pct": abs(delta) / denominator * 100 if denominator else None,
                    "permutation_mean_delta": permutation_summary["bootstrapMean"], "permutation_sd_delta": permutation_summary["bootstrapSd"],
                    "p_raw": _permutation_p_value(nulls[metric], delta), "lower_distance_group": human_a if delta < 0 else human_b if delta > 0 else "tie",
                    "n_permutations": permutations, "assignment_common_m": common_m, "assignment_inner_repeats": assignment_repeats if metric == "Assignment00" else None,
                    "assignment_monte_carlo_sd": mc_sd if metric == "Assignment00" else None, "random_seed": RANDOM_STATE,
                })
    for ai in ais:
        for metric in FORMAL_METRICS:
            _holm([row for row in pairwise_rows if row["ai_group"] == ai and row["metric"] == metric])

    letters: list[dict[str, Any]] = []; matrices: list[dict[str, Any]] = []
    for ai in ais:
        for metric in FORMAL_METRICS:
            family = [row for row in pairwise_rows if row["ai_group"] == ai and row["metric"] == metric]
            significant = {frozenset((row["human_a"], row["human_b"])) for row in family if row["significant_holm"]}
            distance_lookup: dict[str, list[float]] = defaultdict(list)
            for row in family:
                distance_lookup[row["human_a"]].append(row["distance_a"]); distance_lookup[row["human_b"]].append(row["distance_b"])
            display_distance = {human: float(np.mean(distance_lookup[human])) for human in humans if distance_lookup[human]}
            order = sorted(display_distance, key=display_distance.get)
            display = _compact_letters(humans, significant, order)
            for human in humans:
                letters.append({"ai_group": ai, "metric": metric, "human_group": human, "observed_distance": display_distance.get(human), "letters": display.get(human, "")})
            for row_group in humans:
                for column_group in humans:
                    if row_group == column_group:
                        matrices.append({"ai_group": ai, "metric": metric, "row_group": row_group, "column_group": column_group, "label": "—", "delta_observed": 0.0, "relative_difference_pct": 0.0, "p_holm": None, "significant_holm": False})
                        continue
                    item = next((row for row in family if {row["human_a"], row["human_b"]} == {row_group, column_group}), None)
                    if item:
                        sign = 1 if item["human_a"] == row_group else -1
                        matrices.append({"ai_group": ai, "metric": metric, "row_group": row_group, "column_group": column_group,
                            "label": f'{item["lower_distance_group"]} lower', "delta_observed": sign * item["delta_observed"],
                            "relative_difference_pct": item["relative_difference_pct"], "p_holm": item["p_holm"], "significant_holm": item["significant_holm"]})

    robustness: list[dict[str, Any]] = []
    for ai in ais:
        for human_a, human_b in combinations(humans, 2):
            items = [row for row in pairwise_rows if row["ai_group"] == ai and row["human_a"] == human_a and row["human_b"] == human_b]
            signs = {int(np.sign(row["delta_observed"])) for row in items}; significant_count = sum(bool(row["significant_holm"]) for row in items)
            if len(signs) > 1: category = "opposite_direction"
            elif significant_count == len(FORMAL_METRICS): category = "same_direction_all_significant"
            elif significant_count: category = "same_direction_partial_significance"
            else: category = "same_direction_no_significance"
            robustness.append({"ai_group": ai, "human_a": human_a, "human_b": human_b, "category": category,
                **{f'{row["metric"]}_delta': row["delta_observed"] for row in items}, **{f'{row["metric"]}_p_holm': row["p_holm"] for row in items}})
    return pairwise_rows, diagnostics, letters, matrices, robustness, incomplete_rows


def _bootstrap_p_value(values: list[float]) -> float | None:
    finite = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if not len(finite): return None
    lower = (float(np.sum(finite <= 0)) + 1.0) / (len(finite) + 1.0)
    upper = (float(np.sum(finite >= 0)) + 1.0) / (len(finite) + 1.0)
    return min(1.0, 2.0 * min(lower, upper))


def _holm(rows: list[dict[str, Any]]) -> None:
    valid = [(index, float(row["p_raw"])) for index, row in enumerate(rows) if row.get("p_raw") is not None and np.isfinite(row["p_raw"])]
    ordered = sorted(valid, key=lambda item: item[1]); running = 0.0; total = len(ordered)
    for rank, (index, raw) in enumerate(ordered):
        running = max(running, min(1.0, raw * (total - rank)))
        rows[index]["p_holm"] = running
    for row in rows:
        row.setdefault("p_holm", None)
        row["significant_raw"] = row.get("p_raw") is not None and row["p_raw"] < .05
        row["significant_holm"] = row.get("p_holm") is not None and row["p_holm"] < .05


def _compact_letters(groups: list[str], significant_pairs: set[frozenset[str]], order: list[str]) -> dict[str, str]:
    """Exact clique-cover CLD for a four-group family.

    Every letter is a clique of mutually non-significant groups. The selected
    clique set covers every group and every non-significant pair, so significant
    pairs never share a letter and every non-significant pair shares one.
    """
    from itertools import combinations
    group_set = set(groups)
    nonsignificant = {frozenset(pair) for pair in combinations(groups, 2) if frozenset(pair) not in significant_pairs}
    candidates: list[frozenset[str]] = []
    for size in range(1, len(groups) + 1):
        for subset_tuple in combinations(groups, size):
            subset = frozenset(subset_tuple)
            if all(frozenset(pair) not in significant_pairs for pair in combinations(subset_tuple, 2)):
                candidates.append(subset)
    targets: set[tuple[str, ...]] = {("group", group) for group in groups}
    targets |= {("pair", *sorted(pair)) for pair in nonsignificant}
    coverage = []
    for subset in candidates:
        covered: set[tuple[str, ...]] = {("group", group) for group in subset}
        covered |= {("pair", *sorted(pair)) for pair in combinations(subset, 2)}
        coverage.append(covered)
    selected: tuple[int, ...] | None = None
    for count in range(1, len(candidates) + 1):
        for indexes in combinations(range(len(candidates)), count):
            if set().union(*(coverage[index] for index in indexes)) >= targets:
                selected = indexes; break
        if selected is not None: break
    chosen = [candidates[index] for index in (selected or ())]
    position = {group: index for index, group in enumerate(order)}
    chosen.sort(key=lambda subset: (min(position.get(group, 999) for group in subset), -len(subset), sorted(subset)))
    alphabet = [chr(ord("a") + index) for index in range(len(chosen))]
    return {group: "".join(letter for letter, subset in zip(alphabet, chosen) if group in subset) for group in groups}


def _pairwise_inference(
    humans: list[str], ais: list[str], ranking_rows: list[dict[str, Any]],
    bootstrap_overall: dict[tuple[str, str, str], list[float]], bootstrap_iterations: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    metrics = ["Assignment00", "Energy76-V"]
    observed_lookup = {(row["ai_group"], row["human_group"], row["metric"]): row for row in ranking_rows}
    human_rows: list[dict[str, Any]] = []; ai_rows: list[dict[str, Any]] = []
    for ai in ais:
        for metric in metrics:
            family: list[dict[str, Any]] = []
            for first_index, first in enumerate(humans):
                for second in humans[first_index + 1:]:
                    first_row, second_row = observed_lookup.get((ai, first, metric)), observed_lookup.get((ai, second, metric))
                    if not first_row or not second_row: continue
                    differences = [a - b for a, b in zip(bootstrap_overall.get((ai, first, metric), []), bootstrap_overall.get((ai, second, metric), []))]
                    stats = _summary(differences); observed_diff = float(first_row["mean_distance"] - second_row["mean_distance"])
                    family.append({
                        "metric": metric, "ai_group": ai, "human_a": first, "human_b": second,
                        "distance_a": first_row["mean_distance"], "distance_b": second_row["mean_distance"], "observed_diff": observed_diff,
                        "bootstrap_mean_diff": stats["bootstrapMean"], "bootstrap_median_diff": stats["bootstrapMedian"], "bootstrap_sd": stats["bootstrapSd"],
                        "ci_low": stats["ciLow"], "ci_high": stats["ciHigh"], "p_raw": _bootstrap_p_value(differences),
                        "effect_direction": "A_lower" if observed_diff < 0 else "B_lower" if observed_diff > 0 else "tie",
                        "lower_distance_group": first if observed_diff < 0 else second if observed_diff > 0 else "tie", "n_bootstrap": len(differences),
                    })
            _holm(family); human_rows.extend(family)
    for human in humans:
        for metric in metrics:
            family = []
            for first_index, first in enumerate(ais):
                for second in ais[first_index + 1:]:
                    first_row, second_row = observed_lookup.get((first, human, metric)), observed_lookup.get((second, human, metric))
                    if not first_row or not second_row: continue
                    differences = [a - b for a, b in zip(bootstrap_overall.get((first, human, metric), []), bootstrap_overall.get((second, human, metric), []))]
                    stats = _summary(differences); observed_diff = float(first_row["mean_distance"] - second_row["mean_distance"])
                    family.append({
                        "metric": metric, "human_group": human, "ai_a": first, "ai_b": second,
                        "distance_a": first_row["mean_distance"], "distance_b": second_row["mean_distance"], "observed_diff": observed_diff,
                        "bootstrap_mean_diff": stats["bootstrapMean"], "bootstrap_median_diff": stats["bootstrapMedian"], "bootstrap_sd": stats["bootstrapSd"],
                        "ci_low": stats["ciLow"], "ci_high": stats["ciHigh"], "p_raw": _bootstrap_p_value(differences),
                        "effect_direction": "A_lower" if observed_diff < 0 else "B_lower" if observed_diff > 0 else "tie",
                        "lower_distance_ai": first if observed_diff < 0 else second if observed_diff > 0 else "tie", "n_bootstrap": len(differences),
                    })
            _holm(family); ai_rows.extend(family)

    letters: list[dict[str, Any]] = []; matrix_rows: list[dict[str, Any]] = []
    for comparison_type, fixed_groups, compared_groups, all_rows, fixed_key, a_key, b_key in (
        ("fixed_ai", ais, humans, human_rows, "ai_group", "human_a", "human_b"),
        ("fixed_human", humans, ais, ai_rows, "human_group", "ai_a", "ai_b"),
    ):
        for fixed in fixed_groups:
            for metric in metrics:
                family = [row for row in all_rows if row[fixed_key] == fixed and row["metric"] == metric]
                significant = {frozenset((row[a_key], row[b_key])) for row in family if row["significant_holm"]}
                ordered = sorted(compared_groups, key=lambda group: observed_lookup[(fixed, group, metric)]["mean_distance"] if comparison_type == "fixed_ai" else observed_lookup[(group, fixed, metric)]["mean_distance"])
                display = _compact_letters(compared_groups, significant, ordered)
                for group in compared_groups:
                    distance_row = observed_lookup[(fixed, group, metric)] if comparison_type == "fixed_ai" else observed_lookup[(group, fixed, metric)]
                    letters.append({"comparison_type": comparison_type, "fixed_group": fixed, "metric": metric, "group": group, "distance": distance_row["mean_distance"], "ci_low": distance_row["ci_low"], "ci_high": distance_row["ci_high"], "letters": display[group]})
                for row_group in compared_groups:
                    for column_group in compared_groups:
                        if row_group == column_group:
                            matrix_rows.append({"comparison_type": comparison_type, "fixed_group": fixed, "metric": metric, "row_group": row_group, "column_group": column_group, "label": "—", "p_holm": None, "significant_holm": False, "lower_distance_group": row_group}); continue
                        item = next(row for row in family if {row[a_key], row[b_key]} == {row_group, column_group})
                        lower = item["lower_distance_group"] if comparison_type == "fixed_ai" else item["lower_distance_ai"]
                        p = item["p_holm"]; stars = "***" if p is not None and p < .001 else "**" if p is not None and p < .01 else "*" if p is not None and p < .05 else "ns"
                        label = f"{lower} < {item[b_key] if lower == item[a_key] else item[a_key]} {stars}" if item["significant_holm"] else "ns"
                        matrix_rows.append({"comparison_type": comparison_type, "fixed_group": fixed, "metric": metric, "row_group": row_group, "column_group": column_group, "label": label, "p_holm": p, "significant_holm": item["significant_holm"], "lower_distance_group": lower})

    robustness: list[dict[str, Any]] = []
    for comparison_type, rows_list, fixed_key, a_key, b_key in (
        ("fixed_ai", human_rows, "ai_group", "human_a", "human_b"), ("fixed_human", ai_rows, "human_group", "ai_a", "ai_b"),
    ):
        assignments = [row for row in rows_list if row["metric"] == "Assignment00"]
        energies = {(row[fixed_key], row[a_key], row[b_key]): row for row in rows_list if row["metric"] == "Energy76-V"}
        for assignment in assignments:
            energy = energies.get((assignment[fixed_key], assignment[a_key], assignment[b_key]));
            if not energy: continue
            same_direction = np.sign(assignment["observed_diff"]) == np.sign(energy["observed_diff"])
            if not same_direction: category = "opposite_direction"
            elif assignment["significant_holm"] and energy["significant_holm"]: category = "same_direction_both_significant"
            elif assignment["significant_holm"]: category = "same_direction_assignment_only"
            elif energy["significant_holm"]: category = "same_direction_energy_only"
            else: category = "same_direction_both_nonsignificant"
            robustness.append({"comparison_type": comparison_type, "fixed_group": assignment[fixed_key], "group_a": assignment[a_key], "group_b": assignment[b_key], "assignment_observed_diff": assignment["observed_diff"], "assignment_p_holm": assignment["p_holm"], "energy_observed_diff": energy["observed_diff"], "energy_p_holm": energy["p_holm"], "category": category})
    return human_rows, ai_rows, letters, matrix_rows, robustness


def run_continuous_distances(
    payload: dict[str, Any],
    progress: Callable[[str, int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    rows, sources, missing_identity = prepare_rows([row for row in payload.get("rows", []) if isinstance(row, dict)])
    humans, ais = [s for s in HUMANS if s in sources], [s for s in AIS if s in sources]
    if not humans or not ais: raise ValueError("连续距离比较至少需要一个 Human 组和一个 AI 组。")
    options = payload.get("options", {}) if isinstance(payload.get("options"), dict) else {}
    bootstrap_iterations = max(0, min(2000, int(options.get("bootstrapIterations", 10))))
    assignment_repeats = max(1, min(1000, int(options.get("assignmentRepeats", 20))))
    permutation_iterations = max(0, min(10000, int(options.get("permutationIterations", 200))))
    points = _group_points(rows)
    long_rows: list[dict[str, Any]] = []
    assignment_details: list[dict[str, Any]] = []
    observed: dict[tuple[str, str, str, str], float] = {}
    observed_total = sum(1 for emotion in EMOTIONS for index, source_a in enumerate(sources) for source_b in sources[index + 1:] if (source_a, emotion) in points and (source_b, emotion) in points)
    observed_done = 0
    _report(progress, "计算观察距离", 0, observed_total)
    for emotion in EMOTIONS:
        for ai, source_a in enumerate(sources):
            a = points.get((source_a, emotion))
            if a is None: continue
            long_rows.extend({"emotion": emotion, "group_a": source_a, "group_b": source_a, "metric": metric, "direction": "symmetric", "distance": 0.0, "n_a": len(a), "n_b": len(a), "bootstrap_mean": None, "bootstrap_sd": None, "ci_low": None, "ci_high": None} for metric in METRICS)
            for source_b in sources[ai + 1:]:
                _check_cancelled(cancelled)
                b = points.get((source_b, emotion))
                if b is None: continue
                values, details = _all_metrics(a, b, assignment_repeats, RANDOM_STATE + ai * 101 + EMOTIONS.index(emotion), True)
                observed_done += 1
                _report(progress, "计算观察距离", observed_done, observed_total)
                for metric in METRICS:
                    value = values[metric]
                    if value is None: continue
                    observed[(source_a, source_b, emotion, metric)] = float(value); observed[(source_b, source_a, emotion, metric)] = float(value)
                    for left, right in ((source_a, source_b), (source_b, source_a)):
                        long_rows.append({"emotion": emotion, "group_a": left, "group_b": right, "metric": metric, "direction": "symmetric", "distance": value, "n_a": len(points[(left, emotion)]), "n_b": len(points[(right, emotion)]), "bootstrap_mean": None, "bootstrap_sd": None, "ci_low": None, "ci_high": None})
                for metric in ("MICD76", "MICD00"):
                    prefix = metric
                    directions = [(source_a, source_b, values[f"{prefix}_AtoB"]), (source_b, source_a, values[f"{prefix}_BtoA"])]
                    for left, right, value in directions:
                        long_rows.append({"emotion": emotion, "group_a": left, "group_b": right, "metric": metric, "direction": "directed", "distance": value, "n_a": len(points[(left, emotion)]), "n_b": len(points[(right, emotion)]), "bootstrap_mean": None, "bootstrap_sd": None, "ci_low": None, "ci_high": None})
                assignment_details.extend({"emotion": emotion, "group_a": source_a, "group_b": source_b, **detail} for detail in details)

    within_rows: list[dict[str, Any]] = []
    within_metric_rows: list[dict[str, Any]] = []
    within_items = list(points.items())
    _report(progress, "计算组内离散", 0, len(within_items))
    for within_index, ((source, emotion), values) in enumerate(within_items, 1):
        _check_cancelled(cancelled)
        within_rows.append({"group": source, "emotion": emotion, "n": len(values), **within_group_dispersion(values)})
        for metric_index, metric in enumerate(METRICS):
            item = within_metric_distance(values, metric, repeats=32, seed=RANDOM_STATE + within_index * 101 + metric_index)
            within_metric_rows.append({"group": source, "emotion": emotion, "n": len(values), **item})
        _report(progress, "计算组内离散", within_index, len(within_items))

    bootstrap_emotion: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    bootstrap_overall: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    if bootstrap_iterations and not missing_identity:
        bootstrap_total = len(ais) * len(humans) * bootstrap_iterations
        bootstrap_done = 0
        _report(progress, "participant/run 分组 Bootstrap", 0, bootstrap_total)
        source_samples: dict[str, list[list[dict[str, Any]]]] = {}
        for source_index, source in enumerate(humans + ais):
            rng = np.random.default_rng(RANDOM_STATE + 100_000 * (source_index + 1))
            source_samples[source] = [_sample_source(rows, source, rng) for _ in range(bootstrap_iterations)]
        for iteration in range(bootstrap_iterations):
            for ai_index, ai in enumerate(ais):
                for human_index, human in enumerate(humans):
                    _check_cancelled(cancelled)
                    sampled = source_samples[ai][iteration] + source_samples[human][iteration]
                    sampled_points = _group_points(sampled)
                    metric_emotions: dict[str, list[float]] = defaultdict(list)
                    for emotion in EMOTIONS:
                        a, b = sampled_points.get((ai, emotion)), sampled_points.get((human, emotion))
                        if a is None or b is None: continue
                        values, _ = _all_metrics(a, b, assignment_repeats, RANDOM_STATE + iteration * 10_000 + ai_index * 100 + human_index, False)
                        for metric in METRICS:
                            value = values[metric]
                            if value is not None and np.isfinite(value):
                                bootstrap_emotion[(ai, human, emotion, metric)].append(float(value)); metric_emotions[metric].append(float(value))
                        for metric in ("MICD76", "MICD00"):
                            bootstrap_emotion[(ai, human, emotion, f"{metric}:AI_to_Human")].append(float(values[f"{metric}_AtoB"]))
                            bootstrap_emotion[(ai, human, emotion, f"{metric}:Human_to_AI")].append(float(values[f"{metric}_BtoA"]))
                    for metric, metric_values in metric_emotions.items():
                        if metric_values: bootstrap_overall[(ai, human, metric)].append(float(np.mean(metric_values)))
                    bootstrap_done += 1
                    _report(progress, "participant/run 分组 Bootstrap", bootstrap_done, bootstrap_total)

    _check_cancelled(cancelled)
    _report(progress, "汇总置信区间与排名", 0, 1)

    for row in long_rows:
        ai = row["group_a"] if row["group_a"] in ais else row["group_b"] if row["group_b"] in ais else ""
        human = row["group_a"] if row["group_a"] in humans else row["group_b"] if row["group_b"] in humans else ""
        if not ai or not human: continue
        if row["direction"] == "directed":
            direction = "AI_to_Human" if row["group_a"] == ai else "Human_to_AI"
            values = bootstrap_emotion.get((ai, human, row["emotion"], f'{row["metric"]}:{direction}'), [])
        else:
            values = bootstrap_emotion.get((ai, human, row["emotion"], row["metric"]), [])
        stats = _summary(values)
        row.update({"bootstrap_mean": stats["bootstrapMean"], "bootstrap_sd": stats["bootstrapSd"], "ci_low": stats["ciLow"], "ci_high": stats["ciHigh"]})

    ranking_rows: list[dict[str, Any]] = []
    for ai in ais:
        for metric in METRICS:
            temporary = []
            for human in humans:
                emotion_values = [observed[(ai, human, emotion, metric)] for emotion in EMOTIONS if (ai, human, emotion, metric) in observed]
                if not emotion_values: continue
                stats = _summary(bootstrap_overall.get((ai, human, metric), []))
                temporary.append({"ai_group": ai, "human_group": human, "metric": metric, "mean_distance": float(np.mean(emotion_values)), "median_distance": float(np.median(emotion_values)), "ci_low": stats["ciLow"], "ci_high": stats["ciHigh"], "bootstrap_mean": stats["bootstrapMean"], "bootstrap_sd": stats["bootstrapSd"], "n_emotions": len(emotion_values)})
            for rank, item in enumerate(sorted(temporary, key=lambda row: row["mean_distance"]), 1): item["rank"] = rank
            ranking_rows.extend(temporary)

    delta_rows: list[dict[str, Any]] = []
    stability_rows: list[dict[str, Any]] = []
    for ai in ais:
        for metric in METRICS:
            observed_countries = [row for row in ranking_rows if row["ai_group"] == ai and row["metric"] == metric]
            if not observed_countries: continue
            original_closest = min(observed_countries, key=lambda row: row["mean_distance"])["human_group"]
            counts = {human: 0.0 for human in humans}; valid_iterations = 0
            for iteration in range(bootstrap_iterations):
                values = {human: bootstrap_overall[(ai, human, metric)][iteration] for human in humans if len(bootstrap_overall.get((ai, human, metric), [])) > iteration}
                if not values: continue
                minimum = min(values.values()); ties = [human for human, value in values.items() if np.isclose(value, minimum)]
                valid_iterations += 1
                for human in ties: counts[human] += 1 / len(ties)
            for human in humans:
                stability_rows.append({"ai_group": ai, "metric": metric, "human_group": human, "original_closest": original_closest, "closest_stability": counts[human] / valid_iterations if valid_iterations else None, "valid_iterations": valid_iterations})
            for first_index, first in enumerate(humans):
                for second in humans[first_index + 1:]:
                    first_values, second_values = bootstrap_overall.get((ai, first, metric), []), bootstrap_overall.get((ai, second, metric), [])
                    differences = [a - b for a, b in zip(first_values, second_values)]
                    stats = _summary(differences)
                    delta_rows.append({"ai_group": ai, "metric": metric, "country_a": first, "country_b": second, "delta_a_minus_b": next((row["mean_distance"] for row in observed_countries if row["human_group"] == first), None) - next((row["mean_distance"] for row in observed_countries if row["human_group"] == second), None), "ci_low": stats["ciLow"], "ci_high": stats["ciHigh"], "significant": stats["ciLow"] is not None and (stats["ciLow"] > 0 or stats["ciHigh"] < 0)})

    asymmetry_rows = []
    for ai in ais:
        for human in humans:
            for emotion in EMOTIONS:
                for metric in ("MICD76", "MICD00"):
                    ai_to_human = next((row["distance"] for row in long_rows if row["emotion"] == emotion and row["group_a"] == ai and row["group_b"] == human and row["metric"] == metric and row["direction"] == "directed"), None)
                    human_to_ai = next((row["distance"] for row in long_rows if row["emotion"] == emotion and row["group_a"] == human and row["group_b"] == ai and row["metric"] == metric and row["direction"] == "directed"), None)
                    if ai_to_human is not None and human_to_ai is not None:
                        asymmetry_rows.append({"ai_group": ai, "human_group": human, "emotion": emotion, "metric": metric, "ai_to_human": ai_to_human, "human_to_ai": human_to_ai, "ratio_human_to_ai_over_ai_to_human": human_to_ai / ai_to_human if ai_to_human > 0 else None, "difference_human_to_ai_minus_ai_to_human": human_to_ai - ai_to_human})

    agreement_rows = []
    agreement_matrix = []
    vectors: dict[str, list[float]] = {metric: [] for metric in METRICS}
    common_keys = [(a, b, emotion) for emotion in EMOTIONS for index, a in enumerate(sources) for b in sources[index + 1:] if all((a, b, emotion, metric) in observed for metric in METRICS)]
    for metric in METRICS: vectors[metric] = [observed[(a, b, emotion, metric)] for a, b, emotion in common_keys]
    for metric_a in METRICS:
        matrix_row = []
        for metric_b in METRICS:
            if metric_a == metric_b: spearman, pearson = 1.0, 1.0
            elif len(vectors[metric_a]) >= 3:
                spearman = float(spearmanr(vectors[metric_a], vectors[metric_b]).statistic); pearson = float(pearsonr(vectors[metric_a], vectors[metric_b]).statistic)
            else: spearman = pearson = None
            matrix_row.append(spearman); agreement_rows.append({"metric_a": metric_a, "metric_b": metric_b, "spearman": spearman, "pearson": pearson, "n": len(common_keys)})
        agreement_matrix.append(matrix_row)

    rank_agreement_rows = []
    for first_index, metric_a in enumerate(METRICS):
        for metric_b in METRICS[first_index + 1:]:
            comparisons = 0; matches = 0
            for ai in ais:
                for emotion in EMOTIONS:
                    candidates_a = [(human, observed.get((ai, human, emotion, metric_a))) for human in humans]
                    candidates_b = [(human, observed.get((ai, human, emotion, metric_b))) for human in humans]
                    candidates_a = [(h, v) for h, v in candidates_a if v is not None]; candidates_b = [(h, v) for h, v in candidates_b if v is not None]
                    if candidates_a and candidates_b:
                        comparisons += 1; matches += int(min(candidates_a, key=lambda item: item[1])[0] == min(candidates_b, key=lambda item: item[1])[0])
            rank_agreement_rows.append({"metric_a": metric_a, "metric_b": metric_b, "closest_country_agreement": matches / comparisons if comparisons else None, "n_ai_emotion": comparisons})

    legacy_human_pairwise, legacy_ai_pairwise, legacy_pairwise_letters, legacy_pairwise_matrices, legacy_metric_robustness = _pairwise_inference(
        humans, ais, ranking_rows, bootstrap_overall, bootstrap_iterations,
    )

    formal_pairwise, assignment_common_m, formal_letters, formal_matrices, formal_robustness, formal_unit_audit = _formal_human_permutation(
        rows, humans, ais, permutation_iterations, assignment_repeats, progress, cancelled,
    )

    ai_pairwise_descriptive: list[dict[str, Any]] = []
    ranking_lookup = {(row["ai_group"], row["human_group"], row["metric"]): row for row in ranking_rows}
    for human in humans:
        for metric in FORMAL_METRICS:
            for ai_a, ai_b in combinations(ais, 2):
                first, second = ranking_lookup.get((ai_a, human, metric)), ranking_lookup.get((ai_b, human, metric))
                if not first or not second: continue
                delta = float(first["mean_distance"] - second["mean_distance"]); denominator = (first["mean_distance"] + second["mean_distance"]) / 2
                ai_pairwise_descriptive.append({
                    "human_group": human, "metric": metric, "ai_a": ai_a, "ai_b": ai_b,
                    "distance_a": first["mean_distance"], "distance_b": second["mean_distance"], "delta_observed": delta,
                    "abs_delta": abs(delta), "relative_difference_pct": abs(delta) / denominator * 100 if denominator else None,
                    "lower_distance_ai": ai_a if delta < 0 else ai_b if delta > 0 else "tie", "inference": "descriptive_only",
                })

    energy_u_results = [row for row in ranking_rows if row["metric"] == "Energy76-U"]
    energy_v_legacy = [row for row in ranking_rows if row["metric"] == "Energy76-V"]
    sensitivity_rows: list[dict[str, Any]] = []
    for ai in ais:
        for human in humans:
            for family, metric_00, metric_76 in (("MICD", "MICD00", "MICD76"), ("Assignment", "Assignment00", "Assignment76")):
                item_00, item_76 = ranking_lookup.get((ai, human, metric_00)), ranking_lookup.get((ai, human, metric_76))
                if item_00 and item_76:
                    sensitivity_rows.append({
                        "ai_group": ai, "human_group": human, "metric_family": family,
                        "distance_00": item_00["mean_distance"], "distance_76": item_76["mean_distance"],
                        "rank_00": item_00["rank"], "rank_76": item_76["rank"], "same_rank": item_00["rank"] == item_76["rank"],
                    })

    _report(progress, "完成", 1, 1)
    return {
        "version": 3, "sources": sources, "humanSources": humans, "aiSources": ais, "emotions": EMOTIONS, "metrics": METRICS,
        "formalMetrics": FORMAL_METRICS, "missingIdentitySources": missing_identity, "bootstrapIterations": bootstrap_iterations,
        "assignmentRepeats": assignment_repeats, "permutationIterations": permutation_iterations,
        "distanceLong": long_rows, "assignmentDetails": assignment_details, "withinDispersion": within_rows, "withinMetricDistances": within_metric_rows,
        "ranking": ranking_rows, "pairedCountryDeltas": delta_rows, "closestStability": stability_rows,
        "asymmetry": asymmetry_rows, "metricAgreement": agreement_rows, "metricAgreementMatrix": agreement_matrix, "rankAgreement": rank_agreement_rows,
        "humanPairwisePermutation": formal_pairwise, "assignmentCommonMDiagnostics": assignment_common_m,
        "formalPairwiseLetters": formal_letters, "formalPairwiseMatrices": formal_matrices, "formalMetricRobustness": formal_robustness,
        "formalUnitAudit": formal_unit_audit, "aiPairwiseDescriptive": ai_pairwise_descriptive,
        "energy76UResults": energy_u_results, "energy76VLegacy": energy_v_legacy, "metricSensitivity": sensitivity_rows,
        "legacyHumanPairwiseBootstrap": legacy_human_pairwise, "legacyAiPairwiseBootstrap": legacy_ai_pairwise,
        "legacyPairwiseLetters": legacy_pairwise_letters, "legacyPairwiseSignificanceMatrices": legacy_pairwise_matrices,
        "legacyMetricRobustness": legacy_metric_robustness,
        "metadata": {
            "input": "Raw finite CIELAB D65 points; no histogram binning, KMeans, or quantisation.",
            "micd": "Symmetric mean of directed nearest-neighbour minima; both directions are retained.",
            "assignment": f"Descriptive Assignment uses repeated downsampling to min(nA,nB). Formal Human contrasts use one common m=min(nAI,nHumanA,nHumanB), a shared AI reference draw for both distances, and the identical estimator in observed and permutation calculations; inner repeats={assignment_repeats}.",
            "withinMetric": "MICD/Assignment/Energy/OT use repeated split-half distances within each group; comparing a distribution with itself would produce trivial self-matching zeros. all-point meanPairwiseDeltaE76 remains a separate descriptive dispersion measure.",
            "energy": "Energy76-U is the formal estimator: 2*cross mean minus the two off-diagonal U-statistic within-group means. Energy76-V retains the old diagonal-including estimator as a labelled legacy sensitivity result.",
            "ot": "Equal-weight raw-point OT76; equal n solved by linear assignment, unequal n by scipy multidimensional Wasserstein LP.",
            "bootstrap": f"{bootstrap_iterations} participant/run-level resamples with replacement; every selected unit contributes all of its emotion rows. Each source is sampled once per replicate, so the same AI draw is shared across Human contrasts and the same Human draw is shared across AI contrasts.",
            "observedDistance": "For each AI-Human pair and metric, observed distance is the arithmetic mean of the 20 emotion-specific distances computed from the original, unresampled data.",
            "bootstrapLocation": "bootstrap_mean and bootstrap_median summarize the replicate-level overall distance (or paired distance difference); percentile CI is the 2.5th and 97.5th percentiles of that same replicate statistic. Observed and bootstrap centers may differ because of finite-sample bootstrap bias and Assignment downsampling.",
            "pairwiseSign": "Delta is always D(A)-D(B). Delta<0 means A has the lower distance; Delta>0 means B has the lower distance.",
            "formalInference": f"Human-group labels are permuted as whole participant/run blocks while AI data remain fixed. Two-sided p=(1+count(|delta_perm|>=|delta_observed|))/(B+1), B={permutation_iterations}.",
            "holmFamilies": "Holm correction is applied separately to each fixed AI x formal metric family of six Human contrasts. Fixed-Human AI comparisons are descriptive only and receive no p-value.",
            "bootstrapRole": "Participant/run bootstrap output is retained only as estimation-stability and bias diagnostics. Its percentile interval and sign count are not the official Human-pair significance test.",
            "legacyInference": "Old bootstrap pairwise inference and Energy76-V are retained under explicitly named legacy fields; they are not official inferential results.",
            "compactLetters": "Exact non-significance clique cover: groups sharing a letter were not significantly different after Holm correction; significant pairs never share a letter.",
            "assignment76Ot76": "Assignment76 and OT76 are identical only for equal sample sizes under the same linear assignment. They are retained as an algorithm sanity check and are not treated as two independent significance outcomes.",
            "dependency": "CIEDE2000 uses scikit-image 0.24.0; no new Python dependency installed.",
        },
    }


def render_continuous_distance_figure(payload: dict[str, Any]) -> bytes:
    result = payload.get("result", {}); kind = str(payload.get("kind", "heatmap")); metric = str(payload.get("metric", "MICD00")); image_format = str(payload.get("format", "png")).lower()
    plt.rcParams.update({"font.family": "Times New Roman", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "figure.facecolor": "white", "axes.facecolor": "white"})
    if kind == "heatmap":
        sources = result["sources"]; rows = result["distanceLong"]
        values = np.full((len(sources), len(sources)), np.nan)
        for ri, a in enumerate(sources):
            for ci, b in enumerate(sources):
                matches = [row["distance"] for row in rows if row["metric"] == metric and row["direction"] == "symmetric" and row["group_a"] == a and row["group_b"] == b]
                if matches: values[ri, ci] = float(np.mean(matches))
        fig, axis = plt.subplots(figsize=(8.2, 7.2)); image = axis.imshow(values, cmap="viridis")
        axis.set_xticks(range(len(sources)), sources, rotation=35, ha="right"); axis.set_yticks(range(len(sources)), sources); axis.set_title(f"Overall {metric} Distance", fontweight="bold")
        for i in range(len(sources)):
            for j in range(len(sources)):
                if np.isfinite(values[i, j]): axis.text(j, i, f"{values[i,j]:.2f}", ha="center", va="center", color="white" if values[i,j] > np.nanmean(values) else "black", fontsize=8)
        fig.colorbar(image, ax=axis, label="Distance")
    elif kind == "ai-human":
        rows = [row for row in result["ranking"] if row["metric"] == metric]; ais = result["aiSources"]; humans = result["humanSources"]
        fig, axes = plt.subplots(1, len(ais), figsize=(4 * len(ais), 4.2), sharey=True, squeeze=False)
        for axis, ai in zip(axes[0], ais):
            subset = {row["human_group"]: row for row in rows if row["ai_group"] == ai}; y = [subset[h]["mean_distance"] for h in humans]
            low = [0 if subset[h]["ci_low"] is None else y[i] - subset[h]["ci_low"] for i,h in enumerate(humans)]; high = [0 if subset[h]["ci_high"] is None else subset[h]["ci_high"] - y[i] for i,h in enumerate(humans)]
            axis.errorbar(humans, y, yerr=[low,high], fmt="o", capsize=4, color="#287b92"); axis.set_title(ai, fontweight="bold"); axis.tick_params(axis="x", rotation=35); axis.grid(axis="y", alpha=.2)
        axes[0,0].set_ylabel("Distance"); fig.suptitle(f"AI to Human Distance: {metric}", fontweight="bold")
    elif kind == "formal-observed-significance":
        ais, humans = result["aiSources"], result["humanSources"]
        rows = [row for row in result.get("formalPairwiseLetters", []) if row["metric"] == metric]
        fig, axes = plt.subplots(2, 2, figsize=(10.5, 8.2), sharey=True, squeeze=False)
        for axis, ai in zip(axes.flat, ais):
            lookup = {row["human_group"]: row for row in rows if row["ai_group"] == ai}
            values = [lookup.get(human, {}).get("observed_distance") for human in humans]
            finite = [float(value) for value in values if value is not None and np.isfinite(value)]
            axis.scatter(range(len(humans)), values, s=52, color="#287b92", edgecolor="white", linewidth=1.2, zorder=3)
            axis.set_xticks(range(len(humans)), humans); axis.set_title(ai, fontweight="bold"); axis.grid(axis="y", alpha=.2)
            offset = max(.03, (max(finite) - min(finite)) * .08) if finite else .1
            for index, human in enumerate(humans):
                item = lookup.get(human, {}); value = item.get("observed_distance")
                if value is not None: axis.text(index, float(value) + offset, str(item.get("letters", "")), ha="center", fontweight="bold")
        axes[0, 0].set_ylabel("Observed distance"); axes[1, 0].set_ylabel("Observed distance")
        fig.suptitle(f"Observed Human Distances within Each AI: {metric}\nGroups sharing a letter are not different after Holm correction", fontweight="bold")
    elif kind == "formal-pairwise-effect":
        ais, humans = result["aiSources"], result["humanSources"]
        rows = [row for row in result.get("formalPairwiseMatrices", []) if row["metric"] == metric]
        finite = [abs(float(row["delta_observed"])) for row in rows if row.get("delta_observed") is not None]
        limit = max(finite or [1.0])
        fig, axes = plt.subplots(2, 2, figsize=(10.5, 9.0), squeeze=False)
        for axis, ai in zip(axes.flat, ais):
            values = np.full((len(humans), len(humans)), np.nan); labels = [["" for _ in humans] for _ in humans]
            for ri, row_group in enumerate(humans):
                for ci, column_group in enumerate(humans):
                    item = next((row for row in rows if row["ai_group"] == ai and row["row_group"] == row_group and row["column_group"] == column_group), None)
                    if not item or ri == ci: continue
                    values[ri, ci] = float(item["delta_observed"])
                    p = item.get("p_holm"); p_text = "<.001" if p is not None and p < .001 else f"{p:.3f}" if p is not None else "—"
                    labels[ri][ci] = f'{values[ri,ci]:+.2f}\nHolm p={p_text}'
            axis.imshow(values, vmin=-limit, vmax=limit, cmap="RdBu_r")
            for ri in range(len(humans)):
                for ci in range(len(humans)):
                    item = next((row for row in rows if row["ai_group"] == ai and row["row_group"] == humans[ri] and row["column_group"] == humans[ci]), None)
                    if ri == ci: axis.text(ci, ri, "—", ha="center", va="center")
                    elif item:
                        if not item.get("significant_holm"): axis.add_patch(matplotlib.patches.Rectangle((ci-.48, ri-.48), .96, .96, facecolor="white", edgecolor="#d5dcda", lw=1.0))
                        axis.text(ci, ri, labels[ri][ci], ha="center", va="center", fontsize=7)
            axis.set_xticks(range(len(humans)), humans); axis.set_yticks(range(len(humans)), humans); axis.set_title(ai, fontweight="bold")
        fig.suptitle(f"Human Pairwise Effects: {metric}\nWhite cells: not significant after Holm correction", fontweight="bold")
    elif kind == "formal-robustness":
        rows = result.get("formalMetricRobustness", []); ais, humans = result["aiSources"], result["humanSources"]
        pairs = list(combinations(humans, 2)); categories = ["same_direction_no_significance", "same_direction_partial_significance", "same_direction_all_significant", "opposite_direction"]
        colors = ["#edf0ef", "#d9a25f", "#4b9b83", "#c65f5f"]; values = np.full((len(ais), len(pairs)), np.nan)
        for ri, ai in enumerate(ais):
            for ci, pair in enumerate(pairs):
                item = next((row for row in rows if row["ai_group"] == ai and (row["human_a"], row["human_b"]) == pair), None)
                if item: values[ri, ci] = categories.index(item["category"])
        fig, axis = plt.subplots(figsize=(10.5, 4.8)); axis.imshow(values, vmin=0, vmax=len(categories)-1, cmap=matplotlib.colors.ListedColormap(colors), aspect="auto")
        axis.set_xticks(range(len(pairs)), [f"{a} vs {b}" for a, b in pairs], rotation=30, ha="right"); axis.set_yticks(range(len(ais)), ais); axis.set_title("Cross-metric Robustness of Human Contrasts", fontweight="bold")
        handles = [plt.Line2D([0], [0], marker="s", linestyle="", color=color, label=label.replace("_", " ")) for color, label in zip(colors, categories)]
        fig.legend(handles=handles, loc="lower center", ncol=2, frameon=False, fontsize=8); fig.subplots_adjust(bottom=.25)
    elif kind == "pairwise-human-matrix":
        ais, humans = result["aiSources"], result["humanSources"]
        matrix_rows = result.get("pairwiseSignificanceMatrices", [])
        fig, axes = plt.subplots(2, 2, figsize=(10.5, 9.2), squeeze=False)
        for axis, ai in zip(axes.flat, ais):
            values = np.zeros((len(humans), len(humans))); labels = [["" for _ in humans] for _ in humans]
            for ri, row_group in enumerate(humans):
                for ci, column_group in enumerate(humans):
                    item = next((row for row in matrix_rows if row["comparison_type"] == "fixed_ai" and row["fixed_group"] == ai and row["metric"] == metric and row["row_group"] == row_group and row["column_group"] == column_group), None)
                    if item and ri != ci:
                        values[ri, ci] = 1 if item["significant_holm"] else .25
                        p = item.get("p_holm"); p_text = "<.001" if p is not None and p < .001 else f"{p:.3f}" if p is not None else "—"
                        labels[ri][ci] = f'{item["label"]}\np={p_text}'
            axis.imshow(values, vmin=0, vmax=1, cmap=matplotlib.colors.ListedColormap(["#f5f6f5", "#e9efed", "#dcefeb", "#8bc3b5"]))
            axis.set_xticks(range(len(humans)), humans); axis.set_yticks(range(len(humans)), humans); axis.set_title(ai, fontweight="bold")
            for ri in range(len(humans)):
                for ci in range(len(humans)): axis.text(ci, ri, labels[ri][ci] if ri != ci else "—", ha="center", va="center", fontsize=7)
        fig.suptitle(f"Human Pairwise Significance: {metric} (Holm-adjusted)", fontweight="bold")
    elif kind in {"pairwise-human-ci", "pairwise-ai-ci"}:
        fixed_type = "fixed_ai" if kind == "pairwise-human-ci" else "fixed_human"
        fixed_groups = result["aiSources"] if fixed_type == "fixed_ai" else result["humanSources"]
        compared_groups = result["humanSources"] if fixed_type == "fixed_ai" else result["aiSources"]
        letters = result.get("pairwiseLetters", [])
        fig, axes = plt.subplots(2, 2, figsize=(11, 8.5), sharey=True, squeeze=False)
        for axis, fixed in zip(axes.flat, fixed_groups):
            subset = [row for row in letters if row["comparison_type"] == fixed_type and row["fixed_group"] == fixed and row["metric"] == metric]
            lookup = {row["group"]: row for row in subset}; y = [lookup[group]["distance"] for group in compared_groups]
            ci_low = [y[index] if lookup[group]["ci_low"] is None else lookup[group]["ci_low"] for index, group in enumerate(compared_groups)]
            ci_high = [y[index] if lookup[group]["ci_high"] is None else lookup[group]["ci_high"] for index, group in enumerate(compared_groups)]
            axis.vlines(range(len(compared_groups)), ci_low, ci_high, color="#287b92", lw=1.4); axis.scatter(range(len(compared_groups)), y, color="#287b92", zorder=3)
            axis.set_xticks(range(len(compared_groups)), compared_groups, rotation=30, ha="right"); axis.set_title(fixed, fontweight="bold"); axis.grid(axis="y", alpha=.2)
            top = max(ci_high + y); bottom = min(ci_low + y); offset = max(.02, (top - bottom) * .08)
            for index, group in enumerate(compared_groups): axis.text(index, max(y[index], ci_high[index]) + offset, str(lookup[group]["letters"]), ha="center", va="bottom", fontweight="bold")
        axes[0,0].set_ylabel("Distance"); axes[1,0].set_ylabel("Distance")
        fig.suptitle(("Human distances within each AI" if fixed_type == "fixed_ai" else "AI distances within each Human group") + f": {metric}", fontweight="bold")
    elif kind == "pairwise-robustness":
        rows = result.get("metricRobustness", []); categories = ["same_direction_both_nonsignificant", "same_direction_assignment_only", "same_direction_energy_only", "same_direction_both_significant", "opposite_direction"]
        colors = ["#edf0ef", "#7ca6bf", "#d9a25f", "#4b9b83", "#c65f5f"]
        fig, axes = plt.subplots(2, 1, figsize=(12, 7.5), squeeze=False)
        for axis, comparison_type, title in zip(axes.flat, ["fixed_ai", "fixed_human"], ["Fixed AI: Human contrasts", "Fixed Human: AI contrasts"]):
            subset = [row for row in rows if row["comparison_type"] == comparison_type]; fixed = result["aiSources"] if comparison_type == "fixed_ai" else result["humanSources"]
            contrast_pairs = list(dict.fromkeys((row["group_a"], row["group_b"]) for row in subset)); values = np.full((len(fixed), len(contrast_pairs)), np.nan)
            for ri, fixed_group in enumerate(fixed):
                for ci, pair in enumerate(contrast_pairs):
                    item = next((row for row in subset if row["fixed_group"] == fixed_group and (row["group_a"], row["group_b"]) == pair), None)
                    if item: values[ri, ci] = categories.index(item["category"])
            axis.imshow(values, vmin=0, vmax=len(categories)-1, cmap=matplotlib.colors.ListedColormap(colors), aspect="auto")
            axis.set_xticks(range(len(contrast_pairs)), [f"{a} vs {b}" for a,b in contrast_pairs], rotation=30, ha="right"); axis.set_yticks(range(len(fixed)), fixed); axis.set_title(title, fontweight="bold")
        handles = [plt.Line2D([0],[0],marker="s",linestyle="",color=color,label=label.replace("_"," ")) for color,label in zip(colors,categories)]
        fig.legend(handles=handles, loc="lower center", ncol=3, frameon=False, fontsize=8); fig.suptitle("Assignment00 vs Energy76 Pairwise Robustness", fontweight="bold"); fig.subplots_adjust(bottom=.19)
    elif kind == "asymmetry":
        rows = [row for row in result["asymmetry"] if row["metric"] == metric]; fig, axis = plt.subplots(figsize=(6.8, 6.2))
        for ai in result["aiSources"]:
            subset = [row for row in rows if row["ai_group"] == ai]; axis.scatter([r["ai_to_human"] for r in subset], [r["human_to_ai"] for r in subset], s=24, alpha=.65, label=ai)
        maximum = max([max(row["ai_to_human"], row["human_to_ai"]) for row in rows] or [1]); axis.plot([0,maximum],[0,maximum],"--",color="#888",lw=1); axis.set_xlabel("AI to Human MICD"); axis.set_ylabel("Human to AI MICD"); axis.set_title(f"Directional Asymmetry: {metric}",fontweight="bold"); axis.legend(frameon=False)
    elif kind == "within":
        rows = result.get("withinMetricDistances", []); sources = result["sources"]; emotions = result["emotions"]; values = np.asarray([[next((r["mean"] for r in rows if r["group"] == s and r["emotion"] == e and r["metric"] == metric), np.nan) for e in emotions] for s in sources])
        fig, axis = plt.subplots(figsize=(13, 5.2)); image=axis.imshow(values,aspect="auto",cmap="magma"); axis.set_xticks(range(len(emotions)),emotions,rotation=45,ha="right"); axis.set_yticks(range(len(sources)),sources); axis.set_title(f"Within-group Split-half Distance: {metric}",fontweight="bold"); fig.colorbar(image,ax=axis,label=f"Split-half {metric} distance")
    else:
        values=np.asarray(result["metricAgreementMatrix"],dtype=float); metrics=result["metrics"]; fig,axis=plt.subplots(figsize=(7.2,6.2)); image=axis.imshow(values,vmin=-1,vmax=1,cmap="coolwarm"); axis.set_xticks(range(len(metrics)),metrics,rotation=35,ha="right"); axis.set_yticks(range(len(metrics)),metrics); axis.set_title("Metric Agreement (Spearman)",fontweight="bold"); fig.colorbar(image,ax=axis,label="Spearman rho")
    fig.tight_layout(); output=BytesIO(); fig.savefig(output,format=image_format,dpi=300 if image_format=="png" else None,bbox_inches="tight",facecolor="white"); plt.close(fig); return output.getvalue()
