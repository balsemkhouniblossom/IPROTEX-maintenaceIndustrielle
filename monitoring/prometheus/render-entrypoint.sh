#!/bin/sh
set -eu

if [ -z "${METRICS_BEARER_TOKEN:-}" ]; then
  echo "METRICS_BEARER_TOKEN is required for Prometheus to scrape /health/metrics" >&2
  exit 1
fi

mkdir -p /prometheus/secrets
printf '%s' "$METRICS_BEARER_TOKEN" > /prometheus/secrets/metrics-bearer-token
chmod 0400 /prometheus/secrets/metrics-bearer-token

exec /bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --web.enable-lifecycle \
  --web.external-url="${PROMETHEUS_EXTERNAL_URL:-http://localhost:9090}"
