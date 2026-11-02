import { SECTORS, type DeskId } from "@/core/daytrade/desks";

/**
 * The DASH floor plan (owner, 01/11/2026: "reformular o escritório para organizar tudo que vai ter
 * dentro... uma sala para analisar as compras, como no escritório 1, e uma sala de descanso, com
 * cozinha, pebolim e afins, no mesmo estilo de escritório moderno e descolado, estilo Google"). Shared
 * by the office scene (dash-3d) and the floor seen from outside on the map (building-3d), so both
 * show the same room. Floor 48 × 28 m: x from -24 (left) to 24, z from -14 (back) to 14 (front, the
 * elevator side).
 *
 * - Back, behind glass: the chief's office, the analysis room (the trade committee) and the
 *   records room, each with its colour wall.
 * - Middle: the trading floor, one island per sector facing the video wall; the supervisor's
 *   standing desk behind them, and his round of the floor.
 * - Left front: reception by the elevator, with the DASH wall; a small meeting table.
 * - Right: the break area — kitchen with island and stools, foosball, bean bags and sofa, plants.
 */
export interface Box { x: number; z: number; w: number; d: number; h: number; y?: number; color: string; kind?: "glow" | "steel" | "wood" | "fabric" | "plant"; label?: string }

/** The tower's rounded corners (radius in metres): nothing on the floor may stick out of them. */
export const FLOOR_R = 4;
/** How far from the centre (|x|) the floor reaches at depth z, kept `margin` inside the glass. */
export function floorEdge(z: number, margin = 0.15) {
  const into = Math.max(0, Math.abs(z) - (14 - FLOOR_R));
  return 24 - FLOOR_R + Math.sqrt(Math.max(0, FLOOR_R ** 2 - into ** 2)) - margin;
}

/** Warm oak, as the DAWN office's floor. */
export const DASH_FLOOR = "#a8845f";

/** Back rooms: from the back wall to their glass front at ROOM_FRONT, between x0 and x1. */
export const ROOM_FRONT = -5;
export const ROOMS = [
  { id: "chefia", name: "Chefia", x0: -24, x1: -14, color: "#e3c28d", door: -16 },
  { id: "analise", name: "Sala de análise", x0: -14, x1: 2, color: "#7b61ff", door: 0 },
  { id: "registro", name: "Registro e tributos", x0: 2, x1: 10, color: "#9db4e8", door: 8 },
] as const;

/** Where each agent sits (or stands), and which way they face along z (-1: towards the back). */
export const SEATS: Record<DeskId, { x: number; z: number; face: 1 | -1; standing?: boolean }> = {
  chief: { x: -19, z: -11.6, face: 1 },
  ledger: { x: 6, z: -11.6, face: 1 },
  feed: { x: -9, z: 0.95, face: -1 }, price: { x: -7, z: 0.95, face: -1 },
  news: { x: -2.5, z: 0.95, face: -1 },
  strategy: { x: 2, z: 0.95, face: -1 }, backtest: { x: 4, z: 0.95, face: -1 },
  risk: { x: -9, z: 5.95, face: -1 }, positions: { x: -7, z: 5.95, face: -1 },
  execution: { x: 2, z: 5.95, face: -1 }, orders: { x: 4, z: 5.95, face: -1 },
  supervisor: { x: -2.5, z: 10.4, face: -1, standing: true },
};
/** The desk in front of a seat. */
export const deskAt = (id: DeskId) => { const s = SEATS[id]; return { x: s.x, z: s.z + s.face * 0.95 }; };

/** Sector islands on the trading floor: a rug and a hanging sign over each. */
export const ISLANDS = [
  { sector: "dados", x: -8, z: 0.5, w: 5.2 }, { sector: "noticias", x: -2.5, z: 0.5, w: 3 }, { sector: "estrategia", x: 3, z: 0.5, w: 5.2 },
  { sector: "risco", x: -8, z: 5.5, w: 5.2 }, { sector: "execucao", x: 3, z: 5.5, w: 5.2 },
] as const;

/**
 * Each sector apart, as the council rooms are apart in the DAWN office (owner, 01/11/2026: "setores
 * separados"): a low partition in the sector's colour behind its island and on both sides, open
 * towards the video wall.
 */
export const PARTITIONS: Box[] = ISLANDS.flatMap((island) => {
  const color = SECTORS.find((s) => s.id === island.sector)!.color, z0 = island.z - 1.5, z1 = island.z + 2.2;
  return [
    { x: island.x, z: z1, w: island.w + 0.2, d: 0.08, h: 1.2, color },
    { x: island.x - island.w / 2 - 0.1, z: (z0 + z1) / 2, w: 0.08, d: z1 - z0, h: 1.2, color },
    { x: island.x + island.w / 2 + 0.1, z: (z0 + z1) / 2, w: 0.08, d: z1 - z0, h: 1.2, color },
  ];
});

/** Where the receptionist sits, behind the reception desk, facing the elevator. */
export const RECEPTION = { x: -20.5, z: 8.3 };

/** Framed posters: x, y, z, facing (rotation about y), title, subtitle, background, accent. */
export const POSTERS: [number, number, number, number, string, string, string, string][] = [
  [23.85, 1.9, -1.2, -Math.PI / 2, "Não operar também é resultado", "Regras da mesa", "#1d3557", "#f2a541"],
  [23.85, 1.9, 1.6, -Math.PI / 2, "Stop sempre na corretora", "Risco", "#24504c", "#59e3a7"],
  [-23.85, 1.9, 1.3, Math.PI / 2, "Dado sem origem não entra", "Dados de mercado", "#2f3b52", "#4fd1ff"],
];

/** The video wall, on the analysis room's glass, facing the trading floor. */
export const VIDEO_WALL = { x: -6, z: ROOM_FRONT + 0.35, w: 9, h: 2.5, y: 0.65 };

/** The supervisor's round: past every island, stopping now and then to check. */
export const PATROL: [number, number][] = [[-12, -2.6], [6.6, -2.6], [6.6, 3.2], [-12, 3.2], [-12, 8.2], [6.6, 8.2], [6.6, -2.6]];

/** Furniture, as boxes (y = bottom). */
export const FURNITURE: Box[] = [
  // Analysis room: the long committee table and its screen on the back wall.
  { x: -6, z: -9.5, w: 8, d: 2.1, h: 0.08, y: 0.74, color: "#b98a5a", kind: "wood" },
  { x: -6, z: -13.75, w: 6, d: 0.08, h: 2.2, y: 0.8, color: "#7b61ff", kind: "glow", label: "analise" },
  // Chief's and records' screens on their back walls.
  { x: -19, z: -13.75, w: 3.2, d: 0.08, h: 1.5, y: 1.1, color: "#e3c28d", kind: "glow", label: "chefia" },
  { x: 6, z: -13.75, w: 3, d: 0.08, h: 1.5, y: 1.1, color: "#9db4e8", kind: "glow", label: "registro" },
  // Break area: kitchen along the back wall, fridge, coffee, island with stools.
  { x: 16.4, z: -13.25, w: 9.8, d: 0.9, h: 0.95, color: "#f4f6f8" },
  { x: 16.4, z: -13.25, w: 9.9, d: 0.95, h: 0.06, y: 0.95, color: "#b98a5a", kind: "wood" },
  { x: 16.4, z: -13.55, w: 9.8, d: 0.35, h: 0.8, y: 1.9, color: "#ff7a59" },
  { x: 23.05, z: -10.6, w: 1, d: 1, h: 2.1, color: "#c9cdd2", kind: "steel" },
  { x: 13.4, z: -13.2, w: 0.5, d: 0.45, h: 0.5, y: 1.01, color: "#2b2e34" },
  { x: 17.5, z: -9.4, w: 4.6, d: 1.4, h: 1.0, color: "#ffd166" },
  { x: 17.5, z: -9.4, w: 4.8, d: 1.6, h: 0.06, y: 1.0, color: "#b98a5a", kind: "wood" },
  // Foosball table (the field is drawn on top by the scene).
  { x: 16.5, z: -3.6, w: 1.5, d: 0.8, h: 0.82, color: "#3d5a80" },
  { x: 16.5, z: -3.6, w: 1.4, d: 0.7, h: 0.04, y: 0.82, color: "#2f8f5a" },
  // Lounge: L sofa, coffee table, bean bags (as fabric boxes, rounded by the scene).
  { x: 21, z: 11.6, w: 3.6, d: 1.1, h: 0.5, color: "#ff7a59", kind: "fabric" },
  { x: 21, z: 12.05, w: 3.6, d: 0.3, h: 1.0, color: "#ff7a59", kind: "fabric" },
  { x: 23, z: 9.5, w: 1.1, d: 3, h: 0.5, color: "#ff7a59", kind: "fabric" },
  { x: 19.5, z: 9.4, w: 1.6, d: 1, h: 0.42, color: "#b98a5a", kind: "wood" },
  { x: 14.6, z: 10.2, w: 1.2, d: 1.2, h: 0.6, color: "#ef476f", kind: "fabric" },
  { x: 16.2, z: 11.8, w: 1.2, d: 1.2, h: 0.6, color: "#ffd166", kind: "fabric" },
  { x: 14, z: 7.6, w: 1.2, d: 1.2, h: 0.6, color: "#118ab2", kind: "fabric" },
  // Green divider between the trading floor and the break area.
  { x: 10.9, z: 3, w: 0.7, d: 9, h: 0.9, color: "#f4f6f8" },
  { x: 10.9, z: 3, w: 0.6, d: 8.8, h: 0.35, y: 0.9, color: "#4f9a45", kind: "plant" },
  // Ping-pong beside the foosball, and the lounge TV facing the sofa.
  { x: 20.6, z: -3.6, w: 2.7, d: 1.5, h: 0.76, color: "#1f6f8b" },
  { x: 20.6, z: -3.6, w: 0.04, d: 1.6, h: 0.15, y: 0.76, color: "#f4f6f8" },
  { x: 20.5, z: 7.3, w: 3.4, d: 0.45, h: 0.6, color: "#2b2e34" },
  { x: 20.5, z: 7.35, w: 3.0, d: 0.06, h: 1.7, y: 0.75, color: "#ff7a59", kind: "glow", label: "tv" },
  // Waiting sofa by the reception, its coffee table; a low bookshelf by the small meeting table.
  { x: -15.6, z: 12.4, w: 3.6, d: 0.9, h: 0.45, color: "#3d5a80", kind: "fabric" },
  { x: -15.6, z: 12.75, w: 3.6, d: 0.25, h: 0.95, color: "#3d5a80", kind: "fabric" },
  { x: -15.6, z: 11.2, w: 1.3, d: 0.7, h: 0.4, color: "#b98a5a", kind: "wood" },
  { x: -14.9, z: -1.6, w: 0.45, d: 3, h: 1.4, color: "#b98a5a", kind: "wood", label: "books" },
  // Supervisor's standing desk.
  { x: -2.5, z: 9.5, w: 1.6, d: 0.7, h: 0.06, y: 1.08, color: "#e9e4dc" },
  // Reception by the elevator, the DASH wall, a waiting bench and a small meeting table.
  { x: -20.5, z: 9.2, w: 3.2, d: 0.8, h: 1.05, color: "#f4f6f8" },
  { x: -20.5, z: 9.2, w: 3.4, d: 0.95, h: 0.06, y: 1.05, color: "#b98a5a", kind: "wood" },
  { x: -23.75, z: 6.5, w: 0.15, d: 6, h: 2.8, color: "#e3c28d" },
  { x: -21, z: 3.2, w: 3.4, d: 0.9, h: 0.45, color: "#3d5a80", kind: "fabric" },
  { x: -18.5, z: -1.5, w: 1.6, d: 1.6, h: 0.06, y: 0.74, color: "#f4f6f8" },
];

/** Floor rugs: under the islands (in the sector's colour), the break area and the lounge. */
export const RUGS: Box[] = [
  { x: 17, z: -6.9, w: 11, d: 11.8, h: 0.02, color: "#e9d8b4" },
  { x: 18, z: 9.75, w: 9, d: 6, h: 0.02, color: "#ffe1a8" },
  { x: -19, z: 6, w: 9, d: 9, h: 0.02, color: "#3a4256" },
];

/** Big plants in pots: x, z. */
export const PLANTS: [number, number][] = [[-23, -3.8], [-13.4, -3.8], [9.6, -3.8], [9.6, 12.8], [-13, 12.8], [12.2, -12.6], [23.2, 5.4], [12.2, 13], [-22.4, 11.2]];
