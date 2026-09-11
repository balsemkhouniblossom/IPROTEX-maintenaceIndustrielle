from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

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


def get_service(request: Request, model_id: str):
    service = request.app.state.inference_service
    if service.metadata()["id"] != model_id:
        raise HTTPException(status_code=404, detail="Model not found")
    return service


@router.get("/{model_id}", summary="Get served model runtime status")
def get_model(model_id: str, request: Request):
    return get_service(request, model_id).metadata()


@router.post("/{model_id}/start", summary="Enable the model for new inference")
def start_model(model_id: str, request: Request):
    return get_service(request, model_id).start()


@router.post("/{model_id}/stop", summary="Disable new inference without interrupting active inference")
def stop_model(model_id: str, request: Request):
    return get_service(request, model_id).stop()
