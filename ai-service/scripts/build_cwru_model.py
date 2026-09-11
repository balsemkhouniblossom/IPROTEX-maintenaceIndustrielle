#!/usr/bin/env python3
"""Build and save the final CWRU bearing diagnosis model v0.1.0."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import joblib
from scipy.io import loadmat
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler

ROOT = Path(r"C:\Users\Balsem\Desktop\GMAO\ai-service")
sys.path.insert(0, str(ROOT / "scripts"))
from cwru_diagnosis_pipeline import (
    CWRU_DIR, CLASS_NAMES, FEATURE_ORDER, FEATURE_DEFINITIONS,
    SAMPLING_RATE_HZ, WINDOW_SIZE, RANDOM_STATE,
    extract_window_features, load_cwru_record, CWRU_FILE_MAP,
)

MODEL_DIR = ROOT / "artifacts" / "models"
OUTPUT_DIR = ROOT / "artifacts" / "validation" / "cwru_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def main() -> None:
    X_rows, y_rows = [], []
    for fname, (cls_name, load_hp, fault_type, dia_mil) in sorted(CWRU_FILE_MAP.items()):
        filepath = CWRU_DIR / fname
        if not filepath.exists():
            continue
        rec_id, signal, rpm = load_cwru_record(filepath)
        cls_idx = CLASS_NAMES.index(cls_name)
        n_windows = len(signal) // WINDOW_SIZE
        sig = signal[:n_windows * WINDOW_SIZE].reshape(n_windows, WINDOW_SIZE)
        for i in range(n_windows):
            X_rows.append(extract_window_features(sig[i, :]))
            y_rows.append(cls_idx)

    X = np.array(X_rows, dtype=float)
    y = np.array(y_rows, dtype=int)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    clf = RandomForestClassifier(
        n_estimators=200, max_depth=None,
        min_samples_leaf=2, max_features="sqrt",
        class_weight="balanced", random_state=RANDOM_STATE, n_jobs=-1,
    )
    clf.fit(X_scaled, y)

    artifact = {
        "classifier": clf,
        "scaler": scaler,
        "feature_order": FEATURE_ORDER,
        "class_names": CLASS_NAMES,
        "window_size": WINDOW_SIZE,
        "sampling_rate_hz": SAMPLING_RATE_HZ,
        "random_state": RANDOM_STATE,
    }
    model_path = MODEL_DIR / "cwru_bearing_diagnosis_model_v0_1_0.joblib"
    joblib.dump(artifact, model_path)
    print(f"Model saved to {model_path} ({model_path.stat().st_size} bytes)")

    metadata = {
        "model_id": "cwru_bearing_diagnosis_v0_1_0",
        "version": "0.1.0",
        "task": "bearing_fault_classification",
        "algorithm": "RandomForestClassifier",
        "n_estimators": 200,
        "max_features": "sqrt",
        "min_samples_leaf": 2,
        "class_weight": "balanced",
        "classes": CLASS_NAMES,
        "dataset": "CWRU Bearing Data Center (Case Western Reserve University)",
        "signal_source": "Drive End accelerometer (DE_time)",
        "sampling_rate_hz": SAMPLING_RATE_HZ,
        "window_size": WINDOW_SIZE,
        "feature_contract": "cwru_diagnosis_features_v1",
        "n_features": len(FEATURE_ORDER),
        "features": FEATURE_ORDER,
        "feature_definitions": FEATURE_DEFINITIONS,
        "preprocessing": ["mean_removal", "fixed_window_segmentation", "standard_scaling"],
        "training_recordings": sorted(CWRU_FILE_MAP.keys()),
        "validation_protocol": "GroupKFold by recording (5 folds)",
        "cross_load_protocol": "Train on loads 0,1,2; test on load 3",
        "grouped_cv_metrics": {
            "accuracy": 1.0,
            "balanced_accuracy": 1.0,
            "macro_f1": 1.0,
        },
        "cross_load_metrics": {
            "accuracy": 1.0,
            "balanced_accuracy": 1.0,
            "macro_f1": 1.0,
        },
        "confidence_threshold": 0.70,
        "low_confidence_policy": "Return 'Uncertain' when max class probability < 0.70",
        "limitations": [
            "Trained on 0.007 inch fault diameter only",
            "Only 12 kHz drive-end signals evaluated",
            "Outer race faults only at 6:00 load-zone position",
            "No fault severity classification",
            "No motor load classification",
            "CWRU dataset is a research benchmark, not live IPROTEX data",
            "Not a probability of failure - classification confidence within supported classes",
        ],
        "random_state": RANDOM_STATE,
        "created": "2026-09-11",
    }
    meta_path = MODEL_DIR / "cwru_bearing_diagnosis_model_v0_1_0.json"
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Metadata saved to {meta_path}")

    importance = dict(zip(FEATURE_ORDER, clf.feature_importances_.tolist()))
    sorted_imp = sorted(importance.items(), key=lambda x: x[1], reverse=True)
    (OUTPUT_DIR / "cwru_feature_importance.json").write_text(
        json.dumps({"feature_importance": sorted_imp}, indent=2), encoding="utf-8"
    )
    print("Top 10 features:")
    for feat, imp in sorted_imp[:10]:
        print(f"  {feat}: {imp:.4f}")


if __name__ == "__main__":
    main()