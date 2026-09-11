from fastapi.testclient import TestClient

from app.main import app


def test_catalog_and_real_supported_sample(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    headers = {"x-ai-service-token": "test-service-token"}
    with TestClient(app, headers=headers) as client:
        catalog = client.get("/v1/dataset-replay/catalog")
        assert catalog.status_code == 200
        experiments = catalog.json()["experiments"]
        assert {item["id"] for item in experiments} == {"1st_test", "2nd_test", "3rd_test"}
        assert next(item for item in experiments if item["id"] == "1st_test")["supported"] is True
        assert next(item for item in experiments if item["id"] == "2nd_test")["supported"] is False

        samples = client.get("/v1/dataset-replay/samples", params={"experiment": "1st_test"})
        assert samples.status_code == 200
        timestamp = samples.json()["samples"][0]
        replay = client.post(
            "/v1/dataset-replay/sample",
            json={"experiment": "1st_test", "timestamp": timestamp},
        )
        assert replay.status_code == 200
        rows = replay.json()["rows"]
        assert len(rows) == 8
        assert all(row["experiment"] == "1st_test" for row in rows)
        assert all(row["timestamp"] == timestamp for row in rows)


def test_unvalidated_experiment_cannot_be_replayed(monkeypatch) -> None:
    monkeypatch.setattr("app.main.settings.service_token", "test-service-token")
    with TestClient(app, headers={"x-ai-service-token": "test-service-token"}) as client:
        response = client.get("/v1/dataset-replay/samples", params={"experiment": "2nd_test"})
    assert response.status_code == 400
    assert "not validated" in response.json()["error"]["message"]
