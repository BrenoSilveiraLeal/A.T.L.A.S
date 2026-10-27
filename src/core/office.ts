/**
 * Where each agent stands in the office, from real recorded signals only:
 * - MEETING: analysing right now, just analysed, or discussing a fresh headline about its stock;
 * - DESK: the whole working day (owner, 27/10/2026: from 09:45, before the open, until the close
 *   every agent sits at its computer), now and then a short walk around the office;
 * - COFFEE / POOL: resting (after the close, or switched off);
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
  /** Trading day between 09:45 and the close (defaults to marketOpen). */
  workTime?: boolean;
  now: number;
}

/** During the working day each agent takes a 3-minute walk every 40 minutes, at its own time. */
export const BREAK = { every: 40, minutes: 3 } as const;
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const onBreak = (id: string, now: number) => (Math.floor(now / 60000) + hash(id)) % BREAK.every < BREAK.minutes;

const rest = (id: string): OfficeZone => (hash(id) % 2 ? "POOL" : "COFFEE");

export function placeAgent(a: OfficeInput): { zone: OfficeZone; activity: string } {
  if (a.status === "DEAD" || a.status === "FIRED") return { zone: "OUT", activity: "Foi eliminada: perdeu o limite de dinheiro que podia perder." };
  const justAnalysed = a.lastAnalysisAt !== null && a.now - Date.parse(a.lastAnalysisAt) < 3 * 60000;
  if (a.status === "ANALYZING" || justAnalysed) return { zone: "MEETING", activity: "Na reunião: analisando o gráfico e as notícias." };
  if (a.openOrder) return { zone: "DESK", activity: a.openOrder.side === "BUY"
    ? "No computador: fez um pedido de compra e espera o preço chegar." : "No computador: fez um pedido de venda e espera o preço chegar." };
  if (!a.enabled || !a.autopilot || a.status === "PAUSED") return { zone: rest(a.id), activity: "De folga: o piloto automático dela está desligado." };
  if (a.freshNews) return { zone: "MEETING", activity: "Na reunião: discutindo uma notícia sobre a ação dela." };
  if (a.workTime ?? a.marketOpen) {
    if (onBreak(a.id, a.now)) return { zone: rest(a.id), activity: "Pausa rápida: dando uma volta pelo escritório e já volta ao computador." };
    return { zone: "DESK", activity: a.holding > 0 ? `No computador: vigiando as ${a.holding} ações que comprou.`
      : a.marketOpen ? "No computador: acompanhando o gráfico e esperando o momento certo de comprar." : "No computador: preparando-se para a abertura da bolsa." };
  }
  return { zone: rest(a.id), activity: a.holding > 0
    ? `Bolsa fechada: descansando e guardando ${a.holding} ações até o próximo pregão.` : "Bolsa fechada: descansando até o próximo pregão." };
}
