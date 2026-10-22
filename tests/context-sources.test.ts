import { describe, expect, it, vi } from "vitest";
import { parseCvmMaterialFacts } from "@/providers/cvm";
import { fetchHeadlines, gdeltUrl, parseGdeltHeadlines } from "@/providers/gdelt";
import { fetchAgenciaBrasilHeadlines, parseAgenciaBrasilRss } from "@/providers/agencia-brasil";
import { parseFredCsv } from "@/providers/fred";
import { zip } from "./zip-fixture";

const header = "CNPJ_Companhia;Nome_Companhia;Codigo_CVM;Data_Referencia;Categoria;Tipo;Especie;Assunto;Data_Entrega;Tipo_Apresentacao;Protocolo_Entrega;Versao;Link_Download";
const row = (code: string, category: string, subject: string, delivered: string, link = "https://www.rad.cvm.gov.br/ENET/x") =>
  `00.000.000/0001-00;EMPRESA TESTE S.A.;${code};${delivered};${category};;;${subject};${delivered};AP - Apresentação;1;1;${link}`;

describe("CVM material facts (IPE open data)", () => {
  it("keeps only recent Fato Relevante rows with official links", () => {
    const csv = [header, row("9512", "Fato Relevante", "Aprovação de dividendos", "2026-10-13"),
      row("9512", "Comunicado ao Mercado", "Outro assunto", "2026-10-14"), row("4170", "Fato Relevante", "Antigo", "2026-07-01")].join("\r\n");
    const facts = parseCvmMaterialFacts(zip({ "ipe_cia_aberta_2026.csv": csv }), 2026, "2026-10-22T12:00:00Z");
    expect(facts).toEqual([{ cvmCode: "009512", company: "EMPRESA TESTE S.A.", deliveredOn: "2026-10-13",
      subject: "Aprovação de dividendos", url: "https://www.rad.cvm.gov.br/ENET/x" }]);
  });

  it("rejects future dates, foreign links and missing entries", () => {
    const parse = (csv: string, name = "ipe_cia_aberta_2026.csv") =>
      () => parseCvmMaterialFacts(zip({ [name]: [header, csv].join("\n") }), 2026, "2026-10-22T12:00:00Z");
    expect(parse(row("1", "Fato Relevante", "x", "2026-10-30"))).toThrow("FUTURE_DATA");
    expect(parse(row("1", "Fato Relevante", "x", "2026-10-20", "https://evil.test/x"))).toThrow("INVALID_DATA");
    expect(parse(row("1", "Fato Relevante", "x", "2026-10-20"), "other.csv")).toThrow("INVALID_ARCHIVE");
  });
});

describe("GDELT headlines", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const body = JSON.stringify({ articles: [{ url: "https://news.test/a", title: "Ibovespa recua 0 , 9 % ; dólar sobe", domain: "news.test",
    language: "Portuguese", seendate: "20261022T051500Z", sourcecountry: "Brazil" }] });

  it("builds a bounded artlist query and normalizes titles and timestamps", () => {
    expect(gdeltUrl("petrobras").searchParams.get("mode")).toBe("artlist");
    expect(() => gdeltUrl("")).toThrow();
    expect(parseGdeltHeadlines(body, now)).toEqual([{ title: "Ibovespa recua 0, 9%; dólar sobe", url: "https://news.test/a",
      domain: "news.test", language: "Portuguese", seenAt: "2026-10-22T05:15:00Z" }]);
    expect(parseGdeltHeadlines("{}", now)).toEqual([]);
  });

  it("recognizes the plain-text throttling notice and future items", () => {
    expect(() => parseGdeltHeadlines("Please limit requests to one every 5 seconds", now)).toThrow("RATE_LIMITED");
    expect(() => parseGdeltHeadlines("<html>", now)).toThrow("INVALID_RESPONSE");
    expect(() => parseGdeltHeadlines(body.replace("20261022T051500Z", "20261023T051500Z"), now)).toThrow("FUTURE_DATA");
  });

  it("makes exactly one attempt per call", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response("", { status: 429 }));
    await expect(fetchHeadlines("petrobras", "24h", 50, send)).rejects.toThrow("RATE_LIMITED");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("Agência Brasil RSS", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const item = (title: string, link: string, date = "Wed, 21 Oct 2026 20:07:00 -0300") =>
    `<item><title>${title}</title><link>${link}</link><description>&lt;p&gt;texto&lt;/p&gt;</description><pubDate>${date}</pubDate></item>`;
  const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;

  it("keeps title, official link and date, decoding entities", () => {
    const parsed = parseAgenciaBrasilRss(rss(item("Petrobras &amp; Vale: Ibovespa &#233; destaque", "https://agenciabrasil.ebc.com.br/economia/noticia/x")), now);
    expect(parsed).toEqual([{ title: "Petrobras & Vale: Ibovespa é destaque", url: "https://agenciabrasil.ebc.com.br/economia/noticia/x",
      domain: "agenciabrasil.ebc.com.br", language: "Portuguese", seenAt: "2026-10-21T23:07:00.000Z" }]);
  });

  it("drops foreign links and rejects future items or non-RSS bodies", () => {
    expect(parseAgenciaBrasilRss(rss(item("x", "https://evil.test/x")), now)).toEqual([]);
    expect(() => parseAgenciaBrasilRss(rss(item("x", "https://agenciabrasil.ebc.com.br/x", "Fri, 23 Oct 2026 20:00:00 -0300")), now)).toThrow("FUTURE_DATA");
    expect(() => parseAgenciaBrasilRss("<html></html>", now)).toThrow("INVALID_RESPONSE");
  });

  it("merges the four feeds without duplicates", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(rss(item("Mesma notícia", "https://agenciabrasil.ebc.com.br/geral/noticia/y"))));
    const headlines = await fetchAgenciaBrasilHeadlines(send);
    expect(send).toHaveBeenCalledTimes(4);
    expect(headlines).toHaveLength(1);
  });
});

describe("FRED Brent", () => {
  const lines = (...rows: string[]) => rows.join(String.fromCharCode(10));
  it("parses the official CSV, skipping holiday markers", () => {
    const csv = lines("observation_date,DCOILBRENTEU", "2026-10-19,118.82", "2026-10-20,.", "2026-10-21,115.22", "");
    expect(parseFredCsv(csv, "2026-10-22")).toEqual([{ date: "2026-10-19", value: "118.82" }, { date: "2026-10-21", value: "115.22" }]);
    expect(() => parseFredCsv("<html>", "2026-10-22")).toThrow("INVALID_RESPONSE");
    expect(() => parseFredCsv(lines("observation_date,DCOILBRENTEU", "2026-10-30,100"), "2026-10-22")).toThrow("FUTURE_DATA");
  });
});
