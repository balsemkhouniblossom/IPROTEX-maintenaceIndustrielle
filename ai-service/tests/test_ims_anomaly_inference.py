from __future__ import annotations

import json
from pathlib import Path
import unittest

import numpy as np
import pandas as pd

from src.inference.ims_anomaly_inference import (
    ImsAnomalyInferencePipeline,
    ImsInferenceError,
)


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = ROOT / "artifacts" / "models" / "ims_selected_anomaly_model_v0_1_0.joblib"
METADATA_PATH = ROOT / "artifacts" / "models" / "ims_selected_anomaly_model_v0_1_0.json"
FEATURE_PATH = ROOT / "data" / "processed" / "ims_features.csv"
VALIDATED_PATH = ROOT / "data" / "processed" / "ims_validated_anomaly_scores.csv"


def load_eval_features() -> tuple[pd.DataFrame, pd.DataFrame]:
    features = pd.read_csv(FEATURE_PATH, parse_dates=["timestamp"])
    validated = pd.read_csv(VALIDATED_PATH, parse_dates=["timestamp"])
    start = validated["timestamp"].min()
    features = features[features["experiment"].eq("1st_test") & features["timestamp"].ge(start)].copy()
    return features, validated


class ImsAnomalyInferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.features, cls.validated = load_eval_features()

    def make_pipeline(self) -> ImsAnomalyInferencePipeline:
        return ImsAnomalyInferencePipeline(ARTIFACT_PATH, METADATA_PATH)

    def test_model_and_metadata_loading(self) -> None:
        pipeline = self.make_pipeline()

        self.assertEqual(pipeline.version, "0.1.0")
        self.assertEqual(pipeline.artifact["selected_method"], "weighted")
        self.assertFalse(pipeline.artifact["cross_experiment_validation_performed"])
        self.assertEqual(pipeline.validated_experiments, {"1st_test"})

    def test_required_feature_schema_and_order(self) -> None:
        pipeline = self.make_pipeline()

        self.assertEqual(
            pipeline.feature_order,
            [
                "rms",
                "standard_deviation",
                "peak_to_peak",
                "kurtosis",
                "skewness",
                "crest_factor",
                "spectral_energy",
                "dominant_frequency_hz",
            ],
        )
        pipeline.validate_input(self.features.head(8))

        with self.assertRaisesRegex(ImsInferenceError, "missing required columns"):
            pipeline.validate_input(self.features.drop(columns=["rms"]).head(8))

    def test_missing_and_non_finite_values_are_rejected(self) -> None:
        pipeline = self.make_pipeline()
        frame = self.features.head(8).copy()
        frame.loc[frame.index[0], "rms"] = np.nan

        with self.assertRaisesRegex(ImsInferenceError, "missing values|finite numeric"):
            pipeline.validate_input(frame)

        frame = self.features.head(8).copy()
        frame.loc[frame.index[0], "rms"] = np.inf
        with self.assertRaisesRegex(ImsInferenceError, "finite numeric"):
            pipeline.validate_input(frame)

    def test_chronological_ordering_is_required(self) -> None:
        pipeline = self.make_pipeline()
        channel_rows = self.features[self.features["sensor_channel"].eq(1)].head(3).copy()
        reversed_rows = channel_rows.iloc[::-1].copy()

        with self.assertRaisesRegex(ImsInferenceError, "chronological"):
            pipeline.validate_input(reversed_rows)

    def test_documented_mapping_and_duplicates_are_required(self) -> None:
        pipeline = self.make_pipeline()
        frame = self.features.head(8).copy()
        duplicate = pd.concat([frame, frame.head(1)], ignore_index=True)

        with self.assertRaisesRegex(ImsInferenceError, "duplicate"):
            pipeline.validate_input(duplicate)

        bad_mapping = frame.copy()
        bad_mapping.loc[bad_mapping.index[0], "bearing"] = 4
        with self.assertRaisesRegex(ImsInferenceError, "Invalid bearing mapping"):
            pipeline.validate_input(bad_mapping)

    def test_unsupported_experiment_is_rejected_without_generalization_claim(self) -> None:
        pipeline = self.make_pipeline()
        frame = self.features.head(4).copy()
        frame["experiment"] = "2nd_test"
        frame["sensor_channel"] = [1, 2, 3, 4]
        frame["bearing"] = [1, 2, 3, 4]
        frame["axis"] = None

        with self.assertRaisesRegex(ImsInferenceError, "validated only"):
            pipeline.validate_input(frame)

    def test_channel_to_bearing_aggregation_uses_max_scores_and_any_flags(self) -> None:
        pipeline = self.make_pipeline()
        channel_scores = pd.DataFrame(
            [
                {
                    "experiment": "1st_test",
                    "timestamp": pd.Timestamp("2003-11-20"),
                    "sensor_channel": 5,
                    "bearing": 3,
                    "axis": "x",
                    "z_anomaly_score": 1.0,
                    "z_is_anomaly": False,
                    "if_anomaly_score": 0.1,
                    "if_is_anomaly": False,
                },
                {
                    "experiment": "1st_test",
                    "timestamp": pd.Timestamp("2003-11-20"),
                    "sensor_channel": 6,
                    "bearing": 3,
                    "axis": "y",
                    "z_anomaly_score": 2.0,
                    "z_is_anomaly": True,
                    "if_anomaly_score": 0.2,
                    "if_is_anomaly": True,
                },
            ]
        )

        aggregated = pipeline._aggregate_channel_scores(channel_scores)

        self.assertEqual(len(aggregated), 1)
        self.assertEqual(int(aggregated.loc[0, "channel_count"]), 2)
        self.assertEqual(float(aggregated.loc[0, "z_anomaly_score"]), 2.0)
        self.assertTrue(bool(aggregated.loc[0, "z_is_anomaly"]))

    def test_three_of_five_persistence_and_state_separation(self) -> None:
        pipeline = self.make_pipeline()
        base_time = pd.Timestamp("2003-11-20")
        rows = []
        for index in range(5):
            for bearing, z_score in [(3, 100.0), (4, 0.0)]:
                rows.append(
                    {
                        "experiment": "1st_test",
                        "timestamp": base_time + pd.Timedelta(minutes=10 * index),
                        "bearing": bearing,
                        "z_anomaly_score": z_score,
                        "z_is_anomaly": z_score > 1,
                        "if_anomaly_score": 1.0 if bearing == 3 else -1.0,
                        "if_is_anomaly": bearing == 3,
                        "channel_count": 2,
                    }
                )
        scored = pipeline._apply_weighting_and_persistence(pd.DataFrame(rows))

        bearing3_last = scored[scored["bearing"].eq(3)].iloc[-1]
        bearing4_last = scored[scored["bearing"].eq(4)].iloc[-1]
        self.assertTrue(bool(bearing3_last["persistentAlert"]))
        self.assertFalse(bool(bearing4_last["persistentAlert"]))

    def test_deterministic_repeated_inference(self) -> None:
        subset = self.features.head(80)
        first = self.make_pipeline().predict_batch(subset)
        second = self.make_pipeline().predict_batch(subset)

        pd.testing.assert_frame_equal(first, second)

    def test_batch_versus_streaming_equivalence(self) -> None:
        timestamps = self.features["timestamp"].drop_duplicates().head(20)
        subset = self.features[self.features["timestamp"].isin(timestamps)].copy()
        batch = self.make_pipeline().predict_batch(subset)

        streaming_pipeline = self.make_pipeline()
        parts = []
        for _, group in subset.groupby("timestamp", sort=True):
            parts.append(streaming_pipeline.predict_timestamp(group))
        streaming = pd.concat(parts, ignore_index=True)

        pd.testing.assert_frame_equal(batch.reset_index(drop=True), streaming.reset_index(drop=True))

    def test_risk_score_boundaries_and_json_serialization(self) -> None:
        pipeline = self.make_pipeline()
        output = pipeline.predict_batch(self.features.head(8))
        records = pipeline.to_json_records(output)

        self.assertTrue(records)
        for record in records:
            self.assertGreaterEqual(record["riskScore"], 0)
            self.assertLessEqual(record["riskScore"], 100)
            self.assertIn(record["riskLevel"], {"NORMAL", "MONITOR", "HIGH", "CRITICAL"})
            self.assertTrue(record["prototypeResult"])
        json.dumps(records, allow_nan=False)

    def test_parity_with_validated_notebook_output(self) -> None:
        output = self.make_pipeline().predict_batch(self.features)
        merged = output.merge(self.validated, on=["experiment", "timestamp", "bearing"], suffixes=("_new", "_old"))

        self.assertEqual(len(output), len(self.validated))
        self.assertEqual(len(merged), len(self.validated))
        for column in [
            "z_is_anomaly",
            "if_is_anomaly",
            "or_raw_alert",
            "and_raw_alert",
            "weighted_raw_alert",
            "z_persistent_alert",
            "if_persistent_alert",
            "or_persistent_alert",
            "and_persistent_alert",
            "weighted_persistent_alert",
        ]:
            self.assertTrue((merged[f"{column}_new"] == merged[f"{column}_old"]).all(), column)
        for column in [
            "z_anomaly_score",
            "if_anomaly_score",
            "z_score_normalized",
            "if_score_normalized",
            "or_score",
            "and_score",
            "weighted_score",
        ]:
            self.assertLessEqual(
                float(np.abs(merged[f"{column}_new"] - merged[f"{column}_old"]).max()),
                1e-6,
                column,
            )

    def test_inference_does_not_train_or_refit(self) -> None:
        pipeline = self.make_pipeline()

        def fail_fit(*args, **kwargs):  # noqa: ANN002, ANN003
            raise AssertionError("fit must not be called during inference")

        pipeline.estimator.fit = fail_fit
        pipeline.estimator.named_steps["model"].fit = fail_fit
        pipeline.predict_batch(self.features.head(8))


if __name__ == "__main__":
    unittest.main()
