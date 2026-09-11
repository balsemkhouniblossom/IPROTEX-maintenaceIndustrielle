from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from app.schemas.anomaly import ImsFeatureRow


class DatasetReplayError(ValueError):
    pass


class DatasetReplayService:
    """Read-only access to extracted IMS feature rows used by the deployed model."""

    def __init__(self, features_path: Path, supported_experiments: set[str]):
        if not features_path.is_file():
            raise DatasetReplayError("IMS replay feature dataset is unavailable.")
        self._catalog_counts: dict[str, int] = {}
        if features_path.suffix.lower() == ".json":
            payload = json.loads(features_path.read_text(encoding="utf-8"))
            frame = pd.DataFrame(payload.get("rows", []))
            self._catalog_counts = {
                str(item["id"]): int(item["totalSampleCount"])
                for item in payload.get("experiments", [])
            }
            if frame.empty:
                raise DatasetReplayError("IMS replay sample artifact is empty.")
            frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="raise")
        else:
            frame = pd.read_csv(features_path, parse_dates=["timestamp"])
        self._frame = frame.sort_values(["experiment", "timestamp", "sensor_channel"])
        self._supported_experiments = supported_experiments

    def catalog(self) -> list[dict[str, object]]:
        counts = self._catalog_counts or {
            str(experiment): int(count)
            for experiment, count in self._frame.groupby("experiment")["timestamp"].nunique().items()
        }
        return [
            {
                "id": str(experiment),
                "sampleCount": int(count),
                "supported": str(experiment) in self._supported_experiments,
            }
            for experiment, count in counts.items()
        ]

    def samples(self, experiment: str, limit: int = 100) -> tuple[list[str], int]:
        self._assert_supported(experiment)
        timestamps = self._frame.loc[
            self._frame["experiment"].eq(experiment), "timestamp"
        ].drop_duplicates().reset_index(drop=True)
        available = len(timestamps)
        total = self._catalog_counts.get(experiment, available)
        if available > limit:
            positions = pd.Series(range(limit)).apply(
                lambda index: round(index * (available - 1) / (limit - 1))
            )
            timestamps = timestamps.iloc[positions.drop_duplicates().tolist()]
        return [value.isoformat() for value in timestamps], total

    def rows(self, experiment: str, timestamp) -> list[ImsFeatureRow]:
        self._assert_supported(experiment)
        selected = self._frame[
            self._frame["experiment"].eq(experiment)
            & self._frame["timestamp"].eq(pd.Timestamp(timestamp).tz_localize(None))
        ]
        if selected.empty:
            raise DatasetReplayError("The selected IMS sample was not found.")
        columns = [
            "timestamp", "experiment", "sensor_channel", "bearing", "axis", "rms",
            "standard_deviation", "peak_to_peak", "kurtosis", "skewness",
            "crest_factor", "spectral_energy", "dominant_frequency_hz",
        ]
        records = selected[columns].where(pd.notna(selected[columns]), None).to_dict(orient="records")
        return [ImsFeatureRow.model_validate(record) for record in records]

    def _assert_supported(self, experiment: str) -> None:
        if experiment not in self._supported_experiments:
            raise DatasetReplayError(
                f"Experiment {experiment} is not validated for the deployed artifact."
            )
