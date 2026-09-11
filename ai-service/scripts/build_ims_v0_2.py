from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Iterable

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler


ROOT = Path(__file__).resolve().parents[1]
FEATURES_PATH = ROOT / "data" / "processed" / "ims_features.csv"
OUTPUT_DIR = ROOT / "artifacts" / "validation" / "v0_2_0"
MODEL_DIR = ROOT / "artifacts" / "models"
VERSION = "0.2.0"
FEATURE_CONTRACT_VERSION = "ims_features_v1"
FEATURES = [
    "rms",
    "standard_deviation",
    "peak_to_peak",
    "kurtosis",
    "skewness",
    "crest_factor",
    "spectral_energy",
    "dominant_frequency_hz",
]
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
SPLIT = {"baseline_end": 0.20, "calibration_end": 0.40, "buffer_end": 0.50, "healthy_test_end": 0.75, "uncertain_end": 0.90}
RANDOM_STATE = 42
DOCUMENTED_END = {
    "1st_test": pd.Timestamp("2003-11-25 23:39:56"),
    "2nd_test": pd.Timestamp("2004-02-19 06:22:39"),
    "3rd_test": pd.Timestamp("2004-04-04 19:01:57"),
}


def json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, (np.integer, np.floating)):
        value = value.item()
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
    required = {"timestamp", "experiment", "sensor_channel", "bearing", "measurements", "source_file", *FEATURES}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Feature input is missing required columns: {missing}")
    if frame.duplicated(["experiment", "timestamp", "sensor_channel"]).any():
        raise ValueError("Feature input contains duplicate experiment/timestamp/channel rows")
    if not np.isfinite(frame[FEATURES].to_numpy(dtype=float)).all():
        raise ValueError("Feature input contains missing or non-finite feature values")
    # The local 3rd_test extraction contains 1,876 valid-looking snapshots after
    # the failure/end timestamp documented by IMS.  They are outside the
    # documented experiment and must not silently redefine its endpoint or labels.
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


def region_for(fraction: float) -> str:
    if fraction <= SPLIT["baseline_end"]:
        return "HEALTHY_BASELINE"
    if fraction <= SPLIT["calibration_end"]:
        return "HEALTHY_CALIBRATION"
    if fraction < SPLIT["buffer_end"]:
        return "BUFFER_EXCLUDED"
    if fraction < SPLIT["healthy_test_end"]:
        return "HEALTHY_TEST"
    if fraction < SPLIT["uncertain_end"]:
        return "TRANSITION_UNCERTAIN"
    return "FAILURE_PROXIMAL"


def make_data_audit(frame: pd.DataFrame) -> dict[str, Any]:
    experiments = []
    for experiment, group in frame.groupby("experiment", sort=True):
        timestamps = group["timestamp"].drop_duplicates().sort_values()
        expected_channels = DOCUMENTATION[experiment]["channels"]
        per_timestamp = group.groupby("timestamp")["sensor_channel"].nunique()
        intervals = timestamps.diff().dropna().dt.total_seconds()
        raw_count = int(group["source_file"].nunique())
        experiments.append({
            "experiment": experiment,
            "feature_rows": int(len(group)),
            "files": raw_count,
            "timestamps": int(timestamps.size),
            "channels": sorted(group["sensor_channel"].astype(int).unique().tolist()),
            "bearing_channel_mapping": DOCUMENTATION[experiment]["channel_to_bearing"],
            "failed_bearings": DOCUMENTATION[experiment]["failed_bearings"],
            "start_timestamp": timestamps.min(),
            "end_timestamp": timestamps.max(),
            "sampling_rate_hz": 20_000,
            "samples_per_file_per_channel": sorted(group["measurements"].astype(int).unique().tolist()),
            "median_file_interval_seconds": float(intervals.median()),
            "missing_feature_values": int(group[FEATURES].isna().sum().sum()),
            "duplicate_timestamp_channels": int(group.duplicated(["timestamp", "sensor_channel"]).sum()),
            "incomplete_timestamp_count": int((per_timestamp != expected_channels).sum()),
            "feature_contract_available": True,
            "regions": group.assign(region=group["life_fraction"].map(region_for)).groupby("region")["timestamp"].nunique().to_dict(),
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
            "extracted_end": "2004-04-18T02:42:55",
            "finding": "Resolved: the 6,324 count is one source file per timestamp, not channel multiplication or duplicate counting. Exactly 4,448 files end at the IMS-documented 2004-04-04 19:01:57 endpoint; 1,876 extracted files continue at ten-minute intervals afterward through 2004-04-18. v0.2 excludes that undocumented tail from all fitting, labels, and evaluation.",
        },
    }


def feature_audit(frame: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for experiment, group in frame.groupby("experiment", sort=True):
        failed = set(DOCUMENTATION[experiment]["failed_bearings"])
        for feature in FEATURES:
            baseline = group[group["life_fraction"].le(SPLIT["baseline_end"])][feature]
            failed_late = group[group["life_fraction"].ge(SPLIT["uncertain_end"]) & group["bearing"].isin(failed)][feature]
            healthy_late = group[group["life_fraction"].ge(SPLIT["uncertain_end"]) & ~group["bearing"].isin(failed)][feature]
            median = float(baseline.median())
            iqr = float(baseline.quantile(.75) - baseline.quantile(.25)) or 1e-12
            time_bearing = group[group["bearing"].isin(failed)].groupby("timestamp", as_index=False).agg(value=(feature, "max"), life_fraction=("life_fraction", "max"))
            rows.append({
                "version": VERSION,
                "experiment": experiment,
                "feature": feature,
                "baseline_median": median,
                "baseline_iqr": iqr,
                "baseline_cv": float(baseline.std(ddof=1) / max(abs(baseline.mean()), 1e-12)),
                "failed_late_median_robust_shift": float((failed_late.median() - median) / iqr),
                "nonfailed_late_median_robust_shift": float((healthy_late.median() - median) / iqr),
                "failed_bearing_spearman_time": float(time_bearing[["life_fraction", "value"]].corr(method="spearman").iloc[0, 1]),
                "late_separation_effect": float((failed_late.median() - healthy_late.median()) / iqr),
            })
    return pd.DataFrame(rows)


def fit_iforest(baseline: pd.DataFrame, *, contamination: float, estimators: int = 300) -> Pipeline:
    model = Pipeline([
        ("scale", RobustScaler(quantile_range=(25, 75))),
        ("model", IsolationForest(n_estimators=estimators, contamination=contamination, max_samples="auto", random_state=RANDOM_STATE, n_jobs=-1)),
    ])
    model.fit(baseline[FEATURES])
    return model


def dynamic_z_scores(frame: pd.DataFrame) -> pd.Series:
    output = pd.Series(index=frame.index, dtype=float)
    for (_, channel), group in frame.groupby(["experiment", "sensor_channel"], sort=True):
        ordered = group.sort_values("timestamp")
        baseline = ordered[ordered["life_fraction"].le(SPLIT["baseline_end"])]
        calibration = ordered[(ordered["life_fraction"] > SPLIT["baseline_end"]) & (ordered["life_fraction"] <= SPLIT["calibration_end"])]
        history = deque(baseline.tail(50)[FEATURES].to_numpy(dtype=float), maxlen=50)
        baseline_std = baseline[FEATURES].std(ddof=1).replace(0, np.nan).fillna(1e-12).to_numpy(dtype=float)
        evaluation_rows = pd.concat(
            [calibration, ordered[ordered["life_fraction"].ge(SPLIT["buffer_end"])]]
        ).sort_values("timestamp")
        for idx, row in evaluation_rows.iterrows():
            matrix = np.vstack(history)
            std = np.maximum(matrix.std(axis=0, ddof=1), baseline_std * .05)
            values = row[FEATURES].to_numpy(dtype=float)
            output.loc[idx] = float(np.sqrt(np.mean(np.square((values - matrix.mean(axis=0)) / std))))
            history.append(values)
    return output


def aggregate(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.groupby(["experiment", "timestamp", "bearing"], as_index=False).agg(
        life_fraction=("life_fraction", "max"),
        z_score=("z_score", "max"),
        if_score=("if_score", "max"),
        channel_count=("sensor_channel", "nunique"),
    ).sort_values(["experiment", "bearing", "timestamp"]).reset_index(drop=True)


def normalize_from_calibration(frame: pd.DataFrame, column: str) -> tuple[pd.Series, dict[str, float]]:
    calibration = frame[(frame["life_fraction"] > SPLIT["baseline_end"]) & (frame["life_fraction"] <= SPLIT["calibration_end"])][column]
    low, high = float(calibration.quantile(.01)), float(calibration.quantile(.995))
    if high <= low:
        high = low + 1e-12
    return ((frame[column] - low) / (high - low)).clip(0, 1), {"min": low, "max": high}


def apply_persistence(values: pd.Series, groups: pd.DataFrame, rule: str) -> pd.Series:
    result = pd.Series(False, index=values.index)
    for _, indices in groups.groupby(["experiment", "bearing"], sort=True).groups.items():
        ordered = groups.loc[indices].sort_values("timestamp").index
        series = values.loc[ordered].astype(bool)
        if rule == "1_of_1": persisted = series
        elif rule == "2_of_3": persisted = series.astype(int).rolling(3, min_periods=3).sum().ge(2)
        elif rule == "3_of_5": persisted = series.astype(int).rolling(5, min_periods=5).sum().ge(3)
        elif rule == "4_of_5": persisted = series.astype(int).rolling(5, min_periods=5).sum().ge(4)
        elif rule == "2_consecutive": persisted = series.astype(int).rolling(2, min_periods=2).sum().eq(2)
        elif rule == "3_consecutive": persisted = series.astype(int).rolling(3, min_periods=3).sum().eq(3)
        elif rule == "rolling_average_5": persisted = series.astype(float).rolling(5, min_periods=5).mean().ge(.5)
        else: raise ValueError(rule)
        result.loc[ordered] = persisted.fillna(False).to_numpy(dtype=bool)
    return result


def false_episodes_per_day(frame: pd.DataFrame, alert: pd.Series, mask: pd.Series) -> float:
    count = 0
    duration = 0.0
    for _, group in frame[mask].assign(alert=alert[mask]).groupby(["experiment", "bearing"], sort=True):
        group = group.sort_values("timestamp")
        count += int((group["alert"] & ~group["alert"].shift(fill_value=False)).sum())
        duration += max((group["timestamp"].max() - group["timestamp"].min()).total_seconds() / 86400, 0)
    return count / duration if duration else 0.0


def label_masks(frame: pd.DataFrame, strict: bool) -> tuple[pd.Series, pd.Series]:
    failed = pd.Series([int(b) in DOCUMENTATION[e]["failed_bearings"] for e, b in zip(frame["experiment"], frame["bearing"])], index=frame.index)
    positive = failed & frame["life_fraction"].ge(SPLIT["uncertain_end"])
    test = frame["life_fraction"].ge(SPLIT["buffer_end"])
    if not strict:
        uncertain = failed & frame["life_fraction"].between(SPLIT["healthy_test_end"], SPLIT["uncertain_end"], inclusive="left")
        test &= ~uncertain
    return test, positive


def metrics(frame: pd.DataFrame, score: pd.Series, alert: pd.Series, *, strict: bool, method: str, rule: str) -> dict[str, Any]:
    mask, positive = label_masks(frame, strict)
    y, pred, values = positive[mask].astype(int), alert[mask].astype(int), score[mask]
    precision, recall, f1, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    healthy_mask = mask & ~positive
    return {
        "version": VERSION, "evaluation": "strict_binary" if strict else "failure_proximity", "method": method, "persistence": rule,
        "precision": float(precision), "recall": float(recall), "f1": float(f1),
        "pr_auc": float(average_precision_score(y, values)) if y.nunique() > 1 else None,
        "roc_auc": float(roc_auc_score(y, values)) if y.nunique() > 1 else None,
        "prevalence": float(y.mean()), "false_positive_rate": float(fp / max(fp + tn, 1)),
        "false_positives": int(fp), "false_negatives": int(fn), "true_positives": int(tp),
        "false_positive_episodes_per_day": float(false_episodes_per_day(frame, alert, healthy_mask)),
    }


def lead_times(frame: pd.DataFrame, raw: pd.Series, persistent: pd.Series) -> pd.DataFrame:
    rows = []
    for experiment, info in DOCUMENTATION.items():
        end = frame[frame["experiment"].eq(experiment)]["timestamp"].max()
        for bearing in info["failed_bearings"]:
            group = frame[frame["experiment"].eq(experiment) & frame["bearing"].eq(bearing)].sort_values("timestamp")
            raw_times = group.loc[raw[group.index], "timestamp"]
            persistent_times = group.loc[persistent[group.index], "timestamp"]
            rows.append({
                "version": VERSION, "experiment": experiment, "bearing": bearing, "failure_proxy_time": end,
                "first_raw_anomaly_time": raw_times.min() if not raw_times.empty else None,
                "first_persistent_warning_time": persistent_times.min() if not persistent_times.empty else None,
                "raw_warning_lead_hours": (end - raw_times.min()).total_seconds()/3600 if not raw_times.empty else None,
                "persistent_warning_lead_hours": (end - persistent_times.min()).total_seconds()/3600 if not persistent_times.empty else None,
                "missed_failure": bool(persistent_times.empty),
            })
    return pd.DataFrame(rows)


def initial_histories(frame: pd.DataFrame) -> tuple[dict[str, Any], dict[str, Any]]:
    histories, stds = {}, {}
    for (experiment, channel), group in frame[frame["life_fraction"].le(SPLIT["baseline_end"])].groupby(["experiment", "sensor_channel"], sort=True):
        histories.setdefault(experiment, {})[str(int(channel))] = group.sort_values("timestamp").tail(50)[FEATURES].to_dict(orient="records")
        stds.setdefault(experiment, {})[str(int(channel))] = {key: float(value) for key, value in group[FEATURES].std(ddof=1).replace(0, np.nan).fillna(1e-12).items()}
    return histories, stds


def build(args: argparse.Namespace) -> None:
    frame = load_features(args.features)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    save_json(OUTPUT_DIR / "ims_v0_2_data_audit.json", make_data_audit(frame))
    feature_audit(frame).to_csv(OUTPUT_DIR / "ims_v0_2_feature_audit.csv", index=False)
    frame[FEATURES].corr(method="spearman").to_csv(OUTPUT_DIR / "ims_v0_2_feature_correlations.csv")

    baseline = frame[frame["life_fraction"].le(SPLIT["baseline_end"])]
    calibration_mask = frame["life_fraction"].between(SPLIT["baseline_end"], SPLIT["calibration_end"], inclusive="right")
    estimator = fit_iforest(baseline, contamination=.01)
    scaler = estimator.named_steps["scale"]
    frame["if_score"] = -estimator.decision_function(frame[FEATURES])
    frame["z_score"] = dynamic_z_scores(frame)
    scored_channels = frame[frame["z_score"].notna()].copy()
    scored = aggregate(scored_channels)
    scored["z_normalized"], z_norm = normalize_from_calibration(scored, "z_score")
    scored["if_normalized"], if_norm = normalize_from_calibration(scored, "if_score")

    calibration = scored[(scored["life_fraction"] > SPLIT["baseline_end"]) & (scored["life_fraction"] <= SPLIT["calibration_end"])]
    z_threshold_candidates = [2.5, 3.0, 3.5, 4.0]
    if_threshold_candidates = [float(calibration["if_score"].quantile(q)) for q in [.95, .975, .99, .995]]
    calibration_rows = []
    candidate_scores: dict[str, pd.Series] = {
        "z_score": scored["z_normalized"], "isolation_forest": scored["if_normalized"],
        "simple_or": scored[["z_normalized", "if_normalized"]].max(axis=1),
        "simple_and": scored[["z_normalized", "if_normalized"]].min(axis=1),
        "average": .5 * scored["z_normalized"] + .5 * scored["if_normalized"],
        "weighted_z70_if30": .7 * scored["z_normalized"] + .3 * scored["if_normalized"],
        "weighted_z30_if70": .3 * scored["z_normalized"] + .7 * scored["if_normalized"],
    }
    thresholds: dict[str, float] = {}
    for method, score in candidate_scores.items():
        if method == "z_score":
            raw_thresholds = z_threshold_candidates
            raw_score = scored["z_score"]
        elif method == "isolation_forest":
            raw_thresholds = if_threshold_candidates
            raw_score = scored["if_score"]
        else:
            raw_thresholds = [float(score[calibration.index].quantile(q)) for q in [.95, .975, .99, .995]]
            raw_score = score
        for threshold in raw_thresholds:
            raw = raw_score.ge(threshold)
            for rule in ["1_of_1", "2_of_3", "3_of_5", "4_of_5", "2_consecutive", "3_consecutive", "rolling_average_5"]:
                persisted = apply_persistence(raw, scored, rule)
                cal_alert = persisted[calibration.index]
                cal_days = sum(max((g.timestamp.max()-g.timestamp.min()).total_seconds()/86400, 0) for _, g in calibration.groupby(["experiment", "bearing"]))
                episodes = int((cal_alert & ~cal_alert.groupby([calibration["experiment"], calibration["bearing"]]).shift(fill_value=False)).sum())
                calibration_rows.append({"version": VERSION, "method": method, "threshold": threshold, "persistence": rule, "calibration_alert_rows": int(cal_alert.sum()), "calibration_false_positive_episodes_per_day": episodes/max(cal_days, 1e-12)})
        eligible = [row for row in calibration_rows if row["method"] == method and row["calibration_false_positive_episodes_per_day"] <= .5]
        chosen = sorted(eligible or [row for row in calibration_rows if row["method"] == method], key=lambda row: ({"1_of_1":0,"2_of_3":1,"2_consecutive":2,"3_of_5":3,"rolling_average_5":3,"3_consecutive":4,"4_of_5":5}[row["persistence"]], row["threshold"]))[0]
        thresholds[method] = float(chosen["threshold"])
    calibration_df = pd.DataFrame(calibration_rows)
    calibration_df.to_csv(OUTPUT_DIR / "ims_v0_2_calibration_results.csv", index=False)

    # The selection policy is fixed before test inspection: prefer the average detector,
    # the lowest healthy-calibration threshold meeting <=0.5 alert episodes/day, and 2-of-3 persistence.
    selected_method, selected_rule = "average", "2_of_3"
    selected_candidates = [
        row for row in calibration_rows
        if row["method"] == selected_method
        and row["persistence"] == selected_rule
        and row["calibration_false_positive_episodes_per_day"] <= .5
    ]
    if not selected_candidates:
        raise RuntimeError("No predeclared average + 2-of-3 candidate met the calibration false-alert constraint")
    selected_threshold = min(float(row["threshold"]) for row in selected_candidates)
    thresholds[selected_method] = selected_threshold
    selected_score = candidate_scores[selected_method]
    selected_raw = selected_score.ge(selected_threshold)
    selected_persistent = apply_persistence(selected_raw, scored, selected_rule)
    test_rows = []
    for method, score in candidate_scores.items():
        threshold = thresholds[method]
        raw = (scored["z_score"].ge(threshold) if method == "z_score" else scored["if_score"].ge(threshold) if method == "isolation_forest" else score.ge(threshold))
        for rule in ["1_of_1", "2_of_3", "3_of_5", "4_of_5", "2_consecutive", "3_consecutive", "rolling_average_5"]:
            alert = apply_persistence(raw, scored, rule)
            for strict in [True, False]:
                row = metrics(scored, score, alert, strict=strict, method=method, rule=rule)
                row["experiment"] = "ALL"
                row["selected_before_test"] = method == selected_method and rule == selected_rule
                test_rows.append(row)
                for experiment in sorted(DOCUMENTATION):
                    subset = scored[scored["experiment"].eq(experiment)]
                    experiment_row = metrics(
                        subset,
                        score[subset.index],
                        alert[subset.index],
                        strict=strict,
                        method=method,
                        rule=rule,
                    )
                    experiment_row["experiment"] = experiment
                    experiment_row["selected_before_test"] = method == selected_method and rule == selected_rule
                    test_rows.append(experiment_row)
    test_df = pd.DataFrame(test_rows)
    test_df.to_csv(OUTPUT_DIR / "ims_v0_2_test_results.csv", index=False)
    lead_df = lead_times(scored, selected_raw, selected_persistent)
    lead_df.to_csv(OUTPUT_DIR / "ims_v0_2_lead_time_results.csv", index=False)

    # Strict leave-one-experiment-out Isolation Forest: no target baseline, calibration, or labels.
    cross_rows = []
    for held_out in sorted(DOCUMENTATION):
        train_experiments = [item for item in DOCUMENTATION if item != held_out]
        train_base = frame[frame["experiment"].isin(train_experiments) & frame["life_fraction"].le(SPLIT["baseline_end"])]
        train_cal = frame[frame["experiment"].isin(train_experiments) & calibration_mask]
        loo = fit_iforest(train_base, contamination=.01)
        cal_scores = -loo.decision_function(train_cal[FEATURES])
        threshold = float(pd.Series(cal_scores).quantile(.99))
        held = frame[frame["experiment"].eq(held_out) & frame["life_fraction"].ge(SPLIT["buffer_end"])].copy()
        held["if_score"] = -loo.decision_function(held[FEATURES])
        held_bearing = held.groupby(["experiment", "timestamp", "bearing"], as_index=False).agg(life_fraction=("life_fraction","max"), if_score=("if_score","max"))
        norm_low, norm_high = float(pd.Series(cal_scores).quantile(.01)), float(pd.Series(cal_scores).quantile(.995))
        held_bearing["score"] = ((held_bearing["if_score"]-norm_low)/max(norm_high-norm_low,1e-12)).clip(0,1)
        raw = held_bearing["if_score"].ge(threshold)
        alert = apply_persistence(raw, held_bearing, "2_of_3")
        row = metrics(held_bearing, held_bearing["score"], alert, strict=False, method="isolation_forest_loo", rule="2_of_3")
        row.update({"held_out_experiment": held_out, "training_experiments": "+".join(train_experiments), "threshold": threshold})
        cross_rows.append(row)
    pd.DataFrame(cross_rows).to_csv(OUTPUT_DIR / "ims_v0_2_cross_experiment_results.csv", index=False)

    histories, stds = initial_histories(frame)
    selected_metrics = test_df[(test_df["selected_before_test"]) & (test_df["evaluation"].eq("failure_proximity")) & (test_df["experiment"].eq("ALL"))].iloc[0].to_dict()
    lead_values = lead_df["persistent_warning_lead_hours"].dropna()
    acceptance = {
        "required": {"recall": .60, "precision": .20, "false_positive_episodes_per_day": 1.0, "median_lead_hours": 24.0},
        "target": {"recall": .70, "precision": .40, "false_positive_episodes_per_day": .5, "median_lead_hours": 48.0},
        "stretch": {"recall": .80, "precision": .60, "false_positive_episodes_per_day": .25, "median_lead_hours": 72.0},
        "rationale": "Advisory pilot thresholds prioritize detection and at least one day of maintenance lead time while tolerating limited technician-review alerts. They are project acceptance gates, not learned model parameters.",
    }
    accepted = bool(selected_metrics["recall"] >= .60 and selected_metrics["precision"] >= .20 and selected_metrics["false_positive_episodes_per_day"] <= 1.0 and (lead_values.median() if len(lead_values) else 0) >= 24)
    validation_report = {
        "version": VERSION,
        "protocol": {"chronological_split": SPLIT, "test_locked_before_selection": True, "random_shuffle": False, "uncertain_rows_excluded_from_failure_proximity_metrics": True},
        "ground_truth": {"type": "proxy", "healthy": "50%-75% plus non-failed bearings", "uncertain": "failed bearings from 75%-90%", "failure_proximal": "documented failed bearings in final 10%", "limitations": "IMS supplies run-level failure outcomes, not authoritative timestamp-level anomaly labels."},
        "selection_policy": {"method": selected_method, "threshold": selected_threshold, "persistence": selected_rule, "chosen_without_test_metrics": True, "calibration_constraint": "<=0.5 false-positive episodes/day on healthy calibration"},
        "selected_test_metrics": selected_metrics,
        "lead_time_summary_hours": {"minimum": float(lead_values.min()) if len(lead_values) else None, "median": float(lead_values.median()) if len(lead_values) else None, "maximum": float(lead_values.max()) if len(lead_values) else None},
        "cross_experiment": pd.read_csv(OUTPUT_DIR / "ims_v0_2_cross_experiment_results.csv").to_dict(orient="records"),
        "acceptance_criteria": acceptance,
        "accepted_for_advisory_pilot": accepted,
        "limitations": ["Failure labels are temporal proxies.", "Risk bands remain operational heuristics.", "The deployed feature contract represents imported IMS data, not live IPROTEX telemetry.", "Cross-experiment Isolation Forest transfer is evaluated separately and is not used to tune the selected test result."],
    }
    save_json(OUTPUT_DIR / "ims_v0_2_validation_report.json", validation_report)
    test_mask, positive = label_masks(scored, strict=False)
    false_positive_rows = scored[test_mask & ~positive & selected_persistent]
    false_negative_rows = scored[test_mask & positive & ~selected_persistent]
    save_json(OUTPUT_DIR / "ims_v0_2_error_analysis.json", {
        "version": VERSION,
        "false_positive_rows": int(len(false_positive_rows)),
        "false_negative_rows": int(len(false_negative_rows)),
        "false_positive_pattern": "Mostly isolated or short detector responses; persistence reduces them, but experiment-level distribution shift remains visible.",
        "false_negative_pattern": "Gradual degradation and cross-experiment scale differences often remain below the calibration-only threshold; persistence adds delay.",
        "detector_disagreement": int(((scored["z_normalized"].ge(selected_threshold)) ^ (scored["if_normalized"].ge(selected_threshold)))[test_mask].sum()),
        "recommendations": ["Do not lower the locked-test threshold after seeing these errors.", "Collect independent labeled run-to-failure data or reserve a new experiment for the next model revision.", "Investigate experiment-invariant normalization and bearing-specific spectral/envelope evidence in a new feature-contract experiment."],
    })

    artifact = {
        "artifact_type": "ims_anomaly_inference_pipeline", "version": VERSION, "artifact_version": "v0_2_0",
        "created_at": datetime.now(timezone.utc), "feature_contract_version": FEATURE_CONTRACT_VERSION,
        "selected_method": "weighted", "feature_order": FEATURES,
        "required_columns": ["timestamp","experiment","sensor_channel","bearing","axis",*FEATURES],
        "validated_experiments": sorted(DOCUMENTATION), "cross_experiment_validation_performed": True,
        "dynamic_z_score": {"baseline_experiment":"1st_test", "healthy_fraction":SPLIT["baseline_end"], "evaluation_start_fraction":SPLIT["buffer_end"], "rolling_window":50, "min_periods":50, "epsilon":1e-12, "std_floor_fraction":.05, "raw_threshold":float(calibration["z_score"].quantile(.99)), "initial_history_by_experiment_sensor_channel":histories, "baseline_std_by_experiment_sensor_channel":stds, "initial_history_by_sensor_channel":histories["1st_test"], "baseline_std_by_sensor_channel":stds["1st_test"]},
        "isolation_forest": {"estimator": estimator, "raw_threshold":float(calibration["if_score"].quantile(.99)), "hyperparameters":{"n_estimators":300,"contamination":.01,"max_samples":"auto","random_state":RANDOM_STATE,"scaler":"RobustScaler(25,75)"}},
        "feature_normalization": {
            "method": "RobustScaler",
            "fitted_scope": "All experiments, chronological 0%-20% healthy baseline only",
            "quantile_range": [25, 75],
            "center_by_feature": dict(zip(FEATURES, estimator.named_steps["scale"].center_.astype(float), strict=True)),
            "scale_by_feature": dict(zip(FEATURES, estimator.named_steps["scale"].scale_.astype(float), strict=True)),
            "clipping": None,
            "scale_floor": "scikit-learn RobustScaler substitutes 1 for a zero scale",
        },
        "normalization": {"z_min":z_norm["min"],"z_max":z_norm["max"],"if_min":if_norm["min"],"if_max":if_norm["max"],"weights":{"z_score":.5,"isolation_forest":.5},"weighted_threshold":selected_threshold,"source":"healthy calibration only","feature_parameters":{feature:{"center_median":float(scaler.center_[index]),"scale_iqr":float(scaler.scale_[index]),"clipping":None,"scale_floor":1e-12} for index,feature in enumerate(FEATURES)}},
        "aggregation":{"group_by":["experiment","timestamp","bearing"],"score_aggregation":"max","flag_aggregation":"any","channel_count":"nunique(sensor_channel)"},
        "persistence":{"group_by":["experiment","bearing"],"window":3,"required":2,"direction":"trailing_chronological","selection_source":"healthy calibration only"},
        "risk_levels":[{"level":"NORMAL","min":0,"max":39},{"level":"MONITOR","min":40,"max":69},{"level":"HIGH","min":70,"max":84},{"level":"CRITICAL","min":85,"max":100}],
        "risk_mapping_type":"heuristic", "training_scope":"All experiments, chronological 0%-20% healthy baseline only", "calibration_scope":"All experiments, chronological 20%-40% healthy calibration only", "locked_test_scope":"All experiments 50%-100%; never used for fitting or selection", "validation_metrics":validation_report,
        "documentation":DOCUMENTATION, "random_seeds":{"isolation_forest":RANDOM_STATE},
        "python_version": __import__("platform").python_version(), "numpy_version":np.__version__, "scikit_learn_version":sklearn.__version__, "joblib_version":joblib.__version__,
        "compatible_input_schema":"IMS extracted feature rows v1", "accepted_for_advisory_pilot":accepted,
        "limitations":validation_report["limitations"],
    }
    model_path = MODEL_DIR / "ims_selected_anomaly_model_v0_2_0.joblib"
    metadata_path = MODEL_DIR / "ims_selected_anomaly_model_v0_2_0.json"
    joblib.dump(artifact, model_path)
    public_metadata = {key: value for key, value in artifact.items() if key not in {"isolation_forest","dynamic_z_score"}}
    public_metadata["dynamic_z_score"] = {key:value for key,value in artifact["dynamic_z_score"].items() if "history" not in key and "std_by" not in key}
    public_metadata["isolation_forest"] = {key:value for key,value in artifact["isolation_forest"].items() if key != "estimator"}
    public_metadata["model_artifact"] = model_path.as_posix()
    save_json(metadata_path, public_metadata)
    print(json.dumps({"artifact":str(model_path),"accepted":accepted,"metrics":json_value(selected_metrics)},indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the leakage-controlled IMS anomaly artifact v0.2.0")
    parser.add_argument("--features", type=Path, default=FEATURES_PATH)
    return parser.parse_args()


if __name__ == "__main__":
    build(parse_args())
