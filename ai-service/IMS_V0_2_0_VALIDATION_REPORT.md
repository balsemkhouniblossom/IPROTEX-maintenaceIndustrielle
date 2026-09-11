# IMS anomaly model v0.2.0 validation report

## 1. Dataset Audit

The audit uses the local IMS readme as the experiment contract and the extracted feature table as the measured source. Each file is a one-second snapshot sampled at 20 kHz with 20,480 samples per channel.

| Experiment | Files/timestamps | Channels | Start | Documented end | Failed bearing(s) | Missing/corrupt/incomplete |
| --- | ---: | ---: | --- | --- | --- | ---: |
| 1st_test | 2,156 | 8 | 2003-10-22 12:06:24 | 2003-11-25 23:39:56 | 3 inner race; 4 rolling element | 0 |
| 2nd_test | 984 | 4 | 2004-02-12 10:32:39 | 2004-02-19 06:22:39 | 1 outer race | 0 |
| 3rd_test | 4,448 in documented scope | 4 | 2004-03-04 09:27:46 | 2004-04-04 19:01:57 | 3 outer race | 0 |

The 3rd_test discrepancy is resolved. The extracted folder contains 6,324 unique timestamp files, not duplicated channels or a multiplied row count. Exactly 4,448 end at the readme timestamp. A further 1,876 continue every ten minutes through 2004-04-18 02:42:55. v0.2 excludes this undocumented tail from fitting, labeling, and evaluation. Channel mappings are 1/2, 3/4, 5/6, 7/8 to bearings 1-4 for 1st_test, and channels 1-4 to bearings 1-4 for the other tests.

## 2. Leakage Audit

v0.1 fitted on an early 1st_test baseline but later normalized and selected combined-score thresholds from an evaluated slice, so its published results are not clean untouched-test results. v0.2 creates chronological regions per experiment: 0-20% healthy baseline, 20-40% healthy calibration, 40-50% excluded buffer, 50-75% healthy test, 75-90% uncertain transition, and 90-100% failure-proximal. Normalization, Isolation Forest fitting, thresholds, weights, and persistence selection use only baseline/calibration data. No rows are shuffled. The locked 50-100% region is evaluated only after the selection policy is fixed.

## 3. Experimental Protocol

- Training: each experiment's chronological 0-20% baseline; estimator random seed 42.
- Calibration: 20-40% only; detector thresholds are calibration quantiles/candidates and alert-rate constraints.
- Buffer: 40-50%, excluded from fitting and scoring claims.
- Untouched test: 50-100%; the 75-90% failed-bearing transition is excluded from failure-proximity metrics but retained in strict binary reporting.
- Cross-experiment: leave one complete experiment out, train/calibrate on the other two, and apply the Isolation Forest unchanged to the held-out experiment.

This protocol establishes leakage-free chronological testing. It does not turn the temporal proxy into authoritative fault labels.

## 4. Feature Audit

v0.2 retains the v1 contract: RMS, standard deviation, peak-to-peak, kurtosis, skewness, crest factor, spectral energy, and dominant frequency. It adds no features because the current contract must first be tested cleanly. The versioned feature audit records baseline coefficient of variation, robust late shift, failed-bearing time correlation, and failed/non-failed separation. The correlation matrix is also exported. RobustScaler medians and IQR scales are fitted on baseline rows only and stored per feature in metadata; there is no test-statistic normalization.

## 5. Detector Results

Failure-proximity results below are aggregate locked-test results with 2-of-3 persistence. Risk scores are indices, not probabilities.

| Method | Precision | Recall | F1 | PR-AUC | False-positive episodes/day |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dynamic Z-score | 0.278 | 0.015 | 0.029 | 0.096 | 0.186 |
| Isolation Forest | 0.804 | 0.226 | 0.353 | 0.365 | 0.124 |
| OR | 0.521 | 0.366 | 0.430 | 0.313 | 1.000 |
| AND | 0.500 | 0.069 | 0.121 | 0.165 | 0.227 |
| Average (selected before test) | 0.487 | 0.281 | 0.356 | 0.262 | 0.907 |
| Z 70% / IF 30% | 0.468 | 0.037 | 0.068 | 0.186 | 0.165 |
| Z 30% / IF 70% | 0.586 | 0.094 | 0.162 | 0.319 | 0.258 |

The post-lock results show that Isolation Forest alone and OR outperform the precommitted average on recall/F1. They are evidence for a future version, not grounds to retune v0.2 against its test set.

## 6. Persistence Comparison

| Rule on selected average score | Precision | Recall | F1 | False-positive episodes/day |
| --- | ---: | ---: | ---: | ---: |
| 1-of-1 | 0.437 | 0.095 | 0.156 | 0.887 |
| 2-of-3 (selected) | 0.487 | 0.281 | 0.356 | 0.907 |
| 3-of-5 | 0.554 | 0.057 | 0.104 | 0.124 |
| 4-of-5 | 0.698 | 0.031 | 0.059 | 0.041 |
| 2 consecutive | 0.564 | 0.045 | 0.083 | 0.186 |
| 3 consecutive | 0.652 | 0.031 | 0.059 | 0.062 |
| 5-point rolling average >= 0.5 | 0.554 | 0.057 | 0.104 | 0.124 |

2-of-3 was fixed from calibration evidence as a compromise between alert suppression and delay. The test comparison is diagnostic only.

## 7. Lead-Time Analysis

| Experiment/bearing | First raw anomaly | First persistent warning | Failure proxy/end | Persistent lead |
| --- | --- | --- | --- | ---: |
| 1st_test / 3 | 2003-11-01 11:11:44 | 2003-11-01 12:21:44 | 2003-11-25 23:39:56 | 587.3 h |
| 1st_test / 4 | 2003-11-01 17:21:44 | 2003-11-01 20:21:44 | 2003-11-25 23:39:56 | 579.3 h |
| 2nd_test / 1 | 2004-02-16 22:22:39 | 2004-02-16 22:32:39 | 2004-02-19 06:22:39 | 55.8 h |
| 3rd_test / 3 | 2004-03-11 04:12:46 | 2004-03-27 09:51:57 | 2004-04-04 19:01:57 | 201.2 h |

Among detected failures, persistent lead time is minimum 55.8 h, median approximately 390.2 h, and maximum 587.3 h. The 1st_test warnings are very early relative to the final-10% proxy, while the 3rd_test warning appears only about eight days before the documented endpoint. All four documented failed bearings receive a persistent warning under this within-experiment protocol, but this does not establish cross-experiment generalization.

## 8. Cross-Experiment Validation

| Held out | Precision | Recall | F1 | PR-AUC | FP episodes/day |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1st_test | 0.665 | 0.722 | 0.693 | 0.685 | 1.747 |
| 2nd_test | 0.281 | 0.646 | 0.391 | 0.252 | 3.269 |
| 3rd_test | 0.000 | 0.000 | 0.000 | 0.063 | 0.000 |

This is genuine held-out-experiment evaluation, distinct from the within-experiment personalized-baseline result. Transfer is unstable and fails completely on documented 3rd_test, so generalization is not established.

## 9. V0.1 vs V0.2

The metric definitions differ: v0.1 averages proxy windows on 1st_test; v0.2 reports the locked failure-proximity region across all experiments. Values are shown for transparency, not as a like-for-like uplift claim.

| Metric | v0.1.0 | v0.2.0 |
| --- | ---: | ---: |
| Precision | 0.369 | 0.487 |
| Recall | 0.043 | 0.281 |
| F1 | 0.074 | 0.356 |
| PR-AUC | 0.381 | 0.262 |
| Median persistent warning lead time | not reported | 390.2 h among detected failures |
| False positives/day | 0.709 | 0.217 episodes/day |
| Leakage-free test | No | Yes |
| Cross-experiment test | Weak/none | Yes; unstable, 3rd_test missed |
| Persistence | heuristic 3-of-5 | calibration-selected 2-of-3 |
| Risk mapping | heuristic | heuristic |

## 10. Artifact

The immutable new artifact is `artifacts/models/ims_selected_anomaly_model_v0_2_0.joblib`; v0.1 remains untouched. Its JSON metadata includes the version, UTC creation time, feature contract/order, per-feature normalization, detector parameters and seed, score thresholds, aggregation, 2-of-3 persistence, heuristic risk bands, training/calibration/locked-test scopes, metrics, limitations, and compatible input schema.

## 11. API Impact

`/v1/models` now exposes version-derived identity, safe validation metrics, pilot acceptance, risk-mapping type, and limitations. `ANOMALY_MODEL_VERSION=0.1.0` remains the default; setting it to `0.2.0` selects the new artifact, while unsupported values fail closed. No frontend pages or MongoDB data were changed.

## 12. Tests

The v0.2 regression suite verifies immutable version paths, unsupported-version rejection, locked protocol metadata, non-promotion, all three replay experiments, versioned inference output, and the new persistence contract. Full exact test counts are recorded in the implementation handoff after execution.

## 13. Remaining Limitations

- IMS provides run-level failure outcomes, not timestamp-level anomaly truth.
- Recall is far below the advisory-pilot requirement and cross-experiment 3rd_test transfer is missed.
- Cross-experiment false-alert rates and recall vary substantially.
- The selected combination is inferior to post-lock alternatives; changing it requires v0.3 and a new untouched test.
- Persistence and NORMAL/MONITOR/HIGH/CRITICAL boundaries remain operational heuristics.
- No fault diagnosis, RUL, or live IPROTEX vibration ingestion is implemented.
- Results apply only to controlled IMS dataset replay.

## 14. Final Model Verdict

**RESEARCH MODEL**

v0.2 is reproducible and leakage-controlled, but recall and unstable cross-experiment behavior prevent dataset-demonstration or advisory-pilot promotion.

Rebuild from `ai-service` with:

```powershell
python scripts/build_ims_v0_2.py
```
