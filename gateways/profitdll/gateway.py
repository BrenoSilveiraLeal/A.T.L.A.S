from __future__ import annotations

"""Read-only ProfitDLL WIN x64 collector. No OMS or order-routing functions are loaded."""

import ctypes as C
from functools import lru_cache
import json
import math
import os
import queue
import sys
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from getpass import getpass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

NL_OK = 0
LOGIN, MARKET, ACTIVATION = 0, 2, 3
LOGIN_CONNECTED, MARKET_CONNECTED, ACTIVATION_VALID = 0, 4, 0
LOGIN_FAILURES = {
    1: "usuário Nelogica inválido",
    2: "senha de login Nelogica inválida",
    3: "senha de login Nelogica bloqueada; interrompa as tentativas e consulte o suporte",
    4: "senha de login Nelogica expirada",
    200: "erro interno no serviço de login Nelogica",
}
MARKET_STATES = {
    0: "desconectado",
    1: "conectando",
    2: "aguardando conexão",
    3: "conectado, mas ainda não autenticado",
    4: "conectado",
}
# Nelogica documents types 1–13; 32 is explicitly classified as unknown.
# Undocumented values invalidate the affected sample instead of entering OHLCV.
KNOWN_TRADE_TYPES = frozenset(range(1, 14))
LOCAL_TZ = ZoneInfo("America/Sao_Paulo")
MARKET_HOURS_PATH = Path(__file__).resolve().parents[2] / "config" / "b3-market-hours.json"


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


class HistoryAssetIdentifier(C.Structure):
    # The documented historical callback uses this record-by-value layout, not
    # the pointer-based TAssetID used by the real-time V2 callback.
    _fields_ = [("ticker", C.c_wchar_p), ("exchange", C.c_wchar_p), ("feed", C.c_int)]


StateCallback = C.WINFUNCTYPE(None, C.c_int, C.c_int)
TradeCallback = C.WINFUNCTYPE(None, AssetIdentifier, C.c_size_t, C.c_uint)
HistoryTradeCallback = C.WINFUNCTYPE(
    None, HistoryAssetIdentifier, C.c_wchar_p, C.c_uint, C.c_double,
    C.c_double, C.c_int, C.c_int, C.c_int, C.c_int,
)
HistoryProgressCallback = C.WINFUNCTYPE(None, HistoryAssetIdentifier, C.c_int)

# ABI layouts were compared with Nelogica's official Win64 SDK types for 4.0.0.42
# (TConnectorAssetIdentifier, TConnectorTrade, TConnectorTradeCallback and legacy
# TAssetID/history callback) and the official read-only binding example for 4.0.0.41.
# This collector never loads or calls OMS/order-routing functions.
SUPPORTED_ABI_VERSIONS = frozenset({"4.0.0.41", "4.0.0.42"})


class _FixedFileInfo(C.Structure):
    _fields_ = [(name, C.c_uint32) for name in (
        "dwSignature", "dwStrucVersion", "dwFileVersionMS", "dwFileVersionLS",
        "dwProductVersionMS", "dwProductVersionLS", "dwFileFlagsMask", "dwFileFlags",
        "dwFileOS", "dwFileType", "dwFileSubtype", "dwFileDateMS", "dwFileDateLS",
    )]


def dll_file_version(path: Path) -> str:
    """Read PE version metadata without loading the vendor DLL."""
    version_api = C.WinDLL("version.dll", use_last_error=True)
    version_api.GetFileVersionInfoSizeW.argtypes = [C.c_wchar_p, C.POINTER(C.c_uint32)]
    version_api.GetFileVersionInfoSizeW.restype = C.c_uint32
    version_api.GetFileVersionInfoW.argtypes = [C.c_wchar_p, C.c_uint32, C.c_uint32, C.c_void_p]
    version_api.GetFileVersionInfoW.restype = C.c_int
    version_api.VerQueryValueW.argtypes = [C.c_void_p, C.c_wchar_p, C.POINTER(C.c_void_p), C.POINTER(C.c_uint32)]
    version_api.VerQueryValueW.restype = C.c_int

    ignored_handle = C.c_uint32()
    size = version_api.GetFileVersionInfoSizeW(str(path), C.byref(ignored_handle))
    if not size:
        raise RuntimeError("Nao foi possivel ler a versao PE da ProfitDLL; ABI nao validada.")
    resource = C.create_string_buffer(size)
    if not version_api.GetFileVersionInfoW(str(path), 0, size, C.cast(resource, C.c_void_p)):
        raise RuntimeError("Nao foi possivel ler os recursos de versao PE da ProfitDLL; ABI nao validada.")
    value = C.c_void_p()
    value_size = C.c_uint32()
    if not version_api.VerQueryValueW(C.cast(resource, C.c_void_p), "\\", C.byref(value), C.byref(value_size)) or value_size.value < C.sizeof(_FixedFileInfo):
        raise RuntimeError("A ProfitDLL nao possui um recurso PE de versao valido; ABI nao validada.")
    info = C.cast(value, C.POINTER(_FixedFileInfo)).contents
    if info.dwSignature != 0xFEEF04BD:
        raise RuntimeError("Assinatura do recurso PE de versao inesperada; ABI nao validada.")
    major, minor = info.dwFileVersionMS >> 16, info.dwFileVersionMS & 0xFFFF
    build, revision = info.dwFileVersionLS >> 16, info.dwFileVersionLS & 0xFFFF
    return f"{major}.{minor}.{build}.{revision}"


def require_supported_abi_version(version: str) -> None:
    if version not in SUPPORTED_ABI_VERSIONS:
        allowed = ", ".join(sorted(SUPPORTED_ABI_VERSIONS))
        raise RuntimeError(f"ProfitDLL {version or 'sem versao'} sem ABI homologada; versoes permitidas: {allowed}.")


def require_interactive_terminal(is_interactive: bool) -> None:
    """Never let getpass fall back to echoing activation or login credentials."""
    if not is_interactive:
        raise RuntimeError("Execute o gateway em um terminal interativo do Windows; entrada redirecionada não é aceita para proteger a chave e as credenciais.")


def require_supported_abi_layout() -> None:
    """Fail closed unless ctypes offsets match the official Win64 SDK records."""
    layouts = (
        (SystemTime, 16, {name: index * 2 for index, name in enumerate((
            "wYear", "wMonth", "wDayOfWeek", "wDay", "wHour", "wMinute", "wSecond", "wMilliseconds",
        ))}),
        (AssetIdentifier, 32, {"Version": 0, "Ticker": 8, "Exchange": 16, "FeedType": 24}),
        (HistoryAssetIdentifier, 24, {"ticker": 0, "exchange": 8, "feed": 16}),
        (ConnectorTrade, 64, {
            "Version": 0, "TradeDate": 2, "TradeNumber": 20, "Price": 24,
            "Quantity": 32, "Volume": 40, "BuyAgent": 48, "SellAgent": 52, "TradeType": 56,
        }),
    )
    for record, expected_size, expected_offsets in layouts:
        if C.sizeof(record) != expected_size or any(
            getattr(record, field).offset != offset for field, offset in expected_offsets.items()
        ):
            raise RuntimeError(f"Layout ctypes de {record.__name__} diverge do SDK Win64 oficial.")


@dataclass(frozen=True)
class Tick:
    ticker: str
    exchange: str
    price: float
    quantity: int
    sequence: int
    exchange_at: datetime
    flagged: bool


class LiveMinuteAggregator:
    """Build sparse, exchange-timestamped M1 bars and quarantine uncertain samples."""

    def __init__(self) -> None:
        self.last_trade_key: tuple[datetime, int] | None = None
        self.current_bar: dict[str, object] | None = None
        self.closed_bars: list[dict[str, object]] = []
        self.resume_at: datetime | None = None

    @staticmethod
    def _next_minute(now_local: datetime) -> datetime:
        return now_local.replace(second=0, microsecond=0) + timedelta(minutes=1)

    def discard_until_next_minute(self, now_local: datetime) -> datetime:
        self.current_bar = None
        self.closed_bars.clear()
        self.resume_at = self._next_minute(now_local)
        return self.resume_at

    def ingest(self, ticks: list[Tick], now_local: datetime) -> tuple[Tick | None, int]:
        dropped = 0
        latest: Tick | None = None
        for item in sorted(ticks, key=lambda tick: (tick.exchange_at, tick.sequence)):
            # The callback exposes flags, but the vendor's public docs do not define their
            # bits. Until the licensed SDK confirms them, quarantine all flagged events.
            if item.flagged:
                dropped += 1
                continue
            trade_key = (item.exchange_at, item.sequence)
            if self.last_trade_key is not None and trade_key <= self.last_trade_key:
                dropped += 1
                continue
            minute = item.exchange_at.replace(second=0, microsecond=0)
            if self.resume_at is not None and minute < self.resume_at:
                self.last_trade_key = trade_key
                continue
            if self.resume_at is not None:
                self.resume_at = None
            if self.current_bar is None:
                self.current_bar = {
                    "bucketAt": minute.isoformat(), "open": item.price, "high": item.price,
                    "low": item.price, "close": item.price, "volume": item.quantity,
                    "turnover": item.price * item.quantity,
                }
            else:
                current_minute = datetime.fromisoformat(str(self.current_bar["bucketAt"]))
                if minute < current_minute:
                    dropped += 1
                    continue
                if minute > current_minute:
                    self.closed_bars.append(self.current_bar)
                    self.current_bar = {
                        "bucketAt": minute.isoformat(), "open": item.price, "high": item.price,
                        "low": item.price, "close": item.price, "volume": item.quantity,
                        "turnover": item.price * item.quantity,
                    }
                else:
                    self.current_bar["high"] = max(float(self.current_bar["high"]), item.price)
                    self.current_bar["low"] = min(float(self.current_bar["low"]), item.price)
                    self.current_bar["close"] = item.price
                    self.current_bar["volume"] = int(self.current_bar["volume"]) + item.quantity
                    self.current_bar["turnover"] = float(self.current_bar["turnover"]) + item.price * item.quantity
            self.last_trade_key = trade_key
            latest = item
        return latest, dropped


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Configuração ausente: {name}")
    return value


@lru_cache(maxsize=1)
def win_session_hours() -> dict[str, object]:
    settings = json.loads(MARKET_HOURS_PATH.read_text(encoding="utf-8"))
    win = settings.get("win") if isinstance(settings, dict) else None
    if not isinstance(win, dict) or not isinstance(win.get("regularCloseChanges"), list):
        raise RuntimeError("config/b3-market-hours.json não contém uma grade WIN válida.")
    for key in ("defaultClose", "expiryClose"):
        try:
            valid_time = isinstance(win.get(key), str) and datetime.strptime(win[key], "%H:%M").strftime("%H:%M") == win[key]
        except ValueError:
            valid_time = False
        if not valid_time:
            raise RuntimeError(f"Horário {key} inválido em config/b3-market-hours.json.")
    previous = ""
    for change in win["regularCloseChanges"]:
        try:
            valid_date = isinstance(change, dict) and date.fromisoformat(change["effectiveDate"]).isoformat() == change["effectiveDate"]
            valid_close = isinstance(change, dict) and datetime.strptime(change["close"], "%H:%M").strftime("%H:%M") == change["close"]
        except (KeyError, TypeError, ValueError):
            valid_date, valid_close = False, False
        if not valid_date or not valid_close or change["effectiveDate"] <= previous:
            raise RuntimeError("Alterações de horário WIN inválidas ou fora de ordem.")
        previous = change["effectiveDate"]
    return win


def win_session_close(day: date, expires_on: date | None) -> str:
    settings = win_session_hours()
    if day == expires_on:
        return str(settings["expiryClose"])
    close = str(settings["defaultClose"])
    for change in settings["regularCloseChanges"]:
        if day.isoformat() < change["effectiveDate"]:
            break
        close = change["close"]
    return str(close)


def load_local_env() -> None:
    """Load private per-user gateway settings outside the synced repository; process env wins."""
    configured_file = os.environ.get("PROFITDLL_ENV_FILE")
    local_app_data = os.environ.get("LOCALAPPDATA")
    if configured_file:
        env_file = Path(configured_file)
    elif local_app_data:
        env_file = Path(local_app_data) / "ATLAS" / "ProfitDLL" / "gateway.env"
    else:
        return
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


def parse_config() -> tuple[Path, str, str, str, str, str, str | None]:
    load_local_env()
    if sys.platform != "win32" or C.sizeof(C.c_void_p) != 8 or C.sizeof(C.c_wchar) != 2:
        raise RuntimeError("Execute com Python Windows x64; ProfitDLL não aceita ABI Linux nativa.")
    runtime_dir = Path(require_env("PROFITDLL_RUNTIME_DIR")).resolve(strict=True)
    dll_path = runtime_dir / "ProfitDLL.dll"
    if not dll_path.is_file():
        raise FileNotFoundError(f"ProfitDLL.dll não encontrada em {runtime_dir}")
    require_supported_abi_version(dll_file_version(dll_path))
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
    history_endpoint = endpoint.rsplit("/", 1)[0] + "/history"
    secret = require_env("PROFITDLL_INGEST_SECRET")
    if len(secret) < 32:
        raise RuntimeError("PROFITDLL_INGEST_SECRET deve ter pelo menos 32 caracteres.")
    require_supported_abi_layout()
    config_path = Path(__file__).resolve().parents[2] / "config" / "daytrade.json"
    settings = json.loads(config_path.read_text(encoding="utf-8"))
    win_session_hours()  # Validate the shared B3 schedule before accepting any data.
    contract = next((item for item in settings["instruments"] if item.get("enabled") and item.get("id") == "WIN"), None)
    if not contract or contract.get("symbol") != ticker:
        raise RuntimeError("O ticker ProfitDLL precisa corresponder ao contrato WIN habilitado no DASH.")
    expires_on = contract.get("expiresOn")
    if expires_on:
        try:
            expiry = date.fromisoformat(expires_on)
        except (TypeError, ValueError) as exc:
            raise RuntimeError("Data de vencimento do contrato WIN inválida na configuração do DASH.") from exc
        if datetime.now(LOCAL_TZ).date() > expiry:
            raise RuntimeError("Contrato WIN vencido; atualize o símbolo no DASH antes de iniciar o gateway.")
    return runtime_dir, ticker, exchange, endpoint, history_endpoint, secret, expires_on


class ProfitFeed:
    def __init__(self, runtime_dir: Path, ticker: str, exchange: str):
        self.ticker, self.exchange = ticker, exchange
        self.events: queue.Queue[Tick] = queue.Queue(maxsize=10_000)
        self.history_events: queue.Queue[tuple[str, str, str, int, float, float, int]] = queue.Queue(maxsize=300_000)
        self.history_lock = threading.Lock()
        self.history_active_day: str | None = None
        self.history_close = "18:00"
        self.history_bars: dict[str, dict[str, object]] = {}
        self.history_seen_trade_keys: set[tuple[str, int]] = set()
        self.history_trade_count = 0
        self.history_error: str | None = None
        self.history_done = threading.Event()
        self.history_cancel = threading.Event()
        self.history_stop = threading.Event()
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
        self.history_trade_cb = HistoryTradeCallback(self._history_trade_callback)
        self.history_progress_cb = HistoryProgressCallback(self._history_progress_callback)
        self.history_consumer = threading.Thread(target=self._consume_history, name="profitdll-history", daemon=True)
        self.history_consumer.start()
        self._configure()

    def _configure(self) -> None:
        optional = C.c_void_p
        self.dll.DLLInitializeMarketLogin.argtypes = [C.c_wchar_p, C.c_wchar_p, C.c_wchar_p, StateCallback] + [optional] * 7
        self.dll.DLLInitializeMarketLogin.restype = C.c_int
        self.dll.SetTradeCallbackV2.argtypes = [TradeCallback]
        self.dll.SetTradeCallbackV2.restype = C.c_int
        self.set_history_trade_callback = getattr(self.dll, "SetHistoryTradeCallbackV2", None)
        self.history_trade_callback_name = "SetHistoryTradeCallbackV2"
        if self.set_history_trade_callback is None:
            self.set_history_trade_callback = getattr(self.dll, "SetHistoryTradeCallback", None)
            self.history_trade_callback_name = "SetHistoryTradeCallback"
        if self.set_history_trade_callback is None:
            raise RuntimeError("ProfitDLL não exporta SetHistoryTradeCallbackV2 nem a API histórica compatível SetHistoryTradeCallback.")
        self.set_history_trade_callback.argtypes = [HistoryTradeCallback]
        self.set_history_trade_callback.restype = C.c_int
        self.dll.SetSerieProgressCallback.argtypes = [HistoryProgressCallback]
        self.dll.SetSerieProgressCallback.restype = C.c_int
        self.dll.GetHistoryTrades.argtypes = [C.c_wchar_p, C.c_wchar_p, C.c_wchar_p, C.c_wchar_p]
        self.dll.GetHistoryTrades.restype = C.c_int
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
        with self.callback_gate:
            if not self.accepting.is_set():
                return
            try:
                ticker = C.cast(asset.Ticker, C.c_wchar_p).value if asset.Ticker else ""
                exchange = C.cast(asset.Exchange, C.c_wchar_p).value if asset.Exchange else ""
                if ticker.upper() != self.ticker or exchange.upper() != self.exchange:
                    return
                if int(asset.FeedType) != 0:  # Nelogica; reject an alternate source (documented as 255).
                    self.dropped += 1
                    return
                trade = ConnectorTrade(Version=0)
                if self.dll.TranslateTrade(trade_pointer, C.byref(trade)) != NL_OK:
                    self.dropped += 1
                    return
                if int(trade.TradeType) not in KNOWN_TRADE_TYPES:
                    self.dropped += 1
                    return
                raw = trade.TradeDate
                exchange_at = datetime(raw.wYear, raw.wMonth, raw.wDay, raw.wHour, raw.wMinute,
                                       raw.wSecond, raw.wMilliseconds * 1000, tzinfo=LOCAL_TZ).astimezone(timezone.utc)
                # Nelogica's current guide defines bit 0 as an edit event. This collector
                # cannot yet revise a previously aggregated trade by trade number, so keep
                # edited events out of OHLCV. Unknown flag bits are quarantined the same way.
                tick = Tick(ticker, exchange, float(trade.Price), int(trade.Quantity), int(trade.TradeNumber), exchange_at, bool(flags))
                if not math.isfinite(tick.price) or tick.price <= 0 or tick.quantity <= 0:
                    # Treat malformed execution data like a dropped native event so the
                    # in-flight minute is discarded instead of persisting a false OHLCV bar.
                    self.dropped += 1
                    return
                self.events.put_nowait(tick)
            except queue.Full:
                self.dropped += 1
            except BaseException:
                # Exceptions must never cross the native callback boundary. A failed
                # translation or ABI decode still invalidates the in-flight OHLCV bar.
                self.dropped += 1
                return

    def _history_trade_callback(
        self, asset: HistoryAssetIdentifier, date_text: str, trade_number: int,
        price: float, volume_value: float, quantity: int, buy_agent: int,
        sell_agent: int, trade_type: int,
    ) -> None:
        # Do not parse, aggregate, perform I/O, or call the DLL on ConnectorThread.
        try:
            with self.history_lock:
                if self.history_active_day is None:
                    return
            ticker = (asset.ticker or "").upper()
            exchange = (asset.exchange or "").upper()
            if ticker != self.ticker or exchange != self.exchange:
                return
            if int(asset.feed) != 0:  # Historical source 0 is Nelogica; 255 denotes another source.
                with self.history_lock:
                    self.history_error = f"Fonte de trade histórico incompatível com Nelogica ({int(asset.feed)}); dia descartado."
                return
            if int(trade_type) not in KNOWN_TRADE_TYPES:
                with self.history_lock:
                    self.history_error = f"Tipo de trade histórico não classificado pela tabela ProfitDLL ({int(trade_type)}); dia descartado."
                return
            self.history_events.put_nowait((ticker, exchange, date_text, int(trade_number), float(price), float(volume_value), int(quantity)))
        except queue.Full:
            with self.history_lock:
                self.history_error = "Fila de trades históricos excedeu o limite; dia descartado."
        except BaseException:
            with self.history_lock:
                self.history_error = "Callback histórico inválido; dia descartado."

    def _history_progress_callback(self, asset: HistoryAssetIdentifier, progress: int) -> None:
        try:
            if ((asset.ticker or "").upper() != self.ticker or
                    (asset.exchange or "").upper() != self.exchange or int(asset.feed) != 0 or int(progress) != 100):
                return
            with self.history_lock:
                if self.history_active_day is not None:
                    self.history_done.set()
        except BaseException:
            return

    def _consume_history(self) -> None:
        while not self.history_stop.is_set():
            try:
                ticker, exchange, date_text, trade_number, price, financial_volume, quantity = self.history_events.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                try:
                    parsed_at = datetime.strptime(date_text, "%d/%m/%Y %H:%M:%S.%f")
                except ValueError:
                    parsed_at = datetime.strptime(date_text, "%d/%m/%Y %H:%M:%S")
                traded_at = parsed_at.replace(tzinfo=LOCAL_TZ)
                day = traded_at.date().isoformat()
                if (not math.isfinite(price) or price <= 0 or not math.isfinite(financial_volume) or
                        financial_volume <= 0 or quantity <= 0 or ticker != self.ticker or exchange != self.exchange):
                    raise ValueError("Trade histórico malformado.")
                with self.history_lock:
                    if day != self.history_active_day:
                        raise ValueError("Trade recebido fora do dia histórico solicitado.")
                    trade_key = (day, trade_number)
                    if trade_key in self.history_seen_trade_keys:
                        raise ValueError("A ProfitDLL repetiu o número de um trade histórico; dia descartado.")
                    self.history_seen_trade_keys.add(trade_key)
                    if traded_at.strftime("%H:%M") < "09:00" or traded_at.strftime("%H:%M") >= self.history_close:
                        continue
                    minute = traded_at.replace(second=0, microsecond=0)
                    bucket_at = minute.isoformat()
                    row = self.history_bars.get(bucket_at)
                    order_key = (traded_at, trade_number)
                    if row is None:
                        self.history_bars[bucket_at] = {
                            "bucketAt": bucket_at, "open": price, "high": price, "low": price,
                            "close": price, "volume": quantity, "turnover": price * quantity,
                            "firstKey": order_key, "lastKey": order_key,
                        }
                    else:
                        row["high"] = max(float(row["high"]), price)
                        row["low"] = min(float(row["low"]), price)
                        row["volume"] = int(row["volume"]) + quantity
                        row["turnover"] = float(row["turnover"]) + price * quantity
                        if order_key < row["firstKey"]:
                            row["open"], row["firstKey"] = price, order_key
                        if order_key >= row["lastKey"]:
                            row["close"], row["lastKey"] = price, order_key
                    self.history_trade_count += 1
            except (ValueError, TypeError, OverflowError) as error:
                with self.history_lock:
                    self.history_error = str(error)[:180]
            except BaseException:
                with self.history_lock:
                    self.history_error = "Falha ao agregar trade histórico; dia descartado."
            finally:
                self.history_events.task_done()

    def request_history_day(self, day: date, close_time: str, timeout: float = 300.0) -> tuple[list[dict[str, object]], int]:
        self.history_events.join()
        with self.history_lock:
            self.history_active_day = day.isoformat()
            self.history_close = close_time
            self.history_bars = {}
            self.history_seen_trade_keys = set()
            self.history_trade_count = 0
            self.history_error = None
            self.history_done.clear()
        date_text = day.strftime("%d/%m/%Y")
        start = f"{date_text} 09:00:00"
        end = f"{date_text} {close_time}:00"
        result = self.dll.GetHistoryTrades(self.ticker, self.exchange, start, end)
        if result != NL_OK:
            with self.history_lock:
                self.history_active_day = None
            raise RuntimeError(f"GetHistoryTrades retornou {result}.")
        deadline = time.monotonic() + timeout
        while not self.history_done.wait(0.2):
            if self.history_cancel.is_set():
                with self.history_lock:
                    self.history_active_day = None
                raise TimeoutError("Consulta histórica cancelada durante o encerramento; dia parcial descartado.")
            if time.monotonic() >= deadline:
                with self.history_lock:
                    self.history_active_day = None
                raise TimeoutError("A ProfitDLL não concluiu o histórico em 300 segundos; importação histórica interrompida.")
        self.history_events.join()
        with self.history_lock:
            error = self.history_error
            bars = [{key: value for key, value in row.items() if key not in ("firstKey", "lastKey")}
                    for row in sorted(self.history_bars.values(), key=lambda item: str(item["bucketAt"]))]
            trade_count = self.history_trade_count
            self.history_active_day = None
        if error:
            raise RuntimeError(error)
        return bars, trade_count

    def initialize(self, key: str, user: str, password: str) -> None:
        result = self.dll.DLLInitializeMarketLogin(key, user, password, self.state_cb, None, None, None, None, None, None, None)
        if result != NL_OK:
            raise RuntimeError(f"DLLInitializeMarketLogin retornou {result}.")
        self.initialized = True
        result = self.dll.SetTradeCallbackV2(self.trade_cb)
        if result != NL_OK:
            raise RuntimeError(f"SetTradeCallbackV2 retornou {result}.")
        result = self.set_history_trade_callback(self.history_trade_cb)
        if result != NL_OK:
            raise RuntimeError(f"{self.history_trade_callback_name} retornou {result}.")
        result = self.dll.SetSerieProgressCallback(self.history_progress_cb)
        if result != NL_OK:
            raise RuntimeError(f"SetSerieProgressCallback retornou {result}.")

    def wait_ready(self, timeout: float = 30.0) -> None:
        expected = {LOGIN: LOGIN_CONNECTED, MARKET: MARKET_CONNECTED, ACTIVATION: ACTIVATION_VALID}
        with self.changed:
            self.changed.wait_for(
                lambda: all(self.states.get(k) == v for k, v in expected.items()) or
                self.states.get(ACTIVATION) == 1 or self.states.get(LOGIN) in LOGIN_FAILURES,
                timeout,
            )
            states = dict(self.states)
        if all(states.get(kind) == result for kind, result in expected.items()):
            return
        activation = states.get(ACTIVATION)
        if activation == 1:
            raise RuntimeError("Ativação ProfitDLL inválida ou não autorizada. Confira se a chave pertence à licença DLL Feed com Market Data ativo; a chave não é a senha Nelogica nem a senha da corretora.")
        login = states.get(LOGIN)
        if login in LOGIN_FAILURES:
            raise RuntimeError(f"Falha no login Nelogica: {LOGIN_FAILURES[login]} (estado {login}). Confira o usuário e a senha no prompt oculto.")
        market = states.get(MARKET)
        received = ", ".join((
            f"login={states.get(LOGIN, 'sem retorno')}",
            f"Market Data={MARKET_STATES.get(market, f'estado {market}') if market is not None else 'sem retorno'}",
            f"ativação={states.get(ACTIVATION, 'sem retorno')}",
        ))
        raise TimeoutError(f"A ProfitDLL não ficou pronta em {timeout:g}s. Estados recebidos: {received}. Verifique conexão à internet, licença DLL Feed, credenciais Nelogica e se a mesma licença está conectada por outro processo.")

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
        self.history_stop.set()
        self.history_consumer.join(timeout=2)
        if self.dll_dir:
            self.dll_dir.close()


def send_snapshot(tick: Tick, endpoint: str, secret: str, bar: dict[str, object], closed_bars: list[dict[str, object]]) -> None:
    received_at = datetime.now(timezone.utc)
    fresh_closed_bars: list[dict[str, object]] = []
    for closed in closed_bars:
        bucket_value = closed.get("bucketAt")
        if not isinstance(bucket_value, str):
            continue
        try:
            bucket_at = datetime.fromisoformat(bucket_value)
        except ValueError:
            continue
        if bucket_at.tzinfo is None:
            continue
        age_ms = (received_at - bucket_at.astimezone(timezone.utc)).total_seconds() * 1000
        # The API accepts only the current or immediately preceding two minutes. Never let
        # delayed queue contents reject an otherwise fresh quote; gaps remain visible downstream.
        if 0 <= age_ms <= 120_000:
            fresh_closed_bars.append(closed)
    payload = json.dumps({
        "provider": "PROFITDLL_DAYTRADE", "instrument": tick.ticker, "last": tick.price,
        "bid": None, "ask": None, "exchangeAt": tick.exchange_at.isoformat(),
        "receivedAt": received_at.isoformat(), "sequence": tick.sequence, "bar": bar, "closedBars": fresh_closed_bars[-10:],
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
    except TimeoutError:
        raise RuntimeError("Endpoint DASH excedeu o limite de 4 segundos.") from None


def send_history_session(ticker: str, day: date, trade_count: int, bars: list[dict[str, object]], endpoint: str, secret: str) -> str:
    payload = json.dumps({"instrument": ticker, "sessionDay": day.isoformat(),
                          "tradeCount": trade_count, "bars": bars}, separators=(",", ":")).encode("utf-8")
    request = Request(endpoint, data=payload, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {secret}",
    })
    try:
        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"API recusou o histórico de {day.isoformat()}: HTTP {error.code}.") from None
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"API de histórico indisponível para {day.isoformat()} ({type(error).__name__}).") from None
    status = result.get("status") if isinstance(result, dict) else None
    if status not in ("IMPORTED", "ALREADY_IMPORTED"):
        raise RuntimeError(f"API não confirmou a importação histórica de {day.isoformat()}.")
    return str(status)


def check_ingest_endpoint(endpoint: str, secret: str, ticker: str, provider: str) -> dict[str, object]:
    request = Request(endpoint, method="GET", headers={"Authorization": f"Bearer {secret}"})
    try:
        with urlopen(request, timeout=8) as response:
            result = json.loads(response.read(4096).decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"Preflight {provider} recusado (HTTP {error.code}); verifique o último deploy e o segredo do gateway.") from None
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Preflight {provider} indisponível ({type(error).__name__}).") from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError(f"Preflight {provider} retornou uma resposta inválida.") from None
    if not isinstance(result, dict) or result.get("status") != "READY" or result.get("provider") != provider or result.get("instrument") != ticker or result.get("readOnly") is not True:
        raise RuntimeError(f"Preflight {provider} não confirmou o contrato {ticker} em modo somente leitura.")
    if provider == "PROFITDLL_HISTORY":
        completed = result.get("completedSessions")
        if not isinstance(completed, list) or len(completed) > 30:
            raise RuntimeError("Preflight do histórico não retornou a lista autoritativa de sessões persistidas.")
        try:
            days = [date.fromisoformat(value) for value in completed if isinstance(value, str)]
        except ValueError:
            raise RuntimeError("Preflight do histórico retornou uma data de sessão inválida.") from None
        if len(days) != len(completed) or days != sorted(set(days)):
            raise RuntimeError("Preflight do histórico retornou sessões duplicadas ou fora de ordem.")
    return result


def backfill_history(feed: ProfitFeed, ticker: str, expires_on: str | None, endpoint: str, secret: str,
                     persisted_sessions: set[str]) -> None:
    """Import completed ProfitDLL sessions day by day; the vendor retains 30 calendar days."""
    today = datetime.now(LOCAL_TZ).date()
    expiry = date.fromisoformat(expires_on) if expires_on else None
    print("Iniciando backfill ProfitDLL de pregões concluídos (até 30 dias), em paralelo à coleta ao vivo.", flush=True)
    for offset in range(30, 0, -1):
        if feed.history_cancel.is_set():
            return
        day = today - timedelta(days=offset)
        key = day.isoformat()
        if day.weekday() >= 5 or (expiry and day > expiry) or key in persisted_sessions:
            continue
        # B3's published WIN futures schedule changed on 03/11/2026; expiry closes earlier.
        close_time = win_session_close(day, expiry)
        try:
            bars, trade_count = feed.request_history_day(day, close_time)
            if not bars or trade_count < 1:
                print(f"Histórico {key}: a DLL não retornou negócios regulares; sem importação.", flush=True)
                continue
            status = send_history_session(ticker, day, trade_count, bars, endpoint, secret)
            persisted_sessions.add(key)
            print(f"Histórico {key}: {status.lower()}, {trade_count} negócios, {len(bars)} candles M1.", flush=True)
        except TimeoutError as error:
            print(f"Backfill interrompido: {error}", flush=True)
            return
        except (RuntimeError, OSError, ValueError) as error:
            print(f"Histórico {key} não importado: {error}", flush=True)
    print("Backfill disponível concluído; a coleta ao vivo continua somente leitura.", flush=True)


def main() -> None:
    try:
        require_interactive_terminal(sys.stdin.isatty())
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
    runtime_dir, ticker, exchange, endpoint, history_endpoint, secret, expires_on = parse_config()
    try:
        check_ingest_endpoint(endpoint, secret, ticker, "PROFITDLL_DAYTRADE")
        history_ready = check_ingest_endpoint(history_endpoint, secret, ticker, "PROFITDLL_HISTORY")
        persisted_sessions = set(history_ready["completedSessions"])
    except RuntimeError as error:
        raise SystemExit(f"Gateway não iniciado: {error}") from None
    feed = ProfitFeed(runtime_dir, ticker, exchange)
    history_thread: threading.Thread | None = None
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
        history_thread = threading.Thread(target=backfill_history,
            args=(feed, ticker, expires_on, history_endpoint, secret, persisted_sessions), name="profitdll-backfill", daemon=True)
        history_thread.start()
        aggregator = LiveMinuteAggregator()
        feed_was_ready = True
        last_sent = 0.0
        last_send_error = ""
        last_error_reported = 0.0
        reported_drops = 0
        while True:
            try:
                tick = feed.events.get(timeout=0.5)
            except queue.Empty:
                tick = None
            batch = [tick] if tick is not None else []
            # Drain bursts and relay only the newest tick, outside the DLL callback thread.
            if batch:
                while True:
                    try:
                        batch.append(feed.events.get_nowait())
                    except queue.Empty:
                        break
            if not feed.is_ready():
                if feed_was_ready:
                    now_local = datetime.now(LOCAL_TZ)
                    resume_at = aggregator.discard_until_next_minute(now_local)
                    reported_drops = feed.dropped
                    feed_was_ready = False
                    print(f"ProfitDLL saiu de READY; buffers descartados e agregacao pausada ate {resume_at.isoformat()}.", flush=True)
                continue
            if not feed_was_ready:
                feed_was_ready = True
                print("ProfitDLL READY novamente; aguardando o proximo minuto completo para retomar a agregacao.", flush=True)
            if not batch:
                continue
            now_local = datetime.now(LOCAL_TZ)
            latest_tick, aggregator_drops = aggregator.ingest(batch, now_local)
            feed.dropped += aggregator_drops
            if feed.dropped > reported_drops:
                # A dropped native trade can make the whole in-flight minute's OHLCV incomplete.
                # Remove all unsent bars and wait for the next minute bucket before rebuilding.
                resume_at = aggregator.discard_until_next_minute(now_local)
                latest_tick = None
                print(f"Lacuna detectada: {feed.dropped - reported_drops} negócio(s) descartado(s); descartando candles pendentes até {resume_at.isoformat()}.", flush=True)
                reported_drops = feed.dropped
                continue
            if latest_tick is None or time.monotonic() - last_sent < 1.0:
                continue
            tick = latest_tick
            if aggregator.current_bar is None:
                continue
            current_bucket = datetime.fromisoformat(str(aggregator.current_bar["bucketAt"]))
            current_age_ms = (datetime.now(timezone.utc) - current_bucket.astimezone(timezone.utc)).total_seconds() * 1000
            if current_age_ms < 0 or current_age_ms > 120_000:
                now_local = datetime.now(LOCAL_TZ)
                aggregator.discard_until_next_minute(now_local)
                print("Candle corrente vencido; descartando o buffer e aguardando o próximo minuto antes de retomar o envio.", flush=True)
                continue
            now_utc = datetime.now(timezone.utc)
            recent_closed_bars = []
            stale_count = 0
            for closed in aggregator.closed_bars:
                try:
                    raw_bucket = datetime.fromisoformat(str(closed["bucketAt"]))
                    if raw_bucket.tzinfo is None:
                        raise ValueError("timezone required")
                    bucket_at = raw_bucket.astimezone(timezone.utc)
                    age_ms = (now_utc - bucket_at).total_seconds() * 1000
                except (KeyError, TypeError, ValueError):
                    stale_count += 1
                    continue
                if 0 <= age_ms <= 120_000:
                    recent_closed_bars.append(closed)
                else:
                    stale_count += 1
            if stale_count:
                print(f"Aviso: {stale_count} candle(s) antigo(s) ou inválido(s) descartado(s); a continuidade do histórico deve ser reavaliada.", flush=True)
            drops_at_send = feed.dropped
            try:
                send_snapshot(tick, endpoint, secret, aggregator.current_bar, recent_closed_bars)
            except RuntimeError as error:
                now_mono = time.monotonic()
                message = str(error)
                if message != last_send_error or now_mono - last_error_reported >= 30:
                    print(f"Falha ao enviar snapshot; aguardando o próximo tick fresco: {message}", flush=True)
                    last_send_error, last_error_reported = message, now_mono
                last_sent = now_mono
                # Keep recent closed bars for the next fresh snapshot. The API will never receive
                # an old quote timestamp, and stale bars are filtered above after the outage.
                continue
            aggregator.closed_bars.clear()
            last_send_error = ""
            last_sent = time.monotonic()
            if feed.dropped > drops_at_send:
                now_local = datetime.now(LOCAL_TZ)
                resume_at = aggregator.discard_until_next_minute(now_local)
                print(f"Lacuna detectada durante o envio: {feed.dropped - drops_at_send} negócio(s) descartado(s); aguardando {resume_at.isoformat()}.", flush=True)
            reported_drops = feed.dropped
    except KeyboardInterrupt:
        print("Encerrando coletor somente leitura.")
    finally:
        if history_thread and history_thread.is_alive():
            feed.history_cancel.set()
            print("Cancelando o backfill ativo e descartando qualquer dia histórico incompleto.", flush=True)
            history_thread.join()
        feed.close()


if __name__ == "__main__":
    main()
