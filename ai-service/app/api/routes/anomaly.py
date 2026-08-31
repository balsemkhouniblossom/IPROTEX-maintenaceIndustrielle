from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.config import settings
from app.schemas.anomaly import AnalyzeBatchRequest, AnalyzeRequest, AnalyzeResponse


router = APIRouter(prefix="/v1/anomaly", tags=["anomaly"])


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Analyze one IMS timestamp",
    description=(
        "Stateful streaming inference for exactly one timestamp. The saved v0.1.0 artifact is used as-is; "
        "no training or model mutation occurs during the request."
    ),
)
def analyze(payload: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    if len(payload.rows) > settings.max_batch_rows:
        raise ValueError(f"Request exceeds maximum row limit of {settings.max_batch_rows}.")
    results = request.app.state.inference_service.analyze(payload.rows)
    return AnalyzeResponse(results=results)


@router.post(
    "/analyze-batch",
    response_model=AnalyzeResponse,
    summary="Analyze a chronological IMS batch",
    description=(
        "Stateless deterministic replay for chronological IMS feature rows. Batch requests do not update "
        "streaming persistence state."
    ),
)
def analyze_batch(payload: AnalyzeBatchRequest, request: Request) -> AnalyzeResponse:
    if len(payload.rows) > settings.max_batch_rows:
        raise ValueError(f"Request exceeds maximum row limit of {settings.max_batch_rows}.")
    results = request.app.state.inference_service.analyze_batch(payload.rows)
    return AnalyzeResponse(results=results)
