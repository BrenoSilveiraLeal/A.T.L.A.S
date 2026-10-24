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
 * 3D office in the style of a modern tech office (bright floor, white walls, colourful sofas,
 * glass meeting rooms). Every agent is a person (look from core/people) with a
 * label: name, stock, company, holding and trend. Walls work like The Sims "cutaway": walls between
 * the camera and a room drop to a low stub and come back up as the camera turns; the far walls
 * stay up. One desk per agent with the real daily candles of its stock; three meeting rooms with
 * three specialists (Risco orange, Balanço blue, Estratégia green); news room; café and pool;
 * reception; market room. Falls back to the 2D map without WebGL.
 */
type V2 = [number, number];
type Pose = "sit" | "stand" | "type" | "cue" | "talk";
interface Slot { pos: V2; face: number; pose: Pose; route: V2[] }
interface Person {
  group: THREE.Group; rig: THREE.Group; hips: THREE.Group[]; knees: THREE.Group[]; shoulders: THREE.Group[]; elbows: THREE.Group[]; cue: THREE.Mesh;
}
interface Walker extends Person { label: CSS2DObject; labelEl: HTMLDivElement; path: V2[]; slot: Slot | null; key: string; phase: number }

const S = 1.25; // people are drawn a little larger than life so they read well from above
const SEAT_Y = 0.6;
const CORRIDOR_Z = -5;
const DESKS: V2[] = [[-11, -1.6], [-5.5, -1.6], [0, -1.6], [-11, 3.4], [-5.5, 3.4], [0, 3.4]];
const MEETING_ROOMS = [[-24, -16], [-16, -8], [-8, 0]].map(([x1, x2]) => ({ x1, x2, table: [(x1 + x2) / 2, -10.4] as V2, door: x2 - 1.4 }));
const SPECIALIST_SHIRTS = ["#f28c28", "#2f6fd6", "#22a06b"]; // Risco, Balanço, Estratégia
const VOTE_LABEL: Record<Vote, string> = { A_FAVOR: "a favor", CONTRA: "contra", NEUTRO: "neutro" };
const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${brl(Math.abs(v))}`);
const tone = (v: number | null) => (v === null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "gain" : "loss");

/** Chairs around a meeting table: 0–2 far side (specialists), 3–5 near side (agents). */
function meetingSeat(room: number, seat: number): { pos: V2; face: number } {
  const [tx, tz] = MEETING_ROOMS[room].table;
  const pos: V2 = [tx + [-1.3, 0, 1.3][seat % 3], tz + (seat < 3 ? -1.35 : 1.35)];
  return { pos, face: seat < 3 ? 0 : Math.PI };
}

function slotFor(zone: OfficeZone, index: number, desk: number): Slot {
  if (zone === "DESK") {
    const [x, z] = DESKS[desk % DESKS.length];
    return { pos: [x, z + 1.05], face: Math.PI, pose: "type", route: [[x + 2.75, CORRIDOR_Z], [x + 2.75, z + 1.9], [x, z + 1.9]] };
  }
  if (zone === "MEETING") {
    const room = index % 3, { pos, face } = meetingSeat(room, 3 + (Math.floor(index / 3) % 3));
    const door = MEETING_ROOMS[room].door;
    return { pos, face, pose: "talk", route: [[door, CORRIDOR_Z], [door, -7.2], [pos[0], -8.4]] };
  }
  if (zone === "POOL") {
    const spots: [V2, number][] = [[[17.1, -10], Math.PI / 2], [[20.9, -10], -Math.PI / 2], [[19, -8.6], Math.PI], [[19, -11.4], 0]];
    const [[x, z], face] = spots[index % spots.length];
    return { pos: [x, z], face, pose: "cue", route: [[15.5, CORRIDOR_Z], [15.5, -7.2], [x, -7.6]] };
  }
  // COFFEE and any other rest: the colourful lounge sofas at the front, facing the camera.
  const seats: [V2, number][] = [[[-7.4, 9.5], 0], [[-5.6, 9.5], 0], [[2.9, 9.5], 0], [[4.7, 9.5], 0], [[-9.1, 10.4], Math.PI / 2], [[6.3, 10.4], -Math.PI / 2]];
  const [[x, z], face] = seats[index % seats.length];
  return { pos: [x, z], face, pose: "sit", route: [[-13.4, CORRIDOR_Z], [-13.4, 7.4], [x, 7.4]] };
}

const hex = (c: string | number) => new THREE.Color(c);
const matte = (c: string | number, rough = 0.75) => new THREE.MeshStandardMaterial({ color: hex(c), roughness: rough, metalness: 0.02 });

/** A stylised person (origin at the feet, facing +z); `rig` moves down when seated. */
function makePerson(look: PersonLook): Person {
  const group = new THREE.Group(), rig = new THREE.Group();
  group.add(rig);
  const skin = matte(look.skin, 0.6), hair = matte(look.hair, 0.85), shirt = matte(look.shirt, 0.8), pants = matte(look.pants, 0.85);
  const shoe = matte("#22252b", 0.5), eye = matte("#16181d", 0.3);
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
  add(new THREE.SphereGeometry(0.13, 24, 18), skin, 0, 1.66, 0).scale.set(0.95, 1.08, 1);
  for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.018, 8, 6), eye, side * 0.045, 1.68, 0.12);
  // Hair.
  const cap = (r: number) => add(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), hair, 0, 1.68, -0.012);
  if (look.hairStyle === "curly") cap(0.16).scale.set(1, 0.85, 1);
  else cap(look.hairStyle === "buzz" ? 0.134 : 0.14);
  if (look.hairStyle === "long") add(new THREE.CapsuleGeometry(0.12, 0.2, 4, 12), hair, 0, 1.5, -0.075).scale.set(1.05, 1, 0.45);
  if (look.hairStyle === "bun") add(new THREE.SphereGeometry(0.065, 12, 10), hair, 0, 1.82, -0.09);
  if (look.hairStyle === "ponytail") add(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), hair, 0, 1.57, -0.17).rotation.x = 0.35;
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * (feminine ? 0.22 : 0.25), 1.4, 0); rig.add(shoulder); shoulders.push(shoulder);
    add(new THREE.CapsuleGeometry(0.056, 0.2, 4, 10), shirt, 0, -0.14, 0, shoulder);
    const elbow = new THREE.Group(); elbow.position.y = -0.29; shoulder.add(elbow); elbows.push(elbow);
    add(new THREE.CapsuleGeometry(0.047, 0.18, 4, 10), skin, 0, -0.12, 0, elbow);
    add(new THREE.SphereGeometry(0.05, 10, 8), skin, 0, -0.26, 0, elbow);
  }
  const cue = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 1.4, 8), matte("#c89b62", 0.5));
  cue.rotation.x = Math.PI / 2.2; cue.position.set(0, -0.26, 0.5); cue.visible = false; elbows[1].add(cue);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; group.add(shadow);
  group.scale.setScalar(S);
  return { group, rig, hips, knees, shoulders, elbows, cue };
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

export function Office3D({ agents, tvHeadline, tvLines, selected, onSelect }: {
  agents: OfficeAgent[]; tvHeadline: { title: string; source: string } | null; tvLines: [string, string, string][];
  selected: string | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ sync: (agents: OfficeAgent[], selected: string | null) => void; tv: (h: typeof tvHeadline, l: typeof tvLines) => void; reset: () => void } | null>(null);
  const select = useRef(onSelect);
  const [failed, setFailed] = useState(false);
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
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const fabric = (c: string) => matte(c, 0.95);

    // Floor: light concrete, grey carpet under the desks, rugs in the lounges.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 28), matte("#d9d5ce", 0.8));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const rug = (w: number, d: number, x: number, z: number, c: string) => box(w, 0.02, d, x, 0.011, z, matte(c, 1), false);
    rug(17.5, 9.6, -5.5, 0.9, "#8b9097");
    rug(15, 5.4, -1, 10.4, "#5f6b7a");
    rug(9.6, 6.2, 17.6, 10.3, "#7a6f86");

    // Walls with The Sims cutaway: `outer` walls drop when the camera is outside them and they
    // face it; interior walls drop whenever they face the camera. `keep` walls never drop.
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
    // Outer shell (normals point outside). Entrance gap at the reception.
    const backWall = wall(-24, -14, 24, -14, H, white, true, [0, -1]);
    wall(-24, -14, -24, 14, H, white, true, [-1, 0]);
    wall(24, -14, 24, 14, H, white, true, [1, 0]);
    wall(-24, 14, -21.5, 14, H, white, true, [0, 1]);
    wall(-17, 14, 24, 14, H, white, true, [0, 1]);
    // Back rooms: colourful partitions, glass fronts with doors.
    const accents = ["#f07b2b", "#2f6fd6", "#f2b33d", "#1fa3b8"];
    [-16, -8, 0, 7].forEach((x, i) => wall(x, -14, x, -6, Hi, matte(accents[i], 0.8), false));
    for (const r of MEETING_ROOMS) { glassWall(r.x1 + 0.1, -6, r.door - 0.8, -6); glassWall(r.door + 0.8, -6, r.x2 - 0.1, -6); }
    glassWall(0.1, -6, 2.6, -6); glassWall(4.2, -6, 6.9, -6);
    glassWall(7.1, -6, 14.7, -6); glassWall(16.3, -6, 23.9, -6);

    // Room signs (kept low and short).
    const sign = (title: string, subtitle: string, x: number, z: number, y = 3.3) => { const p = plaque(title, subtitle); p.position.set(x, y, z); scene.add(p); };
    MEETING_ROOMS.forEach((r, i) => sign(`Reunião ${i + 1}`, "Risco · Balanço · Estratégia", r.table[0], -13.6, 3.7));
    sign("Notícias", "IA lendo o mercado", 3.5, -13.6, 3.7);
    sign("Café e sinuca", "descanso", 15.5, -13.6, 3.7);
    sign("Recepção", "", -19.5, 12.6, 2.6);
    sign("Sala do Mercado", "ações da equipe ao vivo", 17.6, 6.9, 5.4);

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

    // Desks (one per agent): white top, two monitors (candles + price now).
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
      return { screens, key: "" };
    });
    const drawDesk = (i: number, agent: OfficeAgent | null) => {
      const d = desks[i], [left, right] = d.screens;
      const key = agent ? `${agent.id}:${agent.chart?.last}:${agent.chart?.bars.length}:${agent.debate?.summary}:${agent.holding}` : "free";
      if (d.key === key) return;
      d.key = key;
      drawChart(left.g, 0, 0, 640, 400, agent ? agent.ticker : "Mesa livre", agent?.chart, 0.9);
      left.texture.needsUpdate = true;
      const g = right.g;
      g.fillStyle = "#06121d"; g.fillRect(0, 0, 640, 400); g.textBaseline = "top"; g.textAlign = "left";
      if (agent) {
        const { price, change, color } = quoteOf(agent.chart);
        g.fillStyle = "#a9c0d6"; g.font = "26px sans-serif"; g.fillText(`${agent.ticker} agora`, 24, 22);
        g.fillStyle = color; g.font = "bold 84px sans-serif"; g.fillText(price === null ? "—" : brl(price), 24, 58);
        g.font = "bold 40px sans-serif"; g.fillText(change === null ? "" : `${change >= 0 ? "▲ subindo" : "▼ caindo"} ${(Math.abs(change) * 100).toFixed(1)}% hoje`, 24, 156);
        g.fillStyle = "#e8f6ff"; g.font = "bold 30px sans-serif";
        g.fillText(agent.holding > 0 ? `${agent.holding} ações na carteira` : "Ainda sem ações", 24, 236);
        if (agent.debate) { g.fillStyle = "#ffc65c"; g.font = "28px sans-serif"; g.fillText(agent.debate.summary.slice(0, 40), 24, 290); }
      }
      right.texture.needsUpdate = true;
    };

    // Meeting rooms: oval table, six chairs, specialists, screen with the chart under discussion.
    const rooms = MEETING_ROOMS.map((r, roomIndex) => {
      const [tx, tz] = r.table;
      const table = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.07, 48), wood); table.scale.set(2.0, 1, 0.95); table.position.set(tx, 0.95, tz);
      table.castShadow = true; table.receiveShadow = true; scene.add(table);
      cyl(0.18, 0.3, 0.92, tx, 0.46, tz, metal);
      for (let s = 0; s < 6; s++) { const { pos, face } = meetingSeat(roomIndex, s); chair(pos[0], pos[1], face, s < 3 ? "#3b3f47" : "#f07b2b"); }
      const screen = canvasTexture(900, 380);
      const frame = box(3.9, 1.75, 0.08, tx, 2.25, -13.85, metal);
      const tv = new THREE.Mesh(new THREE.PlaneGeometry(3.75, 1.6), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
      tv.position.set(tx, 2.25, -13.8); scene.add(tv);
      backWall.items.push(frame, tv);
      plant(r.x1 + 0.7, -13.2, 0.7);
      const bubbleEl = document.createElement("div"); bubbleEl.className = "debate-bubble"; bubbleEl.hidden = true;
      const bubble = new CSS2DObject(bubbleEl); bubble.position.set(tx, 3.2, tz + 1.8); scene.add(bubble);
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
      const head = document.createElement("b"); head.textContent = `${agent.name} · ${agent.ticker}`;
      room.bubbleEl.append(head);
      for (const o of agent.debate.opinions) {
        const row = document.createElement("span"); row.className = `vote ${o.vote.toLowerCase()}`;
        row.textContent = `${o.role}: ${VOTE_LABEL[o.vote]}`; row.title = o.text; room.bubbleEl.append(row);
      }
      const verdict = document.createElement("em"); verdict.textContent = agent.debate.summary; room.bubbleEl.append(verdict);
    };

    // News room: big TV, sofa, small "IA" hologram.
    const tvCanvas = document.createElement("canvas"); tvCanvas.width = 1280; tvCanvas.height = 380;
    const tvTexture = new THREE.CanvasTexture(tvCanvas); tvTexture.colorSpace = THREE.SRGBColorSpace;
    const newsFrame = box(5.4, 1.75, 0.08, 3.5, 2.2, -13.85, metal);
    const newsTv = new THREE.Mesh(new THREE.PlaneGeometry(5.25, 1.6), new THREE.MeshBasicMaterial({ map: tvTexture, toneMapped: false }));
    newsTv.position.set(3.5, 2.2, -13.8); scene.add(newsTv);
    backWall.items.push(newsFrame, newsTv);
    sofa(3.2, 3.5, -9.4, Math.PI, "#2f6fd6");
    const holo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), new THREE.MeshBasicMaterial({ color: 0x4fb6ff, wireframe: true }));
    holo.position.set(6, 1.35, -12.6); scene.add(holo);
    cyl(0.3, 0.35, 0.9, 6, 0.45, -12.6, white);

    // Café and pool: counter with stools, coffee machine, pool table, bean bags.
    box(5.6, 1.05, 0.8, 10.9, 0.52, -12.9, matte("#f07b2b", 0.7));
    box(5.8, 0.06, 0.95, 10.9, 1.07, -12.85, darkWood);
    box(0.6, 0.7, 0.5, 8.6, 1.45, -13.2, metal);
    for (const x of [8.8, 10.2, 11.6, 13]) cyl(0.24, 0.2, SEAT_Y, x, SEAT_Y / 2, -11.9, fabric("#2b2e34"));
    box(3.2, 0.2, 1.7, 19, 0.82, -10, darkWood);
    box(2.9, 0.04, 1.4, 19, 0.93, -10, matte("#0f6b4e", 0.95));
    for (const [dx, dz] of [[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.7], [1.4, 0.7]]) box(0.16, 0.74, 0.16, 19 + dx, 0.37, -10 + dz, darkWood);
    [0xffd55c, 0xff5d7d, 0xffffff, 0x4fb6ff].forEach((c, i) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.2 }));
      ball.position.set(18.5 + i * 0.3, 1.0, -10.1 + (i % 2) * 0.25); scene.add(ball);
    });
    pouf(22.6, -12.8, "#d6336c", 0.5); pouf(22.6, -7.4, "#f2b33d", 0.5); plant(14.3, -13.2, 0.8);

    // Reception: logo wall, desk with the receptionist, waiting poufs.
    box(7.4, 3, 0.25, -19.5, 1.5, 6.2, matte("#f07b2b", 0.75));
    const logo = plaque("ATLAS", "Trading AI System", "plaque logo-plate"); logo.position.set(-19.5, 2.1, 6.4); scene.add(logo);
    box(3.6, 1.05, 0.8, -19.5, 0.52, 9.4, white); box(3.8, 0.06, 0.95, -19.5, 1.07, 9.4, wood);
    pouf(-21.8, 12.2, "#1fa3b8"); pouf(-20.6, 12.4, "#f2b33d"); pouf(-17.4, 12.2, "#d6336c");
    plant(-23, 7, 0.9); plant(-16, 7, 0.8);

    // Lounge (the "Google" sofas) and the market room.
    sofa(3.6, -6.5, 9.4, 0, "#f07b2b"); sofa(2.6, -9.2, 11, Math.PI / 2, "#1fa3b8"); sofa(3.6, 3.8, 9.4, 0, "#d6336c");
    sofa(2.6, 6.4, 11, -Math.PI / 2, "#2f6fd6");
    cyl(0.85, 0.85, 0.06, -1.3, 0.5, 11, white); cyl(0.12, 0.2, 0.5, -1.3, 0.25, 11, metal);
    pouf(-2.9, 12.6, "#f2b33d"); pouf(0.4, 12.7, "#22a06b"); pouf(-4.2, 11.5, "#7c4dcc", 0.36);
    plant(-12.8, 12.6); plant(9.2, 12.6, 0.9); plant(-13, -4.2, 0.8); plant(8.6, -4.2, 0.8);

    const wallCanvas = canvasTexture(1800, 1000);
    box(8.4, 4.8, 0.2, 17.6, 2.7, 7.1, metal);
    const wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 4.5), new THREE.MeshBasicMaterial({ map: wallCanvas.texture, toneMapped: false }));
    wallScreen.position.set(17.6, 2.7, 7.21); scene.add(wallScreen);
    sofa(4.2, 17.6, 11.6, Math.PI, "#2f6fd6"); pouf(14.4, 11, "#f07b2b"); pouf(20.8, 11, "#f2b33d");
    let wallKey = "";
    const drawWall = (list: OfficeAgent[]) => {
      const key = list.map((a) => `${a.ticker}:${a.chart?.last}:${a.chart?.bars.length}`).join("|");
      if (key === wallKey) return;
      wallKey = key;
      wallCanvas.g.fillStyle = "#010810"; wallCanvas.g.fillRect(0, 0, 1800, 1000);
      list.slice(0, 6).forEach((a, i) => drawChart(wallCanvas.g, 10 + (i % 3) * 597, 10 + Math.floor(i / 3) * 495, 585, 485, `${a.ticker} · ${a.name}`, a.chart, 0.95));
      wallCanvas.texture.needsUpdate = true;
    };

    // Staff: specialists in every meeting room (shirt colour = speciality), receptionist, a walker.
    const staff: { person: Person; pose: Pose; phase: number }[] = [];
    const STAFF_LOOKS: PersonLook[] = [
      { presentation: "feminine", skin: "#e2b08c", hair: "#2a1b12", hairStyle: "long", shirt: "", pants: "#2b2f3a" },
      { presentation: "masculine", skin: "#a8724f", hair: "#151010", hairStyle: "short", shirt: "", pants: "#30343c" },
      { presentation: "feminine", skin: "#f0c9a8", hair: "#6b3a1e", hairStyle: "bun", shirt: "", pants: "#2b2f3a" },
    ];
    MEETING_ROOMS.forEach((_, roomIndex) => SPECIALIST_SHIRTS.forEach((shirt, s) => {
      const person = makePerson({ ...STAFF_LOOKS[(s + roomIndex) % 3], shirt });
      const { pos, face } = meetingSeat(roomIndex, s);
      person.group.position.set(pos[0], 0, pos[1]); person.group.rotation.y = face; scene.add(person.group);
      staff.push({ person, pose: "talk", phase: roomIndex * 2 + s });
    }));
    const receptionist = makePerson({ presentation: "feminine", skin: "#c68f6a", hair: "#1a120d", hairStyle: "ponytail", shirt: "#ffffff", pants: "#2b2f3a" });
    receptionist.group.position.set(-19.5, 0, 8.3); scene.add(receptionist.group);
    chair(-19.5, 8.3, 0, "#f07b2b");
    staff.push({ person: receptionist, pose: "type", phase: 9 });
    const walker = makePerson({ presentation: "masculine", skin: "#e0b08b", hair: "#3a2a20", hairStyle: "short", shirt: "#9aa3ad", pants: "#2d3142" });
    scene.add(walker.group);
    const loop: V2[] = [[-13.5, 6], [6.5, 6], [6.5, -4.4], [-13.5, -4.4]];
    let walkT = 0;

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

    const sync = (list: OfficeAgent[], sel: string | null) => {
      const counters: Partial<Record<OfficeZone, number>> = {};
      const inRoom: (OfficeAgent | null)[] = [null, null, null];
      for (const id of [...deskOf.keys()]) if (!list.some((a) => a.id === id)) deskOf.delete(id);
      list.forEach((agent, i) => {
        if (!deskOf.has(agent.id)) { const used = new Set(deskOf.values()); deskOf.set(agent.id, DESKS.findIndex((_, d) => !used.has(d))); }
        const desk = Math.max(0, deskOf.get(agent.id)!);
        const look = lookFor(agent.name, agent.id);
        let r = people.get(agent.id);
        const first = !r;
        if (!r) {
          const made = makePerson(look);
          const labelEl = document.createElement("div");
          labelEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); select.current(agent.id); });
          const label = new CSS2DObject(labelEl); label.position.set(0, 2.05, 0); made.rig.add(label);
          made.group.traverse((o) => { o.userData.agentId = agent.id; });
          scene.add(made.group); pickables.push(made.group);
          r = { ...made, label, labelEl, path: [], slot: null, key: "", phase: i * 1.7 };
          people.set(agent.id, r);
        }
        const zone: OfficeZone = agent.zone === "OUT" ? "COFFEE" : agent.zone;
        const index = counters[zone] ?? 0; counters[zone] = index + 1;
        if (zone === "MEETING" && !inRoom[index % 3]) inRoom[index % 3] = agent;
        setTarget(r, slotFor(zone, index, desk), `${zone}:${index}:${desk}`, first);
        // Neighbours alternate label heights so names never cover each other.
        r.label.position.y = 2.05 + (zone === "DESK" ? 0 : (index % 2) * 0.62);
        // Label: name and stock, the company, whether it bought, and how the stock is doing today.
        const { change } = quoteOf(agent.chart);
        r.labelEl.className = `agent3d-label person ${tone(agent.pnl)} ${sel === agent.id ? "selected" : ""}`;
        r.labelEl.replaceChildren();
        const name = document.createElement("b"); name.textContent = `${agent.name} · ${agent.ticker}`;
        const company = document.createElement("i"); company.textContent = companyProfile(agent.ticker).name;
        const line = document.createElement("span");
        line.textContent = agent.holding > 0 ? `${agent.holding} ${agent.holding === 1 ? "ação" : "ações"} · ${money(agent.pnl)}` : "ainda não comprou";
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
      drawWall(list);
      for (const [id, r] of people) if (!list.some((a) => a.id === id)) {
        scene.remove(r.group); people.delete(id);
        pickables.splice(pickables.indexOf(r.group), 1);
      }
    };

    const updateTv = (h: typeof tvHeadline, l: typeof tvLines) => { drawTv(tvCanvas, { headline: h, lines: l }); tvTexture.needsUpdate = true; };

    // Picking.
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
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
      // Narrow screens need more distance to fit the whole floor.
      camera.position.copy(home).multiplyScalar(w / h < 1.2 ? 1.45 : 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();

    const pose = (p: Person, kind: Pose | "walk", t: number, phase: number) => {
      const swing = reduced ? 0 : Math.sin(t * 7 + phase);
      p.cue.visible = kind === "cue";
      const seated = kind === "sit" || kind === "type" || kind === "talk";
      p.rig.position.y = seated ? SEAT_Y / S - 0.92 : kind === "walk" ? Math.abs(swing) * 0.02 : 0;
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
      } else if (kind === "cue") {
        p.shoulders[0].rotation.x = -1.0; p.shoulders[1].rotation.x = -0.9 + (reduced ? 0 : Math.max(0, Math.sin(t * 1.4 + phase)) * 0.3);
        p.elbows.forEach((e) => (e.rotation.x = -0.5));
      } else if (kind === "talk") {
        // Seated debate: one hand gestures now and then.
        const gesture = reduced ? 0 : Math.max(0, Math.sin(t * 0.8 + phase));
        p.shoulders[0].rotation.x = -0.45; p.shoulders[1].rotation.x = -0.45 - gesture * 0.7;
        p.elbows[0].rotation.x = -0.9; p.elbows[1].rotation.x = -0.9 - gesture * 0.4;
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
        const outside = toCam.dot(w.normal) > 0;
        const cut = facing && (!w.outer || outside);
        const target = cut ? 0.35 / w.full : 1;
        const s = w.mesh.scale.y + (target - w.mesh.scale.y) * Math.min(1, dt * 8);
        w.mesh.scale.y = s;
        for (const item of w.items) item.visible = s > 0.6;
      }
    };

    const clock = new THREE.Clock();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      for (const r of people.values()) {
        if (r.path.length) {
          const [tx, tz] = r.path[0];
          const p = r.group.position, dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
          const step = (reduced ? 40 : 2.4) * dt;
          if (dist <= step) { p.x = tx; p.z = tz; r.path.shift(); }
          else { p.x += (dx / dist) * step; p.z += (dz / dist) * step; r.group.rotation.y = Math.atan2(dx, dz); }
          pose(r, "walk", t, r.phase);
          if (!r.path.length && r.slot) r.group.rotation.y = r.slot.face;
        } else if (r.slot) pose(r, r.slot.pose, t, r.phase);
      }
      for (const s of staff) pose(s.person, s.pose, t, s.phase);
      if (!reduced) {
        walkT += dt * 0.03;
        const seg = Math.floor(walkT * loop.length) % loop.length, f = (walkT * loop.length) % 1;
        const [ax, az] = loop[seg], [bx, bz] = loop[(seg + 1) % loop.length];
        walker.group.position.set(ax + (bx - ax) * f, 0, az + (bz - az) * f);
        walker.group.rotation.y = Math.atan2(bx - ax, bz - az);
        pose(walker, "walk", t, 5);
        holo.rotation.y = t * 0.5; holo.rotation.x = Math.sin(t * 0.3) * 0.3;
      }
      controls.update();
      cutaway(dt);
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    tick();

    api.current = {
      sync, tv: updateTv,
      reset: () => { camera.position.copy(home).multiplyScalar(el.clientWidth / el.clientHeight < 1.2 ? 1.45 : 1); controls.target.set(0, 0, 0.3); },
    };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      labels.domElement.removeEventListener("pointerdown", onDown);
      labels.domElement.removeEventListener("pointerup", onUp);
      controls.dispose(); pmrem.dispose();
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

  useEffect(() => { api.current?.sync(agents, selected); }, [agents, selected]);
  useEffect(() => { api.current?.tv(tvHeadline, tvLines); }, [tvHeadline, tvLines]);

  if (failed) return <OfficeMap agents={agents} tvHeadline={tvHeadline} selected={selected} onSelect={onSelect} />;
  return (
    <div className="office3d">
      <div ref={host} className="office3d-canvas" role="img"
        aria-label={`Escritório 3D com ${agents.length} IAs. ${agents.map((a) => `${a.name}: ${a.activity}`).join(" ")}`} />
      <div className="office3d-hint">Arraste para girar · role para aproximar · toque numa pessoa
        <button type="button" className="secondary" onClick={() => api.current?.reset()}>Centralizar</button>
      </div>
    </div>
  );
}
