# Wetherspoons price tracker 🍻\

## This API is working as of May 22nd (with caveats)

This repository contains the code for some AWS Lambda functions to track the price of every drink in every Wetherspoons pub.

This repo also contains a very simple lib in the `lib/` folder

## The caveats:

- It currently doesn't have a way to track the special Ale's name please see [this issue](https://github.com/slack2450/wetherspoons-price-tracker/issues/1) for more details

## Collection notifications

An isolated pub exhausting its retries on one UK calendar day does not email.
The hourly `wetherspoons-pub-failure-monitor` compares failed collections on
today and yesterday in `Europe/London`. The same pub failing on both days raises
`wetherspoons-recurring-pub-failures`. Different pubs on different days, or many
retries on just one day, do not qualify. A healthy day breaks the recurrence.
An incident can notify again on a subsequent day; it does not notify every hour.

The monitor runs at ten past each hour, allows five minutes for log ingestion,
and writes the affected pub IDs in `PUB_FAILURE_SUMMARY` in its CloudWatch log
group. It attributes failures to the message's original collection day, so
retries crossing midnight do not create a spurious second day. During rollout,
legacy partial-menu errors use the log timestamp because they lack that field.
Closed pubs and legitimate unavailable menus are not failed records.

Broader faults retain email alerts:

- `menu-record-failures`: at least ten distinct pubs exhausted retries during
  the monitor's most recent fully ingested hour.
- `wetherspoons-source-queue-too-old`: message age exceeds 30 minutes with at
  least ten outstanding records in two of three five-minute periods. Requiring
  two periods excludes the brief overlap between a new hourly batch and an
  isolated old retry.
- Existing collector invocation errors, throttling, and scheduler delivery
  errors continue to alert. Monitor invocation/delivery failures and records
  without an identifiable pub also alert rather than silently losing coverage.

The DLQ alarm remains visible in CloudWatch but has no email action: historical
dead letters alone cannot bypass the per-pub policy. No messages are purged,
received, or redriven by the monitor. Its role can query the collector log group
and publish monitoring metrics; it cannot modify queues or collection data.

Run `./build.sh` to test and package all functions, including the Python monitor.
Run `terraform fmt -check -recursive` and `terraform validate` before deployment.
Production uses the existing manually dispatched `Deploy production` workflow.
For this compatible logging/monitoring change, dispatch it with
`monitoring_only=true`. This path creates and invokes the new monitor first,
then applies only the collector code and three existing alarm updates. It
checks saved plans against an explicit resource allowlist, rejects deletions
and collector configuration changes, verifies the deployed code hash and alarm
definitions, and verifies the collector schedule was left unchanged. Historical
DLQ messages do not need to be drained or deleted for this scoped deployment.
After deployment, check the monitor's first successful hourly run, its three
custom metrics, and the updated alarm definitions. Do not infer success from
an `OK` alarm alone: a missing monitor result must also be investigated.

Failure and retry logs include the original collection timestamp, pub identity,
menu/sales-area identity, HTTP status, and bounded nested error or schema details.
The collector pins `wetherspoons-api` to the tested diagnostics source commit;
replace that pin with a registry version after the library's normal publish
workflow releases it. No retry timing or incomplete-snapshot handling changed.
