#!/bin/sh
set -eu

if [ -z "${GF_SECURITY_ADMIN_PASSWORD:-}" ]; then
  echo "GF_SECURITY_ADMIN_PASSWORD is required for Grafana admin login" >&2
  exit 1
fi

if [ -z "${PROMETHEUS_URL:-}" ]; then
  echo "PROMETHEUS_URL is required for Grafana datasource provisioning" >&2
  exit 1
fi

export GF_SERVER_HTTP_ADDR="${GF_SERVER_HTTP_ADDR:-0.0.0.0}"
export GF_SERVER_HTTP_PORT="${PORT:-3000}"

exec /run.sh
