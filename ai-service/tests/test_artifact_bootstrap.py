from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.artifact_bootstrap import (
    ArtifactBootstrapError,
    ArtifactTarget,
    _ensure_artifact,
    ensure_artifacts,
)


class _FakeResponse:
    def __init__(self, chunks: list[bytes], status_code: int = 200) -> None:
        self._chunks = chunks
        self.status_code = status_code

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def iter_content(self, chunk_size: int) -> list[bytes]:
        for chunk in self._chunks:
            yield chunk


class ArtifactBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(self._temp_dir())

    def tearDown(self) -> None:
        if self.tmp.exists():
            for child in self.tmp.glob("**/*"):
                if child.is_file():
                    child.unlink()
            for child in sorted(self.tmp.glob("**/*"), reverse=True):
                if child.is_dir():
                    child.rmdir()
            self.tmp.rmdir()

    @staticmethod
    def _temp_dir() -> str:
        import tempfile

        return tempfile.mkdtemp(prefix="ims-bootstrap-test-")

    def test_existing_local_artifact_is_preserved(self) -> None:
        target = ArtifactTarget(
            local_path=self.tmp / "model.joblib",
            bucket="models",
            object_path="ims/model.joblib",
        )
        target.local_path.write_bytes(b"already-here")

        with patch("app.services.artifact_bootstrap.requests.get") as get_mock:
            resolved = _ensure_artifact(
                target, supabase_url="x", service_key="y"
            )

        self.assertEqual(resolved, target.local_path)
        get_mock.assert_not_called()

    def test_missing_artifact_downloads_to_writable_fallback(self) -> None:
        import os

        original_env = {
            key: os.environ.get(key)
            for key in (
                "IMS_ANOMALY_ARTIFACT_PATH",
                "IMS_ANOMALY_METADATA_PATH",
                "IMS_ANOMALY_SUPABASE_URL",
                "IMS_ANOMALY_SUPABASE_SERVICE_KEY",
                "IMS_ANOMALY_ARTIFACT_BUCKET",
                "IMS_ANOMALY_ARTIFACT_OBJECT",
                "IMS_ANOMALY_METADATA_BUCKET",
                "IMS_ANOMALY_METADATA_OBJECT",
            )
        }
        # Force the writability probe to fall back to /tmp/ims-anomaly by
        # pointing the configured parent at a non-existent, non-writable
        # location on Windows or a path under /opt on POSIX.
        if os.name == "nt":
            bad_parent = Path("Z:/does-not-exist/ims-anomaly")
        else:
            bad_parent = Path("/opt/render/project/src/ims-anomaly")

        os.environ["IMS_ANOMALY_ARTIFACT_PATH"] = str(bad_parent / "model.joblib")
        os.environ["IMS_ANOMALY_METADATA_PATH"] = str(bad_parent / "model.json")
        os.environ["IMS_ANOMALY_SUPABASE_URL"] = "https://example.supabase.co"
        os.environ["IMS_ANOMALY_SUPABASE_SERVICE_KEY"] = "test-key"
        os.environ["IMS_ANOMALY_ARTIFACT_BUCKET"] = "models"
        os.environ["IMS_ANOMALY_ARTIFACT_OBJECT"] = "ims/model.joblib"
        os.environ["IMS_ANOMALY_METADATA_BUCKET"] = "models"
        os.environ["IMS_ANOMALY_METADATA_OBJECT"] = "ims/model.json"

        responses = iter(
            [
                _FakeResponse([b"x" * 128], status_code=200),
                _FakeResponse([b'{"a":1}'], status_code=200),
            ]
        )

        def fake_get(url: str, headers=None, stream=None, timeout=None):  # type: ignore[no-untyped-def]
            return next(responses)

        try:
            with patch("app.services.artifact_bootstrap.requests.get", side_effect=fake_get):
                resolved_artifact, resolved_metadata = ensure_artifacts(
                    artifact_path=bad_parent / "model.joblib",
                    metadata_path=bad_parent / "model.json",
                )
        finally:
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertTrue(resolved_artifact.exists())
        self.assertTrue(resolved_metadata.exists())
        self.assertIn("ims-anomaly", str(resolved_artifact).replace("\\", "/"))

    def test_missing_artifact_without_supabase_raises(self) -> None:
        target = ArtifactTarget(
            local_path=self.tmp / "model.joblib",
            bucket="models",
            object_path="ims/model.joblib",
        )
        with self.assertRaises(ArtifactBootstrapError):
            _ensure_artifact(target, supabase_url="", service_key="")

    def test_download_failure_raises(self) -> None:
        target = ArtifactTarget(
            local_path=self.tmp / "model.joblib",
            bucket="models",
            object_path="ims/model.joblib",
        )
        with patch(
            "app.services.artifact_bootstrap.requests.get",
            return_value=_FakeResponse([b""], status_code=403),
        ):
            with self.assertRaises(ArtifactBootstrapError):
                _ensure_artifact(target, supabase_url="https://x", service_key="y")


class ReadyEndpointTests(unittest.TestCase):
    def test_ready_endpoint_succeeds_when_artifact_loaded(self) -> None:
        from app.services.inference_service import InferenceService

        if not settings.artifact_path.is_file() or not settings.metadata_path.is_file():
            self.skipTest("Local IMS artifact not present; skipping integration test.")

        with TestClient(app) as client:
            response = client.get("/ready")
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["status"], "ready")
            self.assertEqual(payload["modelVersion"], "0.1.0")
            self.assertIsInstance(
                client.app.state.inference_service, InferenceService
            )


if __name__ == "__main__":
    unittest.main()
