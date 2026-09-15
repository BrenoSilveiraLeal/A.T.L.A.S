import { afterEach, describe, expect, it, vi } from "vitest";
import { crc32, deflateRawSync } from "node:zlib";
import {
  assertCvmObservedBy,
  deriveCvmFundamentals,
  type CvmFact,
} from "../src/core/fundamentals";
import {
  fetchCvmFundamentals,
  parseCvmCsv,
  parseCvmDfpArchive,
  validateCvmQuery,
} from "../src/providers/cvm";

// Deliberately synthetic fixtures exist only here; no production fallback imports them.
const NOW = "2026-09-14T15:00:00.000Z";
const QUERY = { cvmCode: "1", year: 2025, scope: "CONSOLIDATED" as const };
const DOCUMENT = {
  cvmCode: "000001",
  cnpj: "11.111.111/0001-11",
  companyName: "FICTITIOUS TEST COMPANY",
  referenceDate: "2025-12-31",
  version: 2,
  documentId: "123",
  receivedDate: "2026-03-15",
  receivedAtRaw: "2026-03-15",
};
const COLUMNS = [
  "CNPJ_CIA",
  "DT_REFER",
  "VERSAO",
  "DENOM_CIA",
  "CD_CVM",
  "GRUPO_DFP",
  "MOEDA",
  "ESCALA_MOEDA",
  "ORDEM_EXERC",
  "DT_INI_EXERC",
  "DT_FIM_EXERC",
  "CD_CONTA",
  "DS_CONTA",
  "VL_CONTA",
  "ST_CONTA_FIXA",
];
const INDEX_COLUMNS = [
  "CNPJ_CIA",
  "DT_REFER",
  "VERSAO",
  "DENOM_CIA",
  "CD_CVM",
  "CATEG_DOC",
  "DT_RECEB",
  "ID_DOC",
  "LINK_DOC",
];
const cell = (value: string) =>
  /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const csv = (headers: string[], rows: Record<string, string>[]) =>
  `${headers.join(";")}\r\n${rows.map((row) => headers.map((h) => cell(row[h] ?? "")).join(";")).join("\r\n")}\r\n`;
const record = (overrides: Record<string, string> = {}) => ({
  CNPJ_CIA: DOCUMENT.cnpj,
  DT_REFER: DOCUMENT.referenceDate,
  VERSAO: "2",
  DENOM_CIA: DOCUMENT.companyName,
  CD_CVM: "000001",
  GRUPO_DFP: "DF Consolidado - Demonstração do Resultado",
  MOEDA: "REAL",
  ESCALA_MOEDA: "MIL",
  ORDEM_EXERC: "ÚLTIMO",
  DT_INI_EXERC: "2025-01-01",
  DT_FIM_EXERC: "2025-12-31",
  CD_CONTA: "3.01",
  DS_CONTA: "Receita de Venda de Bens e/ou Serviços",
  VL_CONTA: "100.50",
  ST_CONTA_FIXA: "S",
  ...overrides,
});
const indexRow = (overrides: Record<string, string> = {}) => ({
  CNPJ_CIA: DOCUMENT.cnpj,
  DT_REFER: DOCUMENT.referenceDate,
  VERSAO: "2",
  DENOM_CIA: DOCUMENT.companyName,
  CD_CVM: "1",
  CATEG_DOC: "DFP",
  DT_RECEB: DOCUMENT.receivedDate,
  ID_DOC: DOCUMENT.documentId,
  LINK_DOC: "",
  ...overrides,
});

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, csvText] of Object.entries(files)) {
    const raw = Buffer.from(csvText, "latin1");
    const compressed = deflateRawSync(raw);
    const filename = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc32(raw), 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(filename.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function files(
  overrides: Partial<
    Record<"index" | "BPA" | "BPP" | "DRE", Record<string, string>[]>
  > = {},
) {
  return {
    "dfp_cia_aberta_2025.csv": csv(
      INDEX_COLUMNS,
      overrides.index ?? [indexRow()],
    ),
    "dfp_cia_aberta_BPA_con_2025.csv": csv(
      COLUMNS,
      overrides.BPA ?? [
        record({
          CD_CONTA: "1.01.01",
          DS_CONTA: "Caixa e Equivalentes de Caixa",
          VL_CONTA: "20",
          GRUPO_DFP: "DF Consolidado - Balanço Patrimonial Ativo",
        }),
      ],
    ),
    "dfp_cia_aberta_BPP_con_2025.csv": csv(
      COLUMNS,
      overrides.BPP ?? [
        record({
          CD_CONTA: "2.01.04",
          DS_CONTA: "Empréstimos e Financiamentos",
          VL_CONTA: "10",
          GRUPO_DFP: "DF Consolidado - Balanço Patrimonial Passivo",
        }),
        record({
          CD_CONTA: "2.02.01",
          DS_CONTA: "Empréstimos e Financiamentos",
          VL_CONTA: "30",
          GRUPO_DFP: "DF Consolidado - Balanço Patrimonial Passivo",
        }),
        record({
          CD_CONTA: "2.03",
          DS_CONTA: "Patrimônio Líquido Consolidado",
          VL_CONTA: "80",
          GRUPO_DFP: "DF Consolidado - Balanço Patrimonial Passivo",
        }),
      ],
    ),
    "dfp_cia_aberta_DRE_con_2025.csv": csv(
      COLUMNS,
      overrides.DRE ?? [
        record(),
        record({
          CD_CONTA: "3.11",
          DS_CONTA: "Lucro/Prejuízo Consolidado do Período",
          VL_CONTA: "10.05",
        }),
      ],
    ),
  };
}
const parse = (overrides: Parameters<typeof files>[0] = {}) =>
  parseCvmDfpArchive(zip(files(overrides)), QUERY, NOW);
const factsOf = (report = parse()) =>
  Object.values(report.metrics).flatMap((metric) =>
    metric ? [metric.evidence] : [],
  );
const derive = (facts: CvmFact[]) =>
  deriveCvmFundamentals({
    document: DOCUMENT,
    scope: QUERY.scope,
    facts,
    sourceUrl: "https://dados.cvm.gov.br/",
    archiveSha256: "test-only",
    retrievedAt: NOW,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CVM reported annual fundamentals", () => {
  it("accepts the official decimal(29,10) representation without rounding facts", () => {
    expect(
      parse({ DRE: [record({ VL_CONTA: "123.4560000000" })] }).metrics.revenue
        ?.value,
    ).toBe("123456");
    expect(
      parse({ DRE: [record({ VL_CONTA: "0.0000000001" })] }).metrics.revenue
        ?.value,
    ).toBe("0.0000001");
    expect(
      parse({
        DRE: [record({ VL_CONTA: "0.0000000001", ESCALA_MOEDA: "UNIDADE" })],
      }).metrics.revenue,
    ).toBeNull();
  });
  it("normalizes BRL thousands exactly and preserves source report evidence", () => {
    const report = parse();
    expect(report.metrics.revenue?.value).toBe("100500");
    expect(report.metrics.revenue?.evidence.reportedValue).toBe("100.50");
    expect(report.metrics.cash?.value).toBe("20000");
    expect(report.derived).toEqual({
      netMarginPercent: "10",
      borrowings: "40000",
      netBorrowings: "20000",
      borrowingsToEquity: "0.5",
    });
    expect(report.document).toEqual(DOCUMENT);
    expect(report.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.publishedAt).toBeNull();
    expect(report.pointInTimeEligible).toBe(false);
    expect(report.executionEligible).toBe(false);
  });
  it("selects one latest report version, never fills its gaps from prior revisions or prior periods", () => {
    const report = parse({
      index: [
        indexRow({ VERSAO: "1", ID_DOC: "1", DT_RECEB: "2026-02-15" }),
        indexRow(),
      ],
      DRE: [
        record({ VERSAO: "1" }),
        record({
          CD_CONTA: "3.11",
          DS_CONTA: "Lucro/Prejuízo Consolidado do Período",
          ORDEM_EXERC: "PENÚLTIMO",
          DT_FIM_EXERC: "2024-12-31",
        }),
      ],
    });
    expect(report.document.version).toBe(2);
    expect(report.metrics.revenue).toBeNull();
    expect(report.metrics.netIncome).toBeNull();
    expect(report.derived.netMarginPercent).toBeNull();
  });
  it("does not map a bank's different account meaning onto industrial sales", () => {
    const report = parse({
      DRE: [record({ DS_CONTA: "Receitas de Intermediação Financeira" })],
    });
    expect(report.metrics.revenue).toBeNull();
    expect(report.limitations).toContain("revenue:UNSUPPORTED_ACCOUNT_MEANING");
  });
  it("does not replace missing borrowings with zero or derive net borrowings", () => {
    const report = derive(
      factsOf().filter((fact) => fact.accountCode !== "2.02.01"),
    );
    expect(report.derived.borrowings).toBeNull();
    expect(report.derived.netBorrowings).toBeNull();
  });
  it.each(["DOLAR", "EURO"])(
    "does not convert unknown currency %s to BRL",
    (currency) => {
      expect(
        parse({ DRE: [record({ MOEDA: currency })] }).metrics.revenue,
      ).toBeNull();
    },
  );
  it("accepts reported units without multiplying by thousands", () => {
    expect(
      parse({ DRE: [record({ ESCALA_MOEDA: "UNIDADE", VL_CONTA: "0.01" })] })
        .metrics.revenue?.value,
    ).toBe("0.01");
  });
  it.each(["MILHÃO", "", "1000"])("refuses unknown scale %s", (scale) => {
    expect(
      parse({ DRE: [record({ ESCALA_MOEDA: scale })] }).metrics.revenue,
    ).toBeNull();
  });
  it.each(["NaN", "1e10", "1,23", "9999999999999999999999999999"])(
    "refuses malformed/overflow money %s",
    (value) => {
      expect(
        parse({ DRE: [record({ VL_CONTA: value })] }).metrics.revenue,
      ).toBeNull();
    },
  );
  it("does not derive margin across incompatible income periods", () => {
    const facts = factsOf().map((fact) =>
      fact.accountCode === "3.11"
        ? { ...fact, periodStart: "2025-07-01" }
        : fact,
    );
    expect(derive(facts).derived.netMarginPercent).toBeNull();
  });
  it("keeps negative profits while refusing zero/negative ratio denominators", () => {
    const facts = factsOf().map((fact) => ({
      ...fact,
      reportedValue:
        fact.accountCode === "3.11"
          ? "-10.05"
          : fact.accountCode === "2.03"
            ? "-80"
            : fact.reportedValue,
    }));
    expect(derive(facts).derived.netMarginPercent).toBe("-10");
    expect(derive(facts).derived.borrowingsToEquity).toBeNull();
    expect(
      parse({
        DRE: [
          record({ VL_CONTA: "0" }),
          record({
            CD_CONTA: "3.11",
            DS_CONTA: "Lucro/Prejuízo do Período",
            VL_CONTA: "2",
          }),
        ],
      }).derived.netMarginPercent,
    ).toBeNull();
  });
  it("treats duplicate account rows as ambiguous, not an amount to sum", () => {
    expect(parse({ DRE: [record(), record()] }).metrics.revenue).toBeNull();
  });
  it("will not mix another company, individual scope, or older balance with a selected report", () => {
    const facts = factsOf().map((fact) => ({ ...fact, cvmCode: "000002" }));
    expect(derive(facts).metrics.cash).toBeNull();
    expect(
      derive(factsOf().map((fact) => ({ ...fact, scope: "INDIVIDUAL" })))
        .metrics.cash,
    ).toBeNull();
    expect(
      derive(factsOf().map((fact) => ({ ...fact, periodEnd: "2024-12-31" })))
        .metrics.cash,
    ).toBeNull();
  });
  it("does not claim historical point-in-time knowledge from today's archive", () => {
    const report = parse();
    expect(() => assertCvmObservedBy(report, "2026-03-16T00:00:00Z")).toThrow(
      "CVM_POINT_IN_TIME_UNAVAILABLE",
    );
    expect(() => assertCvmObservedBy(report, NOW)).not.toThrow();
  });
  it("rejects conflicting report identities and future receipt/reference dates", () => {
    expect(() =>
      parse({ index: [indexRow(), indexRow({ ID_DOC: "456" })] }),
    ).toThrow("INVALID_DATA");
    expect(() =>
      parse({ index: [indexRow({ DT_RECEB: "2027-01-01" })] }),
    ).toThrow("FUTURE_DATA");
    expect(() =>
      parse({ index: [indexRow({ DT_RECEB: "2025-01-01" })] }),
    ).toThrow("INVALID_DATA");
  });
  it("requires an explicit CVM code and never guesses a company from a ticker", () => {
    expect(() => validateCvmQuery({ ...QUERY, cvmCode: "PETR4" })).toThrow(
      "INVALID_INPUT",
    );
    expect(() => validateCvmQuery({ ...QUERY, year: 2099 })).toThrow(
      "INVALID_INPUT",
    );
    expect(() =>
      parseCvmDfpArchive(zip(files()), { ...QUERY, cvmCode: "2" }, NOW),
    ).toThrow("NOT_FOUND");
    expect(() =>
      parseCvmDfpArchive(zip(files()), { ...QUERY, scope: "INDIVIDUAL" }, NOW),
    ).toThrow("INVALID_ARCHIVE");
  });
});

describe("CVM archive and CSV boundaries", () => {
  it("preserves CVM literal quotes in an unquoted field", () => {
    expect([
      ...parseCvmCsv('CONTA;VALOR\nInstrumentos ("VJORA");123.0000000000'),
    ]).toEqual([{ CONTA: 'Instrumentos ("VJORA")', VALOR: "123.0000000000" }]);
  });
  it("reads Latin1 company names and escaped quotes/semicolons/newlines", () => {
    const rows = [
      ...parseCvmCsv('NOME;VALOR\r\n"Empresa; A ""Sul""\nBrasil";1.25\r\n'),
    ];
    expect(rows).toEqual([{ NOME: 'Empresa; A "Sul"\nBrasil', VALOR: "1.25" }]);
    expect(
      parse({ index: [indexRow({ DENOM_CIA: "Companhia Açúcar" })] }).document
        .companyName,
    ).toBe("Companhia Açúcar");
  });
  it.each([
    "A;A\n1;2",
    "A;B\n1",
    'A;B\n"oops;2',
    'A;B\n"ok"x;2',
    'A;B\n1;"' + "x".repeat(17000) + '"',
  ])("rejects malformed or oversized CSV", (value) => {
    expect(() => [...parseCvmCsv(value)]).toThrow("INVALID_DATA");
  });
  it("rejects HTML, truncation and corrupt compressed data", () => {
    expect(() =>
      parseCvmDfpArchive(Buffer.from("<html>502</html>"), QUERY, NOW),
    ).toThrow("INVALID_ARCHIVE");
    const good = zip(files());
    expect(() =>
      parseCvmDfpArchive(good.subarray(0, good.length - 8), QUERY, NOW),
    ).toThrow("INVALID_ARCHIVE");
    const bad = Buffer.from(good);
    bad[80] ^= 255;
    expect(() => parseCvmDfpArchive(bad, QUERY, NOW)).toThrow(
      "INVALID_ARCHIVE",
    );
  });
  it("rejects traversal names without ever writing archive contents", () => {
    expect(() =>
      parseCvmDfpArchive(zip({ "../outside.csv": "A\n1" }), QUERY, NOW),
    ).toThrow("INVALID_ARCHIVE");
  });
  it("checks CRC against payload and bounds declared output before inflation", () => {
    const bad = zip(files());
    const dir = bad.readUInt32LE(bad.length - 6);
    bad.writeUInt32LE(123, 14);
    bad.writeUInt32LE(123, dir + 16);
    expect(() => parseCvmDfpArchive(bad, QUERY, NOW)).toThrow(
      "INVALID_ARCHIVE",
    );
    const huge = zip(files());
    const offset = huge.readUInt32LE(huge.length - 6);
    huge.writeUInt32LE(97 * 1024 * 1024, 22);
    huge.writeUInt32LE(97 * 1024 * 1024, offset + 24);
    expect(() => parseCvmDfpArchive(huge, QUERY, NOW)).toThrow(
      "RESPONSE_TOO_LARGE",
    );
  });
  it("refuses a DEFLATE stream larger than its advertised uncompressed size", () => {
    const bad = zip(files());
    const dir = bad.readUInt32LE(bad.length - 6);
    bad.writeUInt32LE(1, 22);
    bad.writeUInt32LE(1, dir + 24);
    expect(() => parseCvmDfpArchive(bad, QUERY, NOW)).toThrow(
      "INVALID_ARCHIVE",
    );
  });
  it("rejects encryption, local/central disagreement and duplicate entry names", () => {
    const encrypted = zip(files());
    const dir = encrypted.readUInt32LE(encrypted.length - 6);
    encrypted.writeUInt16LE(1, dir + 8);
    expect(() => parseCvmDfpArchive(encrypted, QUERY, NOW)).toThrow(
      "INVALID_ARCHIVE",
    );
    const disagreement = zip(files());
    disagreement.writeUInt16LE(0, 8);
    expect(() => parseCvmDfpArchive(disagreement, QUERY, NOW)).toThrow(
      "INVALID_ARCHIVE",
    );
    const duplicates = zip({ "same1.csv": "A\n1", "same2.csv": "A\n2" });
    for (let pos = 0; pos < duplicates.length - 9; pos++)
      if (duplicates.subarray(pos, pos + 9).toString() === "same2.csv")
        duplicates.write("same1.csv", pos);
    expect(() => parseCvmDfpArchive(duplicates, QUERY, NOW)).toThrow(
      "INVALID_ARCHIVE",
    );
  });
});

describe("CVM HTTP boundary", () => {
  it("uses only fixed official HTTPS destination without redirects and returns reported evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(zip(files())), {
        headers: { "content-type": "application/zip" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const report = await fetchCvmFundamentals(QUERY);
    expect(report.source).toBe("CVM_DFP");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_2025.zip",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
    });
  });
  it("rejects declared oversized responses before reading bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", {
          headers: {
            "content-type": "application/zip",
            "content-length": String(25 * 1024 * 1024),
          },
        }),
      ),
    );
    await expect(fetchCvmFundamentals(QUERY)).rejects.toThrow(
      "RESPONSE_TOO_LARGE",
    );
  });
  it("rejects chunked overflow and html error documents", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(25 * 1024 * 1024), {
          headers: { "content-type": "application/zip" },
        }),
      ),
    );
    await expect(fetchCvmFundamentals(QUERY)).rejects.toThrow(
      "RESPONSE_TOO_LARGE",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>error</html>", {
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(fetchCvmFundamentals(QUERY)).rejects.toThrow(
      "INVALID_ARCHIVE",
    );
  });
  it("does not leak upstream errors or silently retry large downloads", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("upstream secret payload"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCvmFundamentals(QUERY)).rejects.toThrow(
      "cvm: UNAVAILABLE",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.skipIf(process.env.ATLAS_CVM_PUBLIC_SMOKE !== "1")(
    "reads actual public annual DFP without introducing production fixtures",
    async () => {
      const report = await fetchCvmFundamentals({
        cvmCode: "9512",
        year: 2025,
        scope: "CONSOLIDATED",
      });
      expect(report.document.cvmCode).toBe("009512");
      expect(report.metrics.revenue?.evidence.sourceFile).toBe(
        "dfp_cia_aberta_DRE_con_2025.csv",
      );
      expect(report.metrics.revenue?.value).toMatch(/^\d+(?:\.\d+)?$/);
      expect(report.executionEligible).toBe(false);
    },
    60000,
  );
});
