#!/usr/bin/env bash
set -euo pipefail

readonly AWS_REGION="eu-west-2"
readonly RUN_TABLE_NAME="wetherspoons-runs"
readonly FUNCTION_NAME="wetherspoons-pub-fetcher"
readonly RUN_ID="retire-snapshots-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
readonly OBSERVED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

payload="$(jq -nc --arg id "$RUN_ID" --arg time "$OBSERVED_AT" '{id:$id,time:$time}')"
invoke_result="$(aws lambda invoke \
  --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload "$payload" \
  /tmp/collector-invoke.json)"

if jq -e '.FunctionError' <<<"$invoke_result" >/dev/null; then
  cat /tmp/collector-invoke.json >&2
  exit 1
fi

for ((attempt = 1; attempt <= 120; attempt += 1)); do
  status="$(aws dynamodb get-item \
    --region "$AWS_REGION" \
    --table-name "$RUN_TABLE_NAME" \
    --key "{\"runId\":{\"S\":\"$RUN_ID\"}}" \
    --consistent-read \
    --query 'Item.status.S' \
    --output text)"
  echo "Collector smoke attempt=$attempt runId=$RUN_ID status=$status"

  case "$status" in
    COMPLETE)
      scripts/verify-quiescence.sh
      echo "COLLECTOR_SMOKE_OK runId=$RUN_ID"
      exit 0
      ;;
    PUBLISH_FAILED)
      echo "Collector smoke publish failed for run $RUN_ID" >&2
      exit 1
      ;;
  esac

  sleep 15
done

echo "Collector smoke did not complete within 30 minutes: $RUN_ID" >&2
exit 1
