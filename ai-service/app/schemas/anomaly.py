from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
import math

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


FiniteFloat = Annotated[float, Field(description="Finite numeric IMS feature value.")]


class ImsFeatureRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: datetime
    experiment: str = Field(min_length=1, examples=["1st_test"])
    sensor_channel: int = Field(ge=1, examples=[1])
    bearing: int = Field(ge=1, examples=[1])
    axis: str | None = Field(default=None, examples=["x"])
    rms: FiniteFloat
    standard_deviation: FiniteFloat
    peak_to_peak: FiniteFloat
    kurtosis: FiniteFloat
    skewness: FiniteFloat
    crest_factor: FiniteFloat
    spectral_energy: FiniteFloat
    dominant_frequency_hz: FiniteFloat

    @field_validator(
        "rms",
        "standard_deviation",
        "peak_to_peak",
        "kurtosis",
        "skewness",
        "crest_factor",
        "spectral_energy",
        "dominant_frequency_hz",
    )
    @classmethod
    def finite_feature(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("feature values must be finite")
        return value


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[ImsFeatureRow] = Field(
        min_length=1,
        description="IMS feature rows for exactly one timestamp. For 1st_test, submit all relevant sensor channels for that timestamp.",
    )

    @model_validator(mode="after")
    def validate_single_timestamp_and_duplicates(self) -> "AnalyzeRequest":
        timestamps = {row.timestamp for row in self.rows}
        if len(timestamps) != 1:
            raise ValueError("analyze accepts exactly one timestamp per request")
        keys = [(row.experiment, row.timestamp, row.sensor_channel) for row in self.rows]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate experiment/timestamp/sensor_channel rows are not allowed")
        return self


class AnalyzeBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[ImsFeatureRow] = Field(
        min_length=1,
        description="Chronological IMS feature rows. Batch mode is stateless and deterministic.",
    )

    @model_validator(mode="after")
    def validate_duplicates(self) -> "AnalyzeBatchRequest":
        keys = [(row.experiment, row.timestamp, row.sensor_channel) for row in self.rows]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate experiment/timestamp/sensor_channel rows are not allowed")
        return self


class ComponentScores(BaseModel):
    zScore: float
    isolationForest: float


class AnomalyResult(BaseModel):
    modelVersion: str
    experiment: str
    timestamp: str
    bearing: int
    anomalyScore: float
    riskScore: int
    riskLevel: Literal["NORMAL", "MONITOR", "HIGH", "CRITICAL"]
    rawAnomaly: bool
    persistentAlert: bool
    componentScores: ComponentScores
    reasonCodes: list[str]
    prototypeResult: bool


class AnalyzeResponse(BaseModel):
    results: list[AnomalyResult]


class ModelMetadata(BaseModel):
    id: str
    modelVersion: str
    artifactVersion: str
    selectedMethod: str
    sourceDataset: str
    validatedExperiments: list[str]
    validationScope: str
    generalizationStatus: str
    unsupportedGeneralizationTargets: list[str]
    featureOrder: list[str]
    requiredColumns: list[str]
    riskLevels: list[dict[str, str | int]]
    persistence: dict[str, object]
    aggregation: dict[str, object]
    runtimeLoadedWith: dict[str, str]
    artifactProducedWith: dict[str, str]
    warnings: list[str]


class ModelsResponse(BaseModel):
    models: list[ModelMetadata]
