import marketHours from "../../config/b3-market-hours.json";
/**
 * B3 cash-equity session guard. Conservative by design: it answers "may an automated
 * order be considered now?", not "is B3 technically open".
 *
 * Official 2026 calendar (B3, published 2026-01-09). The 2027 list is computed from the
 * national holidays and Easter and stays PROVISIONAL until B3 publishes it. Years not
 * listed return UNKNOWN, which callers must treat as closed.
 */
export type SessionStatus = "OPEN" | "CLOSED" | "UNKNOWN";

interface YearCalendar {
  official: boolean;
  closed: Record<string, string>;
  /** Days with a late open (Ash Wednesday), as "HH:MM" São Paulo time. */
  lateOpen: Record<string, string>;
}

export const B3_CALENDAR: Record<number, YearCalendar> = {
  2026: {
    official: true,
    closed: {
      "2026-01-01": "Confraternização Universal", "2026-02-16": "Carnaval", "2026-02-17": "Carnaval",
      "2026-04-03": "Sexta-feira Santa", "2026-04-21": "Tiradentes", "2026-05-01": "Dia do Trabalho",
      "2026-06-04": "Corpus Christi", "2026-09-07": "Independência", "2026-10-12": "Nossa Senhora Aparecida",
      "2026-11-02": "Finados", "2026-11-20": "Consciência Negra", "2026-12-24": "Véspera de Natal",
      "2026-12-25": "Natal", "2026-12-31": "Último dia do ano",
    },
    lateOpen: { "2026-02-18": "13:00" },
  },
  2027: {
    official: false,
    closed: {
      "2027-01-01": "Confraternização Universal", "2027-02-08": "Carnaval", "2027-02-09": "Carnaval",
      "2027-03-26": "Sexta-feira Santa", "2027-04-21": "Tiradentes", "2027-05-27": "Corpus Christi",
      "2027-09-07": "Independência", "2027-10-12": "Nossa Senhora Aparecida", "2027-11-02": "Finados",
      "2027-11-15": "Proclamação da República", "2027-12-24": "Véspera de Natal", "2027-12-31": "Último dia do ano",
    },
    lateOpen: { "2027-02-10": "13:00" },
  },
};

/**
 * Regular session is 10:00–16:55 while US daylight saving is in force and 10:00–17:55
 * otherwise (closing call until 17:00 / 18:00). SAFE_WINDOW fits inside both; the window in use
 * follows B3's official grid (config/b3-market-hours.json, Ofício Circular 055/2026-VNC) with the
 * same margins, and falls back to SAFE_WINDOW once past the last date the grid is known for.
 * 03/11/2026: the fixed 16:50 stopped purchases 65 minutes before the real end of the session.
 */
export const SAFE_WINDOW = { open: "10:05", close: "16:50" } as const;
const equities = marketHours.equities as { defaultCallStart: string; regularCloseChanges: { effectiveDate: string; callStart: string }[]; knownUntil: string };

/** When the closing call starts on that date (São Paulo), from the official grid; null when not known. */
export function closingCall(date: string): string | null {
  if (date > equities.knownUntil) return null;
  let call = equities.defaultCallStart;
  for (const change of equities.regularCloseChanges) if (date >= change.effectiveDate) call = change.callStart;
  return call;
}
/** The end of the session (closing call included): 17:00 or 18:00; the conservative 17:00 when not known. */
export const sessionEnd = (date: string) => addMinutes(closingCall(date) ?? "16:55", 5);
/** The safe trading window of that date: 5 minutes after the open, 5 minutes before the closing call. */
export function safeWindow(date: string) {
  const call = closingCall(date);
  return { open: SAFE_WINDOW.open, close: call ? addMinutes(call, -5) : SAFE_WINDOW.close };
}

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});

export function saoPauloClock(at: Date) {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday, year: Number(p.year) };
}

/**
 * A B3 trading day in São Paulo: a weekday that is not a listed holiday (years not listed count
 * weekdays only). For the offices' people, who stay home when the exchange is closed; never for orders.
 */
export function tradingDay(at: Date) {
  const clock = saoPauloClock(at);
  return clock.weekday !== "Sat" && clock.weekday !== "Sun" && !B3_CALENDAR[clock.year]?.closed[clock.date];
}

export function b3Session(at: Date): { status: SessionStatus; reason: string; date: string; provisional: boolean } {
  if (Number.isNaN(at.getTime())) return { status: "UNKNOWN", reason: "Horário inválido.", date: "", provisional: false };
  const clock = saoPauloClock(at);
  const year = B3_CALENDAR[clock.year];
  if (!year) return { status: "UNKNOWN", reason: `Calendário B3 de ${clock.year} não cadastrado.`, date: clock.date, provisional: false };
  const base = { date: clock.date, provisional: !year.official };
  if (clock.weekday === "Sat" || clock.weekday === "Sun") return { ...base, status: "CLOSED", reason: "Fim de semana." };
  const holiday = year.closed[clock.date];
  if (holiday) return { ...base, status: "CLOSED", reason: `Sem pregão: ${holiday}.` };
  const late = year.lateOpen[clock.date], window = safeWindow(clock.date);
  const open = late ? addMinutes(late, 5) : window.open;
  if (clock.time < open) return { ...base, status: "CLOSED", reason: `Antes da janela segura (${open}).` };
  if (clock.time >= window.close) return { ...base, status: "CLOSED", reason: `Depois da janela segura (${window.close}).` };
  return { ...base, status: "OPEN", reason: late ? `Abertura tardia (${late}).` : "Dentro da janela segura." };
}

export function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
