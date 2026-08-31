from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


ROOT_DIR = Path(__file__).resolve().parents[2]


def _csv_env(name: str, default: str = "") -> list[str]:
    value = os.getenv(name, default)
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass
class Settings:
    app_name: str = "IPROTEX IMS Anomaly Inference API"
    api_version: str = "v1"
    environment: str = os.getenv("AI_SERVICE_ENV", "development").lower()
    artifact_path: Path = Path(
        os.getenv(
            "IMS_ANOMALY_ARTIFACT_PATH",
            str(ROOT_DIR / "artifacts" / "models" / "ims_selected_anomaly_model_v0_1_0.joblib"),
        )
    )
    metadata_path: Path = Path(
        os.getenv(
            "IMS_ANOMALY_METADATA_PATH",
            str(ROOT_DIR / "artifacts" / "models" / "ims_selected_anomaly_model_v0_1_0.json"),
        )
    )
    cors_origins: tuple[str, ...] = tuple(_csv_env("AI_SERVICE_CORS_ORIGINS", "http://localhost:3000"))
    max_request_bytes: int = int(os.getenv("AI_SERVICE_MAX_REQUEST_BYTES", "1048576"))
    max_batch_rows: int = int(os.getenv("AI_SERVICE_MAX_BATCH_ROWS", "512"))

    def validate(self) -> None:
        if self.environment == "production" and "*" in self.cors_origins:
            raise ValueError("AI_SERVICE_CORS_ORIGINS cannot contain '*' in production.")
        if self.max_request_bytes <= 0:
            raise ValueError("AI_SERVICE_MAX_REQUEST_BYTES must be positive.")
        if self.max_batch_rows <= 0:
            raise ValueError("AI_SERVICE_MAX_BATCH_ROWS must be positive.")


settings = Settings()
settings.validate()
