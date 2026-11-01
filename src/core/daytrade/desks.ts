/**
 * The DASH office (Day-trading Analysis & Strategy Hub · Núcleo de Análise e Estratégia de Day
 * Trade): what each desk stands for and the states the dashboard must keep apart (owner,
 * 01/11/2026). Each desk is a future worker process, not a computer of its own. Nothing here trades:
 * until a feed, an account and the risk guard exist, every desk is idle and every number is empty.
 * Pure; no I/O.
 */
export type DeskId = "feed" | "price" | "news" | "strategy" | "risk" | "supervisor";
export interface Desk {
  id: DeskId;
  role: string;
  /** What the desk will do once its worker exists. */
  job: string;
  /** Agent shown at the desk (look only). */
  person: { name: string; shirt: string; hair: string; skin: string };
}

export const DESKS: readonly Desk[] = [
  { id: "feed", role: "Feed de mercado", job: "Acompanha instrumentos e o feed: origem, horário, atraso e falhas dos dados.",
    person: { name: "Nina", shirt: "#4fd1ff", hair: "#2b1a12", skin: "#e0b08b" } },
  { id: "price", role: "Preço e volume", job: "Lê candles, volume, volatilidade, negócios e livro de ofertas.",
    person: { name: "Caio", shirt: "#ffb347", hair: "#120c08", skin: "#8d5a3b" } },
  { id: "news", role: "Notícias e eventos", job: "Acompanha notícias e o calendário; só pode bloquear ou reduzir entradas.",
    person: { name: "Lia", shirt: "#f28fb1", hair: "#8a4b23", skin: "#f1c6a5" } },
  { id: "strategy", role: "Estratégia", job: "Avalia os sinais de uma estratégia explícita e versionada; pode recusar todos.",
    person: { name: "Theo", shirt: "#7b61ff", hair: "#3b2a1c", skin: "#dba982" } },
  { id: "risk", role: "Risco e posições", job: "Limites, exposição, posições e reconciliação com a corretora; tem veto.",
    person: { name: "Bia", shirt: "#59e3a7", hair: "#0f0a08", skin: "#7a4a32" } },
  { id: "supervisor", role: "Supervisão da mesa", job: "Sessão, pausa e kill switch do DASH; encerra o dia sem operar se for preciso.",
    person: { name: "Rui", shirt: "#e3c28d", hair: "#6b4a2b", skin: "#f0c9a8" } },
];

/** Order states the dashboard always shows apart (an order is never just "done"). */
export const ORDER_STATES = [
  { id: "PROPOSED", label: "Propostas" }, { id: "SENT", label: "Enviadas" }, { id: "ACCEPTED", label: "Aceitas" },
  { id: "REJECTED", label: "Rejeitadas" }, { id: "PARTIAL", label: "Parcialmente executadas" }, { id: "FILLED", label: "Concluídas" },
] as const;

/** What the office knows right now: nothing is connected yet, so everything says so. */
export interface DashStatus {
  mode: "SIMULATED" | "LIVE";
  market: "OPEN" | "CLOSED" | "UNVERIFIED";
  data: "REAL" | "SIMULATED" | "NONE";
  broker: string | null;
  instrument: string | null;
  signals: number;
  orders: Record<(typeof ORDER_STATES)[number]["id"], number>;
}

export const INITIAL_STATUS: DashStatus = {
  mode: "SIMULATED", market: "UNVERIFIED", data: "NONE", broker: null, instrument: null, signals: 0,
  orders: { PROPOSED: 0, SENT: 0, ACCEPTED: 0, REJECTED: 0, PARTIAL: 0, FILLED: 0 },
};

/** A desk works only when its worker is running and the data is trustworthy; otherwise it waits. */
export function deskState(status: DashStatus): "IDLE" | "WATCHING" {
  return status.data === "NONE" ? "IDLE" : "WATCHING";
}

export const MARKET_LABEL: Record<DashStatus["market"], string> = { OPEN: "Aberto", CLOSED: "Fechado", UNVERIFIED: "Não verificado" };
export const DATA_LABEL: Record<DashStatus["data"], string> = { REAL: "Reais", SIMULATED: "Simulados", NONE: "Sem feed" };
