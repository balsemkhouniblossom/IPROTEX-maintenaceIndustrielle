#!/usr/bin/env python3
"""Phase 2: PRONOSTIA/FEMTO-ST bearing dataset audit."""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

ROOT = Path(r"C:\Users\Balsem\Desktop\GMAO\ai-service")
DATA_DIR = ROOT / "data" / "raw" / "pronostia"
OUTPUT_DIR = ROOT / "artifacts" / "rul"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

CONDITIONS = {
    "1": {"rpm": 1800, "load_n": 4000, "prefix": "Bearing1"},
    "2": {"rpm": 1650, "load_n": 4200, "prefix": "Bearing2"},
    "3": {"rpm": 1500, "load_n": 5000, "prefix": "Bearing3"},
}

LEARNING_BEARINGS = ["Bearing1_1", "Bearing1_2", "Bearing2_1", "Bearing2_2", "Bearing3_1", "Bearing3_2"]
TEST_BEARINGS = [
    "Bearing1_3", "Bearing1_4", "Bearing1_5", "Bearing1_6",
    "Bearing2_3", "Bearing2_4", "Bearing2_5", "Bearing2_6", "Bearing2_7",
    "Bearing3_3", "Bearing3_4", "Bearing3_5",
]


def audit_bearing(bearing_dir: Path, condition: str) -> dict:
    result = {"bearing": bearing_dir.name, "condition": condition}
    if not bearing_dir.exists():
        result["status"] = "MISSING"
        return result

    acc_files = sorted(bearing_dir.glob("acc_*.csv"))
    temp_files = sorted(bearing_dir.glob("temp_*.csv"))
    result["status"] = "PRESENT"
    result["n_acc_files"] = len(acc_files)
    result["n_temp_files"] = len(temp_files)

    if not acc_files:
        result["error"] = "No acc CSV files"
        return result

    # Read first file
    try:
        with open(acc_files[0]) as fh:
            reader = csv.reader(fh)
            first_samples = [float(row[3]) for row in reader if len(row) >= 4]
        result["acc_first_file_samples"] = len(first_samples)
        result["acc_first_file_min"] = float(np.min(first_samples))
        result["acc_first_file_max"] = float(np.max(first_samples))
        result["acc_first_file_mean"] = float(np.mean(first_samples))
        result["acc_first_file_std"] = float(np.std(first_samples))
    except Exception as e:
        result.setdefault("errors", []).append(f"{acc_files[0].name}: {e}")

    # Read last file
    try:
        with open(acc_files[-1]) as fh:
            reader = csv.reader(fh)
            last_samples = [float(row[3]) for row in reader if len(row) >= 4]
        result["acc_last_file_samples"] = len(last_samples)
        result["acc_last_file_mean"] = float(np.mean(last_samples)) if last_samples else None
        result["acc_last_file_std"] = float(np.std(last_samples)) if last_samples else None
    except Exception as e:
        result.setdefault("errors", []).append(f"{acc_files[-1].name}: {e}")

    # Total samples
    total_samples = 0
    for f in acc_files:
        try:
            with open(f) as fh:
                total_samples += sum(1 for _ in csv.reader(fh))
        except Exception:
            pass
    result["total_acc_samples"] = total_samples
    result["estimated_duration_minutes"] = total_samples / (20000 * 60) if total_samples else None
    return result


def main():
    report = {"dataset": "PRONOSTIA/FEMTO-ST", "conditions": CONDITIONS, "bearings": {}}

    for cond_id, cond_info in CONDITIONS.items():
        prefix = cond_info["prefix"]
        for bearing_num in range(1, 8):
            bearing_name = f"{prefix}_{bearing_num}"
            bearing_dir = DATA_DIR / "Learning_set" / bearing_name
            if not bearing_dir.exists():
                bearing_dir = DATA_DIR / "Test_set" / bearing_name
            if not bearing_dir.exists():
                bearing_dir = DATA_DIR / "Full_Test_Set" / f"Bearing{bearing_num}"
            if not bearing_dir.exists():
                report["bearings"][bearing_name] = {"status": "MISSING", "condition": cond_id}
                continue
            result = audit_bearing(bearing_dir, cond_id)
            result["split"] = "learning" if bearing_name in LEARNING_BEARINGS else "test"
            report["bearings"][bearing_name] = result

    present = [b for b, r in report["bearings"].items() if r.get("status") == "PRESENT"]
    missing = [b for b, r in report["bearings"].items() if r.get("status") == "MISSING"]
    report["summary"] = {
        "total_expected": len(report["bearings"]),
        "present": len(present),
        "missing": len(missing),
        "missing_list": missing,
        "present_list": present,
    }

    out_path = OUTPUT_DIR / "pronostia_dataset_audit.json"
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"Audit saved to {out_path}")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()