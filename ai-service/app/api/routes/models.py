from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.anomaly import ModelsResponse


router = APIRouter(prefix="/v1/models", tags=["models"])


@router.get(
    "",
    response_model=ModelsResponse,
    summary="List served models",
    description="Returns IMS v0.1.0 artifact metadata, validation scope, runtime versions, and known limitations.",
)
def list_models(request: Request) -> ModelsResponse:
    return ModelsResponse(models=[request.app.state.inference_service.metadata()])
