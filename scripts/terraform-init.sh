#!/usr/bin/env bash
set -euo pipefail

# Allow slow release-asset redirects to finish before retrying the request.
export TF_REGISTRY_CLIENT_TIMEOUT="${TF_REGISTRY_CLIENT_TIMEOUT:-60}"

# Provider registries and release-asset downloads can return transient 5xx
# responses. Retry initialization without relaxing signature or lock checks.
for attempt in 1 2 3 4 5; do
  if terraform init -input=false "$@"; then
    exit 0
  else
    status=$?
  fi
  if (( attempt == 5 )); then
    exit "$status"
  fi
  echo "Terraform initialization failed (attempt $attempt/5); retrying in 20 seconds."
  sleep 20
done
