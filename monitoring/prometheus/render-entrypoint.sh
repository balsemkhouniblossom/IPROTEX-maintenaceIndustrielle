#!/bin/sh
set -eu

if [ -z "${BACKEND_URL:-}" ]; then
  echo "BACKEND_URL is required, for example https://gmao-backend.onrender.com" >&2
  exit 1
fi

if [ -z "${METRICS_BEARER_TOKEN:-}" ]; then
  echo "METRICS_BEARER_TOKEN is required for Prometheus to scrape /health/metrics" >&2
  exit 1
fi

backend_url="${BACKEND_URL%/}"
backend_scheme="${backend_url%%://*}"
backend_rest="${backend_url#*://}"

if [ "$backend_scheme" = "$backend_url" ]; then
  echo "BACKEND_URL must include http:// or https://" >&2
  exit 1
fi

case "$backend_scheme" in
  http|https) ;;
  *)
    echo "BACKEND_URL must use http or https" >&2
    exit 1
    ;;
esac

backend_target="${backend_rest%%/*}"
if [ -z "$backend_target" ] || [ "$backend_target" != "$backend_rest" ]; then
  echo "BACKEND_URL must be the backend origin only, without a path" >&2
  exit 1
fi

mkdir -p /prometheus/secrets
printf '%s' "$METRICS_BEARER_TOKEN" > /prometheus/secrets/metrics-bearer-token
chmod 0400 /prometheus/secrets/metrics-bearer-token

sed \
  -e "s|__BACKEND_SCHEME__|$backend_scheme|g" \
  -e "s|__BACKEND_TARGET__|$backend_target|g" \
  /etc/prometheus/prometheus.template.yml > /tmp/prometheus.yml

exec /bin/prometheus \
  --config.file=/tmp/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --web.listen-address="0.0.0.0:${PORT:-9090}" \
  --web.enable-lifecycle \
  --web.external-url="${PROMETHEUS_EXTERNAL_URL:-http://localhost:9090}"
