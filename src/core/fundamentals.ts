import { decimal, money, timestamp } from "./money";

export type CvmScope = "CONSOLIDATED" | "INDIVIDUAL";
export type CvmStatement = "BPA" | "BPP" | "DRE";
export type CvmMetricName =
  | "revenue"
  | "netIncome"
  | "cash"
  | "currentBorrowings"
  | "noncurrentBorrowings"
  | "equity";

export type CvmDocument = {
  cvmCode: string;
  cnpj: string;
  companyName: string;
  referenceDate: string;
  version: number;
  documentId: string;
  receivedDate: string;
  receivedAtRaw: string;
};

export type CvmFact = {
  cvmCode: string;
  cnpj: string;
  referenceDate: string;
  version: number;
  scope: CvmScope;
  statement: CvmStatement;
  accountCode: string;
  accountDescription: string;
  fixedAccount: boolean;
  currency: string;
  scale: string;
  reportedValue: string;
  periodStart: string | null;
  periodEnd: string;
  sourceFile: string;
};

export type ReportedMetric = {
  value: string;
  unit: "BRL";
  evidence: CvmFact;
};

export type CvmFundamentals = {
  source: "CVM_DFP";
  sourceUrl: string;
  license: "ODbL";
  archiveSha256: string;
  retrievedAt: string;
  publishedAt: null;
  pointInTimeEligible: false;
  executionEligible: false;
  document: CvmDocument;
  scope: CvmScope;
  metrics: Record<CvmMetricName, ReportedMetric | null>;
  derived: {
    netMarginPercent: string | null;
    borrowings: string | null;
    netBorrowings: string | null;
    borrowingsToEquity: string | null;
  };
  limitations: string[];
};

const definitions: Record<
  CvmMetricName,
  { statement: CvmStatement; code: string; descriptions: string[] }
> = {
  revenue: {
    statement: "DRE",
    code: "3.01",
    descriptions: ["Receita de Venda de Bens e/ou Serviços"],
  },
  netIncome: {
    statement: "DRE",
    code: "3.11",
    descriptions: [
      "Lucro/Prejuízo do Período",
      "Lucro/Prejuízo Consolidado do Período",
    ],
  },
  cash: {
    statement: "BPA",
    code: "1.01.01",
    descriptions: ["Caixa e Equivalentes de Caixa"],
  },
  currentBorrowings: {
    statement: "BPP",
    code: "2.01.04",
    descriptions: ["Empréstimos e Financiamentos"],
  },
  noncurrentBorrowings: {
    statement: "BPP",
    code: "2.02.01",
    descriptions: ["Empréstimos e Financiamentos"],
  },
  equity: {
    statement: "BPP",
    code: "2.03",
    descriptions: ["Patrimônio Líquido", "Patrimônio Líquido Consolidado"],
  },
};

const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

export function validateCvmDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_CVM_DATE");
  timestamp(`${value}T00:00:00Z`);
  return value;
}

/** Only exact supported fixed account meanings are mapped; bank layouts may differ. */
export function deriveCvmFundamentals(input: {
  document: CvmDocument;
  scope: CvmScope;
  facts: readonly CvmFact[];
  sourceUrl: string;
  archiveSha256: string;
  retrievedAt: string;
}): CvmFundamentals {
  const { document, scope, facts, sourceUrl, archiveSha256, retrievedAt } =
    input;
  timestamp(retrievedAt);
  validateCvmDate(document.referenceDate);
  validateCvmDate(document.receivedDate);
  if (
    document.receivedDate < document.referenceDate ||
    document.receivedDate > retrievedAt.slice(0, 10)
  ) {
    throw new Error("INVALID_CVM_AVAILABILITY");
  }
  const metrics = {} as CvmFundamentals["metrics"];
  const limitations = [
    "LATEST_RETRIEVED_REVISION_ONLY",
    "PUBLICATION_TIMESTAMP_UNKNOWN_NO_HISTORICAL_POINT_IN_TIME",
    "BORROWINGS_ARE_REPORTED_LOANS_NOT_ALL_FINANCIAL_LIABILITIES",
    "NO_TICKER_MAPPING_OR_TRADE_AUTHORIZATION",
  ];
  for (const [name, definition] of Object.entries(definitions)) {
    const key = name as CvmMetricName;
    metrics[key] = null;
    const candidates = facts.filter(
      (fact) =>
        fact.cvmCode === document.cvmCode &&
        fact.cnpj === document.cnpj &&
        fact.referenceDate === document.referenceDate &&
        fact.version === document.version &&
        fact.scope === scope &&
        fact.statement === definition.statement &&
        fact.accountCode === definition.code &&
        fact.periodEnd === document.referenceDate,
    );
    if (candidates.length !== 1) {
      limitations.push(
        `${name}:${candidates.length ? "AMBIGUOUS_ACCOUNT" : "MISSING_ACCOUNT"}`,
      );
      continue;
    }
    const fact = candidates[0];
    if (
      !fact.fixedAccount ||
      !definition.descriptions
        .map(normalized)
        .includes(normalized(fact.accountDescription))
    ) {
      limitations.push(`${name}:UNSUPPORTED_ACCOUNT_MEANING`);
      continue;
    }
    if (
      normalized(fact.currency) !== "REAL" ||
      !["UNIDADE", "MIL"].includes(normalized(fact.scale))
    ) {
      limitations.push(`${name}:UNSUPPORTED_CURRENCY_OR_SCALE`);
      continue;
    }
    if (
      fact.statement === "DRE" &&
      (!fact.periodStart || validateCvmDate(fact.periodStart) > fact.periodEnd)
    ) {
      limitations.push(`${name}:INVALID_PERIOD`);
      continue;
    }
    try {
      // The official VL_CONTA dictionary specifies decimal(29,10), including
      // trailing zeroes. Scale first, then require exact ATLAS precision.
      if (!/^-?(?:0|[1-9]\d{0,18})(?:\.\d{1,10})?$/.test(fact.reportedValue)) {
        throw new Error("INVALID_REPORTED_AMOUNT");
      }
      const scaled = decimal("0")
        .plus(fact.reportedValue)
        .times(normalized(fact.scale) === "MIL" ? "1000" : "1");
      const value = money(decimal(scaled.toFixed()));
      metrics[key] = { value, unit: "BRL", evidence: { ...fact } };
    } catch {
      limitations.push(`${name}:INVALID_AMOUNT`);
    }
  }
  const {
    revenue,
    netIncome,
    cash,
    currentBorrowings,
    noncurrentBorrowings,
    equity,
  } = metrics;
  const borrowings =
    currentBorrowings && noncurrentBorrowings
      ? money(decimal(currentBorrowings.value).plus(noncurrentBorrowings.value))
      : null;
  const derived = {
    netMarginPercent:
      revenue &&
      netIncome &&
      decimal(revenue.value).gt(0) &&
      revenue.evidence.periodStart === netIncome.evidence.periodStart
        ? money(decimal(netIncome.value).dividedBy(revenue.value).times("100"))
        : null,
    borrowings,
    netBorrowings:
      borrowings !== null && cash
        ? money(decimal(borrowings).minus(cash.value))
        : null,
    borrowingsToEquity:
      borrowings !== null && equity && decimal(equity.value).gt(0)
        ? money(decimal(borrowings).dividedBy(equity.value))
        : null,
  };
  return {
    source: "CVM_DFP",
    sourceUrl,
    license: "ODbL",
    archiveSha256,
    retrievedAt,
    publishedAt: null,
    pointInTimeEligible: false,
    executionEligible: false,
    document,
    scope,
    metrics,
    derived,
    limitations,
  };
}

/** A newly downloaded archive cannot establish what was known before retrieval. */
export function assertCvmObservedBy(
  report: CvmFundamentals,
  asOf: string,
): void {
  if (timestamp(asOf) < timestamp(report.retrievedAt))
    throw new Error("CVM_POINT_IN_TIME_UNAVAILABLE");
}
