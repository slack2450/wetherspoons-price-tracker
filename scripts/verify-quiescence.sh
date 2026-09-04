#!/usr/bin/env bash
set -euo pipefail

readonly AWS_REGION="eu-west-2"
readonly SCHEDULE_NAME="wetherspoons-operational-hours"
readonly SOURCE_QUEUE_NAME="wetherspoons-queue"
readonly DLQ_NAME="wetherspoons-dead-letter-queue"
readonly MAX_ATTEMPTS="${QUIESCENCE_MAX_ATTEMPTS:-20}"
readonly POLL_SECONDS="${QUIESCENCE_POLL_SECONDS:-30}"
readonly REQUIRED_STABLE_POLLS="${QUIESCENCE_STABLE_POLLS:-3}"
readonly PUBLISHER_SETTLE_SECONDS="${QUIESCENCE_PUBLISHER_WAIT_SECONDS:-125}"

if [[ ! "$PUBLISHER_SETTLE_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "QUIESCENCE_PUBLISHER_WAIT_SECONDS must be a non-negative integer" >&2
  exit 1
fi

schedule_state="$(aws scheduler get-schedule \
  --region "$AWS_REGION" \
  --name "$SCHEDULE_NAME" \
  --query State \
  --output text)"
if [[ "$schedule_state" != "DISABLED" ]]; then
  echo "Collector schedule is $schedule_state; expected DISABLED" >&2
  exit 1
fi

if ((PUBLISHER_SETTLE_SECONDS > 0)); then
  echo "Waiting ${PUBLISHER_SETTLE_SECONDS}s for any publisher invocation already in progress"
  sleep "$PUBLISHER_SETTLE_SECONDS"
fi

source_queue_url="$(aws sqs get-queue-url \
  --region "$AWS_REGION" \
  --queue-name "$SOURCE_QUEUE_NAME" \
  --query QueueUrl \
  --output text)"

stable_polls=0
for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)); do
  read -r visible in_flight delayed < <(aws sqs get-queue-attributes \
    --region "$AWS_REGION" \
    --queue-url "$source_queue_url" \
    --attribute-names \
      ApproximateNumberOfMessages \
      ApproximateNumberOfMessagesNotVisible \
      ApproximateNumberOfMessagesDelayed \
    --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible,ApproximateNumberOfMessagesDelayed]' \
    --output text)

  echo "Source queue attempt=$attempt visible=$visible in_flight=$in_flight delayed=$delayed"
  if [[ "$visible" == "0" && "$in_flight" == "0" && "$delayed" == "0" ]]; then
    stable_polls=$((stable_polls + 1))
    if ((stable_polls >= REQUIRED_STABLE_POLLS)); then
      break
    fi
  else
    stable_polls=0
  fi

  if ((attempt < MAX_ATTEMPTS)); then
    sleep "$POLL_SECONDS"
  fi
done

if ((stable_polls < REQUIRED_STABLE_POLLS)); then
  echo "Source queue did not remain empty for $REQUIRED_STABLE_POLLS checks" >&2
  exit 1
fi

dlq_url="$(aws sqs get-queue-url \
  --region "$AWS_REGION" \
  --queue-name "$DLQ_NAME" \
  --query QueueUrl \
  --output text)"
read -r dlq_visible dlq_in_flight dlq_delayed < <(aws sqs get-queue-attributes \
  --region "$AWS_REGION" \
  --queue-url "$dlq_url" \
  --attribute-names \
    ApproximateNumberOfMessages \
    ApproximateNumberOfMessagesNotVisible \
    ApproximateNumberOfMessagesDelayed \
  --query 'Attributes.[ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible,ApproximateNumberOfMessagesDelayed]' \
  --output text)
if [[ "$dlq_visible" != "0" || "$dlq_in_flight" != "0" || "$dlq_delayed" != "0" ]]; then
  echo "DLQ is not empty: visible=$dlq_visible in_flight=$dlq_in_flight delayed=$dlq_delayed" >&2
  exit 1
fi

echo "QUIESCENCE_OK source_queue=empty dlq=empty"
