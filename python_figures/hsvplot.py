"""Matplotlib exports adapted from the research project's original hsvplot.py.

The original script reads fixed Excel paths. This module keeps its plotting
logic but accepts the rows currently loaded in the web analysis dashboard.
"""

from __future__ import annotations

from io import BytesIO
from math import ceil
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns


def _number(row: dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key, 0))
    except (TypeError, ValueError):
        return 0.0


def _rgb(hex_color: str) -> tuple[float, float, float]:
    value = str(hex_color or "").strip().lstrip("#")
    if len(value) != 6:
        return (0.45, 0.45, 0.45)
    try:
        return tuple(int(value[index : index + 2], 16) / 255 for index in (0, 2, 4))
    except ValueError:
        return (0.45, 0.45, 0.45)


def _ordered_groups(rows: list[dict[str, Any]], requested: list[str]) -> list[str]:
    groups: list[str] = []
    for value in requested + [str(row.get("source", "")) for row in rows]:
        if value and value not in groups:
            groups.append(value)
    return groups


def render_hsv_figure(payload: dict[str, Any]) -> bytes:
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    rows = [row for row in rows if isinstance(row, dict)]
    groups = _ordered_groups(rows, [str(value) for value in payload.get("groups", [])])
    if not groups:
        raise ValueError("当前视图没有可绘制的数据组。")

    kind = "vs-density" if payload.get("kind") == "vs-density" else "hs-polar"
    emotion = str(payload.get("emotion") or "")
    columns = max(2, min(5, int(payload.get("columns") or 5)))
    row_count = max(1, ceil(len(groups) / columns))
    base_width = max(1600, min(4200, int(payload.get("width") or 2850)))
    quality = 3 if int(payload.get("scale") or 2) >= 3 else 2
    target_width = round(base_width * quality / 2)
    target_height = round(target_width * max(0.30, row_count / columns * 0.75))
    dpi = 200
    figsize = (target_width / dpi, target_height / dpi)
    show_title = bool(payload.get("showTitle", True))

    sns.set_theme(style="whitegrid", context="paper")
    palette = sns.color_palette("husl", len(groups))
    subplot = {"projection": "polar"} if kind == "hs-polar" else {}
    fig, axes = plt.subplots(row_count, columns, figsize=figsize, subplot_kw=subplot, squeeze=False)
    flat_axes = axes.flatten()
    fig.patch.set_facecolor("white")

    if show_title:
        title = (
            f"Hue-Saturation Distribution: {emotion}"
            if kind == "hs-polar"
            else f"Value-Saturation Density & Scatter: {emotion}"
        )
        fig.suptitle(title, fontsize=14, fontweight="bold", y=0.985)

    for index, group in enumerate(groups):
        axis = flat_axes[index]
        group_rows = [row for row in rows if str(row.get("source", "")) == group]
        color = palette[index]
        axis.set_facecolor("white")

        if kind == "hs-polar":
            if group_rows:
                theta = np.deg2rad([_number(row, "hsvH") for row in group_rows])
                saturation = [_number(row, "hsvS") for row in group_rows]
                point_colors = [_rgb(str(row.get("hex", ""))) for row in group_rows]
                axis.scatter(theta, saturation, c=point_colors, alpha=0.62, edgecolors="none", s=28)
            axis.set_theta_zero_location("E")
            axis.set_theta_direction(-1)
            axis.set_rmax(1.0)
            axis.set_rticks([0.5, 1.0])
            axis.set_yticklabels([])
            axis.grid(color="#b6b6b6", linewidth=0.65, alpha=0.8)
            axis.spines["polar"].set_color("#333333")
            axis.spines["polar"].set_linewidth(0.8)
            axis.tick_params(labelsize=7, pad=-4)
        else:
            saturation = [_number(row, "hsvS") for row in group_rows]
            value = [_number(row, "hsvV") for row in group_rows]
            if len(group_rows) > 5:
                sns.kdeplot(
                    x=saturation,
                    y=value,
                    ax=axis,
                    color=color,
                    fill=True,
                    alpha=0.2,
                    levels=5,
                    warn_singular=False,
                )
            if group_rows:
                axis.scatter(saturation, value, color=color, alpha=0.55, edgecolors="none", s=22)
            axis.set_xlabel("Saturation", fontsize=8)
            axis.set_ylabel("Value (Brightness)" if index % columns == 0 else "", fontsize=8)
            axis.set_xlim(-0.05, 1.05)
            axis.set_ylim(-0.05, 1.05)
            axis.tick_params(labelsize=7)
            axis.grid(color="#d1d1d1", linewidth=0.6)
            for spine in axis.spines.values():
                spine.set_visible(False)

        axis.set_title(group, fontsize=9, pad=-10, color=color, fontweight="bold")

    for index in range(len(groups), len(flat_axes)):
        flat_axes[index].axis("off")

    top = 0.86 if show_title else 0.94
    fig.subplots_adjust(left=0.025, right=0.985, bottom=0.03, top=top, wspace=0.34, hspace=0.22)
    output = BytesIO()
    fig.savefig(output, format="png", dpi=dpi, facecolor="white", edgecolor="none")
    plt.close(fig)
    return output.getvalue()
