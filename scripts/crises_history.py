# How the team's stocks behaved after past Brazilian shocks, from official B3 COTAHIST files.
# Usage: python -I scripts/crises_history.py COTAHIST_DIR docs/HISTORIA_CRISES.md (one COTAHIST_AYYYY.ZIP per year used)
# Raw prices; a one-day move beyond x1.5 or /1.5 is treated as a split/grouping and removed
# (no blue chip here moved that much in a day in these windows; small bonuses are not detected).
import math, statistics, sys, zipfile
from pathlib import Path

TEAM = {  # current ticker: names it traded under before
    "PETR4": ["PETR4"], "VALE3": ["VALE3"], "ITUB4": ["ITUB4", "ITAU4"], "B3SA3": ["B3SA3", "BVMF3"],
    "AXIA3": ["AXIA3", "ELET3"], "EMBJ3": ["EMBJ3", "EMBR3"], "EQTL3": ["EQTL3", "EQTL11"], "CPFE3": ["CPFE3"],
    "SANB11": ["SANB11"], "BPAC11": ["BPAC11"], "MULT3": ["MULT3"], "CYRE3": ["CYRE3"], "ABEV3": ["ABEV3", "AMBV4"],
    "ITSA4": ["ITSA4"], "TIMS3": ["TIMS3", "TIMP3"], "PSSA3": ["PSSA3"],
}
EVENTS = [
    ("2002-10-28", "Eleição de Lula (2002)", "eleição"),
    ("2008-09-15", "Quebra do Lehman Brothers (2008)", "mundo"),
    ("2014-10-27", "Reeleição de Dilma (2014)", "eleição"),
    ("2015-09-10", "Brasil perde o grau de investimento (2015)", "fiscal"),
    ("2017-05-18", "Joesley Day (2017)", "política"),
    ("2020-03-09", "Covid: primeiro circuit breaker (2020)", "mundo"),
    ("2022-10-31", "Eleição de Lula (2022)", "eleição"),
    ("2024-12-18", "Crise fiscal, dólar a R$ 6,30 (2024)", "fiscal"),
]
YEARS = {"2002": ["2002", "2003"], "2008": ["2008", "2009"], "2014": ["2014", "2015"], "2015": ["2015", "2016"],
         "2017": ["2017", "2018"], "2020": ["2020", "2021"], "2022": ["2022", "2023"], "2024": ["2024", "2025"]}

def load(folder: Path, year: str, names: set[str]):
    rows = {}
    with zipfile.ZipFile(folder / f"COTAHIST_A{year}.ZIP") as z:
        name = [n for n in z.namelist() if n.upper().startswith("COTAHIST")][0]
        with z.open(name) as raw:
            for line in raw:
                r = line.decode("latin-1")
                if r[0:2] != "01" or r[24:27] != "010" or r[10:12] != "02":
                    continue
                t = r[12:24].strip()
                if t in names:
                    d = r[2:10]
                    rows.setdefault(t, []).append((f"{d[0:4]}-{d[4:6]}-{d[6:8]}", int(r[108:121]) / 100 / int(r[210:217])))
    return rows

def adjusted(series):
    series = sorted(series)
    out, factor = [], 1.0
    for i in range(len(series) - 1, -1, -1):  # newest first, scale older prices
        d, c = series[i]
        out.append((d, c * factor))
        if i > 0:
            ratio = c / series[i - 1][1]
            if ratio > 1.5 or ratio < 1 / 1.5:
                factor *= ratio
    return out[::-1]

pct = lambda x: "—" if x is None else f"{'+' if x >= 0 else ''}{x * 100:.0f}%"

def main():
    folder, out = Path(sys.argv[1]), Path(sys.argv[2])
    names = {n for v in TEAM.values() for n in v}
    cache = {}
    results = []
    for date, title, kind in EVENTS:
        year = date[:4]
        data = {}
        for y in YEARS[year]:
            cache.setdefault(y, load(folder, y, names))
            for t, rows in cache[y].items():
                data.setdefault(t, []).extend(rows)
        per = []
        for stock, olds in TEAM.items():
            series = next((data[n] for n in olds if n in data and any(d <= date for d, _ in data[n]) and len(data[n]) > 300), None)
            if not series:
                continue
            s = adjusted(series)
            idx = max(i for i, (d, _) in enumerate(s) if d <= date)
            if idx < 21 or s[idx][0] < date[:8] + "01" and s[idx][0] < date:  # must trade around the date
                pass
            before, p0 = s[idx - 21][1], s[idx][1]
            def ret(n):
                return s[idx + n][1] / p0 - 1 if idx + n < len(s) else None
            window = [c for _, c in s[idx: idx + 253]]
            low = min(window)
            back = next((k for k, c in enumerate(window) if c >= before), None)
            per.append({"stock": stock, "fall": p0 / before - 1, "deeper": low / p0 - 1, "r1": ret(21), "r3": ret(63),
                        "r6": ret(126), "r12": ret(252), "back": back})
        results.append((date, title, kind, per))

    lines = ["# Como as ações do time reagiram a crises passadas", "",
             "Fonte: arquivos oficiais de cotações históricas da B3 (COTAHIST), preços de fechamento corrigidos por desdobramentos/grupamentos detectados (movimentos de mais de 50% num dia). Dividendos não incluídos (o resultado real teria sido um pouco melhor).",
             "Ponto de partida: o fechamento do dia do choque. \"Queda no mês do choque\" compara com 21 pregões antes. \"Caiu mais depois\" é a pior queda adicional nos 12 meses seguintes. \"Voltou ao nível de antes\" conta em quantos pregões o preço voltou ao de 21 pregões antes do choque.", ""]
    lines += ["## Resumo (mediana das ações do time)", "",
              "| Choque | Ações | Queda no mês do choque | Caiu mais depois | 1 mês | 3 meses | 6 meses | 12 meses | Subiram em 12 meses | Voltaram ao nível de antes em 12 meses |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    med = lambda xs: statistics.median(xs) if xs else None
    for date, title, kind, per in results:
        def m(k): return med([p[k] for p in per if p[k] is not None])
        up = sum(1 for p in per if p["r12"] is not None and p["r12"] > 0)
        n12 = sum(1 for p in per if p["r12"] is not None)
        backn = sum(1 for p in per if p["back"] is not None)
        lines.append(f"| {title} | {len(per)} | {pct(m('fall'))} | {pct(m('deeper'))} | {pct(m('r1'))} | {pct(m('r3'))} | {pct(m('r6'))} | {pct(m('r12'))} | {up}/{n12} | {backn}/{len(per)} |")
    lines.append("")
    for date, title, kind, per in results:
        lines += [f"## {title} — {date}", "", "| Ação | Queda no mês do choque | Caiu mais depois | 1 mês | 3 meses | 6 meses | 12 meses | Voltou ao nível de antes |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for p in sorted(per, key=lambda p: -(p["r12"] if p["r12"] is not None else -9)):
            back = "não em 12 meses" if p["back"] is None else ("já estava" if p["back"] == 0 else f"{p['back']} pregões")
            lines.append(f"| {p['stock']} | {pct(p['fall'])} | {pct(p['deeper'])} | {pct(p['r1'])} | {pct(p['r3'])} | {pct(p['r6'])} | {pct(p['r12'])} | {back} |")
        lines.append("")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:16]))

main()
