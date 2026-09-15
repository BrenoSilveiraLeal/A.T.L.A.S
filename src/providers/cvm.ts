import "server-only";
import { createHash } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";
import {
  deriveCvmFundamentals,
  validateCvmDate,
  type CvmDocument,
  type CvmFact,
  type CvmFundamentals,
  type CvmScope,
  type CvmStatement,
} from "../core/fundamentals";
import { timestamp } from "../core/money";

export type CvmQuery = { cvmCode: string; year: number; scope: CvmScope };
export type CvmErrorCode =
  | "INVALID_INPUT"
  | "UNAVAILABLE"
  | "NOT_FOUND"
  | "INVALID_ARCHIVE"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_DATA"
  | "FUTURE_DATA";
export class CvmProviderError extends Error {
  readonly provider = "cvm";
  constructor(public readonly code: CvmErrorCode) {
    super(`cvm: ${code}`);
    this.name = "CvmProviderError";
  }
}

const MiB = 1024 * 1024;
const MAX_ARCHIVE = 24 * MiB;
const MAX_ENTRY = 96 * MiB;
const MAX_TOTAL = 768 * MiB;
const MAX_ENTRIES = 256;
const MAX_ROWS = 1_000_000;
const MAX_ROW = 32_768;
const MAX_CELL = 16_384;
const MAX_SELECTED_FACTS = 10_000;
const SOURCE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/";

export function validateCvmQuery(query: CvmQuery, now = Date.now()): CvmQuery {
  if (
    !query ||
    typeof query.cvmCode !== "string" ||
    !/^\d{1,6}$/.test(query.cvmCode) ||
    Number(query.cvmCode) === 0 ||
    !Number.isSafeInteger(query.year) ||
    query.year < 2010 ||
    query.year > new Date(now).getUTCFullYear() ||
    !["CONSOLIDATED", "INDIVIDUAL"].includes(query.scope)
  ) {
    throw new CvmProviderError("INVALID_INPUT");
  }
  return { ...query, cvmCode: query.cvmCode.padStart(6, "0") };
}

type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressed: number;
  expanded: number;
  offset: number;
};

/** Strict classic ZIP reader. No paths are extracted and ZIP64/encryption are refused. */
function zipDirectory(bytes: Buffer): Map<string, ZipEntry> {
  const invalid = () => {
    throw new CvmProviderError("INVALID_ARCHIVE");
  };
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE) invalid();
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65_557);
    at--
  ) {
    if (
      bytes.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0) invalid();
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    !count ||
    count > MAX_ENTRIES ||
    directoryOffset + directorySize !== end
  )
    invalid();
  const entries = new Map<string, ZipEntry>();
  const spans: Array<[number, number]> = [];
  let expandedTotal = 0;
  let at = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) invalid();
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      !nameLength ||
      nameLength > 160 ||
      bytes.readUInt16LE(at + 34)
    )
      invalid();
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const entry: ZipEntry = {
      name,
      method: bytes.readUInt16LE(at + 10),
      flags: bytes.readUInt16LE(at + 8),
      crc: bytes.readUInt32LE(at + 16),
      compressed: bytes.readUInt32LE(at + 20),
      expanded: bytes.readUInt32LE(at + 24),
      offset: bytes.readUInt32LE(at + 42),
    };
    expandedTotal += entry.expanded;
    if (
      !/^[A-Za-z0-9_]+\.csv$/.test(name) ||
      entries.has(name) ||
      (entry.flags & ~0x080e) !== 0 ||
      ![0, 8].includes(entry.method) ||
      entry.expanded === 0xffffffff ||
      entry.compressed === 0xffffffff ||
      expandedTotal > MAX_TOTAL ||
      entry.offset + 30 > directoryOffset ||
      bytes.readUInt32LE(entry.offset) !== 0x04034b50
    )
      invalid();
    const localNameLength = bytes.readUInt16LE(entry.offset + 26);
    const localExtraLength = bytes.readUInt16LE(entry.offset + 28);
    const dataStart = entry.offset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressed;
    if (
      dataEnd > directoryOffset ||
      bytes.readUInt16LE(entry.offset + 6) !== entry.flags ||
      bytes.readUInt16LE(entry.offset + 8) !== entry.method ||
      !bytes
        .subarray(entry.offset + 30, entry.offset + 30 + localNameLength)
        .equals(bytes.subarray(at + 46, at + 46 + nameLength))
    )
      invalid();
    if (
      !(entry.flags & 8) &&
      (bytes.readUInt32LE(entry.offset + 14) !== entry.crc ||
        bytes.readUInt32LE(entry.offset + 18) !== entry.compressed ||
        bytes.readUInt32LE(entry.offset + 22) !== entry.expanded)
    )
      invalid();
    spans.push([entry.offset, dataEnd]);
    entries.set(name, entry);
    at = next;
  }
  if (at !== end) invalid();
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((span, index) => index > 0 && span[0] < spans[index - 1][1]))
    invalid();
  return entries;
}

function extractCsv(bytes: Buffer, entry: ZipEntry): string {
  if (entry.expanded > MAX_ENTRY)
    throw new CvmProviderError("RESPONSE_TOO_LARGE");
  const dataStart =
    entry.offset +
    30 +
    bytes.readUInt16LE(entry.offset + 26) +
    bytes.readUInt16LE(entry.offset + 28);
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressed);
  let expanded: Buffer;
  try {
    expanded =
      entry.method === 0
        ? compressed
        : inflateRawSync(compressed, {
            maxOutputLength: Math.max(1, entry.expanded),
          });
  } catch {
    throw new CvmProviderError("INVALID_ARCHIVE");
  }
  if (expanded.length !== entry.expanded || crc32(expanded) !== entry.crc)
    throw new CvmProviderError("INVALID_ARCHIVE");
  // Official CSV files use ISO-8859-1; Buffer latin1 does not reinterpret money.
  return expanded.toString("latin1");
}

/** Quoted semicolon CSV, including embedded newlines. Retains one row at a time. */
export function* parseCvmCsv(csv: string): Generator<Record<string, string>> {
  let headers: string[] | undefined;
  let fields: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  let rowSize = 0;
  let rowCount = 0;
  for (let at = 0; at <= csv.length; at++) {
    const char = at === csv.length ? "\n" : csv[at];
    if (++rowSize > MAX_ROW || cell.length > MAX_CELL || fields.length > 64)
      throw new CvmProviderError("INVALID_DATA");
    if (quoted) {
      if (at === csv.length) throw new CvmProviderError("INVALID_DATA");
      if (char === '"') {
        if (csv[at + 1] === '"') {
          cell += '"';
          at++;
          rowSize++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (closed) throw new CvmProviderError("INVALID_DATA");
      // CVM emits literal quotes inside unquoted account descriptions, e.g. ("VJORA").
      // Only a quote at the start of a field opens a quoted field.
      if (cell) cell += char;
      else quoted = true;
      continue;
    }
    if (char === ";" || char === "\n" || char === "\r") {
      fields.push(cell);
      cell = "";
      closed = false;
      if (char === ";") continue;
      if (char === "\r" && csv[at + 1] === "\n") at++;
      if (fields.length === 1 && fields[0] === "") {
        fields = [];
        rowSize = 0;
        continue;
      }
      if (++rowCount > MAX_ROWS) throw new CvmProviderError("INVALID_DATA");
      if (!headers) {
        headers = fields;
        if (
          headers.some((h) => !/^[A-Z][A-Z0-9_]*$/.test(h)) ||
          new Set(headers).size !== headers.length
        )
          throw new CvmProviderError("INVALID_DATA");
      } else {
        if (fields.length !== headers.length)
          throw new CvmProviderError("INVALID_DATA");
        yield Object.fromEntries(
          headers.map((header, index) => [header, fields[index]]),
        );
      }
      fields = [];
      rowSize = 0;
    } else {
      if (closed) throw new CvmProviderError("INVALID_DATA");
      cell += char;
    }
  }
  if (!headers) throw new CvmProviderError("INVALID_DATA");
}

function cvmCode(value: string): string {
  if (!/^\d{1,6}$/.test(value)) throw new CvmProviderError("INVALID_DATA");
  return value.padStart(6, "0");
}
function version(value: string): number {
  if (!/^[1-9]\d{0,4}$/.test(value)) throw new CvmProviderError("INVALID_DATA");
  return Number(value);
}
function requireColumns(row: Record<string, string>, columns: string[]): void {
  if (columns.some((column) => !(column in row)))
    throw new CvmProviderError("INVALID_DATA");
}

/** Public for deterministic archive/security tests; runtime uses fetchCvmFundamentals. */
export function parseCvmDfpArchive(
  data: Uint8Array,
  rawQuery: CvmQuery,
  retrievedAt: string,
): CvmFundamentals {
  const now = timestamp(retrievedAt);
  const query = validateCvmQuery(rawQuery, now);
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  try {
    const entries = zipDirectory(bytes);
    const prefix = `dfp_cia_aberta_`;
    const index = entries.get(`${prefix}${query.year}.csv`);
    if (!index) throw new CvmProviderError("INVALID_ARCHIVE");
    let document: CvmDocument | undefined;
    for (const row of parseCvmCsv(extractCsv(bytes, index))) {
      requireColumns(row, [
        "CD_CVM",
        "CNPJ_CIA",
        "DENOM_CIA",
        "DT_REFER",
        "VERSAO",
        "ID_DOC",
        "DT_RECEB",
      ]);
      if (cvmCode(row.CD_CVM) !== query.cvmCode) continue;
      const referenceDate = validateCvmDate(row.DT_REFER);
      if (Number(referenceDate.slice(0, 4)) !== query.year) continue;
      if (
        !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)?$/.test(
          row.DT_RECEB,
        ) ||
        !/^\d{1,12}$/.test(row.ID_DOC) ||
        !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(row.CNPJ_CIA) ||
        !row.DENOM_CIA.trim() ||
        row.DENOM_CIA.length > 200
      )
        throw new CvmProviderError("INVALID_DATA");
      const receivedDate = validateCvmDate(row.DT_RECEB.slice(0, 10));
      if (row.DT_RECEB.length > 10)
        timestamp(`${row.DT_RECEB.replace(" ", "T")}Z`);
      if (
        referenceDate > retrievedAt.slice(0, 10) ||
        receivedDate > retrievedAt.slice(0, 10)
      )
        throw new CvmProviderError("FUTURE_DATA");
      const candidate: CvmDocument = {
        cvmCode: query.cvmCode,
        cnpj: row.CNPJ_CIA,
        companyName: row.DENOM_CIA,
        referenceDate,
        version: version(row.VERSAO),
        documentId: row.ID_DOC,
        receivedDate,
        receivedAtRaw: row.DT_RECEB,
      };
      if (
        !document ||
        candidate.referenceDate > document.referenceDate ||
        (candidate.referenceDate === document.referenceDate &&
          candidate.version > document.version)
      )
        document = candidate;
      else if (
        candidate.referenceDate === document.referenceDate &&
        candidate.version === document.version &&
        JSON.stringify(candidate) !== JSON.stringify(document)
      )
        throw new CvmProviderError("INVALID_DATA");
    }
    if (!document) throw new CvmProviderError("NOT_FOUND");
    const facts: CvmFact[] = [];
    for (const statement of ["BPA", "BPP", "DRE"] as const) {
      const suffix = query.scope === "CONSOLIDATED" ? "con" : "ind";
      const name = `${prefix}${statement}_${suffix}_${query.year}.csv`;
      const entry = entries.get(name);
      if (!entry) throw new CvmProviderError("INVALID_ARCHIVE");
      // Only this CSV is decompressed/decoded at a time, never the full annual archive.
      for (const row of parseCvmCsv(extractCsv(bytes, entry))) {
        requireColumns(row, [
          "CD_CVM",
          "CNPJ_CIA",
          "DT_REFER",
          "VERSAO",
          "GRUPO_DFP",
          "ORDEM_EXERC",
          "DT_FIM_EXERC",
          "CD_CONTA",
          "DS_CONTA",
          "VL_CONTA",
          "MOEDA",
          "ESCALA_MOEDA",
          "ST_CONTA_FIXA",
        ]);
        if (
          cvmCode(row.CD_CVM) !== document.cvmCode ||
          row.CNPJ_CIA !== document.cnpj ||
          row.DT_REFER !== document.referenceDate ||
          version(row.VERSAO) !== document.version ||
          row.ORDEM_EXERC !== "ÚLTIMO"
        )
          continue;
        const expectedScope =
          query.scope === "CONSOLIDATED"
            ? "DF Consolidado - "
            : "DF Individual - ";
        if (!row.GRUPO_DFP.startsWith(expectedScope))
          throw new CvmProviderError("INVALID_DATA");
        const periodEnd = validateCvmDate(row.DT_FIM_EXERC);
        if (periodEnd !== document.referenceDate) continue;
        if (
          facts.length >= MAX_SELECTED_FACTS ||
          !/^\d(?:\.\d{2}){0,6}$/.test(row.CD_CONTA) ||
          !["S", "N"].includes(row.ST_CONTA_FIXA)
        )
          throw new CvmProviderError("INVALID_DATA");
        facts.push({
          cvmCode: document.cvmCode,
          cnpj: document.cnpj,
          referenceDate: document.referenceDate,
          version: document.version,
          scope: query.scope,
          statement: statement as CvmStatement,
          accountCode: row.CD_CONTA,
          accountDescription: row.DS_CONTA,
          fixedAccount: row.ST_CONTA_FIXA === "S",
          currency: row.MOEDA,
          scale: row.ESCALA_MOEDA,
          reportedValue: row.VL_CONTA,
          periodStart:
            statement === "DRE"
              ? validateCvmDate(row.DT_INI_EXERC ?? "")
              : null,
          periodEnd,
          sourceFile: name,
        });
      }
    }
    if (!facts.length) throw new CvmProviderError("NOT_FOUND");
    return deriveCvmFundamentals({
      document,
      scope: query.scope,
      facts,
      sourceUrl: `${SOURCE}${prefix}${query.year}.zip`,
      archiveSha256: createHash("sha256").update(bytes).digest("hex"),
      retrievedAt,
    });
  } catch (error) {
    if (error instanceof CvmProviderError) throw error;
    throw new CvmProviderError("INVALID_DATA");
  }
}

/** One bounded HTTPS GET; caller should persist a shared cache, not poll per agent. */
export async function fetchCvmFundamentals(
  rawQuery: CvmQuery,
): Promise<CvmFundamentals> {
  const query = validateCvmQuery(rawQuery);
  const url = `${SOURCE}dfp_cia_aberta_${query.year}.zip`;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
      headers: { Accept: "application/zip, application/octet-stream" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CvmProviderError(
        response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE",
      );
    }
    if (Number(response.headers.get("content-length")) > MAX_ARCHIVE) {
      await response.body?.cancel();
      throw new CvmProviderError("RESPONSE_TOO_LARGE");
    }
    const mime = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (
      !response.body ||
      ![
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
      ].includes(mime ?? "")
    ) {
      await response.body?.cancel();
      throw new CvmProviderError("INVALID_ARCHIVE");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_ARCHIVE) {
          await reader.cancel();
          throw new CvmProviderError("RESPONSE_TOO_LARGE");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return parseCvmDfpArchive(
      Buffer.concat(chunks, length),
      query,
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof CvmProviderError) throw error;
    throw new CvmProviderError("UNAVAILABLE");
  }
}
