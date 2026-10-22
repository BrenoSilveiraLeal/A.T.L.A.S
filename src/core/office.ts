/**
 * Where each agent stands in the office, from real recorded signals only:
 * - MEETING: analysing right now, just analysed, or discussing a fresh headline about its stock;
 * - DESK: an open order, or the market is open and it holds shares to watch;
 * - COFFEE / POOL: resting (market closed, nothing to do, or switched off);
 * - OUT: eliminated by the loss limit.
 * The sentence is written for someone who has never traded.
 */
export type OfficeZone = "DESK" | "MEETING" | "COFFEE" | "POOL" | "OUT";
export interface OfficeInput {
  id: string;
  status: string;
  enabled: boolean;
  autopilot: boolean;
  holding: number;
  openOrder: { side: "BUY" | "SELL" } | null;
  lastAnalysisAt: string | null;
  freshNews: boolean;
  marketOpen: boolean;
  now: number;
}

const rest = (id: string): OfficeZone => ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 2 ? "POOL" : "COFFEE");

export function placeAgent(a: OfficeInput): { zone: OfficeZone; activity: string } {
  if (a.status === "DEAD" || a.status === "FIRED") return { zone: "OUT", activity: "Foi eliminada: perdeu o limite de dinheiro que podia perder." };
  const justAnalysed = a.lastAnalysisAt !== null && a.now - Date.parse(a.lastAnalysisAt) < 3 * 60000;
  if (a.status === "ANALYZING" || justAnalysed) return { zone: "MEETING", activity: "Na reunião: analisando o gráfico e as notícias." };
  if (a.openOrder) return { zone: "DESK", activity: a.openOrder.side === "BUY"
    ? "No computador: fez um pedido de compra e espera o preço chegar." : "No computador: fez um pedido de venda e espera o preço chegar." };
  if (!a.enabled || !a.autopilot || a.status === "PAUSED") return { zone: rest(a.id), activity: "De folga: o piloto automático dela está desligado." };
  if (a.freshNews) return { zone: "MEETING", activity: "Na reunião: discutindo uma notícia sobre a ação dela." };
  if (a.marketOpen && a.holding > 0) return { zone: "DESK", activity: `No computador: vigiando as ${a.holding} ações que comprou.` };
  if (a.marketOpen) return { zone: rest(a.id), activity: "Descansando: esperando um bom sinal para comprar." };
  return { zone: rest(a.id), activity: a.holding > 0
    ? `Bolsa fechada: descansando e guardando ${a.holding} ações até o próximo pregão.` : "Bolsa fechada: descansando até o próximo pregão." };
}
