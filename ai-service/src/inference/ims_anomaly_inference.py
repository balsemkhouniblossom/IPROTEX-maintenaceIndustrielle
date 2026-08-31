from __future__ import annotations

from collections import defaultdict, deque
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
import math
from typing import Any

import joblib
import numpy as np
import pandas as pd


class ImsInferenceError(ValueError):
    """Raised when inference input or artifacts are incompatible."""


@dataclass(frozen=True)
class ImsRiskLevel:
    level: str
    minimum: int
    maximum: int

    def contains(self, score: int) -> bool:
        return self.minimum <= score <= self.maximum


def load_inference_artifact(path: str | Path) -> dict[str, Any]:
    artifact = joblib.load(path)
    if not isinstance(artifact, dict):
        raise ImsInferenceError("Selected model artifact must be a dictionary.")
    if artifact.get("artifact_type") != "ims_anomaly_inference_pipeline":
        raise ImsInferenceError("Selected model artifact is not an IMS inference pipeline artifact.")
    required = [
        "version",
        "selected_method",
        "feature_order",
        "required_columns",
        "dynamic_z_score",
        "isolation_forest",
        "normalization",
        "aggregation",
        "persistence",
        "risk_levels",
        "documentation",
    ]
    missing = [key for key in required if key not in artifact]
    if missing:
        raise ImsInferenceError(f"Selected model artifact is missing required keys: {missing}")
    if "estimator" not in artifact["isolation_forest"]:
        raise ImsInferenceError("Selected model artifact is missing the saved Isolation Forest estimator.")
    return artifact


def load_inference_metadata(path: str | Path) -> dict[str, Any]:
    import json

    with Path(path).open("r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    if metadata.get("version") != "0.1.0":
        raise ImsInferenceError("Only IMS inference model version 0.1.0 is supported.")
    return metadata


def _as_timestamp_series(series: pd.Series) -> pd.Series:
    parsed = pd.to_datetime(series, errors="coerce")
    if parsed.isna().any():
        raise ImsInferenceError("timestamp contains missing or unparsable values.")
    return parsed


def _risk_level(score: int, risk_levels: list[dict[str, Any]]) -> str:
    for item in risk_levels:
        level = ImsRiskLevel(str(item["level"]), int(item["min"]), int(item["max"]))
        if level.contains(score):
            return level.level
    raise ImsInferenceError(f"Risk score {score} is not covered by configured risk levels.")


def _json_value(value: Any) -> Any:
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return value
    return value


class ImsAnomalyInferencePipeline:
    """Deterministic IMS anomaly inference from the saved v0.1.0 artifact.

    This class never trains or refits. It only loads persisted validation-time
    parameters and estimator state.
    """

    def __init__(self, artifact_path: str | Path, metadata_path: str | Path | None = None) -> None:
        self.artifact_path = Path(artifact_path)
        self.artifact = load_inference_artifact(self.artifact_path)
        self.metadata = load_inference_metadata(metadata_path) if metadata_path else None
        self.version = str(self.artifact["version"])
        self.feature_order = list(self.artifact["feature_order"])
        self.required_columns = list(self.artifact["required_columns"])
        self.validated_experiments = set(self.artifact.get("validated_experiments", []))
        self.documentation = self.artifact["documentation"]
        self.dynamic_z_config = self.artifact["dynamic_z_score"]
        self.if_config = self.artifact["isolation_forest"]
        self.normalization = self.artifact["normalization"]
        self.persistence_config = self.artifact["persistence"]
        self.risk_levels = self.artifact["risk_levels"]
        self.estimator = self.if_config["estimator"]
        self.reset_state()

    def reset_state(self) -> None:
        self._z_history: dict[tuple[str, int], deque[np.ndarray]] = {}
        baseline_experiment = str(self.dynamic_z_config["baseline_experiment"])
        for channel, rows in self.dynamic_z_config["initial_history_by_sensor_channel"].items():
            key = (baseline_experiment, int(channel))
            self._z_history[key] = deque(
                (np.array([row[feature] for feature in self.feature_order], dtype=float) for row in rows),
                maxlen=int(self.dynamic_z_config["rolling_window"]),
            )
        self._persistence_history: dict[tuple[str, int, str], deque[bool]] = defaultdict(
            lambda: deque(maxlen=int(self.persistence_config["window"]))
        )

    def validate_input(self, frame: pd.DataFrame) -> pd.DataFrame:
        missing = [column for column in self.required_columns if column not in frame.columns]
        if missing:
            raise ImsInferenceError(f"Input is missing required columns: {missing}")
        if frame.empty:
            raise ImsInferenceError("Input must contain at least one row.")

        output = frame.copy()
        output["timestamp"] = _as_timestamp_series(output["timestamp"])
        non_nullable_columns = [column for column in self.required_columns if column != "axis"]
        if output[non_nullable_columns].isna().any().any():
            columns = output[non_nullable_columns].columns[output[non_nullable_columns].isna().any()].tolist()
            raise ImsInferenceError(f"Input contains missing values in required columns: {columns}")
        for column in self.feature_order:
            output[column] = pd.to_numeric(output[column], errors="coerce")
        numeric = output[self.feature_order].to_numpy(dtype=float)
        if not np.isfinite(numeric).all():
            raise ImsInferenceError("Input feature columns must contain only finite numeric values.")

        duplicates = output.duplicated(["experiment", "timestamp", "sensor_channel"])
        if duplicates.any():
            raise ImsInferenceError("Input contains duplicate experiment/timestamp/sensor_channel rows.")

        unknown_experiments = sorted(set(output["experiment"].astype(str)) - set(self.documentation))
        if unknown_experiments:
            raise ImsInferenceError(f"Input contains experiments without documented IMS mappings: {unknown_experiments}")
        if self.validated_experiments:
            unsupported = sorted(set(output["experiment"].astype(str)) - self.validated_experiments)
            if unsupported:
                raise ImsInferenceError(
                    "This v0.1.0 artifact was validated only for "
                    f"{sorted(self.validated_experiments)}; unsupported experiments: {unsupported}"
                )

        for experiment, group in output.groupby("experiment", sort=False):
            for _, channel_group in group.groupby("sensor_channel", sort=False):
                if not channel_group["timestamp"].is_monotonic_increasing:
                    raise ImsInferenceError("Input must be chronological within each experiment and sensor channel.")
            documented = self.documentation[str(experiment)]
            channel_to_bearing = {int(k): int(v) for k, v in documented["channel_to_bearing"].items()}
            channel_to_axis = {int(k): v for k, v in documented["channel_to_axis"].items()}
            for row in group.itertuples(index=False):
                expected_bearing = channel_to_bearing.get(int(row.sensor_channel))
                if expected_bearing is None:
                    raise ImsInferenceError(
                        f"Sensor channel {row.sensor_channel} is not documented for experiment {experiment}."
                    )
                if int(row.bearing) != expected_bearing:
                    raise ImsInferenceError(
                        f"Invalid bearing mapping for {experiment} channel {row.sensor_channel}: "
                        f"expected bearing {expected_bearing}, got {row.bearing}."
                    )
                expected_axis = channel_to_axis[int(row.sensor_channel)]
                row_axis = getattr(row, "axis")
                if expected_axis is None:
                    if pd.notna(row_axis) and str(row_axis) not in {"", "nan", "None"}:
                        raise ImsInferenceError(
                            f"Experiment {experiment} channel {row.sensor_channel} should not have an axis value."
                        )
                elif str(row_axis) != expected_axis:
                    raise ImsInferenceError(
                        f"Invalid axis mapping for {experiment} channel {row.sensor_channel}: "
                        f"expected {expected_axis}, got {row_axis}."
                    )

        return output.sort_values(["experiment", "timestamp", "sensor_channel"]).reset_index(drop=True)

    def _z_score_for_row(self, experiment: str, sensor_channel: int, values: np.ndarray) -> float:
        key = (experiment, sensor_channel)
        if key not in self._z_history:
            baseline_experiment = str(self.dynamic_z_config["baseline_experiment"])
            source_key = (baseline_experiment, sensor_channel)
            if source_key not in self._z_history:
                raise ImsInferenceError(f"No Z-score baseline history for sensor channel {sensor_channel}.")
            self._z_history[key] = deepcopy(self._z_history[source_key])
        history = self._z_history[key]
        min_periods = int(self.dynamic_z_config["min_periods"])
        if len(history) < min_periods:
            raise ImsInferenceError(
                f"Not enough Z-score history for {experiment} channel {sensor_channel}: "
                f"{len(history)} rows available, {min_periods} required."
            )
        matrix = np.vstack(history)
        mean = matrix.mean(axis=0)
        std = matrix.std(axis=0, ddof=1)
        baseline_std = np.array(
            [
                self.dynamic_z_config["baseline_std_by_sensor_channel"][str(sensor_channel)][feature]
                for feature in self.feature_order
            ],
            dtype=float,
        )
        std_floor = np.maximum(baseline_std, float(self.dynamic_z_config["epsilon"])) * float(
            self.dynamic_z_config["std_floor_fraction"]
        )
        std = np.maximum(std, std_floor)
        z_values = (values - mean) / std
        score = float(np.sqrt(np.mean(np.square(z_values))))
        history.append(values)
        return score

    def _channel_scores(self, frame: pd.DataFrame) -> pd.DataFrame:
        rows = []
        if_scores = -self.estimator.decision_function(frame[self.feature_order])
        for index, row in enumerate(frame.itertuples(index=False)):
            values = np.array([getattr(row, feature) for feature in self.feature_order], dtype=float)
            experiment = str(row.experiment)
            sensor_channel = int(row.sensor_channel)
            z_score = self._z_score_for_row(experiment, sensor_channel, values)
            if_score = float(if_scores[index])
            rows.append(
                {
                    "experiment": experiment,
                    "timestamp": row.timestamp,
                    "sensor_channel": sensor_channel,
                    "bearing": int(row.bearing),
                    "axis": getattr(row, "axis"),
                    "z_anomaly_score": z_score,
                    "z_is_anomaly": z_score >= float(self.dynamic_z_config["raw_threshold"]),
                    "if_anomaly_score": if_score,
                    "if_is_anomaly": if_score >= float(self.if_config["raw_threshold"]),
                }
            )
        return pd.DataFrame(rows)

    def _aggregate_channel_scores(self, channel_scores: pd.DataFrame) -> pd.DataFrame:
        grouped = (
            channel_scores.groupby(["experiment", "timestamp", "bearing"], as_index=False)
            .agg(
                z_anomaly_score=("z_anomaly_score", "max"),
                z_is_anomaly=("z_is_anomaly", "max"),
                if_anomaly_score=("if_anomaly_score", "max"),
                if_is_anomaly=("if_is_anomaly", "max"),
                channel_count=("sensor_channel", "nunique"),
            )
            .sort_values(["experiment", "timestamp", "bearing"])
            .reset_index(drop=True)
        )
        grouped["z_is_anomaly"] = grouped["z_is_anomaly"].astype(bool)
        grouped["if_is_anomaly"] = grouped["if_is_anomaly"].astype(bool)
        return grouped

    def _normalize(self, value: float, minimum: float, maximum: float) -> float:
        if maximum <= minimum:
            return 0.0
        return float(np.clip((value - minimum) / (maximum - minimum), 0, 1))

    def _apply_weighting_and_persistence(self, bearing_scores: pd.DataFrame) -> pd.DataFrame:
        rows = []
        threshold = float(self.normalization["weighted_threshold"])
        for row in bearing_scores.itertuples(index=False):
            z_norm = self._normalize(row.z_anomaly_score, self.normalization["z_min"], self.normalization["z_max"])
            if_norm = self._normalize(row.if_anomaly_score, self.normalization["if_min"], self.normalization["if_max"])
            weighted = (
                float(self.normalization["weights"]["z_score"]) * z_norm
                + float(self.normalization["weights"]["isolation_forest"]) * if_norm
            )
            weighted_raw = weighted >= threshold
            persistent_flags = {}
            for method, flag in {
                "z_score": bool(row.z_is_anomaly),
                "isolation_forest": bool(row.if_is_anomaly),
            }.items():
                key = (str(row.experiment), int(row.bearing), method)
                history = self._persistence_history[key]
                history.append(bool(flag))
                persistent_flags[method] = (
                    len(history) == int(self.persistence_config["window"])
                    and sum(history) >= int(self.persistence_config["required"])
                )
            or_raw = persistent_flags["z_score"] or persistent_flags["isolation_forest"]
            and_raw = persistent_flags["z_score"] and persistent_flags["isolation_forest"]
            method_flags = {
                "z_score": bool(row.z_is_anomaly),
                "isolation_forest": bool(row.if_is_anomaly),
                "or": or_raw,
                "and": and_raw,
                "weighted": weighted_raw,
            }
            for method, flag in {
                "or": or_raw,
                "and": and_raw,
                "weighted": weighted_raw,
            }.items():
                key = (str(row.experiment), int(row.bearing), method)
                history = self._persistence_history[key]
                history.append(bool(flag))
                persistent_flags[method] = (
                    len(history) == int(self.persistence_config["window"])
                    and sum(history) >= int(self.persistence_config["required"])
                )

            selected_method = str(self.artifact["selected_method"])
            anomaly_score = weighted if selected_method == "weighted" else {
                "z_score": z_norm,
                "isolation_forest": if_norm,
                "or": max(z_norm, if_norm),
                "and": min(z_norm, if_norm),
            }[selected_method]
            raw_anomaly = method_flags[selected_method]
            persistent_alert = persistent_flags[selected_method]
            risk_score = int(round(float(np.clip(anomaly_score, 0, 1)) * 100))
            rows.append(
                {
                    "modelVersion": self.version,
                    "experiment": row.experiment,
                    "timestamp": row.timestamp,
                    "bearing": int(row.bearing),
                    "anomalyScore": float(np.clip(anomaly_score, 0, 1)),
                    "riskScore": risk_score,
                    "riskLevel": _risk_level(risk_score, self.risk_levels),
                    "rawAnomaly": bool(raw_anomaly),
                    "persistentAlert": bool(persistent_alert),
                    "componentScores": {"zScore": z_norm, "isolationForest": if_norm},
                    "reasonCodes": self._reason_codes(row, z_norm, if_norm, weighted_raw, persistent_alert),
                    "prototypeResult": True,
                    "z_anomaly_score": float(row.z_anomaly_score),
                    "z_is_anomaly": bool(row.z_is_anomaly),
                    "if_anomaly_score": float(row.if_anomaly_score),
                    "if_is_anomaly": bool(row.if_is_anomaly),
                    "channel_count": int(row.channel_count),
                    "z_score_normalized": z_norm,
                    "if_score_normalized": if_norm,
                    "or_score": max(z_norm, if_norm),
                    "and_score": min(z_norm, if_norm),
                    "weighted_score": float(np.clip(weighted, 0, 1)),
                    "or_raw_alert": or_raw,
                    "and_raw_alert": and_raw,
                    "weighted_raw_alert": bool(weighted_raw),
                    "z_persistent_alert": persistent_flags["z_score"],
                    "if_persistent_alert": persistent_flags["isolation_forest"],
                    "or_persistent_alert": persistent_flags["or"],
                    "and_persistent_alert": persistent_flags["and"],
                    "weighted_persistent_alert": persistent_flags["weighted"],
                }
            )
        return pd.DataFrame(rows)

    def _reason_codes(
        self,
        row: Any,
        z_norm: float,
        if_norm: float,
        weighted_raw: bool,
        persistent_alert: bool,
    ) -> list[str]:
        codes = []
        if bool(row.z_is_anomaly):
            codes.append("DYNAMIC_Z_SCORE_THRESHOLD")
        if bool(row.if_is_anomaly):
            codes.append("MULTIVARIATE_OUTLIER")
        if z_norm >= 0.7:
            codes.append("ELEVATED_ROLLING_DEVIATION")
        if if_norm >= 0.7:
            codes.append("ELEVATED_MULTIVARIATE_SCORE")
        if weighted_raw:
            codes.append("WEIGHTED_SCORE_THRESHOLD")
        if persistent_alert:
            codes.append("PERSISTENCE_3_OF_5")
        return codes

    def predict_batch(self, frame: pd.DataFrame, *, reset_state: bool = True) -> pd.DataFrame:
        if reset_state:
            self.reset_state()
        validated = self.validate_input(frame)
        channel_scores = self._channel_scores(validated)
        bearing_scores = self._aggregate_channel_scores(channel_scores)
        return self._apply_weighting_and_persistence(bearing_scores)

    def predict_timestamp(self, frame: pd.DataFrame) -> pd.DataFrame:
        validated = self.validate_input(frame)
        if validated["timestamp"].nunique() != 1:
            raise ImsInferenceError("Streaming inference accepts exactly one timestamp at a time.")
        return self.predict_batch(validated, reset_state=False)

    @staticmethod
    def to_json_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
        public_columns = [
            "modelVersion",
            "experiment",
            "timestamp",
            "bearing",
            "anomalyScore",
            "riskScore",
            "riskLevel",
            "rawAnomaly",
            "persistentAlert",
            "componentScores",
            "reasonCodes",
            "prototypeResult",
        ]
        records = []
        for row in frame[public_columns].to_dict(orient="records"):
            records.append({key: _json_value(value) for key, value in row.items()})
        return records
