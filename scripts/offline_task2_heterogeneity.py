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
        parsed = parsed.get("associations", parsed.get("emotions", parsed.get("answers")))
    if not isinstance(parsed, list):
        return None
    output = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        emotion = str(item.get("emotion", "")).strip()
        try:
            intensity = int(round(float(item.get("intensity", 0))))
        except (TypeError, ValueError):
            continue
        if emotion in EMOTIONS and 1 <= intensity <= 5:
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
        valid_cells = invalid_cells = 0
        cohort = "human" if source in HUMANS else "ai"
        for row_index, record in frame.iterrows():
            if not any(column and pd.notna(record.get(column)) and str(record.get(column)).strip() for column in columns.values()):
                continue
            participant = str(record.get(participant_column, "") if participant_column else "").strip()
            run = str(record.get(run_column, "") if run_column else "").strip()
            unit = participant if cohort == "human" and participant else run if cohort == "ai" and run else str(row_index + 1)
            for color in COLORS:
                column = columns[color]
                associations = parse_associations(record.get(column)) if column else None
                valid = associations is not None
                valid_cells += int(valid); invalid_cells += int(not valid)
                mapping = {item["emotion"]: item["intensity"] for item in associations or []}
                for emotion in EMOTIONS:
                    intensity = int(mapping.get(emotion, 0))
                    output.append({
                        "source": source, "cohort": cohort, "participant": unit if cohort == "human" else "",
                        "run": unit if cohort == "ai" else "", "sourceRow": int(row_index + 1), "identityProvided": bool(participant or run),
                        "color": color, "emotion": emotion, "selected": int(intensity > 0), "intensity": intensity, "valid": valid,
                    })
        summary[source] = {"file": file_name, "workbookRows": len(frame), "validColorCells": valid_cells, "invalidColorCells": invalid_cells, "parsedProfiles": valid_cells / len(COLORS)}
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
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = PROJECT / "offline_results" / f"task2_heterogeneity_{args.preset}_{stamp}"
    target.mkdir(parents=True, exist_ok=False)
    (target / "input_summary.json").write_text(json.dumps({"preset": args.preset, "options": options, "sources": summary, "longRows": len(rows)}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Loaded {len(rows):,} long rows. Starting {args.preset} analysis...", flush=True)
    result = run_task2_heterogeneity({"rows": rows, "options": options}, progress=Progress())
    with gzip.open(target / "task2_heterogeneity_result.json.gz", "wt", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)
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
