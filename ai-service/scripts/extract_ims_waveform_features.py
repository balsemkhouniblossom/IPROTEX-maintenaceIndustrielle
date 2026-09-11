#!/usr/bin/env python3
"""Reproducible IMS raw-waveform feature extractor for v0.4 research."""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(r"C:\Users\Balsem\Desktop\GMAO\ai-service")
RAW_ROOT = ROOT / "data" / "raw" / "IMS" / "IMS"
OUTPUT_DIR = ROOT / "artifacts" / "validation" / "v0_4_0"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SAMPLING_RATE_HZ = 20000
SAMPLES_PER_FILE = 20480

DOCUMENTED_END = {
    "1st_test": datetime(2003, 11, 25, 23, 39, 56),
    "2nd_test": datetime(2004, 2, 19, 6, 22, 39),
    "3rd_test": datetime(2004, 4, 4, 19, 1, 57),
}

CHANNEL_CONFIG = {
    "1st_test": {"channels": 8, "channel_to_bearing": {1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4}},
    "2nd_test": {"channels": 4, "channel_to_bearing": {1: 1, 2: 2, 3: 3, 4: 4}},
    "3rd_test": {"channels": 4, "channel_to_bearing": {1: 1, 2: 2, 3: 3, 4: 4}},
}

FAILED_BEARINGS = {
    "1st_test": [3, 4],
    "2nd_test": [1],
    "3rd_test": [3],
}


def parse_timestamp(name: str):
    parts = name.replace(".", " ").split()
    if len(parts) >= 6:
        try:
            return datetime(int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]), int(parts[5]))
        except (ValueError, IndexError):
            return None
    return None


def get_experiment_from_path(path: Path) -> str:
    """Determine experiment name from file path."""
    for part in path.parts:
        if part in CHANNEL_CONFIG:
            return part
    return path.parent.parent.name if path.parent.parent.name in CHANNEL_CONFIG else "unknown"


def load_waveform(path: Path) -> tuple[np.ndarray, list[str]]:
    errors = []
    experiment = get_experiment_from_path(path)
    try:
        arr = np.loadtxt(path, delimiter="\t", dtype=float)
    except Exception as e:
        return np.empty((0, 0)), [f"read_error: {e}"]
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    if arr.shape[0] != SAMPLES_PER_FILE:
        errors.append(f"samples={arr.shape[0]}_expected={SAMPLES_PER_FILE}")
    expected = CHANNEL_CONFIG.get(experiment, {}).get("channels", 0)
    if arr.shape[1] != expected:
        errors.append(f"channel_count={arr.shape[1]}_expected={expected}")
    if np.isnan(arr).any():
        errors.append(f"nan_count={int(np.isnan(arr).sum())}")
    if np.isinf(arr).any():
        errors.append(f"inf_count={int(np.isinf(arr).sum())}")
    return arr, errors


def extract_features_from_waveform(arr: np.ndarray, sampling_rate: int = 20000) -> dict[str, float]:
    """Extract all features from a single waveform array (samples x channels).

    The raw IMS files are stored as samples x channels, so we transpose.
    """
    if arr.size == 0:
        return {}
    if arr.ndim == 1:
        arr = arr.reshape(-1, 1)
    # arr is (samples, channels); transpose to (channels, samples)
    arr = arr.T
    n_channels = arr.shape[0]

    feats = {}
    for ch in range(n_channels):
        sig = arr[ch, :]
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
        zero_crossings = int(np.sum(np.diff(np.signbit(sig - sig.mean())) != 0))
        zcr = float(zero_crossings / n)

        # FFT-based spectral features
        fft = np.fft.rfft(sig)
        mag = np.abs(fft)
        freqs = np.fft.rfftfreq(n, d=1.0 / sampling_rate)
        if mag.sum() > 0:
            spectral_energy = float(np.sum(mag ** 2))
            spectral_centroid = float(np.sum(freqs * mag) / np.sum(mag))
            spectral_bandwidth = float(np.sqrt(np.sum(((freqs - spectral_centroid) ** 2) * mag) / np.sum(mag)))
            spectral_entropy = float(-np.sum((mag / mag.sum()) * np.log2((mag / mag.sum()) + 1e-12)))
            spectral_flatness = float(np.exp(np.mean(np.log(mag + 1e-12))) / (np.mean(mag) + 1e-12))
            spectral_crest = float(np.max(mag) / (np.mean(mag) + 1e-12))
            dom_freq = float(freqs[np.argmax(mag)])
            dom_amp = float(np.max(mag))
        else:
            spectral_energy = spectral_centroid = spectral_bandwidth = 0.0
            spectral_entropy = spectral_flatness = spectral_crest = 0.0
            dom_freq = dom_amp = 0.0

        # Envelope via Hilbert transform
        try:
            from scipy.signal import hilbert
            env = np.abs(hilbert(sig))
            env_rms = float(np.sqrt(np.mean(env ** 2)))
            env_sd = float(np.std(env, ddof=1)) if len(env) > 1 else 0.0
            env_kurt = float(np.mean((env - env.mean()) ** 4) / (env_sd ** 4 + 1e-12)) if env_sd > 0 else 0.0
            env_crest = float(np.max(env) / (env_rms + 1e-12))
            env_peak = float(np.max(env))
            env_mav = float(np.mean(np.abs(env)))
            env_energy = float(np.sum(env ** 2))
            env_fft = np.fft.rfft(env)
            env_mag = np.abs(env_fft)
            if env_mag.sum() > 0:
                env_spectral_entropy = float(-np.sum((env_mag / env_mag.sum()) * np.log2((env_mag / env_mag.sum()) + 1e-12)))
                env_peak_freq = float(np.fft.rfftfreq(len(env), d=1.0 / sampling_rate)[np.argmax(env_mag)])
                env_peak_mag = float(np.max(env_mag))
            else:
                env_spectral_entropy = env_peak_freq = env_peak_mag = 0.0
        except Exception:
            env_rms = env_sd = env_kurt = env_crest = env_peak = env_mav = env_energy = 0.0
            env_spectral_entropy = env_peak_freq = env_peak_mag = 0.0

        prefix = f"ch{ch}_"
        feats[prefix + "rms"] = rms
        feats[prefix + "sd"] = sd
        feats[prefix + "mav"] = mav
        feats[prefix + "p2p"] = p2p
        feats[prefix + "max_abs"] = max_abs
        feats[prefix + "kurtosis"] = kurt
        feats[prefix + "skewness"] = skew
        feats[prefix + "crest_factor"] = crest
        feats[prefix + "shape_factor"] = shape
        feats[prefix + "impulse_factor"] = impulse
        feats[prefix + "clearance_factor"] = clearance
        feats[prefix + "margin_factor"] = margin
        feats[prefix + "zero_crossing_rate"] = zcr
        feats[prefix + "spectral_energy"] = spectral_energy
        feats[prefix + "spectral_centroid"] = spectral_centroid
        feats[prefix + "spectral_bandwidth"] = spectral_bandwidth
        feats[prefix + "spectral_entropy"] = spectral_entropy
        feats[prefix + "spectral_flatness"] = spectral_flatness
        feats[prefix + "spectral_crest"] = spectral_crest
        feats[prefix + "dominant_freq"] = dom_freq
        feats[prefix + "dominant_amp"] = dom_amp
        feats[prefix + "envelope_rms"] = env_rms
        feats[prefix + "envelope_sd"] = env_sd
        feats[prefix + "envelope_kurtosis"] = env_kurt
        feats[prefix + "envelope_crest"] = env_crest
        feats[prefix + "envelope_peak"] = env_peak
        feats[prefix + "envelope_mav"] = env_mav
        feats[prefix + "envelope_energy"] = env_energy
        feats[prefix + "envelope_spectral_entropy"] = env_spectral_entropy
        feats[prefix + "envelope_peak_freq"] = env_peak_freq
        feats[prefix + "envelope_peak_mag"] = env_peak_mag
    return feats


def get_files_in_scope(experiment: str, include_undocumented_tail: bool = False) -> list[Path]:
    p = RAW_ROOT / experiment
    if not p.exists():
        return []
    files = sorted([f for f in p.rglob("*") if f.is_file()])
    if include_undocumented_tail:
        return files
    end = DOCUMENTED_END.get(experiment)
    if end is None:
        return files
    result = []
    for f in files:
        ts = parse_timestamp(f.name)
        if ts is not None and ts <= end:
            result.append(f)
    return result


def extract_experiment(experiment: str, max_files: int | None = None) -> tuple[pd.DataFrame, dict[str, Any]]:
    files = get_files_in_scope(experiment)
    if max_files:
        files = files[:max_files]
    rows = []
    stats = {"experiment": experiment, "total_files": len(files), "processed": 0, "errors": []}
    t0 = time.time()
    for f in files:
        arr, errs = load_waveform(f)
        if errs:
            stats["errors"].append({"file": f.name, "errors": errs})
            continue
        ts = parse_timestamp(f.name)
        feats = extract_features_from_waveform(arr)
        n_channels = CHANNEL_CONFIG[experiment]["channels"]
        ch_to_bearing = CHANNEL_CONFIG[experiment]["channel_to_bearing"]
        for ch in range(n_channels):
            row = {
                "timestamp": ts.isoformat() if ts else None,
                "experiment": experiment,
                "sensor_channel": ch + 1,
                "bearing": ch_to_bearing[ch + 1],
                "source_file": f.name,
            }
            for k, v in feats.items():
                if k.startswith(f"ch{ch}_"):
                    row[k.replace(f"ch{ch}_", "")] = v
            rows.append(row)
        stats["processed"] += 1
    stats["elapsed_seconds"] = time.time() - t0
    return pd.DataFrame(rows), stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract IMS waveform features for v0.4 research")
    parser.add_argument("--experiment", default=None, help="Single experiment to process")
    parser.add_argument("--max-files", type=int, default=None, help="Limit files for testing")
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR / "ims_v0_4_waveform_features.csv")
    parser.add_argument("--include-undocumented-tail", action="store_true")
    args = parser.parse_args()

    experiments = [args.experiment] if args.experiment else ["1st_test", "2nd_test", "3rd_test"]
    all_rows = []
    all_stats = {}
    for exp in experiments:
        df, stats = extract_experiment(exp, args.max_files)
        all_rows.append(df)
        all_stats[exp] = stats
        print(f"{exp}: {stats['processed']}/{stats['total_files']} files, {stats['elapsed_seconds']:.1f}s")

    if all_rows:
        combined = pd.concat(all_rows, ignore_index=True)
        combined.to_csv(args.output, index=False)
        print(f"Wrote {len(combined)} rows to {args.output}")
    (OUTPUT_DIR / "ims_v0_4_extraction_stats.json").write_text(
        json.dumps(all_stats, indent=2, default=str), encoding="utf-8"
    )


if __name__ == "__main__":
    main()