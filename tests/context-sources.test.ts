import { describe, expect, it, vi } from "vitest";
import { parseCvmMaterialFacts } from "@/providers/cvm";
import { fetchHeadlines, gdeltUrl, parseGdeltHeadlines } from "@/providers/gdelt";
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
