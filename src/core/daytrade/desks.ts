/**
 * The DASH office (Day-trading Analysis & Strategy Hub · Núcleo de Análise e Estratégia de Day
 * Trade): its sectors, who works in each and what each one does, and the states the dashboard must
 * keep apart (owner, 01/11/2026: "não vai ter os consultores, mas terá setores dentro dele: quem
 * analisa risco, quem executa as compras e vendas, o supervisor que anda por aí vendo se todos estão
 * trabalhando, o chefe do setor... cada um terá sua função, que será implementada"). Each desk is a
 * future worker process; its contract (what it reads, what it hands on) is in agents.ts. Nothing here
 * trades: until a feed, an account and the risk guard exist, every desk is idle and every number is
 * empty. Pure; no I/O.
 */
export type SectorId = "chefia" | "supervisao" | "dados" | "noticias" | "estrategia" | "risco" | "execucao" | "registro";
export interface Sector {
  id: SectorId;
  name: string;
  /** What the sector answers for. */
  purpose: string;
  /** Colour of its rug, sign and screens in the office. */
  color: string;
}

export const SECTORS: readonly Sector[] = [
  { id: "chefia", name: "Chefia do setor", purpose: "Abre e encerra a sessão, aprova o plano do dia e preside a sala de análise.", color: "#e3c28d" },
  { id: "supervisao", name: "Supervisão", purpose: "Circula pela mesa, confere se cada setor está trabalhando e com dados válidos; pausa o DASH.", color: "#f2a541" },
  { id: "dados", name: "Dados de mercado", purpose: "Feed, preço, volume e livro de ofertas, com origem, horário e atraso de cada dado.", color: "#4fd1ff" },
  { id: "noticias", name: "Notícias e eventos", purpose: "Notícias e calendário; só pode bloquear ou reduzir entradas, nunca abrir.", color: "#f28fb1" },
  { id: "estrategia", name: "Estratégia", purpose: "Gera sinais de uma estratégia explícita e versionada e valida em backtest.", color: "#7b61ff" },
  { id: "risco", name: "Risco", purpose: "Limites, exposição, margem, posições e reconciliação com a corretora; tem veto.", color: "#59e3a7" },
  { id: "execucao", name: "Execução", purpose: "Envia as compras e vendas aprovadas e acompanha cada ordem até o fim, com stop na corretora.", color: "#ff7a59" },
  { id: "registro", name: "Registro e tributos", purpose: "Registra toda operação, custos e o IR de day trade; nada é escondido ou apagado.", color: "#9db4e8" },
];

export type DeskId = "chief" | "supervisor" | "feed" | "price" | "news" | "strategy" | "backtest" | "risk" | "positions" | "execution" | "orders" | "ledger";
export interface Desk {
  id: DeskId;
  sector: SectorId;
  role: string;
  /** What the desk will do once its worker exists. */
  job: string;
  /** Agent shown at the desk (look only). */
  person: { name: string; shirt: string; hair: string; skin: string };
}

export const DESKS: readonly Desk[] = [
  { id: "chief", sector: "chefia", role: "Chefe do DASH", job: "Aprova o plano do dia, abre e encerra a sessão e dá a palavra final na sala de análise; não envia ordens.",
    person: { name: "Marta", shirt: "#2b2f3a", hair: "#3b2a1c", skin: "#c98f6b" } },
  { id: "supervisor", sector: "supervisao", role: "Supervisor", job: "Anda pela mesa conferindo cada setor (ativo, dados em dia, sem erro); pode pausar o DASH e acionar o kill switch.",
    person: { name: "Rui", shirt: "#e3c28d", hair: "#6b4a2b", skin: "#f0c9a8" } },
  { id: "feed", sector: "dados", role: "Feed de mercado", job: "Acompanha instrumentos e o feed: origem, horário, atraso e falhas dos dados.",
    person: { name: "Nina", shirt: "#4fd1ff", hair: "#2b1a12", skin: "#e0b08b" } },
  { id: "price", sector: "dados", role: "Preço e volume", job: "Lê candles, volume, volatilidade, negócios e livro de ofertas.",
    person: { name: "Caio", shirt: "#ffb347", hair: "#120c08", skin: "#8d5a3b" } },
  { id: "news", sector: "noticias", role: "Notícias e eventos", job: "Acompanha notícias e o calendário; só pode bloquear ou reduzir entradas.",
    person: { name: "Lia", shirt: "#f28fb1", hair: "#8a4b23", skin: "#f1c6a5" } },
  { id: "strategy", sector: "estrategia", role: "Estratégia", job: "Avalia os sinais de uma estratégia explícita e versionada; pode recusar todos.",
    person: { name: "Theo", shirt: "#7b61ff", hair: "#3b2a1c", skin: "#dba982" } },
  { id: "backtest", sector: "estrategia", role: "Validação e backtest", job: "Testa cada versão da estratégia em dados passados e em simulação antes de ela valer.",
    person: { name: "Dani", shirt: "#a48bff", hair: "#1a120c", skin: "#f3d2b3" } },
  { id: "risk", sector: "risco", role: "Limites e veto", job: "Confere cada proposta contra os limites (por operação, diário, exposição, margem); tem veto.",
    person: { name: "Bia", shirt: "#59e3a7", hair: "#0f0a08", skin: "#7a4a32" } },
  { id: "positions", sector: "risco", role: "Posições e reconciliação", job: "Mantém as posições e o saldo conferidos com a corretora; qualquer diferença trava novas ordens.",
    person: { name: "Otto", shirt: "#2fbf8a", hair: "#c9a26b", skin: "#f0c9a8" } },
  { id: "execution", sector: "execucao", role: "Envio de ordens", job: "Envia só ordens aprovadas pelo risco e pela sala de análise, com stop; no modo simulado, nada sai.",
    person: { name: "Léo", shirt: "#ff7a59", hair: "#120c08", skin: "#a86b47" } },
  { id: "orders", sector: "execucao", role: "Acompanhamento de ordens", job: "Segue cada ordem: enviada, aceita, rejeitada, parcial ou concluída; avisa qualquer divergência.",
    person: { name: "Duda", shirt: "#ff9f80", hair: "#5a3a22", skin: "#e8b896" } },
  { id: "ledger", sector: "registro", role: "Registro e tributos", job: "Registra operações, custos e o IR de day trade (DARF); nada é escondido, apagado ou alterado.",
    person: { name: "Vera", shirt: "#9db4e8", hair: "#2b1a12", skin: "#d9a47c" } },
];

export const sectorOf = (desk: Desk) => SECTORS.find((s) => s.id === desk.sector)!;

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
