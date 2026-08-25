# Production Monitoring

This directory contains the deployable Prometheus/Grafana monitoring stack for
the production GMAO backend.

## Authentication

`GET /health/metrics` accepts either a normal admin JWT or the dedicated
`METRICS_BEARER_TOKEN` configured on the backend. Prometheus uses the dedicated
token so scraping is not tied to a short-lived user session.

Generate one strong token and set the same value in:

- Render backend service: `METRICS_BEARER_TOKEN`
- Render Prometheus service: `METRICS_BEARER_TOKEN`

Example:

```bash
openssl rand -base64 48
```

## Services

The repo-root `render.yaml` defines:

- `gmao-backend`: the NestJS production API
- `gmao-prometheus`: scrapes `${BACKEND_URL}/health/metrics`
- `gmao-grafana`: provisions the Prometheus datasource and the backend overview dashboard

Set these service secrets before deploying the monitoring services:

```text
BACKEND_URL
METRICS_BEARER_TOKEN
GF_SECURITY_ADMIN_PASSWORD
PROMETHEUS_URL
```

`BACKEND_URL` must be the backend origin only, for example
`https://gmao-backend.onrender.com`, with no trailing path. `PROMETHEUS_URL`
must be the Prometheus service origin, for example
`https://gmao-prometheus.onrender.com`.
