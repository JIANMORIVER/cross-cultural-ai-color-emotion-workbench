"""Run Task 2 participant/run-level formal analysis without a browser."""

from __future__ import annotations

import argparse
import ast
import csv
from datetime import datetime
import gzip
from io import StringIO
import json
from pathlib import Path
import sys
import time
from typing import Any
import zipfile

import numpy as np
import pandas as pd

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "python_figures"))
from task2_heterogeneity import COLORS, EMOTIONS, run_task2_heterogeneity

FILES = {
    "CN": "cn.xlsx", "BW": "bw.xlsx", "UK": "uk.xlsx", "US": "us.xlsx",
    "DeepSeek": "deepseek.xlsx", "Doubao": "doubao.xlsx", "GPT": "gpt.xlsx", "Gemini": "gemini.xlsx",
}
HUMANS = {"CN", "BW", "UK", "US"}
EMOTION_LOOKUP = {emotion.casefold(): emotion for emotion in EMOTIONS}
NO_ASSOCIATION_LABELS = {"none", "other", "n/a", "na", "无", "无关联", "其他"}


def normalize_emotion(value: Any) -> str | None:
    """Match Task 2 emotion labels case-insensitively.

    Human survey exports use lower-case labels while AI exports normally use
    title case.  Known no-association sentinels are valid but do not become a
    GEW emotion.  Any other label is rejected so malformed input cannot be
    silently converted into an all-zero profile.
    """
    label = str(value or "").strip()
    if not label:
        return None
    canonical = EMOTION_LOOKUP.get(label.casefold())
    if canonical:
        return canonical
    if label.casefold() in NO_ASSOCIATION_LABELS:
        return None
    raise ValueError(f"emotion outside the fixed GEW list: {label!r}")


def parse_associations(value: Any) -> list[dict[str, Any]] | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    parsed: Any = value
    if isinstance(value, str):
        text = value.strip().replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            try:
                parsed = ast.literal_eval(text)
            except (ValueError, SyntaxError):
                return None
    if isinstance(parsed, dict):
        wrapped = parsed.get("associations", parsed.get("emotions", parsed.get("answers")))
        parsed = wrapped if wrapped is not None else [
            {"emotion": emotion, "intensity": intensity}
            for emotion, intensity in parsed.items()
        ]
    if not isinstance(parsed, list):
        raise ValueError("association JSON must be a list or an emotion-to-intensity object")
    output = []
    for item in parsed:
        if not isinstance(item, dict):
            raise ValueError("every association entry must be a JSON object")
        emotion = normalize_emotion(item.get("emotion", item.get("word", item.get("name", ""))))
        if emotion is None:
            continue
        try:
            intensity = int(round(float(item.get("intensity", item.get("score", item.get("value", 0))))))
        except (TypeError, ValueError):
            raise ValueError(f"invalid intensity for {emotion!r}") from None
        if not 0 <= intensity <= 5:
            raise ValueError(f"intensity outside 0-5 for {emotion!r}: {intensity}")
        if intensity > 0:
            output.append({"emotion": emotion, "intensity": intensity})
    return output


def find_column(frame: pd.DataFrame, candidates: list[str]) -> str | None:
    lookup = {str(column).strip().lower(): str(column) for column in frame.columns}
    return next((lookup[name.lower()] for name in candidates if name.lower() in lookup), None)


def load_rows(input_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    missing = [name for name in FILES.values() if not (input_dir / name).exists()]
    if missing:
        raise FileNotFoundError("Missing input workbooks: " + ", ".join(missing))
    output: list[dict[str, Any]] = []
    summary: dict[str, Any] = {}
    for source, file_name in FILES.items():
        frame = pd.read_excel(input_dir / file_name, sheet_name=0)
        participant_column = find_column(frame, ["participant_id", "participant", "sample_id", "id", "实验id", "样本id"])
        run_column = find_column(frame, ["run_id", "run", "run_index", "repetition", "轮次", "重复轮次"])
        columns = {color: find_column(frame, [f"word_data.{color}"]) for color in COLORS}
        if not any(columns.values()):
            raise ValueError(f"{file_name} does not contain word_data.<color> columns")
        valid_cells = invalid_cells = recognized_associations = zero_association_cells = 0
        cohort = "human" if source in HUMANS else "ai"
        for row_index, record in frame.iterrows():
            if not any(column and pd.notna(record.get(column)) and str(record.get(column)).strip() for column in columns.values()):
                continue
            participant = str(record.get(participant_column, "") if participant_column else "").strip()
            run = str(record.get(run_column, "") if run_column else "").strip()
            unit = participant if cohort == "human" and participant else run if cohort == "ai" and run else str(row_index + 1)
            for color in COLORS:
                column = columns[color]
                try:
                    associations = parse_associations(record.get(column)) if column else None
                except ValueError as error:
                    raise ValueError(
                        f"{file_name} · Excel row {int(row_index) + 2} · {column}: {error}"
                    ) from error
                valid = associations is not None
                valid_cells += int(valid); invalid_cells += int(not valid)
                if valid:
                    recognized_associations += len(associations)
                    zero_association_cells += int(len(associations) == 0)
                mapping = {item["emotion"]: item["intensity"] for item in associations or []}
                for emotion in EMOTIONS:
                    intensity = int(mapping.get(emotion, 0))
                    output.append({
                        "source": source, "cohort": cohort, "participant": unit if cohort == "human" else "",
                        "run": unit if cohort == "ai" else "", "sourceRow": int(row_index + 1), "identityProvided": bool(participant or run),
                        "color": color, "emotion": emotion, "selected": int(intensity > 0), "intensity": intensity, "valid": valid,
                    })
        summary[source] = {
            "file": file_name,
            "workbookRows": len(frame),
            "validColorCells": valid_cells,
            "invalidColorCells": invalid_cells,
            "recognizedAssociations": recognized_associations,
            "zeroAssociationCells": zero_association_cells,
            "parsedProfiles": valid_cells / len(COLORS),
        }
        if recognized_associations == 0:
            raise ValueError(
                f"{file_name} parsed {valid_cells} color cells but found zero valid GEW associations. "
                "Stop before analysis to prevent an all-zero source profile."
            )
    return output, summary


class Progress:
    def __init__(self) -> None:
        self.last_time = 0.0
    def __call__(self, stage: str, completed: int, total: int) -> None:
        now = time.time()
        if completed == total or now - self.last_time >= 2:
            print(f"{datetime.now():%H:%M:%S} | {stage} | {completed:,}/{total:,} | {100*completed/max(1,total):.1f}%", flush=True)
            self.last_time = now


def csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    if not rows:
        return b""
    fields: list[str] = []
    for row in rows:
        fields.extend(key for key in row if key not in fields)
    stream = StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
    writer.writeheader(); writer.writerows(rows)
    return stream.getvalue().encode("utf-8-sig")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=PROJECT / "input_data")
    parser.add_argument("--preset", choices=("quick", "formal"), default="formal")
    args = parser.parse_args()
    options = ({"seed": 20260824, "stability": 100, "permutations": 999, "bootstrap": 200, "hungarian": 100}
               if args.preset == "quick" else
               {"seed": 20260824, "stability": 500, "permutations": 9999, "bootstrap": 1000, "hungarian": 500})
    print("Loading Task 2 workbooks from", args.input.resolve(), flush=True)
    rows, summary = load_rows(args.input)
    for source, audit in summary.items():
        print(
            f"  {source}: profiles={audit['parsedProfiles']:.0f}, "
            f"valid cells={audit['validColorCells']}, "
            f"recognized associations={audit['recognizedAssociations']}, "
            f"zero-association cells={audit['zeroAssociationCells']}",
            flush=True,
        )
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = PROJECT / "offline_results" / f"task2_heterogeneity_{args.preset}_{stamp}"
    target.mkdir(parents=True, exist_ok=False)
    (target / "input_summary.json").write_text(json.dumps({"preset": args.preset, "options": options, "sources": summary, "longRows": len(rows)}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Loaded {len(rows):,} long rows. Starting {args.preset} analysis...", flush=True)
    result = run_task2_heterogeneity({"rows": rows, "options": options}, progress=Progress())
    with gzip.open(target / "task2_heterogeneity_result.json.gz", "wt", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, allow_nan=False)
    tables = {
        "subgroup_assignments_human.csv": result["subgroups"]["assignmentsHuman"], "subgroup_assignments_ai.csv": result["subgroups"]["assignmentsAi"],
        "subgroup_validation.csv": result["subgroups"]["validation"], "subgroup_profiles.csv": result["subgroups"]["profiles"],
        "subgroup_composition.csv": result["subgroups"]["composition"], "pca_scores.csv": result["subgroups"]["pca"],
        "energy_ai_human.csv": result["distribution"]["energy"], "mmd_ai_human.csv": result["distribution"]["mmd"],
        "energy_mmd_consistency.csv": result["distribution"]["consistency"], "nn_ai_human.csv": result["matching"]["nn"],
        "nn_distance_distribution.csv": result["matching"]["nnDistances"], "hungarian_ai_human.csv": result["matching"]["hungarian"],
        "quality_control.csv": result["qc"]["rows"],
    }
    with zipfile.ZipFile(target / "task2_heterogeneity_csv.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, table in tables.items():
            archive.writestr(name, csv_bytes(table))
        archive.writestr("method.json", json.dumps({"config": result["config"], "method": result["method"], "seed": result["randomSeed"]}, ensure_ascii=False, indent=2).encode("utf-8"))
    print("Completed. Results:", target.resolve(), flush=True)


if __name__ == "__main__":
    main()
