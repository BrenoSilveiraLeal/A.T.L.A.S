import queue
import threading
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from gateway import HistoryAssetIdentifier, LiveMinuteAggregator, ProfitFeed, Tick, parse_config, require_supported_abi_version


class LiveMinuteAggregatorTests(unittest.TestCase):
    @staticmethod
    def tick(at, sequence, price, quantity=1, flagged=False):
        timestamp = datetime.fromisoformat(at)
        return Tick("WINZ26", "F", price, quantity, sequence, timestamp, flagged)

    def test_sorts_exchange_time_and_builds_sparse_turnover_bars(self):
        aggregator = LiveMinuteAggregator()
        ticks = [
            self.tick("2026-11-02T09:30:20-03:00", 2, 101, 2),
            self.tick("2026-11-02T09:30:10-03:00", 1, 100, 3),
            self.tick("2026-11-02T09:32:02-03:00", 3, 99, 4),
        ]

        latest, dropped = aggregator.ingest(ticks, datetime.fromisoformat("2026-11-02T09:32:03-03:00"))

        self.assertEqual(dropped, 0)
        self.assertEqual(latest.sequence, 3)
        self.assertEqual(len(aggregator.closed_bars), 1)
        self.assertEqual(aggregator.closed_bars[0]["bucketAt"], "2026-11-02T09:30:00-03:00")
        self.assertEqual(tuple(aggregator.closed_bars[0][key] for key in ("open", "high", "low", "close")), (100, 101, 100, 101))
        self.assertEqual(aggregator.closed_bars[0]["volume"], 5)
        self.assertEqual(aggregator.closed_bars[0]["turnover"], 502)
        self.assertEqual(aggregator.current_bar["bucketAt"], "2026-11-02T09:32:00-03:00")

    def test_duplicate_and_flagged_events_are_counted_and_gap_resumes_on_next_minute(self):
        aggregator = LiveMinuteAggregator()
        first = self.tick("2026-11-02T09:30:10-03:00", 1, 100)
        aggregator.ingest([first], datetime.fromisoformat("2026-11-02T09:30:11-03:00"))
        duplicate = self.tick("2026-11-02T09:30:10-03:00", 1, 100)
        flagged = self.tick("2026-11-02T09:30:20-03:00", 2, 101, flagged=True)
        _, dropped = aggregator.ingest([duplicate, flagged], datetime.fromisoformat("2026-11-02T09:30:21-03:00"))
        self.assertEqual(dropped, 2)

        resume_at = aggregator.discard_until_next_minute(datetime.fromisoformat("2026-11-02T09:30:21-03:00"))
        stale = self.tick("2026-11-02T09:30:59-03:00", 3, 102)
        fresh = self.tick("2026-11-02T09:31:00-03:00", 4, 103)
        latest, dropped = aggregator.ingest([fresh, stale], datetime.fromisoformat("2026-11-02T09:31:01-03:00"))

        self.assertEqual(resume_at.isoformat(), "2026-11-02T09:31:00-03:00")
        self.assertEqual(dropped, 0)
        self.assertEqual(latest, fresh)
        self.assertEqual(aggregator.current_bar["open"], 103)
        self.assertEqual(aggregator.closed_bars, [])


class ProfitDllAbiGateTests(unittest.TestCase):
    def test_accepts_only_the_publicly_documented_binding_version(self):
        require_supported_abi_version("4.0.0.41")

    def test_blocks_the_locally_installed_unverified_version_before_login(self):
        with self.assertRaisesRegex(RuntimeError, "4.0.0.42 sem ABI homologada"):
            require_supported_abi_version("4.0.0.42")

    def test_blocks_missing_version_metadata(self):
        with self.assertRaisesRegex(RuntimeError, "sem versao"):
            require_supported_abi_version("")

    def test_parse_config_rejects_unverified_dll_before_reading_ingest_settings(self):
        with tempfile.TemporaryDirectory() as runtime_dir:
            (Path(runtime_dir) / "ProfitDLL.dll").touch()
            with patch.dict(os.environ, {"PROFITDLL_RUNTIME_DIR": runtime_dir}, clear=False):
                with patch("gateway.dll_file_version", return_value="4.0.0.42"):
                    with self.assertRaisesRegex(RuntimeError, "4.0.0.42 sem ABI homologada"):
                        parse_config()


class ProfitDllHistoryCollectorTests(unittest.TestCase):
    def make_feed(self):
        feed = ProfitFeed.__new__(ProfitFeed)
        feed.ticker = "WINZ26"
        feed.exchange = "F"
        feed.history_events = queue.Queue(maxsize=20)
        feed.history_lock = threading.Lock()
        feed.history_active_day = "2026-11-02"
        feed.history_close = "18:25"
        feed.history_done = threading.Event()
        feed.history_bars = {}
        feed.history_seen_trade_keys = set()
        feed.history_trade_count = 0
        feed.history_error = None
        feed.history_stop = threading.Event()
        worker = threading.Thread(target=feed._consume_history, daemon=True)
        worker.start()
        self.addCleanup(self.stop_consumer, feed, worker)
        return feed

    @staticmethod
    def stop_consumer(feed, worker):
        feed.history_events.join()
        feed.history_stop.set()
        worker.join(timeout=1)

    @staticmethod
    def asset(feed=0):
        return HistoryAssetIdentifier(ticker="WINZ26", exchange="F", feed=feed)

    def send_trade(self, feed, date_text, number, price, quantity, trade_type=1, source=0, financial_volume=None):
        feed._history_trade_callback(
            self.asset(source), date_text, number, price,
            float(price * quantity if financial_volume is None else financial_volume), quantity,
            0, 0, trade_type,
        )

    def test_aggregates_history_by_exchange_time_and_computes_turnover(self):
        feed = self.make_feed()
        # Deliberately deliver out of order: opening and closing prices must follow exchange time.
        self.send_trade(feed, "02/11/2026 09:30:20.000", 2, 101.0, 2)
        self.send_trade(feed, "02/11/2026 09:30:10.000", 1, 100.0, 3)
        feed.history_events.join()

        self.assertIsNone(feed.history_error)
        self.assertEqual(feed.history_trade_count, 2)
        self.assertEqual(len(feed.history_bars), 1)
        bar = next(iter(feed.history_bars.values()))
        self.assertEqual(bar["bucketAt"], "2026-11-02T09:30:00-03:00")
        self.assertEqual((bar["open"], bar["high"], bar["low"], bar["close"]), (100.0, 101.0, 100.0, 101.0))
        self.assertEqual(bar["volume"], 5)
        self.assertEqual(bar["turnover"], 502.0)

    def test_duplicate_trade_invalidates_the_history_session(self):
        feed = self.make_feed()
        self.send_trade(feed, "02/11/2026 09:30:10.000", 1, 100.0, 1)
        self.send_trade(feed, "02/11/2026 09:30:11.000", 1, 100.0, 1)
        feed.history_events.join()

        self.assertIn("repetiu o número", feed.history_error)

    def test_alternate_feed_and_unknown_trade_type_are_rejected(self):
        feed = self.make_feed()
        self.send_trade(feed, "02/11/2026 09:30:10.000", 1, 100.0, 1, source=255)
        self.assertIn("incompatível", feed.history_error)
        self.assertTrue(feed.history_events.empty())

        feed.history_error = None
        self.send_trade(feed, "02/11/2026 09:30:10.000", 2, 100.0, 1, trade_type=32)
        self.assertIn("não classificado", feed.history_error)
        self.assertTrue(feed.history_events.empty())

    def test_malformed_price_or_quantity_invalidates_the_session(self):
        feed = self.make_feed()
        self.send_trade(feed, "02/11/2026 09:30:10.000", 1, float("nan"), 1)
        feed.history_events.join()

        self.assertIn("malformado", feed.history_error)
        self.assertEqual(feed.history_bars, {})
        self.assertEqual(feed.history_trade_count, 0)

    def test_non_finite_financial_volume_invalidates_the_history_session(self):
        feed = self.make_feed()
        self.send_trade(feed, "02/11/2026 09:30:10.000", 1, 100.0, 1, financial_volume=float("nan"))
        feed.history_events.join()

        self.assertIn("malformado", feed.history_error)
        self.assertEqual(feed.history_bars, {})
        self.assertEqual(feed.history_trade_count, 0)

    def test_only_valid_nelogica_progress_completion_closes_history_request(self):
        feed = self.make_feed()
        feed._history_progress_callback(self.asset(feed=255), 100)
        feed._history_progress_callback(self.asset(), 101)
        self.assertFalse(feed.history_done.is_set())

        feed._history_progress_callback(self.asset(), 100)
        self.assertTrue(feed.history_done.is_set())


if __name__ == "__main__":
    unittest.main()
