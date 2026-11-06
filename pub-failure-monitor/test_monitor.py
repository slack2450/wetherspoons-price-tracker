import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from monitor import collect, run, summarize


def dt(value):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def row(pub, day, seen="2026-11-04 12:00:00.000", failures=1):
    return {"venueId": pub, "runDay": day, "lastSeen": seen,
            "hour": seen, "failures": str(failures)}


class PolicyTests(unittest.TestCase):
    now = dt("2026-11-04 12:30:00")

    def test_many_failures_on_one_day_stay_quiet(self):
        result = summarize([row("7634", "2026-11-04", failures=100)], self.now)
        self.assertEqual(result["recurringPubs"], [])
        self.assertEqual(result["failedPubsLastHour"], ["7634"])

    def test_same_pub_must_fail_on_both_days(self):
        rows = [row("7578", "2026-11-03"), row("7578", "2026-11-04"),
                row("7634", "2026-11-04"), row("7591", "2026-11-03")]
        self.assertEqual(summarize(rows, self.now)["recurringPubs"], ["7578"])

    def test_gap_in_days_breaks_recurrence(self):
        rows = [row("7634", "2026-11-02"), row("7634", "2026-11-04")]
        self.assertEqual(summarize(rows, self.now)["recurringPubs"], [])

    def test_retry_after_midnight_does_not_count_as_a_second_day(self):
        rows = [row("7634", "2026-11-03", "2026-11-03 23:45:00"),
                row("7634", "2026-11-03", "2026-11-04 00:15:00")]
        self.assertEqual(summarize(rows, self.now)["recurringPubs"], [])

    def test_recent_count_deduplicates_pubs_and_excludes_old_failures(self):
        rows = [row("1", "2026-11-04"), row("1", "2026-11-04"),
                row("2", "2026-11-04"), row("3", "2026-11-04", "2026-11-04 10:00:00")]
        self.assertEqual(summarize(rows, self.now)["failedPubsLastHour"], ["1", "2"])

    def test_legacy_logs_use_uk_day_at_summer_midnight(self):
        rows = [row("1", "", "2026-08-02 22:00:00"),
                row("1", "", "2026-08-02 23:00:00")]
        result = summarize(rows, dt("2026-08-03 00:30:00"))
        self.assertEqual(result["recurringPubs"], ["1"])

    def test_cloudwatch_latest_timestamp_can_be_epoch_milliseconds(self):
        entry = row("7634", "2026-11-04")
        entry["lastSeen"] = str(int(dt("2026-11-04 12:00:00").timestamp() * 1000))
        self.assertEqual(summarize([entry], self.now)["failedPubsLastHour"], ["7634"])

    def test_dst_clock_change_does_not_create_an_extra_day(self):
        rows = [row("1", "", "2026-10-25 00:00:00"),
                row("1", "", "2026-10-25 01:00:00")]
        self.assertEqual(summarize(rows, dt("2026-10-25 12:00:00"))["recurringPubs"], [])

    def test_unknown_old_failures_do_not_stay_active(self):
        result = summarize([row("unknown", "", "2026-11-03 12:00:00")], self.now)
        self.assertEqual(result["unknownFailuresLastHour"], 0)

    def test_unknown_record_is_visible_without_inventing_a_pub(self):
        result = summarize([row("unknown", "", failures=2)], self.now)
        self.assertEqual(result["unknownFailuresLastHour"], 2)
        self.assertEqual(result["recurringPubs"], [])

    def test_clear_metrics_are_published_when_failures_stop(self):
        cloudwatch = Mock()
        with patch("monitor.collect", return_value=[]):
            result = run(Mock(), cloudwatch, self.now, "test-log")
        self.assertEqual(result["recurringPubs"], [])
        metrics = cloudwatch.put_metric_data.call_args.kwargs["MetricData"]
        self.assertEqual([m["Value"] for m in metrics], [0, 0, 0])

    def test_query_failure_does_not_publish_false_recovery(self):
        logs, cloudwatch = Mock(), Mock()
        logs.start_query.return_value = {"queryId": "q"}
        logs.get_query_results.return_value = {"status": "Failed"}
        with self.assertRaises(RuntimeError):
            run(logs, cloudwatch, self.now, "test-log")
        cloudwatch.put_metric_data.assert_not_called()
        logs.stop_query.assert_called_once_with(queryId="q")

    def test_truncated_query_fails_closed(self):
        logs = Mock()
        logs.start_query.return_value = {"queryId": "q"}
        logs.get_query_results.return_value = {"status": "Complete", "results": [[]] * 10000}
        with self.assertRaisesRegex(RuntimeError, "result limit"):
            collect(logs, self.now, self.now, "test-log")

    def test_stuck_query_is_cancelled(self):
        logs = Mock()
        logs.start_query.return_value = {"queryId": "q"}
        logs.get_query_results.return_value = {"status": "Running"}
        with self.assertRaises(TimeoutError):
            collect(logs, self.now, self.now, "test-log", sleep=lambda _: None)
        logs.stop_query.assert_called_once_with(queryId="q")


if __name__ == "__main__":
    unittest.main()
