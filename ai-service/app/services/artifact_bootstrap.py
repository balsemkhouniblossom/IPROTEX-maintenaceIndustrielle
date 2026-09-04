"""Runtime artifact bootstrap for the IMS anomaly inference service.

When running on ephemeral filesystems (e.g. Render free tier with no
persistent disk), the trained ``.joblib`` artifact and its ``.json``
metadata are not present on disk. This module downloads them from
Supabase Storage on first start so the service can boot without
requiring a persistent volume.

Behavior:
  * If both configured paths already exist, do nothing (local dev).
  * If either path is missing and Supabase is configured, download the
    missing file(s) to the configured local path (or ``/tmp/ims-anomaly``
    when the configured path lives under a non-writable directory on
    Render).
  * If the download fails or Supabase is not configured while files are
    missing, raise ``ArtifactBootstrapError`` so the process exits with a
    clear error.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import logging
import os
import shutil
import tempfile
from typing import Mapping
from urllib.parse import quote

import requests


logger = logging.getLogger("ims_anomaly_api.artifact_bootstrap")

_RENDER_FALLBACK_DIR = Path("/tmp/ims-anomaly")


class ArtifactBootstrapError(RuntimeError):
    """Raised when the IMS anomaly artifact cannot be made available."""


@dataclass(frozen=True)
class ArtifactTarget:
    local_path: Path
    bucket: str | None
    object_path: str | None

    @property
    def is_configured(self) -> bool:
        return bool(self.bucket) and bool(self.object_path)


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _target_from_env(
    *,
    path_env: str,
    bucket_env: str,
    object_env: str,
) -> ArtifactTarget:
    local_path = Path(_env(path_env) or "")
    return ArtifactTarget(
        local_path=local_path,
        bucket=_env(bucket_env) or None,
        object_path=_env(object_env) or None,
    )


def _resolve_target(target: ArtifactTarget) -> Path:
    """Return the writable local path where the artifact should live.

    On Render free tier the configured path can be under a non-writable
    directory (e.g. ``/opt/render/project/src/...``). In that case we
    fall back to ``/tmp/ims-anomaly`` so the file is still usable for
    the lifetime of the instance.
    """

    if not target.local_path:
        raise ArtifactBootstrapError("Configured artifact path is empty.")

    try:
        target.local_path.parent.mkdir(parents=True, exist_ok=True)
        # Probe writability without leaving a real file behind.
        with tempfile.NamedTemporaryFile(
            dir=str(target.local_path.parent), delete=True
        ):
            pass
        return target.local_path
    except OSError:
        _RENDER_FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
        return _RENDER_FALLBACK_DIR / target.local_path.name


def _download_to(url: str, destination: Path, *, headers: Mapping[str, str]) -> None:
    logger.info(
        "Downloading IMS anomaly artifact",
        extra={"url": url, "destination": str(destination)},
    )
    with requests.get(url, headers=headers, stream=True, timeout=60) as response:
        if response.status_code >= 400:
            raise ArtifactBootstrapError(
                f"Failed to download {url}: HTTP {response.status_code}."
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=str(destination.parent), delete=False, suffix=".part"
        ) as tmp:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if chunk:
                    tmp.write(chunk)
            tmp_path = Path(tmp.name)
        shutil.move(str(tmp_path), str(destination))
    if not destination.exists() or destination.stat().st_size == 0:
        raise ArtifactBootstrapError(f"Downloaded artifact is empty: {destination}.")


def _download_from_supabase(
    target: ArtifactTarget,
    *,
    supabase_url: str,
    service_key: str,
    destination: Path,
) -> None:
    if not target.is_configured:
        raise ArtifactBootstrapError(
            f"Missing Supabase object configuration for {target.local_path.name}."
        )
    base = supabase_url.rstrip("/")
    encoded_bucket = quote(target.bucket or "", safe="")
    encoded_object = quote(target.object_path or "", safe="/")
    url = f"{base}/storage/v1/object/{encoded_bucket}/{encoded_object}"
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    _download_to(url, destination, headers=headers)


def _ensure_artifact(
    target: ArtifactTarget,
    *,
    supabase_url: str,
    service_key: str,
) -> Path:
    if target.local_path.is_file() and target.local_path.stat().st_size > 0:
        logger.info(
            "IMS anomaly artifact already present locally",
            extra={"path": str(target.local_path)},
        )
        return target.local_path

    destination = _resolve_target(target)

    if destination.is_file() and destination.stat().st_size > 0:
        logger.info(
            "IMS anomaly artifact present at writable fallback path",
            extra={"path": str(destination)},
        )
        return destination

    if not supabase_url or not service_key:
        raise ArtifactBootstrapError(
            f"IMS anomaly artifact missing at {target.local_path} and "
            "IMS_ANOMALY_SUPABASE_URL / IMS_ANOMALY_SUPABASE_SERVICE_KEY "
            "are not configured."
        )

    try:
        _download_from_supabase(
            target,
            supabase_url=supabase_url,
            service_key=service_key,
            destination=destination,
        )
    except ArtifactBootstrapError:
        raise
    except requests.RequestException as exc:
        raise ArtifactBootstrapError(
            f"Failed to download IMS anomaly artifact {target.local_path.name}: {exc}"
        ) from exc

    logger.info(
        "IMS anomaly artifact ready",
        extra={"path": str(destination), "size_bytes": destination.stat().st_size},
    )
    return destination


def ensure_artifacts(
    *,
    artifact_path: Path,
    metadata_path: Path,
) -> tuple[Path, Path]:
    """Make sure both the artifact and metadata files are available.

    Returns the resolved (artifact_path, metadata_path) the service should
    use, which may differ from the configured values when the configured
    directory is not writable on the current host.
    """

    supabase_url = _env("IMS_ANOMALY_SUPABASE_URL")
    service_key = _env("IMS_ANOMALY_SUPABASE_SERVICE_KEY")

    artifact_target = _target_from_env(
        path_env="IMS_ANOMALY_ARTIFACT_PATH",
        bucket_env="IMS_ANOMALY_ARTIFACT_BUCKET",
        object_env="IMS_ANOMALY_ARTIFACT_OBJECT",
    )
    metadata_target = _target_from_env(
        path_env="IMS_ANOMALY_METADATA_PATH",
        bucket_env="IMS_ANOMALY_METADATA_BUCKET",
        object_env="IMS_ANOMALY_METADATA_OBJECT",
    )

    # Allow callers to pass already-resolved Path objects (e.g. from
    # ``Settings``) by syncing the env-derived targets with the supplied
    # values when the env vars are not explicitly set.
    if not _env("IMS_ANOMALY_ARTIFACT_PATH"):
        artifact_target = ArtifactTarget(
            local_path=artifact_path,
            bucket=artifact_target.bucket,
            object_path=artifact_target.object_path,
        )
    if not _env("IMS_ANOMALY_METADATA_PATH"):
        metadata_target = ArtifactTarget(
            local_path=metadata_path,
            bucket=metadata_target.bucket,
            object_path=metadata_target.object_path,
        )

    resolved_artifact = _ensure_artifact(
        artifact_target, supabase_url=supabase_url, service_key=service_key
    )
    resolved_metadata = _ensure_artifact(
        metadata_target, supabase_url=supabase_url, service_key=service_key
    )
    return resolved_artifact, resolved_metadata
