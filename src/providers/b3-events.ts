import "server-only";
import { z } from "zod";
import { ProviderError } from "./http";

/**
 * Official B3 corporate events (proventos and stock events) from the public listed-
 * companies service used by b3.com.br. No key, no cost; read for personal use.
 */
export interface B3Event {
  kind: "CASH" | "SPLIT" | "GROUPING" | "BONUS";
  label: string;
  isin: string;
  value: string;
  lastDatePrior: string;
  paymentDate: string | null;
}

const KINDS: Record<string, B3Event["kind"]> = {
  DIVIDENDO: "CASH", "JRS CAP PROPRIO": "CASH", RENDIMENTO: "CASH",
  DESDOBRAMENTO: "SPLIT", GRUPAMENTO: "GROUPING", BONIFICACAO: "BONUS",
};
const date = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/);
const decimal = z.string().regex(/^\d{1,12}(,\d{1,11})?$/);
const eventSchema = z.object({ isinCode: z.string().regex(/^BR[A-Z0-9]{10}$/), label: z.string().max(60), lastDatePrior: date }).loose();
const payloadSchema = z.array(z.object({
  cashDividends: z.array(eventSchema.extend({ rate: decimal, paymentDate: date.or(z.literal("")) })).max(2000).optional(),
  stockDividends: z.array(eventSchema.extend({ factor: decimal })).max(2000).optional(),
}).loose()).min(1).max(1);

const iso = (value: string) => `${value.slice(6)}-${value.slice(3, 5)}-${value.slice(0, 2)}`;

export function b3EventsUrl(issuer: string) {
  if (!/^[A-Z]{4}$/.test(issuer)) throw new ProviderError("b3", "INVALID_INPUT");
  const body = Buffer.from(JSON.stringify({ issuingCompany: issuer, language: "pt-br" })).toString("base64");
  return `https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/${body}`;
}

export function parseB3Events(json: unknown): B3Event[] {
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError("b3", "INVALID_RESPONSE");
  const [company] = parsed.data;
  const events: B3Event[] = [];
  for (const row of company.cashDividends ?? []) {
    const kind = KINDS[row.label.trim()];
    if (kind !== "CASH" || !row.paymentDate) continue; // payment date not set yet: nothing to credit
    events.push({ kind, label: row.label.trim(), isin: row.isinCode, value: row.rate.replace(",", "."),
      lastDatePrior: iso(row.lastDatePrior), paymentDate: iso(row.paymentDate) });
  }
  for (const row of company.stockDividends ?? []) {
    const kind = KINDS[row.label.trim()];
    if (!kind || kind === "CASH") continue;
    events.push({ kind, label: row.label.trim(), isin: row.isinCode, value: row.factor.replace(",", "."),
      lastDatePrior: iso(row.lastDatePrior), paymentDate: null });
  }
  return events;
}

export async function fetchB3Events(issuer: string, transport: typeof fetch = fetch): Promise<B3Event[]> {
  let response: Response;
  try {
    response = await transport(b3EventsUrl(issuer), { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ProviderError("b3", "TIMEOUT");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError("b3", "UNAVAILABLE", response.status);
  }
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new ProviderError("b3", "INVALID_RESPONSE");
  try {
    return parseB3Events(JSON.parse(text));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("b3", "INVALID_RESPONSE");
  }
}
