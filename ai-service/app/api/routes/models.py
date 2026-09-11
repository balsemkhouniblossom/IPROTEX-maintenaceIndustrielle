from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.schemas.anomaly import ModelsResponse

MODEL_DIR = Path(__file__).resolve().parents[3] / "artifacts" / "models"
CWRU_METADATA_PATH = MODEL_DIR / "cwru_bearing_diagnosis_model_v0_1_0.json"


def _cwru_metadata() -> dict:
    import json
    if not CWRU_METADATA_PATH.exists():
        return {}
    return json.loads(CWRU_METADATA_PATH.read_text(encoding="utf-8"))


router = APIRouter(prefix="/v1/models", tags=["models"])


@router.get(
    "",
    response_model=ModelsResponse,
    summary="List served models",
    description="Returns versioned IMS artifact metadata, validation scope, runtime versions, and known limitations.",
)
def list_models(request: Request) -> ModelsResponse:
    models = [request.app.state.inference_service.metadata()]
    cwru = _cwru_metadata()
    if cwru:
        models.append({
            "id": cwru.get("model_id", "cwru_bearing_diagnosis_v0_1_0"),
            "name": "CWRU Bearing Fault Diagnosis",
            "version": cwru.get("version", "0.1.0"),
            "task": cwru.get("task", "FAULT_DIAGNOSIS"),
            "dataset": cwru.get("dataset", "CWRU"),
            "algorithm": cwru.get("algorithm", "RandomForestClassifier"),
            "loaded": True,
            "enabled": getattr(request.app.state, "cwru_diagnosis_enabled", True),
            "running": False,
            "input_contract": "cwru_diagnosis_features_v1",
            "feature_contract": "cwru_diagnosis_features_v1",
            "supported_classes": cwru.get("classes", []),
            "validation_verdict": "READY FOR DATASET DEMONSTRATION",
            "limitations": cwru.get("limitations", []),
        })
    return ModelsResponse(models=models)


def get_service(request: Request, model_id: str):
    service = request.app.state.inference_service
    if service.metadata()["id"] != model_id:
        raise HTTPException(status_code=404, detail="Model not found")
    return service


@router.get("/{model_id}", summary="Get served model runtime status")
def get_model(model_id: str, request: Request):
    if model_id == "cwru_bearing_diagnosis_v0_1_0":
        cwru = _cwru_metadata()
        if not cwru:
            raise HTTPException(status_code=404, detail="CWRU model not found")
        cwru["enabled"] = getattr(request.app.state, "cwru_diagnosis_enabled", True)
        cwru["running"] = False
        return cwru
    return get_service(request, model_id).metadata()


@router.post("/{model_id}/start", summary="Enable the model for new inference")
def start_model(model_id: str, request: Request):
    if model_id == "cwru_bearing_diagnosis_v0_1_0":
        request.app.state.cwru_diagnosis_enabled = True
        return {"model_id": model_id, "enabled": True}
    return get_service(request, model_id).start()


@router.post("/{model_id}/stop", summary="Disable new inference without interrupting active inference")
def stop_model(model_id: str, request: Request):
    if model_id == "cwru_bearing_diagnosis_v0_1_0":
        request.app.state.cwru_diagnosis_enabled = False
        return {"model_id": model_id, "enabled": False}
    return get_service(request, model_id).stop()
