# Wetherspoons price tracker 🍻\

## This API is working as of May 22nd (with caveats)

This repository contains the code for some AWS Lambda functions to track the price of every drink in every Wetherspoons pub.

This repo also contains a very simple lib in the `lib/` folder

## The caveats:

- It currently doesn't have a way to track the special Ale's name please see [this issue](https://github.com/slack2450/wetherspoons-price-tracker/issues/1) for more details

## Coordinated API v3 release

The three upstream consumers are intentionally pinned to `wetherspoons-api@2.1.1`
until version 3 is published. The exact pin prevents an ordinary install from
silently taking the breaking server-token contract. Version 2.1.1 contains a
legacy embedded upstream credential, so do not deploy newly built collector or
proxy bundles until the following maintenance-window procedure is complete.
The Lambda functions are unversioned and are updated in place, so allowing old
and new collectors to process the same run is unsafe.

1. Publish `wetherspoons-api@3.0.0` from the sibling API repository, but do not
   rotate the existing upstream credential yet.
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
   JavaScript chunk and every ZIP entry for the legacy embedded credential.
5. Review a saved Terraform plan, then apply all tracker Lambda, API origin
   gate, concurrency, retention, and infrastructure changes while the schedule
   remains disabled. Do not split the unversioned pub/menu Lambda cutover across
   active runs.
6. Smoke-test the deployed API through CloudFront. Confirm the CloudFront price,
   venue, and drinks routes work, while the corresponding direct execute-api
   requests receive `403`. Run one manually triggered collector cycle and
   verify that it reaches `COMPLETE` before proceeding.
7. Deploy and smoke-test the browser frontend after the tracker API is healthy.
8. Only after every collector and proxy is confirmed to use v3's environment
   credential, rotate the historically exposed upstream credential. Update the
   Terraform secret immediately, apply it while the schedule is still disabled,
   and repeat the API and collector smoke tests.
9. Set `collector_schedule_state` back to `ENABLED`, apply, and verify the next
   scheduled run reaches `COMPLETE`. Keep the 21-day ledger and snapshot
   retention in place so every message in the 14-day DLQ remains recoverable.
