"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OfficeZone } from "@/core/office";
import type { Vote } from "@/core/committee";
import { OfficeMap, type OfficeAgent, type AgentChart } from "./office-map";

/**
 * 3D office (three.js). One desk per agent: its monitors show the real daily candles of its stock
 * and the price now. Three meeting rooms, each with three specialist robots (Risco, Balanço,
 * Estratégia): an agent that is analysing walks into a free room and the room shows the debate
 * and the chart under discussion. A big market panel shows the whole team's stocks. Replaced
 * agents are deleted, so there is no exit room. Falls back to the 2D map without WebGL.
 */
type V2 = [number, number];
interface Slot { pos: V2; face: number; pose: "sit" | "stand" | "type" | "cue"; route: V2[] }
interface Robot {
  group: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[]; body: THREE.Group; cue: THREE.Mesh;
  label: CSS2DObject; labelEl: HTMLDivElement; path: V2[]; slot: Slot | null; key: string; phase: number;
}

const CORRIDOR_Z = -4.8;
// Robot size: small enough that seated robots never cover the room screens.
const ROBOT_SCALE = 1.7;
const DESKS: V2[] = [[-8, -1], [-2, -1], [4, -1], [-8, 5], [-2, 5], [4, 5]];
const BACK: [number, number] = [-13, -5.6];
const MEETING_ROOMS = [[-23, -14.5], [-14, -5.5], [-5, 3.5]].map(([x1, x2]) => ({ x1, x2, table: [(x1 + x2) / 2, -9.7] as V2 }));
const SPECIALISTS: { role: string; color: number }[] = [{ role: "Risco", color: 0xff9f43 }, { role: "Balanço", color: 0x4fb6ff }, { role: "Estratégia", color: 0x3dffa8 }];
const VOTE_LABEL: Record<Vote, string> = { A_FAVOR: "a favor", CONTRA: "contra", NEUTRO: "neutro" };
const hue = (id: string) => [...id].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5) % 360;
const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Chairs around a meeting table: 0–2 on the far side (specialists), 3–5 on the near side (agents). */
function meetingSeat(room: number, seat: number): { pos: V2; face: number } {
  const [tx, tz] = MEETING_ROOMS[room].table;
  const dx = [-2, 0, 2][seat % 3], far = seat < 3;
  const pos: V2 = [tx + dx, tz + (far ? -1 : 1) * (dx ? 1.55 : 1.75)];
  return { pos, face: Math.atan2(tx - pos[0], tz - pos[1]) };
}

function slotFor(zone: OfficeZone, index: number, desk: number): Slot {
  if (zone === "DESK") {
    const [x, z] = DESKS[desk % DESKS.length];
    return { pos: [x, z + 1.05], face: Math.PI, pose: "type", route: [[x + 3, CORRIDOR_Z], [x + 3, z + 1.9], [x, z + 1.9]] };
  }
  if (zone === "MEETING") {
    const room = index % 3, { pos, face } = meetingSeat(room, 3 + (Math.floor(index / 3) % 3));
    const [tx] = MEETING_ROOMS[room].table;
    return { pos, face, pose: "sit", route: [[tx, CORRIDOR_Z], [pos[0], -6.3], pos] };
  }
  if (zone === "POOL") {
    const spots: [V2, number][] = [[[17.4, -9.2], Math.PI / 2], [[21.6, -9.2], -Math.PI / 2], [[19.5, -7.4], Math.PI], [[19.5, -11.1], 0]];
    const [[x, z], face] = spots[index % spots.length];
    return { pos: [x, z], face, pose: "cue", route: [[19.5, CORRIDOR_Z], [19.5, -6.4], [x < 18.5 ? 17.4 : x > 20.5 ? 21.6 : x, -6.6]] };
  }
  // COFFEE (and any other resting place).
  const spots: V2[] = [[12.4, -9.7], [14.0, -9.7], [15.6, -9.7], [11.2, -11.0]];
  const [x, z] = spots[index % spots.length];
  return { pos: [x + Math.floor(index / spots.length) * 0.5, z], face: index % 4 === 3 ? Math.PI : 0, pose: index % 4 === 3 ? "stand" : "sit",
    route: [[15.5, CORRIDOR_Z], [15.5, -6.4], [x, -7.4]] };
}

const mat = {
  white: () => new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.38, metalness: 0.1, envMapIntensity: 0.55 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.2, metalness: 0.6 }),
  // Emissive parts are pushed above 1.0 so only they cross the bloom threshold.
  glow: (c: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.4), toneMapped: false }),
};

function makeRobot(accent: THREE.Color): Omit<Robot, "label" | "labelEl" | "path" | "slot" | "key" | "phase"> {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const white = mat.white(), dark = mat.dark(), glow = mat.glow(accent);
  const joint = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.45, metalness: 0.5 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  // Torso: rounded white shell, dark chest panel with a glowing strip in the agent's colour.
  add(new THREE.CapsuleGeometry(0.29, 0.34, 8, 20), white, 0, 1.0, 0).scale.set(1.05, 1, 0.82);
  add(new THREE.BoxGeometry(0.3, 0.2, 0.04), dark, 0, 1.06, 0.24);
  add(new THREE.BoxGeometry(0.22, 0.035, 0.02), glow, 0, 1.06, 0.27);
  add(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 20), joint, 0, 0.68, 0);
  add(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 16), joint, 0, 1.36, 0);
  // Head: glossy white shell, black visor, two oval cyan eyes, headphone cups.
  add(new THREE.SphereGeometry(0.33, 32, 24), white, 0, 1.64, 0).scale.set(1.1, 0.95, 1);
  add(new THREE.SphereGeometry(0.3, 32, 24, -Math.PI / 2.3, Math.PI / 1.15, Math.PI / 3.6, Math.PI / 2.4), dark, 0, 1.64, 0.06).scale.set(1.1, 0.95, 1);
  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(0.05, 16, 12), mat.glow(0x6fe9ff), side * 0.11, 1.66, 0.345).scale.set(1, 1.35, 0.5);
    const cup = add(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 24), white, side * 0.37, 1.64, 0);
    cup.rotation.z = Math.PI / 2;
    const ring = add(new THREE.TorusGeometry(0.075, 0.016, 8, 24), glow, side * 0.42, 1.64, 0);
    ring.rotation.y = Math.PI / 2;
  }
  const band = add(new THREE.TorusGeometry(0.36, 0.025, 8, 32, Math.PI), joint, 0, 1.66, 0);
  band.rotation.y = Math.PI / 2;
  // Arms (pivot at the shoulder) and legs (pivot at the hip); the pose code rotates the groups.
  const arms: THREE.Group[] = [], legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.37, 1.22, 0); body.add(arm); arms.push(arm);
    add(new THREE.SphereGeometry(0.1, 16, 12), white, 0, 0, 0, arm);
    add(new THREE.CapsuleGeometry(0.065, 0.2, 4, 12), white, 0, -0.17, 0, arm);
    add(new THREE.SphereGeometry(0.06, 12, 10), joint, 0, -0.32, 0, arm);
    add(new THREE.CapsuleGeometry(0.06, 0.18, 4, 12), white, 0, -0.46, 0, arm);
    add(new THREE.SphereGeometry(0.065, 12, 10), dark, 0, -0.6, 0.01, arm);
    const leg = new THREE.Group(); leg.position.set(side * 0.13, 0.62, 0); group.add(leg); legs.push(leg);
    add(new THREE.CapsuleGeometry(0.085, 0.16, 4, 12), white, 0, -0.14, 0, leg);
    add(new THREE.SphereGeometry(0.07, 12, 10), joint, 0, -0.29, 0, leg);
    add(new THREE.CapsuleGeometry(0.075, 0.14, 4, 12), white, 0, -0.42, 0, leg);
    add(new THREE.BoxGeometry(0.15, 0.07, 0.24), dark, 0, -0.57, 0.04, leg);
  }
  const cue = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.5, 8), new THREE.MeshStandardMaterial({ color: 0xc89b62, roughness: 0.5 }));
  cue.rotation.x = Math.PI / 2.3; cue.position.set(0.3, 1.0, 0.55); cue.visible = false; body.add(cue);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; group.add(shadow);
  return { group, legs, arms, body, cue };
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
  g.fillStyle = "#03101b"; g.fillRect(x0, y0, w, h);
  const { price, change, color } = quoteOf(chart);
  g.fillStyle = "#e8f6ff"; g.font = `bold ${30 * scale}px sans-serif`; g.textBaseline = "top";
  g.fillText(title, x0 + 16 * scale, y0 + 12 * scale);
  if (price !== null) {
    g.fillStyle = color; g.font = `bold ${30 * scale}px sans-serif`; g.textAlign = "right";
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
  g.textBaseline = "alphabetic";
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
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = "office3d-labels";
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090c);
    scene.fog = new THREE.Fog(0x07090c, 46, 86);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    const home = new THREE.Vector3(0, 27, 25.5);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.target.set(0, 0, -0.5);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 12; controls.maxDistance = 56;
    controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.2;
    controls.screenSpacePanning = false;

    scene.add(new THREE.HemisphereLight(0xffe2bd, 0x1a1d24, 0.65));
    scene.add(new THREE.AmbientLight(0xfff0dc, 0.12));
    const sun = new THREE.DirectionalLight(0xfff1dc, 0.9); sun.position.set(-8, 20, 10); scene.add(sun);
    for (const [x, z, c] of [[-18.75, -9, 0xffb24a], [-9.75, -9, 0xffb24a], [-0.75, -9, 0xffb24a], [7.25, -9.5, 0x5ab8ff], [17, -9, 0xffb24a],
      [-2, 3, 0xffc674], [14.6, 5, 0x7fd0ff], [-18, 3, 0xffb24a]] as [number, number, number][]) {
      const p = new THREE.PointLight(c, 9, 18, 1.4); p.position.set(x, 6, z); scene.add(p);
    }
    for (const [x, z] of DESKS) { const lamp = new THREE.PointLight(0xffd8a0, 1.6, 6, 1.8); lamp.position.set(x, 4.2, z - 0.2); scene.add(lamp); }

    // Floor, walkways and rooms.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 30), new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.3, metalness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const amber = mat.glow(0xffa53a);
    const strip = (x1: number, z1: number, x2: number, z2: number, width = 0.07, color: THREE.Material = amber) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, width), color);
      m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(m);
    };
    for (const [a, b, c, d] of [[-12, -4, 9, -4], [9, -4, 9, 9.5], [9, 9.5, -12, 9.5], [-12, 9.5, -12, -4]] as [number, number, number, number][]) strip(a, b, c, d, 0.09);
    const tile = new THREE.MeshStandardMaterial({ color: 0x2f2b27, roughness: 0.35, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x8fb8d8, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.2 });
    const room = (x1: number, x2: number, title: string, subtitle: string, frame = amber) => {
      const [z1, z2] = BACK;
      const w = x2 - x1, d = z2 - z1, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), tile); base.position.set(cx, 0.04, cz); scene.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, 4.6, 0.15), wallMat); back.position.set(cx, 2.3, z1); scene.add(back);
      for (const [px, pz, rw, rd] of [[x1, cz, 0.06, d], [x2, cz, 0.06, d], [cx, z2, w, 0.06]] as [number, number, number, number][]) {
        const pane = new THREE.Mesh(new THREE.BoxGeometry(rw, 1.4, rd), glass); pane.position.set(px, 0.78, pz); scene.add(pane);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(rw + 0.02, 0.05, rd + 0.02), frame); rail.position.set(px, 1.5, pz); scene.add(rail);
      }
      strip(x1, z1 + 0.12, x2, z1 + 0.12, 0.05, frame);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.06), frame); top.position.set(cx, 4.6, z1); scene.add(top);
      const label = plaque(title, subtitle); label.position.set(cx, 5.3, z1); scene.add(label);
    };
    MEETING_ROOMS.forEach((r, i) => room(r.x1, r.x2, `Reunião ${i + 1}`, "Risco · Balanço · Estratégia"));
    room(4, 10.5, "IA Central", "notícias ao vivo", mat.glow(0x4fb6ff));
    room(11, 23, "Descanso", "café e sinuca");

    // Furniture helpers.
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); scene.add(mesh); return mesh;
    };
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.45, metalness: 0.1 });
    const deskTop = new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 0.4, metalness: 0.2 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.4 });
    const plant = (x: number, z: number, s = 1) => {
      box(0.7 * s, 0.7 * s, 0.7 * s, x, 0.35 * s, z, black);
      const leaves = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.7 });
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22 * s, 1.1 * s, 6), leaves);
        leaf.position.set(x + Math.cos(i) * 0.18 * s, 1.1 * s, z + Math.sin(i * 1.7) * 0.18 * s);
        leaf.rotation.set(Math.sin(i) * 0.5, 0, Math.cos(i) * 0.5); scene.add(leaf);
      }
    };
    const chair = (x: number, z: number, face: number) => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), black); seat.position.y = 0.5; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.08), black); back.position.set(0, 0.88, -0.28); g.add(back);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45), black); pole.position.y = 0.25; g.add(pole);
      g.position.set(x, 0, z); g.rotation.y = face; scene.add(g);
    };

    // One desk per agent: left monitor = daily candles, right monitor = price now and the decision.
    const desks = DESKS.map(([x, z], i) => {
      box(3.4, 0.08, 1.3, x, 0.78, z, deskTop);
      box(3.3, 0.7, 0.06, x, 0.42, z - 0.6, black);
      const screens = [-0.82, 0.82].map((dx) => {
        const t = canvasTexture(640, 400);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.98, 0.04), black); frame.position.set(x + dx, 1.42, z - 0.35); frame.rotation.y = -dx * 0.22; scene.add(frame);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1.48, 0.92), new THREE.MeshBasicMaterial({ map: t.texture, toneMapped: false }));
        s.position.set(x + dx, 1.42, z - 0.32); s.rotation.y = -dx * 0.22; scene.add(s);
        return t;
      });
      box(0.9, 0.03, 0.3, x, 0.83, z + 0.15, black);
      chair(x, z + 1.05, Math.PI);
      if (i === 2 || i === 5) plant(x + 2.6, z - 0.4, 0.8);
      return { screens, key: "" };
    });
    const drawDesk = (i: number, agent: OfficeAgent | null) => {
      const d = desks[i], [left, right] = d.screens;
      const key = agent ? `${agent.id}:${agent.chart?.last}:${agent.chart?.bars.length}:${agent.debate?.summary}` : "free";
      if (d.key === key) return;
      d.key = key;
      drawChart(left.g, 0, 0, 640, 400, agent ? `${agent.name} · ${agent.ticker}` : "Mesa livre", agent?.chart, 0.9);
      left.texture.needsUpdate = true;
      const g = right.g;
      g.fillStyle = "#03101b"; g.fillRect(0, 0, 640, 400); g.textBaseline = "top"; g.textAlign = "left";
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

    // Meeting rooms: table, six chairs, three specialists, a screen with the chart under discussion and the debate.
    const rooms = MEETING_ROOMS.map((r, roomIndex) => {
      const [tx, tz] = r.table;
      const table = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.1, 48), wood); table.scale.set(2.5, 1, 1.05); table.position.set(tx, 0.8, tz); scene.add(table);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.75), black); leg.position.set(tx, 0.38, tz); scene.add(leg);
      for (let s = 0; s < 6; s++) { const { pos, face } = meetingSeat(roomIndex, s); chair(pos[0], pos[1], face + Math.PI); }
      const screen = canvasTexture(900, 380);
      box(4.4, 1.95, 0.08, tx, 3.45, BACK[0] + 0.12, black);
      const tv = new THREE.Mesh(new THREE.PlaneGeometry(4.25, 1.8), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
      tv.position.set(tx, 3.45, BACK[0] + 0.18); scene.add(tv);
      const bubbleEl = document.createElement("div"); bubbleEl.className = "debate-bubble"; bubbleEl.hidden = true;
      const bubble = new CSS2DObject(bubbleEl); bubble.position.set(tx, 3.6, tz + 1.4); scene.add(bubble);
      return { screen, bubbleEl, key: "" };
    });
    const drawRoom = (i: number, agent: OfficeAgent | null) => {
      const room = rooms[i];
      const key = agent ? `${agent.id}:${agent.chart?.last}:${agent.debate?.summary}` : "free";
      if (room.key === key) return;
      room.key = key;
      if (agent) drawChart(room.screen.g, 0, 0, 900, 380, `Em análise: ${agent.ticker}`, agent.chart);
      else {
        const g = room.screen.g; g.fillStyle = "#03101b"; g.fillRect(0, 0, 900, 380);
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

    // Specialists sit on the far side of every meeting table (same colour = same speciality).
    const staff: { robot: ReturnType<typeof makeRobot>; pose: Slot["pose"] }[] = [];
    MEETING_ROOMS.forEach((_, roomIndex) => SPECIALISTS.forEach((sp, s) => {
      const robot = makeRobot(new THREE.Color(sp.color));
      const { pos, face } = meetingSeat(roomIndex, s);
      robot.group.position.set(pos[0], 0, pos[1]); robot.group.rotation.y = face; robot.group.scale.setScalar(ROBOT_SCALE); scene.add(robot.group);
      staff.push({ robot, pose: "sit" });
    }));

    // IA Central: the live news TV and a small hologram.
    const tvCanvas = document.createElement("canvas"); tvCanvas.width = 1280; tvCanvas.height = 380;
    const tvTexture = new THREE.CanvasTexture(tvCanvas); tvTexture.colorSpace = THREE.SRGBColorSpace;
    box(5.9, 1.9, 0.08, 7.25, 3.3, BACK[0] + 0.12, black);
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(5.75, 1.72), new THREE.MeshBasicMaterial({ map: tvTexture, toneMapped: false }));
    tv.position.set(7.25, 3.3, BACK[0] + 0.18); scene.add(tv);
    const core = new THREE.Group(); core.position.set(7.25, 0, -8.2); scene.add(core);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.3, 48), black); pedestal.position.y = 0.15; core.add(pedestal);
    const ring = (r: number, y: number) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 8, 64), mat.glow(0x4fb6ff)); t.rotation.x = Math.PI / 2; t.position.y = y; core.add(t); return t; };
    const rings = [ring(0.95, 0.32), ring(0.6, 1.9)];
    const brain = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 2), new THREE.MeshBasicMaterial({ color: 0x5ab8ff, wireframe: true, toneMapped: false }));
    brain.position.y = 1.2; core.add(brain);
    const brainCore = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), mat.glow(0x2f7fff)); brainCore.position.y = 1.2; core.add(brainCore);

    // Rest room: sofa, coffee machine, pool table.
    const sofa = new THREE.MeshStandardMaterial({ color: 0x8c8274, roughness: 0.85 });
    box(3.8, 0.45, 1, 13.9, 0.3, -10.4, sofa); box(3.8, 0.7, 0.3, 13.9, 0.7, -10.9, sofa);
    box(1.6, 0.4, 0.9, 13.9, 0.22, -8.2, wood);
    box(0.9, 1.8, 0.7, 11.2, 0.9, -12.3, black); box(0.5, 0.3, 0.05, 11.2, 1.3, -11.94, mat.glow(0xffb24a));
    box(4.2, 0.18, 2.4, 19.5, 0.8, -9.2, wood);
    box(3.8, 0.04, 2.0, 19.5, 0.9, -9.2, new THREE.MeshStandardMaterial({ color: 0x0f6b4e, roughness: 0.9 }));
    for (const [dx, dz] of [[-1.8, -0.9], [1.8, -0.9], [-1.8, 0.9], [1.8, 0.9]]) box(0.2, 0.75, 0.2, 19.5 + dx, 0.38, -9.2 + dz, black);
    [0xffd55c, 0xff5d7d, 0xffffff, 0x4fb6ff].forEach((c, i) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.2 }));
      ball.position.set(18.8 + i * 0.4, 0.97, -9.3 + (i % 2) * 0.3); scene.add(ball);
    });
    plant(22.2, -12.2);

    // Market panel: every stock of the team, live.
    const wall = canvasTexture(1800, 1000);
    box(7.9, 4.5, 0.2, 14.6, 2.75, 2.6, black);
    const wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(7.7, 4.28), new THREE.MeshBasicMaterial({ map: wall.texture, toneMapped: false }));
    wallScreen.position.set(14.6, 2.75, 2.71); scene.add(wallScreen);
    box(0.4, 0.6, 0.4, 11.6, 0.3, 2.6, black); box(0.4, 0.6, 0.4, 17.6, 0.3, 2.6, black);
    const wallLabel = plaque("Painel do Mercado", "ações da equipe ao vivo"); wallLabel.position.set(14.6, 5.6, 2.6); scene.add(wallLabel);
    let wallKey = "";
    const drawWall = (list: OfficeAgent[]) => {
      const key = list.map((a) => `${a.ticker}:${a.chart?.last}:${a.chart?.bars.length}`).join("|");
      if (key === wallKey) return;
      wallKey = key;
      wall.g.fillStyle = "#010810"; wall.g.fillRect(0, 0, 1800, 1000);
      list.slice(0, 6).forEach((a, i) => drawChart(wall.g, 10 + (i % 3) * 597, 10 + Math.floor(i / 3) * 495, 585, 485, `${a.ticker} · ${a.name}`, a.chart, 0.95));
      wall.texture.needsUpdate = true;
    };

    // Brand wall and plants.
    box(4.5, 3.4, 0.2, -18.4, 1.7, -2.4, wallMat);
    const logo = plaque("ATLAS", "Trading AI System", "plaque logo-plate"); logo.position.set(-18.4, 2.2, -2.2); scene.add(logo);
    plant(-14.2, -3.6); plant(-14.2, 6.6); plant(10.4, -3.6, 0.8); plant(-1, 9, 0.8); plant(19.5, 8, 0.8);

    const wanderer = makeRobot(new THREE.Color(0xffb24a)); wanderer.group.scale.setScalar(ROBOT_SCALE); scene.add(wanderer.group);
    const loop: V2[] = [[-11.3, 9], [8.3, 9], [8.3, -3.4], [-11.3, -3.4]];
    let wanderT = 0;

    // Agents.
    const robots = new Map<string, Robot>();
    const pickables: THREE.Object3D[] = [];
    const deskOf = new Map<string, number>();

    const setTarget = (r: Robot, slot: Slot, key: string, instant: boolean) => {
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
      // A desk belongs to an agent for as long as it exists; a removed agent frees it.
      for (const id of [...deskOf.keys()]) if (!list.some((a) => a.id === id)) deskOf.delete(id);
      list.forEach((agent, i) => {
        if (!deskOf.has(agent.id)) { const used = new Set(deskOf.values()); deskOf.set(agent.id, DESKS.findIndex((_, d) => !used.has(d))); }
        const desk = Math.max(0, deskOf.get(agent.id)!);
        let r = robots.get(agent.id);
        const first = !r;
        if (!r) {
          const made = makeRobot(new THREE.Color(`hsl(${hue(agent.id)}, 90%, 60%)`));
          const labelEl = document.createElement("div");
          labelEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); select.current(agent.id); });
          const label = new CSS2DObject(labelEl); label.position.set(0, 2.15, 0); made.group.add(label);
          made.group.scale.setScalar(ROBOT_SCALE);
          made.group.traverse((o) => { o.userData.agentId = agent.id; });
          scene.add(made.group); pickables.push(made.group);
          r = { ...made, label, labelEl, path: [], slot: null, key: "", phase: i * 1.7 };
          robots.set(agent.id, r);
        }
        const zone: OfficeZone = agent.zone === "OUT" ? "COFFEE" : agent.zone;
        const index = counters[zone] ?? 0; counters[zone] = index + 1;
        if (zone === "MEETING" && !inRoom[index % 3]) inRoom[index % 3] = agent;
        setTarget(r, slotFor(zone, index, desk), `${zone}:${index}:${desk}`, first);
        r.labelEl.className = `agent3d-label ${sel === agent.id ? "selected" : ""}`;
        r.labelEl.textContent = agent.name;
        r.labelEl.title = agent.activity;
        drawDesk(desk, agent);
      });
      const used = new Set(deskOf.values());
      DESKS.forEach((_, d) => { if (!used.has(d)) drawDesk(d, null); });
      inRoom.forEach((agent, i) => drawRoom(i, agent));
      drawWall(list);
      for (const [id, r] of robots) if (!list.some((a) => a.id === id)) {
        scene.remove(r.group); robots.delete(id);
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

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 1.25));
    composer.addPass(new OutputPass());

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h); composer.setSize(w, h);
      camera.aspect = w / h;
      // Narrow screens need more distance to fit the whole floor.
      camera.position.copy(home).multiplyScalar(w / h < 1.2 ? 1.45 : 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();

    const clock = new THREE.Clock();
    let frame = 0;
    const pose = (r: { legs: THREE.Group[]; arms: THREE.Group[]; body: THREE.Group; cue: THREE.Mesh }, kind: Slot["pose"] | "walk", t: number, phase: number) => {
      const swing = Math.sin(t * 7 + phase);
      r.cue.visible = kind === "cue";
      if (kind === "walk") {
        r.body.position.y = Math.abs(swing) * 0.05;
        r.legs[0].rotation.x = swing * 0.6; r.legs[1].rotation.x = -swing * 0.6;
        r.arms[0].rotation.x = -swing * 0.5; r.arms[1].rotation.x = swing * 0.5;
        r.legs.forEach((l) => (l.position.y = 0.62));
        return;
      }
      const seated = kind === "sit" || kind === "type";
      r.body.position.y = seated ? -0.12 : (reduced ? 0 : Math.sin(t * 1.6 + phase) * 0.02);
      r.legs.forEach((l) => { l.rotation.x = seated ? -1.45 : 0; l.position.y = seated ? 0.5 : 0.62; });
      if (kind === "type") { r.arms[0].rotation.x = -1.15 + (reduced ? 0 : Math.sin(t * 18 + phase) * 0.08); r.arms[1].rotation.x = -1.15 + (reduced ? 0 : Math.cos(t * 18 + phase) * 0.08); }
      else if (kind === "cue") { r.arms[0].rotation.x = -1.0; r.arms[1].rotation.x = -0.9 + (reduced ? 0 : Math.max(0, Math.sin(t * 1.4 + phase)) * 0.35); }
      // Seated specialists gesture now and then, as if debating.
      else { r.arms[0].rotation.x = seated ? -0.4 + (reduced ? 0 : Math.max(0, Math.sin(t * 0.9 + phase)) * 0.5) : Math.sin(t * 1.2 + phase) * 0.05; r.arms[1].rotation.x = seated ? -0.4 : r.arms[0].rotation.x; }
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      for (const r of robots.values()) {
        if (r.path.length) {
          const [tx, tz] = r.path[0];
          const p = r.group.position, dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
          const step = (reduced ? 40 : 2.6) * dt;
          if (dist <= step) { p.x = tx; p.z = tz; r.path.shift(); }
          else { p.x += (dx / dist) * step; p.z += (dz / dist) * step; r.group.rotation.y = Math.atan2(dx, dz); }
          pose(r, "walk", t, r.phase);
          if (!r.path.length && r.slot) r.group.rotation.y = r.slot.face;
        } else if (r.slot) pose(r, r.slot.pose, t, r.phase);
      }
      staff.forEach((s, i) => pose(s.robot, s.pose, t, i * 1.3));
      if (!reduced) {
        wanderT += dt * 0.045;
        const seg = Math.floor(wanderT * loop.length) % loop.length, f = (wanderT * loop.length) % 1;
        const [ax, az] = loop[seg], [bx, bz] = loop[(seg + 1) % loop.length];
        wanderer.group.position.set(ax + (bx - ax) * f, 0, az + (bz - az) * f);
        wanderer.group.rotation.y = Math.atan2(bx - ax, bz - az);
        pose(wanderer, "walk", t, 5);
        brain.rotation.y = t * 0.4; brain.rotation.x = Math.sin(t * 0.3) * 0.2;
        brainCore.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08);
        rings.forEach((ring, i) => (ring.rotation.z = t * (i % 2 ? -0.5 : 0.35)));
      }
      controls.update();
      composer.render();
      labels.render(scene, camera);
    };
    tick();

    api.current = {
      sync, tv: updateTv,
      reset: () => { camera.position.copy(home).multiplyScalar(el.clientWidth / el.clientHeight < 1.2 ? 1.45 : 1); controls.target.set(0, 0, -0.5); },
    };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      labels.domElement.removeEventListener("pointerdown", onDown);
      labels.domElement.removeEventListener("pointerup", onUp);
      controls.dispose(); composer.dispose(); pmrem.dispose();
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
      <div className="office3d-hint">Arraste para girar · role para aproximar · toque num robô
        <button type="button" className="secondary" onClick={() => api.current?.reset()}>Centralizar</button>
      </div>
    </div>
  );
}
