#!/usr/bin/env python3
"""CWRU Bearing Fault Diagnosis Pipeline v0.1.0.

Supervised classification of CWRU drive-end vibration signals.
Classes: NORMAL, INNER_RACE, OUTER_RACE, BALL

Leakage prevention: grouped splitting by source recording.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.io import loadmat
from scipy.signal import detrend
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, balanced_accuracy_score, classification_report,
    confusion_matrix, f1_score, precision_score, recall_score,
)
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from sklearn.preprocessing import StandardScaler

ROOT = Path(r"C:\Users\Balsem\Desktop\GMAO\ai-service")
CWRU_DIR = ROOT / "data" / "raw" / "cwru"
OUTPUT_DIR = ROOT / "artifacts" / "validation" / "cwru_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR = ROOT / "artifacts" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

SAMPLING_RATE_HZ = 12000
WINDOW_SIZE = 2048
RANDOM_STATE = 42

CLASS_NAMES = ["NORMAL", "INNER_RACE", "OUTER_RACE", "BALL"]

CWRU_FILE_MAP = {
    "97.mat":  ("NORMAL", 0, "normal", 0),
    "98.mat":  ("NORMAL", 0, "normal", 0),
    "105.mat": ("INNER_RACE", 0, "inner_race", 7),
    "106.mat": ("INNER_RACE", 1, "inner_race", 7),
    "107.mat": ("INNER_RACE", 2, "inner_race", 7),
    "108.mat": ("INNER_RACE", 3, "inner_race", 7),
    "118.mat": ("BALL", 0, "ball", 7),
    "119.mat": ("BALL", 1, "ball", 7),
    "120.mat": ("BALL", 2, "ball", 7),
    "121.mat": ("BALL", 3, "ball", 7),
    "130.mat": ("OUTER_RACE", 0, "outer_race", 7),
    "131.mat": ("OUTER_RACE", 1, "outer_race", 7),
    "132.mat": ("OUTER_RACE", 2, "outer_race", 7),
    "133.mat": ("OUTER_RACE", 3, "outer_race", 7),
}

FEATURE_ORDER = [
    "rms", "sd", "mav", "p2p", "max_abs", "kurtosis", "skewness",
    "crest_factor", "shape_factor", "impulse_factor", "clearance_factor",
    "margin_factor", "zero_crossing_rate",
    "spectral_centroid", "spectral_bandwidth", "spectral_entropy",
    "spectral_flatness", "spectral_crest", "dominant_freq", "dominant_amp",
    "envelope_rms", "envelope_kurtosis", "envelope_crest", "envelope_peak",
    "envelope_spectral_entropy",
]

FEATURE_DEFINITIONS = {
    "rms": "Root mean square of windowed signal",
    "sd": "Standard deviation of windowed signal",
    "mav": "Mean absolute value",
    "p2p": "Peak-to-peak amplitude",
    "max_abs": "Maximum absolute amplitude",
    "kurtosis": "Kurtosis (4th central moment / std^4)",
    "skewness": "Skewness (3rd central moment / std^3)",
    "crest_factor": "Peak / RMS ratio",
    "shape_factor": "RMS / Mean Absolute Value",
    "impulse_factor": "Peak / Mean Absolute Value",
    "clearance_factor": "Peak / (Mean Absolute Value)^2 * MAV",
    "margin_factor": "Peak / (Mean Absolute Value)",
    "zero_crossing_rate": "Fraction of zero-crossings per window",
    "spectral_centroid": "Weighted mean frequency of FFT magnitude",
    "spectral_bandwidth": "RMS deviation of FFT magnitude around centroid",
    "spectral_entropy": "Shannon entropy of normalized FFT magnitude",
    "spectral_flatness": "Geometric mean / arithmetic mean of FFT magnitude",
    "spectral_crest": "Max FFT magnitude / mean FFT magnitude",
    "dominant_freq": "Frequency with maximum FFT magnitude",
    "dominant_amp": "Maximum FFT magnitude",
    "envelope_rms": "RMS of Hilbert amplitude envelope",
    "envelope_kurtosis": "Kurtosis of Hilbert amplitude envelope",
    "envelope_crest": "Peak envelope / envelope RMS",
    "envelope_peak": "Maximum envelope amplitude",
"envelope_spectral_entropy": "Shannon entropy of envelope spectrum",
}


def extract_window_features(signal: np.ndarray, sampling_rate: int = SAMPLING_RATE_HZ) -> np.ndarray:
    """Extract 25 features from a single 1D vibration window."""
    sig = np.asarray(signal, dtype=float)
    sig = sig - np.mean(sig)
    sd = float(np.std(sig, ddof=1)) if len(sig) > 1 else 0.0
    rms = float(np.sqrt(np.mean(sig ** 2)))
    mav = float(np.mean(np.abs(sig)))
    p2p = float(np.max(sig) - np.min(sig))
    max_abs = float(np.max(np.abs(sig)))
    kurt = float(np.mean((sig - sig.mean()) ** 4) / (sd ** 4 + 1e-12)) if sd > 0 else 0.0
    skew = float(np.mean((sig - sig.mean()) ** 3) / (sd ** 3 + 1e-12)) if sd > 0 else 0.0
    crest = float(max_abs / (rms + 1e-12))
    shape = float(rms / (mav + 1e-12))
    impulse = float(max_abs / (mav + 1e-12))
    clearance = float(p2p / (mav + 1e-12))
    margin = float(max_abs / (mav + 1e-12))
    n = len(sig)
    zcr = float(np.sum(np.diff(np.signbit(sig)) != 0) / n)

    fft = np.fft.rfft(sig)
    mag = np.abs(fft)
    freqs = np.fft.rfftfreq(n, d=1.0 / sampling_rate)
    if mag.sum() > 0:
        spectral_centroid = float(np.sum(freqs * mag) / np.sum(mag))
        spectral_bandwidth = float(np.sqrt(np.sum(((freqs - spectral_centroid) ** 2) * mag) / np.sum(mag)))
        normalized = mag / mag.sum()
        spectral_entropy = float(-np.sum(normalized * np.log2(normalized + 1e-12)))
        spectral_flatness = float(np.exp(np.mean(np.log(mag + 1e-12))) / (np.mean(mag) + 1e-12))
        spectral_crest = float(np.max(mag) / (np.mean(mag) + 1e-12))
        dom_freq = float(freqs[np.argmax(mag)])
        dom_amp = float(np.max(mag))
    else:
        spectral_centroid = spectral_bandwidth = spectral_entropy = 0.0
        spectral_flatness = spectral_crest = dom_freq = dom_amp = 0.0

    try:
        from scipy.signal import hilbert
        env = np.abs(hilbert(sig))
        env_rms = float(np.sqrt(np.mean(env ** 2)))
        env_sd = float(np.std(env, ddof=1)) if len(env) > 1 else 0.0
        env_kurt = float(np.mean((env - env.mean()) ** 4) / (env_sd ** 4 + 1e-12)) if env_sd > 0 else 0.0
        env_crest = float(np.max(env) / (env_rms + 1e-12))
        env_peak = float(np.max(env))
        env_fft = np.fft.rfft(env)
        env_mag = np.abs(env_fft)
        if env_mag.sum() > 0:
            env_norm = env_mag / env_mag.sum()
            env_spectral_entropy = float(-np.sum(env_norm * np.log2(env_norm + 1e-12)))
        else:
            env_spectral_entropy = 0.0
    except Exception:
        env_rms = env_kurt = env_crest = env_peak = env_spectral_entropy = 0.0

    return np.array([
        rms, sd, mav, p2p, max_abs, kurt, skew,
        crest, shape, impulse, clearance, margin, zcr,
        spectral_centroid, spectral_bandwidth, spectral_entropy,
        spectral_flatness, spectral_crest, dom_freq, dom_amp,
        env_rms, env_kurt, env_crest, env_peak, env_spectral_entropy,
    ], dtype=float)


def load_cwru_record(filepath: Path) -> tuple[str, np.ndarray, int]:
    """Load a CWRU MAT file, returning (recording_id, de_signal, rpm)."""
    mat = loadmat(filepath, squeeze_me=True)
    keys = [k for k in mat.keys() if not k.startswith("__")]
    de_key = [k for k in keys if "DE_time" in k][0]
    rpm_key = [k for k in keys if "RPM" in k]
    rpm = int(mat[rpm_key[0]]) if rpm_key else 0
    signal = np.asarray(mat[de_key], dtype=float).ravel()
    recording_id = filepath.stem
    return recording_id, signal, rpm


def build_dataset(window_size: int = WINDOW_SIZE) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[dict]]:
    """Build the full CWRU dataset with grouped recording IDs.

    Returns (X, y, groups, metadata) where:
    - X: feature matrix (n_windows, n_features)
    - y: class labels (n_windows,)
    - groups: recording IDs for grouped splitting (n_windows,)
    - metadata: list of per-window metadata dicts
    """
    X_rows, y_rows, group_rows, meta_rows = [], [], [], []

    for fname, (cls_name, load_hp, fault_type, dia_mil) in sorted(CWRU_FILE_MAP.items()):
        filepath = CWRU_DIR / fname
        if not filepath.exists():
            print(f"  WARNING: {fname} not found, skipping")
            continue
        rec_id, signal, rpm = load_cwru_record(filepath)
        cls_idx = CLASS_NAMES.index(cls_name)

        # Segment into windows
        n_windows = len(signal) // window_size
        if n_windows == 0:
            continue
        sig = signal[:n_windows * window_size].reshape(n_windows, window_size)
        for i in range(n_windows):
            window = sig[i, :]
            feats = extract_window_features(window)
            X_rows.append(feats)
            y_rows.append(cls_idx)
            group_rows.append(rec_id)
            meta_rows.append({
                "recording": rec_id,
                "class": cls_name,
                "load_hp": load_hp,
                "fault_type": fault_type,
                "diameter_mil": dia_mil,
                "window_index": i,
                "window_size": window_size,
            })

    X = np.array(X_rows, dtype=float)
    y = np.array(y_rows, dtype=int)
    groups = np.array(group_rows)
    print(f"Dataset: {len(X)} windows, {X.shape[1]} features, "
          f"{len(set(groups))} recordings, {len(set(y))} classes")
    print(f"Class distribution: {dict(Counter(CLASS_NAMES[i] for i in y))}")
    return X, y, groups, meta_rows


def run_grouped_cv(
    X: np.ndarray, y: np.ndarray, groups: np.ndarray,
    classifier_factory, n_splits: int = 5,
) -> dict[str, Any]:
    """Run GroupKFold cross-validation with grouped splitting by recording."""
    gkf = GroupKFold(n_splits=n_splits)
    fold_results = []
    all_y_true = []
    all_y_pred = []
    all_y_prob = []

    for fold, (train_idx, test_idx) in enumerate(gkf.split(X, y, groups)):
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]

        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X_train)
        X_test_s = scaler.transform(X_test)

        clf = classifier_factory()
        clf.fit(X_train_s, y_train)
        y_pred = clf.predict(X_test_s)
        y_prob = clf.predict_proba(X_test_s)

        fold_results.append({
            "fold": fold,
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "balanced_accuracy": float(balanced_accuracy_score(y_test, y_pred)),
            "macro_f1": float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
            "macro_precision": float(precision_score(y_test, y_pred, average="macro", zero_division=0)),
            "macro_recall": float(recall_score(y_test, y_pred, average="macro", zero_division=0)),
            "test_recordings": sorted(set(groups[test_idx])),
            "train_recordings": sorted(set(groups[train_idx])),
        })
        all_y_true.extend(y_test.tolist())
        all_y_pred.extend(y_pred.tolist())
        all_y_prob.extend(y_prob.tolist())

    all_y_true = np.array(all_y_true)
    all_y_pred = np.array(all_y_pred)
    all_y_prob = np.array(all_y_prob)

    return {
        "folds": fold_results,
        "overall": {
            "accuracy": float(accuracy_score(all_y_true, all_y_pred)),
            "balanced_accuracy": float(balanced_accuracy_score(all_y_true, all_y_pred)),
            "macro_f1": float(f1_score(all_y_true, all_y_pred, average="macro", zero_division=0)),
            "macro_precision": float(precision_score(all_y_true, all_y_pred, average="macro", zero_division=0)),
            "macro_recall": float(recall_score(all_y_true, all_y_pred, average="macro", zero_division=0)),
            "classification_report": classification_report(
                all_y_true, all_y_pred, target_names=CLASS_NAMES, zero_division=0, output_dict=True
            ),
            "confusion_matrix": confusion_matrix(all_y_true, all_y_pred).tolist(),
        },
    }


def run_cross_load_cv(
    X: np.ndarray, y: np.ndarray, groups: np.ndarray,
    classifier_factory, meta: list[dict],
) -> dict[str, Any]:
    """Cross-load evaluation: train on loads 0,1,2; test on load 3."""
    load_by_recording = {}
    for m in meta:
        load_by_recording[m["recording"]] = m["load_hp"]

    train_mask = np.array([load_by_recording[g] in (0, 1, 2) for g in groups])
    test_mask = np.array([load_by_recording[g] == 3 for g in groups])

    X_train, X_test = X[train_mask], X[test_mask]
    y_train, y_test = y[train_mask], y[test_mask]

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    clf = classifier_factory()
    clf.fit(X_train_s, y_train)
    y_pred = clf.predict(X_test_s)
    y_prob = clf.predict_proba(X_test_s)

    unique_labels = sorted(set(y_test.tolist()) | set(y_pred.tolist()))
    present_names = [CLASS_NAMES[i] for i in unique_labels]
    return {
        "train_loads": [0, 1, 2],
        "test_load": 3,
        "n_train": int(train_mask.sum()),
        "n_test": int(test_mask.sum()),
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_test, y_pred)),
        "macro_f1": float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
        "macro_precision": float(precision_score(y_test, y_pred, average="macro", zero_division=0)),
        "macro_recall": float(recall_score(y_test, y_pred, average="macro", zero_division=0)),
        "classification_report": classification_report(
            y_test, y_pred, labels=unique_labels, target_names=present_names,
            zero_division=0, output_dict=True
        ),
        "confusion_matrix": confusion_matrix(y_test, y_pred, labels=unique_labels).tolist(),
        "present_classes": present_names,
        "test_recordings": sorted(set(groups[test_mask])),
    }


def make_rf_factory(n_estimators: int = 200, max_depth: int | None = None) -> callable:
    return lambda: RandomForestClassifier(
        n_estimators=n_estimators, max_depth=max_depth,
        min_samples_leaf=2, max_features="sqrt",
        class_weight="balanced", random_state=RANDOM_STATE, n_jobs=-1,
    )


def make_gb_factory() -> callable:
    return lambda: GradientBoostingClassifier(
        n_estimators=100, max_depth=3, random_state=RANDOM_STATE,
    )


def make_lr_factory() -> callable:
    return lambda: LogisticRegression(
        max_iter=2000, class_weight="balanced", random_state=RANDOM_STATE,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="CWRU bearing fault diagnosis pipeline")
    parser.add_argument("--window-size", type=int, default=WINDOW_SIZE)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    print("Building CWRU dataset...")
    X, y, groups, meta = build_dataset(args.window_size)
    (args.output_dir / "cwru_dataset_summary.json").write_text(
        json.dumps({
            "n_windows": len(X),
            "n_features": X.shape[1],
            "window_size": args.window_size,
            "sampling_rate_hz": SAMPLING_RATE_HZ,
            "n_recordings": len(set(groups)),
            "class_distribution": dict(Counter(CLASS_NAMES[i] for i in y)),
            "recordings_per_class": {
                cls: sorted(set(m["recording"] for m in meta if m["class"] == cls))
                for cls in CLASS_NAMES
            },
        }, indent=2), encoding="utf-8"
    )

    models = {
        "RandomForest": make_rf_factory(),
        "GradientBoosting": make_gb_factory(),
        "LogisticRegression": make_lr_factory(),
    }

    results = {}
    for name, factory in models.items():
        print(f"\nEvaluating {name}...")
        cv_result = run_grouped_cv(X, y, groups, factory)
        cl_result = run_cross_load_cv(X, y, groups, factory, meta)
        results[name] = {
            "grouped_cv": cv_result,
            "cross_load": cl_result,
        }
        print(f"  Grouped CV macro F1: {cv_result['overall']['macro_f1']:.4f}")
        print(f"  Cross-load macro F1: {cl_result['macro_f1']:.4f}")

    (args.output_dir / "cwru_model_comparison.json").write_text(
        json.dumps(results, indent=2, default=str), encoding="utf-8"
    )
    print(f"\nResults saved to {args.output_dir}")


if __name__ == "__main__":
    main()