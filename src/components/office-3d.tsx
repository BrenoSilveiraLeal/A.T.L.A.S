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
import { formatBrl } from "@/core/format";
import type { OfficeZone } from "@/core/office";
import { OfficeMap, type OfficeAgent } from "./office-map";

/**
 * 3D office (three.js). Every robot is a real agent placed by `placeAgent`; it walks along the
 * corridors to its room whenever its activity changes. Decorative staff (reception, research,
 * risk) are labelled by role and never show money. Falls back to the 2D map without WebGL.
 */
type V2 = [number, number];
interface Slot { pos: V2; face: number; pose: "sit" | "stand" | "type" | "cue"; route: V2[] }
interface Robot {
  group: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[]; body: THREE.Group; cue: THREE.Mesh;
  label: CSS2DObject; labelEl: HTMLDivElement; path: V2[]; slot: Slot | null; key: string; phase: number; ghost: boolean;
}

const CORRIDOR_Z = -4.8;
const DESKS: V2[] = [[-8, -1], [-3, -1], [2, -1], [7, -1], [-8, 5], [-3, 5], [2, 5], [7, 5]];
const TABLE: V2 = [-9.5, -9.4];
const money = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${formatBrl(Math.abs(v).toFixed(2))}`);
const tone = (v: number | null) => (v === null || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "gain" : "loss");
const hue = (id: string) => [...id].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5) % 360;

function slotFor(zone: OfficeZone, index: number, desk: number): Slot {
  if (zone === "DESK") {
    const [x, z] = DESKS[desk % DESKS.length];
    const gap = x + 2.5;
    return { pos: [x, z + 1.05], face: Math.PI, pose: "type", route: [[gap, CORRIDOR_Z], [gap, z + 1.9], [x, z + 1.9]] };
  }
  if (zone === "MEETING") {
    const angle = Math.PI / 2 + (index - 2.5) * 0.62 + (index % 2 ? Math.PI : 0);
    const x = TABLE[0] + Math.cos(angle) * 3.3, z = TABLE[1] + Math.sin(angle) * 1.75;
    return { pos: [x, z], face: Math.atan2(TABLE[0] - x, TABLE[1] - z), pose: "sit", route: [[-9.5, CORRIDOR_Z], [-9.5, -6.4], [x, -6.9]] };
  }
  if (zone === "COFFEE") {
    const spots: V2[] = [[7.4, -9.7], [9.0, -9.7], [10.6, -9.7], [6.0, -11.0]];
    const [x, z] = spots[index % spots.length];
    return { pos: [x + Math.floor(index / spots.length) * 0.5, z], face: index === 3 ? Math.PI : 0, pose: index === 3 ? "stand" : "sit", route: [[10.5, CORRIDOR_Z], [10.5, -6.4], [x, -7.4]] };
  }
  if (zone === "POOL") {
    const spots: [V2, number][] = [[[12.4, -9.2], Math.PI / 2], [[16.6, -9.2], -Math.PI / 2], [[14.5, -7.4], Math.PI], [[14.5, -11.1], 0]];
    const [[x, z], face] = spots[index % spots.length];
    return { pos: [x, z], face, pose: "cue", route: [[14.5, CORRIDOR_Z], [14.5, -6.4], [x < 13.5 ? 12.4 : x > 15.5 ? 16.6 : x, -6.6]] };
  }
  const spots: V2[] = [[-18.6, 9.6], [-17.2, 9.6], [-18.6, 11.2], [-17.2, 11.2]];
  const [x, z] = spots[index % spots.length];
  return { pos: [x, z], face: 0, pose: "stand", route: [[-13.5, CORRIDOR_Z], [-13.5, 8.2], [x, 8.2]] };
}

const mat = {
  white: () => new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.38, metalness: 0.1, envMapIntensity: 0.55 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.2, metalness: 0.6 }),
  // Emissive parts are pushed above 1.0 so only they cross the bloom threshold.
  glow: (c: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.4), toneMapped: false }),
};

function makeRobot(accent: THREE.Color): Omit<Robot, "label" | "labelEl" | "path" | "slot" | "key" | "phase" | "ghost"> {
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

function chartTexture(color: string, seed: number) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#03101b"; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = "rgba(94,231,255,0.12)";
  for (let y = 20; y < 160; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  let v = 80, s = seed;
  for (let x = 8; x < 250; x += 9) {
    s = (s * 9301 + 49297) % 233280;
    const open = v; v = Math.max(20, Math.min(140, v + ((s / 233280) - 0.5) * 30));
    g.fillStyle = v < open ? "#3dffa8" : "#ff5d7d";
    g.fillRect(x, Math.min(open, v), 5, Math.max(2, Math.abs(v - open)));
  }
  g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
  s = seed * 7;
  for (let x = 0, y = 110; x <= 256; x += 16) { s = (s * 9301 + 49297) % 233280; y = Math.max(20, Math.min(140, y - 10 + (s / 233280) * 16)); if (x) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function drawTv(canvas: HTMLCanvasElement, tv: { headline: { title: string; source: string } | null; lines: [string, string, string][] }) {
  const g = canvas.getContext("2d")!;
  const w = canvas.width, h = canvas.height;
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, "#04203a"); grad.addColorStop(1, "#020a14");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
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
  el.innerHTML = "";
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
    scene.fog = new THREE.Fog(0x07090c, 42, 80);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    const home = new THREE.Vector3(0.5, 25, 23.5);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 14; controls.maxDistance = 52;
    controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.2;
    controls.screenSpacePanning = false;

    scene.add(new THREE.HemisphereLight(0xffe2bd, 0x1a1d24, 0.65));
    scene.add(new THREE.AmbientLight(0xfff0dc, 0.12));
    const sun = new THREE.DirectionalLight(0xfff1dc, 0.9); sun.position.set(-8, 20, 10); scene.add(sun);
    for (const [x, z, c] of [[-9.5, -9, 0xffb24a], [0.5, -9.5, 0x5ab8ff], [11, -9, 0xffb24a], [0, 3, 0xffc674], [16, 0, 0x7fd0ff], [16, 9, 0xffb24a], [-18, 0, 0xffb24a]] as [number, number, number][]) {
      const p = new THREE.PointLight(c, 9, 18, 1.4); p.position.set(x, 6, z); scene.add(p);
    }

    // Warm pools of light over the two rows of agent desks.
    for (const [x, z] of DESKS) { const lamp = new THREE.PointLight(0xffd8a0, 1.6, 6, 1.8); lamp.position.set(x, 4.2, z - 0.2); scene.add(lamp); }
    // Floor, walkways and rooms.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 30), new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.3, metalness: 0.5 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const amber = mat.glow(0xffa53a);
    const strip = (x1: number, z1: number, x2: number, z2: number, width = 0.07, color: THREE.Material = amber) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, width), color);
      m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2); m.rotation.y = -Math.atan2(z2 - z1, x2 - x1); scene.add(m);
    };
    for (const [a, b, c, d] of [[-13, -4, 11, -4], [11, -4, 11, 10.5], [11, 10.5, -13, 10.5], [-13, 10.5, -13, -4]] as [number, number, number, number][]) strip(a, b, c, d, 0.09);
    const tile = new THREE.MeshStandardMaterial({ color: 0x2f2b27, roughness: 0.35, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x8fb8d8, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.2 });
    const room = (x1: number, z1: number, x2: number, z2: number, title: string, subtitle: string, frame = amber, plaqueX?: number) => {
      const w = x2 - x1, d = z2 - z1, cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), tile); base.position.set(cx, 0.04, cz); scene.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, 0.15), wallMat); back.position.set(cx, 1.6, z1); scene.add(back);
      for (const [px, pz, rw, rd] of [[x1, cz, 0.06, d], [x2, cz, 0.06, d], [cx, z2, w, 0.06]] as [number, number, number, number][]) {
        const pane = new THREE.Mesh(new THREE.BoxGeometry(rw, 1.4, rd), glass); pane.position.set(px, 0.78, pz); scene.add(pane);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(rw + 0.02, 0.05, rd + 0.02), frame); rail.position.set(px, 1.5, pz); scene.add(rail);
      }
      strip(x1, z1 + 0.12, x2, z1 + 0.12, 0.05, frame);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.06), frame); top.position.set(cx, 3.2, z1); scene.add(top);
      const label = plaque(title, subtitle); label.position.set(plaqueX ?? cx, 3.9, z1); scene.add(label);
    };
    room(-15.5, -13, -3.5, -5.6, "Sala de Reunião", "análise e estratégia", amber, -14.6);
    room(-3, -13, 4, -5.6, "IA Central", "lendo notícias do mercado", mat.glow(0x4fb6ff));
    room(5, -13, 18, -5.6, "Sala de Descanso", "café e sinuca");
    room(12.5, -3, 21.5, 3.8, "Laboratório", "testes de estratégias", mat.glow(0x4fb6ff));
    room(12.5, 5, 21.5, 12.5, "Gestão de Risco", "controle e segurança");
    room(-22, 7.4, -14.5, 13, "Saída", "IAs eliminadas", mat.glow(0xff4d6a));
    const stationsLabel = plaque("Estações dos Agentes", "computadores · trabalhando"); stationsLabel.position.set(-0.5, 2.6, 2.1); scene.add(stationsLabel);

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

    // Agent desks with three monitors each; screens are recoloured by the agent's result.
    const textures = { gain: chartTexture("#3dffa8", 3), loss: chartTexture("#ff5d7d", 11), flat: chartTexture("#5ee7ff", 7) };
    const screens: THREE.MeshBasicMaterial[] = [];
    const deskPlates: CSS2DObject[] = [];
    DESKS.forEach(([x, z], i) => {
      box(3.4, 0.08, 1.3, x, 0.78, z, deskTop);
      box(3.3, 0.7, 0.06, x, 0.42, z - 0.6, black);
      const screen = new THREE.MeshBasicMaterial({ map: textures.flat, toneMapped: false });
      screens.push(screen);
      for (const dx of [-1.05, 0, 1.05]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 0.04), black); m.position.set(x + dx, 1.25, z - 0.35); m.rotation.y = -dx * 0.25; scene.add(m);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.53), screen); s.position.set(x + dx, 1.25, z - 0.32); s.rotation.y = -dx * 0.25; scene.add(s);
      }
      box(0.9, 0.03, 0.3, x, 0.83, z + 0.15, black);
      chair(x, z + 1.05, Math.PI);
      const p = plaque("", "", "plaque desk-plate"); p.position.set(x, 2.15, z - 0.4); p.visible = false; scene.add(p); deskPlates.push(p);
      if (i % 4 === 3) plant(x + 2.7, z - 0.4, 0.8);
    });

    // Meeting room: table, chairs, big TV.
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.1, 48), wood); table.scale.set(2.6, 1, 1.25); table.position.set(TABLE[0], 0.8, TABLE[1]); scene.add(table);
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.75), black); tableLeg.position.set(TABLE[0], 0.38, TABLE[1]); scene.add(tableLeg);
    for (let i = 0; i < 6; i++) { const [x, z] = slotFor("MEETING", i, 0).pos; chair(x, z, Math.atan2(TABLE[0] - x, TABLE[1] - z) + Math.PI); }
    const tvCanvas = document.createElement("canvas"); tvCanvas.width = 1280; tvCanvas.height = 380;
    const tvTexture = new THREE.CanvasTexture(tvCanvas); tvTexture.colorSpace = THREE.SRGBColorSpace;
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 2.5), new THREE.MeshBasicMaterial({ map: tvTexture, toneMapped: false }));
    tv.position.set(-8.6, 2.2, -12.85); scene.add(tv);
    box(8.6, 2.7, 0.08, -8.6, 2.2, -12.92, black);
    plant(-14.6, -12.2); plant(-4.4, -12.2, 0.8);

    // IA Central: glass cylinder with a pulsing hologram.
    const core = new THREE.Group(); core.position.set(0.5, 0, -9.4); scene.add(core);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.4, 48), black); pedestal.position.y = 0.2; core.add(pedestal);
    const ring = (r: number, y: number) => { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 8, 64), mat.glow(0x4fb6ff)); t.rotation.x = Math.PI / 2; t.position.y = y; core.add(t); return t; };
    const rings = [ring(1.55, 0.42), ring(1.1, 2.9), ring(0.8, 3.15)];
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 3, 48, 1, true), glass); tube.position.y = 1.9; core.add(tube);
    const brain = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 2), new THREE.MeshBasicMaterial({ color: 0x5ab8ff, wireframe: true, toneMapped: false }));
    brain.position.y = 1.8; core.add(brain);
    const brainCore = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), mat.glow(0x2f7fff)); brainCore.position.y = 1.8; core.add(brainCore);
    for (const dx of [-2.6, 2.6]) { box(0.6, 2.4, 0.5, 0.5 + dx, 1.2, -12.2, black); box(0.45, 2.1, 0.02, 0.5 + dx, 1.2, -11.94, mat.glow(0x153a66)); }

    // Rest room: sofas, coffee machine, pool table.
    const sofa = new THREE.MeshStandardMaterial({ color: 0x8c8274, roughness: 0.85 });
    box(3.8, 0.45, 1, 8.9, 0.3, -10.4, sofa); box(3.8, 0.7, 0.3, 8.9, 0.7, -10.9, sofa);
    box(1.6, 0.4, 0.9, 8.9, 0.22, -8.2, wood);
    box(0.9, 1.8, 0.7, 6.0, 0.9, -12.3, black); box(0.5, 0.3, 0.05, 6.0, 1.3, -11.94, mat.glow(0xffb24a));
    box(4.2, 0.18, 2.4, 14.5, 0.8, -9.2, wood);
    box(3.8, 0.04, 2.0, 14.5, 0.9, -9.2, new THREE.MeshStandardMaterial({ color: 0x0f6b4e, roughness: 0.9 }));
    for (const [dx, dz] of [[-1.8, -0.9], [1.8, -0.9], [-1.8, 0.9], [1.8, 0.9]]) box(0.2, 0.75, 0.2, 14.5 + dx, 0.38, -9.2 + dz, black);
    [0xffd55c, 0xff5d7d, 0xffffff, 0x4fb6ff].forEach((c, i) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.2 }));
      ball.position.set(13.8 + i * 0.4, 0.97, -9.3 + (i % 2) * 0.3); scene.add(ball);
    });
    plant(17.2, -12.2); plant(5.6, -6.6, 0.7);

    // Lab, risk desk, reception, exit door.
    box(5, 0.08, 1.3, 17, 0.78, -0.6, deskTop);
    for (const dx of [-1.8, -0.6, 0.6, 1.8]) { box(1.05, 0.62, 0.04, 17 + dx, 1.3, -1.05, black); box(0.98, 0.55, 0.01, 17 + dx, 1.3, -1.02, new THREE.MeshBasicMaterial({ map: textures.flat, toneMapped: false })); }
    const holo = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0x4fb6ff, wireframe: true, toneMapped: false })); holo.position.set(19.8, 1.9, 1.6); scene.add(holo);
    box(4.5, 0.08, 1.3, 17, 0.78, 8.6, deskTop);
    for (const dx of [-1.2, 0, 1.2]) { box(1.05, 0.62, 0.04, 17 + dx, 1.3, 8.15, black); box(0.98, 0.55, 0.01, 17 + dx, 1.3, 8.18, new THREE.MeshBasicMaterial({ map: textures.gain, toneMapped: false })); }
    const shield = new THREE.Mesh(new THREE.CircleGeometry(0.7, 6), mat.glow(0xffb24a)); shield.position.set(17, 2.4, 5.12); scene.add(shield);
    const recep = new THREE.Mesh(new THREE.TorusGeometry(2, 0.35, 12, 48, Math.PI), deskTop); recep.rotation.x = -Math.PI / 2; recep.position.set(-18.4, 0.6, 1.5); scene.add(recep);
    box(4.5, 3.4, 0.2, -18.4, 1.7, -2.4, wallMat);
    const logo = plaque("ATLAS", "Trading AI System", "plaque logo-plate"); logo.position.set(-18.4, 2.2, -2.2); scene.add(logo);
    box(1.4, 2.4, 0.1, -20.8, 1.2, 12.9, mat.glow(0x4a0d18));
    plant(-14.2, -3.6); plant(-14.2, 6.6); plant(11.8, -3.6, 0.8); plant(11.8, 11.6, 0.8); plant(-1, 11.7, 0.8);

    // Decorative staff, labelled by role (never agents, never money).
    const staff: { robot: ReturnType<typeof makeRobot>; pose: Slot["pose"] }[] = [];
    const addStaff = (x: number, z: number, face: number, pose: Slot["pose"], role: string) => {
      const robot = makeRobot(new THREE.Color(0xffb24a));
      robot.group.position.set(x, 0, z); robot.group.rotation.y = face; robot.group.scale.setScalar(2.1); scene.add(robot.group);
      const tag = plaque(role, "", "plaque staff-plate"); tag.position.set(0, 2.15, 0); robot.group.add(tag);
      staff.push({ robot, pose });
    };
    addStaff(-18.4, 2.6, Math.PI, "type", "Recepção");
    addStaff(17, 0.3, Math.PI, "type", "Pesquisa");
    addStaff(17, 9.5, Math.PI, "type", "Risco");
    const wanderer = makeRobot(new THREE.Color(0xffb24a)); wanderer.group.scale.setScalar(2.1); scene.add(wanderer.group);
    const loop: V2[] = [[-12.3, 10], [10.3, 10], [10.3, -3.4], [-12.3, -3.4]];
    let wanderT = 0;

    // Agents.
    const robots = new Map<string, Robot>();
    const pickables: THREE.Object3D[] = [];
    let current: OfficeAgent[] = [];
    let selectedId: string | null = null;
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
      current = list; selectedId = sel;
      const counters: Partial<Record<OfficeZone, number>> = {};
      list.forEach((agent, i) => {
        if (!deskOf.has(agent.id)) deskOf.set(agent.id, deskOf.size);
        const desk = deskOf.get(agent.id)!;
        let r = robots.get(agent.id);
        const first = !r;
        if (!r) {
          const made = makeRobot(new THREE.Color(`hsl(${hue(agent.id)}, 90%, 60%)`));
          const labelEl = document.createElement("div");
          labelEl.className = "agent3d-label";
          labelEl.addEventListener("pointerdown", (e) => { e.stopPropagation(); select.current(agent.id); });
          const label = new CSS2DObject(labelEl); label.position.set(0, 2.15, 0); made.group.add(label);
          made.group.scale.setScalar(2.1);
          made.group.userData.agentId = agent.id;
          made.group.traverse((o) => { o.userData.agentId = agent.id; });
          scene.add(made.group); pickables.push(made.group);
          r = { ...made, label, labelEl, path: [], slot: null, key: "", phase: i * 1.7, ghost: false };
          robots.set(agent.id, r);
        }
        const index = counters[agent.zone] ?? 0; counters[agent.zone] = index + 1;
        setTarget(r, slotFor(agent.zone, index, desk), `${agent.zone}:${index}:${desk}`, first);
        // Neighbours in the same room alternate label heights so names never overlap.
        r.label.position.y = 2.15 + (agent.zone === "DESK" ? 0 : (index % 2) * 0.62);
        const t = tone(agent.pnl);
        r.labelEl.className = `agent3d-label ${t} ${sel === agent.id ? "selected" : ""} zone-${agent.zone.toLowerCase()}`;
        r.labelEl.replaceChildren();
        const name = document.createElement("b"); name.textContent = `${agent.name} · ${agent.ticker}`;
        const value = document.createElement("span"); value.textContent = money(agent.pnl);
        r.labelEl.append(name, value);
        r.labelEl.title = agent.activity;
        const dead = agent.zone === "OUT";
        if (dead !== r.ghost) {
          r.ghost = dead;
          r.group.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) { o.material.transparent = dead; o.material.opacity = dead ? 0.35 : 1; } });
        }
        screens[desk % screens.length].map = textures[t];
        screens[desk % screens.length].needsUpdate = true;
        const plate = deskPlates[desk % deskPlates.length];
        plate.visible = agent.zone !== "DESK";
        const [title, sub] = plate.element.children as unknown as HTMLElement[];
        if (title) title.textContent = agent.name;
        const away = agent.zone === "OUT" ? "eliminada" : "fora da mesa";
        if (sub) sub.textContent = `${agent.ticker} · ${away}`;
        else { const s = document.createElement("span"); s.textContent = `${agent.ticker} · ${away}`; plate.element.appendChild(s); }
      });
      for (const [id, r] of robots) if (!list.some((a) => a.id === id)) { scene.remove(r.group); robots.delete(id); }
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
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 1.25);
    composer.addPass(bloom);
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
      else { r.arms[0].rotation.x = seated ? -0.4 : Math.sin(t * 1.2 + phase) * 0.05; r.arms[1].rotation.x = r.arms[0].rotation.x; }
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
        } else if (r.slot) pose(r, r.ghost ? "stand" : r.slot.pose, t, r.phase);
      }
      for (const s of staff) pose(s.robot, s.pose, t, 2);
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
        holo.rotation.y = t * 0.6; holo.rotation.x = t * 0.25;
      }
      controls.update();
      composer.render();
      labels.render(scene, camera);
    };
    tick();

    api.current = {
      sync, tv: updateTv,
      reset: () => { camera.position.copy(home).multiplyScalar(el.clientWidth / el.clientHeight < 1.2 ? 1.45 : 1); controls.target.set(0, 0, 0); },
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
      void current; void selectedId;
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
