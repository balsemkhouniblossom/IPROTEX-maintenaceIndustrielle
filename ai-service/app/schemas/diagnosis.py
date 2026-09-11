"""Pydantic schemas for CWRU bearing fault diagnosis."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DiagnosisClassProbability(BaseModel):
    class_name: str = Field(..., description="Supported bearing condition class")
    probability: float = Field(..., ge=0.0, le=1.0, description="Class probability")


class DiagnosisAnalyzeRequest(BaseModel):
    signal: list[float] = Field(..., min_length=1024, max_length=65536,
                                description="Raw vibration signal samples")
    sampling_rate_hz: int = Field(default=12000, description="Sampling rate in Hz")
    source: str = Field(default="cwru_dataset_replay", description="Provenance source")
    recording_id: str | None = Field(default=None, description="CWRU recording identifier")


class DiagnosisAnalyzeResponse(BaseModel):
    model_id: str
    model_version: str
    task: str = "FAULT_DIAGNOSIS"
    dataset: str = "CWRU"
    predicted_class: str
    display_label: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    class_probabilities: list[DiagnosisClassProbability]
    uncertain: bool
    input_source: str
    feature_contract: str
    execution_duration_ms: float
    limitations: list[str]


class DiagnosisSample(BaseModel):
    sample_id: str
    recording_id: str
    class_name: str
    load_hp: int
    fault_type: str
    diameter_mil: int
    n_windows: int
    window_size: int
    sampling_rate_hz: int


class DiagnosisReplayCatalog(BaseModel):
    dataset: str
    task: str
    model: str
    model_version: str
    samples: list[DiagnosisSample]
    mode: str = "Dataset Replay"
    source: str = "CWRU Bearing Data Center"