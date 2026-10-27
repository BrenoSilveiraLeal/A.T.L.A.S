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
import { meetingDue } from "@/core/meeting";
import { OfficeMap, type OfficeAgent, type AgentChart } from "./office-map";

/**
 * 3D office in the style of a modern tech office. Every agent is a person (look from
 * core/people) labelled with name, stock, company, holding and today's trend.
 * Layout (owner, 26/10/2026: "remodelagem mais moderna"): along the back wall four council rooms,
 * the boss's office and the team meeting room, whose front wall carries the market room screen; three islands of four facing desks in the middle; the
 * market room with sofas around the chart wall on the right; reception, TV lounge and the
 * snack bar with the pool table along the front.
 * - Work: one desk per agent with the real candles of its stock and the price now.
 * - Four council rooms with four specialists each (Risco, Balanço, Estratégia, Previsão): an
 *   analysing agent walks in and the room shows the debate and the chart.
 * - The boss's office: the boss keeps the money and passes it to the agents; the wall shows the
 *   money at Genial and what each agent received.
 * - A supervisor walks the floor checking the desks and calls whoever has to go back to work.
 * - Rest: the snack bar (coffee, high tables, counter, pool), the TV lounge and the sofas of the
 *   market room. Labels are compact (name, stock, a status dot, today's move); the details show
 *   on hover or when the person is selected.
 * - Sound on: the beep plus a quiet office ambience (murmur, typing, a phone now and then).
 * - Team meeting (17:10–17:40 on trading days): everyone sits at the long table and each agent
 *   says its part of the real minutes (core/meeting.ts); the room screen shows the last minutes.
 * - Pool: real balls on the table, players take turns and the balls roll, bounce and drop.
 * - When an agent goes back to work its computer beeps and flashes and it walks to the desk.
 * Walls work like The Sims "cutaway". Falls back to the 2D map without WebGL.
 */
type V2 = [number, number];
type Pose = "sit" | "stand" | "type" | "talk" | "chat" | "watch" | "cue" | "look";
interface Slot { pos: V2; face: number; pose: Pose; route: V2[] }
interface Person {
  group: THREE.Group; rig: THREE.Group; head: THREE.Group; hips: THREE.Group[]; knees: THREE.Group[];
  shoulders: THREE.Group[]; elbows: THREE.Group[]; mug: THREE.Group; cue: THREE.Group; phone: THREE.Group;
}
interface Walker extends Person {
  label: CSS2DObject; labelEl: HTMLDivElement; bubble: CSS2DObject; bubbleEl: HTMLDivElement;
  path: V2[]; slot: Slot | null; key: string; phase: number; zone: OfficeZone | null;
  /** While resting: the current activity, its spot and how long until the next one. */
  rest: { activity: RestActivity; spot: number; timer: number } | null;
}
type Money = { deposited: number; free: number } | null;
export type Meeting = { day: string; lines: { agentId: string; name: string; text: string }[]; summary: string[]; lessons: string[]; suggestions: string[] };
type RestActivity = "KITCHEN" | "TV" | "MARKET" | "POOL" | "STROLL";

const S = 1.25; // people are drawn a little larger than life so they read well from above
const SEAT_Y = 0.6;
const CORRIDOR_Z = -5;
const REST_ZONES: OfficeZone[] = ["COFFEE", "POOL", "OUT"];
/**
 * Three islands of four desks (owner, 26/10/2026: "uma mesa de frente para outra"): two desks side
 * by side facing two others, screens back to back. `dir` is the side the person sits on (+1 south,
 * facing north; −1 north, facing south); `lane` is the aisle used to reach the chair.
 */
interface DeskSpot { x: number; z: number; dir: 1 | -1; lane: number }
const ISLANDS: V2[] = [[-17.5, 0.4], [-8.5, 0.4], [0.5, 0.4]];
const DESKS: DeskSpot[] = ISLANDS.flatMap(([cx, cz]) => ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
  .map(([side, dir]): DeskSpot => ({ x: cx + side * 1.25, z: cz + dir * 0.55, dir, lane: cx + side * 3.2 })));
const seatOf = (d: DeskSpot): V2 => [d.x, d.z + d.dir * 1.05];
// Back wall, left to right (owner, 26/10/2026): four council rooms (each serving three agents), the
// boss's office (x 2.67 to 10.67) and the team meeting room (x 10.67 to 24).
const COUNCILS = [[-24, -17.33], [-17.33, -10.67], [-10.67, -4], [-4, 2.67]]
  .map(([x1, x2]) => ({ x1, x2, table: [(x1 + x2) / 2, -10.4] as V2, door: x2 - 1.4 }));
const SPECIALIST_SHIRTS = ["#f28c28", "#2f6fd6", "#22a06b", "#9b6bff"]; // Risco, Balanço, Estratégia, Previsão
// Snack bar (front right): two high tables and the counter along the right wall.
const KITCHEN_TABLES: V2[] = [[16.4, 7.6], [16.4, 11.4]];
const BAR_SPOTS: V2[] = [[21.5, 7.4], [21.5, 8.8], [21.5, 10.2], [21.5, 11.6]];
const POOL_TABLE: V2 = [11.6, 11];
// Market room: the chart screen hangs on the front wall of the meeting room (owner, 26/10/2026); a
// long sofa faces it and two sofas close the sides, around a coffee table.
const MARKET_SEATS: [V2, number][] = [[[15.8, 1.4], Math.PI], [[16.8, 1.4], Math.PI], [[17.8, 1.4], Math.PI], [[18.8, 1.4], Math.PI],
  [[13.6, -2.3], Math.PI / 2], [[13.6, -0.9], Math.PI / 2], [[21.0, -2.3], -Math.PI / 2], [[21.0, -0.9], -Math.PI / 2]];
const MARKET_LANE = 22.4;
const LOUNGE_LANE = 9;
const BOSS_X = 6.67;
// Team meeting room: six chairs each side for the agents, the boss at the head of the table and the
// supervisor at the other end (owner, 26/10/2026); the door is where the fifth council room's was.
const MEETING_TABLE: V2 = [17.3, -10];
const MEETING_DOOR = 12.07;
const SIDE_X = [13.05, 14.75, 16.45, 18.15, 19.85, 21.55];
const MEETING_SEATS: { pos: V2; face: number }[] = [
  ...SIDE_X.map((x) => ({ pos: [x, -8.55] as V2, face: Math.PI })),
  ...SIDE_X.map((x) => ({ pos: [x, -11.45] as V2, face: 0 }))];
const BOSS_SEAT: V2 = [11.6, -10], SUPERVISOR_SEAT: V2 = [23.0, -10];
function meetingSlot(i: number): Slot {
  const { pos, face } = MEETING_SEATS[i % MEETING_SEATS.length], [x] = pos;
  const door: V2[] = [[MEETING_DOOR, CORRIDOR_Z], [MEETING_DOOR, -7.2]];
  const route: V2[] = face === Math.PI ? [...door, [x, -7.6]]
    : face === 0 ? [...door, [23.5, -7.2], [23.5, -12.5], [x, -12.5]]
      : [...door, [x, -7.2]];
  return { pos, face, pose: "talk", route };
}
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
    const d = DESKS[desk % DESKS.length], [x, z] = seatOf(d), behind = z + d.dir * 0.85;
    return { pos: [x, z], face: d.dir === 1 ? Math.PI : 0, pose: "type", route: [[d.lane, CORRIDOR_Z], [d.lane, behind], [x, behind]] };
  }
  if (zone === "MEETING") {
    const room = index % COUNCILS.length, extra = Math.floor(index / COUNCILS.length) % 3, { pos, face } = councilSeat(room, 4 + extra);
    const door = COUNCILS[room].door;
    return { pos, face, pose: extra ? "stand" : "talk", route: [[door, CORRIDOR_Z], [door, -7.2], [pos[0], -8.0]] };
  }
  if (zone === "POOL") {
    // TV lounge: sofas facing the news TV.
    const [[x, z], face] = TV_SEATS[index % TV_SEATS.length];
    return { pos: [x, z], face, pose: "watch", route: [[-12.75, CORRIDOR_Z], [-12.75, 8.6], [x, 8.6]] };
  }
  // Snack bar: around the high tables, then at the counter, with a coffee, chatting.
  const spot = index % (KITCHEN_TABLES.length * 4 + BAR_SPOTS.length);
  if (spot >= KITCHEN_TABLES.length * 4) {
    const pos = BAR_SPOTS[spot - KITCHEN_TABLES.length * 4];
    return { pos, face: Math.PI / 2, pose: "chat", route: [[LOUNGE_LANE, CORRIDOR_Z], [LOUNGE_LANE, 6.2], [pos[0], 6.2]] };
  }
  const [tx, tz] = KITCHEN_TABLES[Math.floor(spot / 4)];
  const angle = (spot % 4) * (Math.PI / 2) + Math.PI / 4;
  const pos: V2 = [tx + Math.sin(angle) * 0.95, tz + Math.cos(angle) * 0.95];
  return { pos, face: Math.atan2(tx - pos[0], tz - pos[1]), pose: "chat", route: [[LOUNGE_LANE, CORRIDOR_Z], [LOUNGE_LANE, 6.2], [pos[0], 6.2]] };
}

/**
 * Rest activities (owner, 25/10/2026: while resting they move around: coffee and chat in the
 * kitchen, TV, a look at the market panel, a game of pool, a stroll, instead of standing still).
 */
const REST_SPOTS: Record<RestActivity, number> = { KITCHEN: KITCHEN_TABLES.length * 4 + BAR_SPOTS.length, TV: 6, MARKET: MARKET_SEATS.length, POOL: 4, STROLL: 4 };
const REST_SAYS: Partial<Record<RestActivity, string[]>> = {
  MARKET: ["Deixa eu ver o painel...", "Olha esse gráfico!"], POOL: ["Sua vez!", "Essa foi boa!"], STROLL: ["Bom dia!", "Vou dar uma volta."],
};
function restSlot(activity: RestActivity, spot: number): Slot {
  if (activity === "KITCHEN") return slotFor("COFFEE", spot, 0);
  if (activity === "TV") return slotFor("POOL", spot, 0);
  if (activity === "MARKET") {
    // Seated on the market room sofas, looking at the charts and chatting.
    const [[x, z], face] = MARKET_SEATS[spot % MARKET_SEATS.length];
    const via: V2[] = face === Math.PI ? [[x, 0.4]] : [[face === Math.PI / 2 ? 14.6 : 20, 0.4], [face === Math.PI / 2 ? 14.6 : 20, z]];
    return { pos: [x, z], face, pose: "watch", route: [[MARKET_LANE, CORRIDOR_Z], [MARKET_LANE, 0.4], ...via] };
  }
  if (activity === "POOL") {
    const [px, pz] = POOL_TABLE;
    const spots: [V2, number, V2[]][] = [
      [[px - 1.9, pz], Math.PI / 2, []], [[px, pz - 1.5], 0, [[LOUNGE_LANE, pz - 1.5]]],
      [[px, pz + 1.5], Math.PI, [[LOUNGE_LANE, pz + 1.5]]], [[px + 1.9, pz], -Math.PI / 2, [[LOUNGE_LANE, 12.9], [px + 1.9, 12.9]]]];
    const [[x, z], face, via] = spots[spot % spots.length];
    return { pos: [x, z], face, pose: "cue", route: [[LOUNGE_LANE, CORRIDOR_Z], [LOUNGE_LANE, z], ...via] };
  }
  const spots: [V2, number][] = [[[6.4, 5.0], Math.PI / 2], [[7.6, 5.0], -Math.PI / 2], [[-13.4, 4.6], Math.PI / 2], [[-12.2, 4.6], -Math.PI / 2]];
  const [[x, z], face] = spots[spot % spots.length];
  return { pos: [x, z], face, pose: "chat", route: [[x < 0 ? -12.75 : 7, CORRIDOR_Z], [x, z - 0.8]] };
}

const hex = (c: string | number) => new THREE.Color(c);
const matte = (c: string | number, rough = 0.75) => new THREE.MeshStandardMaterial({ color: hex(c), roughness: rough, metalness: 0.02 });

/**
 * A person (origin at the feet, facing +z); `rig` moves down when seated. Owner, 26/10/2026: "mais
 * humanos, mais detalhes": ears, nose, eyes with whites, eyebrows, collar, belt, hands, optional
 * glasses and jacket; a coffee mug, a pool cue and a phone appear in the hands when used.
 */
function makePerson(look: PersonLook): Person {
  const group = new THREE.Group(), rig = new THREE.Group();
  group.add(rig);
  const skin = matte(look.skin, 0.6), hair = matte(look.hair, 0.85), shirt = matte(look.shirt, 0.8), pants = matte(look.pants, 0.85);
  const jacket = look.jacket ? matte(look.jacket, 0.75) : shirt;
  const shoe = matte("#22252b", 0.4), dark = matte("#16181d", 0.3), lips = matte("#a2574b", 0.6), whites = matte("#f7f4ef", 0.4);
  const skinShade = matte(new THREE.Color(look.skin).multiplyScalar(0.85).getStyle(), 0.6);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = rig) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const feminine = look.presentation === "feminine";
  const hips: THREE.Group[] = [], knees: THREE.Group[] = [], shoulders: THREE.Group[] = [], elbows: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.1, 0.92, 0); rig.add(hip); hips.push(hip);
    add(new THREE.CapsuleGeometry(0.078, 0.3, 6, 12), pants, 0, -0.2, 0, hip);
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee); knees.push(knee);
    add(new THREE.CapsuleGeometry(0.064, 0.3, 6, 12), look.skirt ? skin : pants, 0, -0.2, 0, knee);
    // Shoe: sole and a rounded toe.
    add(new THREE.BoxGeometry(0.11, 0.035, 0.27), dark, 0, -0.47, 0.05, knee);
    add(new THREE.CapsuleGeometry(0.05, 0.14, 4, 10), shoe, 0, -0.43, 0.06, knee).rotation.x = Math.PI / 2;
  }
  add(new THREE.CapsuleGeometry(0.16, 0.12, 6, 14), pants, 0, 0.95, 0).scale.set(1.15, 1, 0.8);
  if (look.skirt) add(new THREE.CylinderGeometry(0.19, 0.27, 0.36, 20), shirt, 0, 0.8, 0);
  else {
    add(new THREE.CylinderGeometry(0.188, 0.188, 0.04, 20), dark, 0, 1.05, 0).scale.set(1.12, 1, 0.8);
    add(new THREE.BoxGeometry(0.05, 0.035, 0.02), matte("#c9a45c", 0.3), 0, 1.05, 0.15);
  }
  // Torso: shirt (or open jacket over the shirt) and the collar.
  add(new THREE.CapsuleGeometry(0.17, 0.3, 8, 18), jacket, 0, 1.25, 0).scale.set(feminine ? 1.0 : 1.18, 1, 0.72);
  if (look.jacket) add(new THREE.BoxGeometry(0.1, 0.42, 0.02), shirt, 0, 1.27, 0.122);
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.05, 0.03), shirt, side * 0.045, 1.47, 0.07).rotation.z = side * 0.5;
  add(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 12), skin, 0, 1.5, 0);
  // Head on its own pivot (the neck) so it can turn to whoever is talking.
  const head = new THREE.Group(); head.position.y = 1.52; rig.add(head);
  add(new THREE.SphereGeometry(0.13, 32, 24), skin, 0, 0.14, 0, head).scale.set(0.93, 1.1, 1);
  add(new THREE.SphereGeometry(0.085, 20, 14), skin, 0, 0.065, 0.035, head).scale.set(1, 0.8, 1.05);
  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(0.03, 10, 8), skinShade, side * 0.123, 0.14, -0.005, head).scale.set(0.5, 1, 0.8);
    add(new THREE.SphereGeometry(0.02, 10, 8), whites, side * 0.044, 0.16, 0.112, head).scale.set(1.2, 0.8, 0.6);
    add(new THREE.SphereGeometry(0.011, 8, 6), dark, side * 0.044, 0.16, 0.124, head);
    add(new THREE.BoxGeometry(0.05, 0.011, 0.012), hair, side * 0.045, 0.197, 0.118, head).rotation.z = side * -0.12;
  }
  add(new THREE.ConeGeometry(0.018, 0.05, 8), skinShade, 0, 0.125, 0.135, head).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.05, 0.012, 0.01), lips, 0, 0.083, 0.124, head);
  const cap = (r: number) => add(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 1.9), hair, 0, 0.16, -0.012, head);
  if (look.hairStyle === "curly") {
    cap(0.158).scale.set(1, 0.88, 1);
    for (let k = 0; k < 7; k++) add(new THREE.SphereGeometry(0.05, 10, 8), hair, Math.cos(k) * 0.11, 0.25 + (k % 2) * 0.03, Math.sin(k) * 0.09 - 0.02, head);
  } else cap(look.hairStyle === "buzz" ? 0.134 : 0.14);
  if (look.hairStyle === "long") {
    add(new THREE.CapsuleGeometry(0.12, 0.22, 6, 14), hair, 0, -0.02, -0.075, head).scale.set(1.08, 1, 0.45);
    for (const side of [-1, 1]) add(new THREE.CapsuleGeometry(0.035, 0.18, 4, 8), hair, side * 0.12, 0.04, 0.0, head);
  }
  if (look.hairStyle === "bun") add(new THREE.SphereGeometry(0.065, 14, 12), hair, 0, 0.3, -0.09, head);
  if (look.hairStyle === "ponytail") add(new THREE.CapsuleGeometry(0.045, 0.2, 4, 10), hair, 0, 0.05, -0.17, head).rotation.x = 0.35;
  if (look.glasses) {
    for (const side of [-1, 1]) add(new THREE.TorusGeometry(0.026, 0.005, 6, 16), dark, side * 0.044, 0.16, 0.128, head);
    add(new THREE.BoxGeometry(0.03, 0.006, 0.006), dark, 0, 0.165, 0.13, head);
  }
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * (feminine ? 0.22 : 0.25), 1.4, 0); rig.add(shoulder); shoulders.push(shoulder);
    add(new THREE.CapsuleGeometry(0.056, 0.2, 6, 12), jacket, 0, -0.14, 0, shoulder);
    const elbow = new THREE.Group(); elbow.position.y = -0.29; shoulder.add(elbow); elbows.push(elbow);
    add(new THREE.CapsuleGeometry(0.047, 0.16, 6, 12), look.jacket ? jacket : skin, 0, -0.1, 0, elbow);
    if (look.jacket) add(new THREE.CylinderGeometry(0.044, 0.044, 0.03, 10), shirt, 0, -0.2, 0, elbow);
    // Hand: palm and thumb.
    add(new THREE.SphereGeometry(0.045, 12, 10), skin, 0, -0.26, 0.005, elbow).scale.set(0.85, 1.15, 0.7);
    add(new THREE.CapsuleGeometry(0.013, 0.03, 4, 6), skin, side * -0.03, -0.24, 0.03, elbow).rotation.z = side * 0.6;
  }
  // Coffee mug in the right hand (snack bar and sofas).
  const mug = new THREE.Group(); mug.position.set(0, -0.3, 0.04); elbows[1].add(mug);
  add(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), matte("#f4f1ec", 0.4), 0, 0, 0, mug);
  add(new THREE.TorusGeometry(0.025, 0.007, 6, 12), matte("#f4f1ec", 0.4), 0.05, 0, 0, mug).rotation.y = Math.PI / 2;
  add(new THREE.CircleGeometry(0.04, 14), matte("#4a2c1a", 0.3), 0, 0.051, 0, mug).rotation.x = -Math.PI / 2;
  mug.visible = false;
  // Pool cue held in the right hand (shown at the pool table).
  const cue = new THREE.Group(); cue.position.set(0, -0.26, 0); elbows[1].add(cue);
  const stick = add(new THREE.CylinderGeometry(0.012, 0.022, 1.3, 8), matte("#c89b62", 0.5), 0, 0, 0.5, cue); stick.rotation.x = Math.PI / 2.2;
  cue.visible = false;
  // Phone in the left hand: a call to the broker or a look at the app.
  const phone = new THREE.Group(); phone.position.set(0, -0.29, 0.03); elbows[0].add(phone);
  add(new THREE.BoxGeometry(0.05, 0.1, 0.01), dark, 0, 0, 0, phone);
  phone.visible = false;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; group.add(shadow);
  group.scale.setScalar(S);
  return { group, rig, head, hips, knees, shoulders, elbows, mug, cue, phone };
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

/**
 * Quiet office background while the sound is on (owner, 26/10/2026: "telefone tocando, pessoas
 * conversando baixinho, digitando"): a murmur of voices, bursts of typing and, now and then, a
 * phone ringing far away. Everything is synthesised; returns the function that stops it.
 */
function startAmbience(ctx: AudioContext): () => void {
  const master = ctx.createGain(); master.connect(ctx.destination);
  master.gain.setValueAtTime(0, ctx.currentTime); master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  // Murmur: brown noise in the voice band, its pitch and loudness drifting like distant talk.
  const seconds = 4, data = new Float32Array(ctx.sampleRate * seconds);
  let last = 0;
  for (let i = 0; i < data.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
  const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate); buffer.copyToChannel(data, 0);
  const noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
  const band = ctx.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = 450; band.Q.value = 1.1;
  const murmur = ctx.createGain(); murmur.gain.value = 0.05;
  const swell = ctx.createOscillator(), swellDepth = ctx.createGain(); swell.frequency.value = 0.3; swellDepth.gain.value = 0.025;
  const syllables = ctx.createOscillator(), syllableDepth = ctx.createGain(); syllables.frequency.value = 3.1; syllableDepth.gain.value = 140;
  swell.connect(swellDepth).connect(murmur.gain); syllables.connect(syllableDepth).connect(band.frequency);
  noise.connect(band).connect(murmur).connect(master);
  noise.start(); swell.start(); syllables.start();
  // Keyboards: short filtered clicks in bursts.
  const clickData = new Float32Array(Math.round(ctx.sampleRate * 0.025));
  for (let i = 0; i < clickData.length; i++) clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.004));
  const clickBuffer = ctx.createBuffer(1, clickData.length, ctx.sampleRate); clickBuffer.copyToChannel(clickData, 0);
  const keys = ctx.createBiquadFilter(); keys.type = "highpass"; keys.frequency.value = 1800; keys.connect(master);
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };
  const typing = () => {
    let at = ctx.currentTime + 0.05;
    for (let k = 0, n = 6 + Math.floor(Math.random() * 14); k < n; k++) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = clickBuffer; g.gain.value = 0.025 + Math.random() * 0.03;
      src.connect(g).connect(keys); src.start(at); at += 0.07 + Math.random() * 0.12;
    }
    later(typing, 1200 + Math.random() * 3500);
  };
  // A phone in another room: two rings of the 440 + 480 Hz tone, muffled.
  const phone = () => {
    const muffle = ctx.createBiquadFilter(); muffle.type = "lowpass"; muffle.frequency.value = 1400; muffle.connect(master);
    const ring = ctx.createGain(); ring.gain.value = 0; ring.connect(muffle);
    const tones = [440, 480].map((f) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(ring); o.start(); return o; });
    const t0 = ctx.currentTime + 0.05;
    for (const start of [0, 2.6]) {
      ring.gain.setValueAtTime(0, t0 + start); ring.gain.linearRampToValueAtTime(0.012, t0 + start + 0.05);
      ring.gain.setValueAtTime(0.012, t0 + start + 1.4); ring.gain.linearRampToValueAtTime(0, t0 + start + 1.5);
    }
    tones.forEach((o) => o.stop(t0 + 4.2));
    later(phone, 45000 + Math.random() * 60000);
  };
  later(typing, 800); later(phone, 15000 + Math.random() * 30000);
  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    window.setTimeout(() => { noise.stop(); swell.stop(); syllables.stop(); master.disconnect(); }, 500);
  };
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

export function Office3D({ agents, boss, assistantTip, tvHeadline, tvLines, selected, onSelect, meeting = null }: {
  agents: OfficeAgent[]; boss: Money;
  /** Latest end-of-day meeting minutes (team_meetings). */
  meeting?: Meeting | null;
  /** What the boss's assistant reports when he walks to the boss (best stock outside the team). */
  assistantTip?: string;
  tvHeadline: { title: string; source: string } | null; tvLines: [string, string, string][];
  selected: string | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ sync: (agents: OfficeAgent[], selected: string | null, boss: Money, meeting: Meeting | null) => void;
    tv: (h: typeof tvHeadline, l: typeof tvLines) => void; reset: () => void; sound: (on: boolean) => void; tip: (text: string) => void } | null>(null);
  const select = useRef(onSelect);
  const [failed, setFailed] = useState(false);
  const [help, setHelp] = useState(false);
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
    let audio: AudioContext | null = null, soundOn = true, stopAmbience: (() => void) | null = null;
    const startAmbienceIfOn = () => { if (soundOn && audio?.state === "running" && !stopAmbience) stopAmbience = startAmbience(audio); };
    const unlockAudio = () => { try { audio ??= new AudioContext(); void audio.resume().then(startAmbienceIfOn); } catch { audio = null; } };

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
    // Paint (owner, 26/10/2026: "tudo muito branco... moderno e colorido, mas sério"): warm oak floor,
    // deep blue-slate walls, a coloured rug for each area and the coloured council walls.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 28), matte("#a07f5f", 0.7));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const rug = (w: number, d: number, x: number, z: number, c: string) => box(w, 0.02, d, x, 0.011, z, matte(c, 1), false);
    rug(27, 8.4, -8.5, 0.4, "#2f3b52");
    rug(16, 5.8, -2, 10.4, "#6b3a48");
    rug(16.4, 7.6, 15.8, 10.1, "#c98b5e");
    rug(12, 8, 16.5, 0.4, "#24504c");

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
    const paint = matte("#2e4057", 0.85);
    const backWall = wall(-24, -14, 24, -14, H, paint, true, [0, -1]);
    const leftWall = wall(-24, -14, -24, 14, H, paint, true, [-1, 0]);
    const rightWall = wall(24, -14, 24, 14, H, paint, true, [1, 0]);
    wall(-24, 14, -21.5, 14, H, paint, true, [0, 1]);
    wall(-17, 14, 24, 14, H, paint, true, [0, 1]);
    const accents = ["#f07b2b", "#2f6fd6", "#f2b33d", "#1fa3b8"];
    [-17.33, -10.67, -4, 2.67, 10.67].forEach((x, i) => wall(x, -14, x, -6, Hi, matte(accents[i % accents.length], 0.8), false));
    for (const r of COUNCILS) { glassWall(r.x1 + 0.1, -6, r.door - 0.8, -6); glassWall(r.door + 0.8, -6, r.x2 - 0.1, -6); }
    glassWall(2.77, -6, BOSS_X - 0.8, -6); glassWall(BOSS_X + 0.8, -6, 10.57, -6);
    // Meeting room front: glass by the door, then a solid wall that carries the market screen.
    glassWall(10.77, -6, MEETING_DOOR - 0.8, -6);
    box(24 - (MEETING_DOOR + 0.8), Hi, 0.2, (24 + MEETING_DOOR + 0.8) / 2, Hi / 2, -6, paint);

    // Room names are painted on each room's own screen or board (no floating signs that turn with the camera).

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

    // Desk islands: four desks, two facing two, screens back to back with a low divider and a
    // pendant lamp above. Left monitor = candles, right monitor = price now / beep alert.
    for (const [cx, cz] of ISLANDS) {
      box(4.9, 0.36, 0.05, cx, 1.16, cz, matte("#d7dde3", 0.4));
      cyl(0.04, 0.04, 0.9, cx, 3.0, cz, metal);
      const lamp = box(3.6, 0.08, 0.32, cx, 2.55, cz, matte("#fff6e5", 0.5), false);
      (lamp.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffe2a8); (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
    }
    const desks = DESKS.map((d, i) => {
      const { x, z, dir } = d, [, seatZ] = seatOf(d);
      box(2.4, 0.06, 1.1, x, 0.95, z, white);
      for (const dx of [-1.1, 1.1]) box(0.06, 0.92, 1.0, x + dx, 0.46, z, metal);
      const screens = [-0.55, 0.55].map((dx) => {
        const t = canvasTexture(640, 400);
        box(1.02, 0.66, 0.04, x + dx, 1.55, z - dir * 0.38, metal);
        box(0.06, 0.4, 0.06, x + dx, 1.17, z - dir * 0.4, metal);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.6), new THREE.MeshBasicMaterial({ map: t.texture, toneMapped: false }));
        s.position.set(x + dx, 1.55, z - dir * 0.355); s.rotation.y = dir === 1 ? 0 : Math.PI; scene.add(s);
        return t;
      });
      box(0.6, 0.02, 0.2, x, 0.99, z + dir * 0.15, metal);
      chair(x, seatZ, dir === 1 ? Math.PI : 0, ["#f07b2b", "#2f6fd6", "#22a06b", "#1fa3b8"][i % 4]);
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
      if (agent) drawChart(room.screen.g, 0, 0, 900, 380, `Conselho ${i + 1} · em análise: ${agent.ticker}`, agent.chart);
      else {
        const g = room.screen.g; g.fillStyle = "#06121d"; g.fillRect(0, 0, 900, 380);
        g.fillStyle = "#4e6478"; g.font = "bold 40px sans-serif"; g.textBaseline = "middle"; g.textAlign = "center"; g.fillText(`Conselho ${i + 1}`, 450, 160);
        g.font = "28px sans-serif"; g.fillText("sala livre · Risco · Balanço · Previsão · Estratégia", 450, 230); g.textAlign = "left";
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
    box(2.6, 0.06, 1.2, BOSS_X, 0.95, -10.6, darkWood);
    for (const dx of [-1.2, 1.2]) box(0.06, 0.92, 1.1, BOSS_X + dx, 0.46, -10.6, metal);
    box(0.9, 0.55, 0.04, BOSS_X, 1.35, -10.2, metal);
    chair(BOSS_X, -11.6, 0, "#2b2e34");
    sofa(2.0, BOSS_X - 2.3, -7.4, Math.PI, "#8c8274"); plant(BOSS_X - 3.3, -13.2, 0.8);
    const bossScreen = canvasTexture(1000, 560);
    const bossFrame = box(4.6, 2.6, 0.08, BOSS_X, 2.2, -13.85, metal);
    const bossTv = new THREE.Mesh(new THREE.PlaneGeometry(4.45, 2.45), new THREE.MeshBasicMaterial({ map: bossScreen.texture, toneMapped: false }));
    bossTv.position.set(BOSS_X, 2.2, -13.8); scene.add(bossTv);
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
      g.fillStyle = "#a9c0d6"; g.font = "26px sans-serif"; g.fillText("A equipe: ações na Genial ou quanto o Chefe libera agora", 30, 140);
      list.slice(0, 12).forEach((a, i) => {
        const x = 30 + (i % 2) * 490, y = 186 + Math.floor(i / 2) * 58;
        g.fillStyle = "#e8f6ff"; g.font = "bold 26px sans-serif"; g.fillText(`${a.name} · ${a.ticker}`, x, y);
        g.font = "26px sans-serif"; g.fillStyle = a.holding > 0 ? "#3dffa8" : a.budget > 0 ? "#ffc65c" : "#8ea4ba";
        g.fillText(a.holding > 0 ? `${a.holding} ações · ${signed(a.pnl)}` : a.budget > 0 ? `libera ${brl(a.budget)}` : "aguardando", x + 250, y);
      });
      bossScreen.texture.needsUpdate = true;
    };

    // Snack bar (front right): counter along the right wall with coffee machine and fridges,
    // stools, two high tables, and the pool table next to it.
    box(0.8, 1.05, 6.0, 22.6, 0.52, 9.5, matte("#f07b2b", 0.7));
    box(0.95, 0.06, 6.2, 22.55, 1.07, 9.5, darkWood);
    box(0.5, 0.7, 0.6, 22.7, 1.45, 7.2, metal); box(0.05, 0.2, 0.35, 22.42, 1.6, 7.2, matte("#ffb24a", 0.4));
    box(0.7, 2.2, 1.0, 23.5, 1.1, 12.9, steel); box(0.7, 2.2, 1.0, 23.5, 1.1, 5.9, steel);
    for (const [, z] of BAR_SPOTS) { cyl(0.22, 0.22, 0.05, 21.9, 0.78, z, fabric("#1f2a44")); cyl(0.03, 0.03, 0.76, 21.9, 0.38, z, metal); }
    for (const [x, z] of KITCHEN_TABLES) { cyl(0.55, 0.55, 0.05, x, 1.1, z, wood); cyl(0.05, 0.05, 1.08, x, 0.54, z, metal); cyl(0.3, 0.3, 0.03, x, 0.015, z, metal); }
    {
      const [px, pz] = POOL_TABLE;
      box(3.2, 0.2, 1.7, px, 0.82, pz, darkWood);
      box(2.9, 0.04, 1.4, px, 0.93, pz, matte("#0f6b4e", 0.95));
      for (const [dx, dz] of [[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.7], [1.4, 0.7]]) box(0.16, 0.74, 0.16, px + dx, 0.37, pz + dz, darkWood);
      const pendant = box(2.6, 0.1, 0.4, px, 2.5, pz, matte("#1b1e24", 0.4), false);
      (pendant.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x553a12);
    }
    pouf(9.4, 13.2, "#d6336c", 0.5); pouf(14.2, 13.3, "#f2b33d", 0.5); pouf(19.0, 13.3, "#1fa3b8", 0.5);

    // Pool balls: cue ball and seven coloured balls on the felt (table coordinates, metres).
    const FELT = { x: 1.42, z: 0.67 }, BALL_R = 0.045;
    const POCKETS: V2[] = [[-1.45, -0.7], [0, -0.72], [1.45, -0.7], [-1.45, 0.7], [0, 0.72], [1.45, 0.7]];
    const balls = [0xffffff, 0xf2c014, 0x1f5fd6, 0xd62828, 0x6a2c91, 0xf07b2b, 0x1d8a4a, 0x111111].map((color) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.05 }));
      mesh.castShadow = true; scene.add(mesh);
      return { mesh, x: 0, z: 0, vx: 0, vz: 0, potted: false };
    });
    const rack = () => {
      balls[0].x = -0.8; balls[0].z = 0;
      const spots: V2[] = [[0.55, 0], [0.63, -0.05], [0.63, 0.05], [0.71, -0.1], [0.71, 0], [0.71, 0.1], [0.79, -0.05]];
      balls.forEach((b, k) => { if (k) [b.x, b.z] = spots[k - 1]; b.vx = b.vz = 0; b.potted = false; b.mesh.visible = true; });
    };
    rack();

    // Team meeting room: long table, twelve chairs, the minutes on the wall screen.
    {
      const [mx, mz] = MEETING_TABLE;
      box(9.4, 0.08, 2.2, mx, 0.95, mz, wood);
      for (const dx of [-3.6, 0, 3.6]) box(0.5, 0.9, 0.5, mx + dx, 0.46, mz, metal);
      MEETING_SEATS.forEach(({ pos, face }) => chair(pos[0], pos[1], face, "#3b3f47"));
      chair(BOSS_SEAT[0], BOSS_SEAT[1], Math.PI / 2, "#1f2a44"); chair(SUPERVISOR_SEAT[0], SUPERVISOR_SEAT[1], -Math.PI / 2, "#b8860b");
      plant(11.4, -13.2, 0.8); plant(23.3, -13.2, 0.8);
    }
    const meetingScreen = canvasTexture(1600, 520);
    const meetingFrame = box(7.2, 2.4, 0.08, MEETING_TABLE[0], 2.0, -13.85, metal);
    const meetingTv = new THREE.Mesh(new THREE.PlaneGeometry(7.0, 2.25), new THREE.MeshBasicMaterial({ map: meetingScreen.texture, toneMapped: false }));
    meetingTv.position.set(MEETING_TABLE[0], 2.0, -13.8); scene.add(meetingTv);
    backWall.items.push(meetingFrame, meetingTv);
    let meetingKey = "";
    const drawMeeting = (m: Meeting | null, live: boolean) => {
      const key = JSON.stringify([m?.day, live]);
      if (key === meetingKey) return;
      meetingKey = key;
      const g = meetingScreen.g;
      g.fillStyle = "#06121d"; g.fillRect(0, 0, 1600, 520); g.textBaseline = "top"; g.textAlign = "left";
      g.fillStyle = "#ffc65c"; g.font = "bold 44px sans-serif";
      g.fillText(live ? "SALA DE REUNIÕES · reunião de fim de dia agora" : "SALA DE REUNIÕES · reunião diária às 17h10", 30, 22);
      if (!m) { g.fillStyle = "#8ea4ba"; g.font = "32px sans-serif"; g.fillText("A primeira reunião acontece no fim do próximo pregão.", 30, 110); }
      else {
        g.fillStyle = "#a9c0d6"; g.font = "28px sans-serif"; g.fillText(`Última reunião: ${m.day.split("-").reverse().join("/")}`, 30, 84);
        const rows = [...m.summary, ...m.lessons, ...m.suggestions.slice(0, 2)];
        g.font = "26px sans-serif";
        let y = 130;
        for (const row of rows) {
          let line = "";
          for (const word of `• ${row}`.split(" ")) {
            if (g.measureText(`${line} ${word}`).width > 1520 && line) { g.fillStyle = "#e8f6ff"; g.fillText(line, 30, y); y += 34; line = `  ${word}`; }
            else line = line ? `${line} ${word}` : word;
            if (y > 470) break;
          }
          if (y > 470) break;
          g.fillStyle = "#e8f6ff"; g.fillText(line, 30, y); y += 40;
        }
      }
      meetingScreen.texture.needsUpdate = true;
    };
    drawMeeting(null, false);

    // Reception: logo wall, desk with the receptionist, waiting poufs.
    box(7.4, 3, 0.25, -19.5, 1.5, 6.2, matte("#f07b2b", 0.75));
    // Company logo painted on the front of the wall (owner: "só de um lado, como se fosse uma logo"),
    // not a label that turns with the camera.
    {
      const logo = canvasTexture(1024, 384), g = logo.g;
      g.clearRect(0, 0, 1024, 384); g.textAlign = "center"; g.textBaseline = "middle";
      g.shadowColor = "rgba(255, 207, 138, 0.8)"; g.shadowBlur = 24;
      g.fillStyle = "#fff4e2"; g.font = "bold 190px sans-serif"; g.fillText("ATLAS", 512, 160);
      g.shadowBlur = 0; g.fillStyle = "#ffe0b8"; g.font = "600 52px sans-serif"; g.fillText("Trading AI System", 512, 300);
      logo.texture.needsUpdate = true;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.1), new THREE.MeshBasicMaterial({ map: logo.texture, transparent: true, toneMapped: false }));
      sign.position.set(-19.5, 1.75, 6.34); scene.add(sign);
    }
    box(3.6, 1.05, 0.8, -19.5, 0.52, 9.4, white); box(3.8, 0.06, 0.95, -19.5, 1.07, 9.4, wood);
    pouf(-21.8, 12.2, "#1fa3b8"); pouf(-20.6, 12.4, "#f2b33d"); pouf(-17.4, 12.2, "#d6336c");
    plant(-23, 7, 0.9);

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
    pouf(-2.9, 12.8, "#f2b33d"); pouf(0.4, 12.8, "#22a06b"); plant(-12.8, 12.6);

    // Market room and game corner.
    const wallCanvas = canvasTexture(2400, 820);
    box(7.8, 2.75, 0.08, 17.3, 1.65, -5.86, metal);
    const wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 2.6), new THREE.MeshBasicMaterial({ map: wallCanvas.texture, toneMapped: false }));
    wallScreen.position.set(17.3, 1.65, -5.81); scene.add(wallScreen);
    // Sofas around the chart wall, where resting agents sit, chat and look at the charts.
    sofa(4.4, 17.3, 1.4, Math.PI, "#2f6fd6");
    sofa(2.6, 13.6, -1.6, Math.PI / 2, "#1fa3b8"); sofa(2.6, 21.0, -1.6, -Math.PI / 2, "#1fa3b8");
    cyl(0.42, 0.42, 0.06, 17.3, 0.45, -1.2, white); cyl(0.06, 0.1, 0.42, 17.3, 0.21, -1.2, metal);
    let wallKey = "";
    const drawWall = (list: OfficeAgent[]) => {
      const key = list.map((a) => `${a.ticker}:${a.chart?.last}:${a.chart?.bars.length}`).join("|");
      if (key === wallKey) return;
      wallKey = key;
      wallCanvas.g.fillStyle = "#010810"; wallCanvas.g.fillRect(0, 0, 2400, 820);
      wallCanvas.g.fillStyle = "#ffc65c"; wallCanvas.g.font = "bold 40px sans-serif"; wallCanvas.g.textBaseline = "middle"; wallCanvas.g.textAlign = "left";
      wallCanvas.g.fillText("SALA DO MERCADO · ações da equipe", 16, 34);
      list.slice(0, 12).forEach((a, i) => drawChart(wallCanvas.g, 8 + (i % 6) * 398, 68 + Math.floor(i / 6) * 376, 390, 368, `${a.ticker} · ${a.name}`, a.chart, 0.6));
      wallCanvas.texture.needsUpdate = true;
    };

    // Decoration: murals, bookshelves, floor lamps, coffee bar.
    const PALETTE = ["#f07b2b", "#2f6fd6", "#f2b33d", "#d6336c", "#1fa3b8", "#22a06b"];
    const mural = (w: number, h: number, x: number, y: number, z: number, turn: number, seed: number, onWall: { items: THREE.Object3D[] }) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: muralTexture(seed, PALETTE), roughness: 0.9 }));
      m.position.set(x, y, z); m.rotation.y = turn; scene.add(m); onWall.items.push(m);
    };
    mural(9, 2.6, -23.88, 1.7, -0.5, Math.PI / 2, 7, leftWall);
    mural(4.6, 0.8, BOSS_X, 3.1, -13.88, 0, 47, backWall);
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
    mural(4.2, 2.2, 23.88, 1.9, 3.4, -Math.PI / 2, 21, rightWall);
    const floorLamp = (x: number, z: number) => {
      cyl(0.03, 0.03, 1.9, x, 0.95, z, metal); cyl(0.22, 0.22, 0.04, x, 0.02, z, metal);
      const shade = cyl(0.28, 0.36, 0.4, x, 2.0, z, matte("#fff6e5", 0.6));
      (shade.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffe2a8); (shade.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
    };
    floorLamp(-10.6, 12.8); floorLamp(6.6, 12.8); floorLamp(11, 4.6); floorLamp(-22.6, 11.4);
    // Coffee bar extras: menu board and a fruit bowl.
    const menu = canvasTexture(512, 256);
    menu.g.fillStyle = "#1b1e24"; menu.g.fillRect(0, 0, 512, 256); menu.g.fillStyle = "#ffc65c"; menu.g.font = "bold 44px sans-serif";
    menu.g.fillText("LANCHONETE ATLAS", 30, 70); menu.g.fillStyle = "#e8f6ff"; menu.g.font = "30px sans-serif";
    ["espresso · pão de queijo", "cappuccino · sanduíche", "suco · salada de frutas"].forEach((line, i) => menu.g.fillText(`· ${line}`, 40, 130 + i * 40));
    menu.texture.needsUpdate = true;
    const menuBoard = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: menu.texture }));
    menuBoard.position.set(23.88, 2.5, 9.5); menuBoard.rotation.y = -Math.PI / 2; scene.add(menuBoard); rightWall.items.push(menuBoard);
    cyl(0.25, 0.15, 0.12, 22.5, 1.16, 10.6, matte("#f4f1ec", 0.4));
    [0xff5d4d, 0xffc65c, 0x7ed957].forEach((c, i) => {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), matte(c, 0.5)); fruit.position.set(22.45 + (i % 2) * 0.06, 1.26, 10.5 + i * 0.09); scene.add(fruit);
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
    let roomAgents: (OfficeAgent | null)[] = COUNCILS.map(() => null);
    // Staff show only the name; the role appears when the mouse is over it (owner, 26/10/2026).
    const tagged = (person: Person, title: string, subtitle = "") => {
      const tag = plaque(title, subtitle, "plaque staff-plate"); tag.position.set(0, 2.05, 0); person.rig.add(tag);
      tag.element.title = subtitle ? `${title}: ${subtitle}` : title; return tag;
    };
    const bossPerson = makePerson({ presentation: "masculine", skin: "#d9a07a", hair: "#9a9a9a", hairStyle: "short", shirt: "#f4f4f4", pants: "#1b1e24", jacket: "#1f2a44", glasses: true });
    bossPerson.group.position.set(BOSS_X, 0, -11.6); scene.add(bossPerson.group);
    const bossTag = tagged(bossPerson, "Chefe", "cuida do dinheiro");
    const bossStaff: { person: Person; pose: Pose; phase: number } = { person: bossPerson, pose: "type", phase: 7 };
    staff.push(bossStaff);
    const BOSS_DESK: V2 = [BOSS_X, -11.6];
    // Boss and supervisor walk to the meeting room at 17:10 and back afterwards.
    const toMeeting = (from: V2, seat: V2): V2[] => [[from[0], -7.2], [from[0], CORRIDOR_Z], [MEETING_DOOR, CORRIDOR_Z], [MEETING_DOOR, -7.2], [seat[0], -7.2], seat];
    const fromMeeting = (seat: V2, to: V2): V2[] => [[seat[0], -7.2], [MEETING_DOOR, -7.2], [MEETING_DOOR, CORRIDOR_Z], [to[0], CORRIDOR_Z], [to[0], -7.2], to];
    let bossState: "desk" | "going" | "meeting" | "back" = "desk", supState: "patrol" | "going" | "meeting" = "patrol";
    const bossPath: V2[] = [];
    // The boss's assistant watches stocks outside the team (the list under the office).
    box(1.3, 0.06, 0.7, BOSS_X + 2.8, 0.95, -8.4, white); box(0.6, 0.4, 0.04, BOSS_X + 2.8, 1.25, -8.7, metal);
    const assistant = makePerson({ presentation: "masculine", skin: "#c68863", hair: "#2b1a12", hairStyle: "curly", shirt: "#5c6bc0", pants: "#2d3142" });
    const ASSIST_DESK: V2 = [BOSS_X + 2.8, -7.6];
    assistant.group.position.set(ASSIST_DESK[0], 0, ASSIST_DESK[1]); assistant.group.rotation.y = Math.PI; scene.add(assistant.group);
    chair(BOSS_X + 2.8, -7.6, Math.PI, "#5c6bc0"); tagged(assistant, "Assistente", "vigia outras ações");
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
    chair(-19.5, 8.3, 0, "#f07b2b"); tagged(receptionist, "Recepcionista");
    staff.push({ person: receptionist, pose: "type", phase: 9 });
    const supervisor = makePerson({ presentation: "feminine", skin: "#8d5a3b", hair: "#120c08", hairStyle: "bun", shirt: "#ffc65c", pants: "#2d3142" });
    scene.add(supervisor.group);
    tagged(supervisor, "Supervisora", "acompanha a equipe");
    const supBubbleEl = document.createElement("div"); supBubbleEl.className = "speech-bubble"; supBubbleEl.hidden = true;
    const supBubble = new CSS2DObject(supBubbleEl); supBubble.position.set(0, 2.75, 0); supervisor.rig.add(supBubble);
    // Patrol: past every desk (stopping to check), the council corridor and the lounges.
    const deskStop = (i: number) => { const d = DESKS[i], [x, z] = seatOf(d); return { at: [x, z + d.dir * 0.95] as V2, face: d.dir === 1 ? Math.PI : 0, wait: 3, desk: i }; };
    const byX = (dir: number, sign: number) => DESKS.map((d, i) => ({ d, i })).filter(({ d }) => d.dir === dir).sort((a, b) => sign * (a.d.x - b.d.x)).map(({ i }) => deskStop(i));
    const patrol: { at: V2; face?: number; wait?: number; desk?: number }[] = [
      { at: [-21.5, -4.2] }, { at: [-21.5, -2.1] }, ...byX(-1, 1), { at: [5.6, -2.1] }, { at: [5.6, 2.9] }, ...byX(1, -1),
      { at: [-21.5, 2.9] }, { at: [-21.5, -4.6] }, { at: [8.6, -4.6] }, { at: [8.6, -4.2], wait: 2 },
    ];
    let patrolIndex = 0, patrolWait = 0, supTalkUntil = 0;
    const supPath: V2[] = [];
    supervisor.group.position.set(-21.5, 0, -4.2);
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
    let meetingNow = false, meetingData: Meeting | null = null, meetingTurn = 0, meetingTimer = 3;
    const sync = (list: OfficeAgent[], sel: string | null, cash: Money, meeting: Meeting | null) => {
      meetingData = meeting; meetingNow = meetingDue(new Date()).live;
      drawMeeting(meeting, meetingNow);
      for (const a of list) latest.set(a.id, a);
      const counters: Partial<Record<OfficeZone, number>> = {};
      const inRoom: (OfficeAgent | null)[] = COUNCILS.map(() => null);
      // Each agent has its own council room (by desk); when it is taken, the emptiest one.
      const roomCount = COUNCILS.map(() => 0);
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
        let index = counters[zone] ?? 0; counters[zone] = index + 1;
        if (zone === "MEETING") {
          const own = desk % COUNCILS.length;
          const room = roomCount[own] === 0 ? own : roomCount.indexOf(Math.min(...roomCount));
          index = room + COUNCILS.length * roomCount[room]; roomCount[room]++;
          inRoom[room] ??= agent;
        }
        if (meetingNow) {
          // End-of-day meeting: everyone at the long table.
          if (r.rest) { releaseSpot(r.rest.activity, r.rest.spot); r.rest = null; }
          r.zone = "MEETING";
          setTarget(r, meetingSlot(i), `TEAM:${i}`, first);
        } else if (!first && r.zone && REST_ZONES.includes(r.zone) && !REST_ZONES.includes(zone)) callToWork(r, agent, desk);
        if (!meetingNow) r.zone = zone;
        if (meetingNow) { /* seated above */ } else if (REST_ZONES.includes(zone)) {
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
        // Label (owner: "muito poluído, mas tem que ter essas informações"): one compact line with a
        // status dot, name, stock and today's move; company, holding and status on hover/selection.
        const { change } = quoteOf(agent.chart);
        const status = agent.holding > 0 ? "own" : meetingNow ? "council" : !agent.marketOpen ? "closed" : agent.debate?.verdict === "COMPRAR" ? "buy" : zone === "MEETING" ? "council" : "wait";
        const statusText = agent.holding > 0 ? `${agent.holding} ${agent.holding === 1 ? "ação" : "ações"} · ${signed(agent.pnl)}`
          : meetingNow ? "na reunião de fim de dia" : !agent.marketOpen ? "bolsa fechada" : agent.debate?.verdict === "COMPRAR" ? "vai comprar" : zone === "MEETING" ? "no conselho" : "esperando preço baixo";
        r.labelEl.className = `agent3d-label person compact ${tone(agent.pnl)} ${sel === agent.id ? "selected" : ""}`;
        r.labelEl.replaceChildren();
        const head = document.createElement("span"); head.className = "label-head";
        const dot = document.createElement("i"); dot.className = `status-dot ${status}`;
        const name = document.createElement("b"); name.textContent = `${agent.name} · ${agent.ticker}`;
        const trend = document.createElement("small");
        trend.className = change === null || Math.abs(change) < 0.0005 ? "" : change > 0 ? "up" : "down";
        trend.textContent = change === null ? "" : `${change >= 0 ? "▲" : "▼"}${(Math.abs(change) * 100).toFixed(1)}%`;
        head.append(dot, name, trend);
        const detail = document.createElement("span"); detail.className = "label-detail";
        const company = document.createElement("em"); company.textContent = companyProfile(agent.ticker).name;
        const line = document.createElement("span"); line.textContent = statusText;
        detail.append(company, line);
        r.labelEl.append(head, detail);
        r.labelEl.title = `${agent.name}: ${statusText}. ${agent.activity}`;
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
    // The middle button turns the office: stop the browser's auto-scroll from moving the page.
    const noAutoScroll = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    labels.domElement.addEventListener("mousedown", noAutoScroll);
    labels.domElement.addEventListener("auxclick", noAutoScroll);

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
      p.mug.visible = kind === "chat"; p.cue.visible = kind === "cue"; p.phone.visible = false;
      p.shoulders.forEach((s) => (s.rotation.z = 0));
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
        // At the desk: mostly typing; now and then a call to the broker or a look at the colleague opposite.
        const moment = reduced ? 0.5 : ((t / 40 + phase * 0.37) % 1);
        p.shoulders.forEach((s, i) => (s.rotation.x = -0.75 + (reduced ? 0 : Math.sin(t * 16 + phase + i) * 0.05)));
        p.elbows.forEach((e) => (e.rotation.x = -0.85));
        p.head.rotation.x = 0.12;
        if (moment < 0.1) {
          p.phone.visible = true;
          p.shoulders[0].rotation.x = -0.45; p.shoulders[0].rotation.z = 0.35; p.elbows[0].rotation.x = -2.5;
          p.head.rotation.x = 0; p.head.rotation.z = 0.12;
        } else if (moment < 0.17) {
          p.shoulders.forEach((s) => (s.rotation.x = -0.35)); p.elbows.forEach((e) => (e.rotation.x = -0.6));
          p.head.rotation.x = -0.12; p.head.rotation.y = Math.sin(t * 0.8 + phase) * 0.3;
        }
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
        // Half of them with a coffee on the sofa, a sip now and then.
        if (Math.floor(phase * 3) % 2 === 0) {
          const sip = reduced ? 0 : Math.max(0, Math.sin(t * 0.5 + phase) - 0.75) * 4;
          p.mug.visible = true; p.shoulders[1].rotation.x = -0.55 - sip * 0.4; p.elbows[1].rotation.x = -1.3 - sip * 0.5; p.head.rotation.x = -sip * 0.15;
        }
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

    let shooter: Walker | null = null, shotAt = 0, shotDone = true, poolTurn = 0, poolWait = 1;
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
        } else if (r.slot) {
          // Pool: only the player whose turn it is leans in with the cue; the others wait holding theirs.
          if (r.slot.pose === "cue") { pose(r, shooter === r && performance.now() < shotAt ? "cue" : "stand", t, r.phase); r.cue.visible = true; }
          else pose(r, r.slot.pose, t, r.phase);
        }
      }
      // Pool game: when the balls stop, the next player shoots the cue ball at a coloured ball.
      {
        const players = [...people.values()].filter((r) => r.rest?.activity === "POOL" && !r.path.length);
        const moving = balls.some((b) => !b.potted && Math.hypot(b.vx, b.vz) > 0.01);
        if (shooter && performance.now() >= shotAt && !shotDone) {
          const cue = balls[0], targets = balls.filter((b, k) => k && !b.potted);
          const target = targets[Math.floor(Math.random() * targets.length)];
          if (target) {
            const angle = Math.atan2(target.z - cue.z, target.x - cue.x) + (Math.random() - 0.5) * 0.12, speed = 1.4 + Math.random();
            cue.vx = Math.cos(angle) * speed; cue.vz = Math.sin(angle) * speed;
          }
          shotDone = true;
        }
        if (!moving && performance.now() > shotAt + 600) {
          if (balls[0].potted) { balls[0].potted = false; balls[0].mesh.visible = true; balls[0].x = -0.8; balls[0].z = 0; }
          if (balls.filter((b, k) => k && !b.potted).length <= 1) rack();
          poolWait -= dt;
          if (players.length && poolWait <= 0) {
            shooter = players[poolTurn++ % players.length]; shotAt = performance.now() + 1700; shotDone = false; poolWait = 2.5;
            if (shooter.bubbleEl.hidden && Math.random() < 0.3) show(shooter.bubbleEl, ["Minha vez!", "Bola 3 na caçapa do canto.", "Essa é fácil..."][poolTurn % 3], 2);
          }
        }
        for (let step = 0; step < 2; step++) {
          const h = dt / 2;
          for (const b of balls) {
            if (b.potted) continue;
            b.x += b.vx * h; b.z += b.vz * h;
            const drag = Math.exp(-0.9 * h); b.vx *= drag; b.vz *= drag;
            if (Math.hypot(b.vx, b.vz) < 0.02) b.vx = b.vz = 0;
            if (Math.abs(b.x) > FELT.x) { b.x = Math.sign(b.x) * FELT.x; b.vx *= -0.8; }
            if (Math.abs(b.z) > FELT.z) { b.z = Math.sign(b.z) * FELT.z; b.vz *= -0.8; }
            if (POCKETS.some(([px, pz]) => Math.hypot(b.x - px, b.z - pz) < 0.09)) { b.potted = true; b.vx = b.vz = 0; b.mesh.visible = false; }
          }
          for (let a = 0; a < balls.length; a++) for (let c = a + 1; c < balls.length; c++) {
            const p = balls[a], q = balls[c];
            if (p.potted || q.potted) continue;
            const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
            if (d === 0 || d >= BALL_R * 2) continue;
            const nx = dx / d, nz = dz / d, push = (BALL_R * 2 - d) / 2;
            p.x -= nx * push; p.z -= nz * push; q.x += nx * push; q.z += nz * push;
            const rel = (q.vx - p.vx) * nx + (q.vz - p.vz) * nz;
            if (rel < 0) { p.vx += rel * nx; p.vz += rel * nz; q.vx -= rel * nx; q.vz -= rel * nz; }
          }
        }
        for (const b of balls) b.mesh.position.set(POOL_TABLE[0] + b.x, 0.95 + BALL_R, POOL_TABLE[1] + b.z);
      }
      // End-of-day meeting: each agent says its part of the minutes, in turn.
      if (meetingNow && meetingData?.lines.length) {
        meetingTimer -= dt;
        if (meetingTimer <= 0) {
          meetingTimer = 5;
          const line = meetingData.lines[meetingTurn++ % meetingData.lines.length];
          const text = line.text.length > 110 ? `${line.text.slice(0, 108)}…` : line.text;
          if (line.agentId === "BOSS") { if (bossState === "meeting") show(bossBubble, text, 4.8); }
          else if (line.agentId === "SUPERVISOR") { if (supState === "meeting") { supBubbleEl.textContent = text; supBubbleEl.hidden = false; supTalkUntil = performance.now() + 4800; } }
          else { const speaker = people.get(line.agentId); if (speaker && !speaker.path.length) show(speaker.bubbleEl, text, 4.8); }
        }
      }
      // Boss: to the head of the meeting table at 17:10, back to the desk afterwards.
      if (meetingNow && bossState === "desk") { bossState = "going"; bossPath.push(...toMeeting(BOSS_DESK, BOSS_SEAT)); }
      if (!meetingNow && bossState === "meeting") { bossState = "back"; bossPath.push(...fromMeeting(BOSS_SEAT, BOSS_DESK)); }
      if (bossPath.length) { walk(bossPerson, bossPath, reduced ? 40 : 1.6, dt); pose(bossPerson, "walk", t, 7); }
      else if (bossState === "going") { bossState = "meeting"; bossPerson.group.rotation.y = Math.PI / 2; bossStaff.pose = "talk"; }
      else if (bossState === "back") { bossState = "desk"; bossPerson.group.rotation.y = 0; bossStaff.pose = "type"; }
      for (const s of staff) if (s !== bossStaff || !bossPath.length) pose(s.person, s.pose, t, s.phase);
      // Assistant routine: desk → boss (report) → desk.
      assistTimer -= dt;
      if (assistState === "desk") {
        pose(assistant, "type", t, 11);
        if (assistTimer <= 0) { assistState = "going"; assistPath.push([BOSS_X + 1.6, -7.2], [BOSS_X + 0.9, -9.5]); }
      } else if (assistState === "going" || assistState === "back") {
        if (assistPath.length) { walk(assistant, assistPath, reduced ? 40 : 1.5, dt); pose(assistant, "walk", t, 11); }
        else if (assistState === "going") {
          assistant.group.rotation.y = Math.PI; assistState = "talking"; assistTimer = 8;
          show(assistantBubble, `Chefe, ${tip}`, 4.5);
          window.setTimeout(() => show(bossBubble, "Ótimo, anotado. Vamos acompanhar.", 3), 4600);
        } else { assistant.group.rotation.y = Math.PI; assistState = "desk"; assistTimer = 45 + Math.random() * 30; }
      } else {
        pose(assistant, "stand", t, 11);
        if (assistTimer <= 0) { assistState = "back"; assistPath.push([BOSS_X + 1.6, -7.2], ASSIST_DESK); }
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
          if (el) show(el, `${o.role}: ${o.text.length > 56 ? `${o.text.slice(0, 54)}…` : o.text}`, 3.4, `speech-bubble council ${o.vote.toLowerCase()}`);
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
      // Supervisor: to the end of the meeting table at 17:10; otherwise the patrol.
      if (meetingNow && supState === "patrol") { supState = "going"; supPath.length = 0; patrolWait = 0; supPath.push(...toMeeting([supervisor.group.position.x, supervisor.group.position.z], SUPERVISOR_SEAT)); }
      if (!meetingNow && supState !== "patrol") { supState = "patrol"; supPath.length = 0; supPath.push([SUPERVISOR_SEAT[0], -7.2], [MEETING_DOOR, -7.2], [MEETING_DOOR, CORRIDOR_Z]); }
      if (supState !== "patrol") {
        if (supPath.length) { walk(supervisor, supPath, reduced ? 40 : 1.6, dt); pose(supervisor, "walk", t, 3); }
        else { supState = "meeting"; supervisor.group.rotation.y = -Math.PI / 2; pose(supervisor, "talk", t, 3); }
      } else if (supPath.length) { walk(supervisor, supPath, reduced ? 40 : 1.6, dt); pose(supervisor, "walk", t, 3); }
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
      sync, tv: updateTv, tip: (text) => { tip = text; },
      sound: (on) => { soundOn = on; if (on) unlockAudio(); else { stopAmbience?.(); stopAmbience = null; } },
      reset: () => { camera.position.copy(home).multiplyScalar(el.clientWidth / el.clientHeight < 1.2 ? 1.45 : 1); controls.target.set(0, 0, 0.3); },
    };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      labels.domElement.removeEventListener("pointerdown", onDown);
      labels.domElement.removeEventListener("pointerup", onUp);
      labels.domElement.removeEventListener("mousedown", noAutoScroll);
      labels.domElement.removeEventListener("auxclick", noAutoScroll);
      controls.dispose(); pmrem.dispose();
      stopAmbience?.();
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

  useEffect(() => { api.current?.sync(agents, selected, boss, meeting); }, [agents, selected, boss, meeting]);
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
      {/* Owner, 26/10/2026: the legend and the controls tucked into a small corner button. */}
      <div className={`office3d-hint ${help ? "open" : ""}`}>
        {help && <div className="office3d-help" id="office3d-help">
          <p>Arraste para mover · botão do meio para girar · rodinha para aproximar · passe o mouse numa pessoa para ver os detalhes</p>
          <span className="office3d-legend" aria-label="Legenda das bolinhas">
            <span><i className="status-dot own" /> tem ações</span><span><i className="status-dot buy" /> vai comprar</span>
            <span><i className="status-dot council" /> no conselho ou reunião</span><span><i className="status-dot wait" /> esperando</span>
            <span><i className="status-dot closed" /> bolsa fechada</span>
          </span>
          <span className="office3d-buttons">
            <button type="button" className="secondary" onClick={() => setSound((on) => !on)} aria-pressed={sound}>{sound ? "Som do escritório: ligado" : "Som do escritório: desligado"}</button>
            <button type="button" className="secondary" onClick={() => api.current?.reset()}>Centralizar</button>
          </span>
        </div>}
        <button type="button" className="secondary office3d-help-toggle" aria-expanded={help} aria-controls="office3d-help" onClick={() => setHelp((v) => !v)}>
          {help ? "Fechar" : "Legenda e controles"}
        </button>
      </div>
    </div>
  );
}
