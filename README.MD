# Wetherspoons price tracker 🍻\

## This API is working as of May 22nd (with caveats)

This repository contains the code for some AWS Lambda functions to track the price of every drink in every Wetherspoons pub.

This repo also contains a very simple lib in the `lib/` folder

## The caveats:

- It currently doesn't have a way to track the special Ale's name please see [this issue](https://github.com/slack2450/wetherspoons-price-tracker/issues/1) for more details

## Coordinated API v3 release

The three upstream consumers are intentionally pinned to `wetherspoons-api@2.1.1`
until version 3 is published. The exact pin prevents an ordinary install from
silently changing their runtime contract. The API token is the public client
token shipped by Wetherspoons' own application; it is deliberately included in
version 3 and is not a secret requiring rotation. The Lambda functions are
unversioned and updated in place, so allowing old and new collectors to process
the same run is still unsafe.

1. Publish `wetherspoons-api@3.0.0` from the sibling API repository only after
   its real, full-venue GitHub Actions suite succeeds.
2. Disable the existing EventBridge schedule directly with the AWS Scheduler
   console or API as an out-of-band operational action, and confirm it is
   disabled. Then set the Terraform workspace variable
   `collector_schedule_state` to `DISABLED`, but do not apply the pending
   working-tree Terraform plan yet. This prevents the later full apply from
   re-enabling the schedule while it updates the unversioned Lambdas.
3. Let the source SQS queue drain. Verify that its visible, in-flight, and
   delayed message counts are all zero, no menu-fetcher invocations remain,
   and the run ledger contains no `PROCESSING` or `PUBLISH_FAILED` runs. Resolve
   or deliberately redrive the DLQ while the old code and snapshots are still
   available; do not discard unresolved messages.
4. Change the dependency in `wetherspoons-pub-fetcher`,
   `wetherspoons-menu-fetcher`, and `wetherspoons-api/proxy` to `^3.0.0`, refresh
   all three lockfiles, and run `./build.sh`. The build scans every generated
   JavaScript chunk and ZIP entry for build-machine paths and missing chunks.
5. Review a saved Terraform plan, then apply all tracker Lambda, API origin
   gate, concurrency, retention, and infrastructure changes while the schedule
   remains disabled. Do not split the unversioned pub/menu Lambda cutover across
   active runs.
6. Smoke-test the deployed API through CloudFront. Confirm the CloudFront price,
   venue, and drinks routes work, while the corresponding direct execute-api
   requests receive `403`. Run one manually triggered collector cycle and
   verify that it reaches `COMPLETE` before proceeding.
7. Deploy and smoke-test the browser frontend after the tracker API is healthy.
8. Set `collector_schedule_state` back to `ENABLED`, apply, and verify the next
   scheduled run reaches `COMPLETE`. Keep the 21-day ledger and snapshot
   retention in place so every message in the 14-day DLQ remains recoverable.
