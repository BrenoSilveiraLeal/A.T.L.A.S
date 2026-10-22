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
 * otherwise. The window below fits inside both, with margins after the opening auction
 * and before the closing call, so the guard never depends on the seasonal switch.
 */
export const SAFE_WINDOW = { open: "10:05", close: "16:50" } as const;

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});

export function saoPauloClock(at: Date) {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday, year: Number(p.year) };
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
  const late = year.lateOpen[clock.date];
  const open = late ? addMinutes(late, 5) : SAFE_WINDOW.open;
  if (clock.time < open) return { ...base, status: "CLOSED", reason: `Antes da janela segura (${open}).` };
  if (clock.time >= SAFE_WINDOW.close) return { ...base, status: "CLOSED", reason: `Depois da janela segura (${SAFE_WINDOW.close}).` };
  return { ...base, status: "OPEN", reason: late ? `Abertura tardia (${late}).` : "Dentro da janela segura." };
}

function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
