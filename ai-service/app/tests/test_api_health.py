from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_health_and_readiness() -> None:
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        ready = client.get("/ready")
        assert ready.status_code == 200
        assert ready.json() == {"status": "ready", "modelVersion": "0.1.0"}
