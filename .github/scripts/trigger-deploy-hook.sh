#!/usr/bin/env bash
set -euo pipefail

name="${1:?deployment name is required}"
url="${2:?deployment hook URL is required}"
summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"
response_file="$(mktemp)"
max_attempts="${DEPLOY_HOOK_MAX_ATTEMPTS:-8}"
methods=(POST GET)

cleanup() {
  rm -f "$response_file"
}
trap cleanup EXIT

for attempt in $(seq 1 "$max_attempts"); do
  retryable_failure=false

  for method in "${methods[@]}"; do
    : > "$response_file"
    status=$(
      curl \
        --connect-timeout 10 \
        --max-time 30 \
        --silent \
        --show-error \
        --request "$method" \
        --output "$response_file" \
        --write-out "%{http_code}" \
        "$url" || true
    )
    status=${status:-000}

    if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
      echo "$name deployment hook accepted $method with HTTP $status."
      echo "- $name deployment hook accepted $method with HTTP $status" >> "$summary_file"
      exit 0
    fi

    body="$(head -c 500 "$response_file" | tr '\n' ' ')"
    if [ "$status" = "429" ] || [ "$status" -ge 500 ]; then
      retryable_failure=true
      echo "Attempt $attempt/$max_attempts: $name deploy hook $method returned HTTP $status."
      [ -n "$body" ] && echo "Response body: $body"
      continue
    fi

    echo "::error::$name deployment hook $method returned non-retryable HTTP $status."
    [ -n "$body" ] && echo "Response body: $body"
    echo "- $name deployment hook FAILED on $method with HTTP $status" >> "$summary_file"
    exit 1
  done

  if [ "$retryable_failure" = true ] && [ "$attempt" -lt "$max_attempts" ]; then
    echo "Retrying $name deploy hook in $((attempt * 10))s..."
    sleep $((attempt * 10))
    continue
  fi

  echo "::error::$name deployment hook kept failing after $max_attempts attempts."
  echo "- $name deployment hook FAILED after retries" >> "$summary_file"
  exit 1
done
