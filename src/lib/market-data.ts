import "server-only";
import { focusTrend, parseFundamentus, type FocusTrend, type Valuation } from "@/core/valuation";

/**
 * Valuation (Fundamentus) and the economists' outlook (Boletim Focus) for the council, fetched at
 * most every few hours and kept in memory (core/valuation explains the sources). A failure only
 * means the analysts go without this piece; it never blocks a decision.
 */
const VALUATION_TTL = 12 * 3600000, FOCUS_TTL = 6 * 3600000, RETRY_AFTER = 30 * 60000;
let valuations: { at: number; data: Record<string, Valuation> | null } | null = null;
let focus: { at: number; data: FocusTrend | null } | null = null;

async function download(url: string, maxBytes: number): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (ATLAS)" }, signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
  return body;
}

export async function valuationFor(ticker: string): Promise<Valuation | null> {
  const fresh = valuations && Date.now() - valuations.at < (valuations.data ? VALUATION_TTL : RETRY_AFTER);
  if (!fresh) {
    try {
      // The page is Latin-1.
      const html = new TextDecoder("latin1").decode(await download("https://www.fundamentus.com.br/resultado.php", 4 * 1024 * 1024));
      valuations = { at: Date.now(), data: parseFundamentus(html) };
    } catch {
      valuations = { at: Date.now(), data: valuations?.data ?? null };
    }
  }
  return valuations?.data?.[ticker] ?? null;
}

export async function focusOutlook(now = new Date()): Promise<FocusTrend | null> {
  if (focus && Date.now() - focus.at < (focus.data ? FOCUS_TTL : RETRY_AFTER)) return focus.data;
  // End of next year: what the economists expect after the current shock settles.
  const year = String(now.getUTCFullYear() + 1);
  const rows = async (indicator: string) => {
    const filter = encodeURIComponent(`Indicador eq '${indicator}' and DataReferencia eq '${year}' and baseCalculo eq 0`);
    const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?$top=40&$filter=${filter}&$orderby=Data%20desc&$select=Data,Mediana&$format=json`;
    const body = JSON.parse(new TextDecoder().decode(await download(url, 512 * 1024))) as { value?: { Data: string; Mediana: number }[] };
    return (body.value ?? []).filter((r) => typeof r.Data === "string" && Number.isFinite(r.Mediana));
  };
  try {
    const [selic, ipca] = await Promise.all([rows("Selic"), rows("IPCA")]);
    focus = { at: Date.now(), data: focusTrend(selic, ipca, year) };
  } catch {
    focus = { at: Date.now(), data: focus?.data ?? null };
  }
  return focus.data;
}
