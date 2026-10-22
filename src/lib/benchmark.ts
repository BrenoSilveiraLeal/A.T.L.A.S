import "server-only";
import { softCached } from "./context";

/** Accumulated CDI (BCB SGS 12, daily %) from `from` to the latest published day. */
export async function cdiSince(from: string) {
  const br = (d: string) => d.split("-").reverse().join("/");
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(from)}`;
  const rows = await softCached("bcb", `SGS12:${from}`, 6 * 3600000, 4 * 86400000, 50, "https://dadosabertos.bcb.gov.br/", async () => {
    const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("CDI_UNAVAILABLE");
    return ((await response.json()) as { data: string; valor: string }[]).slice(-3000);
  });
  if (!rows?.length) return { from, available: false as const };
  const factor = rows.reduce((f, r) => f * (1 + Number(r.valor) / 100), 1);
  return { from, available: true as const, to: rows.at(-1)!.data.split("/").reverse().join("-"), pct: (factor - 1) * 100 };
}
