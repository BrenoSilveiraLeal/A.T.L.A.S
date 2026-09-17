"""Offline contract/failure tests. Fixtures never import/connect to MetaTrader5."""
import copy
import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
from dataclasses import replace
from datetime import datetime, timezone
from http.server import HTTPServer
from pathlib import Path
from types import SimpleNamespace as Row

from gateway import Config, Gateway, GatewayError, MAGIC, PAGE_SIZE, handler_for, strict_json


class TerminalFixture:
    ACCOUNT_TRADE_MODE_REAL, ACCOUNT_TRADE_MODE_DEMO = 2, 0
    SYMBOL_CALC_MODE_EXCH_STOCKS, SYMBOL_TRADE_EXECUTION_EXCHANGE = 32, 3
    POSITION_TYPE_BUY, POSITION_TYPE_SELL = 0, 1
    ORDER_TYPE_BUY, ORDER_TYPE_SELL = 0, 1
    ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_SELL_LIMIT = 2, 3
    ORDER_TYPE_BUY_STOP, ORDER_TYPE_SELL_STOP = 4, 5
    ORDER_TYPE_BUY_STOP_LIMIT, ORDER_TYPE_SELL_STOP_LIMIT = 6, 7
    ORDER_TIME_DAY, ORDER_FILLING_RETURN = 1, 2
    ORDER_STATE_STARTED, ORDER_STATE_PLACED, ORDER_STATE_CANCELED = 0, 1, 2
    ORDER_STATE_PARTIAL, ORDER_STATE_FILLED, ORDER_STATE_REJECTED, ORDER_STATE_EXPIRED = 3, 4, 5, 6
    DEAL_TYPE_BUY, DEAL_TYPE_SELL, DEAL_TYPE_BUY_CANCELED, DEAL_TYPE_SELL_CANCELED = 0, 1, 13, 14
    TRADE_ACTION_PENDING, TRADE_ACTION_MODIFY, TRADE_ACTION_REMOVE = 5, 7, 8
    TRADE_RETCODE_PLACED, TRADE_RETCODE_DONE, TRADE_RETCODE_DONE_PARTIAL = 10008, 10009, 10010
    TRADE_RETCODE_REJECT, TRADE_RETCODE_INVALID, TRADE_RETCODE_INVALID_VOLUME = 10006, 10013, 10014
    TRADE_RETCODE_INVALID_PRICE, TRADE_RETCODE_INVALID_STOPS, TRADE_RETCODE_TRADE_DISABLED = 10015, 10016, 10017
    TRADE_RETCODE_MARKET_CLOSED, TRADE_RETCODE_NO_MONEY = 10018, 10019
    TRADE_RETCODE_INVALID_EXPIRATION, TRADE_RETCODE_INVALID_FILL = 10022, 10030

    def __init__(self):
        self.account = Row(login=12345, server="TEST-B3", currency="BRL", trade_mode=2,
                           trade_allowed=True, trade_expert=True, balance=999999, margin_free=999999)
        self.terminal = Row(connected=True, trade_allowed=True, tradeapi_disabled=False)
        self.symbol = Row(name="TEST3", custom=False, trade_calc_mode=32, trade_exemode=3,
                          currency_profit="BRL", currency_margin="BRL", exchange="TEST-B3-EXCHANGE",
                          isin="BRTESTACNOR0", expiration_time=0, trade_contract_size=1,
                          volume_min=1, volume_max=100000, volume_step=1, trade_tick_size=0.01,
                          order_mode=3, expiration_mode=3)
        self.active, self.history, self.deals, self.position_rows, self.sent = [], [], [], [], []
        self.check_code, self.send_code = 0, self.TRADE_RETCODE_PLACED
        self.timeout_after_send = False
        self.after_symbol = None
        self.before_send = None
        self.hide_ack = False
        self.alter_ack = False

    def account_info(self):
        return self.account

    def terminal_info(self):
        return self.terminal

    def symbol_info(self, symbol):
        if self.after_symbol:
            self.after_symbol()
        return self.symbol if symbol == self.symbol.name else None

    def positions_get(self):
        return self.position_rows

    def orders_get(self, ticket=None):
        return tuple(row for row in self.active if ticket is None or row.ticket == ticket)

    def history_orders_get(self, *dates, ticket=None):
        return tuple(row for row in self.history if ticket is None or row.ticket == ticket)

    def history_deals_get(self, *dates, ticket=None):
        return tuple(row for row in self.deals if ticket is None or row.order == ticket)

    def order_check(self, request):
        return Row(retcode=self.check_code)

    def order_send(self, request):
        if self.before_send:
            self.before_send()
        self.sent.append(copy.deepcopy(request))
        if self.send_code not in (self.TRADE_RETCODE_PLACED, self.TRADE_RETCODE_DONE, self.TRADE_RETCODE_DONE_PARTIAL):
            return Row(retcode=self.send_code, order=0)
        if request["action"] == self.TRADE_ACTION_PENDING:
            value = Row(ticket=100 + len(self.sent), symbol=request["symbol"], type=request["type"],
                        volume_initial=request["volume"], volume_current=request["volume"], state=self.ORDER_STATE_PLACED,
                        price_open=request["price"], type_time=request["type_time"], magic=request["magic"],
                        comment=request["comment"], time_expiration=0, sl=0, tp=0, price_stoplimit=0)
            if self.alter_ack:
                value.volume_initial += 1
            if not self.hide_ack:
                self.active.append(value)
        else:
            value = next(row for row in self.active if row.ticket == request["order"])
            if request["action"] == self.TRADE_ACTION_MODIFY:
                if not self.hide_ack:
                    value.price_open = request["price"]
            elif not self.hide_ack:
                self.active.remove(value)
                value.state = self.ORDER_STATE_CANCELED
                self.history.append(value)
        if self.timeout_after_send:
            raise TimeoutError("fixture: may already have reached market")
        return Row(retcode=self.send_code, order=value.ticket)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = Config(token="offline-test-token-" + "x" * 32, login="12345", server="TEST-B3", mode="REAL",
                             instruments={"TEST3": {"market": "B3_CASH_EQUITY", "terminalExchange": "TEST-B3-EXCHANGE",
                                                    "isin": "BRTESTACNOR0", "contractSize": "1"}},
                             journal_path=Path(self.temp.name) / "journal.sqlite3", terminal_path="fixture-not-a-terminal",
                             execution_enabled=True)
        self.api = TerminalFixture()
        self.gateway = Gateway(self.api, self.config)
        self.request = {"clientOrderId": "intent-001", "accountId": "12345", "symbol": "TEST3", "side": "BUY",
                        "quantity": 100, "kind": "LIMIT", "limitPrice": "25.50", "stopPrice": None, "timeInForce": "DAY"}

    def tearDown(self):
        self.gateway.journal.close()
        self.temp.cleanup()

    def rpc(self, method, params=None):
        return self.gateway.rpc({"version": 1, "accountId": "12345", "method": method, "params": params or {}})

    def submit(self):
        return self.rpc("submit", {"request": self.request, "idempotencyKey": self.request["clientOrderId"]})

    def fails(self, code, action):
        with self.assertRaises(GatewayError) as caught:
            action()
        self.assertEqual(code, caught.exception.code)

    def restart(self):
        self.gateway.journal.close()
        self.gateway = Gateway(self.api, self.config)

    def deal(self, **changes):
        fields = dict(ticket=201, order=101, symbol="TEST3", type=0, volume=25,
                      time_msc=int(datetime.now(timezone.utc).timestamp() * 1000) - 1000,
                      price=25.5, commission=-0.12, fee=-0.03)
        fields.update(changes)
        return Row(**fields)

    def test_cash_is_not_balance_or_free_margin(self):
        self.fails("SETTLED_CASH_UNAVAILABLE", lambda: self.rpc("cash"))
        self.assertFalse(self.rpc("account")["cashOnly"])
        caps = self.rpc("capabilities")
        for key in ("completeAccountReconciliation", "nativeIdempotency", "cloudAuthorized", "overnight", "fractionalLots"):
            self.assertFalse(caps[key])

    def test_execution_disabled_by_default(self):
        self.gateway.config = replace(self.config, execution_enabled=False)
        self.fails("EXECUTION_DISABLED", self.submit)
        self.assertEqual([], self.api.sent)

    def test_limit_day_and_actual_ticket(self):
        result = self.submit()
        self.assertEqual("101", result["brokerOrderId"])
        self.assertEqual("intent-001", result["clientOrderId"])
        self.assertEqual("OPEN", result["status"])
        self.assertEqual(0, result["filledQuantity"])
        self.assertEqual(self.request["quantity"], result["request"]["quantity"])
        sent = self.api.sent[0]
        self.assertEqual(self.api.TRADE_ACTION_PENDING, sent["action"])
        self.assertEqual(self.api.ORDER_FILLING_RETURN, sent["type_filling"])
        self.assertEqual(self.api.ORDER_TIME_DAY, sent["type_time"])

    def test_dispatch_is_durable_before_sdk_send(self):
        def inspect_database():
            observer = sqlite3.connect(self.config.journal_path)
            try:
                self.assertEqual("DISPATCHED", observer.execute("SELECT state FROM dispatch").fetchone()[0])
            finally:
                observer.close()
        self.api.before_send = inspect_database
        self.submit()

    def test_success_replay_survives_restart_without_resend(self):
        first = self.submit()
        self.restart()
        self.assertEqual(first, self.submit())
        self.assertEqual(1, len(self.api.sent))

    def test_same_id_changed_terms_is_conflict(self):
        self.submit()
        self.request["quantity"] = 200
        self.fails("IDEMPOTENCY_CONFLICT", self.submit)
        self.assertEqual(1, len(self.api.sent))

    def test_timeout_is_durable_and_never_retries(self):
        self.api.timeout_after_send = True
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.restart()
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.assertEqual(1, len(self.api.sent))

    def test_timeout_recovery_queries_comment_and_official_ticket(self):
        self.api.timeout_after_send = True
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.restart()
        result = self.rpc("orderByClientId", {"clientOrderId": "intent-001"})
        self.assertEqual("101", result["brokerOrderId"])
        self.assertEqual(result, self.submit())
        self.assertEqual(1, len(self.api.sent))

    def test_unknown_timeout_does_not_report_absence(self):
        self.api.timeout_after_send = self.api.hide_ack = True
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", lambda: self.rpc("orderByClientId", {"clientOrderId": "intent-001"}))
        self.assertIsNone(self.rpc("orderByClientId", {"clientOrderId": "never-submitted"}))

    def test_recovery_checks_economics_not_only_marker(self):
        self.api.timeout_after_send = True
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.api.active[0].volume_initial = 200
        self.fails("RECOVERY_ORDER_MISMATCH", lambda: self.rpc("orderByClientId", {"clientOrderId": "intent-001"}))

    def test_duplicate_recovery_matches_remain_ambiguous(self):
        self.api.timeout_after_send = True
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        another = copy.copy(self.api.active[0])
        another.ticket = 999
        self.api.active.append(another)
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", lambda: self.rpc("orderByClientId", {"clientOrderId": "intent-001"}))

    def test_ack_terms_mismatch_cannot_bind_wrong_order(self):
        self.api.alter_ack = True
        self.fails("RECOVERY_ORDER_MISMATCH", self.submit)
        self.assertIsNone(self.gateway.journal.lookup("intent-001")["broker_ticket"])
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)

    def test_explicit_rejection_is_durable(self):
        self.api.send_code = self.api.TRADE_RETCODE_NO_MONEY
        self.fails("ORDER_REJECTED", self.submit)
        self.restart()
        self.fails("ORDER_REJECTED", self.submit)
        self.assertEqual(1, len(self.api.sent))

    def test_timeout_return_code_remains_ambiguous(self):
        self.api.send_code = 10012
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", self.submit)
        self.assertEqual(1, len(self.api.sent))

    def test_order_check_failure_never_dispatches(self):
        self.api.check_code = self.api.TRADE_RETCODE_NO_MONEY
        self.fails("ORDER_CHECK_REJECTED", self.submit)
        self.assertIsNone(self.gateway.journal.lookup("intent-001"))
        self.assertEqual([], self.api.sent)

    def test_account_checked_for_every_rpc_including_replay(self):
        self.submit()
        self.api.account.login = 98765
        for method in ("capabilities", "health", "account", "cash", "positions", "orders"):
            self.fails("GATEWAY_ACCOUNT_MISMATCH", lambda: self.rpc(method))
        self.fails("GATEWAY_ACCOUNT_MISMATCH", self.submit)
        self.assertEqual(1, len(self.api.sent))

    def test_account_switch_during_read_is_rejected(self):
        self.api.after_symbol = lambda: setattr(self.api.account, "server", "OTHER-SERVER")
        self.fails("GATEWAY_ACCOUNT_MISMATCH", self.submit)
        self.assertEqual([], self.api.sent)

    def test_demo_real_and_currency_must_match(self):
        self.api.account.trade_mode = self.api.ACCOUNT_TRADE_MODE_DEMO
        self.fails("UNSUPPORTED_ACCOUNT", lambda: self.rpc("account"))
        self.api.account.trade_mode = self.api.ACCOUNT_TRADE_MODE_REAL
        self.api.account.currency = "USD"
        self.fails("UNSUPPORTED_ACCOUNT", lambda: self.rpc("account"))

    def test_wrong_account_cannot_reuse_journal(self):
        self.fails("JOURNAL_ACCOUNT_MISMATCH", lambda: Gateway(self.api, replace(self.config, server="OTHER")))

    def test_terminal_trading_disabled(self):
        self.api.terminal.tradeapi_disabled = True
        self.fails("TERMINAL_TRADING_DISABLED", self.submit)
        self.assertEqual([], self.api.sent)

    def test_cfd_futures_and_unapproved_symbols_refused(self):
        for mode in (0, 1, 2, 33):
            self.api.symbol.trade_calc_mode = mode
            self.fails("INSTRUMENT_NOT_VERIFIED_B3_CASH_EQUITY", self.submit)
        self.api.symbol.trade_calc_mode = 32
        self.request["symbol"] = "WINZ26"
        self.fails("UNAPPROVED_INSTRUMENT", self.submit)
        self.assertEqual([], self.api.sent)

    def test_market_identity_and_contract_size_verified(self):
        for field, changed in (("exchange", "OTHER"), ("isin", "OTHER"), ("custom", True), ("currency_profit", "USD"),
                               ("expiration_time", 1), ("trade_contract_size", 100), ("trade_exemode", 2)):
            original = getattr(self.api.symbol, field)
            setattr(self.api.symbol, field, changed)
            self.fails("INSTRUMENT_NOT_VERIFIED_B3_CASH_EQUITY", self.submit)
            setattr(self.api.symbol, field, original)

    def test_volume_conversion_uses_verified_contract_size(self):
        self.config.instruments["TEST3"]["contractSize"] = "100"
        self.api.symbol.trade_contract_size = 100
        result = self.submit()
        self.assertEqual(1, self.api.sent[0]["volume"])
        self.assertEqual(100, result["quantity"])

    def test_step_and_tick_are_not_rounded(self):
        self.api.symbol.volume_step = 100
        self.request["quantity"] = 101
        self.fails("INVALID_VOLUME_STEP_OR_LIMIT", self.submit)
        self.request["quantity"] = 100
        self.request["limitPrice"] = "25.501"
        self.fails("INVALID_PRICE_TICK", self.submit)
        self.assertEqual([], self.api.sent)

    def test_stop_gtc_market_and_unsupported_expiration_refused(self):
        for field, value in (("kind", "STOP"), ("kind", "MARKET"), ("timeInForce", "GTC"), ("stopPrice", "20")):
            previous = self.request[field]
            self.request[field] = value
            self.fails("UNSUPPORTED_ORDER_TERMS", self.submit)
            self.request[field] = previous
        self.api.symbol.expiration_mode = 1
        self.fails("LIMIT_DAY_NOT_SUPPORTED", self.submit)

    def test_partial_fills_use_official_deals(self):
        self.submit()
        self.api.active[0].state = self.api.ORDER_STATE_PARTIAL
        self.api.deals = [self.deal(volume=25), self.deal(ticket=202, volume=10)]
        order = self.rpc("order", {"brokerOrderId": "101"})
        self.assertEqual("PARTIALLY_FILLED", order["status"])
        self.assertEqual(35, order["filledQuantity"])
        self.api.active[0].state = self.api.ORDER_STATE_FILLED
        self.fails("INCONSISTENT_ORDER_FILLS", lambda: self.rpc("order", {"brokerOrderId": "101"}))

    def test_modify_price_preserves_quantity_and_requires_actual_echo(self):
        self.submit()
        params = {"brokerOrderId": "101", "idempotencyKey": "modify-001", "changes": {"quantity": 100, "limitPrice": "25.60", "stopPrice": None}}
        result = self.rpc("modify", params)
        self.assertEqual("25.6", result["request"]["limitPrice"])
        self.assertNotIn("volume", self.api.sent[1])
        self.assertEqual(result, self.rpc("modify", params))
        params["idempotencyKey"] = "modify-002"
        params["changes"]["quantity"] = 200
        self.fails("QUANTITY_OR_STOP_MODIFICATION_UNSUPPORTED", lambda: self.rpc("modify", params))

    def test_modify_ack_without_changed_terminal_terms_is_ambiguous(self):
        self.submit()
        self.api.hide_ack = True
        params = {"brokerOrderId": "101", "idempotencyKey": "modify-001", "changes": {"quantity": 100, "limitPrice": "25.60", "stopPrice": None}}
        self.fails("AMBIGUOUS_MODIFICATION", lambda: self.rpc("modify", params))
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", lambda: self.rpc("modify", params))
        self.assertEqual(2, len(self.api.sent))

    def test_cancel_is_confirmed_from_history_and_replay_safe(self):
        self.submit()
        params = {"brokerOrderId": "101", "idempotencyKey": "cancel-001"}
        result = self.rpc("cancel", params)
        self.assertEqual("CANCELLED", result["status"])
        self.restart()
        self.assertEqual(result, self.rpc("cancel", params))
        self.assertEqual(2, len(self.api.sent))

    def test_cancellation_cannot_manage_external_order(self):
        self.submit()
        self.api.active[0].magic = 999
        self.fails("ORDER_NOT_OWNED_BY_ATLAS", lambda: self.rpc("cancel", {"brokerOrderId": "101", "idempotencyKey": "cancel-001"}))
        self.assertEqual(1, len(self.api.sent))

    def test_unconfirmed_cancel_never_retries(self):
        self.submit()
        self.api.hide_ack = True
        params = {"brokerOrderId": "101", "idempotencyKey": "cancel-001"}
        self.fails("CANCELLATION_NOT_CONFIRMED", lambda: self.rpc("cancel", params))
        self.fails("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", lambda: self.rpc("cancel", params))

    def test_positions_are_actual_aggregated_longs(self):
        self.api.position_rows = [Row(symbol="TEST3", type=0, volume=10, price_open=20), Row(symbol="TEST3", type=0, volume=10, price_open=30)]
        result = self.rpc("positions")
        self.assertEqual(20, result[0]["quantity"])
        self.assertEqual("25", result[0]["averagePrice"])
        self.api.position_rows[0].type = 1
        self.fails("SHORT_POSITION_UNSUPPORTED", lambda: self.rpc("positions"))

    def test_executions_preserve_fills_and_observed_charges(self):
        self.api.deals = [self.deal()]
        result = self.rpc("executions", {"cursor": None})
        self.assertEqual("0.15", result["executions"][0]["fees"])
        self.assertEqual(25, result["executions"][0]["quantity"])
        self.assertEqual("201", result["executions"][0]["executionId"])
        self.assertIsNone(result["nextCursor"])

    def test_missing_fee_and_rebates_fail_instead_of_inventing_zero(self):
        row = self.deal()
        self.api.deals = [row]
        del row.fee
        self.fails("INCOMPLETE_TERMINAL_DATA", lambda: self.rpc("executions", {"cursor": None}))
        row.fee = 1
        self.fails("SIGNED_EXECUTION_FEES_UNSUPPORTED", lambda: self.rpc("executions", {"cursor": None}))

    def test_execution_corrections_are_not_silently_dropped(self):
        self.api.deals = [self.deal(type=self.api.DEAL_TYPE_BUY_CANCELED)]
        self.fails("EXECUTION_CORRECTION_REQUIRES_RECONCILIATION", lambda: self.rpc("executions", {"cursor": None}))

    def test_execution_pagination_preserves_same_millisecond_fills(self):
        stamp = self.deal().time_msc
        self.api.deals = [self.deal(ticket=200 + index, time_msc=stamp) for index in range(PAGE_SIZE + 3)]
        first = self.rpc("executions", {"cursor": None})
        second = self.rpc("executions", {"cursor": first["nextCursor"]})
        ids = [row["executionId"] for row in first["executions"] + second["executions"]]
        self.assertEqual(PAGE_SIZE + 3, len(ids))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIsNone(second["nextCursor"])

    def test_invalid_envelope_and_duplicate_json_rejected(self):
        self.fails("INVALID_REQUEST", lambda: self.gateway.rpc({"method": "account"}))
        with self.assertRaises(ValueError):
            strict_json('{"method":"submit","method":"cash"}')
        with self.assertRaises(ValueError):
            strict_json('{"quantity":NaN}')

    def http(self, headers=None, body=None, host=None):
        # HTTP request in a worker; serialized handler and SQLite stay on main thread.
        with HTTPServer(("127.0.0.1", 0), handler_for(self.gateway)) as server:
            port = server.server_port
            request_headers = {"Authorization": "Bearer " + self.config.token, "Content-Type": "application/json"}
            request_headers.update(headers or {})
            if host:
                request_headers["Host"] = host
            payload = body or json.dumps({"version": 1, "accountId": "12345", "method": "account", "params": {}})
            result = []
            def request():
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                conn.request("POST", "/rpc", payload, request_headers)
                response = conn.getresponse()
                result.append((response.status, json.loads(response.read())))
                conn.close()
            worker = threading.Thread(target=request)
            worker.start()
            server.handle_request()
            worker.join(5)
            self.assertFalse(worker.is_alive())
            return result[0]

    def test_http_protocol_returns_actual_account(self):
        status, body = self.http()
        self.assertEqual(200, status)
        self.assertEqual("12345", body["accountId"])

    def test_http_refuses_missing_token_browser_origin_and_dns_rebinding(self):
        for headers, host, expected in (({"Authorization": "Bearer invalid"}, None, "UNAUTHORIZED"),
                                        ({"Origin": "http://evil.invalid"}, None, "UNTRUSTED_ORIGIN"),
                                        ({}, "evil.invalid", "UNTRUSTED_ORIGIN")):
            status, body = self.http(headers=headers, host=host)
            self.assertIn(status, (401, 403))
            self.assertEqual(expected, body["code"])

    def test_http_rejects_malformed_json_without_sdk_details(self):
        status, body = self.http(body='{broken')
        self.assertEqual(400, status)
        self.assertEqual({"code": "INVALID_JSON"}, body)


if __name__ == "__main__":
    unittest.main()
