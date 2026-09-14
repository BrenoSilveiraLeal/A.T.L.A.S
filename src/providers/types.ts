export type ProviderName = "brapi" | "bcb" | "ibge";

export type ProviderErrorCode =
  | "INVALID_INPUT"
  | "INVALID_RESPONSE"
  | "EMPTY_DATA"
  | "FUTURE_DATA"
  | "TICKER_CHANGED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE";

export interface MarketQuote {
  ticker: string;
  price: string;
  currency: "BRL";
  dataTimestamp: string;
  retrievedAt: string;
  source: string;
  feed: "DELAYED" | "EOD";
  freshness: "DELAYED" | "STALE";
  ageSeconds: number;
  tradable: false;
}

export interface HistoricalBar {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  adjustedClose: string | null;
  volume: number;
}

export interface MarketHistory {
  ticker: string;
  bars: HistoricalBar[];
  interval: "1d";
  range: string;
  retrievedAt: string;
  source: string;
  feed: "EOD";
  tradable: false;
}

export interface AssetSearchResult {
  ticker: string;
  name: string;
  exchange: "B3";
  currency: "BRL";
  assetType: "stock";
  sector: string | null;
  source: string;
  retrievedAt: string;
}

export interface MacroObservation {
  series: "432";
  name: "Meta Selic";
  value: string;
  unit: "% a.a.";
  observationDate: string;
  /** Reference date, not a publication timestamp or a forecast. */
  dataTimestamp: string;
  retrievedAt: string;
  source: string;
}

export interface NewsArticle {
  id: string;
  source: "IBGE";
  sourceUrl: string;
  url: string;
  title: string;
  summary: string;
  publishedAt: string;
  retrievedAt: string;
  contentHash: string;
  eventClusterId: string;
  companies: string[];
  tickers: string[];
  category: "MACRO" | "INSTITUTIONAL";
  relevance: null;
  sentiment: null;
  confidence: null;
  expectedImpact: null;
  impactHorizon: null;
  analysisStatus: "UNCLASSIFIED";
}
