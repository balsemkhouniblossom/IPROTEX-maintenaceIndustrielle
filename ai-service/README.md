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

## Progress Log

- Step 1: Created the `ai-service` folder structure for data, notebooks, source code, artifacts, and tests.
- Step 2: Added the initial AI-service README and placeholder files so empty folders are preserved.
- Step 3: Created `.venv`, upgraded pip, installed the data-science/Jupyter dependencies, and froze `requirements.txt`.
- Step 4: Started Jupyter and created the IMS dataset audit notebook as the first deliverable.
- Step 5: Verified `4th_test` was removed, confirmed `3rd_test` extraction, fixed IMS timestamp parsing for extensionless files, added explicit extra-file reporting, and reran the audit smoke validation.
- Step 6: Created the IMS feature-engineering notebook, calculated initial time-domain and frequency-domain features, generated `data/processed/ims_features.csv`, and validated the output table.
- Step 7: Created degradation plots for RMS, kurtosis, crest factor, and spectral energy over time.
- Step 8: Created the first anomaly-detection notebook, implemented a chronological rolling Z-score baseline, implemented Isolation Forest on the same healthy baseline, saved model/scores/plots, and validated the comparison output.

Going forward, update this README after each instruction with the completed steps, validation results, and any known next action.
