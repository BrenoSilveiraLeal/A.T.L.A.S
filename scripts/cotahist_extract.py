"""Extracts daily cash-equity bars from official B3 COTAHIST annual files.

Usage (run with -I; inputs are downloaded files, not code):
    python -I scripts/cotahist_extract.py OUT.csv PETR4,VALE3 COTAHIST_A2025.ZIP [...]

Layout: B3 "Cotações Históricas" fixed-width records (type 01). Only the standard-lot
cash market (TPMERC 010, CODBDI 02) is kept. Prices are raw, as traded (not adjusted),
with two implied decimals and divided by FATCOT. Nothing is invented for missing days.
"""
import csv
import sys
import zipfile
from decimal import Decimal


def price(field: str, factor: int) -> str:
    value = Decimal(int(field)) / Decimal(100) / Decimal(factor)
    return format(value.normalize(), "f")


def main():
    out, tickers, archives = sys.argv[1], set(sys.argv[2].split(",")), sys.argv[3:]
    rows = []
    for archive in archives:
        with zipfile.ZipFile(archive) as z:
            names = [n for n in z.namelist() if n.upper().startswith("COTAHIST")]
            if len(names) != 1:
                raise SystemExit(f"unexpected archive content: {archive}")
            with z.open(names[0]) as raw:
                for line in raw:
                    record = line.decode("latin-1")
                    if record[0:2] != "01" or record[24:27] != "010" or record[10:12] != "02":
                        continue
                    ticker = record[12:24].strip()
                    if ticker not in tickers:
                        continue
                    factor = int(record[210:217])
                    day = record[2:10]
                    rows.append({
                        "date": f"{day[0:4]}-{day[4:6]}-{day[6:8]}", "ticker": ticker, "isin": record[230:242],
                        "open": price(record[56:69], factor), "high": price(record[69:82], factor),
                        "low": price(record[82:95], factor), "close": price(record[108:121], factor),
                        "volume": str(int(record[152:170])),
                    })
    rows.sort(key=lambda r: (r["ticker"], r["date"]))
    seen = set()
    for r in rows:
        key = (r["ticker"], r["date"])
        if key in seen:
            raise SystemExit(f"duplicate bar {key}")
        seen.add(key)
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["date", "ticker", "isin", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(rows)} bars, {len({r['ticker'] for r in rows})} tickers -> {out}")


if __name__ == "__main__":
    main()
