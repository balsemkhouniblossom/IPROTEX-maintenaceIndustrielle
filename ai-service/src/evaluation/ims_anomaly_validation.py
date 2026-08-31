from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import json
import shutil
from typing import Iterable

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_fscore_support


@dataclass(frozen=True)
class ImsExperimentDocumentation:
    experiment: str
    failed_bearings: tuple[int, ...]
    channel_to_bearing: dict[int, int]
    channel_to_axis: dict[int, str | None]
    source: str


IMS_DOCUMENTATION: dict[str, ImsExperimentDocumentation] = {
    "1st_test": ImsExperimentDocumentation(
        experiment="1st_test",
        failed_bearings=(3, 4),
        channel_to_bearing={1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4},
        channel_to_axis={1: "x", 2: "y", 3: "x", 4: "y", 5: "x", 6: "y", 7: "x", 8: "y"},
        source="IMS Bearing Data readme: data set 1 has two accelerometers per bearing; failures in bearing 3 and bearing 4.",
    ),
    "2nd_test": ImsExperimentDocumentation(
        experiment="2nd_test",
        failed_bearings=(1,),
        channel_to_bearing={1: 1, 2: 2, 3: 3, 4: 4},
        channel_to_axis={1: None, 2: None, 3: None, 4: None},
        source="IMS Bearing Data readme: data set 2 has one accelerometer per bearing; failure in bearing 1.",
    ),
    "3rd_test": ImsExperimentDocumentation(
        experiment="3rd_test",
        failed_bearings=(3,),
        channel_to_bearing={1: 1, 2: 2, 3: 3, 4: 4},
        channel_to_axis={1: None, 2: None, 3: None, 4: None},
        source="IMS Bearing Data readme: data set 3 has one accelerometer per bearing; failure in bearing 3.",
    ),
}


METHOD_COLUMNS = {
    "z_score": {"score": "z_anomaly_score", "raw_alert": "z_is_anomaly"},
    "isolation_forest": {"score": "if_anomaly_score", "raw_alert": "if_is_anomaly"},
}

MODEL_FEATURES = [
    "rms",
    "standard_deviation",
    "peak_to_peak",
    "kurtosis",
    "skewness",
    "crest_factor",
    "spectral_energy",
    "dominant_frequency_hz",
]

REQUIRED_FEATURE_COLUMNS = [
    "timestamp",
    "experiment",
    "sensor_channel",
    "bearing",
    "axis",
    *MODEL_FEATURES,
]


def validate_documented_mapping(features: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for experiment, documented in IMS_DOCUMENTATION.items():
        subset = features[features["experiment"].eq(experiment)]
        for channel, expected_bearing in documented.channel_to_bearing.items():
            channel_rows = subset[subset["sensor_channel"].eq(channel)]
            observed_bearings = sorted(channel_rows["bearing"].dropna().astype(int).unique().tolist())
            expected_axis = documented.channel_to_axis[channel]
            if expected_axis is None:
                axis_ok = channel_rows["axis"].isna().all()
            else:
                axis_ok = set(channel_rows["axis"].dropna().astype(str).unique().tolist()) == {expected_axis}
            rows.append(
                {
                    "experiment": experiment,
                    "sensor_channel": channel,
                    "expected_bearing": expected_bearing,
                    "observed_bearings": observed_bearings,
                    "bearing_mapping_ok": observed_bearings == [expected_bearing],
                    "expected_axis": expected_axis,
                    "axis_mapping_ok": bool(axis_ok),
                    "source": documented.source,
                }
            )
    return pd.DataFrame(rows)


def add_full_life_fraction(features: pd.DataFrame) -> pd.DataFrame:
    parts = []
    for experiment, experiment_frame in features.groupby("experiment", sort=True):
        timestamps = experiment_frame[["timestamp"]].drop_duplicates().sort_values("timestamp").reset_index(drop=True)
        timestamps["full_time_index"] = np.arange(len(timestamps))
        timestamps["full_life_fraction"] = timestamps["full_time_index"] / max(len(timestamps) - 1, 1)
        parts.append(experiment_frame.merge(timestamps, on="timestamp", how="left"))
    return pd.concat(parts, ignore_index=True)


def aggregate_channel_scores(scores: pd.DataFrame) -> pd.DataFrame:
    grouped = (
        scores.groupby(["experiment", "timestamp", "bearing"], as_index=False)
        .agg(
            full_life_fraction=("full_life_fraction", "max"),
            z_anomaly_score=("z_anomaly_score", "max"),
            z_is_anomaly=("z_is_anomaly", "max"),
            if_anomaly_score=("if_anomaly_score", "max"),
            if_is_anomaly=("if_is_anomaly", "max"),
            channel_count=("sensor_channel", "nunique"),
        )
        .sort_values(["experiment", "bearing", "timestamp"])
        .reset_index(drop=True)
    )
    grouped["z_is_anomaly"] = grouped["z_is_anomaly"].astype(bool)
    grouped["if_is_anomaly"] = grouped["if_is_anomaly"].astype(bool)
    return grouped


def trailing_persistence(frame: pd.DataFrame, raw_column: str, output_column: str, required: int = 3, window: int = 5) -> pd.DataFrame:
    output = frame.sort_values(["experiment", "bearing", "timestamp"]).copy()
    parts = []
    for _, group in output.groupby(["experiment", "bearing"], sort=True):
        group = group.sort_values("timestamp").copy()
        rolling_count = group[raw_column].astype(int).rolling(window=window, min_periods=window).sum()
        group[output_column] = rolling_count.ge(required).fillna(False).astype(bool)
        parts.append(group)
    return pd.concat(parts, ignore_index=True).sort_values(["experiment", "timestamp", "bearing"]).reset_index(drop=True)


def minmax_normalize(values: pd.Series, calibration_values: pd.Series) -> pd.Series:
    lower = float(calibration_values.min())
    upper = float(calibration_values.max())
    if upper <= lower:
        return pd.Series(np.zeros(len(values)), index=values.index)
    return ((values - lower) / (upper - lower)).clip(lower=0, upper=1)


def combination_parameters(scored: pd.DataFrame, calibration_fraction: float = 0.1) -> dict:
    calibration_limit = scored["full_life_fraction"].min() + (
        scored["full_life_fraction"].max() - scored["full_life_fraction"].min()
    ) * calibration_fraction
    calibration = scored[scored["full_life_fraction"].le(calibration_limit)]
    if calibration.empty:
        calibration = scored.head(max(1, len(scored) // 10))
    z_min = float(calibration["z_anomaly_score"].min())
    z_max = float(calibration["z_anomaly_score"].max())
    if_min = float(calibration["if_anomaly_score"].min())
    if_max = float(calibration["if_anomaly_score"].max())

    calibration_weighted = (
        0.5 * minmax_normalize(calibration["z_anomaly_score"], calibration["z_anomaly_score"])
        + 0.5 * minmax_normalize(calibration["if_anomaly_score"], calibration["if_anomaly_score"])
    )
    return {
        "calibration_fraction": calibration_fraction,
        "calibration_limit": float(calibration_limit),
        "z_min": z_min,
        "z_max": z_max,
        "if_min": if_min,
        "if_max": if_max,
        "weights": {"z_score": 0.5, "isolation_forest": 0.5},
        "weighted_threshold": float(calibration_weighted.quantile(0.995)),
    }


def add_combined_methods(scored: pd.DataFrame, calibration_fraction: float = 0.1) -> pd.DataFrame:
    output = scored.copy()
    params = combination_parameters(output, calibration_fraction)

    output["z_score_normalized"] = ((output["z_anomaly_score"] - params["z_min"]) / (params["z_max"] - params["z_min"])).clip(0, 1)
    output["if_score_normalized"] = ((output["if_anomaly_score"] - params["if_min"]) / (params["if_max"] - params["if_min"])).clip(0, 1)
    output["or_score"] = output[["z_score_normalized", "if_score_normalized"]].max(axis=1)
    output["and_score"] = output[["z_score_normalized", "if_score_normalized"]].min(axis=1)
    output["weighted_score"] = (
        params["weights"]["z_score"] * output["z_score_normalized"]
        + params["weights"]["isolation_forest"] * output["if_score_normalized"]
    )
    weighted_threshold = params["weighted_threshold"]
    output["or_raw_alert"] = output["z_persistent_alert"] | output["if_persistent_alert"]
    output["and_raw_alert"] = output["z_persistent_alert"] & output["if_persistent_alert"]
    output["weighted_raw_alert"] = output["weighted_score"].ge(weighted_threshold)
    output.attrs["weighted_threshold"] = weighted_threshold
    output.attrs["calibration_limit"] = params["calibration_limit"]
    return output


def add_method_flags(scores: pd.DataFrame) -> pd.DataFrame:
    output = trailing_persistence(scores, "z_is_anomaly", "z_persistent_alert")
    output = trailing_persistence(output, "if_is_anomaly", "if_persistent_alert")
    output = add_combined_methods(output)
    output = trailing_persistence(output, "or_raw_alert", "or_persistent_alert")
    output = trailing_persistence(output, "and_raw_alert", "and_persistent_alert")
    output = trailing_persistence(output, "weighted_raw_alert", "weighted_persistent_alert")
    return output


def score_for_method(frame: pd.DataFrame, method: str) -> pd.Series:
    if method == "z_score":
        return frame["z_score_normalized"]
    if method == "isolation_forest":
        return frame["if_score_normalized"]
    if method == "or":
        return frame["or_score"]
    if method == "and":
        return frame["and_score"]
    if method == "weighted":
        return frame["weighted_score"]
    raise ValueError(f"Unknown method: {method}")


def alert_column_for_method(method: str) -> str:
    return {
        "z_score": "z_persistent_alert",
        "isolation_forest": "if_persistent_alert",
        "or": "or_persistent_alert",
        "and": "and_persistent_alert",
        "weighted": "weighted_persistent_alert",
    }[method]


def add_proxy_labels(frame: pd.DataFrame, window_fraction: float) -> pd.DataFrame:
    output = frame.copy()
    failed_by_experiment = {
        experiment: set(documented.failed_bearings)
        for experiment, documented in IMS_DOCUMENTATION.items()
    }
    output["documented_failed_bearing"] = [
        int(bearing) in failed_by_experiment.get(str(experiment), set())
        for experiment, bearing in zip(output["experiment"], output["bearing"])
    ]
    output["proxy_degradation_window"] = output["full_life_fraction"].ge(1 - window_fraction)
    output["proxy_degradation"] = output["documented_failed_bearing"] & output["proxy_degradation_window"]
    return output


def count_alert_episodes(frame: pd.DataFrame, alert_column: str, positive_column: str = "proxy_degradation") -> tuple[int, int]:
    total_episodes = 0
    false_episodes = 0
    for _, group in frame.sort_values(["experiment", "bearing", "timestamp"]).groupby(["experiment", "bearing"], sort=True):
        active = group[alert_column].astype(bool).to_numpy()
        positives = group[positive_column].astype(bool).to_numpy()
        previous = False
        for is_alert, is_positive in zip(active, positives):
            if is_alert and not previous:
                total_episodes += 1
                if not is_positive:
                    false_episodes += 1
            previous = bool(is_alert)
    return total_episodes, false_episodes


def false_alerts_per_day(frame: pd.DataFrame, alert_column: str) -> float:
    non_positive = frame[~frame["proxy_degradation"]]
    if non_positive.empty:
        return 0.0
    _, false_episodes = count_alert_episodes(frame, alert_column)
    duration_days = (
        non_positive.groupby("experiment")["timestamp"].agg(lambda items: (items.max() - items.min()).total_seconds()).sum()
        / 86_400
    )
    return float(false_episodes / duration_days) if duration_days else 0.0


def alert_lead_time_days(frame: pd.DataFrame, alert_column: str) -> float | None:
    failed_alerts = frame[frame[alert_column] & frame["documented_failed_bearing"]].copy()
    if failed_alerts.empty:
        return None
    first_alerts = failed_alerts.groupby(["experiment", "bearing"])["timestamp"].min().reset_index()
    end_times = frame.groupby("experiment")["timestamp"].max().to_dict()
    lead_times = [
        (end_times[row.experiment] - row.timestamp).total_seconds() / 86_400
        for row in first_alerts.itertuples(index=False)
    ]
    return float(np.mean(lead_times)) if lead_times else None


def calculate_method_metrics(frame: pd.DataFrame, method: str, window_fraction: float) -> dict:
    labeled = add_proxy_labels(frame, window_fraction)
    alert_column = alert_column_for_method(method)
    y_true = labeled["proxy_degradation"].astype(bool)
    y_pred = labeled[alert_column].astype(bool)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true,
        y_pred,
        average="binary",
        zero_division=0,
    )
    if y_true.nunique() < 2:
        pr_auc = float("nan")
    else:
        pr_auc = float(average_precision_score(y_true, score_for_method(labeled, method)))
    total_episodes, false_episodes = count_alert_episodes(labeled, alert_column)
    alert_count = int(y_pred.sum())
    failed_alert_count = int((y_pred & labeled["documented_failed_bearing"]).sum())
    return {
        "method": method,
        "proxy_window": window_fraction,
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "pr_auc": pr_auc,
        "false_alerts_per_day": false_alerts_per_day(labeled, alert_column),
        "alert_lead_time_days": alert_lead_time_days(labeled, alert_column),
        "episodes": int(total_episodes),
        "false_episodes": int(false_episodes),
        "alerts": alert_count,
        "failing_bearing_alerts": failed_alert_count,
        "failing_bearing_concentration": float(failed_alert_count / alert_count) if alert_count else 0.0,
    }


def calculate_validation_metrics(scored: pd.DataFrame, windows: Iterable[float]) -> pd.DataFrame:
    methods = ["z_score", "isolation_forest", "or", "and", "weighted"]
    return pd.DataFrame(
        calculate_method_metrics(scored, method, window)
        for window in windows
        for method in methods
    )


def explain_overlap(scored: pd.DataFrame) -> dict:
    z_raw = scored["z_is_anomaly"].astype(bool)
    if_raw = scored["if_is_anomaly"].astype(bool)
    z_persistent = scored["z_persistent_alert"].astype(bool)
    if_persistent = scored["if_persistent_alert"].astype(bool)
    return {
        "raw_z_alerts": int(z_raw.sum()),
        "raw_if_alerts": int(if_raw.sum()),
        "raw_overlap": int((z_raw & if_raw).sum()),
        "persistent_z_alerts": int(z_persistent.sum()),
        "persistent_if_alerts": int(if_persistent.sum()),
        "persistent_overlap": int((z_persistent & if_persistent).sum()),
        "z_only_persistent": int((z_persistent & ~if_persistent).sum()),
        "if_only_persistent": int((if_persistent & ~z_persistent).sum()),
        "reason": (
            "Z-score compares each bearing to recent rolling behavior and reacts to sharp local changes; "
            "Isolation Forest compares multivariate feature states against the early healthy baseline. "
            "Low overlap means the methods are sensitive to different degradation signatures."
        ),
    }


def select_method(metrics: pd.DataFrame) -> dict:
    aggregate = (
        metrics.groupby("method", as_index=False)
        .agg(
            mean_f1=("f1", "mean"),
            mean_precision=("precision", "mean"),
            mean_recall=("recall", "mean"),
            mean_pr_auc=("pr_auc", "mean"),
            mean_false_alerts_per_day=("false_alerts_per_day", "mean"),
            mean_failing_bearing_concentration=("failing_bearing_concentration", "mean"),
            mean_alert_lead_time_days=("alert_lead_time_days", "mean"),
        )
        .sort_values(
            [
                "mean_f1",
                "mean_failing_bearing_concentration",
                "mean_pr_auc",
                "mean_false_alerts_per_day",
            ],
            ascending=[False, False, False, True],
        )
        .reset_index(drop=True)
    )
    selected = aggregate.iloc[0].to_dict()
    selected["selection_reason"] = (
        "Selected by degradation evidence: highest average F1 across proxy windows, with failing-bearing "
        "concentration and PR-AUC used ahead of raw anomaly count."
    )
    return {"selected": selected, "method_ranking": aggregate.to_dict(orient="records")}


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(json_safe(payload), indent=2, default=str, allow_nan=False), encoding="utf-8")


def infer_threshold(scores: pd.DataFrame, score_column: str, flag_column: str) -> float:
    flagged = scores[scores[flag_column].astype(bool)][score_column]
    if flagged.empty:
        return float("inf")
    return float(flagged.min())


def build_initial_z_history(
    features_with_life: pd.DataFrame,
    experiment: str,
    healthy_fraction: float,
    rolling_window: int,
) -> dict[str, list[dict]]:
    healthy = features_with_life[
        features_with_life["experiment"].eq(experiment)
        & features_with_life["full_life_fraction"].le(healthy_fraction)
    ].copy()
    history: dict[str, list[dict]] = {}
    for channel, group in healthy.sort_values(["sensor_channel", "timestamp"]).groupby("sensor_channel", sort=True):
        rows = group.tail(rolling_window)[MODEL_FEATURES].to_dict(orient="records")
        history[str(int(channel))] = rows
    return history


def build_baseline_std_by_sensor_channel(
    features_with_life: pd.DataFrame,
    experiment: str,
    healthy_fraction: float,
) -> dict[str, dict[str, float]]:
    healthy = features_with_life[
        features_with_life["experiment"].eq(experiment)
        & features_with_life["full_life_fraction"].le(healthy_fraction)
    ].copy()
    baseline_std: dict[str, dict[str, float]] = {}
    for channel, group in healthy.sort_values(["sensor_channel", "timestamp"]).groupby("sensor_channel", sort=True):
        baseline_std[str(int(channel))] = {
            feature: float(value)
            for feature, value in group[MODEL_FEATURES].std(ddof=1).replace(0, np.nan).fillna(1e-12).items()
        }
    return baseline_std


def build_inference_artifact_payload(
    *,
    project_root: Path,
    selected_payload: dict,
    features_with_life: pd.DataFrame,
    channel_scores: pd.DataFrame,
    bearing_scores: pd.DataFrame,
    source_model_path: Path | None,
) -> dict:
    validated_experiments = sorted(bearing_scores["experiment"].dropna().astype(str).unique().tolist())
    baseline_experiment = validated_experiments[0] if validated_experiments else "1st_test"
    healthy_fraction = 0.2
    evaluation_start_fraction = 0.5
    rolling_window = 50
    combination = combination_parameters(bearing_scores)
    return {
        "artifact_type": "ims_anomaly_inference_pipeline",
        "version": "0.1.0",
        "artifact_version": "v0_1_0",
        "selected_method": selected_payload["selected"]["method"],
        "selection": selected_payload,
        "feature_order": MODEL_FEATURES,
        "required_columns": REQUIRED_FEATURE_COLUMNS,
        "validated_experiments": validated_experiments,
        "cross_experiment_validation_performed": len(validated_experiments) > 1,
        "cross_experiment_validation_evidence": (
            "Validation metrics JSON aggregation_summary contains only 1st_test."
            if validated_experiments == ["1st_test"]
            else f"Validated experiments: {validated_experiments}"
        ),
        "dynamic_z_score": {
            "baseline_experiment": baseline_experiment,
            "healthy_fraction": healthy_fraction,
            "evaluation_start_fraction": evaluation_start_fraction,
            "rolling_window": rolling_window,
            "min_periods": rolling_window,
            "epsilon": 1e-12,
            "std_floor_fraction": 0.05,
            "raw_threshold": infer_threshold(channel_scores, "z_anomaly_score", "z_is_anomaly"),
            "initial_history_by_sensor_channel": build_initial_z_history(
                features_with_life,
                baseline_experiment,
                healthy_fraction,
                rolling_window,
            ),
            "baseline_std_by_sensor_channel": build_baseline_std_by_sensor_channel(
                features_with_life,
                baseline_experiment,
                healthy_fraction,
            ),
        },
        "isolation_forest": {
            "source_model_path": source_model_path.as_posix() if source_model_path else None,
            "raw_threshold": infer_threshold(channel_scores, "if_anomaly_score", "if_is_anomaly"),
        },
        "normalization": combination,
        "aggregation": {
            "group_by": ["experiment", "timestamp", "bearing"],
            "score_aggregation": "max",
            "flag_aggregation": "any",
            "channel_count": "nunique(sensor_channel)",
        },
        "persistence": {
            "group_by": ["experiment", "bearing"],
            "window": 5,
            "required": 3,
            "direction": "trailing_chronological",
        },
        "risk_levels": [
            {"level": "NORMAL", "min": 0, "max": 39},
            {"level": "MONITOR", "min": 40, "max": 69},
            {"level": "HIGH", "min": 70, "max": 84},
            {"level": "CRITICAL", "min": 85, "max": 100},
        ],
        "documentation": {
            key: {
                "failed_bearings": list(documented.failed_bearings),
                "channel_to_bearing": documented.channel_to_bearing,
                "channel_to_axis": documented.channel_to_axis,
                "source": documented.source,
            }
            for key, documented in IMS_DOCUMENTATION.items()
        },
        "notes": [
            "No FastAPI, NestJS, MongoDB, or frontend integration has been implemented.",
            "Validation uses proxy degradation windows because explicit failure timestamps/labels are not available per file.",
            "IMS channel mappings are limited to mappings documented in the local IMS readme.",
            "Inference is deterministic and uses saved parameters; it must not train or refit models.",
        ],
    }


def save_selected_artifacts(
    project_root: Path,
    selected_payload: dict,
    source_model_path: Path | None = None,
    *,
    features_with_life: pd.DataFrame | None = None,
    channel_scores: pd.DataFrame | None = None,
    bearing_scores: pd.DataFrame | None = None,
) -> dict:
    models_dir = project_root / "artifacts" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    version = "v0_1_0"
    metadata_path = models_dir / f"ims_selected_anomaly_model_{version}.json"
    model_path = models_dir / f"ims_selected_anomaly_model_{version}.joblib"
    selected_method = selected_payload["selected"]["method"]
    artifact_payload = None
    if features_with_life is not None and channel_scores is not None and bearing_scores is not None:
        artifact_payload = build_inference_artifact_payload(
            project_root=project_root,
            selected_payload=selected_payload,
            features_with_life=features_with_life,
            channel_scores=channel_scores,
            bearing_scores=bearing_scores,
            source_model_path=source_model_path,
        )
        if source_model_path and source_model_path.exists():
            artifact_payload["isolation_forest"]["estimator"] = joblib.load(source_model_path)
        joblib.dump(artifact_payload, model_path)
    if selected_method == "isolation_forest" and source_model_path and source_model_path.exists():
        shutil.copy2(source_model_path, model_path)
    elif artifact_payload is None:
        joblib.dump(
            {
                "version": version,
                "selected_method": selected_method,
                "selection": selected_payload,
                "artifact_type": "validation_selected_scoring_config",
            },
            model_path,
        )
    metadata = {
        "version": "0.1.0",
        "artifact_version": version,
        "selected_method": selected_method,
        "selection": selected_payload,
        "model_artifact": model_path.as_posix() if model_path else None,
        "cross_experiment_validation_performed": (
            artifact_payload["cross_experiment_validation_performed"] if artifact_payload else False
        ),
        "validated_experiments": artifact_payload["validated_experiments"] if artifact_payload else [],
        "feature_order": artifact_payload["feature_order"] if artifact_payload else MODEL_FEATURES,
        "normalization": artifact_payload["normalization"] if artifact_payload else None,
        "persistence": artifact_payload["persistence"] if artifact_payload else None,
        "aggregation": artifact_payload["aggregation"] if artifact_payload else None,
        "risk_levels": artifact_payload["risk_levels"] if artifact_payload else None,
        "notes": [
            "No FastAPI, NestJS, MongoDB, frontend, or platform integration has been implemented.",
            "Validation uses proxy degradation windows because explicit failure timestamps/labels are not available per file.",
            "IMS channel mappings are limited to mappings documented in the local IMS readme.",
        ],
    }
    save_json(metadata_path, metadata)
    return {"metadata_path": metadata_path, "model_path": model_path}
