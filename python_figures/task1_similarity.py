"""Multi-level Human–AI similarity analysis for free-colour selections."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable

import numpy as np
from scipy.spatial import ConvexHull, QhullError, distance
from scipy.stats import wasserstein_distance_nd
from sklearn.cluster import DBSCAN, KMeans
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, f1_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC


EMOTIONS = [
    "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
    "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
]
HUMAN_ORDER = ["CN", "BW", "UK", "US"]
AI_ORDER = ["DeepSeek", "Doubao", "GPT", "Gemini"]
RANDOM_STATE = 20260814


class SimilarityAnalysisCancelled(RuntimeError):
    pass


def _report(progress: Callable[[str, int, int], None] | None, stage: str, completed: int, total: int) -> None:
    if progress:
        progress(stage, completed, total)


def _check_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled and cancelled():
        raise SimilarityAnalysisCancelled("多层相似性分析已由用户取消。")


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
            if np.isfinite(value):
                return value
        except (TypeError, ValueError):
            pass
    return float("nan")


def _canonical_source(value: str) -> str:
    aliases = {"cn": "CN", "bw": "BW", "uk": "UK", "us": "US", "deepseek": "DeepSeek", "doubao": "Doubao", "gpt": "GPT", "gemini": "Gemini"}
    return aliases.get(value.strip().lower(), value.strip())


def prepare_similarity_data(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    prepared: list[dict[str, Any]] = []
    missing_units: set[str] = set()
    for index, row in enumerate(rows):
        source = _canonical_source(_text(row, "source", "来源"))
        cohort = _text(row, "cohort", "组类型").lower()
        emotion = _text(row, "emotion", "情绪")
        if not source or cohort not in {"human", "ai"} or emotion not in EMOTIONS:
            continue
        lab = np.asarray([_number(row, "labL", "L_Lab"), _number(row, "labA", "a_Lab"), _number(row, "labB", "b_Lab")], dtype=float)
        hsv = np.asarray([_number(row, "hsvH", "H_HSV"), _number(row, "hsvS", "S_HSV"), _number(row, "hsvV", "V_HSV")], dtype=float)
        if not np.all(np.isfinite(lab)) or not np.all(np.isfinite(hsv)):
            continue
        participant, run = _text(row, "participant", "participant_id"), _text(row, "run", "run_id")
        unit = participant if cohort == "human" else run
        if not unit:
            missing_units.add(source)
            unit = f"missing-{index}"
        chroma = float(np.hypot(lab[1], lab[2]))
        lch_h = float((np.degrees(np.arctan2(lab[2], lab[1])) + 360) % 360)
        hsv_h = float(hsv[0] % 360)
        prepared.append({
            "source": source, "cohort": cohort, "emotion": emotion, "unit": unit,
            "L": float(lab[0]), "a": float(lab[1]), "b": float(lab[2]), "C": chroma, "lchH": lch_h,
            "hsvH": hsv_h, "hsvS": float(hsv[1]), "hsvV": float(hsv[2]),
            "lchSin": float(np.sin(np.deg2rad(lch_h))), "lchCos": float(np.cos(np.deg2rad(lch_h))),
            "hueSin": float(np.sin(np.deg2rad(hsv_h))), "hueCos": float(np.cos(np.deg2rad(hsv_h))),
        })
    if not prepared:
        raise ValueError("未识别到包含来源、组类型、情绪和连续颜色坐标的实验一数据。")
    sources = [source for source in HUMAN_ORDER + AI_ORDER if any(row["source"] == source for row in prepared)]
    sources += sorted({row["source"] for row in prepared} - set(sources))
    return prepared, sources, sorted(missing_units)


def _group_rows(rows: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(row["source"], row["emotion"])].append(row)
    return grouped


def _hue_entropy(group: list[dict[str, Any]], bins: int = 36) -> tuple[float, float, int]:
    hue = np.asarray([row["hsvH"] for row in group if row["hsvS"] > .01], dtype=float)
    counts, _ = np.histogram(hue, bins=np.linspace(0, 360, bins + 1))
    probabilities = counts[counts > 0] / max(1, counts.sum())
    entropy = float(-np.sum(probabilities * np.log2(probabilities))) if len(probabilities) else 0.0
    return entropy, entropy / np.log2(bins), int(len(hue))


def _convex_hull_area(group: list[dict[str, Any]]) -> float | None:
    points = np.unique(np.asarray([[row["a"], row["b"]] for row in group], dtype=float), axis=0)
    if len(points) < 3:
        return None
    try:
        return float(ConvexHull(points).volume)
    except QhullError:
        return None


def _largest_cluster(group: list[dict[str, Any]], k: int = 3) -> float:
    points = np.asarray([[row["L"], row["a"], row["b"]] for row in group], dtype=float)
    unique = np.unique(points, axis=0)
    clusters = max(1, min(k, len(points), len(unique)))
    labels = KMeans(n_clusters=clusters, random_state=RANDOM_STATE, n_init=10).fit_predict(points)
    return float(max(np.bincount(labels)) / len(labels))


def distribution_statistics(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for (source, emotion), group in _group_rows(rows).items():
        lab = np.asarray([[row["L"], row["a"], row["b"]] for row in group], dtype=float)
        hue_entropy, normalized_entropy, chromatic_n = _hue_entropy(group)
        pairwise = distance.pdist(lab, metric="euclidean")
        values = {key: np.asarray([row[key] for row in group], dtype=float) for key in ("L", "C", "lchH")}
        radians = np.deg2rad(values["lchH"])
        resultant = float(np.hypot(np.mean(np.sin(radians)), np.mean(np.cos(radians))))
        output.append({
            "source": source, "cohort": group[0]["cohort"], "emotion": emotion, "n": len(group), "chromaticN": chromatic_n,
            "LMean": float(np.mean(values["L"])), "LMedian": float(np.median(values["L"])), "LSD": float(np.std(values["L"], ddof=1)) if len(group) > 1 else 0.0,
            "LQuantile025": float(np.quantile(values["L"], .025)), "LQuantile975": float(np.quantile(values["L"], .975)),
            "CMean": float(np.mean(values["C"])), "CMedian": float(np.median(values["C"])), "CSD": float(np.std(values["C"], ddof=1)) if len(group) > 1 else 0.0,
            "CQuantile025": float(np.quantile(values["C"], .025)), "CQuantile975": float(np.quantile(values["C"], .975)),
            "hCircularMean": float((np.degrees(np.arctan2(np.mean(np.sin(radians)), np.mean(np.cos(radians)))) + 360) % 360),
            "hCircularVariance": 1 - resultant,
            "hCircularSDDegrees": float(np.degrees(np.sqrt(max(0.0, -2 * np.log(max(resultant, 1e-12)))))) if resultant > 0 else 180.0,
            "hueEntropyBits": hue_entropy, "normalizedEntropy": normalized_entropy,
            "convexHullAreaAB": _convex_hull_area(group),
            "withinMeanPairwiseDeltaE76": float(np.mean(pairwise)) if len(pairwise) else None,
            "largestClusterProportion": _largest_cluster(group),
        })
    return output


def _radius_region(points: np.ndarray, quantile: float = .95) -> tuple[np.ndarray, float]:
    center = np.mean(points, axis=0)
    radius = float(np.quantile(np.linalg.norm(points - center, axis=1), quantile)) if len(points) > 1 else 0.0
    return center, max(radius, 1e-8)


def _dominant_regions(group: list[dict[str, Any]], k: int) -> dict[str, Any]:
    points = np.asarray([[row["L"], row["a"], row["b"]] for row in group], dtype=float)
    unique = np.unique(points, axis=0)
    clusters = max(1, min(k, len(points), len(unique)))
    labels = KMeans(n_clusters=clusters, random_state=RANDOM_STATE, n_init=10).fit_predict(points)
    dominant = int(np.argmax(np.bincount(labels)))
    k_points = points[labels == dominant]
    k_center, k_radius = _radius_region(k_points)

    min_samples = max(4, min(10, int(round(np.sqrt(len(points))))))
    db_center = db_radius = None
    db_size = 0
    if len(points) >= min_samples:
        neighbours = NearestNeighbors(n_neighbors=min(min_samples, len(points))).fit(points)
        distances, _ = neighbours.kneighbors(points)
        eps = max(2.3, float(np.quantile(distances[:, -1], .65)))
        db_labels = DBSCAN(eps=eps, min_samples=min_samples).fit_predict(points)
        valid = db_labels[db_labels >= 0]
        if len(valid):
            db_dominant = int(np.argmax(np.bincount(valid)))
            db_points = points[db_labels == db_dominant]
            db_center, db_radius = _radius_region(db_points)
            db_size = len(db_points)
    return {"kCenter": k_center, "kRadius": k_radius, "kSize": len(k_points), "dbCenter": db_center, "dbRadius": db_radius, "dbSize": db_size, "n": len(points)}


def dominant_region_capture(rows: list[dict[str, Any]], humans: list[str], ais: list[str], k: int) -> tuple[list[dict[str, Any]], list[list[float | None]]]:
    grouped = _group_rows(rows)
    output: list[dict[str, Any]] = []
    for ai in ais:
        for human in humans:
            for emotion in EMOTIONS:
                human_group, ai_group = grouped.get((human, emotion), []), grouped.get((ai, emotion), [])
                if not human_group or not ai_group:
                    continue
                regions = _dominant_regions(human_group, k)
                points = np.asarray([[row["L"], row["a"], row["b"]] for row in ai_group], dtype=float)
                k_coverage = float(np.mean(np.linalg.norm(points - regions["kCenter"], axis=1) <= regions["kRadius"]))
                db_coverage = None if regions["dbCenter"] is None else float(np.mean(np.linalg.norm(points - regions["dbCenter"], axis=1) <= regions["dbRadius"]))
                consensus = k_coverage if db_coverage is None else (k_coverage + db_coverage) / 2
                output.append({"ai": ai, "country": human, "emotion": emotion, "aiN": len(ai_group), "humanN": len(human_group), "kmeansCoverage": k_coverage, "dbscanCoverage": db_coverage, "consensusCoverage": consensus, "humanKmeansDominantN": regions["kSize"], "humanDbscanDominantN": regions["dbSize"]})
    matrix = [[_mean([row["consensusCoverage"] for row in output if row["ai"] == ai and row["country"] == human]) for human in humans] for ai in ais]
    return output, matrix


def _mean(values: list[float | None]) -> float | None:
    finite = [float(value) for value in values if value is not None and np.isfinite(value)]
    return float(np.mean(finite)) if finite else None


def _binned_distribution(group: list[dict[str, Any]], bins: int) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray([[row["L"], row["a"], row["b"]] for row in group], dtype=float)
    ranges = [(0, 100), (-128, 128), (-128, 128)]
    histogram, edges = np.histogramdd(values, bins=(bins, bins, bins), range=ranges)
    indexes = np.argwhere(histogram > 0)
    centers = np.column_stack([(edges[axis][indexes[:, axis]] + edges[axis][indexes[:, axis] + 1]) / 2 for axis in range(3)])
    weights = histogram[tuple(indexes.T)].astype(float)
    weights /= weights.sum()
    return centers, weights


def distribution_distances(rows: list[dict[str, Any]], humans: list[str], ais: list[str], bin_sizes: list[int]) -> tuple[list[dict[str, Any]], list[list[float | None]], list[list[float | None]]]:
    grouped = _group_rows(rows)
    cache: dict[tuple[str, str, int], tuple[np.ndarray, np.ndarray]] = {}
    output: list[dict[str, Any]] = []
    for bins in bin_sizes:
        for ai in ais:
            for human in humans:
                for emotion in EMOTIONS:
                    human_group, ai_group = grouped.get((human, emotion), []), grouped.get((ai, emotion), [])
                    if not human_group or not ai_group:
                        continue
                    for source, group in ((human, human_group), (ai, ai_group)):
                        cache.setdefault((source, emotion, bins), _binned_distribution(group, bins))
                    human_centers, human_weights = cache[(human, emotion, bins)]
                    ai_centers, ai_weights = cache[(ai, emotion, bins)]
                    emd = float(wasserstein_distance_nd(human_centers, ai_centers, human_weights, ai_weights))
                    # JSD requires a shared vector over all fixed bins.
                    human_map = {tuple(center): weight for center, weight in zip(human_centers, human_weights)}
                    ai_map = {tuple(center): weight for center, weight in zip(ai_centers, ai_weights)}
                    keys = sorted(set(human_map) | set(ai_map))
                    p = np.asarray([human_map.get(key, 0.0) for key in keys]); q = np.asarray([ai_map.get(key, 0.0) for key in keys])
                    jsd = float(distance.jensenshannon(p, q, base=2.0))
                    output.append({"binsPerAxis": bins, "ai": ai, "country": human, "emotion": emotion, "emdDeltaE76": emd, "jsdDistance": jsd, "humanOccupiedBins": len(human_centers), "aiOccupiedBins": len(ai_centers)})
    primary = 8 if 8 in bin_sizes else bin_sizes[0]
    emd_matrix = [[_mean([row["emdDeltaE76"] for row in output if row["binsPerAxis"] == primary and row["ai"] == ai and row["country"] == human]) for human in humans] for ai in ais]
    jsd_matrix = [[_mean([row["jsdDistance"] for row in output if row["binsPerAxis"] == primary and row["ai"] == ai and row["country"] == human]) for human in humans] for ai in ais]
    return output, emd_matrix, jsd_matrix


def _features(rows: list[dict[str, Any]]) -> np.ndarray:
    result = []
    for row in rows:
        one_hot = [1.0 if row["emotion"] == emotion else 0.0 for emotion in EMOTIONS]
        # Circular hue angles enter the classifier only through sin/cos to
        # avoid an artificial discontinuity between 359° and 0°.
        result.append(one_hot + [row["L"], row["a"], row["b"], row["C"], row["lchSin"], row["lchCos"], row["hsvS"], row["hsvV"], row["hueSin"], row["hueCos"]])
    return np.asarray(result, dtype=float)


def _classifier_model() -> Pipeline:
    return Pipeline([
        ("scale", StandardScaler()),
        ("svc", SVC(kernel="rbf", C=1.0, gamma="scale", class_weight="balanced", random_state=RANDOM_STATE)),
    ])


def _oof_binary_metrics(pair: list[dict[str, Any]], ai: str, requested_folds: int, seed: int) -> dict[str, Any]:
    """Fit one leakage-safe binary classifier and return row-level OOF metrics."""
    if not pair:
        return {"auc": None, "balancedAccuracy": None, "macroF1": None, "folds": 0, "error": "无可用数据"}
    y = np.asarray([1 if row["source"] == ai else 0 for row in pair], dtype=int)
    groups = np.asarray([f'{row["source"]}:{row["unit"]}' for row in pair])
    units_per_class = [len(np.unique(groups[y == label])) for label in (0, 1)]
    folds = min(requested_folds, *units_per_class)
    if folds < 2:
        return {"auc": None, "balancedAccuracy": None, "macroF1": None, "folds": folds, "error": "每类独立 participant/run 少于2"}
    X = _features(pair)
    scores = None
    last_error = "无法构造同时包含两类的 Group-CV fold"
    for candidate_folds in range(folds, 1, -1):
        try:
            splitter = StratifiedGroupKFold(n_splits=candidate_folds, shuffle=True, random_state=seed)
            scores = cross_val_predict(_classifier_model(), X, y, groups=groups, cv=splitter, method="decision_function", n_jobs=-1)
            folds = candidate_folds
            break
        except ValueError as error:
            last_error = str(error)
    if scores is None:
        return {"auc": None, "balancedAccuracy": None, "macroF1": None, "folds": 0, "error": last_error}
    predictions = (scores >= 0).astype(int)
    return {
        "auc": float(roc_auc_score(y, scores)),
        "balancedAccuracy": float(balanced_accuracy_score(y, predictions)),
        "macroF1": float(f1_score(y, predictions, average="macro", zero_division=0)),
        "folds": folds, "humanUnits": units_per_class[0], "aiUnits": units_per_class[1], "error": "",
    }


def _unit_map(rows: list[dict[str, Any]], source: str, complete_only: bool = False) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row["source"] == source:
            result[row["unit"]].append(row)
    if complete_only:
        result = {unit: unit_rows for unit, unit_rows in result.items() if {row["emotion"] for row in unit_rows} == set(EMOTIONS)}
    return result


def _sample_units(unit_rows: dict[str, list[dict[str, Any]]], indexes: np.ndarray) -> list[dict[str, Any]]:
    units = list(unit_rows)
    # Duplicate draws retain their original group ID, so identical copies can
    # never be split between training and testing folds.
    return [row for index in indexes for row in unit_rows[units[int(index)]]]


def _percentile_interval(values: list[float]) -> tuple[float | None, float | None]:
    finite = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    if not len(finite):
        return None, None
    return float(np.quantile(finite, .025)), float(np.quantile(finite, .975))


def group_level_auc_inference(
    rows: list[dict[str, Any]], humans: list[str], ais: list[str], requested_folds: int,
    iterations: int, missing_units: list[str], progress: Callable[[str, int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None, observed_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Cluster bootstrap and group-label permutation inference for pairwise AUC."""
    pair_summaries: list[dict[str, Any]] = []
    bootstrap_samples: list[dict[str, Any]] = []
    permutation_samples: list[dict[str, Any]] = []
    delta_summaries: list[dict[str, Any]] = []
    closest_stability: list[dict[str, Any]] = []
    closest_draws: list[dict[str, Any]] = []
    complete_maps = {source: _unit_map(rows, source, complete_only=True) for source in humans + ais}
    observed: dict[tuple[str, str], float | None] = {}
    bootstrap_by_pair: dict[tuple[str, str], list[float | None]] = {}
    work_total = len(ais) * len(humans) * (1 + 2 * iterations)
    work_done = 0
    _report(progress, "AUC：观察值、Bootstrap 与置换", 0, work_total)

    for ai_index, ai in enumerate(ais):
        ai_units = complete_maps[ai] if ai not in missing_units else {}
        # The same AI run draw is reused across countries within an iteration,
        # making country contrasts paired on the AI side.
        ai_draws: list[np.ndarray] = []
        if ai_units:
            rng_ai = np.random.default_rng(RANDOM_STATE + 100_000 * (ai_index + 1))
            ai_draws = [rng_ai.integers(0, len(ai_units), size=len(ai_units)) for _ in range(iterations)]

        for human_index, human in enumerate(humans):
            _check_cancelled(cancelled)
            human_units = complete_maps[human] if human not in missing_units else {}
            key = (ai, human)
            if len(ai_units) < 2 or len(human_units) < 2:
                pair_summaries.append({
                    "ai": ai, "country": human, "auc": None, "ciLow": None, "ciHigh": None,
                    "permutationP": None, "significantAboveChance": None, "bootstrapValid": 0,
                    "permutationValid": 0, "humanUnits": len(human_units), "aiUnits": len(ai_units),
                    "excludedIncompleteHumanUnits": len(_unit_map(rows, human)) - len(human_units),
                    "excludedIncompleteAiUnits": len(_unit_map(rows, ai)) - len(ai_units),
                    "error": "完整的20情绪 participant/run 每类少于2",
                })
                observed[key] = None
                bootstrap_by_pair[key] = [None] * iterations
                work_done += 1 + 2 * iterations
                _report(progress, "AUC：观察值、Bootstrap 与置换", work_done, work_total)
                continue

            cached_observed = next((row for row in (observed_rows or []) if row.get("ai") == ai and row.get("country") == human), None)
            if cached_observed is None:
                original_pair = [row for unit_rows in human_units.values() for row in unit_rows] + [row for unit_rows in ai_units.values() for row in unit_rows]
                observed_auc = _oof_binary_metrics(original_pair, ai, requested_folds, RANDOM_STATE + ai_index * 101 + human_index)["auc"]
            else:
                observed_auc = cached_observed.get("auc")
            observed[key] = observed_auc
            work_done += 1
            _report(progress, "AUC：观察值、Bootstrap 与置换", work_done, work_total)

            rng_human = np.random.default_rng(RANDOM_STATE + 1_000_000 + ai_index * 10_000 + human_index * 100)
            pair_bootstrap: list[float | None] = []
            for iteration in range(iterations):
                _check_cancelled(cancelled)
                human_indexes = rng_human.integers(0, len(human_units), size=len(human_units))
                sampled = _sample_units(human_units, human_indexes) + _sample_units(ai_units, ai_draws[iteration])
                metrics = _oof_binary_metrics(sampled, ai, requested_folds, RANDOM_STATE + 2_000_000 + ai_index * iterations * len(humans) + human_index * iterations + iteration)
                auc = metrics["auc"]
                pair_bootstrap.append(auc)
                bootstrap_samples.append({"iteration": iteration + 1, "ai": ai, "country": human, "auc": auc})
                work_done += 1
                _report(progress, "AUC：观察值、Bootstrap 与置换", work_done, work_total)
            bootstrap_by_pair[key] = pair_bootstrap

            # Shuffle the binary label between complete participant/run units;
            # all 20 emotion rows of a unit always move together.
            all_units = [(human, unit, unit_rows) for unit, unit_rows in human_units.items()] + [(ai, unit, unit_rows) for unit, unit_rows in ai_units.items()]
            labels = np.asarray([0] * len(human_units) + [1] * len(ai_units), dtype=int)
            rng_perm = np.random.default_rng(RANDOM_STATE + 3_000_000 + ai_index * 10_000 + human_index * 100)
            null_values: list[float] = []
            for iteration in range(iterations):
                _check_cancelled(cancelled)
                permuted_labels = rng_perm.permutation(labels)
                permuted_pair: list[dict[str, Any]] = []
                for unit_index, (_, unit, unit_rows) in enumerate(all_units):
                    pseudo_source = ai if permuted_labels[unit_index] == 1 else human
                    permuted_pair.extend({**row, "source": pseudo_source, "unit": f"perm:{unit_index}:{unit}"} for row in unit_rows)
                metrics = _oof_binary_metrics(permuted_pair, ai, requested_folds, RANDOM_STATE + 4_000_000 + ai_index * iterations * len(humans) + human_index * iterations + iteration)
                if metrics["auc"] is not None:
                    null_auc = float(metrics["auc"])
                    null_values.append(null_auc)
                    permutation_samples.append({"iteration": iteration + 1, "ai": ai, "country": human, "nullAuc": null_auc})
                work_done += 1
                _report(progress, "AUC：观察值、Bootstrap 与置换", work_done, work_total)

            finite_bootstrap = [float(value) for value in pair_bootstrap if value is not None and np.isfinite(value)]
            ci_low, ci_high = _percentile_interval(finite_bootstrap)
            permutation_p = None if observed_auc is None or not null_values else (1 + sum(value >= observed_auc for value in null_values)) / (1 + len(null_values))
            pair_summaries.append({
                "ai": ai, "country": human, "auc": observed_auc, "ciLow": ci_low, "ciHigh": ci_high,
                "permutationP": permutation_p, "significantAboveChance": permutation_p is not None and permutation_p < .05 and observed_auc > .5,
                "bootstrapValid": len(finite_bootstrap), "permutationValid": len(null_values),
                "humanUnits": len(human_units), "aiUnits": len(ai_units),
                "excludedIncompleteHumanUnits": len(_unit_map(rows, human)) - len(human_units),
                "excludedIncompleteAiUnits": len(_unit_map(rows, ai)) - len(ai_units), "error": "",
            })

        valid_observed = [(human, observed.get((ai, human))) for human in humans if observed.get((ai, human)) is not None]
        if not valid_observed:
            continue
        reference_country, reference_auc = min(valid_observed, key=lambda item: float(item[1]))
        lowest_counts = {human: 0.0 for human in humans}
        valid_closest_iterations = 0
        for iteration in range(iterations):
            values = {human: bootstrap_by_pair.get((ai, human), [None] * iterations)[iteration] for human in humans}
            finite = {human: float(value) for human, value in values.items() if value is not None and np.isfinite(value)}
            if not finite:
                continue
            minimum = min(finite.values())
            tied = sorted([human for human, value in finite.items() if np.isclose(value, minimum, rtol=1e-10, atol=1e-12)])
            valid_closest_iterations += 1
            for human in tied:
                lowest_counts[human] += 1 / len(tied)
            closest_draws.append({"iteration": iteration + 1, "ai": ai, "lowestCountry": "|".join(tied), "lowestAuc": minimum, "tieCount": len(tied)})
        for human in humans:
            closest_stability.append({
                "ai": ai, "country": human, "timesLowestTieWeighted": lowest_counts[human],
                "stabilityProportion": lowest_counts[human] / valid_closest_iterations if valid_closest_iterations else None,
                "validIterations": valid_closest_iterations, "originalLowestCountry": reference_country,
            })
        reference_bootstrap = bootstrap_by_pair[(ai, reference_country)]
        for human, human_auc in valid_observed:
            if human == reference_country:
                continue
            deltas = [
                float(bootstrap_by_pair[(ai, human)][iteration]) - float(reference_bootstrap[iteration])
                for iteration in range(iterations)
                if bootstrap_by_pair[(ai, human)][iteration] is not None and reference_bootstrap[iteration] is not None
            ]
            ci_low, ci_high = _percentile_interval(deltas)
            delta_summaries.append({
                "ai": ai, "referenceCountry": reference_country, "comparisonCountry": human,
                "referenceAuc": reference_auc, "comparisonAuc": human_auc,
                "observedDeltaAuc": float(human_auc) - float(reference_auc), "ciLow": ci_low, "ciHigh": ci_high,
                "significant": ci_low is not None and ci_high is not None and (ci_low > 0 or ci_high < 0),
                "referenceSignificantlyLower": ci_low is not None and ci_low > 0,
                "bootstrapValid": len(deltas),
            })

    return {
        "iterations": iterations, "pairSummaries": pair_summaries,
        "bootstrapSamples": bootstrap_samples, "permutationSamples": permutation_samples,
        "deltaSummaries": delta_summaries, "closestStability": closest_stability, "closestDraws": closest_draws,
    }


def pairwise_separability(rows: list[dict[str, Any]], humans: list[str], ais: list[str], requested_folds: int, missing_units: list[str]) -> tuple[list[dict[str, Any]], list[list[float | None]]]:
    output: list[dict[str, Any]] = []
    for ai in ais:
        for human in humans:
            pair = [row for row in rows if row["source"] in {human, ai}]
            if human in missing_units or ai in missing_units:
                output.append({"ai": ai, "country": human, "auc": None, "balancedAccuracy": None, "macroF1": None, "folds": 0, "error": "缺少 participant/run ID"})
                continue
            output.append({"ai": ai, "country": human, **_oof_binary_metrics(pair, ai, requested_folds, RANDOM_STATE)})
    matrix = [[next((row["auc"] for row in output if row["ai"] == ai and row["country"] == human), None) for human in humans] for ai in ais]
    return output, matrix


def country_alignment(rows: list[dict[str, Any]], humans: list[str], ais: list[str], requested_folds: int, missing_units: list[str]) -> dict[str, Any]:
    human_rows = [row for row in rows if row["source"] in humans]
    if len(humans) < 2 or any(source in missing_units for source in humans):
        return {"probabilities": [], "matrix": [[None for _ in humans] for _ in ais], "oofAccuracy": None, "error": "人类组不足或缺少 participant ID"}
    y = np.asarray([humans.index(row["source"]) for row in human_rows], dtype=int)
    groups = np.asarray([f'{row["source"]}:{row["unit"]}' for row in human_rows])
    min_units = min(len(np.unique(groups[y == label])) for label in range(len(humans)))
    folds = min(requested_folds, min_units)
    model = Pipeline([("scale", StandardScaler()), ("logit", LogisticRegression(max_iter=2000, class_weight="balanced", random_state=RANDOM_STATE))])
    oof_accuracy = None
    if folds >= 2:
        splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=RANDOM_STATE)
        predictions = cross_val_predict(model, _features(human_rows), y, groups=groups, cv=splitter, method="predict", n_jobs=-1)
        oof_accuracy = float(np.mean(predictions == y))
    model.fit(_features(human_rows), y)
    probability_rows: list[dict[str, Any]] = []
    matrix: list[list[float | None]] = []
    for ai in ais:
        ai_rows = [row for row in rows if row["source"] == ai]
        if not ai_rows:
            matrix.append([None for _ in humans]); continue
        probabilities = model.predict_proba(_features(ai_rows))
        average = np.mean(probabilities, axis=0)
        matrix.append([float(value) for value in average])
        probability_rows.extend({"ai": ai, "predictedCountry": human, "probability": float(average[index])} for index, human in enumerate(humans))
    return {"probabilities": probability_rows, "matrix": matrix, "oofAccuracy": oof_accuracy, "folds": folds, "error": ""}


def _rank(values: list[float | None], higher: bool) -> list[int | None]:
    valid = [(index, value) for index, value in enumerate(values) if value is not None and np.isfinite(value)]
    ordered = sorted(valid, key=lambda item: item[1], reverse=higher)
    ranks: list[int | None] = [None] * len(values)
    for rank, (index, _) in enumerate(ordered, 1): ranks[index] = rank
    return ranks


def run_task1_similarity(
    payload: dict[str, Any],
    progress: Callable[[str, int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    rows, sources, missing_units = prepare_similarity_data([row for row in payload.get("rows", []) if isinstance(row, dict)])
    humans = [source for source in HUMAN_ORDER if source in sources]
    ais = [source for source in AI_ORDER if source in sources]
    if not humans or not ais:
        raise ValueError("多层相似性至少需要 1 个人类国家组和 1 个 AI 模型组。")
    options = payload.get("options", {}) if isinstance(payload.get("options"), dict) else {}
    k = max(1, min(5, int(options.get("representativeK", 3))))
    folds = max(2, min(10, int(options.get("folds", 5))))
    inference_iterations = max(0, min(5000, int(options.get("inferenceIterations", 0))))
    bin_sizes = sorted({max(3, min(14, int(value))) for value in options.get("binSizes", [6, 8, 10])})
    _check_cancelled(cancelled); _report(progress, "描述统计与离散度", 0, 1)
    stats = distribution_statistics(rows)
    _report(progress, "描述统计与离散度", 1, 1)
    _check_cancelled(cancelled); _report(progress, "主导颜色区域覆盖", 0, 1)
    coverage_rows, coverage_matrix = dominant_region_capture(rows, humans, ais, k)
    _report(progress, "主导颜色区域覆盖", 1, 1)
    _check_cancelled(cancelled); _report(progress, "EMD / JSD 分箱敏感性", 0, 1)
    distance_rows, emd_matrix, jsd_matrix = distribution_distances(rows, humans, ais, bin_sizes)
    _report(progress, "EMD / JSD 分箱敏感性", 1, 1)
    _check_cancelled(cancelled); _report(progress, "16组 AI–Country Group-CV", 0, 1)
    classifier_rows, auc_matrix = pairwise_separability(rows, humans, ais, folds, missing_units)
    _report(progress, "16组 AI–Country Group-CV", 1, 1)
    _check_cancelled(cancelled)
    auc_inference = group_level_auc_inference(rows, humans, ais, folds, inference_iterations, missing_units, progress, cancelled, classifier_rows)
    _check_cancelled(cancelled); _report(progress, "Human-only 国家对齐", 0, 1)
    alignment = country_alignment(rows, humans, ais, folds, missing_units)
    _report(progress, "Human-only 国家对齐", 1, 1)
    evidence: list[dict[str, Any]] = []
    for ai_index, ai in enumerate(ais):
        coverage_ranks = _rank(coverage_matrix[ai_index], True)
        emd_ranks = _rank(emd_matrix[ai_index], False)
        auc_closeness = [None if value is None else abs(value - .5) for value in auc_matrix[ai_index]]
        auc_ranks = _rank(auc_closeness, False)
        for country_index, country in enumerate(humans):
            evidence.append({"ai": ai, "country": country, "coverage": coverage_matrix[ai_index][country_index], "coverageRank": coverage_ranks[country_index], "emdDeltaE76": emd_matrix[ai_index][country_index], "emdRank": emd_ranks[country_index], "jsdDistance": jsd_matrix[ai_index][country_index], "auc": auc_matrix[ai_index][country_index], "aucDistanceFromChance": auc_closeness[country_index], "aucClosenessRank": auc_ranks[country_index]})
    _report(progress, "完成", 1, 1)
    return {
        "version": 1, "randomState": RANDOM_STATE, "sources": sources, "humanSources": humans, "aiSources": ais, "emotions": EMOTIONS,
        "processedRows": [{"participantOrRun": row["unit"], **{key: value for key, value in row.items() if key != "unit"}} for row in rows],
        "missingIdentitySources": missing_units, "distributionStatistics": stats,
        "coverage": {"rows": coverage_rows, "matrix": coverage_matrix},
        "distances": {"rows": distance_rows, "emdMatrix": emd_matrix, "jsdMatrix": jsd_matrix, "primaryBins": 8 if 8 in bin_sizes else bin_sizes[0], "binSizes": bin_sizes},
        "separability": {"rows": classifier_rows, "aucMatrix": auc_matrix, "inference": auc_inference},
        "countryAlignment": alignment, "evidence": evidence,
        "method": {
            "coverage": "Human dominant regions: fixed-K KMeans largest cluster + adaptive DBSCAN largest non-noise cluster; region radius=95th percentile ΔE76 from cluster centre; consensus=mean of available coverages.",
            "emd": "3D CIELAB fixed-bin histograms; multidimensional Wasserstein/EMD with Euclidean bin-centre distance (ΔE76 ground metric).",
            "jsd": "Jensen–Shannon distance on the same shared CIELAB bins.",
            "classifier": f"StandardScaler + fixed RBF-SVM; up to {folds}-fold StratifiedGroupKFold; groups=Human participant / AI run; all metrics from OOF predictions.",
            "classifierInference": f"{inference_iterations} cluster-bootstrap draws resample complete participant/run units with replacement and retain all 20 emotion rows; duplicate draws keep one group ID and cannot cross CV folds. One-sided group-label permutation p-value tests AUC > 0.5. Within each AI, country contrasts share the same AI-run draw; percentile 95% CIs are reported for AUC and ΔAUC.",
            "countryAlignment": "Human-only StandardScaler + multinomial logistic regression; AI rows projected into the human country probability space.",
            "interpretation": "No composite similarity score. Report coverage, EMD/JSD and AUC distance from 0.5 together.",
        },
    }
