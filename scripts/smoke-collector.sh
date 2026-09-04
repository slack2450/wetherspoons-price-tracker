#!/usr/bin/env bash
set -euo pipefail

readonly AWS_REGION="eu-west-2"
readonly FUNCTION_NAME="wetherspoons-pub-fetcher"
readonly RUN_ID="collector-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
readonly OBSERVED_AT="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
readonly START_TIME_MS="$(( $(date +%s) * 1000 - 60000 ))"
readonly MENU_LOG_GROUP="/aws/lambda/wetherspoons-menu-fetcher"

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

published_count="$(jq -r '.publishedCount // 0' /tmp/collector-invoke.json)"
returned_run_id="$(jq -r '.runId // ""' /tmp/collector-invoke.json)"
if [[ "$returned_run_id" != "$RUN_ID" || ! "$published_count" =~ ^[0-9]+$ || "$published_count" -lt 500 ]]; then
  echo "Collector returned an invalid publish summary:" >&2
  cat /tmp/collector-invoke.json >&2
  exit 1
fi

for ((attempt = 1; attempt <= 120; attempt += 1)); do
  terminal_count="$(aws logs filter-log-events \
    --region "$AWS_REGION" \
    --log-group-name "$MENU_LOG_GROUP" \
    --start-time "$START_TIME_MS" \
    --filter-pattern "\"$RUN_ID\"" \
    --query 'events[].message' \
    --output text \
    | tr '\t' '\n' \
    | sed -nE 's/.*\(([0-9]+)\) (points|reason)=.*/\1/p' \
    | sort -u \
    | wc -l)"
  echo "Collector smoke attempt=$attempt runId=$RUN_ID terminal=$terminal_count/$published_count"

  if ((terminal_count >= published_count)); then
    scripts/verify-quiescence.sh
    echo "COLLECTOR_SMOKE_OK runId=$RUN_ID terminal=$terminal_count published=$published_count"
    exit 0
  fi

  sleep 15
done

echo "Collector smoke did not complete within 30 minutes: $RUN_ID" >&2
exit 1
