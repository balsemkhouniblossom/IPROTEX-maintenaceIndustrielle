from __future__ import annotations

from pathlib import Path
import json
import logging
from functools import lru_cache

import joblib

from fastapi import APIRouter, HTTPException, Request

from app.schemas.anomaly import ModelsResponse

MODEL_DIR = Path(__file__).resolve().parents[3] / "artifacts" / "models"
CWRU_METADATA_PATH = MODEL_DIR / "cwru_bearing_diagnosis_model_v0_1_0.json"


logger = logging.getLogger("ims_anomaly_api.models")
CWRU_ARTIFACT_PATH = MODEL_DIR / "cwru_bearing_diagnosis_model_v0_1_0.joblib"


def _cwru_metadata() -> dict:
    if not CWRU_METADATA_PATH.exists():
        return {}
    return json.loads(CWRU_METADATA_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_cwru_artifact():
    """Load and validate CWRU once; file existence alone is not readiness."""
    if not CWRU_ARTIFACT_PATH.is_file():
        raise FileNotFoundError("CWRU diagnosis artifact is unavailable")
    artifact = joblib.load(CWRU_ARTIFACT_PATH)
    required_keys = {"classifier", "scaler", "feature_order", "class_names"}
    if not isinstance(artifact, dict) or not required_keys.issubset(artifact):
        raise ValueError("CWRU diagnosis artifact has an incompatible contract")
    return artifact


def cwru_descriptor(request: Request) -> dict | None:
    metadata = _cwru_metadata()
    if not metadata:
        return None
    try:
        load_cwru_artifact()
        loaded = True
        last_error = None
    except Exception:  # details are logged internally, never returned
        logger.exception("CWRU diagnosis artifact failed readiness validation")
        loaded = False
        last_error = "MODEL_ARTIFACT_ERROR"
    enabled = bool(getattr(request.app.state, "cwru_diagnosis_enabled", True)) and loaded
    return {
        "id": metadata.get("model_id", "cwru_bearing_diagnosis_v0_1_0"),
        "name": "Experimental Bearing Fault Diagnosis",
        "modelVersion": str(metadata.get("version", "0.1.0")),
        "artifactVersion": str(metadata.get("version", "0.1.0")),
        "task": "FAULT_DIAGNOSIS",
        "purpose": "Classify supported CWRU bearing-condition patterns from dataset vibration windows.",
        "framework": "scikit-learn RandomForestClassifier",
        "sourceDataset": "CWRU Bearing Data Center benchmark",
        "validationScope": str(metadata.get("validation_protocol", "CWRU benchmark only")),
        "generalizationStatus": "Not validated on IPROTEX machinery.",
        "loaded": loaded,
        "enabled": enabled,
        "running": False,
        "status": "ACTIVE" if enabled else ("STOPPED" if loaded else "ERROR"),
        "activeExecutions": 0,
        "lastError": last_error,
        "validationMetrics": {
            "groupedCrossValidation": metadata.get("grouped_cv_metrics", {}),
            "crossLoad": metadata.get("cross_load_metrics", {}),
        },
        "acceptedForAdvisoryPilot": False,
        "knownLimitations": metadata.get("limitations", []),
        "lifecyclePersistence": "PROCESS_LOCAL",
        "taskMetadata": {
            "algorithm": metadata.get("algorithm", "RandomForestClassifier"),
            "supportedClasses": metadata.get("classes", []),
            "featureContract": metadata.get("feature_contract", "cwru_diagnosis_features_v1"),
            "confidenceMeaning": "Classifier confidence within supported benchmark classes; not failure probability.",
        },
    }


router = APIRouter(prefix="/v1/models", tags=["models"])


@router.get(
    "",
    response_model=ModelsResponse,
    summary="List served models",
    description="Returns versioned IMS artifact metadata, validation scope, runtime versions, and known limitations.",
)
def list_models(request: Request) -> ModelsResponse:
    models = [request.app.state.inference_service.metadata()]
    cwru = cwru_descriptor(request)
    if cwru:
        models.append(cwru)
    return ModelsResponse(models=models)


def get_service(request: Request, model_id: str):
    service = request.app.state.inference_service
    if service.metadata()["id"] != model_id:
        raise HTTPException(status_code=404, detail="Model not found")
    return service


@router.get("/{model_id}", summary="Get served model runtime status")
def get_model(model_id: str, request: Request):
    if model_id == "cwru_bearing_diagnosis_v0_1_0":
        cwru = cwru_descriptor(request)
        if not cwru:
            raise HTTPException(status_code=404, detail="CWRU model not found")
        return cwru
    return get_service(request, model_id).metadata()


@router.post("/{model_id}/start", summary="Enable the model for new inference")
def start_model(model_id: str, request: Request):
    if model_id == "cwru_bearing_diagnosis_v0_1_0":
        load_cwru_artifact()
        request.app.state.cwru_diagnosis_enabled = True
        return cwru_descriptor(request)
    return get_service(request, model_id).start()


@router.post("/{model_id}/stop", summary="Disable new inference without interrupting active inference")
def stop_model(model_id: str, request: Request):
    if model_id == "cwru_bearing_diagnosis_v0_1_0":
        request.app.state.cwru_diagnosis_enabled = False
        return cwru_descriptor(request)
    return get_service(request, model_id).stop()
