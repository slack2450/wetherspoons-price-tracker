#!/usr/bin/env bash
set -euo pipefail

readonly AWS_REGION=eu-west-2
readonly MONITOR=wetherspoons-pub-failure-monitor
readonly SCHEDULE=wetherspoons-operational-hours
deployment_tmp="$(mktemp -d)"
trap 'rm -rf -- "$deployment_tmp"' EXIT

schedule_before="$(aws scheduler get-schedule --region "$AWS_REGION" --name "$SCHEDULE" --query State --output text)"

apply_phase() {
  local phase="$1"
  local -a targets
  mapfile -t targets < <(node scripts/monitoring-plan.mjs "$phase")
  terraform plan -input=false -out="$deployment_tmp/$phase.tfplan" "${targets[@]}"
  terraform show -json "$deployment_tmp/$phase.tfplan" > "$deployment_tmp/$phase.json"
  node scripts/monitoring-plan.mjs "$phase" "$deployment_tmp/$phase.json"
  terraform apply -input=false -auto-approve "$deployment_tmp/$phase.tfplan"
}

# Prove the new monitor can read logs and publish its metrics before changing
# any existing notification policy. No source queue or DLQ operation is used.
apply_phase monitor
aws lambda wait function-active-v2 --region "$AWS_REGION" --function-name "$MONITOR"
aws lambda invoke --region "$AWS_REGION" --function-name "$MONITOR" \
  --cli-binary-format raw-in-base64-out --payload '{}' \
  "$deployment_tmp/monitor-result.json" > "$deployment_tmp/monitor-invoke.json"
jq -e 'has("FunctionError") | not' "$deployment_tmp/monitor-invoke.json"
jq -e '.recurringPubs | type == "array"' "$deployment_tmp/monitor-result.json"
cat "$deployment_tmp/monitor-result.json"

apply_phase collector
for function_name in wetherspoons-menu-fetcher wetherspoons-pub-fetcher; do
  aws lambda wait function-updated-v2 --region "$AWS_REGION" --function-name "$function_name"
  expected_hash="$(openssl dgst -sha256 -binary "$function_name/dist/index.zip" | openssl base64 -A)"
  actual_hash="$(aws lambda get-function-configuration --region "$AWS_REGION" --function-name "$function_name" --query CodeSha256 --output text)"
  test "$actual_hash" = "$expected_hash"
  echo "FETCHER_CODE_VERIFIED function=$function_name"
done
test "$(aws scheduler get-schedule --region "$AWS_REGION" --name "$SCHEDULE" --query State --output text)" = "$schedule_before"

aws cloudwatch describe-alarms --region "$AWS_REGION" \
  --alarm-names wetherspoons-source-queue-too-old menu-record-failures wetherspoons-dead-letter-queue-not-empty \
  > "$deployment_tmp/alarms.json"
jq -e '[.MetricAlarms[] | select(.AlarmName == "wetherspoons-source-queue-too-old")][0] | .DatapointsToAlarm == 2 and .EvaluationPeriods == 3 and (.Metrics | any(.Expression == "IF(age > 1800 AND (visible + inflight) >= 10, 1, 0)"))' "$deployment_tmp/alarms.json"
jq -e '[.MetricAlarms[] | select(.AlarmName == "menu-record-failures")][0] | .MetricName == "FailedPubsLastHour" and .Threshold == 9' "$deployment_tmp/alarms.json"
jq -e '[.MetricAlarms[] | select(.AlarmName == "wetherspoons-dead-letter-queue-not-empty")][0] | .AlarmActions == []' "$deployment_tmp/alarms.json"
scripts/smoke-affected-pubs.sh
aws cloudwatch describe-alarms --region "$AWS_REGION" \
  --query 'MetricAlarms[].{name:AlarmName,state:StateValue,reason:StateReason}' --output json
echo "MONITORING_DEPLOY_OK collector_code=verified publisher_code=verified monitor=invoked schedule=$schedule_before"
