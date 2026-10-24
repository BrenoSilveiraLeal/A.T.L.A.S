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
// B3 formats numbers in pt-BR, sometimes with thousands separators ("4.900,00000000000").
const decimal = z.string().regex(/^(\d{1,3}(\.\d{3})+|\d{1,12})(,\d{1,11})?$/);
const plain = (value: string) => value.replace(/\./g, "").replace(",", ".");
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
    events.push({ kind, label: row.label.trim(), isin: row.isinCode, value: plain(row.rate),
      lastDatePrior: iso(row.lastDatePrior), paymentDate: iso(row.paymentDate) });
  }
  for (const row of company.stockDividends ?? []) {
    const kind = KINDS[row.label.trim()];
    if (!kind || kind === "CASH") continue;
    events.push({ kind, label: row.label.trim(), isin: row.isinCode, value: plain(row.factor),
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

const B3_COMPANY = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/";
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64");
const CLASS_BY_SUFFIX: Record<string, string> = { "3": "ON", "4": "PN", "5": "PNA", "6": "PNB", "11": "UNT" };

async function getJson(url: string): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ProviderError("b3", "TIMEOUT"); }
  if (!response.ok) { await response.body?.cancel(); throw new ProviderError("b3", "UNAVAILABLE", response.status); }
  return response.json();
}

/**
 * Full cash-dividend history (dividends and JCP, all years) for one ticker, from the B3
 * listed-companies service. The summary endpoint above only lists recent events. This one has
 * no payment date: payment is approximated as 30 days after the "data com" (research only).
 */
export async function fetchB3CashHistory(ticker: string): Promise<B3Event[]> {
  const match = /^([A-Z]{4})(\d{1,2})$/.exec(ticker);
  const typeStock = match ? CLASS_BY_SUFFIX[match[2]] : undefined;
  if (!match || !typeStock) throw new ProviderError("b3", "INVALID_INPUT");
  const companies = z.object({ results: z.array(z.object({ issuingCompany: z.string(), tradingName: z.string() }).loose()) }).loose()
    .parse(await getJson(`${B3_COMPANY}GetInitialCompanies/${encode({ language: "pt-br", pageNumber: 1, pageSize: 20, company: match[1] })}`));
  const tradingName = companies.results.find((c) => c.issuingCompany === match[1])?.tradingName;
  if (!tradingName) throw new ProviderError("b3", "INVALID_RESPONSE");
  const rowSchema = z.object({ typeStock: z.string(), valueCash: decimal, corporateAction: z.string(), lastDatePriorEx: date }).loose();
  const pageSchema = z.object({ page: z.object({ totalPages: z.number().int().min(0).max(50) }).loose(), results: z.array(rowSchema).max(500) }).loose();
  const events: B3Event[] = [];
  for (let page = 1, total = 1; page <= total; page++) {
    const body = pageSchema.parse(await getJson(`${B3_COMPANY}GetListedCashDividends/${encode({ language: "pt-br", pageNumber: page, pageSize: 120, tradingName })}`));
    total = body.page.totalPages;
    for (const row of body.results) {
      if (row.typeStock !== typeStock || !/DIVIDENDO|JRS CAP PROPRIO|RENDIMENTO/.test(row.corporateAction)) continue;
      const exDate = iso(row.lastDatePriorEx);
      const paid = new Date(Date.parse(`${exDate}T12:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
      events.push({ kind: "CASH", label: row.corporateAction, isin: ticker, value: plain(row.valueCash), lastDatePrior: exDate, paymentDate: paid });
    }
  }
  return events;
}
