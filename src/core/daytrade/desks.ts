/**
 * The DASH office (Day-trading Analysis & Strategy Hub · Núcleo de Análise e Estratégia de Day
 * Trade): its sectors, who works in each and what each one does, and the states the dashboard must
 * keep apart (owner, 01/11/2026: "não vai ter os consultores, mas terá setores dentro dele: quem
 * analisa risco, quem executa as compras e vendas, o supervisor que anda por aí vendo se todos estão
 * trabalhando, o chefe do setor... cada um terá sua função, que será implementada"). Each desk is a
 * Pure descriptions and status values for the DASH sectors. The active ProfitDLL route records
 * market research and paper fills; no desk in this module can route a live order.
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
  { id: "chefia", name: "Chefia do setor", purpose: "Revisa propostas e votos na sala de análise; não abre sessão nem envia ordens.", color: "#e3c28d" },
  { id: "supervisao", name: "Supervisão", purpose: "Confere heartbeats e frescor do feed; pausa o DASH em falhas críticas.", color: "#f2a541" },
  { id: "dados", name: "Dados de mercado", purpose: "Confere origem, atraso, integridade e continuidade dos candles; o coletor atual não ingere livro de ofertas.", color: "#4fd1ff" },
  { id: "noticias", name: "Notícias e eventos", purpose: "Notícias e calendário; só pode bloquear ou reduzir entradas, nunca abrir.", color: "#f28fb1" },
  { id: "estrategia", name: "Estratégia", purpose: "Produz observações de uma regra explícita e versionada; backtests continuam apenas pesquisa.", color: "#7b61ff" },
  { id: "risco", name: "Risco", purpose: "Aplica limites e veto; reconciliação com a conta da corretora ainda não está conectada.", color: "#59e3a7" },
  { id: "execucao", name: "Execução", purpose: "Registra fills de simulação; envio de ordens reais está desativado.", color: "#ff7a59" },
  { id: "registro", name: "Registro e tributos", purpose: "Mantém fills paper separados; resume uma estimativa fiscal paper sem emitir DARF ou misturar dados reais.", color: "#9db4e8" },
];

export type DeskId = "chief" | "supervisor" | "feed" | "price" | "news" | "strategy" | "backtest" | "risk" | "positions" | "execution" | "orders" | "ledger";
export interface Desk {
  id: DeskId;
  sector: SectorId;
  role: string;
  /** Current responsibility. If its path is not integrated, the job says so explicitly. */
  job: string;
  /** Agent shown at the desk (look only). */
  person: { name: string; shirt: string; hair: string; skin: string };
}

export const DESKS: readonly Desk[] = [
  { id: "chief", sector: "chefia", role: "Chefe do DASH", job: "Faz a última revisão determinística das propostas e votos; não abre a sessão nem envia ordens.",
    person: { name: "Marta", shirt: "#2b2f3a", hair: "#3b2a1c", skin: "#c98f6b" } },
  { id: "supervisor", sector: "supervisao", role: "Supervisor", job: "Confere heartbeats e frescor do feed; pode pausar o DASH por falha crítica ou falta de feed durante a sessão.",
    person: { name: "Rui", shirt: "#e3c28d", hair: "#6b4a2b", skin: "#f0c9a8" } },
  { id: "feed", sector: "dados", role: "Feed de mercado", job: "Acompanha instrumentos e o feed: origem, horário, atraso e falhas dos dados.",
    person: { name: "Nina", shirt: "#4fd1ff", hair: "#2b1a12", skin: "#e0b08b" } },
  { id: "price", sector: "dados", role: "Candles e integridade do preço", job: "Valida OHLCV, turnover e continuidade de candles M1; o feed ativo não fornece livro de ofertas.",
    person: { name: "Caio", shirt: "#ffb347", hair: "#120c08", skin: "#8d5a3b" } },
  { id: "news", sector: "noticias", role: "Notícias e eventos", job: "Acompanha notícias e o calendário; só pode bloquear ou reduzir entradas.",
    person: { name: "Lia", shirt: "#f28fb1", hair: "#8a4b23", skin: "#f1c6a5" } },
  { id: "strategy", sector: "estrategia", role: "Estratégia", job: "Avalia os sinais de uma estratégia explícita e versionada; pode recusar todos.",
    person: { name: "Theo", shirt: "#7b61ff", hair: "#3b2a1c", skin: "#dba982" } },
  { id: "backtest", sector: "estrategia", role: "Validação e backtest", job: "Compara candidatos walk-forward; todo resultado é exploratório e não aprova estratégia automaticamente.",
    person: { name: "Dani", shirt: "#a48bff", hair: "#1a120c", skin: "#f3d2b3" } },
  { id: "risk", sector: "risco", role: "Limites e veto", job: "Confere cada proposta contra os limites (por operação, diário, exposição, margem); tem veto.",
    person: { name: "Bia", shirt: "#59e3a7", hair: "#0f0a08", skin: "#7a4a32" } },
  { id: "positions", sector: "risco", role: "Posições e reconciliação", job: "Valida snapshots; o fluxo atual confere apenas posições paper e ainda não consulta a corretora.",
    person: { name: "Otto", shirt: "#2fbf8a", hair: "#c9a26b", skin: "#f0c9a8" } },
  { id: "execution", sector: "execucao", role: "Execução simulada", job: "Formata operações paper; nenhuma ordem é enviada à corretora, mesmo se uma proposta passar pelo ciclo.",
    person: { name: "Léo", shirt: "#ff7a59", hair: "#120c08", skin: "#a86b47" } },
  { id: "orders", sector: "execucao", role: "Acompanhamento de ordens", job: "Segue cada ordem: enviada, aceita, rejeitada, parcial ou concluída; avisa qualquer divergência.",
    person: { name: "Duda", shirt: "#ff9f80", hair: "#5a3a22", skin: "#e8b896" } },
  { id: "ledger", sector: "registro", role: "Registro paper e tributos", job: "Cada fill paper e espelhado de forma transacional e append-only em dt_ledger; a API autenticada resume fechamentos paper por mes e alíquotas de referencia sem gerar DARF nem apurar conta real.",
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
  signal: "WATCH_LONG" | "WATCH_SHORT" | null;
  orders: Record<(typeof ORDER_STATES)[number]["id"], number>;
}

export const INITIAL_STATUS: DashStatus = {
  mode: "SIMULATED", market: "UNVERIFIED", data: "NONE", broker: null, instrument: null, signals: 0, signal: null,
  orders: { PROPOSED: 0, SENT: 0, ACCEPTED: 0, REJECTED: 0, PARTIAL: 0, FILLED: 0 },
};

/** A desk works only when its worker is running and the data is trustworthy; otherwise it waits. */
export function deskState(status: DashStatus): "IDLE" | "WATCHING" {
  return status.data === "NONE" ? "IDLE" : "WATCHING";
}

export const MARKET_LABEL: Record<DashStatus["market"], string> = { OPEN: "Aberto", CLOSED: "Fechado", UNVERIFIED: "Não verificado" };
export const DATA_LABEL: Record<DashStatus["data"], string> = { REAL: "Reais", SIMULATED: "Simulados", NONE: "Sem feed" };
