/** Portuguese labels for recorded codes. The raw code stays available as a tooltip. */
const LABELS: Record<string, string> = {
  IDLE: "Ocioso", ANALYZING: "Analisando", WATCHING_MARKET: "Observando o mercado", READING_NEWS: "Lendo notícias",
  NEWS_REVIEW: "Revisando notícias", PREPARING_ORDER: "Preparando ordem", ORDER_PENDING: "Ordem pendente",
  POSITION_OPEN: "Posição aberta", MONITORING: "Monitorando", MEETING: "Em reunião", PAUSED: "Pausado",
  RISK_BLOCKED: "Bloqueado pelo risco", FIRED: "Demitido", DEAD: "Eliminado",
  OPEN: "Aberta", FILLED: "Executada", PARTIALLY_FILLED: "Parcial", CANCELLED: "Cancelada", REJECTED: "Recusada",
  EXPIRED: "Expirada", PENDING: "Pendente", APPROVED: "Aprovada", SUBMITTED: "Enviada", UNKNOWN: "Indeterminado",
  GREEN: "Saudável", YELLOW: "Atenção", RED: "Falha", STALE: "Desatualizado", DELAYED: "Atrasado",
  HOLD: "Manter", BUY: "Comprar", SELL: "Vender",
};
export function statusLabel(code: string) {
  return LABELS[code] ?? code;
}
