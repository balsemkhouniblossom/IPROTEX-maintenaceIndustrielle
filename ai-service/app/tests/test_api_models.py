from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_model_metadata_exposes_validation_scope_and_runtime_versions(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    with TestClient(app, headers={"x-ai-service-token": "test-service-token"}) as client:
        response = client.get("/v1/models")

    assert response.status_code == 200
    payload = response.json()
    model = payload["models"][0]
    assert model["modelVersion"] == "0.1.0"
    assert model["sourceDataset"] == "IMS public bearing test-rig data"
    assert model["validatedExperiments"] == ["1st_test"]
    assert "only" in model["validationScope"].lower()
    assert "2nd_test" in model["unsupportedGeneralizationTargets"]
    assert "3rd_test" in model["unsupportedGeneralizationTargets"]
    assert "IPROTEX" in model["unsupportedGeneralizationTargets"]
    assert model["runtimeLoadedWith"]["python"]
    assert model["runtimeLoadedWith"]["numpy"]
    assert model["runtimeLoadedWith"]["scikitLearn"]
    assert model["runtimeLoadedWith"]["joblib"]
    assert model["artifactProducedWith"]["scikitLearn"] == "1.9.0 recorded by pickle warning"
    assert any("joblib" in warning.lower() for warning in model["warnings"])


def test_model_can_be_stopped_and_started_without_unloading_artifact(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    headers = {"x-ai-service-token": "test-service-token"}
    with TestClient(app, headers=headers) as client:
        model_id = client.get("/v1/models").json()["models"][0]["id"]
        stopped = client.post(f"/v1/models/{model_id}/stop")
        stopped_model = stopped.json()
        assert stopped.status_code == 200
        assert stopped_model["loaded"] is True
        assert stopped_model["enabled"] is False
        assert stopped_model["status"] == "STOPPED"

        started = client.post(f"/v1/models/{model_id}/start")
        assert started.status_code == 200
        assert started.json()["enabled"] is True
        assert started.json()["status"] == "ACTIVE"


def test_unknown_model_lifecycle_action_returns_not_found(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    with TestClient(app, headers={"x-ai-service-token": "test-service-token"}) as client:
        response = client.post("/v1/models/not-a-model/stop")
    assert response.status_code == 404
