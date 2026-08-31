from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import anomaly, health, models
from app.core.config import settings
from app.services.inference_service import InferenceService
from src.inference.ims_anomaly_inference import ImsInferenceError


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("ims_anomaly_api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.inference_service = InferenceService(settings.artifact_path, settings.metadata_path)
    yield


def error_payload(code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}}


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    summary="Deterministic serving API for the validated IMS anomaly inference prototype.",
    description=(
        "Serves the existing IMS v0.1.0 anomaly-inference artifact through versioned JSON endpoints. "
        "The API never trains, refits, or rewrites the model. Current validation covers only IMS 1st_test; "
        "generalization to 2nd_test, 3rd_test, or IPROTEX factory data is not established."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def request_size_limit(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings.max_request_bytes:
        return JSONResponse(
            status_code=413,
            content=error_payload("REQUEST_TOO_LARGE", f"Request body exceeds {settings.max_request_bytes} bytes."),
        )
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_payload("INVALID_REQUEST", "Request schema validation failed."),
        headers={"X-Validation-Error-Count": str(len(exc.errors()))},
    )


@app.exception_handler(ImsInferenceError)
async def inference_error_handler(_: Request, exc: ImsInferenceError) -> JSONResponse:
    logger.info("IMS inference request rejected: %s", exc)
    return JSONResponse(status_code=400, content=error_payload("INVALID_INFERENCE_INPUT", str(exc)))


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    logger.info("API request rejected: %s", exc)
    return JSONResponse(status_code=400, content=error_payload("INVALID_REQUEST", str(exc)))


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled AI service error")
    return JSONResponse(
        status_code=500,
        content=error_payload("INTERNAL_ERROR", "An internal AI service error occurred."),
    )


app.include_router(health.router)
app.include_router(models.router)
app.include_router(anomaly.router)
