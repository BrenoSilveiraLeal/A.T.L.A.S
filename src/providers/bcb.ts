import "server-only";
import { z } from "zod";
import { getJson, parseResponse, ProviderError } from "./http";
import { brazilDate, checkedTimestamp, decimalSchema, parseBrazilDate } from "./validation";
import type { MacroObservation } from "./types";

const macroSchema = z.array(z.object({ data: z.string(), valor: decimalSchema })).max(40);

function sgsDate(date: string): string { return date.split("-").reverse().join("/"); }

/** Explicit bounded window, ending at today's civil date in São Paulo. */
export async function fetchMacro(): Promise<MacroObservation[]> {
  const now = Date.now();
  const endDate = brazilDate(now);
  const startDate = brazilDate(now - 30 * 24 * 60 * 60 * 1000);
  const url = new URL("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados");
  url.search = new URLSearchParams({ formato: "json", dataInicial: sgsDate(startDate), dataFinal: sgsDate(endDate) }).toString();
  const payload = parseResponse("bcb", macroSchema, await getJson("bcb", url));
  if (!payload.length) throw new ProviderError("bcb", "EMPTY_DATA");
  const retrievedAt = new Date().toISOString();
  const seen = new Set<string>();
  return payload.map((row): MacroObservation => {
    const dataTimestamp = checkedTimestamp("bcb", parseBrazilDate("bcb", row.data), Date.parse(retrievedAt));
    const observationDate = brazilDate(Date.parse(dataTimestamp));
    if (observationDate > endDate) throw new ProviderError("bcb", "FUTURE_DATA");
    if (observationDate < startDate || seen.has(observationDate)) throw new ProviderError("bcb", "INVALID_RESPONSE");
    seen.add(observationDate);
    return { series: "432", name: "Meta Selic", value: row.valor, unit: "% a.a.", observationDate, dataTimestamp, retrievedAt, source: url.toString() };
  }).sort((a, b) => a.observationDate.localeCompare(b.observationDate));
}
