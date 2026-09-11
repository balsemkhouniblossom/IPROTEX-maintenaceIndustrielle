"""FastAPI routes for CWRU bearing fault diagnosis."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException, Request

from app.schemas.diagnosis import (
    DiagnosisAnalyzeRequest,
    DiagnosisAnalyzeResponse,
    DiagnosisClassProbability,
    DiagnosisReplayCatalog,
    DiagnosisSample,
)
from src.inference.cwru_diagnosis_inference import CwruDiagnosisError, diagnose, extract_window_features

MODEL_DIR = Path(__file__).resolve().parents[3] / "artifacts" / "models"
CWRU_DIR = Path(__file__).resolve().parents[4] / "data" / "raw" / "cwru"

CONFIDENCE_THRESHOLD = 0.70

DISPLAY_LABELS = {
    "NORMAL": "Normal",
    "INNER_RACE": "Inner Race Fault",
    "OUTER_RACE": "Outer Race Fault",
    "BALL": "Ball / Rolling Element Fault",
    "UNCERTAIN": "Uncertain",
}

RECOMMENDATIONS = {
    "NORMAL": "No bearing fault pattern was identified among the model's supported classes.",
    "INNER_RACE": "Inspect inner-race condition and related bearing assembly.",
    "OUTER_RACE": "Inspect outer-race condition, mounting and lubrication.",
    "BALL": "Inspect rolling elements, lubrication and bearing condition.",
    "UNCERTAIN": "Further inspection or additional vibration measurement recommended.",
}

CWRU_FILE_MAP = {
    "97.mat":  ("NORMAL", 0, "normal", 0),
    "98.mat":  ("NORMAL", 0, "normal", 0),
    "105.mat": ("INNER_RACE", 0, "inner_race", 7),
    "106.mat": ("INNER_RACE", 1, "inner_race", 7),
    "107.mat": ("INNER_RACE", 2, "inner_race", 7),
    "108.mat": ("INNER_RACE", 3, "inner_race", 7),
    "118.mat": ("BALL", 0, "ball", 7),
    "119.mat": ("BALL", 1, "ball", 7),
    "120.mat": ("BALL", 2, "ball", 7),
    "121.mat": ("BALL", 3, "ball", 7),
    "130.mat": ("OUTER_RACE", 0, "outer_race", 7),
    "131.mat": ("OUTER_RACE", 1, "outer_race", 7),
    "132.mat": ("OUTER_RACE", 2, "outer_race", 7),
    "133.mat": ("OUTER_RACE", 3, "outer_race", 7),
}

MODEL_ID = "cwru_bearing_diagnosis_v0_1_0"
ARTIFACT_PATH = MODEL_DIR / "cwru_bearing_diagnosis_model_v0_1_0.joblib"


def _load_artifact():
    if not ARTIFACT_PATH.exists():
        raise HTTPException(status_code=503, detail="CWRU diagnosis artifact not found")
    return joblib.load(ARTIFACT_PATH)


def _build_catalog() -> list[DiagnosisSample]:
    samples = []
    for fname, (cls_name, load_hp, fault_type, dia_mil) in sorted(CWRU_FILE_MAP.items()):
        mat_path = CWRU_DIR / fname
        if not mat_path.exists():
            continue
        try:
            from scipy.io import loadmat
            mat = loadmat(mat_path, squeeze_me=True)
            keys = [k for k in mat.keys() if not k.startswith("__")]
            de_key = [k for k in keys if "DE_time" in k][0]
            n_samples = len(mat[de_key])
        except Exception:
            n_samples = 0
        window_size = 2048
        n_windows = n_samples // window_size
        samples.append(DiagnosisSample(
            sample_id=fname.replace(".mat", ""),
            recording_id=fname.replace(".mat", ""),
            class_name=cls_name,
            load_hp=load_hp,
            fault_type=fault_type,
            diameter_mil=dia_mil,
            n_windows=n_windows,
            window_size=window_size,
            sampling_rate_hz=12000,
        ))
    return samples


router = APIRouter(prefix="/v1/diagnosis", tags=["diagnosis"])


@router.get("/catalog", response_model=DiagnosisReplayCatalog, summary="CWRU replay catalog")
def get_catalog() -> DiagnosisReplayCatalog:
    return DiagnosisReplayCatalog(
        dataset="CWRU Bearing Dataset",
        task="Fault Diagnosis",
        model="CWRU Bearing Fault Diagnosis",
        model_version="0.1.0",
        samples=_build_catalog(),
    )


@router.post("/analyze", response_model=DiagnosisAnalyzeResponse, summary="Run fault diagnosis")
async def analyze(request: Request, body: DiagnosisAnalyzeRequest) -> DiagnosisAnalyzeResponse:
    # Check model enabled state
    diag_state = getattr(request.app.state, "cwru_diagnosis_enabled", True)
    if not diag_state:
        raise HTTPException(status_code=409, detail="CWRU diagnosis model is disabled")

    t0 = time.time()
    try:
        artifact = _load_artifact()
        signal = np.array(body.signal, dtype=float)
        result = diagnose(artifact, signal, confidence_threshold=CONFIDENCE_THRESHOLD)
    except CwruDiagnosisError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Diagnosis failed: {exc}")

    elapsed_ms = (time.time() - t0) * 1000

    class_probs = [
        DiagnosisClassProbability(class_name=k, probability=v)
        for k, v in result.class_probabilities.items()
    ]

    if result.is_uncertain:
        predicted = "UNCERTAIN"
        display = DISPLAY_LABELS["UNCERTAIN"]
    else:
        predicted = result.predicted_class
        display = DISPLAY_LABELS.get(result.predicted_class, result.predicted_class)

    return DiagnosisAnalyzeResponse(
        model_id=MODEL_ID,
        model_version=result.model_version,
        task="FAULT_DIAGNOSIS",
        dataset="CWRU",
        predicted_class=predicted,
        display_label=display,
        confidence=result.confidence,
        class_probabilities=class_probs,
        uncertain=result.is_uncertain,
        input_source=body.source,
        feature_contract=result.feature_contract,
        execution_duration_ms=elapsed_ms,
        limitations=[
            "CWRU dataset only - not validated on IPROTEX machinery",
            "0.007 inch fault diameter only",
            "12 kHz Drive-End sensor",
            "Outer-race faults limited to 6:00 load-zone position",
            "No fault severity classification",
            "Diagnosis confidence is NOT probability of failure",
        ],
    )


@router.post("/enable", summary="Enable CWRU diagnosis")
def enable_diagnosis(request: Request):
    request.app.state.cwru_diagnosis_enabled = True
    return {"model_id": MODEL_ID, "enabled": True}


@router.post("/disable", summary="Disable CWRU diagnosis")
def disable_diagnosis(request: Request):
    request.app.state.cwru_diagnosis_enabled = False
    return {"model_id": MODEL_ID, "enabled": False}


@router.get("/status", summary="CWRU diagnosis model status")
def diagnosis_status(request: Request):
    artifact_exists = ARTIFACT_PATH.exists()
    enabled = getattr(request.app.state, "cwru_diagnosis_enabled", True)
    return {
        "model_id": MODEL_ID,
        "version": "0.1.0",
        "task": "FAULT_DIAGNOSIS",
        "dataset": "CWRU",
        "artifact_loaded": artifact_exists,
        "enabled": enabled,
        "running": False,
    }