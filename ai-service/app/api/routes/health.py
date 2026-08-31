from __future__ import annotations

from fastapi import APIRouter, Request


router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness probe", description="Returns process liveness for the AI service.")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Readiness probe", description="Returns readiness after the IMS v0.1.0 artifact is loaded.")
def ready(request: Request) -> dict[str, str]:
    service = request.app.state.inference_service
    return {"status": "ready" if service.ready else "not_ready", "modelVersion": service.pipeline.version}
