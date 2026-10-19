"""Standalone Matplotlib renderer for Chromalab publication figures.

The browser sends analytical rows only.  This module deliberately has no DOM,
CSS or dashboard concepts: it creates a fresh Matplotlib Figure for each
request and serializes it as PNG (300 dpi) or editable SVG.
"""

from __future__ import annotations

from io import BytesIO
from math import ceil, pi
from typing import Any, Callable, Iterable

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import to_rgba
from matplotlib.patches import Rectangle


PALETTE = ["#277b92", "#d47d55", "#4f8a70", "#8d6b94", "#b9973b", "#5675a7", "#b45d6b", "#657c82"]
GEW_COLOR_HEX = {
    "D38": "#F38EBB", "F17": "#00904A", "F4": "#DD4200", "J0": "#262626", "F0": "#808080",
    "F29": "#007FD3", "A0": "#F2F2F2", "H35": "#6F2A78", "I6": "#4B2819", "G3": "#BB1F23", "C9": "#FFBC00",
}
EMOTIONS = [
    "Interest", "Amusement", "Pride", "Joy", "Pleasure", "Contentment", "Admiration", "Love", "Relief", "Compassion",
    "Sadness", "Guilt", "Regret", "Shame", "Disappointment", "Fear", "Disgust", "Contempt", "Hate", "Anger",
]
GEW_COLORS = ["D38", "F17", "F4", "J0", "F0", "F29", "A0", "H35", "I6", "G3", "C9"]


def _num(row: dict[str, Any], *keys: str) -> float:
    for key in keys:
        value = row.get(key)
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return 0.0


def _text(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value):
            return str(value)
    return ""


def _rows(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key, [])
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _ordered(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def _ordered_sources(payload: dict[str, Any], values: Iterable[str]) -> list[str]:
    """Respect the browser's explicit comparison order when it is supplied.

    Any source newly present in the data but absent from the saved order is
    appended in its first-seen order, so a stale configuration never hides a
    valid source unexpectedly.
    """
    observed = _ordered(values)
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    configured = options.get("sourceOrder", [])
    preferred = [str(source) for source in configured if str(source) in observed] if isinstance(configured, list) else []
    return preferred + [source for source in observed if source not in preferred]


def _overlap_layout(
    points: list[tuple[float, float]],
    enabled: bool,
    *,
    key_of: Callable[[float, float], tuple[float, float]] | None = None,
    unit_per_pixel: tuple[float, float] = (0.012, 0.012),
) -> list[tuple[float, float, int, int]]:
    """Return deterministic display offsets and duplicate counts.

    Offsets are deliberately display-only: input coordinates and all analysis
    calculations remain untouched.  This mirrors the dashboard checkbox while
    making repeated observations visible in the exported publication figure.
    """
    groups: dict[tuple[float, float], list[int]] = {}
    for index, (x, y) in enumerate(points):
        key = key_of(x, y) if key_of else (round(x, 3), round(y, 3))
        groups.setdefault(key, []).append(index)
    layout = [(0.0, 0.0, 1, 0) for _ in points]
    if not enabled:
        return layout
    for indices in groups.values():
        count = len(indices)
        if count < 2:
            continue
        for order, index in enumerate(indices):
            # Match the dashboard: a deterministic golden-angle spiral, with
            # a modest outward step for each repeated observation.  The input
            # coordinate remains unchanged; these offsets exist only on the
            # rendered figure.
            distance_px = min(8.0, 2.25 * np.sqrt(order))
            angle = order * 2.399963229728653  # golden angle
            layout[index] = (
                distance_px * unit_per_pixel[0] * np.cos(angle),
                distance_px * unit_per_pixel[1] * np.sin(angle),
                count,
                order,
            )
    return layout


def _duplicate_groups(
    points: list[tuple[float, float]],
    *,
    key_of: Callable[[float, float], tuple[float, float]] | None = None,
) -> list[list[int]]:
    groups: dict[tuple[float, float], list[int]] = {}
    for index, (x, y) in enumerate(points):
        key = key_of(x, y) if key_of else (round(x, 3), round(y, 3))
        groups.setdefault(key, []).append(index)
    return list(groups.values())


def _core70_bins(
    x_values: list[float] | np.ndarray,
    y_values: list[float] | np.ndarray,
    *,
    bins: tuple[int, int],
    x_range: tuple[float, float],
    y_range: tuple[float, float],
) -> tuple[set[tuple[int, int]], list[bool]]:
    """Return locally dense cells using a relative density cutoff."""
    x = np.asarray(x_values, dtype=float)
    y = np.asarray(y_values, dtype=float)
    if not len(x):
        return set(), []
    x_span, y_span = x_range[1] - x_range[0], y_range[1] - y_range[0]
    x_index = np.clip(((x - x_range[0]) / x_span * bins[0]).astype(int), 0, bins[0] - 1)
    y_index = np.clip(((y - y_range[0]) / y_span * bins[1]).astype(int), 0, bins[1] - 1)
    counts = np.zeros(bins, dtype=int)
    for x_bin, y_bin in zip(x_index, y_index):
        counts[x_bin, y_bin] += 1
    peak = max(1, int(np.max(counts)))
    selected = {(int(x_bin), int(y_bin)) for x_bin, y_bin in zip(*np.where(counts / peak >= .18))}
    return selected, [(int(x_bin), int(y_bin)) in selected for x_bin, y_bin in zip(x_index, y_index)]


def _nearest_alpha(points: list[tuple[float, float]]) -> list[float]:
    """Map H–S nearest-neighbour distance to display opacity (near = dark)."""
    if len(points) < 2:
        return [.82] * len(points)
    values = np.asarray(points, dtype=float)
    distances = []
    for index, point in enumerate(values):
        other = np.delete(values, index, axis=0)
        distances.append(float(np.min(np.hypot(other[:, 0] - point[0], other[:, 1] - point[1]))))
    low, high = np.quantile(distances, [.05, .9])
    spread = max(1e-6, high - low)
    return [float(.14 + .72 * (1 - np.clip((distance - low) / spread, 0, 1))) for distance in distances]


def _hex_to_hsv(value: str) -> tuple[float, float, float] | None:
    value = value.strip().lstrip("#")
    if len(value) != 6:
        return None
    try:
        red, green, blue = (int(value[index:index + 2], 16) / 255 for index in (0, 2, 4))
    except ValueError:
        return None
    maximum, minimum = max(red, green, blue), min(red, green, blue)
    delta = maximum - minimum
    if delta == 0:
        hue = 0.0
    elif maximum == red:
        hue = (60 * ((green - blue) / delta) + 360) % 360
    elif maximum == green:
        hue = 60 * ((blue - red) / delta + 2)
    else:
        hue = 60 * ((red - green) / delta + 4)
    return hue, (0.0 if maximum == 0 else delta / maximum), maximum


def _style() -> None:
    plt.rcParams.update({
        # macOS includes Times New Roman in its Supplemental fonts.  The
        # explicit fallbacks keep all English labels renderable if this local
        # service is moved to a machine without that family installed.
        "font.family": ["Times New Roman", "Times", "DejaVu Serif"],
        "font.size": 10,
        "axes.titlesize": 13,
        "axes.labelsize": 10,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "legend.fontsize": 9,
        "axes.linewidth": 0.75,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "svg.fonttype": "none",
    })


def _figure(payload: dict[str, Any], aspect: float = 0.58) -> tuple[plt.Figure, int]:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    # The width is the actual PNG pixel width at 300 dpi.  Keep a generous
    # upper bound for poster / wide multi-panel figures while protecting the
    # local renderer from accidental impractically large canvases.
    width_px = max(1200, min(7200, int(options.get("width", 4200))))
    width_inches = width_px / 300
    figure = plt.figure(figsize=(width_inches, max(3.4, width_inches * aspect)), constrained_layout=True)
    return figure, width_px


def _finish(figure: plt.Figure, payload: dict[str, Any]) -> bytes:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    fmt = str(options.get("format", "png")).lower()
    if fmt not in {"png", "svg"}:
        raise ValueError("仅支持 PNG 或 SVG。")
    output = BytesIO()
    save = {"format": fmt, "facecolor": "white", "edgecolor": "none", "bbox_inches": "tight", "pad_inches": 0.08}
    if fmt == "png":
        save["dpi"] = 300
    figure.savefig(output, **save)
    plt.close(figure)
    return output.getvalue()


def _title(figure: plt.Figure, payload: dict[str, Any], fallback: str) -> None:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    if options.get("showTitle", True):
        figure.suptitle(str(options.get("title") or fallback), fontsize=17, fontweight="bold")


def _source_facets(rows: list[dict[str, Any]], payload: dict[str, Any], kind: str) -> plt.Figure:
    sources = _ordered_sources(payload, (_text(row, "source", "来源") for row in rows))
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    # K-means is fitted in CIELAB.  Its centres are therefore shown only on
    # the matching a*–b* view, never projected misleadingly into H–S / V–S.
    clusters = _rows(payload, "clusters") if kind == "lab-ab-density" and options.get("showClusters", False) else []
    columns = max(2, min(5, int(options.get("columns", 4))))
    nrows = max(1, ceil(len(sources) / columns))
    figure, _ = _figure(payload, max(0.34, nrows / columns * 0.72))
    # The Lab dashboard deliberately uses one common a*/b* scale for every
    # source.  Derive it once here too so exported facets retain the same
    # spatial meaning and can be compared directly.
    lab_limit = 40.0
    if kind == "lab-ab-density":
        lab_extent = max([abs(_num(row, "labA", "a星", "a*")) for row in rows] + [abs(_num(row, "labB", "b星", "b*")) for row in rows] + [1.0])
        lab_limit = max(40.0, float(ceil(lab_extent / 20.0) * 20))
    lab_chroma_limit = max(40.0, float(ceil(max([np.hypot(_num(row, "labA", "a星", "a*"), _num(row, "labB", "b星", "b*")) for row in rows] + [1.0]) / 20.0) * 20))
    lab_polar = kind == "lab-ab-density" and str(options.get("labCoordinateSystem", "cartesian")) == "polar"
    subplot_kw = {"projection": "polar"} if kind == "hs-polar" or lab_polar else {}
    axes = figure.subplots(nrows, columns, squeeze=False, subplot_kw=subplot_kw)
    for index, source in enumerate(sources):
        axis = axes.flat[index]
        group = [row for row in rows if _text(row, "source", "来源") == source]
        source_clusters = [row for row in clusters if _text(row, "来源", "source") == source]
        overlap_mode = str(options.get("overlapMode", "raw"))
        if overlap_mode not in {"raw", "labels", "rings", "bubbles", "density"}:
            overlap_mode = "raw"
        point_emphasis = str(options.get("pointEmphasis", "normal"))
        if point_emphasis not in {"normal", "core70", "proximity"}:
            point_emphasis = "normal"
        show_centroids = bool(options.get("showCentroids", True))
        expand_overlaps = overlap_mode == "labels"
        if kind == "hs-polar":
            theta = np.deg2rad([_num(row, "hsvH", "HSV_H") for row in group])
            radius = [_num(row, "hsvS", "HSV_S") for row in group]
            colors = [f"#{_text(row, 'hex', 'HEX').lstrip('#')}" if len(_text(row, "hex", "HEX").lstrip("#")) == 6 else PALETTE[index % len(PALETTE)] for row in group]
            points = list(zip(theta, radius))
            # Keep exactly the same duplicate definition and screen-space
            # expansion scale as the H–S preview in the dashboard.
            hs_key = lambda angle, saturation: (round(float(np.rad2deg(angle)) % 360, 2), round(saturation, 3))
            layout = _overlap_layout(points, expand_overlaps, key_of=hs_key, unit_per_pixel=(1 / 80, 1 / 80))
            theta_display, radius_display = [], []
            for base_theta, base_radius, (dx, dy, _, _) in zip(theta, radius, layout):
                x, y = base_radius * np.cos(base_theta) + dx, base_radius * np.sin(base_theta) + dy
                theta_display.append(np.arctan2(y, x)); radius_display.append(float(np.hypot(x, y)))
            cartesian_points = [(float(r * np.cos(t)), float(r * np.sin(t))) for t, r in zip(theta, radius)]
            if point_emphasis == "core70":
                axis.hist2d(theta % (2 * pi), radius, bins=(24, 10), range=[[0, 2 * pi], [0, 1]], cmap="Blues", cmin=1, alpha=.42, zorder=1)
                axis.scatter(theta_display, radius_display, s=16, c=colors, alpha=.74 if expand_overlaps else .68, linewidths=0, zorder=3)
            elif overlap_mode == "density":
                axis.hist2d(theta % (2 * pi), radius, bins=(24, 10), range=[[0, 2 * pi], [0, 1]], cmap="Blues", cmin=1, alpha=.58)
                axis.text(.03, .03, "2D density / bin count", transform=axis.transAxes, fontsize=8, color="#345667")
            elif point_emphasis == "proximity":
                point_colors = [(*to_rgba(color)[:3], alpha) for color, alpha in zip(colors, _nearest_alpha(cartesian_points))]
                axis.scatter(theta_display, radius_display, s=16, c=point_colors, linewidths=0, zorder=3)
            elif overlap_mode == "bubbles":
                groups = _duplicate_groups(points, key_of=hs_key)
                axis.scatter([theta[group[0]] for group in groups], [radius[group[0]] for group in groups], s=[18 + 12 * len(group) for group in groups], c=[colors[group[0]] for group in groups], alpha=.72, linewidths=.25, edgecolors="white")
                axis.text(.03, .03, "Bubble area ∝ duplicate count", transform=axis.transAxes, fontsize=8, color="#345667")
            elif point_emphasis not in {"core70", "proximity"}:
                axis.scatter(theta_display, radius_display, s=16, c=colors, alpha=.68, linewidths=0)
                if overlap_mode == "rings":
                    groups = _duplicate_groups(points, key_of=hs_key)
                    repeated = [group for group in groups if len(group) > 1]
                    if repeated:
                        axis.scatter([theta[group[0]] for group in repeated], [radius[group[0]] for group in repeated], s=[18 + 11 * len(group) for group in repeated], facecolors="none", edgecolors="#173f52", linewidths=1.1, zorder=7)
                    axis.text(.03, .03, "Ring area ∝ duplicate count", transform=axis.transAxes, fontsize=8, color="#345667")
            if expand_overlaps:
                for label_index, (base_theta, base_radius, (_, _, count, order)) in enumerate(zip(theta, radius, layout)):
                    if count > 1 and order == 0:
                        direction = 1 if np.cos(base_theta) >= 0 else -1
                        axis.annotate(
                            f"×{count}", xy=(base_theta, base_radius),
                            xytext=(direction * (9 + label_index % 3 * 3), -10 - label_index % 2 * 7),
                            textcoords="offset points", ha="center", va="center", zorder=8,
                            fontsize=10, fontweight="bold", color="#173f52",
                            bbox={"boxstyle": "round,pad=0.13", "facecolor": "white", "edgecolor": "none", "alpha": .88},
                        )
            axis.set_theta_zero_location("E"); axis.set_theta_direction(-1); axis.set_ylim(0, 1)
            axis.set_yticklabels([]); axis.grid(color="#bfc6c8", linewidth=.55)
            axis.spines["polar"].set_linewidth(.75)
        elif kind == "vs-density":
            x, y = [_num(row, "hsvS", "HSV_S") for row in group], [_num(row, "hsvV", "HSV_V") for row in group]
            points = list(zip(x, y))
            vs_key = lambda saturation, value: (round(saturation, 3), round(value, 3))
            if point_emphasis == "core70":
                axis.hexbin(x, y, gridsize=12, extent=(0, 1, 0, 1), mincnt=1, cmap="Blues", linewidths=.25, edgecolors="white", alpha=.42, zorder=1)
            elif overlap_mode == "density":
                axis.hexbin(x, y, gridsize=14, extent=(0, 1, 0, 1), mincnt=1, cmap="Blues", linewidths=.25, edgecolors="white")
                axis.text(.03, .03, "Hexbin count", transform=axis.transAxes, fontsize=8, color="#345667")
            elif len(x) > 4:
                axis.hist2d(x, y, bins=16, range=[[0, 1], [0, 1]], cmap="Blues", cmin=1, alpha=.42)
            # The dashboard V–S canvas is 204 × 168 px.  Convert its visual
            # offsets into the normalized Matplotlib coordinate system.
            layout = _overlap_layout(points, expand_overlaps, key_of=vs_key, unit_per_pixel=(1 / 204, 1 / 168))
            x_display = [value + offset[0] for value, offset in zip(x, layout)]
            y_display = [value + offset[1] for value, offset in zip(y, layout)]
            if overlap_mode == "bubbles":
                groups = _duplicate_groups(points, key_of=vs_key)
                axis.scatter([x[group[0]] for group in groups], [y[group[0]] for group in groups], s=[18 + 12 * len(group) for group in groups], c=PALETTE[index % len(PALETTE)], alpha=.72, linewidths=.25, edgecolors="white")
                axis.text(.03, .03, "Bubble area ∝ duplicate count", transform=axis.transAxes, fontsize=8, color="#345667")
            elif point_emphasis == "core70" or overlap_mode != "density":
                axis.scatter(x_display, y_display, s=14, c=PALETTE[index % len(PALETTE)], alpha=.68 if point_emphasis == "core70" else .65, linewidths=0, zorder=3)
                if overlap_mode == "rings":
                    groups = _duplicate_groups(points, key_of=vs_key)
                    repeated = [group for group in groups if len(group) > 1]
                    if repeated:
                        axis.scatter([x[group[0]] for group in repeated], [y[group[0]] for group in repeated], s=[18 + 11 * len(group) for group in repeated], facecolors="none", edgecolors="#173f52", linewidths=1.1, zorder=7)
                    axis.text(.03, .03, "Ring area ∝ duplicate count", transform=axis.transAxes, fontsize=8, color="#345667")
            if expand_overlaps:
                for label_index, (base_x, base_y, (_, _, count, order)) in enumerate(zip(x, y, layout)):
                    if count > 1 and order == 0:
                        direction = 1 if base_x < .5 else -1
                        axis.annotate(
                            f"×{count}", (base_x, base_y),
                            xytext=(direction * (9 + label_index % 3 * 3), -10 - label_index % 2 * 7),
                            textcoords="offset points", ha="center", va="center", zorder=8,
                            fontsize=10, fontweight="bold", color="#173f52",
                            bbox={"boxstyle": "round,pad=0.13", "facecolor": "white", "edgecolor": "none", "alpha": .88},
                        )
            axis.set(xlim=(0, 1), ylim=(0, 1), xlabel="Saturation", ylabel="Value")
        else:
            x, y = [_num(row, "labA", "a星", "a*") for row in group], [_num(row, "labB", "b星", "b*") for row in group]
            # Match the browser Lab a*–b* view: true picked HEX colours,
            # shared square limits, optional square density cells, and no
            # per-panel auto-scaling.
            colors = [f"#{_text(row, 'hex', 'HEX').lstrip('#')}" if len(_text(row, "hex", "HEX").lstrip("#")) == 6 else PALETTE[index % len(PALETTE)] for row in group]
            show_lab_density = bool(options.get("showLabDensity", True))
            if lab_polar:
                theta = np.arctan2(y, x)
                chroma = np.hypot(x, y)
                if show_lab_density and len(theta):
                    theta_edges = np.linspace(0, 2 * pi, 19)
                    chroma_edges = np.linspace(0, lab_chroma_limit, 9)
                    counts, _, _ = np.histogram2d(theta % (2 * pi), chroma, bins=(theta_edges, chroma_edges))
                    peak = max(1.0, float(np.max(counts)))
                    for theta_index in range(18):
                        for chroma_index in range(8):
                            count = counts[theta_index, chroma_index]
                            if count:
                                axis.bar(
                                    theta_edges[theta_index] + (theta_edges[1] - theta_edges[0]) / 2,
                                    chroma_edges[chroma_index + 1] - chroma_edges[chroma_index],
                                    width=theta_edges[1] - theta_edges[0], bottom=chroma_edges[chroma_index],
                                    color="#277b92", alpha=.06 + .48 * float(count) / peak,
                                    edgecolor="none", align="center", zorder=1,
                                )
                axis.scatter(theta, chroma, s=15, c=colors, alpha=.64, linewidths=0, zorder=4)
                if show_centroids and x and y:
                    center_a, center_b = float(np.mean(x)), float(np.mean(y))
                    axis.scatter(np.arctan2(center_b, center_a), np.hypot(center_a, center_b), s=106, c="white", alpha=.9, linewidths=0, zorder=7)
                    axis.scatter(np.arctan2(center_b, center_a), np.hypot(center_a, center_b), s=36, c="#203c48", edgecolors="white", linewidths=1.0, zorder=8)
                for cluster in source_clusters:
                    center_a, center_b = _num(cluster, "中心a", "centerA"), _num(cluster, "中心b", "centerB")
                    weight = max(0.0, _num(cluster, "簇权重", "weight"))
                    color = f"#{_text(cluster, '中心HEX', 'centerHex').lstrip('#')}"
                    axis.scatter(np.arctan2(center_b, center_a), np.hypot(center_a, center_b), marker="X", s=50 + 150 * weight, c=[color], edgecolors="#172e39", linewidths=1.0, zorder=9)
                axis.set_theta_zero_location("E"); axis.set_theta_direction(1); axis.set_ylim(0, lab_chroma_limit)
                axis.set_xticks([0, pi / 2, pi, 3 * pi / 2], ["+a* Red", "+b* Yellow", "−a* Green", "−b* Blue"], fontsize=7)
                axis.set_yticklabels([]); axis.grid(color="#bfc6c8", linewidth=.55); axis.spines["polar"].set_linewidth(.75)
                axis.set_title(source, color=PALETTE[index % len(PALETTE)], fontweight="bold")
                continue
            bins = 14
            if show_lab_density and x and y:
                edges = np.linspace(-lab_limit, lab_limit, bins + 1)
                counts, _, _ = np.histogram2d(x, y, bins=(edges, edges))
                peak = max(1.0, float(np.max(counts)))
                cell = (lab_limit * 2) / bins
                for xi in range(bins):
                    for yi in range(bins):
                        count = counts[xi, yi]
                        if count:
                            axis.add_patch(Rectangle(
                                (edges[xi], edges[yi]), cell, cell,
                                facecolor="#277b92", edgecolor="none",
                                alpha=.06 + .48 * float(count) / peak,
                                zorder=1,
                            ))
            axis.scatter(x, y, s=15, c=colors, alpha=.64, linewidths=0, zorder=4)
            axis.axhline(0, color="#6e8086", lw=.75, ls=(0, (4, 3)), zorder=2)
            axis.axvline(0, color="#6e8086", lw=.75, ls=(0, (4, 3)), zorder=2)
            axis.set_xlim(-lab_limit, lab_limit); axis.set_ylim(-lab_limit, lab_limit)
            axis.set_aspect("equal", adjustable="box")
            for spine in axis.spines.values():
                spine.set_color("#9ba9ac"); spine.set_linewidth(.8)
            axis.set_xticks([]); axis.set_yticks([])
            if show_centroids and x and y:
                center_a, center_b = float(np.mean(x)), float(np.mean(y))
                axis.scatter(center_a, center_b, s=106, c="white", alpha=.9, linewidths=0, zorder=7)
                axis.scatter(center_a, center_b, s=36, c="#203c48", edgecolors="white", linewidths=1.0, zorder=8)
            for cluster in source_clusters:
                center_a, center_b = _num(cluster, "中心a", "centerA"), _num(cluster, "中心b", "centerB")
                weight = max(0.0, _num(cluster, "簇权重", "weight"))
                color = f"#{_text(cluster, '中心HEX', 'centerHex').lstrip('#')}"
                axis.scatter(center_a, center_b, marker="X", s=50 + 150 * weight, c=[color], edgecolors="#172e39", linewidths=1.0, zorder=9)
            axis.text(0, -0.08, "Green  −a*                              +a*  Red", transform=axis.transAxes, ha="center", fontsize=7, color="#718087")
            axis.text(-0.065, .5, "Yellow\n\n\n\nBlue", transform=axis.transAxes, ha="center", va="center", fontsize=7, color="#718087")
        axis.set_title(source, color=PALETTE[index % len(PALETTE)], fontweight="bold")
    for axis in axes.flat[len(sources):]:
        axis.set_visible(False)
    _title(figure, payload, {"hs-polar": "Hue–Saturation Distribution", "vs-density": "Value–Saturation Distribution"}.get(kind, "CIELAB a*–b* Distribution"))
    return figure


def _heatmap(axis: plt.Axes, matrix: np.ndarray, xlabels: list[str], ylabels: list[str], title: str, cmap: str = "viridis", center: float | None = None) -> None:
    if center is not None:
        limit = max(1e-8, float(np.nanmax(np.abs(matrix))))
        image = axis.imshow(matrix, cmap=cmap, vmin=-limit, vmax=limit, aspect="auto")
    else:
        image = axis.imshow(matrix, cmap=cmap, aspect="auto")
    axis.set_xticks(range(len(xlabels)), xlabels, rotation=45, ha="right")
    axis.set_yticks(range(len(ylabels)), ylabels)
    axis.set_title(title, fontweight="bold")
    axis.figure.colorbar(image, ax=axis, fraction=.035, pad=.02)


def _pair_name(row: dict[str, Any]) -> str:
    return " – ".join(sorted(filter(None, [_text(row, "来源A", "sourceA"), _text(row, "来源B", "sourceB")])))


def _delta_value(row: dict[str, Any]) -> float:
    return _num(row, "对称最小ΔE76", "deltaE", "ΔE76")


def _task1_delta(payload: dict[str, Any], kind: str, data: list[dict[str, Any]]) -> plt.Figure:
    """Dedicated ΔE figures.  These must never fall back to sample-count fields."""
    figure, _ = _figure(payload, .60 if kind not in {"delta-box", "dumbbell"} else .72)
    if kind == "within-delta":
        axes = figure.subplots(1, 2, squeeze=False).flat
        sources = _ordered_sources(payload, (_text(row, "来源", "source") for row in data))
        emotions = [emotion for emotion in EMOTIONS if any(_text(row, "情绪", "emotion") == emotion for row in data)]
        for metric_index, (field, label) in enumerate((("平均最近邻ΔE76", "Mean nearest-neighbour ΔE76"), ("全部样本对平均ΔE76", "Mean all-pairs ΔE76"))):
            axis = axes[metric_index]
            for index, source in enumerate(sources):
                values = [_num(next((row for row in data if _text(row, "来源", "source") == source and _text(row, "情绪", "emotion") == emotion), {}), field) for emotion in emotions]
                axis.plot(emotions, values, marker="o", ms=3.5, lw=1.2, label=source, color=PALETTE[index % len(PALETTE)])
            axis.set(title=label, ylabel="ΔE76"); axis.tick_params(axis="x", rotation=50); axis.grid(axis="y", color="#e1e5e5", lw=.65)
        axes[0].legend(frameon=False, ncol=min(4, len(sources)))
    else:
        pairs = _ordered(_pair_name(row) for row in data)
        emotions = [emotion for emotion in EMOTIONS if any(_text(row, "情绪", "emotion") == emotion for row in data)]
        matrix = np.array([[_delta_value(next((row for row in data if _pair_name(row) == pair and _text(row, "情绪", "emotion") == emotion), {})) for emotion in emotions] for pair in pairs])
        if kind == "delta-heatmap":
            axis = figure.add_subplot(111)
            _heatmap(axis, matrix, emotions, pairs, "Pairwise ΔE76 by emotion", "YlOrRd")
        elif kind == "delta-box":
            axis = figure.add_subplot(111)
            values = [matrix[index][np.isfinite(matrix[index])] for index in range(len(pairs))]
            axis.boxplot(values, vert=False, labels=pairs, patch_artist=True, boxprops={"facecolor": "#a6c9d2", "edgecolor": "#2c6578"}, medianprops={"color": "#b14343", "linewidth": 1.5}, flierprops={"marker": "o", "markersize": 3, "markerfacecolor": "#2c6578", "markeredgewidth": 0})
            axis.set(xlabel="ΔE76", title="ΔE76 distribution across emotions"); axis.grid(axis="x", color="#e1e5e5", lw=.65)
        elif kind == "delta-mean":
            axis = figure.add_subplot(111)
            means = np.nanmean(matrix, axis=1); sds = np.nanstd(matrix, axis=1)
            order = np.argsort(means)
            axis.barh([pairs[i] for i in order], means[order], xerr=sds[order], color=[PALETTE[i % len(PALETTE)] for i in order], alpha=.85, capsize=3)
            axis.set(xlabel="Mean ΔE76 ± SD", title="Mean pairwise ΔE76 across emotions"); axis.grid(axis="x", color="#e1e5e5", lw=.65)
        elif kind == "radar":
            axis = figure.add_subplot(111, projection="polar")
            theta = np.linspace(0, 2 * pi, len(emotions), endpoint=False)
            for index, pair in enumerate(pairs[:8]):
                values = matrix[index]
                axis.plot(np.r_[theta, theta[0]], np.r_[values, values[0]], lw=1.2, label=pair, color=PALETTE[index % len(PALETTE)])
            axis.set_xticks(theta, emotions, fontsize=8); axis.set_title("Emotion-specific pairwise ΔE76", pad=18, fontweight="bold"); axis.legend(loc="upper left", bbox_to_anchor=(1.05, 1.08), frameon=False)
        else:  # dumbbell
            axis = figure.add_subplot(111)
            means_by_emotion = np.nanmean(matrix, axis=0)
            order = np.argsort(means_by_emotion)[::-1]
            for rank, emotion_index in enumerate(order):
                values = matrix[:, emotion_index]
                axis.hlines(rank, np.nanmin(values), np.nanmax(values), color="#b9c6c8", lw=1)
                axis.scatter(values, np.full(len(values), rank), s=22, c=PALETTE[:len(values)], zorder=3)
            axis.set(yticks=range(len(order)), yticklabels=[emotions[i] for i in order], xlabel="ΔE76", title="Range of pairwise ΔE76 by emotion")
            axis.grid(axis="x", color="#e1e5e5", lw=.65)
    _title(figure, payload, kind.replace("-", " ").title())
    return figure


def _task1(payload: dict[str, Any]) -> plt.Figure:
    kind = str(payload.get("kind", "hs-polar"))
    rows = _rows(payload, "rows")
    data = _rows(payload, "data") or rows
    if kind == "continuous-lab":
        continuous_payload = dict(payload)
        continuous_payload["options"] = {**(payload.get("options") or {}), "showCentroids": False, "showLabDensity": False, "showClusters": False, "labCoordinateSystem": "cartesian"}
        return _source_facets(rows, continuous_payload, "lab-ab-density")
    if kind == "hue-histogram":
        sources = _ordered_sources(payload, (_text(row, "source", "来源") for row in rows))
        columns = max(2, min(5, int((payload.get("options") or {}).get("columns", 4))))
        nrows = max(1, ceil(len(sources) / columns))
        figure, _ = _figure(payload, max(.34, nrows / columns * .62))
        axes = figure.subplots(nrows, columns, squeeze=False)
        edges = np.linspace(0, 360, 37)
        centres = (edges[:-1] + edges[1:]) / 2
        for index, source in enumerate(sources):
            axis = axes.flat[index]
            group = [row for row in rows if _text(row, "source", "来源") == source]
            hue = np.asarray([_num(row, "hsvH", "H_HSV_度") for row in group if _num(row, "hsvS", "S_HSV") > .01], dtype=float) % 360
            counts, _ = np.histogram(hue, bins=edges)
            probability = counts / max(1, counts.sum())
            # Circular three-bin smoothing is descriptive and preserves the
            # 0°/360° adjacency; raw 10° bars remain visible underneath.
            extended = np.r_[probability[-1], probability, probability[0]]
            smooth = np.convolve(extended, [.25, .5, .25], mode="same")[1:-1]
            bar_colors = [plt.cm.hsv(value / 360) for value in centres]
            axis.bar(centres, probability, width=10, color=bar_colors, alpha=.58, edgecolor="none")
            axis.plot(np.r_[centres, centres[0] + 360], np.r_[smooth, smooth[0]], color="#263d47", lw=1.35)
            axis.set(xlim=(0, 360), xticks=[0, 90, 180, 270, 360], xlabel="Hue (degrees)", ylabel="Probability")
            axis.grid(axis="y", color="#e1e5e5", lw=.65)
            axis.set_title(f"{source}  n={len(hue)}", color=PALETTE[index % len(PALETTE)], fontweight="bold")
        for axis in axes.flat[len(sources):]: axis.set_visible(False)
        _title(figure, payload, "Continuous Hue Distribution")
        return figure
    if kind == "representative-palette":
        sources = _ordered_sources(payload, (_text(row, "来源", "source") for row in data))
        figure, _ = _figure(payload, max(.30, .09 * max(3, len(sources))))
        axis = figure.add_subplot(111)
        for y, source in enumerate(sources):
            parts = sorted([row for row in data if _text(row, "来源", "source") == source], key=lambda row: _num(row, "代表色序号"))
            left = 0.0
            for part in parts:
                weight = max(0.0, _num(part, "比例"))
                color = f"#{_text(part, '中心HEX').lstrip('#')}"
                axis.barh(y, weight, left=left, height=.68, color=color, edgecolor="white", linewidth=1)
                if weight >= .075: axis.text(left + weight / 2, y, f"{weight:.0%}", ha="center", va="center", fontsize=9, color="black")
                left += weight
        axis.set(yticks=range(len(sources)), yticklabels=sources, xlim=(0, 1), xlabel="Proportion of observations")
        axis.invert_yaxis(); axis.grid(False)
        for spine in ("top", "right", "left"): axis.spines[spine].set_visible(False)
        _title(figure, payload, "Representative Colors (K≤3, descriptive only)")
        return figure
    if kind == "distribution-entropy":
        ordered = sorted(data, key=lambda row: _num(row, "标准化色相熵"), reverse=True)
        figure, _ = _figure(payload, max(.34, .085 * max(4, len(ordered))))
        axis = figure.add_subplot(111)
        labels = [_text(row, "来源", "source") for row in ordered]
        values = [_num(row, "标准化色相熵") for row in ordered]
        colors = [PALETTE[index % len(PALETTE)] for index in range(len(ordered))]
        axis.barh(range(len(ordered)), values, color=colors, alpha=.86)
        axis.set(yticks=range(len(ordered)), yticklabels=labels, xlim=(0, 1), xlabel="Normalized hue entropy (36 × 10° bins)")
        axis.invert_yaxis(); axis.grid(axis="x", color="#e1e5e5", lw=.65)
        for y, value in enumerate(values): axis.text(min(.985, value + .012), y, f"{value:.3f}", va="center", fontsize=8)
        _title(figure, payload, "Hue Distribution Entropy")
        return figure
    if kind in {"hs-polar", "vs-density", "lab-ab-density"}:
        return _source_facets(rows, payload, kind)
    if kind in {"within-delta", "delta-heatmap", "delta-box", "delta-mean", "radar", "dumbbell"}:
        return _task1_delta(payload, kind, data)
    figure, _ = _figure(payload)
    axis = figure.add_subplot(111)
    if kind == "lab-distribution":
        sources = _ordered_sources(payload, (_text(row, "source", "来源") for row in rows))
        for index, source in enumerate(sources):
            values = [_num(row, "labL", "L星", "L*") for row in rows if _text(row, "source", "来源") == source]
            if values: axis.hist(values, bins=18, density=True, histtype="step", lw=1.4, color=PALETTE[index % len(PALETTE)], label=source)
        axis.set(xlabel="CIELAB L*", ylabel="Density"); axis.legend(frameon=False, ncol=min(4, len(sources)))
        _title(figure, payload, "CIELAB Lightness Distribution")
        return figure
    if kind == "mosaic":
        colors = [_text(row, "hex", "HEX") for row in rows][:500]
        columns = 25; grid = np.ones((ceil(max(1, len(colors)) / columns), columns, 3))
        for index, value in enumerate(colors):
            value = value.lstrip("#")
            if len(value) == 6:
                grid[index // columns, index % columns] = [int(value[i:i+2], 16) / 255 for i in (0, 2, 4)]
        axis.imshow(grid, aspect="auto"); axis.set_axis_off(); _title(figure, payload, "Raw Color Mosaic")
        return figure
    categories = _ordered(_text(row, "情绪", "emotion", "来源A", "source") for row in data)[:24]
    numeric_keys = _ordered(key for row in data for key, value in row.items() if isinstance(value, (int, float)) or (isinstance(value, str) and value.replace(".", "", 1).replace("-", "", 1).isdigit()))
    preferred_metric = {
        "cluster-strip": "簇权重",
        "parity": "对称最小ΔE76", "gravity": "对称最小ΔE76", "slopegraph": "对称最小ΔE76",
        "rank-heatmap": "对称最小ΔE76", "difficulty-heatmap": "对称最小ΔE76",
        "bias-bars": "偏置指数_B减A", "bias-density": "偏置指数_B减A",
    }.get(kind)
    metric_key = preferred_metric if preferred_metric in numeric_keys else (numeric_keys[0] if numeric_keys else "value")
    values = [_num(next((row for row in data if _text(row, "情绪", "emotion", "来源A", "source") == category), {}), metric_key) for category in categories]
    if "heatmap" in kind:
        pairwise = any(_pair_name(row) for row in data)
        ylabels = (_ordered(_pair_name(row) for row in data) if pairwise else _ordered(_text(row, "来源A", "source", "来源") for row in data))[:12] or ["All"]
        matrix = np.array([[_num(next((row for row in data if ((_pair_name(row) if pairwise else _text(row, "来源A", "source", "来源")) == y) and _text(row, "情绪", "emotion") == x), {}), metric_key) for x in categories] for y in ylabels])
        _heatmap(axis, matrix, categories, ylabels, kind.replace("-", " ").title(), "RdBu_r" if "rank" in kind else "viridis")
    else:
        axis.plot(range(len(categories)), values, marker="o", lw=1.35, color=PALETTE[0])
        axis.set_xticks(range(len(categories)), categories, rotation=45, ha="right")
        axis.set_ylabel(metric_key)
        axis.grid(axis="y", color="#e1e5e5", lw=.65)
        axis.set_title(kind.replace("-", " ").title(), fontweight="bold")
    _title(figure, payload, kind.replace("-", " ").title())
    return figure


def _task2(payload: dict[str, Any]) -> plt.Figure:
    cells = _rows(payload, "cells")
    raw_rows = _rows(payload, "rows")
    analysis = _rows(payload, "data")
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    kind = str(payload.get("kind", "task2-07"))
    metric = str(options.get("metric", "probability"))
    sources = _ordered_sources(payload, (_text(row, "source", "来源") for row in cells))
    observed_colors = _ordered(_text(row, "color", "颜色") for row in cells)
    colors = [color for color in GEW_COLORS if color in observed_colors] + [color for color in observed_colors if color not in GEW_COLORS]
    emotions = [emotion for emotion in EMOTIONS if any(_text(row, "emotion", "情绪") == emotion for row in cells)]
    selected_color = str(options.get("selectedColor") or (colors[0] if colors else ""))
    selected_emotion = str(options.get("selectedEmotion") or (emotions[0] if emotions else ""))
    selected_source = str(options.get("selectedSource") or (sources[0] if sources else ""))
    source_a = str(options.get("sourceA") or (sources[0] if sources else ""))
    source_b = str(options.get("sourceB") or (sources[1] if len(sources) > 1 else ""))
    pairing_mode = str(options.get("pairingMode", "all"))
    cohorts = options.get("sourceCohorts", {}) if isinstance(options.get("sourceCohorts"), dict) else {}

    def cell_value(source: str, color: str, emotion: str, field: str = metric) -> float:
        row = next((item for item in cells if _text(item, "source", "来源") == source and _text(item, "color", "颜色") == color and _text(item, "emotion", "情绪") == emotion), {})
        return _num(row, field)

    def excluded(first: str, second: str) -> bool:
        return pairing_mode == "cross-cohort" and first != second and cohorts.get(first) == cohorts.get(second) and cohorts.get(first) in {"human", "ai"}

    figure, _ = _figure(payload, .66)
    if kind == "task2-01":
        axis = figure.add_subplot(111)
        values = [cell_value(source, selected_color, selected_emotion) for source in sources]
        order = list(np.argsort(values)[::-1])
        ordered_sources = [sources[index] for index in order][::-1]
        ordered_values = [values[index] for index in order][::-1]
        axis.barh(ordered_sources, ordered_values, color=[PALETTE[index % len(PALETTE)] for index in order][::-1])
        maximum = 1 if metric == "probability" else 5
        axis.set_xlim(0, maximum); axis.set_xlabel(metric.replace("probability", "Association probability"))
        axis.set_title(f"Eight-group comparison · {selected_color} × {selected_emotion}", fontweight="bold")
        for index, value in enumerate(ordered_values): axis.text(value, index, f" {value:.2f}", va="center", fontsize=9)
        axis.grid(axis="x", color="#e1e5e5", lw=.65)
    elif kind == "task2-02":
        axis = figure.add_subplot(111)
        matrix = np.full((len(sources), len(sources)), np.nan)
        significant: set[tuple[str, str]] = set()
        for row in analysis:
            if _num(row, "FDR_q值") < .05:
                significant.add((_text(row, "来源A"), _text(row, "来源B")))
        for row_index, first in enumerate(sources):
            for column_index, second in enumerate(sources):
                if first == second or excluded(first, second): continue
                matrix[row_index, column_index] = cell_value(first, selected_color, selected_emotion) - cell_value(second, selected_color, selected_emotion)
        limit = max(.05 if metric == "probability" else .25, np.nanmax(np.abs(matrix)) if np.isfinite(matrix).any() else 1)
        image = axis.imshow(matrix, cmap="RdBu_r", vmin=-limit, vmax=limit, aspect="auto")
        axis.set_xticks(range(len(sources)), sources, rotation=35, ha="right"); axis.set_yticks(range(len(sources)), sources)
        for row_index, first in enumerate(sources):
            for column_index, second in enumerate(sources):
                value = matrix[row_index, column_index]
                label = "—" if first == second else "×" if excluded(first, second) else f"{value:+.2f}"
                if metric == "probability" and ((first, second) in significant or (second, first) in significant): label += " •"
                axis.text(column_index, row_index, label, ha="center", va="center", fontsize=8, color="white" if np.isfinite(value) and abs(value) > limit * .62 else "#263b43")
        figure.colorbar(image, ax=axis, fraction=.035, pad=.02, label="Row − column")
        axis.set_title(f"Pairwise difference matrix · {selected_color} × {selected_emotion}", fontweight="bold")
    elif kind == "task2-03":
        axis = figure.add_subplot(111)
        matrix = np.eye(len(sources))
        significance: dict[frozenset[str], str] = {}
        for row in analysis:
            if row.get("ai_source") and row.get("human_source"):
                significance[frozenset({_text(row, "ai_source"), _text(row, "human_source")})] = _text(row, "significance_stars")
                continue
            first, second = _text(row, "来源A"), _text(row, "来源B")
            if first not in sources or second not in sources: continue
            value = _num(row, "颜色情绪矩阵Pearson_r")
            matrix[sources.index(first), sources.index(second)] = value
            matrix[sources.index(second), sources.index(first)] = value
        for row_index, first in enumerate(sources):
            for column_index, second in enumerate(sources):
                if excluded(first, second): matrix[row_index, column_index] = np.nan
        image = axis.imshow(matrix, cmap="RdBu_r", vmin=-1, vmax=1, aspect="equal")
        axis.set_xticks(range(len(sources)), sources, rotation=35, ha="right"); axis.set_yticks(range(len(sources)), sources)
        for y in range(len(sources)):
            for x in range(len(sources)):
                value = matrix[y, x]; stars = significance.get(frozenset({sources[y], sources[x]}), "") if y != x else ""; axis.text(x, y, "×" if not np.isfinite(value) else f"{value:.2f}{stars}", ha="center", va="center", fontsize=8, color="white" if np.isfinite(value) and abs(value) > .62 else "#263b43")
        figure.colorbar(image, ax=axis, fraction=.035, pad=.02, label="Pearson r")
        axis.set_title("Full 11×20 pattern similarity", fontweight="bold")
    elif kind == "task2-04":
        composite_metric = str(options.get("compositeMetric", "broadness"))
        fields = {"broadness": ("平均情绪广度", "广度95CI下限", "广度95CI上限", "Emotion broadness", (0, 20)), "intensity": ("平均条件强度", "条件强度95CI下限", "条件强度95CI上限", "Conditional intensity", (1, 5)), "valence": ("平均效价偏向", "效价偏向95CI下限", "效价偏向95CI上限", "Valence bias", (-1, 1))}
        mean_key, low_key, high_key, label, limits = fields.get(composite_metric, fields["broadness"])
        columns = max(1, min(int(options.get("columns", 2)), len(sources)))
        nrows = max(1, int(np.ceil(len(sources) / columns)))
        plt.close(figure); figure = plt.figure(figsize=(max(8, columns * 4.2), max(4, nrows * 3.3)), constrained_layout=True); axes = figure.subplots(nrows, columns, squeeze=False)
        for source_index, source in enumerate(sources):
            axis = axes.flat[source_index]; subset = [row for row in analysis if _text(row, "来源") == source]
            ordered_colors = [color for color in colors if any(_text(row, "颜色") == color for row in subset)]
            means = [_num(next((row for row in subset if _text(row, "颜色") == color), {}), mean_key) for color in ordered_colors]
            lows = [_num(next((row for row in subset if _text(row, "颜色") == color), {}), low_key) for color in ordered_colors]
            highs = [_num(next((row for row in subset if _text(row, "颜色") == color), {}), high_key) for color in ordered_colors]
            xerr = np.array([[max(0, mean-low) for mean, low in zip(means, lows)], [max(0, high-mean) for mean, high in zip(means, highs)]])
            y = np.arange(len(ordered_colors)); axis.errorbar(means, y, xerr=xerr, fmt="o", color=PALETTE[source_index % len(PALETTE)], capsize=3)
            axis.set_yticks(y, ordered_colors); axis.set_xlim(*limits); axis.set_title(source, fontweight="bold"); axis.grid(axis="x", color="#e1e5e5", lw=.65)
        for axis in axes.flat[len(sources):]: axis.set_visible(False)
        _title(figure, payload, label); return figure
    elif kind == "task2-05":
        columns = max(1, min(int(options.get("columns", 2)), len(sources))); nrows = max(1, int(np.ceil(len(sources) / columns)))
        view = str(options.get("displayView", "wheel")); plt.close(figure)
        figure = plt.figure(figsize=(max(8, columns * 4.5), max(4.5, nrows * 4.3)), constrained_layout=True)
        axes = figure.subplots(nrows, columns, squeeze=False, subplot_kw={"projection": "polar"} if view == "wheel" else {})
        maximum = 1 if metric == "probability" else 5
        for source_index, source in enumerate(sources):
            axis = axes.flat[source_index]
            if view == "wheel":
                angles = np.linspace(0, 2*pi, len(emotions), endpoint=False); values = [np.mean([cell_value(source, color, emotion) for color in colors]) for emotion in emotions]
                axis.bar(angles, values, width=2*pi/len(emotions)*.9, color=[PALETTE[i % len(PALETTE)] for i in range(len(emotions))], alpha=.8); axis.set_xticks(angles, emotions, fontsize=7); axis.set_ylim(0, maximum)
            else:
                for color_index, color in enumerate(colors):
                    values = [cell_value(source, color, emotion) for emotion in emotions]
                    axis.scatter(np.arange(len(emotions)), np.full(len(emotions), color_index), s=8 + 90*np.array(values)/maximum, color=GEW_COLOR_HEX.get(color, PALETTE[color_index % len(PALETTE)]), alpha=.8)
                axis.set_xticks(range(len(emotions)), emotions, rotation=65, ha="right", fontsize=7); axis.set_yticks(range(len(colors)), colors)
            axis.set_title(source, fontweight="bold")
        for axis in axes.flat[len(sources):]: axis.set_visible(False)
        _title(figure, payload, "GEW source facets"); return figure
    elif kind == "task2-06":
        # The 0–5 rating figure needs the trial-level intensity values.  Keep
        # this payload intentionally narrow; aggregated cells cannot recover
        # a six-level distribution after the fact.
        # This view is a semantic matrix, not a free-flowing facet gallery:
        # rows are sources and columns are standard colors.  Never use the
        # global "facets per row" control here.
        nrows, columns = max(1, len(sources)), max(1, len(colors))
        plt.close(figure)
        target_width = max(1200, min(7200, int(options.get("width", 4500))))
        width_inches = target_width / 300
        figure = plt.figure(figsize=(width_inches, max(8.5, nrows * 1.48)), constrained_layout=True)
        axes = figure.subplots(nrows, columns, squeeze=False, sharex=True, sharey=True)
        rating_colors = ["#e5e7e5", "#3157c7", "#38b764", "#efd63f", "#e98632", "#d3312f"]
        for source_index, source in enumerate(sources):
          for color_index, color in enumerate(colors):
            axis = axes[source_index, color_index]
            subset = [row for row in raw_rows if _text(row, "source", "来源") == source and _text(row, "color", "颜色") == color]
            counts = np.zeros((len(emotions), 6), dtype=float)
            for emotion_index, emotion in enumerate(emotions):
                values = [min(5, max(0, int(round(_num(row, "intensity", "强度"))))) for row in subset if _text(row, "emotion", "情绪") == emotion]
                for value in values: counts[emotion_index, value] += 1
                if values: counts[emotion_index] /= len(values)
            bottom = np.zeros(len(emotions))
            for level, color_value in enumerate(rating_colors):
                axis.bar(np.arange(len(emotions)), counts[:, level], bottom=bottom, color=color_value, width=.84, linewidth=0)
                bottom += counts[:, level]
            axis.set_ylim(0, 1); axis.grid(axis="y", color="#dfe5e3", lw=.45)
            axis.tick_params(axis="both", length=2, pad=1)
            if source_index == 0:
                axis.set_title(color, fontsize=9, fontweight="bold", color="#354d56")
            if color_index == 0:
                axis.set_ylabel(source, fontsize=9, fontweight="bold", rotation=0, ha="right", va="center", labelpad=18)
                axis.set_yticks([0, .5, 1], ["0", "50%", "100%"], fontsize=6)
            else:
                axis.tick_params(axis="y", labelleft=False)
            if source_index == nrows - 1:
                axis.set_xticks(np.arange(len(emotions)), emotions, rotation=70, ha="right", fontsize=4.7)
            else:
                axis.tick_params(axis="x", labelbottom=False)
        _title(figure, payload, f"Standard Color Rating Distribution (0–5) · {nrows} source rows × {columns} color columns")
        return figure
    elif kind == "task2-07":
        axes = figure.subplots(1, 2, squeeze=False).flat
        for axis, field, title in zip(axes, ["probability", "conditional"], ["Association probability", "Conditional intensity"]):
            matrix = np.array([[cell_value(selected_source, color, emotion, field) for emotion in emotions] for color in colors])
            _heatmap(axis, matrix, emotions, colors, title, "YlGnBu")
        figure.suptitle(selected_source, fontsize=17, fontweight="bold"); return figure
    elif kind == "task2-08":
        plt.close(figure); figure = plt.figure(figsize=(8, 8), constrained_layout=True); axis = figure.add_subplot(111, projection="polar")
        angles = np.linspace(0, 2*pi, len(emotions), endpoint=False); values = np.array([cell_value(selected_source, selected_color, emotion) for emotion in emotions]); closed_angles = np.r_[angles, angles[0]]; closed_values = np.r_[values, values[0]]
        axis.plot(closed_angles, closed_values, color=PALETTE[0], lw=2); axis.fill(closed_angles, closed_values, color=PALETTE[0], alpha=.22); axis.set_xticks(angles, emotions, fontsize=8); axis.set_ylim(0, 1 if metric == "probability" else 5); axis.set_title(f"{selected_source} · {selected_color}", fontweight="bold")
    elif kind == "task2-09":
        axis = figure.add_subplot(111)
        matrix = np.array([[cell_value(source_a, color, emotion) - cell_value(source_b, color, emotion) for emotion in emotions] for color in colors]); limit = max(.05 if metric == "probability" else .25, float(np.max(np.abs(matrix))) if matrix.size else 1)
        image = axis.imshow(matrix, cmap="RdBu_r", vmin=-limit, vmax=limit, aspect="auto"); axis.set_xticks(range(len(emotions)), emotions, rotation=45, ha="right"); axis.set_yticks(range(len(colors)), colors); figure.colorbar(image, ax=axis, fraction=.035, pad=.02, label=f"{source_a} − {source_b}"); axis.set_title(f"Pairwise difference · {source_a} − {source_b}", fontweight="bold")
    elif kind in {"task2-10", "task2-11", "task2-12", "task2-13"}:
        def optional_jsd(row: dict[str, Any]) -> float:
            value = row.get("Jensen_Shannon距离")
            try:
                parsed = float(value)
                return parsed if np.isfinite(parsed) else np.nan
            except (TypeError, ValueError):
                return np.nan

        def canonical_source(value: str) -> str:
            token = "".join(character for character in value.lower() if character.isalnum())
            if token == "cn" or "china" in token: return "CN"
            if token == "bw": return "BW"
            if token == "uk": return "UK"
            if token in {"us", "usa"}: return "US"
            if "deepseek" in token: return "DeepSeek"
            if "doubao" in token: return "Doubao"
            if token == "gpt" or "openai" in token: return "GPT"
            if "gemini" in token: return "Gemini"
            return value

        jsd_sources = _ordered([_text(row, "来源A") for row in analysis] + [_text(row, "来源B") for row in analysis])
        source_cohort: dict[str, str] = {}
        for row in analysis:
            source_cohort.setdefault(_text(row, "来源A"), _text(row, "来源A组类型"))
            source_cohort.setdefault(_text(row, "来源B"), _text(row, "来源B组类型"))
        humans = [source for source in jsd_sources if source_cohort.get(source) == "human" or canonical_source(source) in {"CN", "BW", "UK", "US"}]
        ais = [source for source in jsd_sources if source_cohort.get(source) == "ai" or canonical_source(source) in {"DeepSeek", "Doubao", "GPT", "Gemini"}]

        def desired_order(values: list[str], desired: list[str]) -> list[str]:
            ordered: list[str] = []
            for name in desired:
                match = next((value for value in values if canonical_source(value).lower() == name.lower()), None)
                if match and match not in ordered: ordered.append(match)
            return ordered + sorted(value for value in values if value not in ordered)

        humans = desired_order(humans, ["CN", "BW", "UK", "US"])[:4]
        ais = desired_order(ais, ["DeepSeek", "Doubao", "GPT", "Gemini"])[:4]
        ordered_colors = [color for color in GEW_COLORS if any(_text(row, "颜色") == color for row in analysis)]
        valid_values = [optional_jsd(row) for row in analysis]
        valid_values = [value for value in valid_values if np.isfinite(value)]
        maximum = max(.01, max(valid_values) if valid_values else 1)

        def distance(first: str, second: str, color: str) -> float:
            row = next((item for item in analysis if _text(item, "颜色") == color and ((_text(item, "来源A") == first and _text(item, "来源B") == second) or (_text(item, "来源A") == second and _text(item, "来源B") == first))), None)
            return optional_jsd(row) if row else np.nan

        def pairs_within(values: list[str]) -> list[tuple[str, str]]:
            return [(first, second) for index, first in enumerate(values) for second in values[index + 1:]]

        if kind == "task2-10":
            pairs = pairs_within(humans); title = "Human within-cohort colorwise JSD"
        elif kind == "task2-11":
            pairs = pairs_within(ais); title = "AI within-cohort colorwise JSD"
        elif kind == "task2-12":
            ai_cross = desired_order(ais, ["Doubao", "DeepSeek", "GPT", "Gemini"])
            human_cross = desired_order(humans, ["UK", "US", "CN", "BW"])
            pairs = [(ai, human) for ai in ai_cross for human in human_cross]; title = "AI–Human colorwise JSD"
        else:
            ai_cross = desired_order(ais, ["Doubao", "DeepSeek", "GPT", "Gemini"])
            human_cross = desired_order(humans, ["UK", "US", "CN", "BW"])
            matrix = np.array([[np.nanmean([distance(ai, human, color) for color in ordered_colors]) for human in human_cross] for ai in ai_cross])
            plt.close(figure); figure = plt.figure(figsize=(8.5, 6.5), constrained_layout=True); axis = figure.add_subplot(111)
            image = axis.imshow(matrix, cmap="YlGnBu", vmin=0, vmax=maximum, aspect="auto")
            axis.set_xticks(range(len(human_cross)), [canonical_source(source) for source in human_cross]); axis.set_yticks(range(len(ai_cross)), [canonical_source(source) for source in ai_cross])
            axis.set_xlabel("Human source"); axis.set_ylabel("AI source"); axis.set_title("AI–Human mean colorwise JSD (11 colors)", fontweight="bold")
            for y in range(len(ai_cross)):
                for x in range(len(human_cross)):
                    value = matrix[y, x]
                    axis.text(x, y, "NA" if not np.isfinite(value) else f"{value:.2f}", ha="center", va="center", fontsize=10, color="white" if np.isfinite(value) and value / maximum > .62 else "#263b43")
            figure.colorbar(image, ax=axis, fraction=.04, pad=.025, label="Jensen–Shannon distance · lower = more similar")
            _title(figure, payload, "AI–Human Mean JSD Summary"); return figure

        matrix = np.array([[distance(first, second, color) for first, second in pairs] for color in ordered_colors])
        target_width = max(1500, min(7200, int(options.get("width", 4500))))
        plt.close(figure); figure = plt.figure(figsize=(target_width / 300, 7.2 if kind != "task2-12" else 8.2), constrained_layout=True); axis = figure.add_subplot(111)
        image = axis.imshow(matrix, cmap="YlGnBu", vmin=0, vmax=maximum, aspect="auto")
        pair_labels = [f"{canonical_source(first)}–{canonical_source(second)}" for first, second in pairs]
        axis.set_xticks(range(len(pairs)), pair_labels, rotation=48, ha="right", fontsize=8); axis.set_yticks(range(len(ordered_colors)), ordered_colors)
        axis.set_xlabel("Source pair"); axis.set_ylabel("Standard color"); axis.set_title(title, fontweight="bold")
        if kind == "task2-12":
            for boundary in [3.5, 7.5, 11.5]: axis.axvline(boundary, color="white", lw=2.2)
            for center, label in zip([1.5, 5.5, 9.5, 13.5], ["Doubao", "DeepSeek", "GPT", "Gemini"]): axis.text(center, -1.0, label, ha="center", va="bottom", fontsize=9, fontweight="bold", color="#277b92", clip_on=False)
        for y in range(len(ordered_colors)):
            for x in range(len(pairs)):
                value = matrix[y, x]
                axis.text(x, y, "NA" if not np.isfinite(value) else f"{value:.2f}", ha="center", va="center", fontsize=7, color="white" if np.isfinite(value) and value / maximum > .62 else "#263b43")
        figure.colorbar(image, ax=axis, fraction=.025, pad=.018, label="Jensen–Shannon distance · lower = more similar")
        _title(figure, payload, title); return figure
    else:
        raise ValueError(f"Unsupported Task 2 figure: {kind}")
    _title(figure, payload, "Color–Emotion Association Analysis")
    return figure


def _bidirectional(payload: dict[str, Any]) -> plt.Figure:
    options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    data = _rows(payload, "data")
    if not data: raise ValueError("双向分析结果为空，请先在页面运行双向分析。")
    result = data[0]; groups = [row for row in result.get("groups", []) if isinstance(row, dict)]
    units = [row for row in result.get("units", []) if isinstance(row, dict)]
    view = str(payload.get("kind", "groups")); metric = str(options.get("metric", "strength"))
    source = str(options.get("selectedSource", "")); group = next((row for row in groups if row.get("source") == source), groups[0] if groups else None)
    sources = [str(row.get("source")) for row in groups]
    figure, _ = _figure(payload, .68)
    def heat(axis, values, row_labels, column_labels, title, cmap="viridis", diagonal=False):
        matrix = np.asarray(values, dtype=float)
        image = axis.imshow(matrix, cmap=cmap, aspect="auto")
        axis.set_xticks(range(len(column_labels)), column_labels, rotation=55, ha="right", fontsize=7)
        axis.set_yticks(range(len(row_labels)), row_labels, fontsize=7)
        axis.set_title(title, fontweight="bold")
        if diagonal:
            axis.plot(np.arange(min(matrix.shape)), np.arange(min(matrix.shape)), "s", ms=4, mfc="none", mec="#a43d36", mew=.7)
        figure.colorbar(image, ax=axis, fraction=.025, pad=.015)
    if view in {"a", "b", "cycle"}:
        if not group: raise ValueError("没有可导出的完整配对来源。")
        if view == "a": heat(figure.add_subplot(111), group["A"], EMOTIONS, GEW_COLORS, f"{source} · A: Emotion → BCT similarity")
        elif view == "b": heat(figure.add_subplot(111), np.asarray(group["BStrength" if metric == "strength" else "BSelection"]).T, EMOTIONS, GEW_COLORS, f"{source} · B-{metric}ᵀ: Emotion × BCT")
        else: heat(figure.add_subplot(111), group["CStrength" if metric == "strength" else "CSelection"], EMOTIONS, EMOTIONS, f"{source} · C-{metric}: cycle matrix", "magma", True)
    elif view == "parallel":
        if not group: raise ValueError("没有可导出的完整配对来源。")
        axes = figure.subplots(1, 2)
        heat(axes[0], group["A"], EMOTIONS, GEW_COLORS, "A · Emotion → BCT")
        heat(axes[1], np.asarray(group["BStrength" if metric == "strength" else "BSelection"]).T, EMOTIONS, GEW_COLORS, f"B-{metric}ᵀ · Emotion × BCT")
    elif view == "permutation":
        if not group: raise ValueError("没有可导出的完整配对来源。")
        axis = figure.add_subplot(111); rows = group["emotion"]
        real = np.array([row[metric]["mean"] for row in rows]); excess = np.array([row[f"{metric}Excess"]["mean"] for row in rows]); null = real - excess
        x = np.arange(len(rows)); axis.bar(x, null, color="#cbd4d4", label="Permutation null mean"); axis.bar(x, excess, bottom=null, color="#277b92", label="Excess consistency")
        axis.set_xticks(x, [row["emotion"] for row in rows], rotation=55, ha="right"); axis.set_ylabel("Cycle diagonal"); axis.legend(frameon=False); axis.set_title(f"{source} · observed vs permutation null", fontweight="bold")
    elif view in {"groups", "dominance"}:
        axis = figure.add_subplot(111); key = ("dominance" if view == "dominance" else "meanDiagonal") + ("Strength" if metric == "strength" else "Selection")
        values = np.array([row[key]["mean"] for row in groups]); low = np.array([row[key]["ciLow"] for row in groups]); high = np.array([row[key]["ciHigh"] for row in groups]); x = np.arange(len(groups))
        axis.bar(x, values, color=[PALETTE[i % len(PALETTE)] for i in range(len(groups))]); axis.errorbar(x, values, yerr=np.vstack([values-low, high-values]), fmt="none", ecolor="#26353a", capsize=3, lw=.8)
        axis.set_xticks(x, sources, rotation=30, ha="right"); axis.set_ylabel("Diagonal dominance" if view == "dominance" else "Mean cycle diagonal"); axis.set_title("Eight-group bidirectional comparison", fontweight="bold"); axis.grid(axis="y", color="#e1e5e5", lw=.6)
    elif view == "units":
        axis = figure.add_subplot(111)
        for i, src in enumerate(sources):
            values = [float(row["excessStrength"]) for row in units if row.get("source") == src]
            if values: axis.scatter(np.full(len(values), i) + np.linspace(-.14, .14, len(values)), values, s=13, alpha=.55, color=PALETTE[i % len(PALETTE)])
        axis.axhline(0, color="#68777b", lw=.7); axis.set_xticks(range(len(sources)), sources, rotation=30, ha="right"); axis.set_ylabel("Excess cycle consistency"); axis.set_title("Independent participant/run distribution", fontweight="bold")
    elif view == "transfers":
        if not group: raise ValueError("没有可导出的完整配对来源。")
        selected_units = [row for row in units if row.get("source") == source]; aggregate: dict[str, list[float]] = {}
        for unit in selected_units:
            for row in unit.get("topTransfers", []): aggregate.setdefault(f"{row['from']} → {row['to']}", []).append(float(row[metric]))
        ranked = sorted(((key, np.mean(values)) for key, values in aggregate.items()), key=lambda item: item[1], reverse=True)[:20]
        axis = figure.add_subplot(111); labels, values = zip(*ranked) if ranked else ([], [])
        axis.barh(np.arange(len(labels)), values, color="#277b92"); axis.set_yticks(np.arange(len(labels)), labels, fontsize=7); axis.invert_yaxis(); axis.set_xlabel(f"Mean off-diagonal {metric}"); axis.set_title(f"{source} · strongest emotion transfers", fontweight="bold")
    elif view == "structure":
        rows = result.get("structureDistances", []); matrix = [[next((row.get("spearman") for row in rows if row.get("sourceA") == a and row.get("sourceB") == b), 0) or 0 for b in sources] for a in sources]
        heat(figure.add_subplot(111), matrix, sources, sources, "Cycle-structure similarity · Spearman", "coolwarm")
    else: raise ValueError(f"Unsupported bidirectional figure: {view}")
    _title(figure, payload, "Bidirectional Emotion–Color Analysis")
    return figure


def render_publication_figure(payload: dict[str, Any]) -> bytes:
    _style()
    scope = str(payload.get("scope", "task1"))
    if scope == "task1":
        figure = _task1(payload)
    elif scope == "task2":
        figure = _task2(payload)
    elif scope == "bidirectional":
        figure = _bidirectional(payload)
    else:
        raise ValueError("未知的绘图范围。")
    return _finish(figure, payload)
