"""Genial profile, halt latch and read-only probe. Offline fixtures only; no MetaTrader5 import."""
import json
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from gateway import (ACCOUNT_MARGIN_MODE_EXCHANGE, ACCOUNT_MARGIN_MODE_RETAIL_HEDGING, Config, Gateway,
                     GatewayError)
from probe import ReadOnlyTerminal, ReadOnlyViolation, probe
from test_gateway import TerminalFixture


class GenialFixture(TerminalFixture):
    def __init__(self):
        super().__init__()
        self.account.margin_mode = ACCOUNT_MARGIN_MODE_EXCHANGE
        self.account.limit_orders = 0
        self.terminal.company = "Fixture Broker"
        self.symbol.filling_mode = 0
        self.tick = type(self.account)(bid=25.49, ask=25.51, last=25.5, time_msc=1_792_000_000_000)

    def version(self):
        return (500, 5000, "fixture")

    def positions_total(self):
        return len(self.position_rows)

    def orders_total(self):
        return len(self.active)

    def symbol_info_tick(self, symbol):
        return self.tick if symbol == self.symbol.name else None


class GenialProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.halt = root / "halt.json"
        self.config = Config(token="offline-test-token-" + "x" * 32, login="12345", server="TEST-B3", mode="REAL",
                             instruments={"TEST3": {"market": "B3_CASH_EQUITY", "terminalExchange": "TEST-B3-EXCHANGE",
                                                    "isin": "BRTESTACNOR0", "contractSize": "1"}},
                             journal_path=root / "journal.sqlite3", terminal_path="fixture-not-a-terminal",
                             execution_enabled=True, provider_id="GENIAL_MT5_SWING", profile="GENIAL_SWING",
                             halt_file=self.halt)
        self.api = GenialFixture()
        self.gateway = Gateway(self.api, self.config)
        self.request = {"clientOrderId": "intent-001", "accountId": "12345", "symbol": "TEST3", "side": "BUY",
                        "quantity": 100, "kind": "LIMIT", "limitPrice": "25.50", "stopPrice": None, "timeInForce": "DAY"}

    def tearDown(self):
        self.gateway.journal.close()
        self.temp.cleanup()

    def rpc(self, method, params=None):
        return self.gateway.rpc({"version": 1, "accountId": "12345", "method": method, "params": params or {}})

    def submit(self, key="intent-001"):
        request = dict(self.request, clientOrderId=key)
        return self.rpc("submit", {"request": request, "idempotencyKey": key})

    def fails(self, code, action):
        with self.assertRaises(GatewayError) as caught:
            action()
        self.assertEqual(code, caught.exception.code)

    def test_genial_requires_real_mode_and_halt_file(self):
        self.fails("GENIAL_HAS_NO_OFFICIAL_DEMO", replace(self.config, mode="OFFICIAL_SANDBOX").validate)
        self.fails("HALT_FILE_REQUIRED", replace(self.config, halt_file=None).validate)
        self.fails("INVALID_CONFIGURATION", replace(self.config, profile="GENIAL_FUTURES").validate)

    def test_environment_derives_genial_provider_id(self):
        instruments = Path(self.temp.name) / "instruments.json"
        instruments.write_text("{}", encoding="utf-8")
        env = {"ATLAS_MT5_TOKEN": "t" * 40, "ATLAS_MT5_EXPECTED_LOGIN": "12345", "ATLAS_MT5_EXPECTED_SERVER": "S",
               "ATLAS_MT5_ACCOUNT_MODE": "REAL", "ATLAS_MT5_INSTRUMENTS_FILE": str(instruments),
               "ATLAS_MT5_JOURNAL_PATH": str(Path(self.temp.name) / "j.sqlite3"), "ATLAS_MT5_TERMINAL_PATH": "x",
               "ATLAS_MT5_BROKER_PROFILE": "GENIAL_SWING", "ATLAS_MT5_HALT_FILE": str(self.halt)}
        with mock.patch.dict(os.environ, env, clear=True):
            config = Config.from_environment()
        self.assertEqual("GENIAL_MT5_SWING", config.provider_id)
        self.assertFalse(config.execution_enabled)

    def test_hedging_account_refused_and_halts(self):
        self.api.account.margin_mode = ACCOUNT_MARGIN_MODE_RETAIL_HEDGING
        self.fails("HEDGING_ACCOUNT_UNSUPPORTED", lambda: self.rpc("account"))
        self.assertEqual("HEDGING_ACCOUNT_UNSUPPORTED", self.gateway.halted())

    def test_missing_margin_mode_is_not_assumed_netting(self):
        del self.api.account.margin_mode
        self.fails("INCOMPLETE_TERMINAL_DATA", lambda: self.rpc("account"))

    def test_capabilities_stay_conservative(self):
        caps = self.rpc("capabilities")
        self.assertEqual("GENIAL_MT5_SWING", caps["providerId"])
        for key in ("completeAccountReconciliation", "nativeIdempotency", "cloudAuthorized", "overnight"):
            self.assertFalse(caps[key])

    def test_day_trade_environment_never_submits(self):
        self.gateway.config = replace(self.config, profile="GENIAL_DAY_TRADE")
        self.fails("DAY_TRADE_ENVIRONMENT_SUBMIT_UNSUPPORTED", self.submit)
        self.assertEqual([], self.api.sent)
        self.assertEqual([], self.rpc("orders"))

    def test_ambiguous_dispatch_latches_halt_and_blocks_new_orders(self):
        self.api.timeout_after_send = True
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.assertEqual("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.gateway.halted())
        self.assertEqual("GATEWAY_HALTED", self.rpc("health")["reason"])
        self.api.timeout_after_send = False
        self.fails("GATEWAY_HALTED", lambda: self.submit("intent-002"))
        self.assertEqual(1, len(self.api.sent))

    def test_halt_keeps_first_reason_and_survives_restart(self):
        self.gateway._halt("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")
        self.gateway._halt("RECOVERY_ORDER_MISMATCH")
        self.gateway.journal.close()
        self.gateway = Gateway(self.api, self.config)
        self.assertEqual("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.gateway.halted())

    def test_cancel_still_allowed_while_halted(self):
        placed = self.submit()
        self.gateway._halt("RECOVERY_ORDER_MISMATCH")
        result = self.rpc("cancel", {"brokerOrderId": placed["brokerOrderId"], "idempotencyKey": "cancel-001"})
        self.assertEqual("CANCELLED", result["status"])
        self.fails("GATEWAY_HALTED", lambda: self.rpc("modify", {"brokerOrderId": placed["brokerOrderId"],
                   "changes": {"quantity": 100, "limitPrice": "25.40", "stopPrice": None}, "idempotencyKey": "m-1"}))

    def test_replay_of_acknowledged_submit_works_while_halted(self):
        first = self.submit()
        self.gateway._halt("RECOVERY_ORDER_MISMATCH")
        self.assertEqual(first, self.submit())
        self.assertEqual(1, len(self.api.sent))

    def test_unreadable_halt_file_still_halts(self):
        self.halt.write_text("not json", encoding="utf-8")
        self.fails("GATEWAY_HALTED", self.submit)

    def test_reattaches_after_terminal_restart(self):
        account, self.api.account = self.api.account, None
        def initialize(path, timeout):
            self.assertEqual(self.config.terminal_path, path)
            self.api.account = account
            return True
        self.api.initialize = initialize
        self.assertEqual("REAL", self.rpc("account")["mode"])

    def test_restart_into_other_account_is_refused(self):
        other = type(self.api.account)(**{**vars(self.api.account), "login": 99999})
        self.api.account = None
        self.api.initialize = lambda path, timeout: setattr(self.api, "account", other) or True
        self.fails("GATEWAY_ACCOUNT_MISMATCH", lambda: self.rpc("account"))
        self.assertEqual("GATEWAY_ACCOUNT_MISMATCH", self.gateway.halted())

    def test_live_quote_from_terminal(self):
        quote = self.rpc("quote", {"symbol": "TEST3"})
        self.assertEqual(("25.49", "25.51", "25.5"), (quote["bid"], quote["ask"], quote["last"]))
        self.assertTrue(quote["quotedAt"].endswith("Z"))
        self.api.tick.bid = 0
        self.assertIsNone(self.rpc("quote", {"symbol": "TEST3"})["bid"])
        self.fails("UNAPPROVED_INSTRUMENT", lambda: self.rpc("quote", {"symbol": "OTHER3"}))

    def test_owner_removing_halt_file_resumes(self):
        self.gateway._halt("RECOVERY_ORDER_MISMATCH")
        self.halt.unlink()
        self.assertIsNone(self.rpc("health")["reason"])
        self.assertEqual("OPEN", self.submit()["status"])


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.api = GenialFixture()

    def test_proxy_blocks_every_mutation(self):
        terminal = ReadOnlyTerminal(self.api)
        for name in ("order_send", "order_check", "login", "history_deals_get", "symbol_select"):
            with self.assertRaises(ReadOnlyViolation):
                getattr(terminal, name)
        self.assertEqual(self.api.ORDER_TIME_DAY, terminal.ORDER_TIME_DAY)

    def test_probe_never_sends_and_reports_ready(self):
        report = probe(self.api, "GENIAL_SWING", ["TEST3", "MISSING3"], expected_server="TEST-B3")
        self.assertEqual([], self.api.sent)
        self.assertTrue(report["ready"])
        self.assertTrue(report["readOnly"])
        self.assertEqual("**345", report["account"]["login"])
        self.assertEqual("EXCHANGE", report["account"]["marginMode"])
        test3 = report["symbols"][0]
        self.assertTrue(test3["looksLikeB3CashEquity"])
        self.assertTrue(test3["limitDaySupported"])
        self.assertEqual({"TEST3": {"market": "B3_CASH_EQUITY", "terminalExchange": "TEST-B3-EXCHANGE",
                                    "isin": "BRTESTACNOR0", "contractSize": "1"}}, test3["instrumentsEntrySuggestion"])
        self.assertFalse(report["symbols"][1]["found"])

    def test_probe_reports_no_money_values(self):
        text = json.dumps(probe(self.api, "GENIAL_SWING", ["TEST3"]), default=str)
        self.assertNotIn("999999", text)
        self.assertNotIn("12345", text)

    def test_probe_fails_hedging_and_demo(self):
        self.api.account.margin_mode = ACCOUNT_MARGIN_MODE_RETAIL_HEDGING
        self.assertFalse(probe(self.api, "GENIAL_SWING", [])["ready"])
        self.api = GenialFixture()
        self.api.account.trade_mode = self.api.ACCOUNT_TRADE_MODE_DEMO
        self.assertFalse(probe(self.api, "GENIAL_SWING", [])["ready"])

    def test_probe_unknown_server_is_unknown_not_pass(self):
        checks = {c["check"]: c["result"] for c in probe(self.api, "GENIAL_SWING", [])["checks"]}
        self.assertEqual("UNKNOWN", checks["expected_server"])

    def test_probe_without_login(self):
        self.api.account = None
        report = probe(self.api, "GENIAL_SWING", [])
        self.assertFalse(report["ready"])


if __name__ == "__main__":
    unittest.main()
