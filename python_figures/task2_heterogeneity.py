"""Participant/run-level heterogeneity and distribution analysis for Task 2."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Callable

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial.distance import cdist, pdist, squareform
from scipy.stats import spearmanr
from sklearn.decomposition import PCA
from sklearn.metrics import adjusted_rand_score, silhouette_score


COLORS = ["D38", "F17", "F4", "J0", "F0", "F29", "A0", "H35", "I6", "G3", "C9"]
EMOTIONS = [
    "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
    "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
]
HUMAN_ORDER = ["uk", "us", "cn", "bw"]
AI_ORDER = ["doubao", "deepseek", "gpt", "gemini"]


class HeterogeneityAnalysisCancelled(RuntimeError):
    pass


def _clean_source(value: object) -> str:
    return str(value or "").strip()


def _ordered(names: list[str], preferred: list[str]) -> list[str]:
    rank = {name: i for i, name in enumerate(preferred)}
    return sorted(names, key=lambda value: (rank.get(value.lower(), len(rank)), value.lower()))


def _json_number(value: float | np.floating | None) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return float(value)


def _bh(values: list[float]) -> list[float]:
    if not values:
        return []
    p = np.asarray(values, dtype=float)
    order = np.argsort(p)
    ranked = p[order]
    adjusted = np.minimum.accumulate((ranked * len(p) / np.arange(1, len(p) + 1))[::-1])[::-1]
    result = np.empty_like(adjusted)
    result[order] = np.clip(adjusted, 0, 1)
    return result.tolist()


def _prepare_profiles(rows: list[dict[str, object]]) -> tuple[dict[str, object], dict[str, dict[str, np.ndarray]]]:
    cells: dict[tuple[str, str, str, str], list[tuple[float, float, bool]]] = defaultdict(list)
    unit_meta: dict[tuple[str, str], dict[str, object]] = {}
    excluded = Counter()
    generated = Counter()
    for row in rows:
        source = _clean_source(row.get("source"))
        cohort = str(row.get("cohort") or "unspecified").strip().lower()
        color = str(row.get("color") or "").strip()
        emotion = str(row.get("emotion") or "").strip()
        participant = str(row.get("participant") or "").strip()
        run = str(row.get("run") or "").strip()
        source_row = str(row.get("sourceRow") or "").strip()
        provided = bool(row.get("identityProvided", bool(participant or run)))
        if cohort == "human":
            raw_unit = participant or run
        elif cohort == "ai":
            raw_unit = run or participant
        else:
            raw_unit = participant or run
        generated_id = False
        if not provided or not raw_unit:
            if source_row:
                raw_unit = f"generated-row-{source_row}"
                generated_id = True
            else:
                excluded[(source or "unknown", "missing_identity")] += 1
                continue
        if not source or color not in COLORS or emotion not in EMOTIONS or cohort not in {"human", "ai"}:
            excluded[(source or "unknown", "invalid_source_cohort_or_dimension")] += 1
            continue
        unit = f"{source}::{raw_unit}"
        key = (source, unit)
        unit_meta[key] = {"source": source, "cohort": cohort, "unitId": raw_unit, "generatedId": generated_id}
        selected = float(row.get("selected") or 0)
        intensity = float(row.get("intensity") or 0)
        cells[(source, unit, color, emotion)].append((1.0 if selected > 0 else 0.0, np.clip(intensity, 0, 5) / 5.0, bool(row.get("valid", True))))

    profiles: dict[str, dict[str, list[object]]] = defaultdict(lambda: {"binary": [], "rating": [], "unitIds": [], "cohorts": [], "sources": [], "generated": []})
    included = Counter()
    for (source, unit), meta in unit_meta.items():
        binary: list[float] = []
        rating: list[float] = []
        reason = ""
        for color in COLORS:
            for emotion in EMOTIONS:
                values = cells.get((source, unit, color, emotion), [])
                if len(values) != 1:
                    reason = "missing_or_duplicate_cells"
                    break
                if not values[0][2]:
                    reason = "invalid_cell"
                    break
                binary.append(values[0][0])
                rating.append(values[0][1])
            if reason:
                break
        if reason or len(binary) != 220:
            excluded[(source, reason or "incomplete_profile")] += 1
            continue
        profiles[source]["binary"].append(binary)
        profiles[source]["rating"].append(rating)
        profiles[source]["unitIds"].append(meta["unitId"])
        profiles[source]["cohorts"].append(meta["cohort"])
        profiles[source]["sources"].append(source)
        profiles[source]["generated"].append(meta["generatedId"])
        if bool(meta["generatedId"]):
            generated[source] += 1
        included[source] += 1

    arrays: dict[str, dict[str, np.ndarray]] = {}
    for source, values in profiles.items():
        arrays[source] = {
            "binary": np.asarray(values["binary"], dtype=float),
            "rating": np.asarray(values["rating"], dtype=float),
            "unitIds": np.asarray(values["unitIds"], dtype=object),
            "cohorts": np.asarray(values["cohorts"], dtype=object),
            "sources": np.asarray(values["sources"], dtype=object),
            "generated": np.asarray(values["generated"], dtype=bool),
        }
    qc_rows = []
    all_sources = sorted(set(included) | {key[0] for key in excluded})
    for source in all_sources:
        reasons = {reason: count for (item, reason), count in excluded.items() if item == source}
        qc_rows.append({"source": source, "includedProfiles": included[source], "excludedProfilesOrRows": sum(reasons.values()), "generatedIdentityRows": generated[source], "exclusionReasons": reasons})
    return {"rows": qc_rows, "includedProfiles": int(sum(included.values())), "excluded": int(sum(excluded.values())), "dimensions": 220}, arrays


def _pca_fit(x: np.ndarray) -> tuple[PCA, np.ndarray, int]:
    maximum = max(1, min(10, x.shape[0] - 1, x.shape[1]))
    model = PCA(n_components=maximum, svd_solver="full")
    scores = model.fit_transform(x)
    cumulative = np.cumsum(model.explained_variance_ratio_)
    chosen = int(np.searchsorted(cumulative, 0.8) + 1)
    chosen = min(maximum, max(1, chosen))
    return model, scores[:, :chosen], chosen


def _pam(x: np.ndarray, k: int, rng: np.random.Generator, iterations: int = 50) -> tuple[np.ndarray, np.ndarray]:
    n = len(x)
    if k <= 1 or n < 2:
        center = np.mean(x, axis=0)
        medoid = int(np.argmin(np.sum((x - center) ** 2, axis=1)))
        return np.zeros(n, dtype=int), np.asarray([medoid])
    distances = squareform(pdist(x))
    medoids = [int(rng.integers(n))]
    while len(medoids) < k:
        nearest = np.min(distances[:, medoids], axis=1)
        nearest[medoids] = 0
        total = nearest.sum()
        candidate = int(rng.choice(n, p=nearest / total)) if total > 0 else next(i for i in range(n) if i not in medoids)
        medoids.append(candidate)
    medoids_arr = np.asarray(medoids, dtype=int)
    labels = np.argmin(distances[:, medoids_arr], axis=1)
    for _ in range(iterations):
        next_medoids = medoids_arr.copy()
        for cluster in range(k):
            members = np.where(labels == cluster)[0]
            if not len(members):
                candidates = np.setdiff1d(np.arange(n), next_medoids)
                if len(candidates):
                    next_medoids[cluster] = candidates[np.argmax(np.min(distances[np.ix_(candidates, next_medoids)], axis=1))]
                continue
            local = distances[np.ix_(members, members)].sum(axis=1)
            next_medoids[cluster] = members[int(np.argmin(local))]
        next_labels = np.argmin(distances[:, next_medoids], axis=1)
        if np.array_equal(next_medoids, medoids_arr) and np.array_equal(next_labels, labels):
            break
        medoids_arr, labels = next_medoids, next_labels
    return labels, medoids_arr


def _cluster_population(x: np.ndarray, sources: np.ndarray, units: np.ndarray, representation: str, population: str, stability_reps: int, seed: int, tick: Callable[[str, int], None], cancelled: Callable[[], bool]) -> dict[str, object]:
    model, scores, n_components = _pca_fit(x)
    validations = []
    fits: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    for k in range(1, 6):
        if k > len(x):
            continue
        labels, medoids = _pam(scores, k, np.random.default_rng(seed + k))
        fits[k] = (labels, medoids)
        silhouette = float(silhouette_score(scores, labels)) if k > 1 and len(set(labels)) > 1 else None
        dispersion = float(np.mean(np.min(cdist(scores, scores[medoids]), axis=1)))
        separation = float(np.mean(pdist(scores[medoids]))) if k > 1 else 0.0
        ari_values = []
        if k > 1:
            sample_n = max(k + 1, int(np.floor(len(x) * 0.8)))
            for replicate in range(stability_reps):
                if cancelled():
                    raise HeterogeneityAnalysisCancelled("分析已取消。")
                rng = np.random.default_rng(seed + 100_000 * k + replicate)
                chosen = np.sort(rng.choice(len(x), size=min(sample_n, len(x)), replace=False))
                _, boot_scores, _ = _pca_fit(x[chosen])
                boot_labels, _ = _pam(boot_scores, k, rng)
                ari_values.append(float(adjusted_rand_score(labels[chosen], boot_labels)))
                tick(f"{population} · {representation} · K={k} 稳定性", 1)
        validations.append({
            "population": population, "representation": representation, "k": k, "n": len(x), "pcaComponents": n_components,
            "explainedVariance": float(np.sum(model.explained_variance_ratio_[:n_components])), "silhouette": silhouette,
            "withinDispersion": dispersion, "betweenSeparation": separation, "minClusterSize": int(min(Counter(labels).values())),
            "stabilityMeanAri": float(np.mean(ari_values)) if ari_values else None,
            "stabilityCiLow": float(np.quantile(ari_values, .025)) if ari_values else None,
            "stabilityCiHigh": float(np.quantile(ari_values, .975)) if ari_values else None,
        })
    candidates = [row for row in validations if row["k"] > 1 and row["silhouette"] is not None and row["stabilityMeanAri"] is not None and row["minClusterSize"] >= max(3, round(len(x) * .05))]
    credible = [row for row in candidates if row["silhouette"] >= .25 and row["stabilityMeanAri"] >= .60]
    selected_k = int(max(credible, key=lambda row: (row["silhouette"] + row["stabilityMeanAri"], -row["k"]))["k"]) if credible else 1
    labels, _ = fits[selected_k]
    assignments = [{"population": population, "representation": representation, "source": str(sources[i]), "unitId": str(units[i]), "cluster": int(labels[i]) + 1, "selectedK": selected_k} for i in range(len(x))]
    pca_rows = [{"population": population, "representation": representation, "source": str(sources[i]), "unitId": str(units[i]), "cluster": int(labels[i]) + 1, "pc1": float(scores[i, 0]), "pc2": float(scores[i, 1]) if scores.shape[1] > 1 else 0.0} for i in range(len(x))]
    profiles = []
    for cluster in range(selected_k):
        mask = labels == cluster
        mean_profile = x[mask].mean(axis=0)
        broadness = x[mask].sum(axis=1) if representation == "binary" else (x[mask] > 0).sum(axis=1)
        mean_strength = x[mask].mean(axis=1)
        for color_i, color in enumerate(COLORS):
            for emotion_i, emotion in enumerate(EMOTIONS):
                index = color_i * len(EMOTIONS) + emotion_i
                profiles.append({"population": population, "representation": representation, "cluster": cluster + 1, "source": "pooled", "color": color, "emotion": emotion, "value": float(mean_profile[index]), "clusterN": int(mask.sum()), "meanBroadness": float(broadness.mean()), "meanProfileIntensity": float(mean_strength.mean())})
    composition = []
    for source in _ordered(sorted(set(sources.tolist())), HUMAN_ORDER if population == "human" else AI_ORDER):
        source_mask = sources == source
        for cluster in range(selected_k):
            count = int(np.sum(source_mask & (labels == cluster)))
            composition.append({"population": population, "representation": representation, "source": source, "cluster": cluster + 1, "n": count, "proportion": count / max(1, int(source_mask.sum()))})
    return {"validation": validations, "assignments": assignments, "pca": pca_rows, "profiles": profiles, "composition": composition, "selectedK": selected_k, "credibleSubgroups": bool(credible)}


def _energy_from_matrix(d: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    return float(2 * d[np.ix_(a, b)].mean() - d[np.ix_(a, a)].mean() - d[np.ix_(b, b)].mean())


def _mmd_from_matrix(k: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    return float(max(0.0, k[np.ix_(a, a)].mean() + k[np.ix_(b, b)].mean() - 2 * k[np.ix_(a, b)].mean()))


def _pair_inference(x: np.ndarray, y: np.ndarray, representation: str, ai: str, human: str, n_perm: int, n_boot: int, hungarian_reps: int, seed: int, tick: Callable[[str, int], None], cancelled: Callable[[], bool]) -> tuple[dict[str, object], dict[str, object], dict[str, object], dict[str, object], list[dict[str, object]]]:
    pooled = np.vstack([x, y])
    d = squareform(pdist(pooled, metric="euclidean"))
    nx, ny = len(x), len(y)
    a0, b0 = np.arange(nx), np.arange(nx, nx + ny)
    energy = _energy_from_matrix(d, a0, b0)
    positive = d[np.triu_indices(len(d), 1)]
    positive = positive[positive > 0]
    sigma = float(np.median(positive)) if len(positive) else 1.0
    kernel = np.exp(-(d ** 2) / (2 * sigma ** 2))
    mmd = _mmd_from_matrix(kernel, a0, b0)
    mmd_sensitivity = []
    for multiplier in [.5, 1.0, 2.0]:
        km = np.exp(-(d ** 2) / (2 * (sigma * multiplier) ** 2))
        mmd_sensitivity.append({"multiplier": multiplier, "sigma": sigma * multiplier, "mmd2": _mmd_from_matrix(km, a0, b0)})
    rng = np.random.default_rng(seed)
    perm_energy = np.empty(n_perm)
    perm_mmd = np.empty(n_perm)
    for i in range(n_perm):
        if i % 50 == 0 and cancelled():
            raise HeterogeneityAnalysisCancelled("分析已取消。")
        order = rng.permutation(nx + ny)
        a, b = order[:nx], order[nx:]
        perm_energy[i] = _energy_from_matrix(d, a, b)
        perm_mmd[i] = _mmd_from_matrix(kernel, a, b)
        if i % 25 == 0:
            tick(f"{ai} × {human} · permutation", min(25, n_perm - i))
    p_energy = (1 + int(np.sum(perm_energy >= energy))) / (n_perm + 1)
    p_mmd = (1 + int(np.sum(perm_mmd >= mmd))) / (n_perm + 1)
    boot_energy = np.empty(n_boot)
    boot_mmd = np.empty(n_boot)
    for i in range(n_boot):
        a = rng.choice(a0, size=nx, replace=True)
        b = rng.choice(b0, size=ny, replace=True)
        boot_energy[i] = _energy_from_matrix(d, a, b)
        boot_mmd[i] = _mmd_from_matrix(kernel, a, b)
        if i % 20 == 0:
            tick(f"{ai} × {human} · bootstrap", min(20, n_boot - i))
    energy_row = {"aiSource": ai, "humanSource": human, "representation": representation, "nAi": nx, "nHuman": ny, "energy": energy, "bootstrapMedian": float(np.median(boot_energy)), "ciLow": float(np.quantile(boot_energy, .025)), "ciHigh": float(np.quantile(boot_energy, .975)), "permutationP": p_energy, "nPermutation": n_perm, "nBootstrap": n_boot, "estimator": "V-statistic"}
    mmd_row = {"aiSource": ai, "humanSource": human, "representation": representation, "nAi": nx, "nHuman": ny, "mmd2": mmd, "sigma": sigma, "bootstrapMedian": float(np.median(boot_mmd)), "ciLow": float(np.quantile(boot_mmd, .025)), "ciHigh": float(np.quantile(boot_mmd, .975)), "permutationP": p_mmd, "nPermutation": n_perm, "nBootstrap": n_boot, "estimator": "biased V-statistic", "sensitivity": mmd_sensitivity}
    if representation == "binary":
        distance_xy = cdist(x, y, metric="jaccard")
        metric_name = "Jaccard"
    else:
        distance_xy = cdist(x, y, metric="cityblock") / x.shape[1]
        metric_name = "normalized Manhattan"
    ai_nn = np.min(distance_xy, axis=1)
    human_nn = np.min(distance_xy, axis=0)
    nn_row = {"aiSource": ai, "humanSource": human, "representation": representation, "metric": metric_name, "nAi": nx, "nHuman": ny, "aiToHuman": float(ai_nn.mean()), "humanToAi": float(human_nn.mean()), "symmetricMean": float((ai_nn.mean() + human_nn.mean()) / 2), "aiUniqueHumanCoverage": int(len(np.unique(np.argmin(distance_xy, axis=1)))) / max(1, ny), "humanUniqueAiCoverage": int(len(np.unique(np.argmin(distance_xy, axis=0)))) / max(1, nx)}
    match_values = []
    repeats = 1 if nx == ny else hungarian_reps
    for i in range(repeats):
        if cancelled():
            raise HeterogeneityAnalysisCancelled("分析已取消。")
        if nx > ny:
            ai_idx = rng.choice(nx, size=ny, replace=False); human_idx = np.arange(ny)
        elif ny > nx:
            ai_idx = np.arange(nx); human_idx = rng.choice(ny, size=nx, replace=False)
        else:
            ai_idx = np.arange(nx); human_idx = np.arange(ny)
        sub = distance_xy[np.ix_(ai_idx, human_idx)]
        rr, cc = linear_sum_assignment(sub)
        match_values.append(float(sub[rr, cc].mean()))
        if i % 10 == 0:
            tick(f"{ai} × {human} · Hungarian", min(10, repeats - i))
    symmetric_nn = float((ai_nn.mean() + human_nn.mean()) / 2)
    hungarian_row = {"aiSource": ai, "humanSource": human, "representation": representation, "metric": metric_name, "nAi": nx, "nHuman": ny, "repetitions": repeats, "mean": float(np.mean(match_values)), "median": float(np.median(match_values)), "ciLow": float(np.quantile(match_values, .025)), "ciHigh": float(np.quantile(match_values, .975)), "symmetricNn": symmetric_nn, "matchingGap": float(np.mean(match_values) - symmetric_nn)}
    nn_distribution = ([{"aiSource": ai, "humanSource": human, "representation": representation, "direction": "AI→Human", "distance": float(value)} for value in ai_nn] + [{"aiSource": ai, "humanSource": human, "representation": representation, "direction": "Human→AI", "distance": float(value)} for value in human_nn])
    return energy_row, mmd_row, nn_row, hungarian_row, nn_distribution


def run_task2_heterogeneity(payload: dict[str, object], progress: Callable[[str, int, int], None] | None = None, cancelled: Callable[[], bool] | None = None) -> dict[str, object]:
    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise ValueError("缺少实验二逐单元数据。")
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    seed = int(options.get("seed", 20260824))
    stability_reps = max(1, int(options.get("stability", 100)))
    n_perm = max(9, int(options.get("permutations", 999)))
    n_boot = max(10, int(options.get("bootstrap", 200)))
    hungarian_reps = max(1, int(options.get("hungarian", 100)))
    is_cancelled = cancelled or (lambda: False)
    qc, profiles = _prepare_profiles(rows)
    human_sources = _ordered([source for source, data in profiles.items() if len(data["cohorts"]) and data["cohorts"][0] == "human"], HUMAN_ORDER)
    ai_sources = _ordered([source for source, data in profiles.items() if len(data["cohorts"]) and data["cohorts"][0] == "ai"], AI_ORDER)
    if not human_sources or not ai_sources:
        raise ValueError("至少需要一个完整 Human 来源和一个完整 AI 来源。")
    total = 2 * 2 * 4 * stability_reps + 2 * len(ai_sources) * len(human_sources) * (n_perm + n_boot + hungarian_reps) + 20
    completed = 0
    def tick(stage: str, amount: int) -> None:
        nonlocal completed
        completed = min(total, completed + max(0, amount))
        if progress:
            progress(stage, completed, total)
    tick("质量控制与 220 维 profile 拼接", 2)
    subgroup_parts = []
    for representation in ["binary", "rating"]:
        for population, sources in [("human", human_sources), ("ai", ai_sources)]:
            x = np.vstack([profiles[source][representation] for source in sources])
            source_labels = np.concatenate([profiles[source]["sources"] for source in sources])
            unit_labels = np.concatenate([profiles[source]["unitIds"] for source in sources])
            subgroup_parts.append(_cluster_population(x, source_labels, unit_labels, representation, population, stability_reps, seed + len(subgroup_parts) * 1_000_000, tick, is_cancelled))
    energy_rows: list[dict[str, object]] = []
    mmd_rows: list[dict[str, object]] = []
    nn_rows: list[dict[str, object]] = []
    hungarian_rows: list[dict[str, object]] = []
    nn_distributions: list[dict[str, object]] = []
    for representation in ["binary", "rating"]:
        for ai_index, ai in enumerate(ai_sources):
            for human_index, human in enumerate(human_sources):
                pair_seed = seed + (0 if representation == "binary" else 50_000_000) + ai_index * 100_000 + human_index * 10_000
                result = _pair_inference(profiles[ai][representation], profiles[human][representation], representation, ai, human, n_perm, n_boot, hungarian_reps, pair_seed, tick, is_cancelled)
                energy_rows.append(result[0]); mmd_rows.append(result[1]); nn_rows.append(result[2]); hungarian_rows.append(result[3]); nn_distributions.extend(result[4])
    for representation in ["binary", "rating"]:
        e = [row for row in energy_rows if row["representation"] == representation]
        m = [row for row in mmd_rows if row["representation"] == representation]
        for row, q in zip(e, _bh([float(item["permutationP"]) for item in e])):
            row["fdrQ"] = q; row["significantFdr"] = q < .05
        for row, q in zip(m, _bh([float(item["permutationP"]) for item in m])):
            row["fdrQ"] = q; row["significantFdr"] = q < .05
    consistency = []
    for representation in ["binary", "rating"]:
        e = [row for row in energy_rows if row["representation"] == representation]
        m_lookup = {(row["aiSource"], row["humanSource"]): row for row in mmd_rows if row["representation"] == representation}
        energy_values = [float(row["energy"]) for row in e]
        mmd_values = [float(m_lookup[(row["aiSource"], row["humanSource"])]["mmd2"]) for row in e]
        rho, p = spearmanr(energy_values, mmd_values)
        consistency.append({"representation": representation, "spearmanRho": _json_number(rho), "pValueDescriptive": _json_number(p), "pairs": len(e)})
    tick("整理结果", total - completed)
    return {
        "version": 1, "randomSeed": seed, "colors": COLORS, "emotions": EMOTIONS, "humanSources": human_sources, "aiSources": ai_sources,
        "config": {"stability": stability_reps, "permutations": n_perm, "bootstrap": n_boot, "hungarian": hungarian_reps}, "qc": qc,
        "subgroups": {
            "validation": [row for part in subgroup_parts for row in part["validation"]],
            "assignmentsHuman": [row for part in subgroup_parts if part["assignments"] and part["assignments"][0]["population"] == "human" for row in part["assignments"]],
            "assignmentsAi": [row for part in subgroup_parts if part["assignments"] and part["assignments"][0]["population"] == "ai" for row in part["assignments"]],
            "profiles": [row for part in subgroup_parts for row in part["profiles"]], "composition": [row for part in subgroup_parts for row in part["composition"]], "pca": [row for part in subgroup_parts for row in part["pca"]],
        },
        "distribution": {"energy": energy_rows, "mmd": mmd_rows, "consistency": consistency},
        "matching": {"nn": nn_rows, "hungarian": hungarian_rows, "nnDistances": nn_distributions},
        "method": {
            "analysisUnit": "complete participant/run 11×20 profile", "binary": "selected 0/1 (primary)", "rating": "intensity/5 (robustness)",
            "energy": "Euclidean energy distance, empirical V-statistic", "mmd": "Gaussian RBF biased MMD²; median heuristic; 0.5×/1×/2× sensitivity",
            "nearestNeighbour": "binary Jaccard; rating normalized Manhattan", "hungarian": "linear_sum_assignment; larger group downsampled to min(n)",
            "inference": "participant/run profiles are the resampling and permutation units; BH-FDR separately within the 16 Energy and 16 MMD families per representation",
        },
    }
