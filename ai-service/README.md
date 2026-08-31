# AI Service

Workspace for future AI and machine-learning work related to the GMAO platform.

## Structure

- `data/raw`: Original source datasets.
- `data/processed`: Cleaned or transformed datasets.
- `notebooks`: Exploratory notebooks and experiments.
- `src/preprocessing`: Data cleaning and preparation code.
- `src/features`: Feature engineering code.
- `src/models`: Model training and inference code.
- `src/evaluation`: Model evaluation utilities.
- `artifacts`: Generated model artifacts and reports.
- `tests`: AI service tests.

## Setup

Create and activate the local Python environment from this folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install pandas numpy scipy scikit-learn matplotlib seaborn joblib jupyter
pip freeze > requirements.txt
```

Installed environment validated on 2026-08-30:

- Python `3.12.5`
- pip `26.2.1`
- Import smoke test passed for `pandas`, `numpy`, `scipy`, `sklearn`, `matplotlib`, `seaborn`, `joblib`, and `jupyter`.

## Jupyter

Start Jupyter from this folder:

```powershell
jupyter notebook
```

Current local server started from `.venv`:

```text
http://localhost:8888/tree
```

## Dataset Audit

First notebook:

```text
notebooks/01_ims_data_audit.ipynb
```

Purpose: create a trustworthy IMS bearing dataset inventory before any model training.

The notebook checks:

- Number of experiments.
- Number of files per experiment.
- File timestamps and chronological order.
- Number of sensor channels.
- Number of measurements per file.
- Missing, empty, or malformed files.
- Minimum, maximum, mean, and standard deviation.
- Failed bearing in each experiment.
- Approximate dataset size.
- Unexpected experiment folders.

Current IMS raw-data status observed on 2026-08-30:

- Expected IMS experiments: `3`.
- Archives found: `1st_test.rar`, `2nd_test.rar`, `3rd_test.rar`.
- Extracted experiment folders found: `1st_test`, `2nd_test`, `3rd_test`.
- Unexpected folder count: `0`.
- `3rd_test` is extracted under `data/raw/IMS/IMS/3rd_test/txt`.
- `3rd_test` currently contains `6324` measurement files, which is `1876` more than the IMS readme expectation of `4448`.

Validation completed:

- Notebook executed successfully through `nbconvert` with `IMS_AUDIT_MAX_FILES=2` for a fast smoke test.
- `1st_test`: `2156` files found; sampled files have `8` channels and `20480` measurements.
- `2nd_test`: `984` files found; sampled files have `4` channels and `20480` measurements.
- `3rd_test`: `6324` files found; sampled files have `4` channels and `20480` measurements.
- Sampled timestamps parse correctly and are chronological by filename for all three experiments.
- No empty or malformed files were found in the smoke-tested sample.

For a full inventory, unset `IMS_AUDIT_MAX_FILES`, then run all cells in `01_ims_data_audit.ipynb`. Review the `3rd_test` file-count mismatch before using it for model training.

## Feature Engineering

Second notebook:

```text
notebooks/02_ims_feature_engineering.ipynb
```

Purpose: create the first preprocessing pipeline and produce one feature row per timestamp and sensor channel.

Generated output:

```text
data/processed/ims_features.csv
```

Feature columns:

- `timestamp`
- `experiment`
- `sensor_channel`
- `bearing`
- `axis`
- `measurements`
- `source_file`
- `rms`
- `standard_deviation`
- `peak_to_peak`
- `kurtosis`
- `skewness`
- `crest_factor`
- `spectral_energy`
- `dominant_frequency_hz`

Feature-engineering validation completed on 2026-08-30:

- Smoke execution passed with `IMS_FEATURE_MAX_FILES=2` and `IMS_FEATURE_WRITE_OUTPUT=0`.
- Full notebook execution completed and wrote `data/processed/ims_features.csv`.
- Output file size: about `10.0 MB`.
- Total feature rows: `46480`.
- `1st_test`: `17248` rows from `2156` timestamps, `8` sensor channels, `4` bearings.
- `2nd_test`: `3936` rows from `984` timestamps, `4` sensor channels, `4` bearings.
- `3rd_test`: `25296` rows from `6324` timestamps, `4` sensor channels, `4` bearings.
- No missing values in computed numeric feature columns.
- `axis` is populated for `1st_test` as `x`/`y`; it is intentionally empty for `2nd_test` and `3rd_test` because those experiments have one channel per bearing in the IMS documentation.

For a fast validation run without overwriting the full CSV:

```powershell
$env:IMS_FEATURE_MAX_FILES = "2"
$env:IMS_FEATURE_WRITE_OUTPUT = "0"
python -m jupyter nbconvert --to notebook --execute --inplace notebooks\02_ims_feature_engineering.ipynb
```

## Degradation Visualization and Baseline Anomaly Detection

Third notebook:

```text
notebooks/03_ims_anomaly_detection.ipynb
```

Purpose: visualize degradation before training and compare two first anomaly-detection baselines while preserving chronological order.

Inputs:

```text
data/processed/ims_features.csv
```

Generated outputs:

- `artifacts/plots/ims_rms_over_time.png`
- `artifacts/plots/ims_kurtosis_over_time.png`
- `artifacts/plots/ims_crest_factor_over_time.png`
- `artifacts/plots/ims_spectral_energy_over_time.png`
- `artifacts/plots/ims_anomaly_score_comparison.png`
- `artifacts/models/ims_isolation_forest_baseline.joblib`
- `data/processed/ims_anomaly_baseline_scores.csv`

Baseline design:

- Dynamic rolling Z-score uses the early healthy portion of `1st_test`.
- Isolation Forest is trained on the same early healthy baseline rows.
- Evaluation uses the later chronological portion of `1st_test`.
- No random `train_test_split` is used.
- Experiments remain separated; the first baseline is intentionally scoped to `1st_test` because its documented failures are bearing 3 and bearing 4.

Anomaly-detection validation completed on 2026-08-30:

- Notebook executed successfully through `nbconvert`.
- Evaluation rows: `8624`.
- Evaluation timestamps: `1078`.
- Dynamic Z-score anomalies: `44`.
- Isolation Forest anomalies: `45`.
- Overlapping anomalies between both methods: `3`.
- Dynamic Z-score anomalies by bearing: bearing 1 = `3`, bearing 2 = `3`, bearing 3 = `16`, bearing 4 = `22`.
- Isolation Forest anomalies by bearing: bearing 1 = `0`, bearing 2 = `0`, bearing 3 = `45`, bearing 4 = `0`.
- RMS visualization shows clear late-life degradation near the documented failures.

## Anomaly Validation

Fourth notebook:

```text
notebooks/04_ims_anomaly_validation.ipynb
```

Purpose: validate whether anomaly alerts correspond to degradation evidence before platform integration.

Inputs inspected:

- `notebooks/03_ims_anomaly_detection.ipynb`
- `data/processed/ims_features.csv`
- `data/processed/ims_anomaly_baseline_scores.csv`
- Local IMS readme PDF at `data/raw/IMS/IMS/Readme Document for IMS Bearing Data.pdf`

Generated outputs:

- `data/processed/ims_validated_anomaly_scores.csv`
- `artifacts/metrics/ims_anomaly_validation.json`
- `artifacts/plots/ims_validation_method_f1.png`
- `artifacts/plots/ims_validation_precision_recall_windows.png`
- `artifacts/plots/ims_validation_overlap_by_bearing.png`
- `artifacts/models/ims_selected_anomaly_model_v0_1_0.joblib`
- `artifacts/models/ims_selected_anomaly_model_v0_1_0.json`

Validation design:

- Verified documented IMS failed bearings and channel mappings from the local IMS readme.
- Aggregated channel-level scores by `experiment`, `timestamp`, and `bearing`.
- Applied a trailing `3-of-5` persistence rule.
- Evaluated proxy degradation windows of `5%`, `10%`, `15%`, and `20%` before end-of-life.
- Calculated precision, recall, F1, PR-AUC, false alerts/day, alert lead time, alert episodes, and failing-bearing concentration.
- Compared Dynamic Z-score, Isolation Forest, OR, AND, and a normalized weighted combination.
- Preserved chronological order. No random train/test split was introduced.
- The weighted-combination calibration uses the earliest evaluated slice, not the proxy degradation windows.

Validation conclusions on 2026-08-31:

- The original channel-level overlap remains `3` alerts: Z-score had `44` raw alerts, Isolation Forest had `45` raw alerts, and only `3` overlapped.
- After bearing aggregation, raw overlap is `5`; after `3-of-5` persistence, overlap is `0`.
- Low overlap is expected from the method behavior: Z-score reacts to local rolling deviations, while Isolation Forest reacts to multivariate states unlike the early healthy baseline.
- Dynamic Z-score alone had no persistent alerts under the `3-of-5` rule, so it is not selected for integration.
- Isolation Forest is conservative: mean precision `0.8269`, mean recall `0.0221`, mean F1 `0.0427`, mean PR-AUC `0.4451`, and mean false alerts/day `0.1223`.
- OR is highest precision among firing methods but has lower recall: mean precision `0.9062`, mean recall `0.0158`, mean F1 `0.0309`.
- AND produced no persistent alerts and is too strict for this baseline.
- The normalized weighted combination is selected by degradation evidence, not anomaly count: mean F1 `0.0739`, mean precision `0.3686`, mean recall `0.0425`, mean PR-AUC `0.3814`, mean false alerts/day `0.7092`, failing-bearing concentration `1.0`, and mean lead time about `4.93` days.
- Selected versioned artifact: `artifacts/models/ims_selected_anomaly_model_v0_1_0.joblib`.
- Selected metadata: `artifacts/models/ims_selected_anomaly_model_v0_1_0.json`.

Limitations:

- Proxy labels use late-life windows because per-file ground-truth degradation labels are not provided.
- The current baseline score file covers only the later chronological portion of `1st_test`.
- The `3rd_test` file count remains higher than the IMS readme expectation and is not used by this baseline validation.
- No FastAPI or platform integration has been implemented.
- IMS mappings are limited to the mappings documented in the local IMS readme; undocumented mappings are not guessed.

## Deterministic Inference Pipeline

Inference module:

```text
src/inference/ims_anomaly_inference.py
```

Validation notebook:

```text
notebooks/05_ims_inference_pipeline_validation.ipynb
```

Purpose: provide a deterministic, production-ready prototype inference path without adding FastAPI, NestJS, MongoDB, or frontend integration.

Model version:

```text
0.1.0
```

Selected artifact and metadata:

- `artifacts/models/ims_selected_anomaly_model_v0_1_0.joblib`
- `artifacts/models/ims_selected_anomaly_model_v0_1_0.json`

The selected artifact was transparently updated before inference implementation because the earlier artifact did not contain every parameter required to reproduce validation. It now stores:

- Exact feature list and order.
- Dynamic Z-score threshold, rolling window, minimum periods, initial per-channel history, and per-channel baseline standard-deviation floors.
- Isolation Forest estimator loaded from the prior baseline artifact, without retraining.
- Normalization min/max values, weights, and weighted threshold.
- Bearing aggregation rule.
- Trailing `3-of-5` persistence rule.
- Documented IMS channel-to-bearing mappings.
- Stable prototype risk levels.
- Cross-experiment validation status.

Inference input schema:

Required columns:

- `timestamp`
- `experiment`
- `sensor_channel`
- `bearing`
- `axis`
- `rms`
- `standard_deviation`
- `peak_to_peak`
- `kurtosis`
- `skewness`
- `crest_factor`
- `spectral_energy`
- `dominant_frequency_hz`

Input validation rejects:

- Missing required columns.
- Missing required non-axis values.
- Non-finite feature values.
- Duplicate `experiment` + `timestamp` + `sensor_channel` rows.
- Non-chronological input within each experiment and sensor channel.
- Unknown IMS experiments or undocumented sensor mappings.
- Experiments not validated for this v0.1.0 artifact.

Inference output contract:

```json
{
  "modelVersion": "0.1.0",
  "experiment": "1st_test",
  "timestamp": "2003-11-15T18:18:46",
  "bearing": 1,
  "anomalyScore": 0.43199267712606565,
  "riskScore": 43,
  "riskLevel": "MONITOR",
  "rawAnomaly": false,
  "persistentAlert": false,
  "componentScores": {
    "zScore": 0.725035812517097,
    "isolationForest": 0.13894954173503424
  },
  "reasonCodes": ["ELEVATED_ROLLING_DEVIATION"],
  "prototypeResult": true
}
```

Risk levels are stable prototype bands, not industrially validated thresholds:

- `0-39`: `NORMAL`
- `40-69`: `MONITOR`
- `70-84`: `HIGH`
- `85-100`: `CRITICAL`

Inference validation outputs:

- `artifacts/metrics/ims_inference_pipeline_validation.json`
- `data/processed/ims_inference_pipeline_sample_predictions.json`

Inference parity results on 2026-08-31:

- Compared inference output against `data/processed/ims_validated_anomaly_scores.csv`.
- Matched rows: `4312` of `4312`.
- Boolean mismatches: `0`.
- Numeric tolerance: `1e-6`.
- Maximum numeric drift: `4.258554326952435e-7` for `z_anomaly_score`; all normalized and weighted scores were below tolerance.
- Batch versus streaming equivalence passed on `100` chronological timestamps / `400` bearing rows.
- Strict JSON parsing passed for the inference validation report and sample predictions.

Cross-experiment validation status:

- Cross-experiment validation has not been performed.
- Evidence: `artifacts/metrics/ims_anomaly_validation.json` contains `aggregation_summary` only for `1st_test`.
- The metrics JSON limitation also states that the available baseline score file covers only the later chronological portion of `1st_test`.
- Do not claim generalization to `2nd_test`, `3rd_test`, or industrial data yet.

Inference test results:

- Focused inference tests: `13` tests passed.
- Full AI-service test discovery: `18` tests passed.
- `py_compile` passed for evaluation utilities, inference utilities, and tests.
- Notebook `05_ims_inference_pipeline_validation.ipynb` executed successfully through `nbconvert`.

Inference limitations:

- The v0.1.0 inference artifact is validated only on the later chronological portion of `1st_test`.
- Proxy degradation labels were used during model selection because per-file ground-truth labels are unavailable.
- The selected weighted method is a prototype scoring configuration, not a certified industrial safety threshold.
- The `3rd_test` file count remains higher than the IMS readme expectation and has not been used for this inference parity validation.
- No alert is generated from Gemini or textual interpretation.
- No FastAPI, NestJS, MongoDB, frontend, or platform integration has been implemented.

## Progress Log

- Step 1: Created the `ai-service` folder structure for data, notebooks, source code, artifacts, and tests.
- Step 2: Added the initial AI-service README and placeholder files so empty folders are preserved.
- Step 3: Created `.venv`, upgraded pip, installed the data-science/Jupyter dependencies, and froze `requirements.txt`.
- Step 4: Started Jupyter and created the IMS dataset audit notebook as the first deliverable.
- Step 5: Verified `4th_test` was removed, confirmed `3rd_test` extraction, fixed IMS timestamp parsing for extensionless files, added explicit extra-file reporting, and reran the audit smoke validation.
- Step 6: Created the IMS feature-engineering notebook, calculated initial time-domain and frequency-domain features, generated `data/processed/ims_features.csv`, and validated the output table.
- Step 7: Created degradation plots for RMS, kurtosis, crest factor, and spectral energy over time.
- Step 8: Created the first anomaly-detection notebook, implemented a chronological rolling Z-score baseline, implemented Isolation Forest on the same healthy baseline, saved model/scores/plots, and validated the comparison output.
- Step 9: Created and executed the IMS anomaly-validation notebook, added reusable validation utilities and tests, generated validated anomaly scores, metrics JSON, validation plots, and versioned selected-method artifacts, and documented factual conclusions and limitations.
- Step 10: Fixed the selected v0.1.0 artifact to include all reproducibility parameters required for inference, created the deterministic inference module, added inference tests, validated parity against notebook 04 outputs, verified batch and streaming behavior, generated JSON-safe sample outputs, and documented cross-experiment limitations.

Going forward, update this README after each instruction with the completed steps, validation results, and any known next action.
