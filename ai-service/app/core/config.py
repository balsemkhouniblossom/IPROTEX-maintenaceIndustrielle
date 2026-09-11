from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


ROOT_DIR = Path(__file__).resolve().parents[2]
SUPPORTED_MODEL_VERSIONS = {"0.1.0", "0.2.0"}


def _model_file(version: str, extension: str) -> Path:
    semantic_version = version.strip().lower().removeprefix("v")
    if semantic_version not in SUPPORTED_MODEL_VERSIONS:
        raise ValueError(
            f"Unsupported ANOMALY_MODEL_VERSION {version!r}; expected one of "
            f"{sorted(SUPPORTED_MODEL_VERSIONS)}."
        )
    if extension not in {"joblib", "json"}:
        raise ValueError("Model extension must be 'joblib' or 'json'.")
    normalized = semantic_version.replace(".", "_")
    return ROOT_DIR / "artifacts" / "models" / f"ims_selected_anomaly_model_v{normalized}.{extension}"


def _csv_env(name: str, default: str = "") -> list[str]:
    value = os.getenv(name, default)
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass
class Settings:
    app_name: str = "IPROTEX IMS Anomaly Inference API"
    api_version: str = "v1"
    environment: str = os.getenv("AI_SERVICE_ENV", "development").lower()
    model_version: str = os.getenv("ANOMALY_MODEL_VERSION", "0.1.0")
    artifact_path: Path = Path(
        os.getenv(
            "IMS_ANOMALY_ARTIFACT_PATH",
            str(_model_file(os.getenv("ANOMALY_MODEL_VERSION", "0.1.0"), "joblib")),
        )
    )
    metadata_path: Path = Path(
        os.getenv(
            "IMS_ANOMALY_METADATA_PATH",
            str(_model_file(os.getenv("ANOMALY_MODEL_VERSION", "0.1.0"), "json")),
        )
    )
    dataset_features_path: Path = Path(
        os.getenv(
            "IMS_FEATURES_PATH",
            str(ROOT_DIR / "app" / "data" / "ims_replay_samples_v0_1_0.json"),
        )
    )
    cors_origins: tuple[str, ...] = tuple(_csv_env("AI_SERVICE_CORS_ORIGINS", "http://localhost:3000"))
    max_request_bytes: int = int(os.getenv("AI_SERVICE_MAX_REQUEST_BYTES", "1048576"))
    max_batch_rows: int = int(os.getenv("AI_SERVICE_MAX_BATCH_ROWS", "512"))
    service_token: str = os.getenv("AI_SERVICE_TOKEN", "").strip()

    def validate(self) -> None:
        if self.model_version.strip().lower().removeprefix("v") not in SUPPORTED_MODEL_VERSIONS:
            raise ValueError("ANOMALY_MODEL_VERSION must select a supported immutable artifact.")
        if self.environment == "production" and "*" in self.cors_origins:
            raise ValueError("AI_SERVICE_CORS_ORIGINS cannot contain '*' in production.")
        if self.max_request_bytes <= 0:
            raise ValueError("AI_SERVICE_MAX_REQUEST_BYTES must be positive.")
        if self.max_batch_rows <= 0:
            raise ValueError("AI_SERVICE_MAX_BATCH_ROWS must be positive.")
        if self.environment == "production" and len(self.service_token) < 32:
            raise ValueError("AI_SERVICE_TOKEN must contain at least 32 characters in production.")


settings = Settings()
settings.validate()
