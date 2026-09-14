from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.config import settings


router = APIRouter(tags=["health"])


@router.get(
    "/",
    summary="Service info",
    description="Returns a small service-info payload describing the AI service and pointing to the available endpoints.",
)
def index(request: Request) -> dict[str, object]:
    ready = False
    model_version: str | None = None
    inference = getattr(request.app.state, "inference_service", None)
    if inference is not None:
        try:
            ready = bool(inference.ready)
            model_version = str(inference.pipeline.version)
        except Exception:  # noqa: BLE001 - never let the index page break the process
            ready = False
            model_version = None

    model_id = "ims-selected-anomaly-model"
    validation_scope = "the configured IMS research artifact"
    if inference is not None:
        try:
            metadata = inference.metadata()
            model_id = str(metadata.get("id", model_id))
            validation_scope = str(metadata.get("validationScope", validation_scope))
        except Exception:  # noqa: BLE001 - service info must remain available
            pass

    return {
        "service": settings.app_name,
        "apiVersion": settings.api_version,
        "environment": settings.environment,
        "modelVersion": model_version,
        "ready": ready,
        "endpoints": {
            "health": "/health",
            "ready": "/ready",
            "docs": "/docs",
            "openapi": "/openapi.json",
            "models": "/v1/models",
            "model": f"/v1/models/{model_id}",
            "analyze": "/v1/anomaly/analyze",
            "analyzeBatch": "/v1/anomaly/analyze-batch",
        },
        "notes": (
            "Serves the configured IMS anomaly artifact and any valid optional diagnosis artifact. "
            "The API never trains, refits, or rewrites the model. "
            f"IMS validation scope: {validation_scope}."
        ),
    }


@router.get("/health", summary="Liveness probe", description="Returns process liveness for the AI service.")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Readiness probe", description="Returns readiness after configured model artifacts are validated.")
def ready(request: Request) -> dict[str, str]:
    service = request.app.state.inference_service
    from app.api.routes.models import CWRU_METADATA_PATH, load_cwru_artifact

    diagnosis_ready = True
    if CWRU_METADATA_PATH.is_file():
        try:
            load_cwru_artifact()
        except Exception:
            diagnosis_ready = False
    ready_state = service.ready and diagnosis_ready
    return {
        "status": "ready" if ready_state else "not_ready",
        "modelVersion": service.pipeline.version,
        "diagnosisStatus": "ready" if diagnosis_ready else "artifact_error",
    }
