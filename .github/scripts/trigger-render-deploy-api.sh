#!/usr/bin/env bash
set -euo pipefail

name="${1:?deployment name is required}"
service_id="${2:?Render service ID is required}"
api_key="${3:?Render API key is required}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"
response_file="$(mktemp)"
max_attempts=5

cleanup() {
  rm -f "$response_file"
}
trap cleanup EXIT

for attempt in $(seq 1 "$max_attempts"); do
  status=$(
    curl \
      --connect-timeout 10 \
      --max-time 30 \
      --silent \
      --show-error \
      --request POST \
      --header "Authorization: Bearer $api_key" \
      --header "Content-Type: application/json" \
      --data '{}' \
      --output "$response_file" \
      --write-out "%{http_code}" \
      "https://api.render.com/v1/services/$service_id/deploys" || true
  )
  status=${status:-000}

  if [ "$status" = "201" ] || [ "$status" = "202" ]; then
    echo "$name Render API deploy accepted with HTTP $status."
    echo "- $name Render API deploy accepted with HTTP $status" >> "$summary_file"
    exit 0
  fi

  body="$(head -c 500 "$response_file" | tr '\n' ' ')"
  if [ "$status" = "429" ] || [ "$status" -ge 500 ]; then
    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "Attempt $attempt/$max_attempts: $name Render API returned HTTP $status. Retrying in $((attempt * 10))s..."
      [ -n "$body" ] && echo "Response body: $body"
      sleep $((attempt * 10))
      continue
    fi

    echo "::error::$name Render API kept returning HTTP $status after $max_attempts attempts."
    [ -n "$body" ] && echo "Response body: $body"
    echo "- $name Render API deploy FAILED after retries (last HTTP $status)" >> "$summary_file"
    exit 1
  fi

  echo "::error::$name Render API returned non-retryable HTTP $status."
  [ -n "$body" ] && echo "Response body: $body"
  echo "- $name Render API deploy FAILED with HTTP $status" >> "$summary_file"
  exit 1
done
