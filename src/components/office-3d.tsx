"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OfficeZone } from "@/core/office";
import type { Vote } from "@/core/committee";
import { lookFor, type PersonLook } from "@/core/people";
import { companyProfile } from "@/core/context";
import { OfficeMap, type OfficeAgent, type AgentChart } from "./office-map";

/**
 * 3D office in the style of a modern tech office. Every agent is a person (look from
 * core/people) labelled with name, stock, company, holding and today's trend.
 * - Work: one desk per agent with the real candles of its stock and the price now.
 * - Three council rooms with three specialists each (Risco orange, Balanço blue, Estratégia
 *   green): an analysing agent walks in and the room shows the debate and the chart.
 * - The boss's office: the boss keeps the money and passes it to the agents; the wall shows the
 *   money at Genial and what each agent received.
 * - A supervisor walks the floor checking the desks and calls whoever has to go back to work.
 * - Rest: the kitchen (coffee and chat around high tables) and the TV lounge (news TV).
 * - When an agent goes back to work its computer beeps and flashes and it walks to the desk.
 * Walls work like The Sims "cutaway". Falls back to the 2D map without WebGL.
 */
type V2 = [number, number];
type Pose = "sit" | "stand" | "type" | "talk" | "chat" | "watch" | "cue" | "look";
interface Slot { pos: V2; face: number; pose: Pose; route: V2[] }
interface Person {
  group: THREE.Group; rig: THREE.Group; head: THREE.Group; hips: THREE.Group[]; knees: THREE.Group[];
  shoulders: THREE.Group[]; elbows: THREE.Group[]; mug: THREE.Group; cue: THREE.Group;
}
interface Walker extends Person {
  label: CSS2DObject; labelEl: HTMLDivElement; bubble: CSS2DObject; bubbleEl: HTMLDivElement;
  path: V2[]; slot: Slot | null; key: string; phase: number; zone: OfficeZone | null;
  /** While resting: the current activity, its spot and how long until the next one. */
  rest: { activity: RestActivity; spot: number; timer: number } | null;
}
type Money = { deposited: number; free: number } | null;
type RestActivity = "KITCHEN" | "TV" | "MARKET" | "POOL" | "STROLL";

const S = 1.25; // people are drawn a little larger than life so they read well from above
const SEAT_Y = 0.6;
const CORRIDOR_Z = -5;
const REST_ZONES: OfficeZone[] = ["COFFEE", "POOL", "OUT"];
const DESKS: V2[] = [[-11, -1.6], [-5.5, -1.6], [0, -1.6], [-11, 3.4], [-5.5, 3.4], [0, 3.4]];
const COUNCILS = [[-24, -16], [-16, -8], [-8, 0]].map(([x1, x2]) => ({ x1, x2, table: [(x1 + x2) / 2, -10.4] as V2, door: x2 - 1.4 }));
const SPECIALIST_SHIRTS = ["#f28c28", "#2f6fd6", "#22a06b", "#9b6bff"]; // Risco, Balanço, Estratégia, Previsão
const KITCHEN_TABLES: V2[] = [[12.6, -9.6], [19.2, -9.6]];
const TV_SEATS: [V2, number][] = [[[-6.1, 10.6], Math.PI], [[-3.9, 10.6], Math.PI], [[0.1, 10.6], Math.PI], [[2.3, 10.6], Math.PI],
  [[-8.6, 9.4], Math.PI * 0.78], [[4.8, 9.4], -Math.PI * 0.78]];
const VOTE_LABEL: Record<Vote, string> = { A_FAVOR: "a favor", CONTRA: "contra", NEUTRO: "neutro" };
const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${brl(Math.abs(v))}`);
const tone = (v: number | null) => (v === null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "gain" : "loss");

/**
 * Seats of a council room: 0–3 the specialists side by side on the far side (Risco, Balanço,
 * Estratégia, Previsão), 4 the single chair of the agent who comes to ask, 5–6 standing spots
 * behind it for a rare second visitor.
 */
function councilSeat(room: number, seat: number): { pos: V2; face: number } {
  const [tx, tz] = COUNCILS[room].table;
  if (seat <= 3) return { pos: [tx + [-1.6, -0.55, 0.55, 1.6][seat], tz - 1.35], face: 0 };
  if (seat === 4) return { pos: [tx, tz + 1.35], face: Math.PI };
  return { pos: [tx + (seat === 5 ? -1.5 : 1.5), tz + 2.3], face: Math.PI };
}

function slotFor(zone: OfficeZone, index: number, desk: number): Slot {
  if (zone === "DESK") {
    const [x, z] = DESKS[desk % DESKS.length];
    return { pos: [x, z + 1.05], face: Math.PI, pose: "type", route: [[x + 2.75, CORRIDOR_Z], [x + 2.75, z + 1.9], [x, z + 1.9]] };
  }
  if (zone === "MEETING") {
    const room = index % 3, extra = Math.floor(index / 3) % 3, { pos, face } = councilSeat(room, 4 + extra);
    const door = COUNCILS[room].door;
    return { pos, face, pose: extra ? "stand" : "talk", route: [[door, CORRIDOR_Z], [door, -7.2], [pos[0], -8.0]] };
  }
  if (zone === "POOL") {
    // TV lounge: sofas facing the news TV.
    const [[x, z], face] = TV_SEATS[index % TV_SEATS.length];
    return { pos: [x, z], face, pose: "watch", route: [[-13.4, CORRIDOR_Z], [-13.4, 8.6], [x, 8.6]] };
  }
  // Kitchen: standing around the high tables with a coffee, chatting.
  const [tx, tz] = KITCHEN_TABLES[Math.floor(index / 4) % KITCHEN_TABLES.length];
  const angle = (index % 4) * (Math.PI / 2) + Math.PI / 4;
  const pos: V2 = [tx + Math.sin(angle) * 0.95, tz + Math.cos(angle) * 0.95];
  return { pos, face: Math.atan2(tx - pos[0], tz - pos[1]), pose: "chat", route: [[15.9, CORRIDOR_Z], [15.9, -7.2], [pos[0], -7.6]] };
}

/**
 * Rest activities (owner, 25/10/2026: while resting they move around: coffee and chat in the
 * kitchen, TV, a look at the market panel, a game of pool, a stroll, instead of standing still).
 */
const REST_SPOTS: Record<RestActivity, number> = { KITCHEN: 8, TV: 6, MARKET: 4, POOL: 4, STROLL: 4 };
const REST_SAYS: Partial<Record<RestActivity, string[]>> = {
  MARKET: ["Deixa eu ver o painel...", "Olhando como está o mercado."], POOL: ["Sua vez!", "Essa foi boa!"], STROLL: ["Bom dia!", "Vou dar uma volta."],
};
function restSlot(activity: RestActivity, spot: number): Slot {
  if (activity === "KITCHEN") return slotFor("COFFEE", spot, 0);
  if (activity === "TV") return slotFor("POOL", spot, 0);
  if (activity === "MARKET") {
    const x = 13.8 + (spot % 4) * 1.8;
    return { pos: [x, -1.0], face: Math.PI, pose: "look", route: [[10.5, CORRIDOR_Z], [10.5, -1.0], [x, -1.0]] };
  }
  if (activity === "POOL") {
    const spots: [V2, number][] = [[[15.6, 10.4], Math.PI / 2], [[19.4, 10.4], -Math.PI / 2], [[17.5, 8.9], 0], [[17.5, 11.9], Math.PI]];
    const [[x, z], face] = spots[spot % spots.length];
    return { pos: [x, z], face, pose: "cue", route: [[10.5, CORRIDOR_Z], [10.5, 7.4], [x, 7.4]] };
  }
  const spots: [V2, number][] = [[[7.2, 1.0], -Math.PI / 2], [[6.0, 1.0], Math.PI / 2], [[-13.2, 1.5], Math.PI / 2], [[-12.0, 1.5], -Math.PI / 2]];
  const [[x, z], face] = spots[spot % spots.length];
  return { pos: [x, z], face, pose: "chat", route: [[x < 0 ? -13.4 : 8.6, CORRIDOR_Z], [x, z - 0.8]] };
}

const hex = (c: string | number) => new THREE.Color(c);
const matte = (c: string | number, rough = 0.75) => new THREE.MeshStandardMaterial({ color: hex(c), roughness: rough, metalness: 0.02 });

/** A stylised person (origin at the feet, facing +z); `rig` moves down when seated. */
function makePerson(look: PersonLook): Person {
  const group = new THREE.Group(), rig = new THREE.Group();
  group.add(rig);
  const skin = matte(look.skin, 0.6), hair = matte(look.hair, 0.85), shirt = matte(look.shirt, 0.8), pants = matte(look.pants, 0.85);
  const shoe = matte("#22252b", 0.5), dark = matte("#16181d", 0.3), lips = matte("#a2574b", 0.6);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = rig) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const feminine = look.presentation === "feminine";
  const hips: THREE.Group[] = [], knees: THREE.Group[] = [], shoulders: THREE.Group[] = [], elbows: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.1, 0.92, 0); rig.add(hip); hips.push(hip);
    add(new THREE.CapsuleGeometry(0.078, 0.3, 4, 10), pants, 0, -0.2, 0, hip);
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee); knees.push(knee);
    add(new THREE.CapsuleGeometry(0.066, 0.3, 4, 10), look.skirt ? skin : pants, 0, -0.2, 0, knee);
    add(new THREE.BoxGeometry(0.11, 0.08, 0.25), shoe, 0, -0.44, 0.05, knee);
  }
  add(new THREE.CapsuleGeometry(0.16, 0.12, 4, 12), pants, 0, 0.95, 0).scale.set(1.15, 1, 0.8);
  if (look.skirt) add(new THREE.CylinderGeometry(0.19, 0.27, 0.36, 18), shirt, 0, 0.8, 0);
  add(new THREE.CapsuleGeometry(0.17, 0.3, 6, 16), shirt, 0, 1.25, 0).scale.set(feminine ? 1.0 : 1.18, 1, 0.72);
  add(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), skin, 0, 1.5, 0);
  // Head on its own pivot (the neck) so it can turn to whoever is talking.
  const head = new THREE.Group(); head.position.y = 1.52; rig.add(head);
  add(new THREE.SphereGeometry(0.13, 24, 18), skin, 0, 0.14, 0, head).scale.set(0.95, 1.08, 1);
  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(0.018, 8, 6), dark, side * 0.045, 0.16, 0.12, head);
    add(new THREE.BoxGeometry(0.045, 0.01, 0.01), dark, side * 0.045, 0.195, 0.12, head);
  }
  add(new THREE.BoxGeometry(0.05, 0.012, 0.01), lips, 0, 0.09, 0.125, head);
  const cap = (r: number) => add(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), hair, 0, 0.16, -0.012, head);
  if (look.hairStyle === "curly") cap(0.16).scale.set(1, 0.85, 1);
  else cap(look.hairStyle === "buzz" ? 0.134 : 0.14);
  if (look.hairStyle === "long") add(new THREE.CapsuleGeometry(0.12, 0.2, 4, 12), hair, 0, -0.02, -0.075, head).scale.set(1.05, 1, 0.45);
  if (look.hairStyle === "bun") add(new THREE.SphereGeometry(0.065, 12, 10), hair, 0, 0.3, -0.09, head);
  if (look.hairStyle === "ponytail") add(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), hair, 0, 0.05, -0.17, head).rotation.x = 0.35;
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * (feminine ? 0.22 : 0.25), 1.4, 0); rig.add(shoulder); shoulders.push(shoulder);
    add(new THREE.CapsuleGeometry(0.056, 0.2, 4, 10), shirt, 0, -0.14, 0, shoulder);
    const elbow = new THREE.Group(); elbow.position.y = -0.29; shoulder.add(elbow); elbows.push(elbow);
    add(new THREE.CapsuleGeometry(0.047, 0.18, 4, 10), skin, 0, -0.12, 0, elbow);
    add(new THREE.SphereGeometry(0.05, 10, 8), skin, 0, -0.26, 0, elbow);
  }
  // Coffee mug in the right hand (shown in the kitchen).
  const mug = new THREE.Group(); mug.position.set(0, -0.3, 0.04); elbows[1].add(mug);
  add(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 14), matte("#f4f1ec", 0.4), 0, 0, 0, mug);
  mug.visible = false;
  // Pool cue held in the right hand (shown at the pool table).
  const cue = new THREE.Group(); cue.position.set(0, -0.26, 0); elbows[1].add(cue);
  const stick = add(new THREE.CylinderGeometry(0.012, 0.022, 1.3, 8), matte("#c89b62", 0.5), 0, 0, 0.5, cue); stick.rotation.x = Math.PI / 2.2;
  cue.visible = false;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; group.add(shadow);
  group.scale.setScalar(S);
  return { group, rig, head, hips, knees, shoulders, elbows, mug, cue };
}

/** Price now and change against the previous close (green rising, red falling). */
function quoteOf(chart: AgentChart | undefined) {
  const bars = chart?.bars ?? [];
  const price = chart?.last ?? bars.at(-1)?.close ?? null;
  const prev = chart?.last != null ? bars.at(-1)?.close : bars.at(-2)?.close;
  const change = price !== null && prev ? price / prev - 1 : null;
  return { price, change, color: change === null || Math.abs(change) < 0.0005 ? "#5ee7ff" : change > 0 ? "#3dffa8" : "#ff5d7d" };
}

/** Daily candles of one stock with its header (ticker, price now, change today). */
function drawChart(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, title: string, chart: AgentChart | undefined, scale = 1) {
  g.fillStyle = "#06121d"; g.fillRect(x0, y0, w, h);
  const { price, change, color } = quoteOf(chart);
  g.fillStyle = "#e8f6ff"; g.font = `bold ${30 * scale}px sans-serif`; g.textBaseline = "top"; g.textAlign = "left";
  g.fillText(title, x0 + 16 * scale, y0 + 12 * scale);
  if (price !== null) {
    g.fillStyle = color; g.textAlign = "right";
    g.fillText(`${brl(price)}  ${change === null ? "" : `${change >= 0 ? "▲ +" : "▼ "}${(change * 100).toFixed(1)}%`}`, x0 + w - 16 * scale, y0 + 12 * scale);
    g.textAlign = "left";
  }
  const bars = chart?.bars ?? [];
  const top = y0 + 58 * scale, bottom = y0 + h - 14 * scale, left = x0 + 12 * scale, right = x0 + w - 12 * scale;
  g.strokeStyle = "rgba(94,231,255,0.12)"; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = top + ((bottom - top) * i) / 4; g.beginPath(); g.moveTo(left, y); g.lineTo(right, y); g.stroke(); }
  if (!bars.length) { g.fillStyle = "#7f93a6"; g.font = `${24 * scale}px sans-serif`; g.fillText("Sem gráfico ainda", left + 8, top + 20 * scale); return; }
  const hi = Math.max(...bars.map((b) => b.high), price ?? 0), lo = Math.min(...bars.map((b) => b.low), price ?? Infinity);
  const yOf = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const step = (right - left) / bars.length;
  bars.forEach((b, i) => {
    const cx = left + step * (i + 0.5), up = b.close >= b.open;
    g.strokeStyle = g.fillStyle = up ? "#3dffa8" : "#ff5d7d";
    g.beginPath(); g.moveTo(cx, yOf(b.high)); g.lineTo(cx, yOf(b.low)); g.stroke();
    const y1 = yOf(Math.max(b.open, b.close)), y2 = yOf(Math.min(b.open, b.close));
    g.fillRect(cx - step * 0.32, y1, step * 0.64, Math.max(1.5, y2 - y1));
  });
  if (price !== null) {
    g.setLineDash([6 * scale, 6 * scale]); g.strokeStyle = color; g.beginPath(); g.moveTo(left, yOf(price)); g.lineTo(right, yOf(price)); g.stroke(); g.setLineDash([]);
  }
}

/** A colourful modern wall mural: overlapping circles, arcs, stripes and dots (deterministic). */
function muralTexture(seed: number, palette: string[]) {
  const t = canvasTexture(1024, 384), g = t.g;
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  g.fillStyle = "#f6f1ea"; g.fillRect(0, 0, 1024, 384);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = palette[i % palette.length]; g.globalAlpha = 0.9;
    g.beginPath(); g.arc(rnd() * 1024, rnd() * 384, 40 + rnd() * 150, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1; g.lineWidth = 18;
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = palette[(i + 2) % palette.length];
    g.beginPath(); g.arc(rnd() * 1024, rnd() * 384, 60 + rnd() * 120, rnd() * Math.PI, rnd() * Math.PI + Math.PI); g.stroke();
  }
  g.fillStyle = "#1b1e24";
  for (let i = 0; i < 60; i++) { g.beginPath(); g.arc(rnd() * 1024, rnd() * 384, 4, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = "#1b1e24"; g.lineWidth = 6;
  for (let i = 0; i < 6; i++) { const x = rnd() * 1024; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 120, 384); g.stroke(); }
  t.texture.needsUpdate = true;
  return t.texture;
}

function canvasTexture(w: number, h: number) {
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return { canvas, g: canvas.getContext("2d")!, texture };
}

function drawTv(canvas: HTMLCanvasElement, tv: { headline: { title: string; source: string } | null; lines: [string, string, string][] }) {
  const g = canvas.getContext("2d")!;
  const w = canvas.width, h = canvas.height;
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, "#04203a"); grad.addColorStop(1, "#020a14");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.fillStyle = "#e0263c"; g.fillRect(28, 26, 150, 44);
  g.fillStyle = "#fff"; g.font = "bold 28px sans-serif"; g.fillText("AO VIVO", 44, 58);
  g.fillStyle = "#ffc65c"; g.font = "bold 26px sans-serif"; g.fillText(tv.headline?.source ?? "ATLAS", 200, 58);
  g.fillStyle = "#ffffff"; g.font = "bold 46px sans-serif";
  const words = (tv.headline?.title ?? "Sem manchete nova agora.").split(" ");
  let line = "", y = 130;
  for (const word of words) {
    if (g.measureText(`${line} ${word}`).width > w * 0.6 && line) { g.fillText(line, 28, y); line = word; y += 56; if (y > 300) { line += "…"; break; } }
    else line = line ? `${line} ${word}` : word;
  }
  if (y <= 300) g.fillText(line, 28, y);
  const x = w * 0.68;
  g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(x - 20, 20, w - x, h - 40);
  tv.lines.forEach(([label, value, color], i) => {
    g.fillStyle = "#a9c0d6"; g.font = "26px sans-serif"; g.fillText(label, x, 76 + i * 78);
    g.fillStyle = color; g.font = "bold 34px sans-serif"; g.fillText(value, x, 114 + i * 78);
  });
}

function plaque(title: string, subtitle: string, className = "plaque") {
  const el = document.createElement("div");
  el.className = className;
  const t = document.createElement("strong"); t.textContent = title; el.appendChild(t);
  if (subtitle) { const s = document.createElement("span"); s.textContent = subtitle; el.appendChild(s); }
  return new CSS2DObject(el);
}

/** Something a resting agent says about its own stock, from the real numbers. */
function chatLine(agent: OfficeAgent) {
  const { change } = quoteOf(agent.chart);
  const lines: string[] = ["Bora mais um café?", "Viu a notícia na TV?"];
  if (change !== null) lines.push(`${agent.ticker} ${change >= 0 ? "subiu" : "caiu"} ${(Math.abs(change) * 100).toFixed(1).replace(".", ",")}% hoje.`);
  if (agent.range && agent.holding === 0) lines.push(`Esperando ${agent.ticker} cair até ${brl(agent.range.buyBelow)}.`);
  if (agent.range && agent.holding > 0) lines.push(`Segurando ${agent.ticker}: vendo perto de ${brl(agent.range.sellAbove)}.`);
  if (agent.debate) lines.push(agent.debate.summary.replace(/^Decisão: /, "Minha decisão: "));
  return lines[Math.floor(Math.random() * lines.length)];
}

/** Two short tones, like a computer notification. Browsers allow sound only after a click. */
function beep(ctx: AudioContext | null) {
  if (!ctx || ctx.state !== "running") return;
  [0, 0.18].forEach((at) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "square"; osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.12);
    osc.connect(gain).connect(ctx.destination); osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + 0.14);
  });
}

export function Office3D({ agents, boss, assistantTip, tvHeadline, tvLines, selected, onSelect }: {
  agents: OfficeAgent[]; boss: Money;
  /** What the boss's assistant reports when he walks to the boss (best stock outside the team). */
  assistantTip?: string;
  tvHeadline: { title: string; source: string } | null; tvLines: [string, string, string][];
  selected: string | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ sync: (agents: OfficeAgent[], selected: string | null, boss: Money) => void;
    tv: (h: typeof tvHeadline, l: typeof tvLines) => void; reset: () => void; sound: (on: boolean) => void; tip: (text: string) => void } | null>(null);
  const select = useRef(onSelect);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(() => { try { return localStorage.getItem("atlas-office-sound") !== "off"; } catch { return true; } });
  useEffect(() => { select.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
    catch { queueMicrotask(() => setFailed(true)); return; }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = "office3d-labels";
    el.appendChild(labels.domElement);
    let audio: AudioContext | null = null, soundOn = true;
    const unlockAudio = () => { try { audio ??= new AudioContext(); void audio.resume(); } catch { audio = null; } };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1e24);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 220);
    const home = new THREE.Vector3(0, 33, 33);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.target.set(0, 0, 0.3);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 10; controls.maxDistance = 62;
    controls.minPolarAngle = 0.3; controls.maxPolarAngle = 1.25;
    controls.screenSpacePanning = false;
    // Left drag moves the camera over the floor, middle drag turns it, the wheel zooms (owner's request).
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.zoomToCursor = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9c9384, 1.15));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.7);
    sun.position.set(-14, 30, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 22, bottom: -22, near: 1, far: 90 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // Furniture helpers.
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, shadow = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z);
      mesh.castShadow = shadow; mesh.receiveShadow = true; scene.add(mesh); return mesh;
    };
    const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 32), m); mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
    };
    const white = matte("#eceae6", 0.85), wood = matte("#b98a5a", 0.6), darkWood = matte("#6f4b32", 0.6);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.35, metalness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.8 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const fabric = (c: string) => matte(c, 0.95);

    // Floor: light concrete, carpet under the desks, rugs in the lounges, tiles in the kitchen.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 28), matte("#d9d5ce", 0.8));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const rug = (w: number, d: number, x: number, z: number, c: string) => box(w, 0.02, d, x, 0.011, z, matte(c, 1), false);
    rug(17.5, 9.6, -5.5, 0.9, "#8b9097");
    rug(16, 5.8, -2, 10.4, "#5f6b7a");
    rug(15.8, 7.8, 16, -10, "#efe7da");
    rug(12, 7.6, 16.5, 0.6, "#7a6f86");

    // Walls with The Sims cutaway: `outer` walls drop when the camera is outside them and they
    // face it; interior walls drop whenever they face the camera.
    interface Wall { mesh: THREE.Mesh; center: THREE.Vector3; normal: THREE.Vector3; outer: boolean; full: number; items: THREE.Object3D[] }
    const walls: Wall[] = [];
    const wall = (x1: number, z1: number, x2: number, z2: number, h: number, m: THREE.Material, outer: boolean, normal?: V2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const geometry = new THREE.BoxGeometry(len, h, 0.18); geometry.translate(0, h / 2, 0);
      const mesh = new THREE.Mesh(geometry, m); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2); mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(mesh);
      const n = normal ?? [-(z2 - z1) / len, (x2 - x1) / len];
      const w: Wall = { mesh, center: mesh.position.clone(), normal: new THREE.Vector3(n[0], 0, n[1]), outer, full: h, items: [] };
      walls.push(w); return w;
    };
    const glassWall = (x1: number, z1: number, x2: number, z2: number, h = 2.6) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.05), glassMat);
      pane.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2); pane.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(pane);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.08), metal);
      frame.position.set(pane.position.x, h, pane.position.z); frame.rotation.y = pane.rotation.y; scene.add(frame);
    };
    const H = 3.4, Hi = 3.0;
    const backWall = wall(-24, -14, 24, -14, H, white, true, [0, -1]);
    const leftWall = wall(-24, -14, -24, 14, H, white, true, [-1, 0]);
    const rightWall = wall(24, -14, 24, 14, H, white, true, [1, 0]);
    wall(-24, 14, -21.5, 14, H, white, true, [0, 1]);
    wall(-17, 14, 24, 14, H, white, true, [0, 1]);
    const accents = ["#f07b2b", "#2f6fd6", "#f2b33d", "#1fa3b8"];
    [-16, -8, 0, 8].forEach((x, i) => wall(x, -14, x, -6, Hi, matte(accents[i], 0.8), false));
    for (const r of COUNCILS) { glassWall(r.x1 + 0.1, -6, r.door - 0.8, -6); glassWall(r.door + 0.8, -6, r.x2 - 0.1, -6); }
    glassWall(0.1, -6, 4.6, -6); glassWall(6.2, -6, 7.9, -6);
    glassWall(8.1, -6, 15.1, -6); glassWall(16.7, -6, 23.9, -6);

    const sign = (title: string, subtitle: string, x: number, z: number, y = 3.7) => { const p = plaque(title, subtitle); p.position.set(x, y, z); scene.add(p); };
    COUNCILS.forEach((r, i) => sign(`Conselho ${i + 1}`, "Risco · Balanço · Previsão · Estratégia", r.table[0], -13.6));
    sign("Sala do Chefe", "cuida do dinheiro", 4, -13.6);
    sign("Copa", "café e conversa", 16, -13.6);
    sign("Recepção", "", -19.5, 12.6, 2.6);
    sign("Sala de TV", "notícias ao vivo", -2, 13.2, 2.6);
    sign("Sala do Mercado", "ações da equipe", 16.5, -3.4, 5.1);

    const chair = (x: number, z: number, face: number, color = "#2b2e34") => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.6), fabric(color)); seat.position.y = SEAT_Y - 0.05; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.08), fabric(color)); back.position.set(0, SEAT_Y + 0.3, -0.29); g.add(back);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, SEAT_Y - 0.1), metal); pole.position.y = (SEAT_Y - 0.1) / 2; g.add(pole);
      g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.set(x, 0, z); g.rotation.y = face; scene.add(g);
    };
    const plant = (x: number, z: number, s = 1) => {
      cyl(0.32 * s, 0.26 * s, 0.6 * s, x, 0.3 * s, z, matte("#f4f1ec", 0.6));
      const leaves = matte("#3f8f4a", 0.8);
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.28 * s, 10, 8), leaves);
        leaf.position.set(x + Math.cos(i * 1.3) * 0.22 * s, (0.95 + (i % 3) * 0.28) * s, z + Math.sin(i * 1.3) * 0.22 * s);
        leaf.scale.set(1, 1.3, 1); leaf.castShadow = true; scene.add(leaf);
      }
    };
    const sofa = (w: number, x: number, z: number, face: number, color: string) => {
      const g = new THREE.Group(), m = fabric(color);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, 0.9), m); seat.position.y = 0.3; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, 0.25), m); back.position.set(0, 0.75, -0.33); g.add(back);
      for (const side of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.9), m); arm.position.set(side * (w / 2 - 0.11), 0.48, 0); g.add(arm); }
      g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.set(x, 0, z); g.rotation.y = face; scene.add(g);
    };
    const pouf = (x: number, z: number, color: string, r = 0.42) => cyl(r, r, 0.45, x, 0.225, z, fabric(color));

    // Desks (one per agent): left monitor = candles, right monitor = price now / beep alert.
    const desks = DESKS.map(([x, z], i) => {
      box(2.4, 0.06, 1.1, x, 0.95, z, white);
      for (const dx of [-1.1, 1.1]) box(0.06, 0.92, 1.0, x + dx, 0.46, z, metal);
      const screens = [-0.55, 0.55].map((dx) => {
        const t = canvasTexture(640, 400);
        box(1.02, 0.66, 0.04, x + dx, 1.55, z - 0.38, metal);
        box(0.06, 0.4, 0.06, x + dx, 1.17, z - 0.4, metal);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.6), new THREE.MeshBasicMaterial({ map: t.texture, toneMapped: false }));
        s.position.set(x + dx, 1.55, z - 0.355); scene.add(s);
        return t;
      });
      box(0.6, 0.02, 0.2, x, 0.99, z + 0.15, metal);
      chair(x, z + 1.05, Math.PI, ["#f07b2b", "#2f6fd6", "#22a06b"][i % 3]);
      if (i === 2 || i === 5) plant(x + 2.2, z - 0.2, 0.8);
      return { screens, key: "", alertUntil: 0, agent: null as OfficeAgent | null };
    });
    const drawDesk = (i: number, agent: OfficeAgent | null, force = false) => {
      const d = desks[i], [left, right] = d.screens;
      const alert = d.alertUntil > performance.now();
      const key = agent ? `${agent.id}:${agent.chart?.last}:${agent.chart?.bars.length}:${agent.debate?.summary}:${agent.holding}:${alert}` : "free";
      d.agent = agent;
      if (d.key === key && !force) return;
      d.key = key;
      drawChart(left.g, 0, 0, 640, 400, agent ? agent.ticker : "Mesa livre", agent?.chart, 0.9);
      left.texture.needsUpdate = true;
      const g = right.g;
      g.fillStyle = alert ? "#ffc65c" : "#06121d"; g.fillRect(0, 0, 640, 400); g.textBaseline = "top"; g.textAlign = "left";
      if (alert) {
        g.fillStyle = "#1b1206"; g.font = "bold 92px sans-serif"; g.fillText("BIP!", 24, 40);
        g.font = "bold 44px sans-serif"; g.fillText("Hora de trabalhar", 24, 160);
        g.font = "32px sans-serif"; g.fillText(agent ? `${agent.name}, volte ao computador` : "", 24, 230);
      } else if (agent) {
        const { price, change, color } = quoteOf(agent.chart);
        g.fillStyle = "#a9c0d6"; g.font = "26px sans-serif"; g.fillText(`${agent.ticker} agora`, 24, 22);
        g.fillStyle = color; g.font = "bold 84px sans-serif"; g.fillText(price === null ? "—" : brl(price), 24, 58);
        g.font = "bold 40px sans-serif"; g.fillText(change === null ? "" : `${change >= 0 ? "▲ subindo" : "▼ caindo"} ${(Math.abs(change) * 100).toFixed(1)}% hoje`, 24, 156);
        g.fillStyle = "#e8f6ff"; g.font = "bold 30px sans-serif";
        g.fillText(agent.holding > 0 ? `${agent.holding} ações na Genial` : "Ainda sem ações", 24, 236);
        if (agent.debate) { g.fillStyle = "#ffc65c"; g.font = "28px sans-serif"; g.fillText(agent.debate.summary.slice(0, 40), 24, 290); }
      }
      right.texture.needsUpdate = true;
    };

    // Council rooms: oval table, six chairs, specialists, screen with the chart under discussion.
    const rooms = COUNCILS.map((r, roomIndex) => {
      const [tx, tz] = r.table;
      const table = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.07, 48), wood); table.scale.set(2.0, 1, 0.95); table.position.set(tx, 0.95, tz);
      table.castShadow = true; table.receiveShadow = true; scene.add(table);
      cyl(0.18, 0.3, 0.92, tx, 0.46, tz, metal);
      for (let s = 0; s < 5; s++) { const { pos, face } = councilSeat(roomIndex, s); chair(pos[0], pos[1], face, s < 4 ? "#3b3f47" : "#f07b2b"); }
      const screen = canvasTexture(900, 380);
      const frame = box(3.9, 1.75, 0.08, tx, 2.25, -13.85, metal);
      const tv = new THREE.Mesh(new THREE.PlaneGeometry(3.75, 1.6), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
      tv.position.set(tx, 2.25, -13.8); scene.add(tv);
      backWall.items.push(frame, tv);
      plant(r.x1 + 0.7, -13.2, 0.7);
      const bubbleEl = document.createElement("div"); bubbleEl.className = "debate-bubble"; bubbleEl.hidden = true;
      const bubble = new CSS2DObject(bubbleEl); bubble.position.set(tx, 2.2, tz + 2.6); scene.add(bubble);
      return { screen, bubbleEl, key: "" };
    });
    const drawRoom = (i: number, agent: OfficeAgent | null) => {
      const room = rooms[i];
      const key = agent ? `${agent.id}:${agent.chart?.last}:${agent.debate?.summary}` : "free";
      if (room.key === key) return;
      room.key = key;
      if (agent) drawChart(room.screen.g, 0, 0, 900, 380, `Em análise: ${agent.ticker}`, agent.chart);
      else {
        const g = room.screen.g; g.fillStyle = "#06121d"; g.fillRect(0, 0, 900, 380);
        g.fillStyle = "#4e6478"; g.font = "bold 40px sans-serif"; g.textBaseline = "middle"; g.textAlign = "center"; g.fillText("Sala livre", 450, 190); g.textAlign = "left";
      }
      room.screen.texture.needsUpdate = true;
      room.bubbleEl.replaceChildren();
      room.bubbleEl.hidden = !agent?.debate;
      if (!agent?.debate) return;
      // One line: who, the three votes as coloured dots, the decision (details on hover).
      const head = document.createElement("b"); head.textContent = agent.name;
      room.bubbleEl.append(head);
      for (const o of agent.debate.opinions) {
        const dot = document.createElement("span"); dot.className = `vote-dot ${o.vote.toLowerCase()}`; dot.setAttribute("aria-label", `${o.role}: ${VOTE_LABEL[o.vote]}`);
        room.bubbleEl.append(dot);
      }
      const verdict = document.createElement("em"); verdict.textContent = agent.debate.summary.replace(/^Decisão: /, "").replace(/\.$/, ""); room.bubbleEl.append(verdict);
      room.bubbleEl.title = agent.debate.opinions.map((o) => `${o.role} (${VOTE_LABEL[o.vote]}): ${o.text}`).join("\n");
    };

    // The boss's office: desk facing the room, dashboard of the money on the wall behind.
    box(2.6, 0.06, 1.2, 4, 0.95, -10.6, darkWood);
    for (const dx of [-1.2, 1.2]) box(0.06, 0.92, 1.1, 4 + dx, 0.46, -10.6, metal);
    box(0.9, 0.55, 0.04, 4, 1.35, -10.2, metal);
    chair(4, -11.6, 0, "#2b2e34");
    sofa(2.4, 4, -7.4, Math.PI, "#8c8274"); plant(7.2, -13.2, 0.8);
    const bossScreen = canvasTexture(1000, 560);
    const bossFrame = box(4.6, 2.6, 0.08, 4, 2.2, -13.85, metal);
    const bossTv = new THREE.Mesh(new THREE.PlaneGeometry(4.45, 2.45), new THREE.MeshBasicMaterial({ map: bossScreen.texture, toneMapped: false }));
    bossTv.position.set(4, 2.2, -13.8); scene.add(bossTv);
    backWall.items.push(bossFrame, bossTv);
    let bossKey = "";
    const drawBoss = (list: OfficeAgent[], cash: Money) => {
      const key = JSON.stringify([cash, list.map((a) => [a.name, a.budget, a.holding, a.pnl])]);
      if (key === bossKey) return;
      bossKey = key;
      const g = bossScreen.g;
      g.fillStyle = "#06121d"; g.fillRect(0, 0, 1000, 560); g.textBaseline = "top"; g.textAlign = "left";
      g.fillStyle = "#ffc65c"; g.font = "bold 40px sans-serif"; g.fillText("Painel do Chefe", 30, 22);
      g.fillStyle = "#e8f6ff"; g.font = "30px sans-serif";
      g.fillText(cash ? `Na Genial: ${brl(cash.deposited)} depositados · ${brl(cash.free)} livres` : "Dinheiro na Genial: —", 30, 82);
      g.fillStyle = "#a9c0d6"; g.font = "26px sans-serif"; g.fillText("Pode liberar agora para cada IA", 30, 140);
      list.slice(0, 6).forEach((a, i) => {
        const y = 186 + i * 58;
        g.fillStyle = "#e8f6ff"; g.font = "bold 30px sans-serif"; g.fillText(`${a.name} · ${a.ticker}`, 30, y);
        g.font = "30px sans-serif"; g.fillText(brl(a.budget), 430, y);
        g.fillStyle = a.holding > 0 ? "#3dffa8" : "#8ea4ba";
        g.fillText(a.holding > 0 ? `${a.holding} ações · ${signed(a.pnl)}` : "sem ações", 640, y);
      });
      bossScreen.texture.needsUpdate = true;
    };

    // Kitchen: counter with coffee machine, sink and fridge; high tables for a coffee and a chat.
    box(7.4, 1.0, 0.8, 12.4, 0.5, -13.2, white);
    box(7.6, 0.06, 0.95, 12.4, 1.03, -13.15, darkWood);
    box(0.6, 0.7, 0.5, 9.6, 1.4, -13.3, metal); box(0.35, 0.2, 0.05, 9.6, 1.55, -13.03, matte("#ffb24a", 0.4));
    box(0.7, 0.05, 0.45, 13, 1.07, -13.2, steel);
    box(1.0, 2.2, 0.8, 17.2, 1.1, -13.2, steel);
    for (const [x, z] of KITCHEN_TABLES) { cyl(0.55, 0.55, 0.05, x, 1.1, z, wood); cyl(0.05, 0.05, 1.08, x, 0.54, z, metal); cyl(0.3, 0.3, 0.03, x, 0.015, z, metal); }
    box(2.4, 0.9, 0.7, 22, 0.45, -12.9, matte("#f07b2b", 0.7)); plant(23, -7, 0.8);

    // Reception: logo wall, desk with the receptionist, waiting poufs.
    box(7.4, 3, 0.25, -19.5, 1.5, 6.2, matte("#f07b2b", 0.75));
    const logo = plaque("ATLAS", "Trading AI System", "plaque logo-plate"); logo.position.set(-19.5, 2.1, 6.4); scene.add(logo);
    box(3.6, 1.05, 0.8, -19.5, 0.52, 9.4, white); box(3.8, 0.06, 0.95, -19.5, 1.07, 9.4, wood);
    pouf(-21.8, 12.2, "#1fa3b8"); pouf(-20.6, 12.4, "#f2b33d"); pouf(-17.4, 12.2, "#d6336c");
    plant(-23, 7, 0.9); plant(-16, 7, 0.8);

    // TV lounge: the news TV between the work area and the sofas, with a screen on both sides.
    const tvCanvas = document.createElement("canvas"); tvCanvas.width = 1280; tvCanvas.height = 380;
    const tvTexture = new THREE.CanvasTexture(tvCanvas); tvTexture.colorSpace = THREE.SRGBColorSpace;
    box(5.8, 0.5, 0.6, -2, 0.25, 7.6, darkWood);
    box(5.4, 1.75, 0.08, -2, 1.55, 7.6, metal);
    for (const [z, turn] of [[7.66, 0], [7.54, Math.PI]] as [number, number][]) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.25, 1.6), new THREE.MeshBasicMaterial({ map: tvTexture, toneMapped: false }));
      screen.position.set(-2, 1.55, z); screen.rotation.y = turn; scene.add(screen);
    }
    sofa(4.6, -5, 10.6, Math.PI, "#f07b2b"); sofa(4.6, 1.2, 10.6, Math.PI, "#d6336c");
    sofa(2.4, -8.6, 9.4, Math.PI * 0.78, "#1fa3b8"); sofa(2.4, 4.8, 9.4, -Math.PI * 0.78, "#2f6fd6");
    cyl(0.6, 0.6, 0.06, -2, 0.45, 9.0, white);
    pouf(-2.9, 12.8, "#f2b33d"); pouf(0.4, 12.8, "#22a06b"); plant(-12.8, 12.6); plant(8.8, 12.6, 0.9);

    // Market room and game corner.
    const wallCanvas = canvasTexture(1800, 1000);
    box(8.4, 4.8, 0.2, 16.5, 2.7, -3.6, metal);
    const wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 4.5), new THREE.MeshBasicMaterial({ map: wallCanvas.texture, toneMapped: false }));
    wallScreen.position.set(16.5, 2.7, -3.49); scene.add(wallScreen);
    sofa(4.2, 16.5, 2.4, Math.PI, "#2f6fd6");
    box(3.2, 0.2, 1.7, 17.5, 0.82, 10.4, darkWood);
    box(2.9, 0.04, 1.4, 17.5, 0.93, 10.4, matte("#0f6b4e", 0.95));
    for (const [dx, dz] of [[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.7], [1.4, 0.7]]) box(0.16, 0.74, 0.16, 17.5 + dx, 0.37, 10.4 + dz, darkWood);
    pouf(22.4, 12.6, "#d6336c", 0.5); pouf(12.8, 12.4, "#f2b33d", 0.5); plant(-13, -4.2, 0.8); plant(8.6, -4.2, 0.8);
    let wallKey = "";
    const drawWall = (list: OfficeAgent[]) => {
      const key = list.map((a) => `${a.ticker}:${a.chart?.last}:${a.chart?.bars.length}`).join("|");
      if (key === wallKey) return;
      wallKey = key;
      wallCanvas.g.fillStyle = "#010810"; wallCanvas.g.fillRect(0, 0, 1800, 1000);
      list.slice(0, 6).forEach((a, i) => drawChart(wallCanvas.g, 10 + (i % 3) * 597, 10 + Math.floor(i / 3) * 495, 585, 485, `${a.ticker} · ${a.name}`, a.chart, 0.95));
      wallCanvas.texture.needsUpdate = true;
    };

    // Decoration: murals, bookshelves, planters between the desk rows, floor lamps, coffee bar.
    const PALETTE = ["#f07b2b", "#2f6fd6", "#f2b33d", "#d6336c", "#1fa3b8", "#22a06b"];
    const mural = (w: number, h: number, x: number, y: number, z: number, turn: number, seed: number, onWall: { items: THREE.Object3D[] }) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: muralTexture(seed, PALETTE), roughness: 0.9 }));
      m.position.set(x, y, z); m.rotation.y = turn; scene.add(m); onWall.items.push(m);
    };
    mural(9, 2.6, -23.88, 1.7, -0.5, Math.PI / 2, 7, leftWall);
    mural(7, 2.6, 23.88, 1.7, 8.6, -Math.PI / 2, 21, rightWall);
    mural(6.4, 1.1, 12.4, 2.75, -13.88, 0, 33, backWall);
    mural(4.6, 0.8, 4, 3.1, -13.88, 0, 47, backWall);
    const bookshelf = (x: number, z: number, turn: number) => {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 0.45), darkWood); frame.position.y = 1.1; g.add(frame);
      for (let row = 0; row < 4; row++) for (let b = 0; b < 9; b++) {
        if ((row * 7 + b * 3) % 5 === 0) continue;
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36 + ((b * 13) % 5) * 0.03, 0.3), matte(PALETTE[(row + b) % PALETTE.length], 0.8));
        book.position.set(-1.0 + b * 0.24, 0.32 + row * 0.5, 0.06); g.add(book);
      }
      g.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.position.set(x, 0, z); g.rotation.y = turn; scene.add(g);
    };
    bookshelf(-23.4, -4.2, Math.PI / 2); bookshelf(-23.4, 3.4, Math.PI / 2); bookshelf(23.4, -0.5, -Math.PI / 2);
    // Planters between the two rows of desks (gaps left for the walkways).
    for (const [x1, x2] of [[-12.6, -8.9], [-7.6, -3.4], [-2.1, 1.6]]) {
      box(x2 - x1, 0.45, 0.5, (x1 + x2) / 2, 0.225, 0.9, darkWood);
      for (let x = x1 + 0.3; x < x2 - 0.2; x += 0.55) {
        const bush = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), matte("#3f8f4a", 0.85));
        bush.position.set(x, 0.62, 0.9); bush.scale.set(1, 0.8, 1); bush.castShadow = true; scene.add(bush);
      }
    }
    const floorLamp = (x: number, z: number) => {
      cyl(0.03, 0.03, 1.9, x, 0.95, z, metal); cyl(0.22, 0.22, 0.04, x, 0.02, z, metal);
      const shade = cyl(0.28, 0.36, 0.4, x, 2.0, z, matte("#fff6e5", 0.6));
      (shade.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffe2a8); (shade.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
    };
    floorLamp(-10.6, 12.8); floorLamp(6.6, 12.8); floorLamp(22.8, 4.6); floorLamp(-22.6, 11.4); floorLamp(21.4, -6.6);
    // Coffee bar extras: menu board and a fruit bowl.
    const menu = canvasTexture(512, 256);
    menu.g.fillStyle = "#1b1e24"; menu.g.fillRect(0, 0, 512, 256); menu.g.fillStyle = "#ffc65c"; menu.g.font = "bold 44px sans-serif";
    menu.g.fillText("CAFÉ ATLAS", 30, 70); menu.g.fillStyle = "#e8f6ff"; menu.g.font = "30px sans-serif";
    ["espresso", "cappuccino", "chá gelado"].forEach((line, i) => menu.g.fillText(`· ${line}`, 40, 130 + i * 40));
    menu.texture.needsUpdate = true;
    const menuBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: menu.texture }));
    menuBoard.position.set(16.9, 2.6, -13.88); scene.add(menuBoard); backWall.items.push(menuBoard);
    cyl(0.25, 0.15, 0.12, 14.4, 1.12, -13.1, matte("#f4f1ec", 0.4));
    [0xff5d4d, 0xffc65c, 0x7ed957].forEach((c, i) => {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), matte(c, 0.5)); fruit.position.set(14.3 + i * 0.09, 1.22, -13.1 + (i % 2) * 0.06); scene.add(fruit);
    });

    // Staff: specialists in every council room, the boss, the receptionist, the supervisor.
    const staff: { person: Person; pose: Pose; phase: number }[] = [];
    const STAFF_LOOKS: PersonLook[] = [
      { presentation: "feminine", skin: "#e2b08c", hair: "#2a1b12", hairStyle: "long", shirt: "", pants: "#2b2f3a" },
      { presentation: "masculine", skin: "#a8724f", hair: "#151010", hairStyle: "short", shirt: "", pants: "#30343c" },
      { presentation: "feminine", skin: "#f0c9a8", hair: "#6b3a1e", hairStyle: "bun", shirt: "", pants: "#2b2f3a" },
    ];
    // Specialists per room, in the order Risco, Balanço, Estratégia, Previsão (shirt colours).
    const councilBubbles: HTMLDivElement[][] = COUNCILS.map(() => []);
    COUNCILS.forEach((_, roomIndex) => SPECIALIST_SHIRTS.forEach((shirt, s) => {
      const person = makePerson({ ...STAFF_LOOKS[(s + roomIndex) % 3], shirt });
      const { pos, face } = councilSeat(roomIndex, s);
      person.group.position.set(pos[0], 0, pos[1]); person.group.rotation.y = face; scene.add(person.group);
      staff.push({ person, pose: "talk", phase: roomIndex * 2 + s });
      const el = document.createElement("div"); el.className = "speech-bubble council"; el.hidden = true;
      const o = new CSS2DObject(el); o.position.set(0, 2.3, 0); person.rig.add(o); councilBubbles[roomIndex].push(el);
    }));
    const SPEAKER: Record<string, number> = { Risco: 0, "Balanço": 1, "Estratégia": 2, "Previsão": 3 };
    const roomTalk = COUNCILS.map(() => ({ agentId: "", turn: 0, timer: 0 }));
    let roomAgents: (OfficeAgent | null)[] = [null, null, null];
    const tagged = (person: Person, title: string, subtitle = "") => {
      const tag = plaque(title, subtitle, "plaque staff-plate"); tag.position.set(0, 2.05, 0); person.rig.add(tag); return tag;
    };
    const bossPerson = makePerson({ presentation: "masculine", skin: "#d9a07a", hair: "#9a9a9a", hairStyle: "short", shirt: "#1f2a44", pants: "#1b1e24" });
    bossPerson.group.position.set(4, 0, -11.6); scene.add(bossPerson.group);
    const bossTag = tagged(bossPerson, "Chefe", "cuida do dinheiro");
    staff.push({ person: bossPerson, pose: "type", phase: 7 });
    // The boss's assistant watches stocks outside the team (the list under the office).
    box(1.3, 0.06, 0.7, 6.6, 0.95, -8.4, white); box(0.6, 0.4, 0.04, 6.6, 1.25, -8.7, metal);
    const assistant = makePerson({ presentation: "masculine", skin: "#c68863", hair: "#2b1a12", hairStyle: "curly", shirt: "#5c6bc0", pants: "#2d3142" });
    const ASSIST_DESK: V2 = [6.6, -7.6];
    assistant.group.position.set(ASSIST_DESK[0], 0, ASSIST_DESK[1]); assistant.group.rotation.y = Math.PI; scene.add(assistant.group);
    chair(6.6, -7.6, Math.PI, "#5c6bc0"); tagged(assistant, "Assistente", "vigia outras ações");
    const bubbleFor = (p: Person, y = 2.75) => {
      const el = document.createElement("div"); el.className = "speech-bubble"; el.hidden = true;
      const o = new CSS2DObject(el); o.position.set(0, y, 0); p.rig.add(o); return el;
    };
    const show = (el: HTMLDivElement, text: string, seconds: number, className = "speech-bubble") => {
      el.className = className; el.textContent = text; el.hidden = false;
      window.setTimeout(() => { if (el.textContent === text) el.hidden = true; }, seconds * 1000);
    };
    const assistantBubble = bubbleFor(assistant), bossBubble = bubbleFor(bossPerson, 2.6);
    // Every minute or so the assistant walks to the boss, reports, and goes back to his desk.
    let assistState: "desk" | "going" | "talking" | "back" = "desk", assistTimer = 15;
    let tip = "Hoje nenhuma ação de fora do time está boa para comprar.";
    const assistPath: V2[] = [];
    const receptionist = makePerson({ presentation: "feminine", skin: "#c68f6a", hair: "#1a120d", hairStyle: "ponytail", shirt: "#ffffff", pants: "#2b2f3a" });
    receptionist.group.position.set(-19.5, 0, 8.3); scene.add(receptionist.group);
    chair(-19.5, 8.3, 0, "#f07b2b"); tagged(receptionist, "Recepção");
    staff.push({ person: receptionist, pose: "type", phase: 9 });
    const supervisor = makePerson({ presentation: "feminine", skin: "#8d5a3b", hair: "#120c08", hairStyle: "bun", shirt: "#ffc65c", pants: "#2d3142" });
    scene.add(supervisor.group);
    tagged(supervisor, "Supervisora", "acompanha a equipe");
    const supBubbleEl = document.createElement("div"); supBubbleEl.className = "speech-bubble"; supBubbleEl.hidden = true;
    const supBubble = new CSS2DObject(supBubbleEl); supBubble.position.set(0, 2.75, 0); supervisor.rig.add(supBubble);
    // Patrol: past every desk (stopping to check), the council corridor and the lounges.
    const patrol: { at: V2; face?: number; wait?: number; desk?: number }[] = [
      { at: [-13.4, -4.2] }, ...DESKS.slice(0, 3).map(([x, z], i) => ({ at: [x, z + 2.3] as V2, face: Math.PI, wait: 3, desk: i })),
      { at: [6.2, 1.2] }, ...DESKS.slice(3).reverse().map(([x, z], i) => ({ at: [x, z + 2.3] as V2, face: Math.PI, wait: 3, desk: 5 - i })),
      { at: [-13.4, 6.4] }, { at: [-13.4, -4.6] }, { at: [8.6, -4.6] }, { at: [8.6, -4.2], wait: 2 },
    ];
    let patrolIndex = 0, patrolWait = 0, supTalkUntil = 0;
    const supPath: V2[] = [];
    supervisor.group.position.set(-13.4, 0, -4.2);
    const say = (text: string, seconds = 4) => { supBubbleEl.textContent = text; supBubbleEl.hidden = false; supTalkUntil = performance.now() + seconds * 1000; };

    // Agents.
    const people = new Map<string, Walker>();
    const pickables: THREE.Object3D[] = [];
    const deskOf = new Map<string, number>();

    const setTarget = (r: Walker, slot: Slot, key: string, instant: boolean) => {
      if (r.key === key) return;
      r.key = key;
      if (instant || !r.slot) {
        r.slot = slot; r.path = [];
        r.group.position.set(slot.pos[0], 0, slot.pos[1]); r.group.rotation.y = slot.face;
        return;
      }
      r.path = [...[...r.slot.route].reverse(), ...slot.route, slot.pos];
      r.slot = slot;
    };

    const callToWork = (r: Walker, agent: OfficeAgent, desk: number) => {
      // The computer beeps and flashes, a bubble over the agent, and the supervisor calls them.
      desks[desk].alertUntil = performance.now() + 5000;
      drawDesk(desk, agent, true);
      window.setTimeout(() => drawDesk(desk, desks[desk].agent, true), 5200);
      show(r.bubbleEl, agent.zone === "MEETING" ? "bip! reunião do conselho" : "bip! hora de trabalhar", 5, "speech-bubble beep");
      say(`${agent.name}, sua vez: ${agent.zone === "MEETING" ? "conselho" : "computador"}!`);
      if (soundOn) beep(audio);
    };

    const occupied: Record<RestActivity, Set<number>> = { KITCHEN: new Set(), TV: new Set(), MARKET: new Set(), POOL: new Set(), STROLL: new Set() };
    const freeSpot = (activity: RestActivity) => {
      let spot = 0; while (occupied[activity].has(spot) && spot < REST_SPOTS[activity]) spot++;
      occupied[activity].add(spot); return spot;
    };
    const releaseSpot = (activity: RestActivity, spot: number) => occupied[activity].delete(spot);
    const latest = new Map<string, OfficeAgent>();
    let chatTimer = 6;
    const sync = (list: OfficeAgent[], sel: string | null, cash: Money) => {
      for (const a of list) latest.set(a.id, a);
      const counters: Partial<Record<OfficeZone, number>> = {};
      const inRoom: (OfficeAgent | null)[] = [null, null, null];
      for (const id of [...deskOf.keys()]) if (!list.some((a) => a.id === id)) deskOf.delete(id);
      list.forEach((agent, i) => {
        if (!deskOf.has(agent.id)) { const used = new Set(deskOf.values()); deskOf.set(agent.id, DESKS.findIndex((_, d) => !used.has(d))); }
        const desk = Math.max(0, deskOf.get(agent.id)!);
        let r = people.get(agent.id);
        const first = !r;
        if (!r) {
          const made = makePerson(lookFor(agent.name, agent.id));
          const labelEl = document.createElement("div");
          labelEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); select.current(agent.id); });
          const label = new CSS2DObject(labelEl); label.position.set(0, 2.05, 0); made.rig.add(label);
          const bubbleEl = document.createElement("div"); bubbleEl.className = "speech-bubble beep"; bubbleEl.hidden = true;
          const bubble = new CSS2DObject(bubbleEl); bubble.position.set(0, 3.0, 0); made.rig.add(bubble);
          made.group.traverse((o) => { o.userData.agentId = agent.id; });
          scene.add(made.group); pickables.push(made.group);
          r = { ...made, label, labelEl, bubble, bubbleEl, path: [], slot: null, key: "", phase: i * 1.7, zone: null, rest: null };
          people.set(agent.id, r);
        }
        const zone: OfficeZone = agent.zone === "OUT" ? "COFFEE" : agent.zone;
        const index = counters[zone] ?? 0; counters[zone] = index + 1;
        if (zone === "MEETING" && !inRoom[index % 3]) inRoom[index % 3] = agent;
        if (!first && r.zone && REST_ZONES.includes(r.zone) && !REST_ZONES.includes(zone)) callToWork(r, agent, desk);
        r.zone = zone;
        if (REST_ZONES.includes(zone)) {
          // Resting: keep the current activity; a newcomer starts in the kitchen or at the TV.
          if (!r.rest) {
            const activity: RestActivity = zone === "POOL" ? "TV" : "KITCHEN";
            const spot = freeSpot(activity);
            r.rest = { activity, spot, timer: 20 + Math.random() * 20 };
            setTarget(r, restSlot(activity, spot), `REST:${activity}:${spot}`, first);
          }
        } else {
          if (r.rest) { releaseSpot(r.rest.activity, r.rest.spot); r.rest = null; }
          setTarget(r, slotFor(zone, index, desk), `${zone}:${index}:${desk}`, first);
        }
        r.label.position.y = 2.05 + (zone === "DESK" ? 0 : (index % 2) * 0.62);
        // Label: name and stock, the company, whether it bought, and how the stock is doing today.
        const { change } = quoteOf(agent.chart);
        r.labelEl.className = `agent3d-label person ${tone(agent.pnl)} ${sel === agent.id ? "selected" : ""}`;
        r.labelEl.replaceChildren();
        const name = document.createElement("b"); name.textContent = `${agent.name} · ${agent.ticker}`;
        const company = document.createElement("i"); company.textContent = companyProfile(agent.ticker).name;
        const line = document.createElement("span");
        line.textContent = agent.holding > 0 ? `${agent.holding} ${agent.holding === 1 ? "ação" : "ações"} · ${signed(agent.pnl)}`
          : !agent.marketOpen ? "bolsa fechada" : agent.debate?.verdict === "COMPRAR" ? "vai comprar" : "esperando preço baixo";
        const trend = document.createElement("small");
        trend.className = change === null || Math.abs(change) < 0.0005 ? "" : change > 0 ? "up" : "down";
        trend.textContent = change === null ? "" : `${change >= 0 ? "▲ subindo" : "▼ caindo"} ${(Math.abs(change) * 100).toFixed(1)}% hoje`;
        r.labelEl.append(name, company, line, trend);
        r.labelEl.title = agent.activity;
        drawDesk(desk, agent);
      });
      const used = new Set(deskOf.values());
      DESKS.forEach((_, d) => { if (!used.has(d)) drawDesk(d, null); });
      inRoom.forEach((agent, i) => drawRoom(i, agent));
      roomAgents = inRoom;
      drawWall(list);
      drawBoss(list, cash);
      const bossNote = bossTag.element.querySelector("span");
      if (bossNote) bossNote.textContent = cash ? `guarda ${brl(cash.free)} na Genial` : "cuida do dinheiro";
      for (const [id, r] of people) if (!list.some((a) => a.id === id)) {
        scene.remove(r.group); people.delete(id);
        pickables.splice(pickables.indexOf(r.group), 1);
      }
    };

    const updateTv = (h: typeof tvHeadline, l: typeof tvLines) => { drawTv(tvCanvas, { headline: h, lines: l }); tvTexture.needsUpdate = true; };

    // Picking (the first click also unlocks the beep sound).
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; unlockAudio(); };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const rect = labels.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, true)[0];
      if (hit?.object.userData.agentId) select.current(hit.object.userData.agentId);
    };
    labels.domElement.addEventListener("pointerdown", onDown);
    labels.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h);
      camera.aspect = w / h;
      camera.position.copy(home).multiplyScalar(w / h < 1.2 ? 1.45 : 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();

    const pose = (p: Person, kind: Pose | "walk", t: number, phase: number) => {
      const swing = reduced ? 0 : Math.sin(t * 7 + phase);
      p.mug.visible = kind === "chat"; p.cue.visible = kind === "cue";
      const seated = kind === "sit" || kind === "type" || kind === "talk" || kind === "watch";
      p.rig.position.y = seated ? SEAT_Y / S - 0.92 : kind === "walk" ? Math.abs(swing) * 0.02 : 0;
      p.head.rotation.set(0, 0, 0);
      if (kind === "walk") {
        p.hips[0].rotation.x = swing * 0.5; p.hips[1].rotation.x = -swing * 0.5;
        p.knees[0].rotation.x = Math.max(0, -swing) * 0.6; p.knees[1].rotation.x = Math.max(0, swing) * 0.6;
        p.shoulders[0].rotation.x = -swing * 0.45; p.shoulders[1].rotation.x = swing * 0.45;
        p.elbows.forEach((e) => (e.rotation.x = -0.25));
        return;
      }
      p.hips.forEach((h) => (h.rotation.x = seated ? -Math.PI / 2 : 0));
      p.knees.forEach((k) => (k.rotation.x = seated ? Math.PI / 2 : 0));
      if (kind === "type") {
        p.shoulders.forEach((s, i) => (s.rotation.x = -0.75 + (reduced ? 0 : Math.sin(t * 16 + phase + i) * 0.05)));
        p.elbows.forEach((e) => (e.rotation.x = -0.85));
        p.head.rotation.x = 0.12;
      } else if (kind === "talk") {
        // Council debate: one hand gestures now and then, the head turns between colleagues.
        const gesture = reduced ? 0 : Math.max(0, Math.sin(t * 1.1 + phase));
        const other = reduced ? 0 : Math.max(0, Math.sin(t * 0.9 + phase + 2));
        p.shoulders[0].rotation.x = -0.45 - other * 0.5; p.shoulders[1].rotation.x = -0.45 - gesture * 0.8;
        p.elbows[0].rotation.x = -0.9 - other * 0.3; p.elbows[1].rotation.x = -0.9 - gesture * 0.5;
        p.head.rotation.y = reduced ? 0 : Math.sin(t * 0.5 + phase) * 0.45;
      } else if (kind === "chat") {
        // Kitchen: holding a coffee, a sip now and then, turning to chat.
        const sip = reduced ? 0 : Math.max(0, Math.sin(t * 0.6 + phase) - 0.7) * 3;
        p.shoulders[0].rotation.x = 0.05; p.elbows[0].rotation.x = -0.15;
        p.shoulders[1].rotation.x = -0.35 - sip * 0.5; p.elbows[1].rotation.x = -1.4 - sip * 0.5;
        p.head.rotation.y = reduced ? 0 : Math.sin(t * 0.4 + phase) * 0.6;
        p.head.rotation.x = -sip * 0.2;
      } else if (kind === "cue") {
        // Pool: lean in and take a shot now and then.
        const shot = reduced ? 0 : Math.max(0, Math.sin(t * 1.3 + phase));
        p.shoulders[0].rotation.x = -1.0; p.elbows[0].rotation.x = -0.4;
        p.shoulders[1].rotation.x = -0.8 + shot * 0.35; p.elbows[1].rotation.x = -0.6;
        p.head.rotation.x = 0.25;
      } else if (kind === "look") {
        // Looking up at the market panel, a hand on the chin now and then.
        const think = reduced ? 0 : Math.max(0, Math.sin(t * 0.5 + phase));
        p.head.rotation.x = -0.18; p.head.rotation.y = reduced ? 0 : Math.sin(t * 0.3 + phase) * 0.3;
        p.shoulders[0].rotation.x = 0; p.elbows[0].rotation.x = -0.1;
        p.shoulders[1].rotation.x = -0.5 * think; p.elbows[1].rotation.x = -2.2 * think;
      } else if (kind === "watch") {
        p.shoulders.forEach((s) => (s.rotation.x = -0.35)); p.elbows.forEach((e) => (e.rotation.x = -0.9));
        p.head.rotation.y = reduced ? 0 : Math.sin(t * 0.2 + phase) * 0.15;
      } else {
        p.shoulders.forEach((s) => (s.rotation.x = seated ? -0.4 : (reduced ? 0 : Math.sin(t * 1.2 + phase) * 0.04)));
        p.elbows.forEach((e) => (e.rotation.x = seated ? -0.7 : -0.1));
      }
    };

    // The Sims cutaway: drop walls between the camera and the rooms, smoothly.
    const view = new THREE.Vector3(), toCam = new THREE.Vector3();
    const cutaway = (dt: number) => {
      view.subVectors(controls.target, camera.position).setY(0).normalize();
      for (const w of walls) {
        toCam.subVectors(camera.position, w.center).setY(0);
        const facing = Math.abs(w.normal.dot(view)) > 0.35;
        const cut = facing && (!w.outer || toCam.dot(w.normal) > 0);
        const target = cut ? 0.35 / w.full : 1;
        const s = w.mesh.scale.y + (target - w.mesh.scale.y) * Math.min(1, dt * 8);
        w.mesh.scale.y = s;
        for (const item of w.items) item.visible = s > 0.6;
      }
    };

    const walk = (p: Person, path: V2[], speed: number, dt: number) => {
      const [tx, tz] = path[0];
      const pos = p.group.position, dx = tx - pos.x, dz = tz - pos.z, dist = Math.hypot(dx, dz), step = speed * dt;
      if (dist <= step) { pos.x = tx; pos.z = tz; path.shift(); }
      else { pos.x += (dx / dist) * step; pos.z += (dz / dist) * step; p.group.rotation.y = Math.atan2(dx, dz); }
    };

    const clock = new THREE.Clock();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      for (const r of people.values()) {
        if (r.path.length) {
          walk(r, r.path, reduced ? 40 : 2.4, dt);
          pose(r, "walk", t, r.phase);
          if (!r.path.length && r.slot) r.group.rotation.y = r.slot.face;
        } else if (r.slot) pose(r, r.slot.pose, t, r.phase);
      }
      for (const s of staff) pose(s.person, s.pose, t, s.phase);
      // Assistant routine: desk → boss (report) → desk.
      assistTimer -= dt;
      if (assistState === "desk") {
        pose(assistant, "type", t, 11);
        if (assistTimer <= 0) { assistState = "going"; assistPath.push([5.5, -7.2], [4.9, -9.5]); }
      } else if (assistState === "going" || assistState === "back") {
        if (assistPath.length) { walk(assistant, assistPath, reduced ? 40 : 1.5, dt); pose(assistant, "walk", t, 11); }
        else if (assistState === "going") {
          assistant.group.rotation.y = Math.PI; assistState = "talking"; assistTimer = 8;
          show(assistantBubble, `Chefe, ${tip}`, 4.5);
          window.setTimeout(() => show(bossBubble, "Ótimo, anotado. Vamos acompanhar.", 3), 4600);
        } else { assistant.group.rotation.y = Math.PI; assistState = "desk"; assistTimer = 45 + Math.random() * 30; }
      } else {
        pose(assistant, "stand", t, 11);
        if (assistTimer <= 0) { assistState = "back"; assistPath.push([5.5, -7.2], ASSIST_DESK); }
      }
      // Resting agents move on to another activity every 25 to 45 s.
      for (const r of people.values()) {
        if (!r.rest || r.path.length) continue;
        r.rest.timer -= dt;
        if (r.rest.timer > 0) continue;
        const current = r.rest.activity;
        const options = (Object.keys(REST_SPOTS) as RestActivity[]).filter((a) => a !== current && occupied[a].size < REST_SPOTS[a]);
        const next = options[Math.floor(Math.random() * options.length)];
        if (!next) { r.rest.timer = 10; continue; }
        releaseSpot(current, r.rest.spot);
        const spot = freeSpot(next);
        r.rest = { activity: next, spot, timer: 25 + Math.random() * 20 };
        setTarget(r, restSlot(next, spot), `REST:${next}:${spot}`, false);
        const says = REST_SAYS[next], bubbleEl = r.bubbleEl;
        if (says) window.setTimeout(() => { if (bubbleEl.hidden) show(bubbleEl, says[Math.floor(Math.random() * says.length)], 3); }, 7000);
      }
      // Councils: the specialists speak in turn about the stock on the screen, then the agent decides.
      roomAgents.forEach((agent, room) => {
        const talk = roomTalk[room];
        if (!agent?.debate) { talk.agentId = ""; return; }
        if (talk.agentId !== agent.id) { talk.agentId = agent.id; talk.turn = 0; talk.timer = 0; }
        talk.timer -= dt;
        if (talk.timer > 0) return;
        talk.timer = 3.6;
        const opinions = agent.debate.opinions;
        if (talk.turn < opinions.length) {
          const o = opinions[talk.turn], el = councilBubbles[room][SPEAKER[o.role]];
          if (el) show(el, `${o.role}: ${o.text.length > 70 ? `${o.text.slice(0, 68)}...` : o.text}`, 3.4, `speech-bubble council ${o.vote.toLowerCase()}`);
        } else {
          const walker = people.get(agent.id);
          if (walker) show(walker.bubbleEl, agent.debate.summary, 3.4);
        }
        talk.turn = (talk.turn + 1) % (opinions.length + 2);
      });
      // Resting agents chat now and then about their own stock (real numbers).
      chatTimer -= dt;
      if (chatTimer <= 0) {
        chatTimer = 8 + Math.random() * 6;
        const resting = [...people.values()].filter((r) => r.zone && REST_ZONES.includes(r.zone) && !r.path.length && r.bubbleEl.hidden);
        const r = resting[Math.floor(Math.random() * resting.length)];
        const agent = r && latest.get(r.group.userData.agentId as string);
        if (r && agent) show(r.bubbleEl, chatLine(agent), 4);
      }
      // Supervisor patrol: walk, stop at each desk and say what that agent is doing.
      if (supPath.length) { walk(supervisor, supPath, reduced ? 40 : 1.6, dt); pose(supervisor, "walk", t, 3); }
      else if (patrolWait > 0) { patrolWait -= dt; pose(supervisor, "stand", t, 3); }
      else {
        const stop = patrol[patrolIndex % patrol.length];
        if (stop.face !== undefined) supervisor.group.rotation.y = stop.face;
        if (stop.desk !== undefined && performance.now() > supTalkUntil) {
          const agent = desks[stop.desk].agent, here = agent && people.get(agent.id);
          if (agent && here) say(here.zone === "DESK" ? `Tudo certo, ${agent.name}?` : here.zone === "MEETING" ? `${agent.name} está no conselho.`
            : `${agent.name} descansando: sem trabalho agora.`, 2.6);
        }
        patrolIndex++;
        supPath.push(patrol[patrolIndex % patrol.length].at); patrolWait = stop.wait ?? 0;
      }
      if (!supBubbleEl.hidden && performance.now() > supTalkUntil) supBubbleEl.hidden = true;
      controls.update();
      cutaway(dt);
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    tick();

    api.current = {
      sync, tv: updateTv, sound: (on) => { soundOn = on; if (on) unlockAudio(); }, tip: (text) => { tip = text; },
      reset: () => { camera.position.copy(home).multiplyScalar(el.clientWidth / el.clientHeight < 1.2 ? 1.45 : 1); controls.target.set(0, 0, 0.3); },
    };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      labels.domElement.removeEventListener("pointerdown", onDown);
      labels.domElement.removeEventListener("pointerup", onUp);
      controls.dispose(); pmrem.dispose();
      void audio?.close();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose(); });
        }
      });
      renderer.dispose();
      el.replaceChildren();
      api.current = null;
    };
  }, []);

  useEffect(() => { api.current?.sync(agents, selected, boss); }, [agents, selected, boss]);
  useEffect(() => { api.current?.tv(tvHeadline, tvLines); }, [tvHeadline, tvLines]);
  useEffect(() => { if (assistantTip) api.current?.tip(assistantTip); }, [assistantTip]);
  useEffect(() => {
    api.current?.sound(sound);
    try { localStorage.setItem("atlas-office-sound", sound ? "on" : "off"); } catch { /* storage blocked */ }
  }, [sound]);

  if (failed) return <OfficeMap agents={agents} tvHeadline={tvHeadline} selected={selected} onSelect={onSelect} />;
  return (
    <div className="office3d">
      <div ref={host} className="office3d-canvas" role="img"
        aria-label={`Escritório 3D com ${agents.length} IAs. ${agents.map((a) => `${a.name}: ${a.activity}`).join(" ")}`} />
      <div className="office3d-hint">Arraste para mover · botão do meio para girar · rodinha para aproximar · toque numa pessoa
        <button type="button" className="secondary" onClick={() => setSound((on) => !on)} aria-pressed={sound}>{sound ? "Som do bip: ligado" : "Som do bip: desligado"}</button>
        <button type="button" className="secondary" onClick={() => api.current?.reset()}>Centralizar</button>
      </div>
    </div>
  );
}
