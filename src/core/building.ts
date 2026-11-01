/**
 * The ATLAS tower (owner, 01/11/2026: ATLAS is now the company and the building; each office is a
 * floor of one tower in a city, chosen in the building view). Pure: the tower's measures, the
 * offices on its floors and the window bays. The building view and the office scene both read these,
 * so the windows seen from the street match the ones inside the office. No three.js.
 */

/** Measures in metres, the same units as the office scene (its floor is 48 × 28, walls 3.4 high). */
export const TOWER = {
  width: 48, depth: 28,
  /** Ground floor (lobby) height and the height of every floor above it, slab included. */
  lobby: 6, storey: 3.8,
  /** Wall height inside an office, from its floor to the ceiling. */
  ceiling: 3.4,
  floors: 18,
  /** Window bay: width, sill and head heights (from the office floor). */
  bay: 3, sill: 0.85, head: 2.75,
} as const;

/**
 * The elevator (owner, 01/11/2026: "trocar a porta por um elevador, já que vai ser um prédio"): its
 * doors sit where the office's entrance door was (front wall, x -21.5 to -17) and its shaft runs up the
 * front of the tower, outside that wall. Centre x, width along the wall, depth out of the façade.
 */
export const ELEVATOR = { x: -19.25, width: 4.5, depth: 3.2 } as const;

/** Height of a floor above the street (floor 0 is the lobby at street level). */
export const floorLevel = (floor: number) => (floor <= 0 ? 0 : TOWER.lobby + (floor - 1) * TOWER.storey);

export type OfficeStatus = "ACTIVE" | "BUILDING" | "LOCKED";
export interface Office {
  /** Stable internal id; the display name may change, the id does not. */
  id: string;
  name: string;
  /** What the acronym stands for and its Portuguese description, when the office has one. */
  fullName?: string;
  tagline?: string;
  floor: number;
  status: OfficeStatus;
  /** Where "Entrar" goes; null while the office cannot be entered. */
  href: string | null;
  summary: string;
  color: string;
}

/** The three selectable offices, grouped in the middle of the tower. */
export const OFFICES: readonly Office[] = [
  { id: "dividendos", name: "Escritório de Dividendos", floor: 8, status: "ACTIVE", href: "/app", color: "#a3cdb5",
    summary: "Ações da B3 para longo prazo e dividendos. A equipe de IAs que já trabalha com a Genial." },
  // Names chosen by the owner, 01/11/2026. The current office's own name is still to be chosen.
  { id: "dash", name: "DASH", fullName: "Day-trading Analysis & Strategy Hub", tagline: "Núcleo de Análise e Estratégia de Day Trade",
    floor: 9, status: "BUILDING", href: "/daytrade", color: "#e3c28d",
    summary: "Day trade. Aberto em modo simulado, com contas e limites próprios; ainda não envia ordens." },
  { id: "coin", name: "COIN", fullName: "Crypto Operations & Intelligence Network", tagline: "Rede de Inteligência e Operações com Criptoativos",
    floor: 10, status: "LOCKED", href: null, color: "#9db4e8",
    summary: "Criptoativos. Bloqueado: previsto para uma etapa futura." },
];

/** BUILDING: still being built, but it opens, in simulated mode (owner, 01/11/2026: "ainda não dá pra entrar no DASH"). */
export const STATUS_LABEL: Record<OfficeStatus, string> = { ACTIVE: "Ativo", BUILDING: "Simulado · entrar", LOCKED: "Bloqueado" };

export const officeOnFloor = (floor: number) => OFFICES.find((o) => o.floor === floor) ?? null;
export const officeById = (id: string) => OFFICES.find((o) => o.id === id) ?? null;

/** "?andar=8" → 8 when it is a selectable floor, else null. */
export function parseFloor(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,2}$/.test(value)) return null;
  return officeOnFloor(Number(value)) ? Number(value) : null;
}

export interface Bay { from: number; to: number; glass: boolean }

/**
 * Pieces of an office's outside wall of `length` (centred on 0): glass by default, with the
 * tower's bays, and solid only right behind what hangs on the wall or stands against it (`blocked`,
 * padded by `pad`), like a pier between windows. Glass narrower than `minGlass` is filled in.
 * Mullions go at every bay edge and at the edges of the solid pieces.
 */
export function wallSegments(length: number, blocked: readonly (readonly [number, number])[] = [], bay: number = TOWER.bay, pad = 0.1, minGlass = 0.5): Bay[] {
  const half = length / 2;
  const solid = blocked.map(([a, b]) => [Math.max(-half, Math.min(a, b) - pad), Math.min(half, Math.max(a, b) + pad)] as [number, number])
    .filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0])
    .reduce<[number, number][]>((out, [a, b]) => { const last = out.at(-1); if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); return out; }, []);
  const out: Bay[] = [];
  const push = (from: number, to: number, glass: boolean) => {
    if (to - from <= 1e-6) return;
    const last = out.at(-1);
    if (last && last.glass === glass && !glass) last.to = to; else out.push({ from, to, glass });
  };
  for (const b of windowBays(length, [], bay)) {
    let at = b.from;
    for (const [a, z] of solid) {
      if (z <= at || a >= b.to) continue;
      push(at, Math.max(at, a), true); push(Math.max(at, a), Math.min(z, b.to), false); at = Math.min(z, b.to);
    }
    push(at, b.to, true);
  }
  // Slivers of glass are not worth a window: fill them with wall.
  for (const s of out) if (s.glass && s.to - s.from < minGlass) s.glass = false;
  return out.reduce<Bay[]>((merged, s) => { const last = merged.at(-1); if (last && !last.glass && !s.glass) last.to = s.to; else merged.push({ ...s }); return merged; }, []);
}

/**
 * Splits a wall of `length` (centred on 0) into bays of about `TOWER.bay` and opens each one as a
 * window unless something hangs on or stands against the wall there (`blocked`, ranges along the
 * wall in the same coordinates). A blocked bay stays solid wall.
 */
export function windowBays(length: number, blocked: readonly (readonly [number, number])[] = [], bay: number = TOWER.bay, margin = 0.15): Bay[] {
  if (!(length > 0) || !(bay > 0)) return [];
  const count = Math.max(1, Math.round(length / bay)), width = length / count;
  return Array.from({ length: count }, (_, i) => {
    const from = -length / 2 + i * width, to = from + width;
    const glass = !blocked.some(([a, b]) => Math.min(a, b) < to + margin && Math.max(a, b) > from - margin);
    return { from, to, glass };
  });
}
