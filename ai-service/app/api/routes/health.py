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
            "model": "/v1/models/ims-selected-anomaly-model-v0-1-0",
            "analyze": "/v1/anomaly/analyze",
            "analyzeBatch": "/v1/anomaly/analyze-batch",
        },
        "notes": (
            "Serves the IMS v0.1.0 anomaly-inference artifact. "
            "The API never trains, refits, or rewrites the model. "
            "Current validation covers only IMS 1st_test."
        ),
    }


@router.get("/health", summary="Liveness probe", description="Returns process liveness for the AI service.")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Readiness probe", description="Returns readiness after the IMS v0.1.0 artifact is loaded.")
def ready(request: Request) -> dict[str, str]:
    service = request.app.state.inference_service
    return {"status": "ready" if service.ready else "not_ready", "modelVersion": service.pipeline.version}
