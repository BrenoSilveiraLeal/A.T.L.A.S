# DASH ProfitDLL gateway

This gateway is the selected adapter for DASH. It is a separate Windows x64 process and must not change or share account state with `gateways/mt5/`, which remains the DAWN path.

## Current status

- Provider ID in `config/daytrade.json`: `PROFITDLL_DAYTRADE`.
- The application-side read-only quote intake is implemented at `POST /api/daytrade/quote`; it is protected by a dedicated PROFITDLL_INGEST_SECRET, separate from scheduler credentials, validates the configured verified contract and freshness, and stores the latest quote in `dt_market_quotes` and 1-minute OHLCV bars in `dt_market_bars`. Both tables have owner-scoped RLS; only the service role writes. The Supabase migration is applied to the ATLAS project.
- `gateway.py` is a read-only Windows x64 consumer. It uses the documented Market Data initialization, keeps callbacks short, translates trades while native pointers are valid, waits for login/feed/activation states, aggregates ticks into 1-minute OHLCV bars and relays rate-limited quote snapshots and bars over HTTPS. It never loads OMS order functions.
- DASH order submission remains blocked in the application. The official licensed DLL runtime must be installed locally before connecting.

## Integration order

1. Install the official Nelogica x64 package and activation on a dedicated Windows environment. Keep the DLL, support files, activation code, Nelogica login, and broker account credentials out of Git, browser code, application logs, and deployment bundles.
2. Start with read-only market data only after the exact contract symbol and entitlement are confirmed. The gateway validates x64 ABI, waits for login/feed/activation callbacks, subscribes to one configured contract, and finalizes cleanly on shutdown.
3. Run `gateway.py` with Python Windows x64. Set `PROFITDLL_RUNTIME_DIR` to the official package `DLLs/Win64` directory, `PROFITDLL_TICKER` to the same verified current contract symbol as `config/daytrade.json`, `PROFITDLL_EXCHANGE=F`, `DASH_API_URL=https://<deployment>/api/daytrade/quote`, and the dedicated `PROFITDLL_INGEST_SECRET`. The process prompts for activation key, Nelogica username, and password; it does not put them in files or command-line arguments.
4. Use a separate authenticated command channel for application health and controls. The gateway must not expose an unauthenticated listener on the public internet; prefer outbound authenticated polling or a separately reviewed private network. Vercel does not host the native DLL process.
5. Add OMS routing only after the broker confirms that this account is enabled for routing, the licensed DLL mode supports the required account/instrument/order types, and order/position queries support reliable reconciliation. Treat the DLL's synchronous `SendOrder` ID as dispatch acknowledgement only; confirm broker acceptance and later state through callbacks and queries.
6. Keep live sending disabled until instrument specs, risk limits, idempotency, durable journal, stop/exit handling, reconnect recovery, independent halt, shadow operation, and operational approval are implemented and reviewed.

## Source references

- [Nelogica: ProfitDLL ecosystem and first steps](https://ajuda.nelogica.com.br/hc/pt-br/articles/22396517026203-Ecossistema-ProfitDLL-e-primeiros-passos)
- [Nelogica: how to obtain ProfitDLL access](https://ajuda.nelogica.com.br/hc/pt-br/articles/51583791325211-Como-obter-acesso-%C3%A0-ProfitDLL)
- [Nelogica: routing orders with ProfitDLL](https://ajuda.nelogica.com.br/hc/pt-br/articles/13312468554651-Como-rotear-ordens-com-a-ProfitDLL)
- [Nelogica: real-time functions and callbacks](https://ajuda.nelogica.com.br/hc/pt-br/articles/11168755650459-Fun%C3%A7%C3%B5es-Real-Time-DLL)



## Local gateway configuration

Keep the vendor package outside the repository. Never place the activation key, credentials, or ingest secret in Git or browser code. Store the ingest secret in the private gateway environment and the Vercel server environment; use a distinct value from CRON_SECRET. The current read-only contract is WINZ26 (expires 16/12/2026), with B3 public tick/value specs recorded in `config/daytrade.json`. The endpoint rejects new quotes after expiry. Before rolling the contract, confirm the new expiry and update the symbol in the config and local `.env.local`; never reuse an expired symbol. Market Data entitlement and Nelogica activation remain required.

## Quick start after obtaining the official package

1. Download the **ProfitDLL Windows x64** package from Nelogica's official logged-in area. Do not use DLLs from third-party mirrors. Extract it to a private local folder and point `PROFITDLL_RUNTIME_DIR` at the folder containing `ProfitDLL.dll`.
2. Install Python 3 for Windows x64 if it is not already installed.
3. Open PowerShell at the repository and run `./gateways/profitdll/run-gateway.ps1`. The script checks the configured contract and local runtime, then asks for the activation key and Nelogica credentials in hidden prompts.
4. Keep the collector running during the market session. The dashboard's **Gráficos** tab polls the 1-minute candles and strategy observation from `/api/daytrade/bars`.

The chart history begins when the collector first runs; it does not backfill candles from before installation. This pipeline is read-only: the integration uses Market Data initialization and does not load ProfitDLL OMS/order functions. Real orders remain disabled.

The DASH also has a separate forward paper simulator. It stays idle until the contract, session, margin, per-side costs and risk limits are verified in `config/daytrade.json`. It simulates next-minute fills in its own `dt_paper_*` tables; it never sends orders through ProfitDLL or changes ATLAS/DAWN positions.

The configured WINZ26 symbol should be rolled before its 16/12/2026 expiry. The B3 WIN schedule is 09:00–18:25 from 03/11/2026; the contract's expiry day closes at 18:00. Check the [B3 circular 055/2026](https://www.b3.com.br/data/files/BE/16/C1/59/2F881A10F75B881AAC094EA8/OC%20055-2026-VNC%20NOVOS%20HORARIOS%20DE%20NEGOCIACAO_PT.pdf).
