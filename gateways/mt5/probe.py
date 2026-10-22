"""Read-only validation of an authenticated MT5 terminal before any ATLAS gateway use.

Usage (Windows, terminal already open and logged in by its owner):
    python gateways/mt5/probe.py --profile GENIAL_SWING --symbols PETR4,VALE3

Only ATLAS_MT5_TERMINAL_PATH is read from the environment. No token, password,
balance, equity or margin value is read into the report. The SDK is wrapped by
ReadOnlyTerminal, which exposes only query functions: order_check/order_send
and every other non-allowlisted call raise before reaching the terminal.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

from gateway import (ACCOUNT_MARGIN_MODE_EXCHANGE, ACCOUNT_MARGIN_MODE_RETAIL_HEDGING,
                     ACCOUNT_MARGIN_MODE_RETAIL_NETTING, PROFILES, SYMBOL_EXPIRATION_DAY, SYMBOL_ORDER_LIMIT)

READ_ONLY_CALLS = frozenset({
    "initialize", "shutdown", "version", "last_error", "terminal_info", "account_info",
    "symbol_info", "positions_total", "orders_total", "positions_get", "orders_get",
})
# Documented MQL5 flag values (not exported by the wheel).
ORDER_MODES = {1: "MARKET", 2: "LIMIT", 4: "STOP", 8: "STOP_LIMIT", 16: "SL", 32: "TP", 64: "CLOSE_BY"}
EXPIRATION_MODES = {1: "GTC", 2: "DAY", 4: "SPECIFIED", 8: "SPECIFIED_DAY"}
FILLING_MODES = {1: "FOK", 2: "IOC", 4: "BOC"}  # RETURN is implied when neither FOK nor IOC is required.
MARGIN_MODES = {ACCOUNT_MARGIN_MODE_RETAIL_NETTING: "RETAIL_NETTING", ACCOUNT_MARGIN_MODE_EXCHANGE: "EXCHANGE",
                ACCOUNT_MARGIN_MODE_RETAIL_HEDGING: "RETAIL_HEDGING"}


class ReadOnlyViolation(Exception):
    pass


class ReadOnlyTerminal:
    """Allowlist proxy. Constants (UPPER_CASE) pass through; functions must be allowlisted."""
    def __init__(self, api: Any):
        self._api = api

    def __getattr__(self, name: str):
        if name.isupper() or name in READ_ONLY_CALLS:
            return getattr(self._api, name)
        raise ReadOnlyViolation(name)


def flags(value: int, names: dict) -> list[str]:
    return [label for bit, label in names.items() if value & bit]


def mask(login: Any) -> str:
    text = str(login)
    return "*" * max(len(text) - 3, 0) + text[-3:]


def check(results: list, name: str, ok: bool | None, detail: str):
    results.append({"check": name, "result": "UNKNOWN" if ok is None else ("PASS" if ok else "FAIL"), "detail": detail})


def symbol_report(api: Any, symbol: str) -> dict:
    info = api.symbol_info(symbol)
    if info is None:
        return {"symbol": symbol, "found": False}
    order_mode, expiration_mode = int(info.order_mode), int(info.expiration_mode)
    cash_equity = (not info.custom and info.trade_calc_mode == api.SYMBOL_CALC_MODE_EXCH_STOCKS and
                   info.trade_exemode == api.SYMBOL_TRADE_EXECUTION_EXCHANGE and
                   info.currency_profit == "BRL" and info.currency_margin == "BRL" and info.expiration_time == 0 and
                   str(info.isin).startswith("BR"))
    report = {
        "symbol": symbol, "found": True, "looksLikeB3CashEquity": cash_equity,
        "exchange": info.exchange, "isin": info.isin, "contractSize": info.trade_contract_size,
        "volumeMin": info.volume_min, "volumeStep": info.volume_step, "volumeMax": info.volume_max,
        "tickSize": info.trade_tick_size, "orderModes": flags(order_mode, ORDER_MODES),
        "expirationModes": flags(expiration_mode, EXPIRATION_MODES),
        "fillingModes": flags(int(info.filling_mode), FILLING_MODES) or ["RETURN_ONLY"],
        "limitDaySupported": bool(order_mode & SYMBOL_ORDER_LIMIT and expiration_mode & SYMBOL_EXPIRATION_DAY),
    }
    if cash_equity:
        # A suggestion only: the owner must confirm it before copying to the private instruments file.
        report["instrumentsEntrySuggestion"] = {symbol: {"market": "B3_CASH_EQUITY", "terminalExchange": info.exchange,
                                                         "isin": info.isin, "contractSize": str(info.trade_contract_size)}}
    return report


def probe(api: Any, profile: str, symbols: list[str], expected_server: str | None = None) -> dict:
    api = ReadOnlyTerminal(api)
    checks: list = []
    terminal, account = api.terminal_info(), api.account_info()
    check(checks, "terminal_connected", bool(terminal and terminal.connected), "Terminal aberto e conectado ao servidor")
    if account is None:
        check(checks, "account_logged_in", False, "Nenhuma conta autenticada no terminal")
        return {"observedAt": datetime.now(timezone.utc).isoformat(), "profile": profile, "checks": checks,
                "readOnly": True, "ready": False}
    genial = profile.startswith("GENIAL_")
    check(checks, "currency_brl", account.currency == "BRL", f"Moeda da conta: {account.currency}")
    check(checks, "real_account", account.trade_mode == api.ACCOUNT_TRADE_MODE_REAL,
          "Genial não oferece demo; o perfil Genial exige conta REAL" if genial else "Modo da conta")
    margin = MARGIN_MODES.get(account.margin_mode, f"UNKNOWN({account.margin_mode})")
    check(checks, "not_hedging", account.margin_mode in (ACCOUNT_MARGIN_MODE_RETAIL_NETTING, ACCOUNT_MARGIN_MODE_EXCHANGE),
          f"Modo de margem/posição: {margin}. Genial Swing é Netting; o ledger atribui posições aos agentes")
    if expected_server is not None:
        check(checks, "expected_server", account.server == expected_server, "Servidor igual ao informado pelo proprietário")
    else:
        check(checks, "expected_server", None, "Informe --expected-server com o servidor Swing confirmado pela Genial")
    check(checks, "terminal_algo_trading_button", bool(terminal and terminal.trade_allowed),
          "Botão Algo Trading do terminal (só importa quando a execução for autorizada)")
    check(checks, "python_api_enabled", bool(terminal and not terminal.tradeapi_disabled),
          "Opção 'Disable automated trading via external Python API' desmarcada")
    check(checks, "account_allows_experts", bool(account.trade_expert), "Conta permite negociação automatizada")
    reports = [symbol_report(api, s) for s in symbols]
    for item in reports:
        check(checks, f"symbol_{item['symbol']}", item.get("looksLikeB3CashEquity", False) and item.get("limitDaySupported", False),
              "Ação à vista B3 com LIMIT/DAY" if item["found"] else "Símbolo não encontrado (abra-o no Market Watch)")
    hard = {"terminal_connected", "currency_brl", "real_account", "not_hedging"}
    return {
        "observedAt": datetime.now(timezone.utc).isoformat(), "profile": profile, "readOnly": True,
        "terminal": {"build": api.version()[1] if api.version() else None, "company": terminal.company if terminal else None},
        "account": {"login": mask(account.login), "server": account.server, "marginMode": margin,
                    "limitOrders": account.limit_orders},
        "openPositionsCount": api.positions_total(), "openOrdersCount": api.orders_total(),
        "symbols": reports, "checks": checks,
        "ready": all(c["result"] == "PASS" for c in checks if c["check"] in hard),
    }


def main():
    parser = argparse.ArgumentParser(description="ATLAS MT5 read-only probe")
    parser.add_argument("--profile", choices=PROFILES, default="GENIAL_SWING")
    parser.add_argument("--symbols", default="", help="Ex.: PETR4,VALE3")
    parser.add_argument("--expected-server", default=None)
    args = parser.parse_args()
    if os.name != "nt":
        print("WINDOWS_TERMINAL_REQUIRED"); raise SystemExit(1)
    path = os.environ.get("ATLAS_MT5_TERMINAL_PATH")
    if not path:
        print("ATLAS_MT5_TERMINAL_PATH_REQUIRED"); raise SystemExit(1)
    try:
        import MetaTrader5 as sdk
    except ImportError:
        print("OFFICIAL_METATRADER5_PACKAGE_REQUIRED"); raise SystemExit(1)
    api = ReadOnlyTerminal(sdk)
    # No login/password arguments: attaches to the account the owner opened in the terminal.
    if not api.initialize(path, timeout=5000):
        print("TERMINAL_INITIALIZATION_FAILED"); raise SystemExit(1)
    try:
        symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
        report = probe(sdk, args.profile, symbols, args.expected_server)
        json.dump(report, sys.stdout, indent=2, ensure_ascii=False, default=str)
        print()
        raise SystemExit(0 if report["ready"] else 2)
    finally:
        api.shutdown()


if __name__ == "__main__":
    main()
