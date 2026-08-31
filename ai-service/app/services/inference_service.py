from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from pathlib import Path
from threading import Lock
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
        self._last_timestamp_by_stream: dict[tuple[str, int], pd.Timestamp] = {}
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
        return self.pipeline.version == "0.1.0"

    def analyze(self, rows: list[ImsFeatureRow]) -> list[dict[str, Any]]:
        frame = self._rows_to_frame(rows)
        self._log_request("analyze", rows)
        with self._lock:
            self._reject_out_of_order_stream(frame)
            output = self.pipeline.predict_timestamp(frame)
            self._record_stream_timestamps(frame)
        return self.pipeline.to_json_records(output)

    def analyze_batch(self, rows: list[ImsFeatureRow]) -> list[dict[str, Any]]:
        frame = self._rows_to_frame(rows)
        self._log_request("analyze_batch", rows)
        replay_pipeline = self._new_replay_pipeline()
        output = replay_pipeline.predict_batch(frame, reset_state=True)
        return replay_pipeline.to_json_records(output)

    def metadata(self) -> dict[str, Any]:
        return {
            "id": "ims-selected-anomaly-model-v0-1-0",
            "modelVersion": self.pipeline.version,
            "artifactVersion": str(self.pipeline.metadata.get("artifact_version", "v0_1_0")),
            "selectedMethod": str(self.pipeline.artifact["selected_method"]),
            "sourceDataset": "IMS public bearing test-rig data",
            "validatedExperiments": sorted(self.pipeline.validated_experiments),
            "validationScope": "Validated only on the later chronological portion of IMS 1st_test.",
            "generalizationStatus": (
                "Generalization to IMS 2nd_test, IMS 3rd_test, and IPROTEX industrial machines "
                "is not established."
            ),
            "unsupportedGeneralizationTargets": ["2nd_test", "3rd_test", "IPROTEX"],
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
        }

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

    def _reject_out_of_order_stream(self, frame: pd.DataFrame) -> None:
        timestamps = pd.to_datetime(frame["timestamp"], errors="coerce")
        for row, timestamp in zip(frame.itertuples(index=False), timestamps, strict=True):
            key = (str(row.experiment), int(row.sensor_channel))
            previous = self._last_timestamp_by_stream.get(key)
            if previous is not None and timestamp <= previous:
                raise ValueError(
                    "Streaming input must be strictly chronological for each experiment and sensor channel."
                )

    def _record_stream_timestamps(self, frame: pd.DataFrame) -> None:
        timestamps = pd.to_datetime(frame["timestamp"], errors="coerce")
        for row, timestamp in zip(frame.itertuples(index=False), timestamps, strict=True):
            key = (str(row.experiment), int(row.sensor_channel))
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
