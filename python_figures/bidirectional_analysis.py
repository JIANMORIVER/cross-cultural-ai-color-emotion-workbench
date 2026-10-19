"""Participant/run-level bidirectional emotion-colour cycle analysis."""

from __future__ import annotations

from collections import defaultdict
import hashlib
import math

import numpy as np
from scipy.stats import pearsonr, rankdata, spearmanr


EMOTIONS = [
    "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
    "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
]
COLORS = ["D38", "F17", "F4", "J0", "F0", "F29", "A0", "H35", "I6", "G3", "C9"]
COLOR_HEX = {
    "D38": "#F38EBB", "F17": "#00904A", "F4": "#DD4200", "J0": "#262626", "F0": "#808080",
    "F29": "#007FD3", "A0": "#F2F2F2", "H35": "#6F2A78", "I6": "#4B2819", "G3": "#BB1F23", "C9": "#FFBC00",
}


def _rgb_to_lab(hex_value: str) -> np.ndarray:
    value = hex_value.lstrip("#")
    rgb = np.array([int(value[i:i + 2], 16) for i in (0, 2, 4)], dtype=float) / 255
    rgb = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    xyz = np.array([
        rgb @ np.array([.4124564, .3575761, .1804375]),
        rgb @ np.array([.2126729, .7151522, .0721750]),
        rgb @ np.array([.0193339, .1191920, .9503041]),
    ]) / np.array([.95047, 1, 1.08883])
    f = np.where(xyz > .008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])


def _delta_e_2000(first: np.ndarray, second: np.ndarray) -> float:
    l1, a1, b1 = first; l2, a2, b2 = second
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2); mean_c = (c1 + c2) / 2
    g = .5 * (1 - math.sqrt(mean_c ** 7 / (mean_c ** 7 + 25 ** 7)))
    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h = lambda a, b: math.degrees(math.atan2(b, a)) % 360
    h1p, h2p = (0 if c1p < 1e-12 else h(a1p, b1)), (0 if c2p < 1e-12 else h(a2p, b2))
    dl, dc = l2 - l1, c2p - c1p
    dha = h2p - h1p
    if c1p * c2p == 0: dha = 0
    elif dha > 180: dha -= 360
    elif dha < -180: dha += 360
    dh = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(dha / 2))
    ml, mc = (l1 + l2) / 2, (c1p + c2p) / 2
    if c1p * c2p == 0: mh = h1p + h2p
    elif abs(h1p - h2p) <= 180: mh = (h1p + h2p) / 2
    else: mh = (h1p + h2p + (360 if h1p + h2p < 360 else -360)) / 2
    t = 1 - .17 * math.cos(math.radians(mh - 30)) + .24 * math.cos(math.radians(2 * mh)) + .32 * math.cos(math.radians(3 * mh + 6)) - .20 * math.cos(math.radians(4 * mh - 63))
    sl = 1 + .015 * (ml - 50) ** 2 / math.sqrt(20 + (ml - 50) ** 2)
    sc, sh = 1 + .045 * mc, 1 + .015 * mc * t
    dt = 30 * math.exp(-((mh - 275) / 25) ** 2)
    rc = 2 * math.sqrt(mc ** 7 / (mc ** 7 + 25 ** 7)); rt = -rc * math.sin(math.radians(2 * dt))
    lt, ct, ht = dl / sl, dc / sc, dh / sh
    return math.sqrt(max(0, lt * lt + ct * ct + ht * ht + rt * ct * ht))


REFERENCE_LAB = np.stack([_rgb_to_lab(COLOR_HEX[color]) for color in COLORS])


def _unit_id(row: dict, cohort: str, *, color_row: bool) -> str:
    participant = str(row.get("participant", "") or "").strip()
    run = str(row.get("run", "") or "").strip()
    identity_provided = bool(row.get("identityProvided", bool(participant or run)))
    if identity_provided:
        explicit = (participant or run) if cohort == "human" else (run or participant)
        if explicit: return f"id:{explicit}"
    source_row = str(row.get("sourceRow", row.get("row", "")) or "").strip()
    return f"row:{source_row}" if source_row else ""


def _safe_corr(a: np.ndarray, b: np.ndarray, method: str) -> float | None:
    if np.std(a) == 0 or np.std(b) == 0: return None
    value = spearmanr(a, b).statistic if method == "spearman" else pearsonr(a, b).statistic
    return None if not np.isfinite(value) else float(value)


def _summary(values: list[float]) -> dict:
    array = np.asarray(values, dtype=float)
    if not len(array): return {"n": 0, "mean": None, "median": None, "sd": None, "ciLow": None, "ciHigh": None}
    mean = float(array.mean()); sd = float(array.std(ddof=1)) if len(array) > 1 else 0.0
    half = 1.96 * sd / math.sqrt(len(array)) if len(array) > 1 else 0.0
    return {"n": len(array), "mean": mean, "median": float(np.median(array)), "sd": sd, "ciLow": mean - half, "ciHigh": mean + half}


def _matrix_mean(matrices: list[np.ndarray], shape: tuple[int, int]) -> list[list[float]]:
    return (np.mean(np.stack(matrices), axis=0) if matrices else np.zeros(shape)).tolist()


def run_bidirectional(payload: dict) -> dict:
    color_rows = payload.get("colorRows", []); gew_rows = payload.get("gewRows", [])
    permutations = max(1000, int(payload.get("permutations", 1000)))
    primary_tau = float(payload.get("tau", 10)); taus = [5.0, 10.0, 15.0]
    source_order = [str(value) for value in payload.get("sourceOrder", [])]
    color_units: dict[tuple[str, str], list[dict]] = defaultdict(list)
    gew_units: dict[tuple[str, str], list[dict]] = defaultdict(list)
    cohorts: dict[str, str] = {}
    for row in color_rows:
        source = str(row.get("source", "") or ""); cohort = str(row.get("cohort", "unspecified") or "unspecified")
        unit = _unit_id(row, cohort, color_row=True)
        if source and unit: color_units[(source, unit)].append(row); cohorts[source] = cohort
    for row in gew_rows:
        source = str(row.get("source", "") or ""); cohort = str(row.get("cohort", "unspecified") or "unspecified")
        unit = _unit_id(row, cohort, color_row=False)
        if source and unit: gew_units[(source, unit)].append(row); cohorts[source] = cohort
    sources = [s for s in source_order if s in cohorts] + sorted(set(cohorts) - set(source_order))

    qc = []
    complete: list[tuple[str, str, list[dict], list[dict]]] = []
    for source in sources:
        c_ids = {key[1] for key in color_units if key[0] == source}; g_ids = {key[1] for key in gew_units if key[0] == source}
        paired_ids = c_ids & g_ids; complete_ids = []
        for unit in paired_ids:
            crows, grows = color_units[(source, unit)], gew_units[(source, unit)]
            c_complete = set(row.get("emotion") for row in crows) >= set(EMOTIONS)
            valid_pairs = {(row.get("color"), row.get("emotion")) for row in grows if row.get("valid") is True}
            g_complete = len(valid_pairs & {(c, e) for c in COLORS for e in EMOTIONS}) == len(COLORS) * len(EMOTIONS)
            if c_complete and g_complete:
                complete_ids.append(unit); complete.append((source, unit, crows, grows))
        qc.append({"source": source, "cohort": cohorts.get(source, "unspecified"), "task1Units": len(c_ids), "task2Units": len(g_ids), "pairedUnits": len(paired_ids), "completeUnits": len(complete_ids), "excludedIncomplete": len(paired_ids) - len(complete_ids), "task1Only": len(c_ids - g_ids), "task2Only": len(g_ids - c_ids)})

    units = []
    for source, unit, crows, grows in complete:
        color_map = {}
        for emotion in EMOTIONS:
            candidates = [row for row in crows if row.get("emotion") == emotion]
            if candidates: color_map[emotion] = np.array([float(candidates[0]["labL"]), float(candidates[0]["labA"]), float(candidates[0]["labB"])])
        bsel = np.zeros((len(COLORS), len(EMOTIONS))); bstrength = np.zeros_like(bsel)
        for ci, color in enumerate(COLORS):
            for ei, emotion in enumerate(EMOTIONS):
                candidates = [row for row in grows if row.get("color") == color and row.get("emotion") == emotion and row.get("valid") is True]
                if candidates:
                    bsel[ci, ei] = np.mean([float(row.get("selected", 0)) for row in candidates])
                    bstrength[ci, ei] = np.mean([float(row.get("selected", 0)) * float(row.get("intensity", 0)) / 5 for row in candidates])
        distances = np.array([[_delta_e_2000(color_map[e], ref) for ref in REFERENCE_LAB] for e in EMOTIONS])
        tau_results = {}
        for tau in taus:
            weights = np.exp(-distances / tau); a = weights / weights.sum(axis=1, keepdims=True)
            csel, cstrength = a @ bsel, a @ bstrength
            tau_results[str(int(tau))] = {"A": a.tolist(), "CSelection": csel.tolist(), "CStrength": cstrength.tolist(), "meanDiagonalSelection": float(np.diag(csel).mean()), "meanDiagonalStrength": float(np.diag(cstrength).mean())}
        primary = tau_results[str(int(primary_tau))]
        a = np.asarray(primary["A"]); csel = np.asarray(primary["CSelection"]); cstrength = np.asarray(primary["CStrength"])
        seed = int(hashlib.sha256(f"{source}|{unit}|{permutations}".encode()).hexdigest()[:16], 16) % (2 ** 32)
        rng = np.random.default_rng(seed); perms = np.stack([rng.permutation(len(EMOTIONS)) for _ in range(permutations)])
        null_sel = np.einsum("ec,cpe->pe", a, bsel[:, perms]); null_strength = np.einsum("ec,cpe->pe", a, bstrength[:, perms])
        diag_sel, diag_strength = np.diag(csel), np.diag(cstrength)
        ns_mean, nt_mean = null_sel.mean(axis=0), null_strength.mean(axis=0)
        ns_sd, nt_sd = null_sel.std(axis=0, ddof=1), null_strength.std(axis=0, ddof=1)
        off_sel = (csel.sum() - np.trace(csel)) / (csel.size - len(EMOTIONS)); off_strength = (cstrength.sum() - np.trace(cstrength)) / (cstrength.size - len(EMOTIONS))
        emotion_rows = []
        for index, emotion in enumerate(EMOTIONS):
            emotion_rows.append({"emotion": emotion, "selection": float(diag_sel[index]), "selectionNullMean": float(ns_mean[index]), "selectionNullLow": float(np.quantile(null_sel[:, index], .025)), "selectionNullHigh": float(np.quantile(null_sel[:, index], .975)), "selectionExcess": float(diag_sel[index] - ns_mean[index]), "selectionZ": float((diag_sel[index] - ns_mean[index]) / ns_sd[index]) if ns_sd[index] else None, "strength": float(diag_strength[index]), "strengthNullMean": float(nt_mean[index]), "strengthNullLow": float(np.quantile(null_strength[:, index], .025)), "strengthNullHigh": float(np.quantile(null_strength[:, index], .975)), "strengthExcess": float(diag_strength[index] - nt_mean[index]), "strengthZ": float((diag_strength[index] - nt_mean[index]) / nt_sd[index]) if nt_sd[index] else None})
        top_transfers = []
        for i, origin in enumerate(EMOTIONS):
            for j, target in enumerate(EMOTIONS):
                if i != j: top_transfers.append({"from": origin, "to": target, "selection": float(csel[i, j]), "strength": float(cstrength[i, j])})
        top_transfers.sort(key=lambda item: item["strength"], reverse=True)
        null_overall_sel, null_overall_strength = null_sel.mean(axis=1), null_strength.mean(axis=1)
        units.append({"source": source, "cohort": cohorts.get(source, "unspecified"), "unit": unit, "BSelection": bsel.tolist(), "BStrength": bstrength.tolist(), "tau": tau_results, "emotion": emotion_rows, "meanDiagonalSelection": float(diag_sel.mean()), "medianDiagonalSelection": float(np.median(diag_sel)), "meanOffDiagonalSelection": float(off_sel), "dominanceSelection": float(diag_sel.mean() - off_sel), "meanDiagonalStrength": float(diag_strength.mean()), "medianDiagonalStrength": float(np.median(diag_strength)), "meanOffDiagonalStrength": float(off_strength), "dominanceStrength": float(diag_strength.mean() - off_strength), "nullMeanSelection": float(null_overall_sel.mean()), "nullMeanStrength": float(null_overall_strength.mean()), "excessSelection": float(diag_sel.mean() - null_overall_sel.mean()), "excessStrength": float(diag_strength.mean() - null_overall_strength.mean()), "zSelection": float((diag_sel.mean() - null_overall_sel.mean()) / null_overall_sel.std(ddof=1)) if null_overall_sel.std(ddof=1) else None, "zStrength": float((diag_strength.mean() - null_overall_strength.mean()) / null_overall_strength.std(ddof=1)) if null_overall_strength.std(ddof=1) else None, "topTransfers": top_transfers[:20]})

    groups = []
    for source in sources:
        members = [unit for unit in units if unit["source"] == source]
        if not members: continue
        group_emotions = []
        for emotion in EMOTIONS:
            records = [next(row for row in unit["emotion"] if row["emotion"] == emotion) for unit in members]
            group_emotions.append({"emotion": emotion, **{key: _summary([float(row[key]) for row in records if row.get(key) is not None]) for key in ["selection", "selectionExcess", "selectionZ", "strength", "strengthExcess", "strengthZ"]}})
        a_matrices = [np.asarray(unit["tau"][str(int(primary_tau))]["A"]) for unit in members]
        cs_matrices = [np.asarray(unit["tau"][str(int(primary_tau))]["CStrength"]) for unit in members]
        groups.append({"source": source, "cohort": cohorts.get(source, "unspecified"), "n": len(members), "A": _matrix_mean(a_matrices, (20, 11)), "BSelection": _matrix_mean([np.asarray(unit["BSelection"]) for unit in members], (11, 20)), "BStrength": _matrix_mean([np.asarray(unit["BStrength"]) for unit in members], (11, 20)), "CSelection": _matrix_mean([np.asarray(unit["tau"][str(int(primary_tau))]["CSelection"]) for unit in members], (20, 20)), "CStrength": _matrix_mean(cs_matrices, (20, 20)), "emotion": group_emotions, "meanDiagonalSelection": _summary([unit["meanDiagonalSelection"] for unit in members]), "meanDiagonalStrength": _summary([unit["meanDiagonalStrength"] for unit in members]), "dominanceSelection": _summary([unit["dominanceSelection"] for unit in members]), "dominanceStrength": _summary([unit["dominanceStrength"] for unit in members]), "excessSelection": _summary([unit["excessSelection"] for unit in members]), "excessStrength": _summary([unit["excessStrength"] for unit in members]), "zSelection": _summary([unit["zSelection"] for unit in members if unit["zSelection"] is not None]), "zStrength": _summary([unit["zStrength"] for unit in members if unit["zStrength"] is not None]), "sensitivity": {str(int(tau)): _summary([unit["tau"][str(int(tau))]["meanDiagonalStrength"] for unit in members]) for tau in taus}})

    distances = []
    for left in groups:
        for right in groups:
            a, b = np.asarray(left["CStrength"]), np.asarray(right["CStrength"])
            distances.append({"sourceA": left["source"], "sourceB": right["source"], "cohortA": left["cohort"], "cohortB": right["cohort"], "frobenius": float(np.linalg.norm(a - b)), "pearson": _safe_corr(a.ravel(), b.ravel(), "pearson"), "spearman": _safe_corr(a.ravel(), b.ravel(), "spearman")})
    return {"version": 1, "emotions": EMOTIONS, "colors": COLORS, "colorHex": COLOR_HEX, "tau": primary_tau, "taus": taus, "permutations": permutations, "qc": qc, "units": units, "groups": groups, "structureDistances": distances, "methodNote": "A uses CIEDE2000 soft assignment exp(-ΔE00/τ), B is unnormalised selected or selected×intensity/5, and C=A×B. Null distributions permute B emotion labels within each independent unit.", "orderEffectNote": "两个实验的顺序固定，因此本模块描述双向结构与循环一致性；不能把结果解释为实验一对实验二的因果影响或回认验证。"}
