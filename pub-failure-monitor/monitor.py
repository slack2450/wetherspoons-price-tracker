"""Alert policy for exhausted pub collections, without consuming SQS messages."""

import json
import os
import time
from datetime import datetime, time as midnight, timedelta, timezone
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")
NAMESPACE = "WetherspoonsPriceTracker"
QUERY = r"""
filter @message like /MENU_RECORD_FAILED/
| parse @message /venueId=(?<recordVenueId>[0-9]+)/
| parse @message /for venue (?<legacyVenueId>[0-9]+)/
| parse @message /runDay=(?<runDay>[0-9-]+)/
| fields coalesce(recordVenueId, legacyVenueId, "unknown") as venueId
| stats count(*) as failures, latest(@timestamp) as lastSeen
    by venueId, runDay, bin(1h) as hour
| limit 10000
"""


def timestamp(value):
    if value.isdigit():
        return datetime.fromtimestamp(int(value) / 1000, timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=timezone.utc)


def summarize(rows, now):
    """Use distinct original collection days, not retry count or rolling 24h."""
    today = now.astimezone(UK).date()
    yesterday = today - timedelta(days=1)
    pubs_by_day = {today: set(), yesterday: set()}
    recent = set()
    unknown = 0
    for row in rows:
        venue = row["venueId"]
        seen = timestamp(row["lastSeen"])
        if venue == "unknown":
            if seen >= now - timedelta(hours=1):
                unknown += int(row["failures"])
            continue
        if seen >= now - timedelta(hours=1):
            recent.add(venue)
        # Old logs only identified the pub in the exception. Their hourly UTC
        # bucket still maps unambiguously onto a UK calendar day, including DST.
        day = (datetime.fromisoformat(row["runDay"]).date() if row.get("runDay")
               else timestamp(row["hour"]).astimezone(UK).date())
        if day in pubs_by_day:
            pubs_by_day[day].add(venue)
    recurring = sorted(pubs_by_day[today] & pubs_by_day[yesterday])
    return {
        "day": today.isoformat(),
        "recurringPubs": recurring,
        "failedPubsLastHour": sorted(recent),
        "unknownFailuresLastHour": unknown,
    }


def collect(logs, start, end, log_group, sleep=time.sleep):
    query_id = logs.start_query(
        logGroupName=log_group, startTime=int(start.timestamp()),
        endTime=int(end.timestamp()), queryString=QUERY,
    )["queryId"]
    try:
        for _ in range(40):
            result = logs.get_query_results(queryId=query_id)
            if result["status"] == "Complete":
                # Refuse to publish a false all-clear from a truncated query.
                if len(result["results"]) >= 10000:
                    raise RuntimeError("Pub failure query reached its result limit")
                return [{item["field"]: item["value"] for item in row}
                        for row in result["results"]]
            if result["status"] not in ("Running", "Scheduled"):
                raise RuntimeError(f"Pub failure query ended with {result['status']}")
            sleep(2)
        raise TimeoutError("Pub failure query did not complete in 80 seconds")
    except Exception:
        logs.stop_query(queryId=query_id)
        raise


def run(logs, cloudwatch, now, log_group):
    today = now.astimezone(UK).date()
    start = datetime.combine(today - timedelta(days=1), midnight(), UK)
    # Allow five minutes for log ingestion. Previous-day runs that finish after
    # midnight retain their original runDay, so a single run cannot count twice.
    end = now - timedelta(minutes=5)
    rows = collect(logs, start, end, log_group)
    summary = summarize(rows, end)
    cloudwatch.put_metric_data(Namespace=NAMESPACE, MetricData=[
        {"MetricName": name, "Value": value, "Unit": "Count", "Timestamp": now}
        for name, value in {
            "RecurringFailedPubs": len(summary["recurringPubs"]),
            "FailedPubsLastHour": len(summary["failedPubsLastHour"]),
            "UnidentifiedRecordFailures": summary["unknownFailuresLastHour"],
        }.items()
    ])
    print("PUB_FAILURE_SUMMARY " + json.dumps(summary, sort_keys=True))
    return summary


def handler(event, context):
    import boto3  # Included in the Lambda Python runtime; tests inject clients.

    return run(boto3.client("logs"), boto3.client("cloudwatch"),
               datetime.now(timezone.utc), os.environ["COLLECTOR_LOG_GROUP"])
