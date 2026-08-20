#!/usr/bin/env bash
set -euo pipefail

name="${1:?deployment name is required}"
url="${2:?deployment hook URL is required}"
response_file="$(mktemp)"

cleanup() {
  rm -f "$response_file"
}
trap cleanup EXIT

for attempt in $(seq 1 5); do
  status=$(
    curl \
      --silent \
      --show-error \
      --request POST \
      --output "$response_file" \
      --write-out "%{http_code}" \
      "$url" || true
  )
  status=${status:-000}

  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    echo "$name deployment hook accepted with HTTP $status."
    echo "- $name deployment hook accepted with HTTP $status" >> "$GITHUB_STEP_SUMMARY"
    exit 0
  fi

  body="$(head -c 500 "$response_file" | tr '\n' ' ')"
  if [ "$status" = "429" ] || [ "$status" -ge 500 ]; then
    if [ "$attempt" -lt 5 ]; then
      echo "Attempt $attempt/5: $name deploy hook returned HTTP $status. Retrying in $((attempt * 10))s..."
      [ -n "$body" ] && echo "Response body: $body"
      sleep $((attempt * 10))
      continue
    fi

    echo "::error::$name deployment hook kept returning HTTP $status after 5 attempts."
    [ -n "$body" ] && echo "Response body: $body"
    echo "- $name deployment hook FAILED after retries (last HTTP $status)" >> "$GITHUB_STEP_SUMMARY"
    exit 1
  fi

  echo "::error::$name deployment hook returned non-retryable HTTP $status."
  [ -n "$body" ] && echo "Response body: $body"
  echo "- $name deployment hook FAILED with HTTP $status" >> "$GITHUB_STEP_SUMMARY"
  exit 1
done
