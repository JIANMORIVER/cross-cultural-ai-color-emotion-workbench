#!/usr/bin/env python3
"""Create result-focused visualisations from Task 2 analysis outputs."""

from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "emotion-wheel-matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", str(Path(tempfile.gettempdir()) / "emotion-wheel-cache"))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


COLOURS = ["D38", "F17", "F4", "J0", "F0", "F29", "A0", "H35", "I6", "G3", "C9"]
EMOTIONS = [
    "interest", "amusement", "pride", "joy", "pleasure", "contentment",
    "admiration", "love", "relief", "compassion", "sadness", "guilt",
    "regret", "shame", "disappointment", "fear", "disgust", "contempt",
    "hate", "anger",
]
GROUPS = ["BW", "CN", "UK"]
GROUP_COLOURS = {"BW": "#E69F00", "CN": "#0072B2", "UK": "#009E73"}
PAIR_COLOURS = {"CN - BW": "#0072B2", "UK - BW": "#009E73", "CN - UK": "#CC79A7"}


def read_outputs(output_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    descriptive = pd.read_csv(output_dir / "03_descriptive_statistics.csv")
    omnibus = pd.read_csv(output_dir / "05_omnibus_tests.csv")
    pairwise = pd.read_csv(output_dir / "06_pairwise_tests.csv")
    return descriptive, omnibus, pairwise


def colour_label_order(descriptive: pd.DataFrame) -> tuple[dict[str, str], list[str]]:
    labels = descriptive.drop_duplicates("colour_code").set_index("colour_code")["colour_label"].to_dict()
    return labels, [labels.get(code, code) for code in COLOURS]


def plot_dominant_emotions(descriptive: pd.DataFrame, plot_dir: Path) -> None:
    labels, label_order = colour_label_order(descriptive)
    fig, axes = plt.subplots(1, 3, figsize=(15, 10), sharey=True, constrained_layout=True)
    for ax, group in zip(axes, GROUPS):
        subset = descriptive[descriptive["group"] == group]
        rows = []
        for code in COLOURS:
            top = subset[subset["colour_code"] == code].nlargest(3, "prevalence")
            rows.append("\n".join(f"{row.emotion.title()}  {row.prevalence:.0%}" for row in top.itertuples()))
        ax.set_xlim(0, 1)
        ax.set_ylim(-0.5, len(COLOURS) - 0.5)
        ax.invert_yaxis()
        ax.set_title(f"{group}: top 3 emotions", color=GROUP_COLOURS[group], fontweight="bold")
        ax.set_xticks([])
        ax.set_yticks(np.arange(len(COLOURS)))
        for y, text in enumerate(rows):
            ax.text(0.04, y, text, va="center", ha="left", fontsize=8.5, linespacing=1.15)
        for y in np.arange(-0.5, len(COLOURS), 1):
            ax.axhline(y, color="#DDDDDD", linewidth=0.7)
        for spine in ax.spines.values():
            spine.set_visible(False)
    axes[0].set_yticklabels(label_order)
    for ax in axes[1:]:
        ax.tick_params(axis="y", labelleft=False)
    axes[0].set_ylabel("Colour")
    fig.suptitle("Dominant emotion associations by colour and cultural group", fontsize=15, fontweight="bold")
    fig.savefig(plot_dir / "05_dominant_emotions_table.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


def plot_effect_forest(pairwise: pd.DataFrame, plot_dir: Path) -> None:
    data = pairwise[pairwise["q_selection_bh"] < 0.05].copy()
    data["abs_difference"] = data["prevalence_difference_a_minus_b"].abs()
    data = data.nlargest(24, "abs_difference").sort_values("prevalence_difference_a_minus_b")
    data["contrast"] = data["group_a"] + " - " + data["group_b"]
    data["label"] = data["colour_label"] + " · " + data["emotion"].str.title() + "  [" + data["contrast"] + "]"
    se = np.sqrt(
        data["prevalence_a"] * (1 - data["prevalence_a"]) / data["n_a"]
        + data["prevalence_b"] * (1 - data["prevalence_b"]) / data["n_b"]
    )
    data["ci_low"] = data["prevalence_difference_a_minus_b"] - 1.96 * se
    data["ci_high"] = data["prevalence_difference_a_minus_b"] + 1.96 * se

    fig, ax = plt.subplots(figsize=(11, 10), constrained_layout=True)
    y = np.arange(len(data))
    ax.axvline(0, color="#666666", linewidth=1)
    for index, (_, row) in enumerate(data.iterrows()):
        colour = PAIR_COLOURS[row["contrast"]]
        ax.plot([row["ci_low"], row["ci_high"]], [index, index], color=colour, linewidth=1.6)
        ax.scatter(row["prevalence_difference_a_minus_b"], index, s=45, color=colour, zorder=3)
        ax.text(row["ci_high"] + 0.012, index, f"{row['prevalence_difference_a_minus_b']:+.1%}", va="center", fontsize=8)
    ax.set_yticks(y, data["label"])
    ax.set_xlabel("Selection prevalence difference (first group minus second group)")
    ax.set_title("Largest significant cultural differences\n95% normal-approximation confidence intervals; BH q < .05", fontweight="bold")
    handles = [plt.Line2D([0], [0], marker="o", color=value, label=key, linewidth=1.5) for key, value in PAIR_COLOURS.items()]
    ax.legend(handles=handles, frameon=False, loc="lower right")
    sns.despine(ax=ax)
    fig.savefig(plot_dir / "06_significant_effect_forest.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


def plot_volcano(pairwise: pd.DataFrame, plot_dir: Path) -> None:
    data = pairwise.copy()
    data["contrast"] = data["group_a"] + " - " + data["group_b"]
    data["score"] = -np.log10(data["q_selection_bh"].clip(lower=1e-14))
    data["significant"] = data["q_selection_bh"] < 0.05
    contrasts = ["CN - BW", "UK - BW", "CN - UK"]
    fig, axes = plt.subplots(1, 3, figsize=(16, 5.5), sharex=True, sharey=True, constrained_layout=True)
    for ax, contrast in zip(axes, contrasts):
        subset = data[data["contrast"] == contrast]
        ax.scatter(
            subset.loc[~subset["significant"], "prevalence_difference_a_minus_b"],
            subset.loc[~subset["significant"], "score"],
            color="#BBBBBB", alpha=0.55, s=18, label="Not significant",
        )
        significant = subset[subset["significant"]]
        ax.scatter(
            significant["prevalence_difference_a_minus_b"], significant["score"],
            color=PAIR_COLOURS[contrast], alpha=0.8, s=25, label="BH q < .05",
        )
        for row in subset.nlargest(2, "score").itertuples():
            positive = row.prevalence_difference_a_minus_b >= 0
            ax.annotate(
                f"{row.colour_label}·{row.emotion.title()}",
                (row.prevalence_difference_a_minus_b, row.score),
                xytext=(-4 if positive else 4, 5), textcoords="offset points", fontsize=8,
                ha="right" if positive else "left",
            )
        ax.axhline(-np.log10(0.05), color="#777777", linestyle="--", linewidth=0.9)
        ax.axvline(0, color="#777777", linewidth=0.9)
        ax.set_title(contrast, fontweight="bold")
        ax.set_xlabel("Prevalence difference")
    axes[0].set_ylabel("-log10(BH q)")
    axes[0].set_ylim(-0.45, data["score"].max() + 1.0)
    axes[-1].legend(frameon=False, loc="upper right")
    fig.suptitle("Effect size versus statistical evidence", fontsize=15, fontweight="bold")
    fig.savefig(plot_dir / "07_pairwise_volcano.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


def plot_emotion_wheels(descriptive: pd.DataFrame, plot_dir: Path) -> None:
    labels, _ = colour_label_order(descriptive)
    wheel_dir = plot_dir / "emotion_wheels"
    wheel_dir.mkdir(parents=True, exist_ok=True)
    angles = np.linspace(0, 2 * np.pi, len(EMOTIONS), endpoint=False)
    closed_angles = np.r_[angles, angles[0]]
    for code in COLOURS:
        fig, ax = plt.subplots(figsize=(8.5, 8.5), subplot_kw={"projection": "polar"}, constrained_layout=True)
        subset = descriptive[descriptive["colour_code"] == code]
        for group in GROUPS:
            values = subset[subset["group"] == group].set_index("emotion").reindex(EMOTIONS)["prevalence"].fillna(0).to_numpy()
            closed_values = np.r_[values, values[0]]
            ax.plot(closed_angles, closed_values, linewidth=2, label=group, color=GROUP_COLOURS[group])
            ax.fill(closed_angles, closed_values, alpha=0.06, color=GROUP_COLOURS[group])
        ax.set_xticks(angles, [emotion.title() for emotion in EMOTIONS], fontsize=9)
        ax.set_ylim(0, 1)
        ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0], ["20%", "40%", "60%", "80%", "100%"], fontsize=8)
        ax.set_title(f"{labels.get(code, code)}: Geneva emotion profile", pad=25, fontweight="bold")
        ax.legend(loc="upper right", bbox_to_anchor=(1.17, 1.12), frameon=False)
        fig.savefig(wheel_dir / f"wheel_{code}.png", dpi=250, bbox_inches="tight")
        plt.close(fig)


def plot_bubble_matrix(descriptive: pd.DataFrame, plot_dir: Path) -> None:
    labels, label_order = colour_label_order(descriptive)
    fig, axes = plt.subplots(1, 3, figsize=(17, 9), sharex=True, sharey=True, constrained_layout=True)
    for ax, group in zip(axes, GROUPS):
        subset = descriptive[descriptive["group"] == group].copy()
        subset["x"] = subset["colour_code"].map({code: i for i, code in enumerate(COLOURS)})
        subset["y"] = subset["emotion"].map({emotion: i for i, emotion in enumerate(EMOTIONS)})
        scatter = ax.scatter(
            subset["x"], subset["y"],
            s=20 + 520 * subset["prevalence"],
            c=subset["prevalence"], cmap="viridis", vmin=0, vmax=1,
            alpha=0.82, edgecolors="none",
        )
        ax.set_title(group, color=GROUP_COLOURS[group], fontweight="bold")
        ax.set_xticks(range(len(COLOURS)), label_order, rotation=45, ha="right")
        ax.grid(color="#EEEEEE", linewidth=0.6)
    axes[0].set_yticks(range(len(EMOTIONS)), [emotion.title() for emotion in EMOTIONS])
    axes[0].invert_yaxis()
    handles = [
        axes[-1].scatter([], [], s=20 + 520 * value, color="#777777", alpha=0.65, label=f"{value:.0%}")
        for value in (0.2, 0.4, 0.6)
    ]
    fig.legend(handles=handles, title="Selection rate", frameon=False, loc="lower center", ncol=3, bbox_to_anchor=(0.5, -0.01))
    fig.colorbar(scatter, ax=axes, shrink=0.55, pad=0.01, label="Selection prevalence")
    fig.suptitle("Emotion prevalence: bubble size and colour both encode selection rate", fontsize=15, fontweight="bold")
    fig.savefig(plot_dir / "08_prevalence_bubble_matrix.png", dpi=300, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create additional Task 2 result visualisations")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/phase2_current"))
    args = parser.parse_args()
    descriptive, omnibus, pairwise = read_outputs(args.output_dir)
    plot_dir = args.output_dir / "plots"
    plot_dir.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", font_scale=0.9)
    plot_dominant_emotions(descriptive, plot_dir)
    plot_effect_forest(pairwise, plot_dir)
    plot_volcano(pairwise, plot_dir)
    plot_emotion_wheels(descriptive, plot_dir)
    plot_bubble_matrix(descriptive, plot_dir)
    print(f"Additional visualisations saved to: {plot_dir.resolve()}")


if __name__ == "__main__":
    main()
