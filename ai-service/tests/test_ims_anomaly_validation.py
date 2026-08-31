from __future__ import annotations

import unittest
import json
import math

import pandas as pd

from src.evaluation.ims_anomaly_validation import (
    add_full_life_fraction,
    add_method_flags,
    aggregate_channel_scores,
    calculate_method_metrics,
    json_safe,
    validate_documented_mapping,
)


class ImsAnomalyValidationTests(unittest.TestCase):
    def test_documented_mapping_for_first_experiment(self) -> None:
        rows = []
        for channel in range(1, 9):
            rows.append(
                {
                    "experiment": "1st_test",
                    "sensor_channel": channel,
                    "bearing": ((channel - 1) // 2) + 1,
                    "axis": "x" if channel % 2 == 1 else "y",
                }
            )
        for channel in range(1, 5):
            rows.append(
                {
                    "experiment": "2nd_test",
                    "sensor_channel": channel,
                    "bearing": channel,
                    "axis": None,
                }
            )
            rows.append(
                {
                    "experiment": "3rd_test",
                    "sensor_channel": channel,
                    "bearing": channel,
                    "axis": None,
                }
            )

        result = validate_documented_mapping(pd.DataFrame(rows))

        self.assertTrue(result["bearing_mapping_ok"].all())
        self.assertTrue(result["axis_mapping_ok"].all())

    def test_aggregation_preserves_experiment_timestamp_and_bearing(self) -> None:
        scores = pd.DataFrame(
            [
                {
                    "experiment": "1st_test",
                    "timestamp": pd.Timestamp("2003-01-01"),
                    "sensor_channel": 5,
                    "bearing": 3,
                    "full_life_fraction": 0.8,
                    "z_anomaly_score": 1.0,
                    "z_is_anomaly": False,
                    "if_anomaly_score": 0.1,
                    "if_is_anomaly": False,
                },
                {
                    "experiment": "1st_test",
                    "timestamp": pd.Timestamp("2003-01-01"),
                    "sensor_channel": 6,
                    "bearing": 3,
                    "full_life_fraction": 0.8,
                    "z_anomaly_score": 5.0,
                    "z_is_anomaly": True,
                    "if_anomaly_score": 0.2,
                    "if_is_anomaly": True,
                },
            ]
        )

        aggregated = aggregate_channel_scores(scores)

        self.assertEqual(len(aggregated), 1)
        self.assertEqual(int(aggregated.loc[0, "channel_count"]), 2)
        self.assertEqual(float(aggregated.loc[0, "z_anomaly_score"]), 5.0)
        self.assertTrue(bool(aggregated.loc[0, "z_is_anomaly"]))

    def test_trailing_three_of_five_persistence(self) -> None:
        timestamps = pd.date_range("2003-01-01", periods=6, freq="10min")
        scores = pd.DataFrame(
            {
                "experiment": ["1st_test"] * 6,
                "timestamp": timestamps,
                "bearing": [3] * 6,
                "full_life_fraction": [0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
                "z_anomaly_score": [0, 1, 2, 3, 4, 5],
                "if_anomaly_score": [0, 1, 2, 3, 4, 5],
                "z_is_anomaly": [True, False, True, False, True, False],
                "if_is_anomaly": [False, False, False, False, False, False],
                "channel_count": [1] * 6,
            }
        )

        flagged = add_method_flags(scores)

        self.assertFalse(bool(flagged.loc[3, "z_persistent_alert"]))
        self.assertTrue(bool(flagged.loc[4, "z_persistent_alert"]))

    def test_proxy_metrics_reward_late_failed_bearing_alerts(self) -> None:
        timestamps = pd.date_range("2003-01-01", periods=6, freq="10min")
        scored = pd.DataFrame(
            {
                "experiment": ["1st_test"] * 6,
                "timestamp": timestamps,
                "bearing": [3] * 6,
                "full_life_fraction": [0.0, 0.2, 0.4, 0.82, 0.9, 1.0],
                "z_score_normalized": [0, 0, 0, 1, 1, 1],
                "if_score_normalized": [0, 0, 0, 1, 1, 1],
                "or_score": [0, 0, 0, 1, 1, 1],
                "and_score": [0, 0, 0, 1, 1, 1],
                "weighted_score": [0, 0, 0, 1, 1, 1],
                "z_persistent_alert": [False, False, False, True, True, True],
                "if_persistent_alert": [False, False, False, True, True, True],
                "or_persistent_alert": [False, False, False, True, True, True],
                "and_persistent_alert": [False, False, False, True, True, True],
                "weighted_persistent_alert": [False, False, False, True, True, True],
            }
        )

        metrics = calculate_method_metrics(scored, "z_score", 0.2)

        self.assertEqual(metrics["alerts"], 3)
        self.assertGreater(metrics["precision"], 0)
        self.assertGreater(metrics["recall"], 0)
        self.assertEqual(metrics["failing_bearing_concentration"], 1.0)

    def test_json_safe_converts_non_finite_numbers(self) -> None:
        payload = {"value": math.nan, "nested": [math.inf, 1.0]}

        safe_payload = json_safe(payload)

        self.assertIsNone(safe_payload["value"])
        self.assertIsNone(safe_payload["nested"][0])
        json.dumps(safe_payload, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
