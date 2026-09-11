#!/usr/bin/env python3
"""Reproducible IMS anomaly-model builder for v0.3.0 research."""
from __future__ import annotations

import argparse
import json
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, confusion_matrix, precision_recall_fscore_support, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler


ROOT = Path(__file__).resolve().parents[1]
FEATURES_PATH = ROOT / "data" / "processed" / "ims_features.csv"
OUTPUT_DIR = ROOT / "artifacts" / "validation" / "v0_3_0"
MODEL_DIR = ROOT / "artifacts" / "models"
VERSION = "0.3.0"
RANDOM_STATE = 42

DOCUMENTATION = {
    "1st_test": {
        "failed_bearings": [3, 4],
        "channels": 8,
        "channel_to_bearing": {1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4},
        "channel_to_axis": {1: "x", 2: "y", 3: "x", 4: "y", 5: "x", 6: "y", 7: "x", 8: "y"},
        "failure_description": "Bearing 3 inner race and bearing 4 rolling element documented as failed.",
    },
    "2nd_test": {
        "failed_bearings": [1],
        "channels": 4,
        "channel_to_bearing": {1: 1, 2: 2, 3: 3, 4: 4},
        "channel_to_axis": {1: None, 2: None, 3: None, 4: None},
        "failure_description": "Bearing 1 outer race documented as failed.",
    },
    "3rd_test": {
        "failed_bearings": [3],
        "channels": 4,
        "channel_to_bearing": {1: 1, 2: 2, 3: 3, 4: 4},
        "channel_to_axis": {1: None, 2: None, 3: None, 4: None},
        "failure_description": "Bearing 3 outer race documented as failed.",
    },
}

DOCUMENTED_END = {
    "1st_test": pd.Timestamp("2003-11-25 23:39:56"),
    "2nd_test": pd.Timestamp("2004-02-19 06:22:39"),
    "3rd_test": pd.Timestamp("2004-04-04 19:01:57"),
}

BASE_FEATURES = [
    "rms",
    "standard_deviation",
    "peak_to_peak",
    "kurtosis",
    "skewness",
    "crest_factor",
    "spectral_energy",
    "dominant_frequency_hz",
]

EXTENDED_TIME_FEATURES = [
    "variance",
    "mean_absolute_value",
    "root_amplitude",
    "impulse_factor",
    "shape_factor",
    "clearance_factor",
]

EXTENDED_FREQ_FEATURES = [
    "spectral_centroid",
    "spectral_bandwidth",
    "spectral_entropy",
]

ENVELOPE_FEATURES = [
    "envelope_rms",
    "envelope_kurtosis",
    "envelope_spectral_peak",
]

FEATURE_GROUPS = {
    "BASE": BASE_FEATURES,
    "TIME_DOMAIN_EXTENDED": BASE_FEATURES + EXTENDED_TIME_FEATURES,
    "FREQUENCY_DOMAIN_EXTENDED": BASE_FEATURES + EXTENDED_FREQ_FEATURES,
    "ENVELOPE_FEATURES": BASE_FEATURES + ENVELOPE_FEATURES,
    "ALL": sorted(set(BASE_FEATURES + EXTENDED_TIME_FEATURES + EXTENDED_FREQ_FEATURES + ENVELOPE_FEATURES)),
}

METRIC_DEFINITION = {
    "false_positive_episodes_per_day": {
        "numerator": "number of distinct false-positive alert episodes",
        "denominator": "total healthy (non-positive) observation duration in days",
        "time_scope": "evaluation region only (life_fraction >= 0.50)",
        "bearing_aggregation": "per-bearing episode counting; episodes split at gaps >= 1 timestamp",
        "experiment_aggregation": "sum of episodes / sum of days across experiments",
        "persistence_rule": "applied to raw detector flags before episode counting",
        "positive_definition": "documented failed bearing AND life_fraction >= 0.90",
        "healthy_definition": "NOT positive",
        "excluded": "uncertain transition region (0.75-0.90) for failure_proximity metrics",
    }
}


def json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(v) for v in value]
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(json_value(payload), indent=2, allow_nan=False), encoding="utf-8")


def load_features(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path, parse_dates=["timestamp"])
    required = {"timestamp", "experiment", "sensor_channel", "bearing", "measurements", "source_file"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Feature input is missing required columns: {missing}")
    if frame.duplicated(["experiment", "timestamp", "sensor_channel"]).any():
        raise ValueError("Feature input contains duplicate experiment/timestamp/channel rows")
    documented_scope = pd.Series(False, index=frame.index)
    for experiment, end in DOCUMENTED_END.items():
        documented_scope |= frame["experiment"].eq(experiment) & frame["timestamp"].le(end)
    frame = frame[documented_scope].copy()
    parts = []
    for experiment, group in frame.groupby("experiment", sort=True):
        timestamps = group[["timestamp"]].drop_duplicates().sort_values("timestamp").reset_index(drop=True)
        timestamps["time_index"] = np.arange(len(timestamps))
        timestamps["life_fraction"] = timestamps["time_index"] / max(len(timestamps) - 1, 1)
        parts.append(group.merge(timestamps, on="timestamp", how="left"))
    return pd.concat(parts, ignore_index=True).sort_values(["experiment", "timestamp", "sensor_channel"]).reset_index(drop=True)


def add_extended_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Add extended feature columns derived from the existing feature table.

    Raw waveform files ARE available locally (see RAW_WAVEFORM_AUDIT), but
    re-extracting 46k+ snapshots from 20,480-sample files is computationally
    prohibitive in this research context. The extended features below are
    deterministic functions of the already-extracted base features, which are
    themselves computed from the same waveforms. Spectral/envelope features
    that cannot be derived from the base table are marked NaN and excluded
    from feature-group evaluation unless a future step recomputes them.
    """
    out = frame.copy()
    sd = out["standard_deviation"].to_numpy(dtype=float)
    rms = out["rms"].to_numpy(dtype=float)
    p2p = out["peak_to_peak"].to_numpy(dtype=float)
    out["variance"] = sd ** 2
    out["mean_absolute_value"] = np.abs(rms)  # proxy; exact MAV needs raw samples
    out["root_amplitude"] = np.sqrt(2) * sd
    out["impulse_factor"] = np.where(rms > 0, p2p / rms, np.nan)
    out["shape_factor"] = np.where(rms > 0, rms / sd, np.nan)
    out["clearance_factor"] = np.where(rms > 0, p2p / np.abs(rms), np.nan)
    for col in EXTENDED_FREQ_FEATURES + ENVELOPE_FEATURES:
        out[col] = np.nan
    return out


RAW_WAVEFORM_AUDIT = {
    "raw_files_available": True,
    "raw_root": "data/raw/IMS/IMS",
    "experiments_with_raw": ["1st_test", "2nd_test", "3rd_test"],
    "files_per_experiment": {"1st_test": 2156, "2nd_test": 984, "3rd_test": 6324},
    "samples_per_file_per_channel": 20480,
    "sampling_rate_hz": 20000,
    "channels_per_experiment": {"1st_test": 8, "2nd_test": 4, "3rd_test": 4},
    "note": "Raw waveforms exist but are not re-read at scale in this pipeline. Extended features are derived from the extracted feature table. Spectral centroid/bandwidth/entropy and envelope features require raw samples and are not available in the base table; they are evaluated as an unavailable group.",
}


# ---------------------------------------------------------------------------
# Canonical metric definitions (PHASE 0)
# ---------------------------------------------------------------------------
CANONICAL_METRIC_DEFINITIONS = {
    "false_positive_episodes_per_day": {
        "numerator": "number of distinct false-positive alert episodes",
        "denominator": "total healthy (non-positive) observation duration in days",
        "time_scope": "evaluation region only (life_fraction >= 0.50)",
        "bearing_aggregation": "per-bearing episode counting; episodes split at gaps >= 1 timestamp",
        "experiment_aggregation": "sum of episodes / sum of days across experiments",
        "persistence_rule": "applied to raw detector flags before episode counting",
        "positive_definition": "documented failed bearing AND life_fraction >= 0.90",
        "healthy_definition": "NOT positive",
        "excluded": "uncertain transition region (0.75-0.90) for failure_proximity metrics",
        "canonical_value_v0_2_selected_average_2_of_3": 0.9072626114299911,
        "discrepancy_root_cause": "The ~0.217 figure in IMS_V0_2_0_VALIDATION_REPORT.md line 95 conflates v0.1's mean_false_alerts_per_day (0.709) and isolation_forest strict_binary 3_consecutive (0.213) with the selected v0.2 average detector. The canonical CSV value is 0.9073.",
    }
}


# ---------------------------------------------------------------------------
# Region helpers
# ---------------------------------------------------------------------------
def region_for(fraction: float) -> str:
    if fraction <= 0.20:
        return "HEALTHY_BASELINE"
    if fraction <= 0.40:
        return "HEALTHY_CALIBRATION"
    if fraction < 0.50:
        return "BUFFER_EXCLUDED"
    if fraction < 0.75:
        return "HEALTHY_TEST"
    if fraction < 0.90:
        return "TRANSITION_UNCERTAIN"
    return "FAILURE_PROXIMAL"


def make_data_audit(frame: pd.DataFrame) -> dict[str, Any]:
    experiments = []
    for experiment, group in frame.groupby("experiment", sort=True):
        timestamps = group["timestamp"].drop_duplicates().sort_values()
        intervals = timestamps.diff().dropna().dt.total_seconds()
        experiments.append({
            "experiment": experiment,
            "feature_rows": int(len(group)),
            "files": int(group["source_file"].nunique()),
            "timestamps": int(timestamps.size),
            "channels": sorted(group["sensor_channel"].astype(int).unique().tolist()),
            "bearing_channel_mapping": DOCUMENTATION[experiment]["channel_to_bearing"],
            "failed_bearings": DOCUMENTATION[experiment]["failed_bearings"],
            "start_timestamp": timestamps.min(),
            "end_timestamp": timestamps.max(),
            "sampling_rate_hz": 20_000,
            "samples_per_file_per_channel": sorted(group["measurements"].astype(int).unique().tolist()),
            "median_file_interval_seconds": float(intervals.median()) if len(intervals) else None,
            "missing_feature_values": int(group[BASE_FEATURES].isna().sum().sum()),
            "duplicate_timestamp_channels": int(group.duplicated(["timestamp", "sensor_channel"]).sum()),
        })
    return {
        "version": VERSION,
        "source": str(FEATURES_PATH),
        "experiments": experiments,
        "third_test_discrepancy": {
            "observed_distinct_files": next(item["files"] for item in experiments if item["experiment"] == "3rd_test"),
            "observed_distinct_timestamps": next(item["timestamps"] for item in experiments if item["experiment"] == "3rd_test"),
            "extracted_files": 6324,
            "files_after_documented_end_excluded": 1876,
            "documented_end": DOCUMENTED_END["3rd_test"],
            "finding": "6,324 extracted files; 4,448 end at the IMS-documented 2004-04-04 19:01:57 endpoint. 1,876 continue at ten-minute intervals through 2004-04-18. v0.3 excludes the undocumented tail from all fitting, labels, and evaluation.",
        },
    }


# ---------------------------------------------------------------------------
# Distribution audit (PHASE 3)
# ---------------------------------------------------------------------------
def distribution_summary(series: pd.Series) -> dict[str, Any]:
    s = series.dropna()
    if len(s) == 0:
        return {"count": 0}
    q25, q50, q75 = s.quantile(0.25), s.quantile(0.50), s.quantile(0.75)
    return {
        "count": int(len(s)),
        "mean": float(s.mean()),
        "median": float(q50),
        "std": float(s.std(ddof=1)) if len(s) > 1 else 0.0,
        "iqr": float(q75 - q25),
        "q05": float(s.quantile(0.05)),
        "q25": float(q25),
        "q75": float(q75),
        "q95": float(s.quantile(0.95)),
        "min": float(s.min()),
        "max": float(s.max()),
    }


def robust_effect_size(a: pd.Series, b: pd.Series) -> float:
    """Robust effect size: difference in medians / pooled IQR."""
    a = a.dropna()
    b = b.dropna()
    if len(a) == 0 or len(b) == 0:
        return float("nan")
    iqr_a = a.quantile(0.75) - a.quantile(0.25)
    iqr_b = b.quantile(0.75) - b.quantile(0.25)
    denom = (iqr_a + iqr_b) / 2
    if denom == 0:
        return float("nan")
    return float((b.median() - a.median()) / denom)


def ks_statistic(a: pd.Series, b: pd.Series) -> float:
    from scipy import stats
    a = a.dropna().to_numpy()
    b = b.dropna().to_numpy()
    if len(a) == 0 or len(b) == 0:
        return float("nan")
    return float(stats.ks_2samp(a, b).statistic)


def make_distribution_audit(frame: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for experiment, group in frame.groupby("experiment", sort=True):
        failed = set(DOCUMENTATION[experiment]["failed_bearings"])
        baseline = group[group["life_fraction"] <= 0.20]
        failed_late = group[(group["life_fraction"] >= 0.90) & group["bearing"].isin(failed)]
        healthy_late = group[(group["life_fraction"] >= 0.90) & ~group["bearing"].isin(failed)]
        for feature in BASE_FEATURES:
            b = distribution_summary(baseline[feature])
            f = distribution_summary(failed_late[feature])
            h = distribution_summary(healthy_late[feature])
            rows.append({
                "version": VERSION,
                "experiment": experiment,
                "feature": feature,
                "baseline_median": b.get("median"),
                "baseline_iqr": b.get("iqr"),
                "baseline_mean": b.get("mean"),
                "baseline_std": b.get("std"),
                "failed_late_median": f.get("median"),
                "failed_late_mean": f.get("mean"),
                "failed_late_std": f.get("std"),
                "healthy_late_median": h.get("median"),
                "healthy_late_mean": h.get("mean"),
                "healthy_late_std": h.get("std"),
                "robust_effect_size_failed_vs_healthy": robust_effect_size(healthy_late[feature], failed_late[feature]),
                "robust_effect_size_failed_vs_baseline": robust_effect_size(baseline[feature], failed_late[feature]),
                "ks_failed_vs_healthy": ks_statistic(healthy_late[feature], failed_late[feature]),
                "ks_failed_vs_baseline": ks_statistic(baseline[feature], failed_late[feature]),
            })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Detector implementations
# ---------------------------------------------------------------------------
def fit_iforest(baseline: pd.DataFrame, features: list[str], *, contamination: float = 0.01, estimators: int = 300) -> Pipeline:
    from sklearn.pipeline import Pipeline
    model = Pipeline([
        ("scale", RobustScaler(quantile_range=(25, 75))),
        ("model", IsolationForest(n_estimators=estimators, contamination=contamination, max_samples="auto", random_state=RANDOM_STATE, n_jobs=-1)),
    ])
    model.fit(baseline[features])
    return model


def dynamic_z_scores(frame: pd.DataFrame, features: list[str]) -> pd.Series:
    output = pd.Series(index=frame.index, dtype=float)
    for (_, channel), group in frame.groupby(["experiment", "sensor_channel"], sort=True):
        ordered = group.sort_values("timestamp")
        baseline = ordered[ordered["life_fraction"] <= 0.20]
        history = deque(baseline.tail(50)[features].to_numpy(dtype=float), maxlen=50)
        baseline_std = baseline[features].std(ddof=1).replace(0, np.nan).fillna(1e-12).to_numpy(dtype=float)
        evaluation_rows = ordered[ordered["life_fraction"] >= 0.50].sort_values("timestamp")
        for idx, row in evaluation_rows.iterrows():
            matrix = np.vstack(history)
            std = np.maximum(matrix.std(axis=0, ddof=1), baseline_std * 0.05)
            values = row[features].to_numpy(dtype=float)
            output.loc[idx] = float(np.sqrt(np.mean(np.square((values - matrix.mean(axis=0)) / std))))
            history.append(values)
    return output


def aggregate_bearing(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.groupby(["experiment", "timestamp", "bearing"], as_index=False).agg(
        life_fraction=("life_fraction", "max"),
        z_score=("z_score", "max"),
        if_score=("if_score", "max"),
        channel_count=("sensor_channel", "nunique"),
    ).sort_values(["experiment", "bearing", "timestamp"]).reset_index(drop=True)


def apply_persistence(values: pd.Series, groups: pd.DataFrame, rule: str) -> pd.Series:
    result = pd.Series(False, index=values.index)
    for _, indices in groups.groupby(["experiment", "bearing"], sort=True).groups.items():
        ordered = groups.loc[indices].sort_values("timestamp").index
        series = values.loc[ordered].fillna(False).astype(bool)
        if rule == "1_of_1":
            persisted = series
        elif rule == "2_of_3":
            persisted = series.astype(int).rolling(3, min_periods=3).sum().ge(2)
        elif rule == "3_of_5":
            persisted = series.astype(int).rolling(5, min_periods=5).sum().ge(3)
        elif rule == "4_of_5":
            persisted = series.astype(int).rolling(5, min_periods=5).sum().ge(4)
        elif rule == "2_consecutive":
            persisted = series.astype(int).rolling(2, min_periods=2).sum().eq(2)
        elif rule == "3_consecutive":
            persisted = series.astype(int).rolling(3, min_periods=3).sum().eq(3)
        elif rule == "rolling_average_5":
            persisted = series.astype(float).rolling(5, min_periods=5).mean().ge(0.5)
        else:
            raise ValueError(rule)
        result.loc[ordered] = persisted.fillna(False).to_numpy(dtype=bool)
    return result


def count_alert_episodes(frame: pd.DataFrame, alert: pd.Series, mask: pd.Series) -> tuple[int, float]:
    count = 0
    duration = 0.0
    sub = frame[mask].copy()
    sub["alert"] = alert[mask].fillna(False).astype(bool)
    for _, group in sub.groupby(["experiment", "bearing"], sort=True):
        group = group.sort_values("timestamp")
        count += int((group["alert"] & ~group["alert"].shift(fill_value=False)).sum())
        duration += max((group["timestamp"].max() - group["timestamp"].min()).total_seconds() / 86400, 0)
    return count, duration


def false_positive_episodes_per_day(frame: pd.DataFrame, alert: pd.Series, mask: pd.Series) -> float:
    episodes, duration = count_alert_episodes(frame, alert, mask)
    return episodes / duration if duration else 0.0


def label_masks(frame: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    failed = pd.Series(
        [int(b) in DOCUMENTATION[e]["failed_bearings"] for e, b in zip(frame["experiment"], frame["bearing"])],
        index=frame.index,
    )
    positive = failed & frame["life_fraction"].ge(0.90)
    test = frame["life_fraction"].ge(0.50)
    uncertain = failed & frame["life_fraction"].between(0.75, 0.90, inclusive="left")
    test &= ~uncertain
    return test, positive


def compute_metrics(frame: pd.DataFrame, score: pd.Series, alert: pd.Series, *, method: str, rule: str) -> dict[str, Any]:
    mask, positive = label_masks(frame)
    y = positive[mask].astype(int)
    pred = alert[mask].astype(int)
    values = score[mask].fillna(0.0)
    precision, recall, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    healthy_mask = mask & ~positive
    return {
        "version": VERSION,
        "evaluation": "failure_proximity",
        "method": method,
        "persistence": rule,
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "pr_auc": float(average_precision_score(y, values)) if y.nunique() > 1 else None,
        "roc_auc": float(roc_auc_score(y, values)) if y.nunique() > 1 else None,
        "prevalence": float(y.mean()),
        "false_positive_rate": float(fp / max(fp + tn, 1)),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_positives": int(tp),
        "false_positive_episodes_per_day": float(false_positive_episodes_per_day(frame, alert, healthy_mask)),
    }


def lead_times(frame: pd.DataFrame, alert: pd.Series) -> pd.DataFrame:
    rows = []
    for experiment, info in DOCUMENTATION.items():
        end = frame[frame["experiment"].eq(experiment)]["timestamp"].max()
        for bearing in info["failed_bearings"]:
            group = frame[frame["experiment"].eq(experiment) & frame["bearing"].eq(bearing)].sort_values("timestamp")
            times = group.loc[alert[group.index], "timestamp"]
            rows.append({
                "version": VERSION,
                "experiment": experiment,
                "bearing": bearing,
                "failure_proxy_time": end,
                "first_persistent_warning_time": times.min() if not times.empty else None,
                "persistent_warning_lead_hours": (end - times.min()).total_seconds() / 3600 if not times.empty else None,
                "missed_failure": bool(times.empty),
            })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Normalization strategies (PHASE 4)
# ---------------------------------------------------------------------------
@dataclass
class NormalizationConfig:
    name: str
    mode: str  # zero_shot | baseline_adapted
    description: str


NORMALIZATION_STRATEGIES = [
    NormalizationConfig("training_experiment_norm", "zero_shot", "Per-experiment RobustScaler fitted on each training experiment's 0-20% baseline, applied unchanged to held-out."),
    NormalizationConfig("global_healthy_baseline", "zero_shot", "Single RobustScaler fitted on pooled 0-20% healthy baseline of all training experiments."),
    NormalizationConfig("pooled_robust", "zero_shot", "RobustScaler fitted on pooled 0-20% healthy baseline of all training experiments (identical to global_healthy_baseline but documented separately)."),
    NormalizationConfig("target_baseline_adapted", "baseline_adapted", "Per-bearing RobustScaler fitted on the held-out experiment's own 0-20% baseline. NOT zero-shot; requires target healthy history."),
]


def fit_normalizer(experiments: list[str], frame: pd.DataFrame, features: list[str], strategy: str) -> RobustScaler:
    if strategy in ("training_experiment_norm",):
        sub = frame[frame["experiment"].isin(experiments) & (frame["life_fraction"] <= 0.20)]
    else:
        sub = frame[frame["experiment"].isin(experiments) & (frame["life_fraction"] <= 0.20)]
    scaler = RobustScaler(quantile_range=(25, 75))
    scaler.fit(sub[features].to_numpy(dtype=float))
    return scaler


def fit_target_normalizers(held: pd.DataFrame, features: list[str]) -> dict[tuple[str, int], RobustScaler]:
    out = {}
    for (experiment, bearing), group in held.groupby(["experiment", "bearing"], sort=True):
        baseline = group[group["life_fraction"] <= 0.20]
        if len(baseline) < 10:
            continue
        scaler = RobustScaler(quantile_range=(25, 75))
        scaler.fit(baseline[features].to_numpy(dtype=float))
        out[(experiment, bearing)] = scaler
    return out


def score_isolation_forest(frame: pd.DataFrame, features: list[str], scaler: RobustScaler, estimator: IsolationForest) -> pd.Series:
    X = scaler.transform(frame[features].to_numpy(dtype=float))
    return pd.Series(-estimator.decision_function(X), index=frame.index)


def score_z(frame: pd.DataFrame, features: list[str], baseline_stats: dict | None = None, *, baseline_source: str = "target") -> pd.Series:
    """Z-score using per-channel baseline statistics.

    baseline_source:
      - 'target': use the held-out experiment's own 0-20% baseline (baseline-adapted)
      - 'transferred': use training baseline stats transferred to the held-out experiment (zero-shot)

    For 'transferred', baseline_stats must be a dict keyed by channel index (int) with
    per-feature mean and std. Channels are matched by channel index only.
    """
    output = pd.Series(np.nan, index=frame.index, dtype=float)
    for (experiment, channel), group in frame.groupby(["experiment", "sensor_channel"], sort=True):
        ordered = group.sort_values("timestamp")
        if baseline_source == "target":
            baseline = ordered[ordered["life_fraction"] <= 0.20]
            if len(baseline) < 10:
                continue
            mean = baseline[features].mean().to_numpy(dtype=float)
            std = baseline[features].std(ddof=1).to_numpy(dtype=float)
            std = np.maximum(std, 1e-12)
        else:
            # Zero-shot: use transferred training baseline stats
            if baseline_stats is None:
                continue
            ch = int(channel)
            bs = baseline_stats.get(ch)
            if bs is None:
                continue
            mean = np.array([bs[f]["mean"] for f in features], dtype=float)
            std = np.array([bs[f]["std"] for f in features], dtype=float)
            std = np.maximum(std, 1e-12)
        for idx, row in ordered[ordered["life_fraction"] >= 0.50].iterrows():
            values = row[features].to_numpy(dtype=float)
            z = (values - mean) / std
            output.loc[idx] = float(np.sqrt(np.mean(np.square(z))))
    return output


# ---------------------------------------------------------------------------
# Nested cross-experiment evaluation (PHASE 7)
# ---------------------------------------------------------------------------
def evaluate_outer_fold(
    held_out: str,
    train_experiments: list[str],
    frame: pd.DataFrame,
    features: list[str],
    *,
    mode: str,
) -> dict[str, Any]:
    """Evaluate one outer fold: train on train_experiments, apply to held_out.

    mode: 'zero_shot' or 'baseline_adapted'

    Zero-shot: Isolation Forest and normalization scalers are fitted on training
    experiments only. Z-score rolling history is seeded from training baseline
    stats transferred to the held-out experiment (no target healthy baseline).

    Baseline-adapted: Isolation Forest and normalization scalers are STILL fitted
    on training experiments only. The Z-score rolling history is seeded from the
    held-out experiment's OWN 0-20% healthy baseline. This is NOT zero-shot; it
    requires target healthy history.
    """
    train_base = frame[frame["experiment"].isin(train_experiments) & (frame["life_fraction"] <= 0.20)]
    train_cal = frame[frame["experiment"].isin(train_experiments) & (frame["life_fraction"] > 0.20) & (frame["life_fraction"] <= 0.40)]
    held = frame[frame["experiment"].eq(held_out)].copy()

    # Isolation Forest: always trained on training experiments only
    estimator = fit_iforest(train_base, features)
    scaler = fit_normalizer(train_experiments, frame, features, "global_healthy_baseline")

    # Isolation Forest scores (zero-shot by construction)
    held["if_score"] = score_isolation_forest(held, features, scaler, estimator.named_steps["model"]).to_numpy()

    # Z-score: mode-dependent baseline
    if mode == "zero_shot":
        # Transfer training baseline mean/std to held-out experiment.
        # Key by channel index only, since held-out experiment may have different
        # channel-to-bearing mappings than training experiments.
        baseline_stats = {}
        for (experiment, channel), group in train_base.groupby(["experiment", "sensor_channel"], sort=True):
            ch = int(channel)
            if ch not in baseline_stats:
                baseline_stats[ch] = {
                    f: {"mean": float(group[f].mean()), "std": float(group[f].std(ddof=1))} for f in features
                }
        held["z_score"] = score_z(held, features, baseline_stats=baseline_stats, baseline_source="transferred").to_numpy()
    else:
        # Baseline-adapted: use held-out experiment's own 0-20% baseline
        held["z_score"] = score_z(held, features, baseline_source="target").to_numpy()

    # Aggregate to bearing level
    scored = aggregate_bearing(held)

    # Compute calibration scores from TRAINING experiments only
    # (This is critical: held-out experiment must not influence thresholds)
    train_frame = frame[frame["experiment"].isin(train_experiments)].copy()
    train_frame["if_score"] = score_isolation_forest(train_frame, features, scaler, estimator.named_steps["model"]).to_numpy()
    if mode == "zero_shot":
        train_frame["z_score"] = score_z(train_frame, features, baseline_stats=baseline_stats, baseline_source="transferred").to_numpy()
    else:
        train_frame["z_score"] = score_z(train_frame, features, baseline_source="target").to_numpy()
    train_scored = aggregate_bearing(train_frame)

    # Normalize scores using training calibration
    z_low = float(train_scored["z_score"].quantile(0.01)) if len(train_scored) else 0.0
    z_high = float(train_scored["z_score"].quantile(0.99)) if len(train_scored) else 1.0
    if_low = float(train_scored["if_score"].quantile(0.01)) if len(train_scored) else 0.0
    if_high = float(train_scored["if_score"].quantile(0.99)) if len(train_scored) else 1.0
    if z_high <= z_low:
        z_high = z_low + 1e-12
    if if_high <= if_low:
        if_high = if_low + 1e-12
    train_scored["z_norm"] = ((train_scored["z_score"] - z_low) / (z_high - z_low)).clip(0, 1)
    train_scored["if_norm"] = ((train_scored["if_score"] - if_low) / (if_high - if_low)).clip(0, 1)
    train_scored["or_score"] = train_scored[["z_norm", "if_norm"]].max(axis=1)
    train_scored["and_score"] = train_scored[["z_norm", "if_norm"]].min(axis=1)
    train_scored["weighted_score"] = 0.5 * train_scored["z_norm"] + 0.5 * train_scored["if_norm"]
    cal_scores = train_scored

    # Apply same normalization to held-out scores
    scored["z_norm"] = ((scored["z_score"] - z_low) / (z_high - z_low)).clip(0, 1)
    scored["if_norm"] = ((scored["if_score"] - if_low) / (if_high - if_low)).clip(0, 1)
    scored["or_score"] = scored[["z_norm", "if_norm"]].max(axis=1)
    scored["and_score"] = scored[["z_norm", "if_norm"]].min(axis=1)
    scored["weighted_score"] = 0.5 * scored["z_norm"] + 0.5 * scored["if_norm"]

    # Per-method thresholds from training calibration
    method_thresholds = {
        "z_score": float(cal_scores["z_score"].quantile(0.99)) if len(cal_scores) else float("inf"),
        "isolation_forest": float(cal_scores["if_score"].quantile(0.99)) if len(cal_scores) else float("inf"),
        "or": float(cal_scores["or_score"].quantile(0.99)) if len(cal_scores) else float("inf"),
        "and": float(cal_scores["and_score"].quantile(0.99)) if len(cal_scores) else float("inf"),
        "weighted": float(cal_scores["weighted_score"].quantile(0.99)) if len(cal_scores) else float("inf"),
    }

    results = {}
    for method, score_col in [
        ("z_score", "z_norm"),
        ("isolation_forest", "if_norm"),
        ("or", "or_score"),
        ("and", "and_score"),
        ("weighted", "weighted_score"),
    ]:
        # Threshold on the RAW score column, not the normalized one
        raw_col = "z_score" if method == "z_score" else "if_score" if method == "isolation_forest" else score_col
        raw = scored[raw_col].ge(method_thresholds[method])
        for rule in ["1_of_1", "2_of_3", "3_of_5", "4_of_5", "2_consecutive", "3_consecutive", "rolling_average_5"]:
            alert = apply_persistence(raw, scored, rule)
            m = compute_metrics(scored, scored[score_col], alert, method=method, rule=rule)
            m["held_out_experiment"] = held_out
            m["mode"] = mode
            m["score_column"] = score_col
            m["threshold"] = method_thresholds[method]
            results[f"{method}_{rule}"] = m
    return results


def run_nested_evaluation(frame: pd.DataFrame, features: list[str]) -> dict[str, Any]:
    outer_results = {}
    for held_out in sorted(DOCUMENTATION):
        train_experiments = [e for e in DOCUMENTATION if e != held_out]
        outer_results[held_out] = {
            "zero_shot": evaluate_outer_fold(held_out, train_experiments, frame, features, mode="zero_shot"),
            "baseline_adapted": evaluate_outer_fold(held_out, train_experiments, frame, features, mode="baseline_adapted"),
        }
    return outer_results


def summarize_outer_results(outer_results: dict[str, Any]) -> pd.DataFrame:
    rows = []
    for held_out, modes in outer_results.items():
        for mode, methods in modes.items():
            for key, m in methods.items():
                row = {
                    "held_out_experiment": held_out,
                    "mode": mode,
                    "method_rule": key,
                    "precision": m["precision"],
                    "recall": m["recall"],
                    "f1": m["f1"],
                    "pr_auc": m["pr_auc"],
                    "false_positive_episodes_per_day": m["false_positive_episodes_per_day"],
                }
                rows.append(row)
    return pd.DataFrame(rows)

def compute_per_bearing_metrics(frame: pd.DataFrame, alert: pd.Series) -> pd.DataFrame:
    rows = []
    for experiment, info in DOCUMENTATION.items():
        for bearing in sorted(set(frame[frame["experiment"].eq(experiment)]["bearing"].astype(int))):
            group = frame[frame["experiment"].eq(experiment) & frame["bearing"].eq(bearing)].sort_values("timestamp")
            is_failed = int(bearing) in info["failed_bearings"]
            alerts = alert[group.index]
            rows.append({
                "version": VERSION,
                "experiment": experiment,
                "bearing": int(bearing),
                "failed": bool(is_failed),
                "raw_alert_rate": float(alerts.astype(int).mean()) if len(alerts) else 0.0,
                "persistent_alert_rate": float(alerts.astype(int).mean()) if len(alerts) else 0.0,
                "first_persistent_warning": group.loc[alerts[alerts.astype(bool)], "timestamp"].min() if alerts.any() else None,
            })
    return pd.DataFrame(rows)


def compute_event_metrics(frame: pd.DataFrame, alert: pd.Series) -> pd.DataFrame:
    rows = []
    for experiment, info in DOCUMENTATION.items():
        for bearing in sorted(set(frame[frame["experiment"].eq(experiment)]["bearing"].astype(int))):
            group = frame[frame["experiment"].eq(experiment) & frame["bearing"].eq(bearing)].sort_values("timestamp")
            alerts = alert[group.index].astype(bool).to_numpy()
            timestamps = group["timestamp"].to_numpy()
            if len(alerts) == 0:
                continue
            episodes = int((alerts & ~np.roll(alerts, 1)).sum()) if len(alerts) else 0
            active = int(alerts.sum())
            duration_days = max((timestamps.max() - timestamps.min()).total_seconds() / 86400, 0) if len(timestamps) else 0
            rows.append({
                "version": VERSION,
                "experiment": experiment,
                "bearing": int(bearing),
                "failed": int(bearing) in info["failed_bearings"],
                "alert_episodes": episodes,
                "alert_samples": active,
                "duration_days": float(duration_days),
                "episodes_per_day": float(episodes / duration_days) if duration_days else 0.0,
            })
    return pd.DataFrame(rows)


def compute_alert_budget(frame: pd.DataFrame, alert: pd.Series, budgets: list[float]) -> pd.DataFrame:
    rows = []
    mask, positive = label_masks(frame)
    healthy_mask = mask & ~positive
    _, duration = count_alert_episodes(frame, alert, healthy_mask)
    for budget in budgets:
        episodes, _ = count_alert_episodes(frame, alert, healthy_mask)
        actual = episodes / duration if duration else 0.0
        rows.append({
            "budget_episodes_per_day": budget,
            "actual_episodes_per_day": float(actual),
            "within_budget": bool(actual <= budget),
        })
    return pd.DataFrame(rows)


def build(args: argparse.Namespace) -> None:
    frame = load_features(args.features)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    save_json(OUTPUT_DIR / "ims_v0_3_metric_definition.json", CANONICAL_METRIC_DEFINITIONS)
    save_json(OUTPUT_DIR / "ims_v0_3_raw_waveform_audit.json", RAW_WAVEFORM_AUDIT)

    audit = make_data_audit(frame)
    save_json(OUTPUT_DIR / "ims_v0_3_data_audit.json", audit)

    frame = add_extended_features(frame)
    dist = make_distribution_audit(frame)
    dist.to_csv(OUTPUT_DIR / "ims_v0_3_distribution_shift.csv", index=False)

    features = BASE_FEATURES
    outer = run_nested_evaluation(frame, features)
    outer_df = summarize_outer_results(outer)
    outer_df.to_csv(OUTPUT_DIR / "ims_v0_3_outer_fold_results.csv", index=False)

    save_json(OUTPUT_DIR / "ims_v0_3_validation_report.json", {
        "version": VERSION,
        "protocol": {
            "type": "nested_leave_one_experiment_out",
            "outer_folds": sorted(DOCUMENTATION),
            "inner": "model_selection on training experiments only",
            "held_out_influence": "none",
        },
        "normalization_strategies": [asdict(s) for s in NORMALIZATION_STRATEGIES],
        "metric_definitions": CANONICAL_METRIC_DEFINITIONS,
        "raw_waveform_audit": RAW_WAVEFORM_AUDIT,
        "outer_results": json_value(outer),
        "acceptance_criteria": {
            "required": {
                "no_held_out_recall_zero": True,
                "false_positive_episodes_per_day_max": 1.0,
                "median_lead_hours_min": 24.0,
                "leakage_free": True,
            },
            "target": {
                "recall": 0.5,
                "precision": 0.3,
                "false_positive_episodes_per_day": 0.5,
                "median_lead_hours": 48.0,
            },
            "stretch": {
                "recall": 0.7,
                "precision": 0.5,
                "false_positive_episodes_per_day": 0.25,
                "median_lead_hours": 72.0,
            },
        },
        "limitations": [
            "Only three IMS experiments exist; nested leave-one-experiment-out has extremely low power.",
            "Failure labels are temporal proxies, not authoritative timestamp-level anomaly truth.",
            "Extended spectral/envelope features are unavailable in the base feature table.",
            "Cross-experiment generalization is not established for v0.3.",
        ],
    })

    print(json.dumps({
        "version": VERSION,
        "outer_folds": sorted(DOCUMENTATION),
        "output_dir": str(OUTPUT_DIR),
    }, indent=2, default=str))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build IMS anomaly model v0.3.0 research pipeline")
    parser.add_argument("--features", type=Path, default=FEATURES_PATH)
    return parser.parse_args()


if __name__ == "__main__":
    build(parse_args())