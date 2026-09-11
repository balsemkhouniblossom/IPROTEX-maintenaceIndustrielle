#!/usr/bin/env python3
"""CWRU bearing fault diagnosis pipeline."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import scipy.io as sio
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix, f1_score, precision_score, recall_score)
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler

ROOT = Path(__file__).resolve().parents[2].resolve()
CWRU_DIR = ROOT / "data" / "raw" / "cwrU"
OUTPUT_DIR = ROOT / "artifacts" / "validation" / "cwrU_fault_diagnosis"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

RANDOM_STATE = 42

FILE_MAP = {
    97:  (0, "normal",       0.0),
    98:  (0, "normal",       0.0),
    99:  (0, "normal",       0.0),
    100: (0, "outer_race",   0.021),
    105: (0, "ball",         0.007),
    106: (0, "inner_race",   0.007),
    107: (0, "outer_race",   0.007),
    108: (0, "outer_race",   0.007),
    118: (0, "outer_race",   0.014),
    119: (0, "outer_race",   0.014),
    120: (0, "ball",         0.021),
    121: (0, "inner_race",   0.021),
    130: (0, "ball",         0.007),
    131: (0, "inner_race",   0.007),
    132: (0, "outer_race",   0.007),
    133: (0, "outer_race",   0.007),
}

for load in [1, 2, 3]:
    base = {1: 185, 2: 195, 3: 200}[load]
    FILE_MAP.update({
        base:     (load, "normal",       0.0),
        base + 1: (load, "outer_race",   0.007),
        base + 2: (load, "ball",         0.007),
        base + 3: (load, "inner_race",   0.007),
        base + 4: (load, "outer_race",   0.007),
        base + 5: (load, "outer_race",   0.007),
    })


def load_cwrU_signal(filepath):
    mat = sio.loadmat(str(filepath))
    result = {}
    for key in mat:
        if key.startswith("__"):
            continue
        arr = mat[key]
        if arr.ndim == 2 and arr.shape[1] == 1:
            result[key] = arr.ravel()
        else:
            result[key] = arr
    return result


def extract_time_domain_features(signal):
    signal = np.asarray(signal, dtype=np.float64)
    if len(signal) == 0:
        return {}
    abs_signal = np.abs(signal)
    return {
        "mean": float(np.mean(signal)),
        "std": float(np.std(signal)),
        "rms": float(np.sqrt(np.mean(signal ** 2))),
        "peak": float(np.max(abs_signal)),
        "peak_to_peak": float(np.max(signal) - np.min(signal)),
        "kurtosis": float(float(np.mean((signal - np.mean(signal)) ** 4)) / (float(np.std(signal)) ** 4 + 1e-12)),
        "skewness": float(float(np.mean((signal - np.mean(signal)) ** 3)) / (float(np.std(signal)) ** 3 + 1e-12)),
        "crest_factor": float(np.max(abs_signal) / (np.sqrt(np.mean(signal ** 2)) + 1e-12)),
        "shape_factor": float(np.sqrt(np.mean(signal ** 2)) / (np.mean(abs_signal) + 1e-12)),
        "impulse_factor": float(np.max(abs_signal) / (np.mean(abs_signal) + 1e-12)),
        "margin_factor": float(np.max(abs_signal) / (np.sum(np.sqrt(abs_signal)) / len(abs_signal) + 1e-12)),
        "pulse_factor": float(np.mean(abs_signal) ** 2 / np.sqrt(np.mean(signal ** 2) + 1e-12)),
        "square_factor": float(np.mean(abs_signal) ** 2 / (np.mean(signal ** 2) + 1e-12)),
        "abs_mean": float(np.mean(abs_signal)),
        "root_amplitude": float(np.sqrt(2) * np.std(signal)),
        "variance": float(np.var(signal)),
        "energy": float(np.sum(signal ** 2)),
        "median": float(np.median(signal)),
    }


def extract_band_energy_features(signal, sampling_rate_hz=12000, n_bands=10):
    signal = np.asarray(signal, dtype=np.float64)
    if len(signal) == 0:
        return {}
    fft_vals = np.abs(np.fft.rfft(signal))
    n_freqs = len(fft_vals)
    band_size = max(n_freqs // n_bands, 1)
    features = {}
    nyquist = sampling_rate_hz / 2
    for i in range(n_bands):
        start = i * band_size
        end = min(start + band_size, n_freqs)
        if start < end:
            band_energy = float(np.sum(fft_vals[start:end] ** 2))
            freq_center = nyquist * (start + end) / (2 * n_freqs)
            features[f"band_{i}_energy"] = band_energy
            features[f"band_{i}_freq_center"] = freq_center
    total_energy = sum(v for k, v in features.items() if "energy" in k) or 1.0
    for i in range(n_bands):
        features[f"band_{i}_energy_norm"] = features.get(f"band_{i}_energy", 0) / total_energy
    return features


def load_dataset():
    X_parts = []
    y_parts = []
    file_info = []
    for fnum in sorted(FILE_MAP.keys()):
        filepath = CWRU_DIR / f"{fnum}.mat"
        if not filepath.exists():
            continue
        data = load_cwrU_signal(filepath)
        de_signal = data.get(f"X{fnum}_DE_time")
        if de_signal is None:
            de_signal = data.get(f"X{fnum:03d}_DE_time")
        if de_signal is None:
            fe_signal = data.get(f"X{fnum}_FE_time")
            if fe_signal is None:
                fe_signal = data.get(f"X{fnum:03d}_FE_time")
            if fe_signal is not None:
                de_signal = fe_signal
            else:
                continue
        time_features = extract_time_domain_features(de_signal)
        band_features = extract_band_energy_features(de_signal)
        features = {**time_features, **band_features}
        load_hp, fault_type, fault_size = FILE_MAP[fnum]
        label = fault_type
        X_parts.append(features)
        y_parts.append(label)
        file_info.append({
            "file": f"{fnum}.mat",
            "load_hp": load_hp,
            "fault_type": fault_type,
            "fault_size": fault_size,
            "channel": "DE",
        })
    if not X_parts:
        raise ValueError("No CWRU data found")
    feature_names = list(X_parts[0].keys())
    X = np.array([[row.get(f, 0.0) for f in feature_names] for row in X_parts])
    y = np.array(y_parts)
    return X, y, feature_names, file_info


def main():
    skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)
    print("Loading CWRU dataset...")
    X, y, feature_names, file_info = load_dataset()
    print(f"Loaded {X.shape[0]} samples with {X.shape[1]} features")
    classes = sorted(set(y.tolist()))
    print(f"Classes: {classes}")
    for cls in classes:
        count = int(np.sum(y == cls))
        print(f"  {cls}: {count} samples")

    classifiers = {
        "logistic_regression": Pipeline([
            ("scaler", RobustScaler()),
            ("clf", LogisticRegression(max_iter=1000, random_state=RANDOM_STATE)),
        ]),
        "random_forest": RandomForestClassifier(n_estimators=200, random_state=RANDOM_STATE, n_jobs=-1),
        "gradient_boosting": GradientBoostingClassifier(n_estimators=200, random_state=RANDOM_STATE),
    }

    all_results = []
    for name, clf in classifiers.items():
        print(f"Training {name}...")
        clf.fit(X, y)
        y_pred = clf.predict(X)
        acc = accuracy_score(y, y_pred)
        precision = precision_score(y, y_pred, average="macro")
        recall = recall_score(y, y_pred, average="macro")
        f1 = f1_score(y, y_pred, average="macro")
        print(f"  Accuracy: {acc:.4f}")
        print(f"  Precision (macro): {precision:.4f}")
        print(f"  Recall (macro): {recall:.4f}")
        print(f"  F1 (macro): {f1:.4f}")
        results = {
            "name": name,
            "accuracy": float(acc),
            "precision_macro": float(precision),
            "recall_macro": float(recall),
            "f1_macro": float(f1),
            "confusion_matrix": confusion_matrix(y, y_pred).tolist(),
            "classification_report": classification_report(y, y_pred, output_dict=True),
        }
        all_results.append(results)

    print("Cross-validation...")
    cv_results = []
    for name, clf in classifiers.items():
        scores = cross_val_score(clf, X, y, cv=skf, scoring="accuracy")
        cv_results.append({
            "name": name,
            "accuracy_mean": float(scores.mean()),
            "accuracy_std": float(scores.std()),
        })
        print(f"  {name}: {scores.mean():.4f} +/- {scores.std():.4f}")

    manifest = {
        "dataset": "CWRU",
        "files_used": [f["file"] for f in file_info],
        "total_samples": len(y),
        "features": X.shape[1],
        "classes": classes,
        "class_counts": {cls: int(np.sum(y == cls)) for cls in classes},
        "results": all_results,
        "cv_results": cv_results,
    }
    manifest_path = OUTPUT_DIR / "cwrU_fault_diagnosis_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    print(f"Results saved to {manifest_path}")


if __name__ == "__main__":
    main()
