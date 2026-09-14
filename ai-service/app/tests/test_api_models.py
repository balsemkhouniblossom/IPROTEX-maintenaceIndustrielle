from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Event

from fastapi.testclient import TestClient

from app.main import app


def test_model_metadata_exposes_validation_scope_and_runtime_versions(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    with TestClient(app, headers={"x-ai-service-token": "test-service-token"}) as client:
        response = client.get("/v1/models")

    assert response.status_code == 200
    model = response.json()["models"][0]
    assert model["modelVersion"] == "0.1.0"
    assert model["task"] == "ANOMALY_DETECTION"
    assert model["sourceDataset"] == "IMS public bearing test-rig data"
    assert model["taskMetadata"]["validatedExperiments"] == ["1st_test"]
    assert model["taskMetadata"]["featureOrder"]
    assert "only" in model["validationScope"].lower()
    assert model["validationMetrics"]["mean_precision"] > 0
    assert model["validationMetrics"]["mean_pr_auc"] > 0


def test_registry_returns_ims_and_cwru_with_polymorphic_metadata(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    with TestClient(app, headers={"x-ai-service-token": "test-service-token"}) as client:
        response = client.get("/v1/models")

    assert response.status_code == 200
    by_task = {model["task"]: model for model in response.json()["models"]}
    assert set(by_task) == {"ANOMALY_DETECTION", "FAULT_DIAGNOSIS"}
    assert by_task["ANOMALY_DETECTION"]["taskMetadata"]["persistence"]
    diagnosis = by_task["FAULT_DIAGNOSIS"]
    assert diagnosis["loaded"] is True
    assert diagnosis["acceptedForAdvisoryPilot"] is False
    assert "not validated on iprotex" in diagnosis["generalizationStatus"].lower()
    assert diagnosis["taskMetadata"]["confidenceMeaning"]

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


def test_stopping_does_not_interrupt_an_active_execution(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    entered = Event()
    release = Event()

    with TestClient(app, headers={"x-ai-service-token": "test-service-token"}) as client:
        service = app.state.inference_service

        def slow_analysis(_stream_id, _rows):
            entered.set()
            assert release.wait(timeout=5)
            return []

        monkeypatch.setattr(service, "_analyze", slow_analysis)
        model_id = service.metadata()["id"]

        with ThreadPoolExecutor(max_workers=1) as executor:
            running = executor.submit(service.analyze, "in-flight", [])
            assert entered.wait(timeout=5)

            stopping = client.post(f"/v1/models/{model_id}/stop").json()
            assert stopping["enabled"] is False
            assert stopping["running"] is True
            assert stopping["status"] == "RUNNING"

            try:
                service.analyze("blocked", [])
            except RuntimeError as exc:
                assert str(exc) == "MODEL_DISABLED"
            else:
                raise AssertionError("new inference was accepted after stop")

            release.set()
            assert running.result(timeout=5) == []

        assert service.metadata()["status"] == "STOPPED"
        service.start()
