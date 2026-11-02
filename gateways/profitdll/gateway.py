from __future__ import annotations

"""Read-only ProfitDLL WIN x64 collector. No OMS or order-routing functions are loaded."""

import ctypes as C
import json
import os
import queue
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

NL_OK = 0
LOGIN, MARKET, ACTIVATION = 0, 2, 3
LOGIN_CONNECTED, MARKET_CONNECTED, ACTIVATION_VALID = 0, 4, 0
LOCAL_TZ = ZoneInfo("America/Sao_Paulo")


class SystemTime(C.Structure):
    _fields_ = [(name, C.c_ushort) for name in (
        "wYear", "wMonth", "wDayOfWeek", "wDay", "wHour", "wMinute", "wSecond", "wMilliseconds"
    )]


class AssetIdentifier(C.Structure):
    _fields_ = [
        ("Version", C.c_ubyte), ("Ticker", C.c_void_p), ("Exchange", C.c_void_p), ("FeedType", C.c_ubyte)
    ]


class ConnectorTrade(C.Structure):
    _fields_ = [
        ("Version", C.c_ubyte), ("TradeDate", SystemTime), ("TradeNumber", C.c_uint),
        ("Price", C.c_double), ("Quantity", C.c_longlong), ("Volume", C.c_double),
        ("BuyAgent", C.c_int), ("SellAgent", C.c_int), ("TradeType", C.c_ubyte),
    ]


StateCallback = C.WINFUNCTYPE(None, C.c_int, C.c_int)
TradeCallback = C.WINFUNCTYPE(None, AssetIdentifier, C.c_size_t, C.c_uint)


@dataclass(frozen=True)
class Tick:
    ticker: str
    exchange: str
    price: float
    sequence: int
    exchange_at: datetime


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Configuração ausente: {name}")
    return value


def load_local_env() -> None:
    """Load only this gateway's ignored local settings file; process env wins over file values."""
    env_file = Path(__file__).with_name(".env.local")
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def parse_config() -> tuple[Path, str, str, str, str]:
    load_local_env()
    if sys.platform != "win32" or C.sizeof(C.c_void_p) != 8 or C.sizeof(C.c_wchar) != 2:
        raise RuntimeError("Execute com Python Windows x64; ProfitDLL não aceita ABI Linux nativa.")
    runtime_dir = Path(require_env("PROFITDLL_RUNTIME_DIR")).resolve(strict=True)
    dll_path = runtime_dir / "ProfitDLL.dll"
    if not dll_path.is_file():
        raise FileNotFoundError(f"ProfitDLL.dll não encontrada em {runtime_dir}")
    ticker = require_env("PROFITDLL_TICKER").upper()
    if not ticker.isalnum() or not 3 <= len(ticker) <= 12:
        raise RuntimeError("PROFITDLL_TICKER inválido; informe o ticker habilitado na configuração do DASH.")
    exchange = os.environ.get("PROFITDLL_EXCHANGE", "F").strip().upper()
    if exchange != "F":
        raise RuntimeError("Este coletor está restrito à bolsa de futuros B3 (F).")
    endpoint = require_env("DASH_API_URL").rstrip("/")
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or parsed.path.rstrip("/") != "/api/daytrade/quote" or parsed.query or parsed.fragment:
        raise RuntimeError("DASH_API_URL deve ser HTTPS e terminar exatamente em /api/daytrade/quote.")
    secret = require_env("PROFITDLL_INGEST_SECRET")
    if len(secret) < 32:
        raise RuntimeError("PROFITDLL_INGEST_SECRET deve ter pelo menos 32 caracteres.")
    if C.sizeof(SystemTime) != 16 or C.sizeof(AssetIdentifier) != 32 or C.sizeof(ConnectorTrade) != 64:
        raise RuntimeError("Estruturas da ABI incompatíveis com a ProfitDLL x64 documentada.")
    if ConnectorTrade.TradeDate.offset != 2 or ConnectorTrade.Price.offset != 24 or ConnectorTrade.TradeType.offset != 56:
        raise RuntimeError("Offsets da ABI incompatíveis com a ProfitDLL x64 documentada.")
    return runtime_dir, ticker, exchange, endpoint, secret


class ProfitFeed:
    def __init__(self, runtime_dir: Path, ticker: str, exchange: str):
        self.ticker, self.exchange = ticker, exchange
        self.events: queue.Queue[Tick] = queue.Queue(maxsize=10_000)
        self.states: dict[int, int] = {}
        self.changed = threading.Condition()
        self.accepting = threading.Event()
        self.callback_gate = threading.Lock()
        self.dropped = 0
        self.dll_dir = None
        self.initialized = False
        self.subscribed = False
        os.chdir(runtime_dir)
        self.dll_dir = os.add_dll_directory(str(runtime_dir))
        self.dll = C.WinDLL(str(runtime_dir / "ProfitDLL.dll"))
        self.state_cb = StateCallback(self._state_callback)
        self.trade_cb = TradeCallback(self._trade_callback)
        self._configure()

    def _configure(self) -> None:
        optional = C.c_void_p
        self.dll.DLLInitializeMarketLogin.argtypes = [C.c_wchar_p, C.c_wchar_p, C.c_wchar_p, StateCallback] + [optional] * 7
        self.dll.DLLInitializeMarketLogin.restype = C.c_int
        self.dll.SetTradeCallbackV2.argtypes = [TradeCallback]
        self.dll.SetTradeCallbackV2.restype = C.c_int
        self.dll.TranslateTrade.argtypes = [C.c_size_t, C.POINTER(ConnectorTrade)]
        self.dll.TranslateTrade.restype = C.c_int
        self.dll.SubscribeTicker.argtypes = [C.c_wchar_p, C.c_wchar_p]
        self.dll.SubscribeTicker.restype = C.c_int
        self.dll.UnsubscribeTicker.argtypes = [C.c_wchar_p, C.c_wchar_p]
        self.dll.UnsubscribeTicker.restype = C.c_int
        self.dll.DLLFinalize.argtypes = []
        self.dll.DLLFinalize.restype = C.c_int

    def _state_callback(self, state_type: int, result: int) -> None:
        try:
            with self.changed:
                self.states[int(state_type)] = int(result)
                self.changed.notify_all()
        except BaseException:
            return

    def _trade_callback(self, asset: AssetIdentifier, trade_pointer: int, flags: int) -> None:
        del flags
        with self.callback_gate:
            if not self.accepting.is_set():
                return
            try:
                ticker = C.cast(asset.Ticker, C.c_wchar_p).value if asset.Ticker else ""
                exchange = C.cast(asset.Exchange, C.c_wchar_p).value if asset.Exchange else ""
                if ticker.upper() != self.ticker or exchange.upper() != self.exchange:
                    return
                trade = ConnectorTrade(Version=0)
                if self.dll.TranslateTrade(trade_pointer, C.byref(trade)) != NL_OK:
                    return
                raw = trade.TradeDate
                exchange_at = datetime(raw.wYear, raw.wMonth, raw.wDay, raw.wHour, raw.wMinute,
                                       raw.wSecond, raw.wMilliseconds * 1000, tzinfo=LOCAL_TZ).astimezone(timezone.utc)
                tick = Tick(ticker, exchange, float(trade.Price), int(trade.TradeNumber), exchange_at)
                if tick.price <= 0:
                    return
                self.events.put_nowait(tick)
            except queue.Full:
                self.dropped += 1
            except BaseException:
                # Exceptions must never cross the native callback boundary.
                return

    def initialize(self, key: str, user: str, password: str) -> None:
        result = self.dll.DLLInitializeMarketLogin(key, user, password, self.state_cb, None, None, None, None, None, None, None)
        if result != NL_OK:
            raise RuntimeError(f"DLLInitializeMarketLogin retornou {result}.")
        self.initialized = True
        result = self.dll.SetTradeCallbackV2(self.trade_cb)
        if result != NL_OK:
            raise RuntimeError(f"SetTradeCallbackV2 retornou {result}.")

    def wait_ready(self, timeout: float = 30.0) -> None:
        expected = {LOGIN: LOGIN_CONNECTED, MARKET: MARKET_CONNECTED, ACTIVATION: ACTIVATION_VALID}
        with self.changed:
            if not self.changed.wait_for(lambda: all(self.states.get(k) == v for k, v in expected.items()), timeout):
                raise TimeoutError("A ProfitDLL não confirmou login, Market Data e ativação dentro de 30 segundos.")

    def subscribe(self) -> None:
        self.accepting.set()
        result = self.dll.SubscribeTicker(self.ticker, self.exchange)
        if result != NL_OK:
            self.accepting.clear()
            raise RuntimeError(f"SubscribeTicker retornou {result}.")
        self.subscribed = True

    def is_ready(self) -> bool:
        with self.changed:
            return (self.states.get(LOGIN) == LOGIN_CONNECTED and
                    self.states.get(MARKET) == MARKET_CONNECTED and
                    self.states.get(ACTIVATION) == ACTIVATION_VALID)

    def close(self) -> None:
        self.accepting.clear()
        with self.callback_gate:
            pass
        if self.subscribed:
            self.dll.UnsubscribeTicker(self.ticker, self.exchange)
            self.subscribed = False
        if self.initialized:
            self.dll.DLLFinalize()
            self.initialized = False
        if self.dll_dir:
            self.dll_dir.close()


def send_snapshot(tick: Tick, endpoint: str, secret: str) -> None:
    received_at = datetime.now(timezone.utc)
    payload = json.dumps({
        "provider": "PROFITDLL_DAYTRADE", "instrument": tick.ticker, "last": tick.price,
        "bid": None, "ask": None, "exchangeAt": tick.exchange_at.isoformat(),
        "receivedAt": received_at.isoformat(), "sequence": tick.sequence,
    }, separators=(",", ":")).encode("utf-8")
    request = Request(endpoint, data=payload, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {secret}",
    })
    try:
        with urlopen(request, timeout=4) as response:
            if response.status != 200:
                raise RuntimeError(f"Endpoint respondeu HTTP {response.status}.")
    except HTTPError as error:
        raise RuntimeError(f"Endpoint recusou cotação: HTTP {error.code}.") from None
    except URLError as error:
        raise RuntimeError(f"Endpoint DASH indisponível ({type(error.reason).__name__}).") from None


def main() -> None:
    runtime_dir, ticker, exchange, endpoint, secret = parse_config()
    feed = ProfitFeed(runtime_dir, ticker, exchange)
    try:
        key = getpass("Chave de ativação ProfitDLL: ").strip()
        user = input("Usuário Nelogica: ").strip()
        password = getpass("Senha da Nelogica: ")
        if not key or not user or not password:
            raise RuntimeError("Chave, usuário e senha são obrigatórios.")
        feed.initialize(key, user, password)
        feed.wait_ready()
        feed.subscribe()
        print(f"ProfitDLL Market Data conectado; assinatura {ticker}/{exchange}; roteamento desativado.")
        last_tick_key: tuple[int, datetime] | None = None
        while True:
            tick = feed.events.get()
            # Drain bursts and relay only the newest tick, outside the DLL callback thread.
            while True:
                try:
                    candidate = feed.events.get_nowait()
                    if candidate.exchange_at >= tick.exchange_at:
                        tick = candidate
                except queue.Empty:
                    break
            if not feed.is_ready():
                continue
            tick_key = (tick.sequence, tick.exchange_at)
            if tick_key == last_tick_key:
                continue
            send_snapshot(tick, endpoint, secret)
            last_tick_key = tick_key
    except KeyboardInterrupt:
        print("Encerrando coletor somente leitura.")
    finally:
        feed.close()


if __name__ == "__main__":
    main()
