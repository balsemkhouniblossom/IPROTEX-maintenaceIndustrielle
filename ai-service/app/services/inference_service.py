from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Any
import logging
import platform

import joblib
import numpy as np
import pandas as pd
import sklearn

from app.schemas.anomaly import ImsFeatureRow
from src.inference.ims_anomaly_inference import ImsAnomalyInferencePipeline


logger = logging.getLogger("ims_anomaly_api.inference")


class InferenceService:
    """Thread-safe API wrapper around the validated deterministic IMS pipeline."""

    def __init__(self, artifact_path: Path, metadata_path: Path) -> None:
        self.pipeline = ImsAnomalyInferencePipeline(artifact_path, metadata_path)
        self._lock = Lock()
        self._state_lock = Lock()
        self._enabled = True
        self._active_executions = 0
        self._last_execution_at: str | None = None
        self._last_execution_duration_ms: float | None = None
        self._last_error: str | None = None
        self._last_timestamp_by_stream: dict[tuple[str, str, int], pd.Timestamp] = {}
        self._pipelines_by_stream: dict[str, ImsAnomalyInferencePipeline] = {}
        self._runtime_versions = {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scikitLearn": sklearn.__version__,
            "joblib": joblib.__version__,
        }
        self._artifact_versions = {
            "python": str(self.pipeline.artifact.get("python_version", "not recorded in artifact")),
            "numpy": str(self.pipeline.artifact.get("numpy_version", "2.5.2 in requirements at artifact freeze time")),
            "scikitLearn": str(
                self.pipeline.artifact.get("scikit_learn_version", "1.9.0 recorded by pickle warning")
            ),
            "joblib": str(self.pipeline.artifact.get("joblib_version", "1.5.3 in requirements at artifact freeze time")),
        }
        logger.info(
            "Loaded IMS anomaly artifact",
            extra={"model_version": self.pipeline.version, "selected_method": self.pipeline.artifact["selected_method"]},
        )

    @property
    def ready(self) -> bool:
        return bool(self.pipeline.version and self.pipeline.estimator is not None)

    def analyze(self, stream_id: str, rows: list[ImsFeatureRow]) -> list[dict[str, Any]]:
        started = self._begin_execution()
        try:
            return self._analyze(stream_id, rows)
        except Exception as exc:
            self._last_error = str(exc)
            raise
        finally:
            self._finish_execution(started)

    def _analyze(self, stream_id: str, rows: list[ImsFeatureRow]) -> list[dict[str, Any]]:
        frame = self._rows_to_frame(rows)
        self._log_request("analyze", rows)
        with self._lock:
            self._reject_out_of_order_stream(stream_id, frame)
            stream_pipeline = self._pipelines_by_stream.get(stream_id)
            if stream_pipeline is None:
                stream_pipeline = self._new_replay_pipeline()
                self._pipelines_by_stream[stream_id] = stream_pipeline
            output = stream_pipeline.predict_timestamp(frame)
            self._record_stream_timestamps(stream_id, frame)
        return stream_pipeline.to_json_records(output)

    def analyze_batch(self, rows: list[ImsFeatureRow]) -> list[dict[str, Any]]:
        started = self._begin_execution()
        try:
            return self._analyze_batch(rows)
        except Exception as exc:
            self._last_error = str(exc)
            raise
        finally:
            self._finish_execution(started)

    def _analyze_batch(self, rows: list[ImsFeatureRow]) -> list[dict[str, Any]]:
        frame = self._rows_to_frame(rows)
        self._log_request("analyze_batch", rows)
        replay_pipeline = self._new_replay_pipeline()
        output = replay_pipeline.predict_batch(frame, reset_state=True)
        return replay_pipeline.to_json_records(output)

    def metadata(self) -> dict[str, Any]:
        with self._state_lock:
            enabled = self._enabled
            running = self._active_executions > 0
            status = "RUNNING" if running else ("ACTIVE" if enabled else "STOPPED")
        return {
            "id": f"ims-selected-anomaly-model-v{self.pipeline.version.replace('.', '-')}",
            "modelVersion": self.pipeline.version,
            "artifactVersion": str(self.pipeline.metadata.get("artifact_version", f"v{self.pipeline.version.replace('.', '_')}")),
            "selectedMethod": str(self.pipeline.artifact["selected_method"]),
            "sourceDataset": "IMS public bearing test-rig data",
            "validatedExperiments": sorted(self.pipeline.validated_experiments),
            "validationScope": str(self.pipeline.metadata.get("locked_test_scope", "Later chronological IMS 1st_test only.")),
            "generalizationStatus": (
                "Cross-experiment results are experimental; generalization to IPROTEX industrial machines is not established."
                if self.pipeline.artifact.get("cross_experiment_validation_performed")
                else "Generalization beyond the artifact validation scope is not established."
            ),
            "unsupportedGeneralizationTargets": [
                *sorted(set(self.pipeline.documentation) - self.pipeline.validated_experiments),
                "IPROTEX",
            ],
            "featureOrder": list(self.pipeline.feature_order),
            "requiredColumns": list(self.pipeline.required_columns),
            "riskLevels": deepcopy(self.pipeline.risk_levels),
            "persistence": deepcopy(self.pipeline.persistence_config),
            "aggregation": deepcopy(self.pipeline.artifact["aggregation"]),
            "runtimeLoadedWith": dict(self._runtime_versions),
            "artifactProducedWith": dict(self._artifact_versions),
            "warnings": [
                "The joblib artifact may emit NumPy/scikit-learn unpickle deprecation or version warnings when loaded.",
                "Warnings are documented and are not globally suppressed by the API.",
            ],
            "name": "IMS Selected Anomaly Pipeline",
            "task": "anomaly_detection",
            "purpose": "Aggregate Dynamic Z-score and Isolation Forest scores for bearing anomaly screening.",
            "framework": "scikit-learn + deterministic Python pipeline",
            "loaded": True,
            "enabled": enabled,
            "running": running,
            "status": status,
            "activeExecutions": self._active_executions,
            "lastExecutionAt": self._last_execution_at,
            "lastExecutionDurationMs": self._last_execution_duration_ms,
            "lastError": self._last_error,
            "validationMetrics": deepcopy(
                self.pipeline.metadata.get("validation_metrics", {}).get("selected_test_metrics")
                or self.pipeline.metadata.get("selection", {}).get("selected", {})
            ),
            "acceptedForAdvisoryPilot": bool(self.pipeline.metadata.get("accepted_for_advisory_pilot", False)),
            "riskMappingType": str(self.pipeline.metadata.get("risk_mapping_type", "heuristic")),
            "knownLimitations": deepcopy(self.pipeline.metadata.get("limitations", [])),
        }

    def start(self) -> dict[str, Any]:
        with self._state_lock:
            self._enabled = True
            self._last_error = None
        return self.metadata()

    def stop(self) -> dict[str, Any]:
        with self._state_lock:
            self._enabled = False
        return self.metadata()

    def _begin_execution(self) -> float:
        with self._state_lock:
            if not self._enabled:
                raise RuntimeError("MODEL_DISABLED")
            self._active_executions += 1
        return perf_counter()

    def _finish_execution(self, started: float) -> None:
        with self._state_lock:
            self._active_executions -= 1
            self._last_execution_at = datetime.now().astimezone().isoformat()
            self._last_execution_duration_ms = round((perf_counter() - started) * 1000, 2)

    def _new_replay_pipeline(self) -> ImsAnomalyInferencePipeline:
        clone = object.__new__(ImsAnomalyInferencePipeline)
        clone.artifact_path = self.pipeline.artifact_path
        clone.artifact = self.pipeline.artifact
        clone.metadata = self.pipeline.metadata
        clone.version = self.pipeline.version
        clone.feature_order = list(self.pipeline.feature_order)
        clone.required_columns = list(self.pipeline.required_columns)
        clone.validated_experiments = set(self.pipeline.validated_experiments)
        clone.documentation = self.pipeline.documentation
        clone.dynamic_z_config = self.pipeline.dynamic_z_config
        clone.if_config = self.pipeline.if_config
        clone.normalization = self.pipeline.normalization
        clone.persistence_config = self.pipeline.persistence_config
        clone.risk_levels = self.pipeline.risk_levels
        clone.estimator = self.pipeline.estimator
        clone.reset_state()
        return clone

    @staticmethod
    def _rows_to_frame(rows: list[ImsFeatureRow]) -> pd.DataFrame:
        return pd.DataFrame([row.model_dump(mode="python") for row in rows])

    def _reject_out_of_order_stream(self, stream_id: str, frame: pd.DataFrame) -> None:
        timestamps = pd.to_datetime(frame["timestamp"], errors="coerce")
        for row, timestamp in zip(frame.itertuples(index=False), timestamps, strict=True):
            key = (stream_id, str(row.experiment), int(row.sensor_channel))
            previous = self._last_timestamp_by_stream.get(key)
            if previous is not None and timestamp <= previous:
                raise ValueError(
                    "Streaming input must be strictly chronological for each experiment and sensor channel."
                )

    def _record_stream_timestamps(self, stream_id: str, frame: pd.DataFrame) -> None:
        timestamps = pd.to_datetime(frame["timestamp"], errors="coerce")
        for row, timestamp in zip(frame.itertuples(index=False), timestamps, strict=True):
            key = (stream_id, str(row.experiment), int(row.sensor_channel))
            self._last_timestamp_by_stream[key] = timestamp

    @staticmethod
    def _log_request(action: str, rows: list[ImsFeatureRow]) -> None:
        experiments = sorted({row.experiment for row in rows})
        bearings = sorted({row.bearing for row in rows})
        timestamps = [row.timestamp for row in rows]
        logger.info(
            "IMS anomaly request accepted",
            extra={
                "action": action,
                "row_count": len(rows),
                "experiments": experiments,
                "bearings": bearings,
                "timestamp_start": min(timestamps).isoformat(),
                "timestamp_end": max(timestamps).isoformat(),
            },
        )
