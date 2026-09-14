# IPROTEX AI architecture and safety contract

## Boundaries

The browser calls NestJS only. NestJS authenticates the user, applies role and
machine access, validates responses, and persists audit records. FastAPI is an
internal model-serving process protected by `AI_SERVICE_TOKEN`. Gemini and
MongoDB Atlas are also backend-only dependencies.

## AI capabilities

### IMS anomaly detection

The IMS pipeline asks whether imported bearing-vibration features differ from
its research baseline. Dynamic Z-score and Isolation Forest component scores
are aggregated and passed through a temporal persistence rule. The score is an
anomaly indicator, not diagnostic accuracy or failure probability.

Version 0.1 is limited to `1st_test`. Version 0.2 uses a leakage-controlled,
multi-experiment research protocol, but its recall and held-out `3rd_test`
result are insufficient for operational deployment. Both versions remain
research models and are not validated on IPROTEX machines.

### CWRU bearing fault diagnosis

The CWRU Random Forest classifies vibration windows among its supported
benchmark bearing classes. It is loaded and validated once per FastAPI process
and appears in the heterogeneous model registry as `FAULT_DIAGNOSIS`.
Benchmark confidence is confidence among supported classes; it is not the
probability that an IPROTEX machine will fail. The model is experimental and
has no live factory-data claim.

### Internal algorithmic health indicators

NestJS also provides Z-score, Isolation Forest, DBSCAN, and simplified
autoencoder indicators derived from available platform records. These are
algorithmic health indicators. Their health and confidence values are not
factory-validated failure probabilities and are separate from IMS analysis.

### Gemini and RAG

Technical documents are extracted, chunked, embedded with Gemini, stored in
MongoDB, retrieved through Atlas Vector Search with role and machine filters,
and supplied to Gemini as evidence. The response includes only authorized
sources. With insufficient evidence the assistant abstains. Gemini output is
advisory and cannot create or close work orders.

## Authorization

- Admin: model registry and lifecycle, dataset replay, history and validation.
- Technician: authorized analysis submission, history, validation, and RAG.
- Operator: permitted maintenance assistant only; no raw model input, replay,
  lifecycle control, or technical AI history.

## Lifecycle and deployment

Model enablement is process-local. Deploy FastAPI with one worker. A process
restart returns models to their configured startup state. `loaded=true` means
the artifact was successfully deserialized and its required contract was
validated. `/health` reports process liveness; `/ready` verifies served model
artifacts. New inference is rejected when a model is disabled, while an
already-running IMS request may complete.

## Human decision boundary

AI never automatically creates, completes, assigns, or closes maintenance
work. Model results must retain model version, source, validation scope, and
human validation state. A technician must confirm machine condition before a
maintenance decision.
