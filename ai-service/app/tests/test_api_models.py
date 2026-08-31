from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_model_metadata_exposes_validation_scope_and_runtime_versions() -> None:
    with TestClient(app) as client:
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
