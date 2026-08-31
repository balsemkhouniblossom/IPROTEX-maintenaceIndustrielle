from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import numpy as np
import pandas as pd
import pytest

from app.main import app
from src.inference.ims_anomaly_inference import ImsAnomalyInferencePipeline


ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_PATH = ROOT / "artifacts" / "models" / "ims_selected_anomaly_model_v0_1_0.joblib"
METADATA_PATH = ROOT / "artifacts" / "models" / "ims_selected_anomaly_model_v0_1_0.json"
FEATURE_PATH = ROOT / "data" / "processed" / "ims_features.csv"


def feature_rows(timestamp_count: int = 1) -> list[dict[str, Any]]:
    frame = pd.read_csv(FEATURE_PATH)
    timestamps = frame.loc[frame["experiment"].eq("1st_test"), "timestamp"].drop_duplicates().head(timestamp_count)
    subset = frame[frame["timestamp"].isin(timestamps)].copy()
    subset = subset[
        [
            "timestamp",
            "experiment",
            "sensor_channel",
            "bearing",
            "axis",
            "rms",
            "standard_deviation",
            "peak_to_peak",
            "kurtosis",
            "skewness",
            "crest_factor",
            "spectral_energy",
            "dominant_frequency_hz",
        ]
    ]
    return json.loads(subset.to_json(orient="records"))


def pipeline_records(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pipeline = ImsAnomalyInferencePipeline(ARTIFACT_PATH, METADATA_PATH)
    return pipeline.to_json_records(pipeline.predict_batch(pd.DataFrame(rows)))


def post_batch(client: TestClient, rows: list[dict[str, Any]]):
    return client.post("/v1/anomaly/analyze-batch", json={"rows": rows})


def test_valid_single_inference_and_direct_pipeline_parity() -> None:
    rows = feature_rows(1)
    with TestClient(app) as client:
        response = client.post("/v1/anomaly/analyze", json={"rows": rows})

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"] == pipeline_records(rows)
    assert set(payload["results"][0]) == {
        "modelVersion",
        "experiment",
        "timestamp",
        "bearing",
        "anomalyScore",
        "riskScore",
        "riskLevel",
        "rawAnomaly",
        "persistentAlert",
        "componentScores",
        "reasonCodes",
        "prototypeResult",
    }


def test_valid_chronological_batch_and_deterministic_replay() -> None:
    rows = feature_rows(3)
    with TestClient(app) as client:
        first = post_batch(client, rows)
        second = post_batch(client, rows)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["results"] == pipeline_records(rows)


def test_invalid_schema_and_missing_features_are_rejected() -> None:
    rows = feature_rows(1)
    missing = dict(rows[0])
    missing.pop("rms")
    with TestClient(app) as client:
        assert client.post("/v1/anomaly/analyze", json={"rows": []}).status_code == 422
        response = client.post("/v1/anomaly/analyze", json={"rows": [missing]})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_duplicate_rows_are_rejected() -> None:
    rows = feature_rows(1)
    with TestClient(app) as client:
        response = client.post("/v1/anomaly/analyze", json={"rows": rows + [rows[0]]})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_non_finite_features_are_rejected() -> None:
    rows = feature_rows(1)
    rows[0]["rms"] = "NaN"
    with TestClient(app) as client:
        response = client.post("/v1/anomaly/analyze", json={"rows": rows})

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("experiment", "unknown_test", "experiments without documented IMS mappings"),
        ("bearing", 4, "Invalid bearing mapping"),
        ("sensor_channel", 99, "Sensor channel"),
        ("axis", "z", "Invalid axis mapping"),
    ],
)
def test_unknown_experiment_bearing_and_sensor_mappings_are_rejected(
    field: str, value: object, message: str
) -> None:
    rows = feature_rows(1)
    rows[0][field] = value
    with TestClient(app) as client:
        response = post_batch(client, rows)

    assert response.status_code == 400
    assert message in response.json()["error"]["message"]


def test_out_of_order_timestamps_are_rejected() -> None:
    rows = feature_rows(2)
    reversed_rows = rows[8:] + rows[:8]
    with TestClient(app) as client:
        batch_response = post_batch(client, reversed_rows)
        stream_ok = client.post("/v1/anomaly/analyze", json={"rows": rows[8:]})
        stream_bad = client.post("/v1/anomaly/analyze", json={"rows": rows[:8]})

    assert batch_response.status_code == 400
    assert "chronological" in batch_response.json()["error"]["message"]
    assert stream_ok.status_code == 200
    assert stream_bad.status_code == 400
    assert "chronological" in stream_bad.json()["error"]["message"]


def test_persistence_state_is_separated_from_stateless_batch_replay() -> None:
    rows = feature_rows(5)
    with TestClient(app) as client:
        baseline = post_batch(client, rows).json()
        for index in range(5):
            response = client.post("/v1/anomaly/analyze", json={"rows": rows[index * 8 : (index + 1) * 8]})
            assert response.status_code == 200
        replay = post_batch(client, rows).json()

    assert replay == baseline


def test_concurrency_safety_for_disjoint_streams() -> None:
    rows = feature_rows(1)
    payloads = [
        {"rows": rows[:2]},
        {"rows": rows[2:4]},
        {"rows": rows[4:6]},
        {"rows": rows[6:8]},
    ]
    with TestClient(app) as client:
        with ThreadPoolExecutor(max_workers=4) as executor:
            responses = list(executor.map(lambda body: client.post("/v1/anomaly/analyze", json=body), payloads))

    assert [response.status_code for response in responses] == [200, 200, 200, 200]


def test_batch_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.routes import anomaly

    monkeypatch.setattr(anomaly.settings, "max_batch_rows", 2)
    with TestClient(app) as client:
        response = post_batch(client, feature_rows(1))

    assert response.status_code == 400
    assert "maximum row limit" in response.json()["error"]["message"]


def test_json_serialization_is_strict() -> None:
    with TestClient(app) as client:
        response = post_batch(client, feature_rows(1))

    assert response.status_code == 200
    json.dumps(response.json(), allow_nan=False)


def test_no_retraining_during_requests() -> None:
    with TestClient(app) as client:
        service = client.app.state.inference_service

        def fail_fit(*args: object, **kwargs: object) -> None:
            raise AssertionError("fit must not be called during API inference")

        service.pipeline.estimator.fit = fail_fit
        service.pipeline.estimator.named_steps["model"].fit = fail_fit
        response = post_batch(client, feature_rows(1))

    assert response.status_code == 200


def test_request_size_limit() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/v1/anomaly/analyze-batch",
            content=json.dumps({"rows": feature_rows(1)}),
            headers={"content-type": "application/json", "content-length": "999999999"},
        )

    assert response.status_code == 413
