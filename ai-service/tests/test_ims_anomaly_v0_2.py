from __future__ import annotations

import json
from pathlib import Path
import unittest

import pandas as pd

from app.core.config import _model_file
from src.inference.ims_anomaly_inference import ImsAnomalyInferencePipeline


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "artifacts" / "models" / "ims_selected_anomaly_model_v0_2_0.joblib"
METADATA = ROOT / "artifacts" / "models" / "ims_selected_anomaly_model_v0_2_0.json"
FEATURES = ROOT / "data" / "processed" / "ims_features.csv"
REPORT = ROOT / "artifacts" / "validation" / "v0_2_0" / "ims_v0_2_validation_report.json"


class ImsAnomalyV020Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.features = pd.read_csv(FEATURES, parse_dates=["timestamp"])

    def test_v010_remains_available_and_version_switch_resolves_both(self) -> None:
        self.assertTrue(_model_file("0.1.0", "joblib").is_file())
        self.assertTrue(_model_file("v0.2.0", "joblib").is_file())
        self.assertNotEqual(_model_file("0.1.0", "joblib"), _model_file("0.2.0", "joblib"))
        with self.assertRaises(ValueError):
            _model_file("../../unversioned", "joblib")

    def test_v020_metadata_records_locked_protocol_and_rejection(self) -> None:
        metadata = json.loads(METADATA.read_text(encoding="utf-8"))
        report = json.loads(REPORT.read_text(encoding="utf-8"))

        self.assertEqual(metadata["version"], "0.2.0")
        self.assertTrue(report["protocol"]["test_locked_before_selection"])
        self.assertFalse(report["protocol"]["random_shuffle"])
        self.assertFalse(report["accepted_for_advisory_pilot"])
        self.assertEqual(metadata["risk_mapping_type"], "heuristic")
        self.assertEqual(metadata["persistence"]["window"], 3)
        self.assertEqual(metadata["persistence"]["required"], 2)

    def test_v020_runs_all_documented_experiments_with_versioned_results(self) -> None:
        pipeline = ImsAnomalyInferencePipeline(ARTIFACT, METADATA)
        self.assertEqual(pipeline.version, "0.2.0")
        self.assertEqual(pipeline.validated_experiments, {"1st_test", "2nd_test", "3rd_test"})

        for experiment in sorted(pipeline.validated_experiments):
            experiment_rows = self.features[self.features["experiment"].eq(experiment)]
            timestamp = experiment_rows["timestamp"].drop_duplicates().iloc[len(experiment_rows["timestamp"].unique()) // 2]
            output = pipeline.predict_batch(experiment_rows[experiment_rows["timestamp"].eq(timestamp)])
            self.assertEqual(set(output["modelVersion"]), {"0.2.0"})
            self.assertEqual(len(output), 4)

    def test_reason_code_uses_versioned_persistence_rule(self) -> None:
        pipeline = ImsAnomalyInferencePipeline(ARTIFACT, METADATA)
        self.assertEqual(pipeline.persistence_config["window"], 3)
        self.assertEqual(pipeline.persistence_config["required"], 2)
        self.assertNotEqual(pipeline.persistence_config, {"window": 5, "required": 3})


if __name__ == "__main__":
    unittest.main()
