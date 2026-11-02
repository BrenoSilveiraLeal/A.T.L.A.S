import { B3_CALENDAR, saoPauloClock } from "@/core/b3-calendar";
import type { DashConfig } from "@/core/daytrade/config";

export type DayTradeSessionState = "OPEN" | "CLOSED" | "UNVERIFIED";

export interface DayTradeSession {
  day: string;
  state: DayTradeSessionState;
  paperAllowed: boolean;
  open: string;
  close: string;
  reason: string;
}

/**
 * Session guard for the WIN futures research strategy. B3 Circular 055/2026-VNC lists 09:00-18:25
 * from 2026-11-03, with the expiring contract ending at 18:00; earlier hours are 09:00-18:00.
 * The strategy is specifically built around a 09:00 opening range. Unknown/provisional calendars
 * and special late-open sessions never arm paper entries.
 * Source: https://www.b3.com.br/data/files/BE/16/C1/59/2F881A10F75B881AAC094EA8/OC%20055-2026-VNC%20NOVOS%20HORARIOS%20DE%20NEGOCIACAO_PT.pdf
 */
export function dayTradeSession(at: Date, config: DashConfig, expiresOn = config.instruments.find((instrument) => instrument.enabled)?.expiresOn ?? null): DayTradeSession {
  if (Number.isNaN(at.getTime())) return { day: "", state: "UNVERIFIED", paperAllowed: false, open: "09:00", close: "18:25", reason: "Timestamp de mercado invalido." };
  const clock = saoPauloClock(at);
  const expiresToday = expiresOn === clock.date;
  const close = clock.date < "2026-11-03" || expiresToday ? "18:00" : "18:25";
  const base = { day: clock.date, open: "09:00", close };
  if (clock.weekday === "Sat" || clock.weekday === "Sun") return { ...base, state: "CLOSED", paperAllowed: false, reason: "Fim de semana." };
  const calendar = B3_CALENDAR[clock.year];
  if (calendar?.closed[clock.date]) return { ...base, state: "CLOSED", paperAllowed: false, reason: `Sem pregao B3: ${calendar.closed[clock.date]}.` };
  if (!calendar?.official) return { ...base, state: "UNVERIFIED", paperAllowed: false, reason: `Calendario oficial B3 de ${clock.year} indisponivel.` };

  const lateOpen = calendar.lateOpen[clock.date];
  const sessionOpen = lateOpen ?? base.open;
  if (clock.time < sessionOpen || clock.time >= base.close)
    return { ...base, state: "CLOSED", paperAllowed: false, reason: clock.time < sessionOpen ? `Antes da abertura WIN (${sessionOpen}).` : `Pregao WIN encerrado as ${base.close}.` };
  if (lateOpen) return { ...base, state: "OPEN", paperAllowed: false, reason: "Pregao especial com abertura tardia; estrategia de abertura das 09:00 desabilitada." };
  if (!config.session.verified || config.session.open !== base.open || !config.session.lastEntry || !config.session.flatBy || config.session.flatBy >= base.close || config.session.lastEntry >= config.session.flatBy)
    return { ...base, state: "UNVERIFIED", paperAllowed: false, reason: "Horarios de entrada e zeragem ainda nao foram conferidos." };
  return { ...base, state: "OPEN", paperAllowed: true, reason: "Sessao WIN dentro do horario oficial e configuracao conferida." };
}
