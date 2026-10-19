"""Leakage-safe machine-learning analysis for GEW color-emotion data."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, recall_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, GroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.svm import SVC


EMOTIONS = [
    "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
    "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
]
HUMAN_ORDER = ["CN", "BW", "UK", "US"]
AI_ORDER = ["DeepSeek", "Doubao", "GPT", "Gemini"]


def _text(row: dict[str, Any], key: str) -> str:
    value = row.get(key)
    return "" if value is None else str(value).strip()


def _canonical_source(value: str) -> str:
    aliases = {"cn": "CN", "bw": "BW", "uk": "UK", "us": "US", "deepseek": "DeepSeek", "doubao": "Doubao", "gpt": "GPT", "gemini": "Gemini"}
    return aliases.get(value.strip().lower(), value.strip())


def prepare_ml_data(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Build one 20-feature observation per source × independent unit × color."""
    observations: dict[tuple[str, str, str], dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    cohorts: dict[str, str] = {}
    unit_fields: dict[str, str] = {}
    for row in rows:
        if not row.get("valid", True):
            continue
        source = _canonical_source(_text(row, "source"))
        cohort = _text(row, "cohort").lower()
        participant, run = _text(row, "participant"), _text(row, "run")
        if not source or cohort not in {"human", "ai"}:
            continue
        unit = participant if cohort == "human" else run
        unit_field = "participant" if cohort == "human" else "run/session"
        if not unit:
            raise ValueError(f"{source} 缺少 {unit_field} 标识，无法执行无泄漏分组交叉验证。")
        color, emotion = _text(row, "color"), _text(row, "emotion")
        if not color or emotion not in EMOTIONS:
            continue
        try:
            intensity = min(5.0, max(0.0, float(row.get("intensity", 0))))
        except (TypeError, ValueError):
            intensity = 0.0
        observations[(source, unit, color)][emotion].append(intensity)
        cohorts[source] = cohort
        unit_fields[source] = unit_field

    by_source: dict[str, dict[str, Any]] = {}
    for (source, unit, color), emotion_values in observations.items():
        entry = by_source.setdefault(source, {"X": [], "y": [], "groups": [], "units": set(), "colors": set()})
        entry["X"].append([float(np.mean(emotion_values.get(emotion, [0.0]))) for emotion in EMOTIONS])
        entry["y"].append(color); entry["groups"].append(unit); entry["units"].add(unit); entry["colors"].add(color)
    if not by_source:
        raise ValueError("未识别到可用于机器学习的实验二 0–5 GEW 数据。")
    expected = [source for source in HUMAN_ORDER + AI_ORDER if source in by_source]
    remaining = [source for source in by_source if source not in expected]
    sources = expected + remaining
    common_colors = sorted(set.intersection(*(set(by_source[source]["colors"]) for source in sources)))
    if len(common_colors) < 2:
        raise ValueError("各来源共同存在的颜色少于 2 类，无法执行颜色分类。")
    prepared: dict[str, Any] = {}
    for source in sources:
        item = by_source[source]; keep = [index for index, color in enumerate(item["y"]) if color in common_colors]
        prepared[source] = {
            "X": np.asarray([item["X"][index] for index in keep], dtype=float),
            "y": np.asarray([item["y"][index] for index in keep]),
            "groups": np.asarray([item["groups"][index] for index in keep]),
            "cohort": cohorts[source], "unitField": unit_fields[source],
        }
    return {"sources": sources, "colors": common_colors, "data": prepared}


def _pipeline() -> Pipeline:
    return Pipeline([("scale", StandardScaler()), ("svc", SVC(kernel="rbf", probability=False, decision_function_shape="ovr", random_state=20260812))])


def _splits(groups: np.ndarray, requested: int, context: str) -> int:
    count = len(np.unique(groups))
    splits = min(requested, count)
    if splits < 2:
        raise ValueError(f"{context} 只有 {count} 个独立 participant/run，至少需要 2 个。")
    return splits


def _macro_auc(y_true: np.ndarray, scores: np.ndarray, classes: np.ndarray) -> float | None:
    try:
        shifted = scores - np.max(scores, axis=1, keepdims=True)
        probabilities = np.exp(shifted); probabilities /= np.maximum(probabilities.sum(axis=1, keepdims=True), 1e-12)
        return float(roc_auc_score(y_true, probabilities, labels=classes, multi_class="ovr", average="macro"))
    except ValueError:
        return None


def nested_group_cv(X: np.ndarray, y: np.ndarray, groups: np.ndarray, colors: list[str], outer_folds: int, inner_folds: int, grid: dict[str, list[Any]]) -> dict[str, Any]:
    outer_n = _splits(groups, outer_folds, "Outer CV")
    outer = GroupKFold(n_splits=outer_n)
    predictions = np.empty(len(y), dtype=object); probabilities = np.zeros((len(y), len(colors)), dtype=float)
    fold_rows: list[dict[str, Any]] = []
    for fold, (train, test) in enumerate(outer.split(X, y, groups), 1):
        train_groups, test_groups = set(groups[train]), set(groups[test])
        if train_groups & test_groups:
            raise RuntimeError("检测到 participant/run 泄漏。")
        inner_n = _splits(groups[train], inner_folds, f"Outer fold {fold} 的 Inner CV")
        search = GridSearchCV(_pipeline(), grid, cv=GroupKFold(n_splits=inner_n), scoring="accuracy", n_jobs=1, refit=True)
        search.fit(X[train], y[train], groups=groups[train])
        predictions[test] = search.predict(X[test])
        local = np.asarray(search.decision_function(X[test]))
        if local.ndim == 1: local = np.column_stack([-local, local])
        for local_index, label in enumerate(search.classes_):
            if label in colors: probabilities[test, colors.index(label)] = local[:, local_index]
        fold_rows.append({"fold": fold, "trainUnits": len(train_groups), "testUnits": len(test_groups), "accuracy": float(accuracy_score(y[test], predictions[test])), "bestC": search.best_params_["svc__C"], "bestGamma": search.best_params_["svc__gamma"]})
    labels = np.asarray(colors)
    matrix = confusion_matrix(y, predictions, labels=labels)
    normalized = matrix / np.maximum(1, matrix.sum(axis=1, keepdims=True))
    recalls = recall_score(y, predictions, labels=labels, average=None, zero_division=0)
    return {
        "accuracy": float(accuracy_score(y, predictions)), "macroF1": float(f1_score(y, predictions, labels=labels, average="macro", zero_division=0)),
        "macroAuc": _macro_auc(y, probabilities, labels), "predictions": predictions.tolist(), "probabilities": probabilities.tolist(),
        "confusion": matrix.tolist(), "confusionNormalized": normalized.tolist(), "recall": {color: float(value) for color, value in zip(colors, recalls)},
        "folds": fold_rows, "outerFoldsUsed": outer_n,
    }


def _fit_full(X: np.ndarray, y: np.ndarray, groups: np.ndarray, inner_folds: int, grid: dict[str, list[Any]]) -> GridSearchCV:
    inner_n = _splits(groups, inner_folds, "Cross-generalization Inner CV")
    search = GridSearchCV(_pipeline(), grid, cv=GroupKFold(n_splits=inner_n), scoring="accuracy", n_jobs=1, refit=True)
    search.fit(X, y, groups=groups)
    return search


def build_similarity_matrix(confusion_normalized: list[list[float]]) -> list[list[float]]:
    matrix = np.asarray(confusion_normalized, dtype=float)
    return ((matrix + matrix.T) / 2.0).tolist()


def run_first_phase(payload: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_ml_data([row for row in payload.get("rows", []) if isinstance(row, dict)])
    sources, colors, data = prepared["sources"], prepared["colors"], prepared["data"]
    options = payload.get("options", {}) if isinstance(payload.get("options"), dict) else {}
    outer_folds, inner_folds = int(options.get("outerFolds", 10)), int(options.get("innerFolds", 5))
    grid = {"svc__C": options.get("cValues", [.1, 1, 10, 100]), "svc__gamma": options.get("gammaValues", ["scale", .001, .01, .1, 1])}
    decoding: dict[str, Any] = {}; fitted: dict[str, GridSearchCV] = {}
    for source in sources:
        item = data[source]
        result = nested_group_cv(item["X"], item["y"], item["groups"], colors, outer_folds, inner_folds, grid)
        result.update({"samples": len(item["y"]), "units": len(np.unique(item["groups"])), "chance": 1 / len(colors), "cohort": item["cohort"], "unitField": item["unitField"], "colorSimilarity": build_similarity_matrix(result["confusionNormalized"])})
        decoding[source] = result
        fitted[source] = _fit_full(item["X"], item["y"], item["groups"], inner_folds, grid)
    cross = np.zeros((len(sources), len(sources)), dtype=float)
    for row_index, train_source in enumerate(sources):
        for column_index, test_source in enumerate(sources):
            if train_source == test_source: cross[row_index, column_index] = decoding[train_source]["accuracy"]
            else: cross[row_index, column_index] = accuracy_score(data[test_source]["y"], fitted[train_source].predict(data[test_source]["X"]))
    # Normalize by the TEST group's own independently estimated decodability.
    # This prevents an intrinsically easy target group from inflating A→B.
    # T(A→B) = (Acc(A→B)-chance) / (Acc(B→B)-chance).
    chance = 1 / len(colors)
    diagonal = np.diag(cross)
    normalized: list[list[float | None]] = []
    for train_index in range(len(sources)):
        row: list[float | None] = []
        for test_index in range(len(sources)):
            denominator = diagonal[test_index] - chance
            row.append(None if denominator <= 1e-12 else float((cross[train_index, test_index] - chance) / denominator))
        normalized.append(row)
    human = [source for source in HUMAN_ORDER if source in sources]; ai = [source for source in AI_ORDER if source in sources]
    return {
        "version": 1, "randomState": 20260812, "sources": sources, "colors": colors, "emotions": EMOTIONS,
        "decoding": decoding, "crossGeneralization": cross.tolist(), "normalizedTransfer": normalized,
        "humanSources": human, "aiSources": ai,
        "humanToAi": [[normalized[sources.index(h)][sources.index(a)] for a in ai] for h in human],
        "aiToHuman": [[normalized[sources.index(a)][sources.index(h)] for h in human] for a in ai],
        "method": {"model": "StandardScaler + RBF-SVM", "outer": f"GroupKFold up to {outer_folds}", "inner": f"GroupKFold up to {inner_folds}", "commonColors": len(colors), "leakageRule": "Human=participant; AI=run/session", "transferNormalization": "(Acc(A→B)-chance)/(OOF Acc(B→B)-chance)"},
    }
