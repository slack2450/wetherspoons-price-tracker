#!/usr/bin/env bash
set -euo pipefail

readonly AWS_REGION=eu-west-2
readonly RUN_ID="specials-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
smoke_tmp="$(mktemp -d)"
trap 'rm -rf -- "$smoke_tmp"' EXIT

# Use current venue metadata and the installed registry package. Invoke the
# deployed collector directly with four fresh observations; do not consume or
# replay historical queue messages. Successful writes are normal price data.
node --input-type=module - "$smoke_tmp/payload.json" "$RUN_ID" <<'JS'
import { writeFileSync } from 'node:fs';
import { venues } from './wetherspoons-menu-fetcher/node_modules/wetherspoons-api/dist/index.js';

const [payloadPath, runId] = process.argv.slice(2);
const allVenues = await venues();
if (allVenues.length < 500) throw new Error('Venue discovery returned fewer than 500 pubs');
const observedAt = new Date().toISOString();
const Records = [7578, 7591, 7634, 7934].map(venueRef => {
  const venue = allVenues.find(value => value.venueRef === venueRef);
  if (!venue || venue.isClosed) throw new Error(`Smoke venue unavailable: ${venueRef}`);
  return {
    messageId: `${runId}-${venueRef}`,
    attributes: { ApproximateReceiveCount: '1' },
    body: JSON.stringify({ Message: JSON.stringify({ runId, observedAt, venue }) }),
  };
});
writeFileSync(payloadPath, JSON.stringify({ Records }));
console.log(`SPECIALS_SMOKE_START runId=${runId} discovered=${allVenues.length} pubs=${Records.length}`);
JS

aws lambda invoke --region "$AWS_REGION" --function-name wetherspoons-menu-fetcher \
  --cli-read-timeout 150 --cli-binary-format raw-in-base64-out --log-type Tail \
  --payload "file://$smoke_tmp/payload.json" "$smoke_tmp/result.json" \
  > "$smoke_tmp/invoke.json"
jq -r '.LogResult // ""' "$smoke_tmp/invoke.json" | base64 --decode > "$smoke_tmp/log.txt"
cat "$smoke_tmp/log.txt"
jq -e 'has("FunctionError") | not' "$smoke_tmp/invoke.json" > /dev/null
jq -e '.batchItemFailures == []' "$smoke_tmp/result.json" > /dev/null
for venue_id in 7578 7591 7634 7934; do
  grep -Eq "MENU_WRITTEN runId=$RUN_ID .*\($venue_id\) points=[1-9][0-9]*" "$smoke_tmp/log.txt"
done
echo "SPECIALS_SMOKE_OK runId=$RUN_ID written=4 pubs=7578,7591,7634,7934"
