"""ATLAS /rpc gateway using only the official MetaTrader5 Python interface.

No SDK import, terminal initialization, login or trading occurs on import. The
main entry point attaches to the explicitly configured terminal; authentication
of the trading account is performed by its owner in that terminal.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

UTC = timezone.utc
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAGIC = 1_094_604_883
PAGE_SIZE = 500
# Documented MQL5 flag values. The official Python wheel does not export these.
SYMBOL_ORDER_LIMIT = 2
SYMBOL_EXPIRATION_DAY = 2
DOCUMENTATION = "https://www.mql5.com/en/docs/python_metatrader5"


class GatewayError(Exception):
    def __init__(self, code: str, status: int = 409):
        super().__init__(code)
        self.code, self.status = code, status


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def object_with(value: Any, keys: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise GatewayError("INVALID_REQUEST", 400)
    return value


def identifier(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip() or len(value) > 200:
        raise GatewayError("INVALID_IDENTIFIER", 400)
    return value


def decimal(value: Any) -> Decimal:
    try:
        if isinstance(value, bool):
            raise InvalidOperation
        result = Decimal(str(value))
        if not result.is_finite():
            raise InvalidOperation
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise GatewayError("INVALID_NUMERIC_DATA") from None


def amount(value: Any, positive: bool = False) -> str:
    result = decimal(value)
    if result < 0 or (positive and result == 0) or result.normalize().as_tuple().exponent < -8 or result >= Decimal("1e18"):
        raise GatewayError("UNREPRESENTABLE_AMOUNT")
    text = format(result, "f")
    return (text.rstrip("0").rstrip(".") if "." in text else text) or "0"


def integer(value: Any, positive: bool = False) -> int:
    result = decimal(value)
    if result != result.to_integral_value() or result < int(positive) or result > MAX_SAFE_INTEGER:
        raise GatewayError("UNREPRESENTABLE_QUANTITY")
    return int(result)


def ticket(value: Any) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", value):
        raise GatewayError("INVALID_ORDER_TICKET", 400)
    return int(value)


def get(value: Any, field: str) -> Any:
    try:
        return getattr(value, field)
    except AttributeError:
        raise GatewayError("INCOMPLETE_TERMINAL_DATA") from None


def strict_json(raw: str | bytes) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate field")
            result[key] = value
        return result

    def invalid(_):
        raise ValueError("nonfinite number")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


@dataclass(frozen=True)
class Config:
    token: str
    login: str
    server: str
    mode: str
    instruments: dict
    journal_path: Path
    terminal_path: str
    execution_enabled: bool = False
    port: int = 8785
    provider_id: str = "MT5"

    def validate(self):
        if not self.token.isascii() or len(self.token) < 32 or any(c.isspace() for c in self.token):
            raise GatewayError("INVALID_GATEWAY_TOKEN")
        ticket(self.login)
        identifier(self.server)
        identifier(self.provider_id)
        if self.mode not in ("REAL", "OFFICIAL_SANDBOX") or not (1024 <= self.port <= 65535):
            raise GatewayError("INVALID_CONFIGURATION")
        if not self.terminal_path or not isinstance(self.instruments, dict):
            raise GatewayError("INVALID_CONFIGURATION")
        for symbol, spec in self.instruments.items():
            identifier(symbol)
            object_with(spec, {"market", "terminalExchange", "isin", "contractSize"})
            if spec["market"] != "B3_CASH_EQUITY" or not re.fullmatch(r"BR[A-Z0-9]{10}", spec["isin"]):
                raise GatewayError("INVALID_INSTRUMENT_CONFIGURATION")
            identifier(spec["terminalExchange"])
            amount(spec["contractSize"], positive=True)

    @classmethod
    def from_environment(cls):
        try:
            instruments = strict_json(Path(os.environ["ATLAS_MT5_INSTRUMENTS_FILE"]).read_text(encoding="utf-8-sig"))
            enabled = os.environ.get("ATLAS_MT5_ENABLE_EXECUTION", "false")
            if enabled not in ("true", "false"):
                raise ValueError
            config = cls(
                token=os.environ["ATLAS_MT5_TOKEN"], login=os.environ["ATLAS_MT5_EXPECTED_LOGIN"],
                server=os.environ["ATLAS_MT5_EXPECTED_SERVER"], mode=os.environ["ATLAS_MT5_ACCOUNT_MODE"],
                instruments=instruments, journal_path=Path(os.environ["ATLAS_MT5_JOURNAL_PATH"]),
                terminal_path=os.environ["ATLAS_MT5_TERMINAL_PATH"], execution_enabled=enabled == "true",
                port=int(os.environ.get("ATLAS_MT5_PORT", "8785")),
                provider_id=os.environ.get("ATLAS_MT5_PROVIDER_ID", "MT5"),
            )
        except (KeyError, ValueError, OSError, TypeError):
            raise GatewayError("MISSING_OR_INVALID_CONFIGURATION") from None
        config.validate()
        return config


class Journal:
    """Durable dispatch intent. Never delete/rotate this DB while account is active."""
    def __init__(self, path: Path, scope: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), scope TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS dispatch (
            key TEXT PRIMARY KEY, digest TEXT NOT NULL, method TEXT NOT NULL, params TEXT NOT NULL,
            marker TEXT UNIQUE NOT NULL, state TEXT NOT NULL, response TEXT, error TEXT,
            broker_ticket TEXT, created_at TEXT NOT NULL
          );
        """)
        self.db.execute("INSERT OR IGNORE INTO identity VALUES (1, ?)", (scope,))
        self.db.commit()
        if self.db.execute("SELECT scope FROM identity").fetchone()[0] != scope:
            self.db.close()
            raise GatewayError("JOURNAL_ACCOUNT_MISMATCH")

    def close(self):
        self.db.close()

    def lookup(self, key: str):
        return self.db.execute("SELECT * FROM dispatch WHERE key=?", (key,)).fetchone()

    def by_ticket(self, value: str):
        return self.db.execute("SELECT * FROM dispatch WHERE method='submit' AND broker_ticket=?", (value,)).fetchone()

    def replay(self, key: str, method: str, params: dict):
        row = self.lookup(key)
        if row is None:
            return None
        digest = hashlib.sha256(canonical({"method": method, "params": params}).encode()).hexdigest()
        if row["digest"] != digest:
            raise GatewayError("IDEMPOTENCY_CONFLICT")
        if row["state"] == "ACKNOWLEDGED":
            return strict_json(row["response"])
        if row["state"] == "REJECTED":
            raise GatewayError(row["error"])
        raise GatewayError("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")

    def dispatch(self, key: str, method: str, params: dict, marker: str):
        digest = hashlib.sha256(canonical({"method": method, "params": params}).encode()).hexdigest()
        # The committed record precedes EVERY order_send. Unique key also serializes
        # dispatch if a second misconfigured process opens this same database.
        try:
            with self.db:
                self.db.execute("INSERT INTO dispatch VALUES (?,?,?,?,?,'DISPATCHED',NULL,NULL,NULL,?)",
                                (key, digest, method, canonical(params), marker, now()))
        except sqlite3.IntegrityError:
            raise GatewayError("DUPLICATE_DISPATCH_DO_NOT_RETRY") from None

    def bind(self, key: str, broker_ticket: str):
        with self.db:
            self.db.execute("UPDATE dispatch SET broker_ticket=? WHERE key=?", (broker_ticket, key))

    def acknowledge(self, key: str, response: dict):
        with self.db:
            self.db.execute("UPDATE dispatch SET state='ACKNOWLEDGED', response=?, broker_ticket=? WHERE key=?",
                            (canonical(response), response["brokerOrderId"], key))

    def reject(self, key: str, code: str):
        with self.db:
            self.db.execute("UPDATE dispatch SET state='REJECTED', error=? WHERE key=?", (code, key))


class Gateway:
    def __init__(self, api: Any, config: Config):
        config.validate()
        self.api, self.config = api, config
        self.journal = Journal(config.journal_path, canonical({"login": config.login, "server": config.server, "mode": config.mode}))

    def _identity(self, mutation: bool = False):
        info, terminal = self.api.account_info(), self.api.terminal_info()
        if info is None or terminal is None or not get(terminal, "connected"):
            raise GatewayError("TERMINAL_UNAVAILABLE", 503)
        if str(get(info, "login")) != self.config.login or get(info, "server") != self.config.server:
            raise GatewayError("GATEWAY_ACCOUNT_MISMATCH")
        expected_mode = self.api.ACCOUNT_TRADE_MODE_REAL if self.config.mode == "REAL" else self.api.ACCOUNT_TRADE_MODE_DEMO
        if get(info, "trade_mode") != expected_mode or get(info, "currency") != "BRL":
            raise GatewayError("UNSUPPORTED_ACCOUNT")
        if mutation and (not get(info, "trade_allowed") or not get(info, "trade_expert") or
                         not get(terminal, "trade_allowed") or get(terminal, "tradeapi_disabled")):
            raise GatewayError("TERMINAL_TRADING_DISABLED")
        return info

    def _call(self, method: str, *args, **kwargs):
        self._identity(mutation=method == "order_send")
        value = getattr(self.api, method)(*args, **kwargs)
        self._identity()
        if value is None:
            raise GatewayError("TERMINAL_CALL_FAILED", 503)
        return value

    def _instrument(self, symbol: str):
        spec = self.config.instruments.get(symbol)
        if spec is None:
            raise GatewayError("UNAPPROVED_INSTRUMENT")
        info = self._call("symbol_info", symbol)
        if (get(info, "name") != symbol or get(info, "custom") or
            get(info, "trade_calc_mode") != self.api.SYMBOL_CALC_MODE_EXCH_STOCKS or
            get(info, "trade_exemode") != self.api.SYMBOL_TRADE_EXECUTION_EXCHANGE or
            get(info, "currency_profit") != "BRL" or get(info, "currency_margin") != "BRL" or
            get(info, "exchange") != spec["terminalExchange"] or get(info, "isin") != spec["isin"] or
            get(info, "expiration_time") != 0 or
            decimal(get(info, "trade_contract_size")) != decimal(spec["contractSize"])):
            raise GatewayError("INSTRUMENT_NOT_VERIFIED_B3_CASH_EQUITY")
        return info

    def _quantity(self, volume: Any, info: Any) -> int:
        return integer(decimal(volume) * decimal(get(info, "trade_contract_size")))

    def _volume(self, quantity: Any, info: Any) -> float:
        if not isinstance(quantity, int) or isinstance(quantity, bool):
            raise GatewayError("INVALID_QUANTITY", 400)
        volume = Decimal(integer(quantity, positive=True)) / decimal(get(info, "trade_contract_size"))
        step = decimal(get(info, "volume_step"))
        if step <= 0 or volume % step or volume < decimal(get(info, "volume_min")) or volume > decimal(get(info, "volume_max")):
            raise GatewayError("INVALID_VOLUME_STEP_OR_LIMIT")
        # Refuse values which cannot survive the official API's double transport.
        if decimal(float(volume)) != volume:
            raise GatewayError("UNREPRESENTABLE_VOLUME")
        return float(volume)

    def _price(self, price: Any, info: Any) -> float:
        if not isinstance(price, str) or not re.fullmatch(r"\d+(\.\d{1,10})?", price):
            raise GatewayError("INVALID_PRICE", 400)
        value = decimal(amount(price, positive=True))
        tick_size = decimal(get(info, "trade_tick_size"))
        if tick_size <= 0 or value % tick_size or decimal(float(value)) != value:
            raise GatewayError("INVALID_PRICE_TICK")
        return float(value)

    def rpc(self, payload: Any):
        object_with(payload, {"version", "accountId", "method", "params"})
        if type(payload["version"]) is not int or payload["version"] != 1 or payload["accountId"] != self.config.login:
            raise GatewayError("GATEWAY_ACCOUNT_OR_VERSION_MISMATCH", 400)
        self._identity()  # Also capabilities/health/cash and replayed mutations.
        method, params = payload["method"], payload["params"]
        if method in ("capabilities", "health", "account", "cash", "positions", "orders"):
            object_with(params, set())
            if method == "capabilities":
                for symbol in self.config.instruments:
                    self._instrument(symbol)
                return {"providerId": self.config.provider_id, "documentationUrl": DOCUMENTATION, "verifiedAt": now(),
                        "cashEquities": bool(self.config.instruments), "overnight": False, "fractionalLots": False,
                        "orderKinds": ["LIMIT"], "clientOrderLookup": True, "nativeIdempotency": False,
                        "completeAccountReconciliation": False, "cloudAuthorized": False}
            if method == "health":
                return {"healthy": True, "observedAt": now(), "reason": None}
            if method == "account":
                return {"accountId": self.config.login, "currency": "BRL", "mode": self.config.mode, "cashOnly": False, "observedAt": now()}
            if method == "cash":
                raise GatewayError("SETTLED_CASH_UNAVAILABLE")
            if method == "positions":
                return self.positions()
            return [self._order(item) for item in self._call("orders_get")]
        if method == "order":
            object_with(params, {"brokerOrderId"})
            value = self._raw_order(ticket(params["brokerOrderId"]))
            return self._order(value) if value is not None else None
        if method == "orderByClientId":
            object_with(params, {"clientOrderId"})
            return self.order_by_client(identifier(params["clientOrderId"]))
        if method == "executions":
            object_with(params, {"cursor"})
            return self.executions(params["cursor"])
        if method in ("submit", "modify", "cancel"):
            return self.mutate(method, params)
        raise GatewayError("UNKNOWN_METHOD", 400)

    def positions(self):
        positions = {}
        for row in self._call("positions_get"):
            symbol = get(row, "symbol")
            info = self._instrument(symbol)
            if get(row, "type") != self.api.POSITION_TYPE_BUY:
                raise GatewayError("SHORT_POSITION_UNSUPPORTED")
            quantity = self._quantity(get(row, "volume"), info)
            if not quantity:
                raise GatewayError("INVALID_POSITION")
            price = decimal(amount(get(row, "price_open"), positive=True))
            total, cost = positions.get(symbol, (0, Decimal(0)))
            positions[symbol] = (integer(total + quantity), cost + price * quantity)
        return [{"symbol": symbol, "quantity": quantity, "averagePrice": amount(cost / quantity), "observedAt": now()}
                for symbol, (quantity, cost) in sorted(positions.items())]

    def _raw_order(self, order_ticket: int):
        rows = self._call("orders_get", ticket=order_ticket)
        if not rows:
            rows = self._call("history_orders_get", ticket=order_ticket)
        if len(rows) > 1:
            raise GatewayError("AMBIGUOUS_ORDER_LOOKUP")
        if rows and get(rows[0], "ticket") != order_ticket:
            raise GatewayError("GATEWAY_ORDER_MISMATCH")
        return rows[0] if rows else None

    def _order(self, row):
        info = self._instrument(get(row, "symbol"))
        order_type = get(row, "type")
        buys = {self.api.ORDER_TYPE_BUY, self.api.ORDER_TYPE_BUY_LIMIT, self.api.ORDER_TYPE_BUY_STOP, self.api.ORDER_TYPE_BUY_STOP_LIMIT}
        sells = {self.api.ORDER_TYPE_SELL, self.api.ORDER_TYPE_SELL_LIMIT, self.api.ORDER_TYPE_SELL_STOP, self.api.ORDER_TYPE_SELL_STOP_LIMIT}
        if order_type not in buys | sells:
            raise GatewayError("UNSUPPORTED_ORDER_TYPE")
        quantity = self._quantity(get(row, "volume_initial"), info)
        filled = 0
        for deal in self._call("history_deals_get", ticket=get(row, "ticket")):
            if get(deal, "type") in (self.api.DEAL_TYPE_BUY, self.api.DEAL_TYPE_SELL):
                if get(deal, "order") != get(row, "ticket") or get(deal, "symbol") != get(row, "symbol"):
                    raise GatewayError("GATEWAY_ORDER_MISMATCH")
                filled += self._quantity(get(deal, "volume"), info)
            elif get(deal, "type") in (self.api.DEAL_TYPE_BUY_CANCELED, self.api.DEAL_TYPE_SELL_CANCELED):
                raise GatewayError("EXECUTION_CORRECTION_REQUIRES_RECONCILIATION")
        if not quantity or filled > quantity:
            raise GatewayError("INCONSISTENT_ORDER_FILLS")
        states = {self.api.ORDER_STATE_STARTED: "PENDING", self.api.ORDER_STATE_PLACED: "OPEN",
                  self.api.ORDER_STATE_CANCELED: "CANCELLED", self.api.ORDER_STATE_PARTIAL: "PARTIALLY_FILLED",
                  self.api.ORDER_STATE_FILLED: "FILLED", self.api.ORDER_STATE_REJECTED: "REJECTED", self.api.ORDER_STATE_EXPIRED: "EXPIRED"}
        status = states.get(get(row, "state"), "UNKNOWN")
        if (status == "FILLED" and filled != quantity) or (status == "PARTIALLY_FILLED" and not 0 < filled < quantity):
            raise GatewayError("INCONSISTENT_ORDER_FILLS")
        journal_row = self.journal.by_ticket(str(get(row, "ticket")))
        client_id = journal_row["key"] if journal_row else None
        result = {"brokerOrderId": str(get(row, "ticket")), "clientOrderId": client_id,
                  "accountId": self.config.login, "symbol": get(row, "symbol"), "side": "BUY" if order_type in buys else "SELL",
                  "quantity": quantity, "filledQuantity": filled, "status": status, "observedAt": now()}
        if client_id and order_type in (self.api.ORDER_TYPE_BUY_LIMIT, self.api.ORDER_TYPE_SELL_LIMIT) and get(row, "type_time") == self.api.ORDER_TIME_DAY:
            # Echo actual terminal terms, never merely repeat the requested change.
            result["request"] = {"clientOrderId": client_id, "accountId": self.config.login,
                                 "symbol": result["symbol"], "side": result["side"], "quantity": quantity,
                                 "kind": "LIMIT", "limitPrice": amount(get(row, "price_open"), positive=True),
                                 "stopPrice": None, "timeInForce": "DAY"}
        return result

    def order_by_client(self, client_id: str):
        entry = self.journal.lookup(client_id)
        if entry is None or entry["method"] != "submit":
            return None
        if entry["broker_ticket"]:
            row = self._raw_order(ticket(entry["broker_ticket"]))
            if row is None:
                raise GatewayError("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")
            return self._order(row)
        if entry["state"] == "REJECTED":
            return None
        start = datetime.fromisoformat(entry["created_at"].replace("Z", "+00:00"))
        rows = list(self._call("orders_get")) + list(self._call("history_orders_get", start, datetime.now(UTC)))
        matches = {get(row, "ticket"): row for row in rows if get(row, "magic") == MAGIC and get(row, "comment") == entry["marker"]}
        if len(matches) != 1:
            raise GatewayError("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")
        row = next(iter(matches.values()))
        expected = strict_json(entry["params"])["request"]
        # Comment/magic identify a candidate only; check all immutable economics.
        self._verify_submit_terms(row, expected)
        self.journal.bind(client_id, str(get(row, "ticket")))
        result = self._order(row)
        self.journal.acknowledge(client_id, result)
        return result

    def _verify_submit_terms(self, row, expected):
        info = self._instrument(get(row, "symbol"))
        if (get(row, "symbol") != expected["symbol"] or
            get(row, "type") != (self.api.ORDER_TYPE_BUY_LIMIT if expected["side"] == "BUY" else self.api.ORDER_TYPE_SELL_LIMIT) or
            self._quantity(get(row, "volume_initial"), info) != expected["quantity"] or
            get(row, "type_time") != self.api.ORDER_TIME_DAY or
            decimal(get(row, "price_open")) != decimal(expected["limitPrice"])):
            raise GatewayError("RECOVERY_ORDER_MISMATCH")

    def executions(self, cursor):
        until = int(datetime.now(UTC).timestamp() * 1000)
        after = (0, 0)
        if cursor is not None:
            if not isinstance(cursor, str) or len(cursor) > 200:
                raise GatewayError("INVALID_EXECUTION_CURSOR", 400)
            match = re.fullmatch(r"v1:(\d{1,16}):(\d{1,16}):(\d{1,20})", cursor)
            if not match:
                raise GatewayError("INVALID_EXECUTION_CURSOR", 400)
            end, stamp, deal_ticket = map(int, match.groups())
            if end > until or stamp > end:
                raise GatewayError("INVALID_EXECUTION_CURSOR", 400)
            until, after = end, (stamp, deal_ticket)
        rows = self._call("history_deals_get", datetime(1970, 1, 1, tzinfo=UTC), datetime.fromtimestamp(until / 1000, UTC))
        if len(rows) > 100_000:
            raise GatewayError("HISTORY_TOO_LARGE_FOR_COMPLETE_SNAPSHOT")
        entries = []
        for row in rows:
            kind = get(row, "type")
            if kind in (self.api.DEAL_TYPE_BUY_CANCELED, self.api.DEAL_TYPE_SELL_CANCELED):
                raise GatewayError("EXECUTION_CORRECTION_REQUIRES_RECONCILIATION")
            if kind not in (self.api.DEAL_TYPE_BUY, self.api.DEAL_TYPE_SELL):
                continue  # Cash/commission/dividend entries require a separate cash ledger.
            key = (integer(get(row, "time_msc")), int(get(row, "ticket")))
            if not after < key or key[0] > until:
                continue
            entries.append((key, row))
        entries.sort(key=lambda item: item[0])
        results = []
        for key, row in entries[:PAGE_SIZE]:
            info = self._instrument(get(row, "symbol"))
            # These are observed per-deal charges only, not total brokerage/B3 costs.
            commission, fee = decimal(get(row, "commission")), decimal(get(row, "fee"))
            if commission > 0 or fee > 0:
                raise GatewayError("SIGNED_EXECUTION_FEES_UNSUPPORTED")
            results.append({"executionId": str(get(row, "ticket")), "brokerOrderId": str(get(row, "order")),
                            "accountId": self.config.login, "symbol": get(row, "symbol"),
                            "side": "BUY" if get(row, "type") == self.api.DEAL_TYPE_BUY else "SELL",
                            "quantity": integer(self._quantity(get(row, "volume"), info), positive=True),
                            "price": amount(get(row, "price"), positive=True), "fees": amount(-(commission + fee)), "feesVerified": False,
                            "executedAt": datetime.fromtimestamp(key[0] / 1000, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")})
        next_cursor = None
        if len(entries) > PAGE_SIZE:
            last = entries[PAGE_SIZE - 1][0]
            next_cursor = f"v1:{until}:{last[0]}:{last[1]}"
        return {"executions": results, "nextCursor": next_cursor}

    def mutate(self, method: str, params: Any):
        fields = {"request", "idempotencyKey"} if method == "submit" else {"brokerOrderId", "idempotencyKey"}
        if method == "modify":
            fields.add("changes")
        object_with(params, fields)
        key = identifier(params["idempotencyKey"])
        replay = self.journal.replay(key, method, params)
        if replay is not None:
            return replay
        if not self.config.execution_enabled:
            raise GatewayError("EXECUTION_DISABLED")
        self._identity(mutation=True)
        marker = "ATLAS:" + hashlib.sha256(key.encode()).hexdigest()[:24]
        if method == "submit":
            request = object_with(params["request"], {"clientOrderId", "accountId", "symbol", "side", "quantity", "kind", "limitPrice", "stopPrice", "timeInForce"})
            if request["clientOrderId"] != key or request["accountId"] != self.config.login:
                raise GatewayError("ORDER_IDENTITY_MISMATCH", 400)
            if request["kind"] != "LIMIT" or request["timeInForce"] != "DAY" or request["stopPrice"] is not None or request["side"] not in ("BUY", "SELL"):
                raise GatewayError("UNSUPPORTED_ORDER_TERMS", 400)
            info = self._instrument(identifier(request["symbol"]))
            if not get(info, "order_mode") & SYMBOL_ORDER_LIMIT or not get(info, "expiration_mode") & SYMBOL_EXPIRATION_DAY:
                raise GatewayError("LIMIT_DAY_NOT_SUPPORTED")
            native = {"action": self.api.TRADE_ACTION_PENDING, "symbol": request["symbol"],
                      "volume": self._volume(request["quantity"], info),
                      "type": self.api.ORDER_TYPE_BUY_LIMIT if request["side"] == "BUY" else self.api.ORDER_TYPE_SELL_LIMIT,
                      "price": self._price(request["limitPrice"], info), "type_time": self.api.ORDER_TIME_DAY,
                      "type_filling": self.api.ORDER_FILLING_RETURN, "magic": MAGIC, "comment": marker}
        else:
            order_ticket = ticket(params["brokerOrderId"])
            row = self._raw_order(order_ticket)
            if row is None:
                raise GatewayError("ORDER_NOT_FOUND")
            current = self._order(row)
            if current["clientOrderId"] is None or get(row, "magic") != MAGIC:
                raise GatewayError("ORDER_NOT_OWNED_BY_ATLAS")
            if get(row, "type") not in (self.api.ORDER_TYPE_BUY_LIMIT, self.api.ORDER_TYPE_SELL_LIMIT) or get(row, "type_time") != self.api.ORDER_TIME_DAY:
                raise GatewayError("UNSUPPORTED_ORDER_TERMS")
            if current["status"] not in ("OPEN", "PARTIALLY_FILLED"):
                raise GatewayError("ORDER_NOT_MODIFIABLE")
            native = {"action": self.api.TRADE_ACTION_REMOVE, "order": order_ticket}
            if method == "modify":
                changes = object_with(params["changes"], {"quantity", "limitPrice", "stopPrice"})
                if type(changes["quantity"]) is not int or changes["quantity"] != current["quantity"] or changes["stopPrice"] is not None:
                    raise GatewayError("QUANTITY_OR_STOP_MODIFICATION_UNSUPPORTED")
                info = self._instrument(current["symbol"])
                native = {"action": self.api.TRADE_ACTION_MODIFY, "order": order_ticket,
                          "price": self._price(changes["limitPrice"], info), "type_time": self.api.ORDER_TIME_DAY,
                          "expiration": get(row, "time_expiration"), "sl": get(row, "sl"), "tp": get(row, "tp"),
                          "stoplimit": get(row, "price_stoplimit")}
        if method != "cancel":
            checked = self._call("order_check", native)
            if get(checked, "retcode") != 0:
                raise GatewayError("ORDER_CHECK_REJECTED")
        self.journal.dispatch(key, method, params, marker)
        try:
            result = self._call("order_send", native)
        except Exception:
            # The record remains DISPATCHED, even if the SDK failed before sending.
            raise GatewayError("AMBIGUOUS_DISPATCH_DO_NOT_RETRY", 503) from None
        code = get(result, "retcode")
        accepted = {self.api.TRADE_RETCODE_DONE, self.api.TRADE_RETCODE_PLACED, self.api.TRADE_RETCODE_DONE_PARTIAL}
        if code not in accepted:
            # Only explicit server rejections are definitive; timeout/connection/error
            # and unrecognized codes remain ambiguous and are NEVER retried.
            rejected = {self.api.TRADE_RETCODE_REJECT, self.api.TRADE_RETCODE_INVALID,
                        self.api.TRADE_RETCODE_INVALID_VOLUME, self.api.TRADE_RETCODE_INVALID_PRICE,
                        self.api.TRADE_RETCODE_INVALID_STOPS, self.api.TRADE_RETCODE_TRADE_DISABLED,
                        self.api.TRADE_RETCODE_MARKET_CLOSED, self.api.TRADE_RETCODE_NO_MONEY,
                        self.api.TRADE_RETCODE_INVALID_EXPIRATION, self.api.TRADE_RETCODE_INVALID_FILL}
            if code in rejected:
                self.journal.reject(key, "ORDER_REJECTED")
                raise GatewayError("ORDER_REJECTED")
            raise GatewayError("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")
        broker_ticket = get(result, "order") if method == "submit" else ticket(params["brokerOrderId"])
        if not broker_ticket:
            raise GatewayError("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")
        row = self._raw_order(int(broker_ticket))
        if row is None:
            raise GatewayError("AMBIGUOUS_DISPATCH_DO_NOT_RETRY")
        if method == "submit":
            self._verify_submit_terms(row, params["request"])
        self.journal.bind(key, str(broker_ticket))
        response = self._order(row)
        if method == "submit":
            echo = response.get("request")
            expected = params["request"]
            if (not echo or any(echo[field] != expected[field] for field in
                               ("clientOrderId", "accountId", "symbol", "side", "quantity", "kind", "timeInForce")) or
                decimal(echo["limitPrice"]) != decimal(expected["limitPrice"])):
                raise GatewayError("SUBMITTED_ORDER_TERMS_MISMATCH")
        if method == "modify":
            echo = response.get("request")
            if not echo or decimal(echo["limitPrice"]) != decimal(params["changes"]["limitPrice"]):
                raise GatewayError("AMBIGUOUS_MODIFICATION")
        if method == "cancel" and response["status"] != "CANCELLED":
            raise GatewayError("CANCELLATION_NOT_CONFIRMED")
        self.journal.acknowledge(key, response)
        return response


def handler_for(gateway: Gateway):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ATLAS-Gateway"
        sys_version = ""

        def log_message(self, format, *args):
            pass  # Never log tokens, request bodies, account data or SDK errors.

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def reply(self, status, body):
            encoded = canonical(body).encode()
            if len(encoded) > 2_000_000:
                status, encoded = 503, b'{"code":"GATEWAY_RESPONSE_TOO_LARGE"}'
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            self.wfile.write(encoded)

        def do_POST(self):
            try:
                if self.path != "/rpc":
                    raise GatewayError("NOT_FOUND", 404)
                if self.headers.get("Origin") is not None or self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                    raise GatewayError("UNTRUSTED_ORIGIN", 403)
                auth = self.headers.get("Authorization", "")
                if not auth.isascii() or not hmac.compare_digest(auth, "Bearer " + gateway.config.token):
                    raise GatewayError("UNAUTHORIZED", 401)
                if self.headers.get("Transfer-Encoding") is not None or self.headers.get("Content-Type") != "application/json":
                    raise GatewayError("INVALID_CONTENT_TYPE", 400)
                length = self.headers.get("Content-Length", "")
                if not length.isascii() or not length.isdecimal() or not 1 <= int(length) <= 65_536:
                    raise GatewayError("INVALID_CONTENT_LENGTH", 400)
                raw = self.rfile.read(int(length))
                if len(raw) != int(length):
                    raise GatewayError("INCOMPLETE_REQUEST", 400)
                try:
                    payload = strict_json(raw)
                except (ValueError, UnicodeError):
                    raise GatewayError("INVALID_JSON", 400) from None
                self.reply(200, gateway.rpc(payload))
            except GatewayError as exc:
                self.reply(exc.status, {"code": exc.code})
            except Exception:
                self.reply(503, {"code": "GATEWAY_INTERNAL_ERROR"})

    return Handler


def main():
    gateway = None
    api = None
    try:
        config = Config.from_environment()
        if os.name != "nt":
            raise GatewayError("WINDOWS_TERMINAL_REQUIRED")
        import MetaTrader5 as api  # Official package, loaded only by the entry point.
        if not api.initialize(config.terminal_path, timeout=5000):
            raise GatewayError("TERMINAL_INITIALIZATION_FAILED")
        gateway = Gateway(api, config)
        gateway._identity()
        # Deliberately serial: the SDK's connected terminal/account is process-global.
        with HTTPServer(("127.0.0.1", config.port), handler_for(gateway)) as server:
            print(f"ATLAS MT5 gateway: http://127.0.0.1:{config.port}; execution={'enabled' if config.execution_enabled else 'disabled'}", flush=True)
            server.serve_forever()
    except GatewayError as exc:
        print(exc.code, flush=True)
        raise SystemExit(1) from None
    except ImportError:
        print("OFFICIAL_METATRADER5_PACKAGE_REQUIRED", flush=True)
        raise SystemExit(1) from None
    except KeyboardInterrupt:
        pass
    finally:
        if gateway:
            gateway.journal.close()
        if api:
            api.shutdown()


if __name__ == "__main__":
    main()
