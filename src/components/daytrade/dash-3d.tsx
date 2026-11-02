"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LocateFixed, PersonStanding } from "lucide-react";
import { ELEVATOR, officeById, TOWER, windowBays } from "@/core/building";
import { DESKS, deskState, MARKET_LABEL, DATA_LABEL, SECTORS, sectorOf, type DashStatus } from "@/core/daytrade/desks";
import { lookFor, type PersonLook } from "@/core/people";
import { makePerson, posterTexture, S, SEAT_Y, type Person } from "@/components/office-3d";
import { DASH_FLOOR, RECEPTION, PARTITIONS, POSTERS, deskAt, FURNITURE, ISLANDS, PATROL, PLANTS, ROOM_FRONT, ROOMS, RUGS, SEATS, VIDEO_WALL } from "./dash-layout";
import { Mass } from "@/components/building/city";
import { buildSurroundings, SHAFT } from "@/components/building/tower";

/** This office's floor in the ATLAS tower. */
const FLOOR = officeById("dash")!.floor;
const W = TOWER.width, D = TOWER.depth, H = TOWER.ceiling;

/** A canvas texture to draw a screen on. */
function screen(w: number, h: number) {
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return { g: canvas.getContext("2d")!, texture };
}

/**
 * The DASH trading room on floor 9 of the ATLAS tower (owner, 01/11/2026: "crie o escritório do
 * DASH para eu poder entrar e começar a mexer"): a horseshoe of desks facing the wall screen, one
 * agent per role (core/daytrade/desks.ts), glass walls with the city outside and the elevator where
 * the entrance is. The screens only show what is known: with no feed and no account they say so.
 * Drag to turn, wheel to zoom; or walk the room in first person, as in the dividends office.
 */
export function Dash3D({ status }: { status: DashStatus }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset: () => void; status: (s: DashStatus) => void; walk: (on: boolean) => void } | null>(null);
  const [failed, setFailed] = useState(false);
  const [walking, setWalking] = useState(false);
  const initial = useRef(status);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const mobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: mobile ? "low-power" : "high-performance" }); }
    catch { queueMicrotask(() => setFailed(true)); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1 : 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = !mobile; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer(); labels.domElement.className = "dash3d-labels"; el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const surroundings = buildSurroundings(scene, { floor: FLOOR, mobile });
    const sky = new THREE.HemisphereLight(0xeaf3ff, 0x8a7d6a, 1.1); scene.add(sky);
    const sun = new THREE.DirectionalLight(0xfff0d2, 1.9); sun.position.set(-20, 34, 22); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 22, bottom: -22, near: 1, far: 90 }); sun.shadow.bias = -0.0004;
    scene.add(sun);
    if (surroundings.userData.night) { sky.intensity = 0.6; sun.intensity = 0.55; sun.color.set(0x9fb4ff); scene.environmentIntensity = 0.5; }

    const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 6000);
    const home = new THREE.Vector3(0, 30, 34);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 12; controls.maxDistance = 70;
    controls.minPolarAngle = 0.3; controls.maxPolarAngle = 1.3; controls.screenSpacePanning = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    const reset = () => { camera.position.copy(home).multiplyScalar(el.clientWidth / Math.max(1, el.clientHeight) < 1.2 ? 1.4 : 1); controls.target.set(0, 0, 0); };
    reset();
    // Coming in from the ATLAS map: the camera starts outside the tower and flies in.
    const goal = camera.position.clone(), entry = { from: new THREE.Vector3(-55, 60, 150), at: -1 };
    try {
      if (sessionStorage.getItem("atlas-entering") === String(FLOOR)) {
        sessionStorage.removeItem("atlas-entering");
        if (!reduced) { entry.at = 0; camera.position.copy(entry.from); controls.maxDistance = Infinity; controls.enabled = false; }
      }
    } catch { /* storage blocked */ }

    const matte = (color: THREE.ColorRepresentation, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
    const add = (o: THREE.Object3D) => { o.traverse((c) => { if (c instanceof THREE.Mesh && !(c.material as THREE.Material).transparent) { c.castShadow = true; c.receiveShadow = true; } }); scene.add(o); return o; };
    const white = matte("#f4f6f8", 0.5), metal = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.35, metalness: 0.6 });

    // Floor: light polished concrete, as a modern open office.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matte(DASH_FLOOR, 0.6)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

    // Walls: glass all round with white frames; low at the front so the room is seen from outside.
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8f1ff, transparent: true, opacity: 0.2, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
    const frames = new Mass(), panes = new Mass();
    const wall = (along: "x" | "z", at: number, length: number, h: number) => {
      for (const b of windowBays(length)) {
        const mid = (b.from + b.to) / 2, len = b.to - b.from;
        if (along === "x") { panes.box(mid, 0, at, len - 0.1, h, 0.05, false); frames.box(b.from, 0, at, 0.12, h, 0.14, false); }
        else { panes.box(at, 0, mid, 0.05, h, len - 0.1, false); frames.box(at, 0, b.from, 0.14, h, 0.12, false); }
      }
      if (along === "x") frames.box(0, h, at, length, 0.12, 0.16); else frames.box(at, h, 0, 0.16, 0.12, length);
    };
    wall("x", -D / 2, W, H); wall("z", -W / 2, D, H); wall("z", W / 2, D, H);
    // Front: glass too, floor to ceiling (owner, 01/11/2026: "tem que ter vidro"), with the elevator where the entrance is.
    const frontLeft = W / 2 + (ELEVATOR.x - ELEVATOR.width / 2), frontRight = W / 2 - (ELEVATOR.x + ELEVATOR.width / 2);
    panes.box(-W / 2 + frontLeft / 2, 0, D / 2, frontLeft, H, 0.05, false); panes.box(W / 2 - frontRight / 2, 0, D / 2, frontRight, H, 0.05, false);
    for (const b of windowBays(W)) if (b.from < ELEVATOR.x - ELEVATOR.width / 2 || b.from > ELEVATOR.x + ELEVATOR.width / 2) frames.box(b.from, 0, D / 2, 0.12, H, 0.14, false);
    frames.box(0, H, D / 2, W, 0.12, 0.16);
    scene.add(new THREE.Mesh(panes.geometry(), glass)); add(new THREE.Mesh(frames.geometry(), white));
    {
      const brushed = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.28, metalness: 0.85 }), x0 = ELEVATOR.x, half = ELEVATOR.width / 2, z = D / 2;
      const e = new Mass(); e.box(x0 - half + 0.15, 0, z, 0.3, H, 0.24, false); e.box(x0 + half - 0.15, 0, z, 0.3, H, 0.24, false); e.box(x0, 2.6, z, ELEVATOR.width, H - 2.6, 0.24);
      add(new THREE.Mesh(e.geometry(), metal));
      const doors = new Mass(); for (const s of [-1, 1]) doors.box(x0 + s * (half - 0.3) / 2, 0, z - 0.06, half - 0.32, 2.6, 0.06);
      add(new THREE.Mesh(doors.geometry(), brushed));
      const sign = screen(256, 96); sign.g.fillStyle = "#0b0d10"; sign.g.fillRect(0, 0, 256, 96); sign.g.fillStyle = "#ffb347"; sign.g.font = "bold 64px sans-serif"; sign.g.textAlign = "center"; sign.g.textBaseline = "middle"; sign.g.fillText(`${FLOOR} ▲▼`, 128, 50); sign.texture.needsUpdate = true;
      const display = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), new THREE.MeshBasicMaterial({ map: sign.texture, toneMapped: false })); display.position.set(x0, 3.0, z - 0.13); display.rotation.y = Math.PI; scene.add(display);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.width + 0.4, H + 0.45, ELEVATOR.depth), SHAFT()); shaft.position.set(x0, (H - 0.45) / 2, z + ELEVATOR.depth / 2); scene.add(shaft);
    }

    // The wall screen: the state of the office, honestly.
    const wallScreen = screen(1600, 560);
    const drawWall = (s: DashStatus) => {
      const g = wallScreen.g; g.fillStyle = "#06090f"; g.fillRect(0, 0, 1600, 560);
      g.fillStyle = "#e3c28d"; g.font = "bold 64px sans-serif"; g.textBaseline = "top"; g.fillText("DASH", 50, 40);
      g.fillStyle = "#a9b6cc"; g.font = "30px sans-serif"; g.fillText("Núcleo de Análise e Estratégia de Day Trade", 240, 62);
      g.fillStyle = s.mode === "SIMULATED" ? "#ffb347" : "#ff5d7d"; g.fillRect(1290, 44, 260, 64); g.fillStyle = "#06090f"; g.font = "bold 34px sans-serif"; g.fillText(s.mode === "SIMULATED" ? "SIMULADO" : "REAL", 1322, 58);
      const rows: [string, string][] = [["Mercado", MARKET_LABEL[s.market]], ["Dados", DATA_LABEL[s.data]], ["Corretora", s.broker ?? "Nenhuma conectada"], ["Instrumento", s.instrument ?? "—"], ["Sinais em análise", String(s.signals)], ["Ordens hoje", String(Object.values(s.orders).reduce((a, b) => a + b, 0))]];
      rows.forEach(([k, v], i) => { const x = 50 + (i % 3) * 520, y = 180 + Math.floor(i / 3) * 170; g.fillStyle = "#6f7d93"; g.font = "28px sans-serif"; g.fillText(k, x, y); g.fillStyle = "#eef3fb"; g.font = "bold 46px sans-serif"; g.fillText(v, x, y + 44); });
      g.fillStyle = "#3b4658"; g.font = "26px sans-serif"; g.fillText("Sem dado confiável, a mesa não opera.", 50, 500);
      wallScreen.texture.needsUpdate = true;
    };
    // The video wall on the analysis room's glass, facing the trading floor.
    const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(VIDEO_WALL.w, VIDEO_WALL.h), new THREE.MeshBasicMaterial({ map: wallScreen.texture, toneMapped: false }));
    wallMesh.position.set(VIDEO_WALL.x, VIDEO_WALL.y + VIDEO_WALL.h / 2, VIDEO_WALL.z); scene.add(wallMesh);
    add(new THREE.Mesh(new THREE.BoxGeometry(VIDEO_WALL.w + 0.3, VIDEO_WALL.h + 0.3, 0.15), metal)).position.set(VIDEO_WALL.x, VIDEO_WALL.y + VIDEO_WALL.h / 2, VIDEO_WALL.z - 0.1);

    // ----- The floor plan (dash-layout.ts, the same the map shows) -----
    /** What blocks the way in first person: boxes x0, z0, x1, z1. */
    const obstacles: [number, number, number, number][] = [[-W / 2, -D / 2, ROOMS[ROOMS.length - 1].x1 + 0.2, ROOM_FRONT + 0.15]];
    const block = (x: number, z: number, w: number, d: number) => obstacles.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
    const pale = (hex: string, k: number) => new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), k);
    const wood = matte("#b98a5a", 0.6), deskMat = matte("#f4f1ea", 0.55), chairMat = matte("#22262d", 0.6), screenBack = matte("#1b1e24", 0.4);
    const brushedSteel = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.28, metalness: 0.85 });

    // Back rooms behind glass: white partitions, a colour wall at the back of each, a glass front with a door, the name on the glass.
    {
      const partitions = new Mass(), fronts = new Mass(), mullions = new Mass(), depth = ROOM_FRONT + D / 2;
      for (const r of ROOMS) {
        if (r.x0 > -W / 2) partitions.box(r.x0, 0, -D / 2 + depth / 2, 0.14, H, depth, false);
        const accent = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0 - 0.3, H, 0.06), matte(pale(r.color, 0.15), 0.85));
        accent.position.set((r.x0 + r.x1) / 2, H / 2, -D / 2 + 0.1); add(accent);
        for (const [a, b] of [[r.x0 + 0.08, r.door - 0.7], [r.door + 0.7, r.x1 - 0.08]]) fronts.box((a + b) / 2, 0, ROOM_FRONT, b - a, H, 0.05, false);
        for (const x of [r.x0 + 0.07, r.door - 0.7, r.door + 0.7, r.x1 - 0.07]) mullions.box(x, 0, ROOM_FRONT, 0.08, H, 0.1, false);
        const name = screen(512, 96); name.g.fillStyle = r.color; name.g.font = "bold 46px sans-serif"; name.g.textBaseline = "middle"; name.g.fillText(r.name, 18, 50); name.texture.needsUpdate = true;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.49), new THREE.MeshBasicMaterial({ map: name.texture, transparent: true, toneMapped: false }));
        sign.position.set(r.door - 0.7 - 1.4, 2.5, ROOM_FRONT + 0.04); scene.add(sign);
      }
      partitions.box(ROOMS[ROOMS.length - 1].x1, 0, -D / 2 + depth / 2, 0.14, H, depth, false);
      mullions.box((ROOMS[0].x0 + ROOMS[ROOMS.length - 1].x1) / 2, H - 0.06, ROOM_FRONT, ROOMS[ROOMS.length - 1].x1 - ROOMS[0].x0, 0.08, 0.1);
      add(new THREE.Mesh(partitions.geometry(), white)); scene.add(new THREE.Mesh(fronts.geometry(), glass)); add(new THREE.Mesh(mullions.geometry(), metal));
      // Analysis room chairs round the committee table.
      for (const x of [-8.7, -6.9, -5.1, -3.3]) for (const [z, f] of [[-10.95, 1], [-8.05, -1]] as const) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.55), chairMat); seat.position.set(x, 0.48, z); add(seat);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.07), chairMat); back.position.set(x, 0.82, z - f * 0.27); add(back);
      }
    }

    // Sector islands: a rug in the sector's colour and a hanging sign with its name.
    for (const island of ISLANDS) {
      const sector = SECTORS.find((s) => s.id === island.sector)!;
      const rug = new THREE.Mesh(new THREE.BoxGeometry(island.w, 0.02, 3.9), matte(pale(sector.color, 0.45), 0.95));
      rug.position.set(island.x, 0.011, island.z + 0.3); rug.receiveShadow = true; scene.add(rug);
      const text = screen(512, 112);
      text.g.fillStyle = sector.color; text.g.fillRect(0, 0, 512, 112); text.g.fillStyle = "#0f1626"; text.g.font = "bold 46px sans-serif"; text.g.textAlign = "center"; text.g.textBaseline = "middle";
      text.g.fillText(sector.name, 256, 58); text.texture.needsUpdate = true;
      for (const turn of [0, Math.PI]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.52), new THREE.MeshBasicMaterial({ map: text.texture, toneMapped: false }));
        sign.position.set(island.x, 2.85, island.z - 0.35 + (turn ? -0.02 : 0.02)); sign.rotation.y = turn; scene.add(sign);
      }
      for (const dx of [-1, 1]) { const wire = new THREE.Mesh(new THREE.BoxGeometry(0.01, H - 3.1, 0.01), metal); wire.position.set(island.x + dx * 1.1, 3.1 + (H - 3.1) / 2, island.z - 0.35); scene.add(wire); }
    }

    // Desks: one per agent (the supervisor's is a standing desk), two monitors showing the desk's own work.
    // People: the same detailed figures as in the DAWN office (office-3d makePerson), each agent's own
    // look (shirt, skin, hair), sitting at work, the supervisor walking his round.
    const people: { person: Person; phase: number; walker?: boolean }[] = [];
    const monitors: { draw: (s: DashStatus) => void }[] = [];
    const FEMININE = new Set(["Marta", "Nina", "Lia", "Dani", "Bia", "Duda", "Vera", "Paula"]);
    const figure = (who: { name: string; shirt: string; hair: string; skin: string }, id: string, title: string, color: string, k: number) => {
      const feminine = FEMININE.has(who.name);
      const look: PersonLook = { ...lookFor(who.name, id), presentation: feminine ? "feminine" : "masculine", shirt: who.shirt, skin: who.skin, hair: who.hair,
        hairStyle: (feminine ? ["long", "bun", "ponytail", "curly"] : ["short", "buzz", "curly", "short"])[k % 4] as PersonLook["hairStyle"], glasses: k % 3 === 1 };
      const person = makePerson(look);
      const tag = document.createElement("div"); tag.className = "dash-desk-tag"; tag.style.setProperty("--desk", color);
      // Just the name over the head (desks are close together); the role is on the desk's monitors and in the Equipe tab.
      tag.innerHTML = `<b>${who.name}</b>`; tag.title = title;
      const label = new CSS2DObject(tag); label.position.set(0, 1.95, 0); person.group.add(label);
      return person;
    };
    // The receptionist, at the reception desk by the elevator, facing whoever comes in.
    {
      const person = figure({ name: "Paula", shirt: "#ffffff", hair: "#3b2a1c", skin: "#d9a47c" }, "reception", "Recepção", "#e3c28d", 2);
      person.group.position.set(RECEPTION.x, 0, RECEPTION.z); add(person.group);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), chairMat); seat.position.set(RECEPTION.x, SEAT_Y - 0.05, RECEPTION.z); add(seat);
      people.push({ person, phase: 9 });
    }
    DESKS.forEach((desk, k) => {
      const seat = SEATS[desk.id], sector = sectorOf(desk);
      if (seat.standing) {
        // The supervisor: on his round of the floor (animated below).
        const person = figure(desk.person, desk.id, desk.role, sector.color, k); person.group.position.set(PATROL[0][0], 0, PATROL[0][1]); add(person.group);
        people.push({ person, phase: k * 1.7, walker: true });
        return;
      }
      const at = deskAt(desk.id), f = seat.face;
      const g = new THREE.Group(); g.position.set(at.x, 0, at.z); g.rotation.y = f > 0 ? 0 : Math.PI;
      // In the group, the agent sits at -z and looks at +z, across the desk to the monitors.
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.8), deskMat); top.position.set(0, 0.74, 0); g.add(top);
      for (const sx of [-0.85, 0.85]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.74, 0.7), metal); leg.position.set(sx, 0.37, 0); g.add(leg); }
      for (let n = 0; n < 2; n++) {
        const s = screen(512, 300), offset = (n - 0.5) * 0.66;
        const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.37), new THREE.MeshBasicMaterial({ map: s.texture, toneMapped: false }));
        mon.position.set(offset, 1.12, 0.26); mon.rotation.y = Math.PI; g.add(mon);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.4, 0.03), screenBack); back.position.set(offset, 1.12, 0.28); g.add(back);
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), metal); stand.position.set(offset, 0.88, 0.3); g.add(stand);
        monitors.push({ draw: (st) => {
          const c = s.g; c.fillStyle = "#070b12"; c.fillRect(0, 0, 512, 300);
          c.fillStyle = sector.color; c.fillRect(0, 0, 512, 46); c.fillStyle = "#06090f"; c.font = "bold 24px sans-serif"; c.textBaseline = "middle"; c.fillText(desk.role.toUpperCase(), 16, 24);
          c.strokeStyle = "#2a3446"; c.lineWidth = 2; for (let y = 90; y < 280; y += 45) { c.beginPath(); c.moveTo(16, y); c.lineTo(496, y); c.stroke(); }
          c.fillStyle = "#8fa0b8"; c.font = "bold 30px sans-serif"; c.textAlign = "center";
          c.fillText(deskState(st) === "IDLE" ? (n === 0 ? "SEM DADOS" : "AGUARDANDO") : "OBSERVANDO", 256, 150);
          c.font = "20px sans-serif"; c.fillStyle = "#5c6b82"; c.fillText(n === 0 ? "função ainda não implementada" : st.mode === "SIMULATED" ? "modo simulado · nada é enviado" : "", 256, 210); c.textAlign = "left";
          s.texture.needsUpdate = true;
        } });
      }
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), chairMat); chair.position.set(0, SEAT_Y - 0.1, -0.95); g.add(chair);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.08), chairMat); back.position.set(0, SEAT_Y + 0.35, -1.3); g.add(back);
      const person = figure(desk.person, desk.id, desk.role, sector.color, k); person.group.position.set(0, 0, -0.95); g.add(person.group);
      people.push({ person, phase: k * 1.7 });
      add(g);
      block(at.x, at.z - f * 0.45, 1.9, 1.9);
    });

    // Furniture: the analysis room's table and screens, the break area (kitchen, island, foosball,
    // lounge), the green divider, the reception and the DASH wall (dash-layout.ts).
    const roomScreens: { draw: (s: DashStatus) => void }[] = [];
    for (const b of FURNITURE) {
      const y = b.y ?? 0;
      if (b.kind === "glow") {
        const s = screen(768, Math.round((768 * b.h) / b.w));
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshBasicMaterial({ map: s.texture, toneMapped: false }));
        plane.position.set(b.x, y + b.h / 2, b.z + 0.05); scene.add(plane);
        add(new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.12, b.h + 0.12, 0.06), metal)).position.set(b.x, y + b.h / 2, b.z);
        roomScreens.push({ draw: (st) => {
          const c = s.g, w = s.g.canvas.width, h = s.g.canvas.height; c.fillStyle = "#070b12"; c.fillRect(0, 0, w, h);
          c.fillStyle = b.color; c.fillRect(0, 0, w, 60); c.fillStyle = "#06090f"; c.font = "bold 30px sans-serif"; c.textBaseline = "middle";
          const lines = b.label === "analise" ? ["SALA DE ANÁLISE", "Propostas em análise: 0", "Aprovação: risco e chefe; qualquer dúvida é não."]
            : b.label === "chefia" ? ["CHEFIA", `Sessão: ${st.market === "OPEN" ? "aberta" : "não iniciada"}`, "Plano do dia: aguardando feed."]
            : b.label === "tv" ? ["DASH TV", `Mercado: ${MARKET_LABEL[st.market].toLowerCase()}`, `Dados: ${DATA_LABEL[st.data].toLowerCase()}`]
            : ["REGISTRO E TRIBUTOS", "Operações registradas: 0", "IR de day trade: —"];
          c.fillText(lines[0], 20, 32); c.fillStyle = "#c9d6e2"; c.font = "26px sans-serif";
          lines.slice(1).forEach((t, i) => c.fillText(t, 20, 110 + i * 48));
          s.texture.needsUpdate = true;
        } });
        continue;
      }
      if (b.kind === "fabric" && b.w === b.d && b.h <= 0.6) {
        // A bean bag.
        const bag = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 12), matte(b.color, 0.95)); bag.scale.set(b.w / 1.4, b.h / 0.9, b.d / 1.4); bag.position.set(b.x, b.h / 2, b.z); add(bag);
        block(b.x, b.z, b.w, b.d); continue;
      }
      const material = b.kind === "wood" ? wood : b.kind === "steel" ? brushedSteel : b.kind === "plant" ? matte("#4f9a45", 0.85) : matte(b.color, b.kind === "fabric" ? 0.95 : 0.6);
      add(new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), material)).position.set(b.x, y + b.h / 2, b.z);
      if (y < 1 && b.h + y > 0.3) block(b.x, b.z, b.w, b.d);
      if (b.label === "books") {
        // Books on the shelves, in many colours.
        const books = ["#e85d75", "#3d7be0", "#2fae8c", "#f2b134", "#8a5cf6", "#ff7a59", "#1d3557"];
        for (let shelf = 0; shelf < 3; shelf++) for (let n = 0; n < 9; n++) {
          if ((n + shelf) % 4 === 3) continue;
          const book = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.04, 0.32, 0.12), matte(books[(n * 3 + shelf) % books.length], 0.7));
          book.position.set(b.x, 0.25 + shelf * 0.42, b.z - b.d / 2 + 0.3 + n * 0.3); scene.add(book);
        }
      }
    }
    // Each sector apart: low partitions in its colour round its island (dash-layout PARTITIONS).
    for (const p of PARTITIONS) {
      add(new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), matte(pale(p.color, 0.35), 0.7))).position.set(p.x, p.h / 2, p.z);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.04, 0.05, p.d + 0.04), white); cap.position.set(p.x, p.h + 0.025, p.z); scene.add(cap);
      block(p.x, p.z, Math.max(p.w, 0.3), Math.max(p.d, 0.3));
    }
    // Framed posters on the side walls, as in the DAWN office.
    for (const [x, y, z, turn, title, subtitle, background, accent] of POSTERS) {
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.62), new THREE.MeshStandardMaterial({ map: posterTexture(title, subtitle, background, accent), roughness: 0.6 }));
      poster.position.set(x, y, z); poster.rotation.y = turn; scene.add(poster);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.72, 0.04), matte("#1b1e24", 0.4)); frame.position.set(x - Math.sin(turn) * 0.03, y, z - Math.cos(turn) * 0.03); frame.rotation.y = turn; scene.add(frame);
    }
    for (const r of RUGS) { const rug = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), matte(r.color, 1)); rug.position.set(r.x, 0.012, r.z); rug.receiveShadow = true; scene.add(rug); }
    {
      // Foosball rods and players, stools round the kitchen island, the coffee table's top, the DASH name.
      for (let n = 0; n < 8; n++) {
        const x = 16.5 - 0.6 + n * (1.2 / 7), rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 6), brushedSteel);
        rod.rotation.x = Math.PI / 2; rod.position.set(x, 0.98, -3.6); scene.add(rod);
        for (const dz of n % 2 ? [-0.18, 0.18] : [0]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.06), matte(n < 4 ? "#ef476f" : "#118ab2", 0.6)); p.position.set(x, 0.92, -3.6 + dz); scene.add(p); }
      }
      for (const [x, z] of [[15.9, -8.2], [17.5, -8.2], [19.1, -8.2], [15.9, -10.6], [17.5, -10.6], [19.1, -10.6]]) {
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.75, 14), matte("#2b2e34", 0.5)); stool.position.set(x, 0.375, z); add(stool);
      }
      const dash = screen(512, 256); dash.g.fillStyle = "#0f1626"; dash.g.font = "800 150px sans-serif"; dash.g.textAlign = "center"; dash.g.textBaseline = "middle"; dash.g.fillText("DASH", 256, 112);
      dash.g.font = "bold 26px sans-serif"; dash.g.fillText("Day-trading Analysis & Strategy Hub", 256, 214); dash.texture.needsUpdate = true;
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshBasicMaterial({ map: dash.texture, transparent: true }));
      logo.position.set(-23.6, 1.7, 6.5); logo.rotation.y = Math.PI / 2; scene.add(logo);
    }
    for (const [px, pz] of PLANTS) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.6, 16), white); pot.position.set(px, 0.3, pz); add(pot); block(px, pz, 1, 1);
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), matte("#4f9a45", 0.85)); leaves.position.set(px, 1.2, pz); add(leaves);
    }
    const rules = screen(800, 520); {
      const g = rules.g; g.fillStyle = "#fbfbf8"; g.fillRect(0, 0, 800, 520); g.fillStyle = "#1d3557"; g.font = "bold 44px sans-serif"; g.textBaseline = "top"; g.fillText("Regras da mesa", 36, 30);
      g.font = "30px sans-serif"; g.fillStyle = "#2b2e34";
      ["1. Sem dado confiável, não operar", "2. Toda ordem passa pelo risco", "3. Stop confirmado na corretora", "4. Não operar também é resultado", "5. IA não decide ordens"].forEach((t, i) => g.fillText(t, 40, 110 + i * 76));
      rules.texture.needsUpdate = true;
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.08), new THREE.MeshBasicMaterial({ map: rules.texture })); board.position.set(-W / 2 + 0.2, 1.8, -1.6); board.rotation.y = Math.PI / 2; scene.add(board);

    /** Poses, as in the DAWN office: seated typing (a glance aside now and then), walking, standing to check. */
    const pose = (p: Person, kind: "type" | "walk" | "stand", t: number, phase: number) => {
      const swing = reduced ? 0 : Math.sin(t * 7 + phase), seated = kind === "type";
      p.mug.visible = false; p.cue.visible = false; p.phone.visible = false;
      p.rig.position.y = seated ? SEAT_Y / S - 0.92 : kind === "walk" ? Math.abs(swing) * 0.02 : 0;
      p.head.rotation.set(0, 0, 0); p.shoulders.forEach((s) => (s.rotation.z = 0));
      if (kind === "walk") {
        p.hips[0].rotation.x = swing * 0.5; p.hips[1].rotation.x = -swing * 0.5;
        p.knees[0].rotation.x = Math.max(0, -swing) * 0.6; p.knees[1].rotation.x = Math.max(0, swing) * 0.6;
        p.shoulders[0].rotation.x = -swing * 0.45; p.shoulders[1].rotation.x = swing * 0.45;
        p.elbows.forEach((e) => (e.rotation.x = -0.25));
        return;
      }
      p.hips.forEach((h) => (h.rotation.x = seated ? -Math.PI / 2 : 0));
      p.knees.forEach((k) => (k.rotation.x = seated ? Math.PI / 2 : 0));
      if (seated) {
        const moment = reduced ? 0.5 : (t / 30 + phase * 0.37) % 1;
        p.shoulders.forEach((s, i) => (s.rotation.x = -0.75 + (reduced ? 0 : Math.sin(t * 16 + phase + i) * 0.05)));
        p.elbows.forEach((e) => (e.rotation.x = -0.85));
        p.head.rotation.x = 0.12;
        if (moment < 0.12) { p.shoulders.forEach((s) => (s.rotation.x = -0.35)); p.elbows.forEach((e) => (e.rotation.x = -0.6)); p.head.rotation.set(-0.1, Math.sin(t * 0.8 + phase) * 0.35, 0); }
      } else {
        // Standing at an island: arms behind the back, looking over the desks.
        p.shoulders.forEach((s) => (s.rotation.x = 0.35)); p.elbows.forEach((e) => (e.rotation.x = -0.4));
        p.head.rotation.set(0.15, reduced ? 0 : Math.sin(t * 0.6 + phase) * 0.5, 0);
      }
    };
    // The supervisor's round: along PATROL, a stop at each corner to check the islands.
    const patrol = { leg: 0, t: 0, wait: 0 };
    const walkRound = (dt: number, t: number) => {
      const walker = people.find((p) => p.walker);
      if (!walker) return;
      const g = walker.person.group;
      if (patrol.wait > 0) { patrol.wait -= dt; pose(walker.person, "stand", t, walker.phase); return; }
      const [ax, az] = PATROL[patrol.leg], [bx, bz] = PATROL[(patrol.leg + 1) % PATROL.length], len = Math.hypot(bx - ax, bz - az);
      patrol.t += (1.1 * dt) / Math.max(0.01, len);
      if (patrol.t >= 1) { patrol.t = 0; patrol.leg = (patrol.leg + 1) % PATROL.length; patrol.wait = 2.5; }
      g.position.set(ax + (bx - ax) * patrol.t, 0, az + (bz - az) * patrol.t);
      g.rotation.y = Math.atan2(bx - ax, bz - az);
      pose(walker.person, "walk", t, walker.phase);
    };

    const sync = (s: DashStatus) => { drawWall(s); monitors.forEach((m) => m.draw(s)); roomScreens.forEach((m) => m.draw(s)); };
    sync(initial.current);

    // First person (as in the dividends office): from the elevator, W A S D or the arrows to walk,
    // drag to look around; desks, sofa, plants and the glass stop you.
    const walk = { on: false, yaw: 0, pitch: 0, keys: new Set<string>(), drag: null as { x: number; y: number } | null };
    const KEYS: Record<string, [number, number]> = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
    const firstPerson = (on: boolean) => {
      walk.on = on; walk.keys.clear(); controls.enabled = !on && entry.at < 0;
      if (on) { entry.at = -1; camera.position.set(ELEVATOR.x, 1.65, D / 2 - 2.2); walk.yaw = 0; walk.pitch = -0.05; }
      else reset();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!walk.on) return;
      const key = e.key.toLowerCase();
      if (key === "escape" && e.type === "keydown") { firstPerson(false); setWalking(false); return; }
      if (!KEYS[key]) return;
      e.preventDefault();
      if (e.type === "keydown") walk.keys.add(key); else walk.keys.delete(key);
    };
    const onLookStart = (e: PointerEvent) => { if (walk.on) walk.drag = { x: e.clientX, y: e.clientY }; };
    const onLook = (e: PointerEvent) => {
      if (!walk.on || !walk.drag) return;
      walk.yaw -= (e.clientX - walk.drag.x) * 0.005; walk.pitch = Math.max(-1.1, Math.min(1.1, walk.pitch - (e.clientY - walk.drag.y) * 0.004));
      walk.drag = { x: e.clientX, y: e.clientY };
    };
    const onLookEnd = () => { walk.drag = null; };
    window.addEventListener("keydown", onKey); window.addEventListener("keyup", onKey);
    labels.domElement.addEventListener("pointerdown", onLookStart); window.addEventListener("pointermove", onLook); window.addEventListener("pointerup", onLookEnd);
    const step = (dt: number) => {
      let ahead = 0, aside = 0;
      for (const k of walk.keys) { ahead += KEYS[k][1]; aside += KEYS[k][0]; }
      if (ahead || aside) {
        const len = Math.hypot(ahead, aside), speed = 3.2 * dt, sin = Math.sin(walk.yaw), cos = Math.cos(walk.yaw);
        const p = camera.position;
        p.x += ((-sin * ahead + cos * aside) / len) * speed; p.z += ((-cos * ahead - sin * aside) / len) * speed;
        p.x = Math.max(-W / 2 + 0.6, Math.min(W / 2 - 0.6, p.x)); p.z = Math.max(-D / 2 + 1.2, Math.min(D / 2 - 0.6, p.z));
        // Out of any piece of furniture (with a body's width round it), by the shortest way.
        const R = 0.35;
        for (const [x0, z0, x1, z1] of obstacles) {
          if (p.x <= x0 - R || p.x >= x1 + R || p.z <= z0 - R || p.z >= z1 + R) continue;
          const out = [[p.x - (x0 - R), 0], [(x1 + R) - p.x, 1], [p.z - (z0 - R), 2], [(z1 + R) - p.z, 3]].sort((a, b) => a[0] - b[0])[0][1];
          if (out === 0) p.x = x0 - R; else if (out === 1) p.x = x1 + R; else if (out === 2) p.z = z0 - R; else p.z = z1 + R;
        }
      }
      camera.rotation.set(walk.pitch, walk.yaw, 0, "YXZ");
    };
    api.current = { reset, status: sync, walk: firstPerson };

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const clock = new THREE.Clock();
    let frame = 0, running = false;
    const tick = () => {
      if (!running) return;
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      if (entry.at >= 0) {
        entry.at += dt;
        const k = Math.min(1, entry.at / 2.4), smooth = k * k * (3 - 2 * k);
        camera.position.lerpVectors(entry.from, goal, smooth);
        if (k >= 1) { entry.at = -1; controls.maxDistance = 70; controls.enabled = true; }
      }
      if (!reduced) {
        surroundings.userData.update?.(dt);
        for (const p of people) if (!p.walker) pose(p.person, "type", t, p.phase);
        walkRound(dt, t);
      }
      if (walk.on) step(dt); else controls.update();
      renderer.render(scene, camera); labels.render(scene, camera);
    };
    const start = () => { if (!running) { running = true; clock.getDelta(); frame = requestAnimationFrame(tick); } };
    const stop = () => { running = false; cancelAnimationFrame(frame); };
    const visibility = new IntersectionObserver(([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop())); visibility.observe(el);
    const onPage = () => (document.hidden ? stop() : start()); document.addEventListener("visibilitychange", onPage);
    start();
    return () => {
      stop(); visibility.disconnect(); observer.disconnect(); document.removeEventListener("visibilitychange", onPage);
      window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey);
      window.removeEventListener("pointermove", onLook); window.removeEventListener("pointerup", onLookEnd);
      controls.dispose(); pmrem.dispose();
      scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }); } });
      renderer.dispose(); el.replaceChildren(); api.current = null;
    };
  }, []);

  useEffect(() => { api.current?.status(status); }, [status]);
  useEffect(() => { api.current?.walk(walking); }, [walking]);

  if (failed) return <div className="dash3d dash3d-failed" role="status">O 3D não está disponível neste aparelho. O painel abaixo mostra o estado da mesa.</div>;
  return (
    <div className="dash3d">
      <div ref={host} className="dash3d-canvas" role="img" aria-label={`Sala do DASH no andar ${FLOOR} da sede ATLAS: ${DESKS.length} mesas (${DESKS.map((d) => `${d.person.name}, ${d.role}`).join("; ")}), telão e a cidade lá fora.`} />
      <div className="office3d-top">
        <button type="button" className={`icon-button secondary ${walking ? "active" : ""}`} onClick={() => setWalking((on) => !on)} aria-pressed={walking}
          aria-label={walking ? "Sair do modo andar" : "Andar pela sala do DASH"} title={walking ? "Sair do modo andar" : "Andar pela sala"}>
          <PersonStanding size={18} />
        </button>
        <button type="button" className="icon-button secondary" onClick={() => { setWalking(false); api.current?.reset(); }} aria-label="Centralizar a sala" title="Centralizar">
          <LocateFixed size={18} />
        </button>
      </div>
      {walking && <div className="office3d-fp-hint" role="status">
        <b>W A S D</b> ou setas para andar · arraste para olhar · <b>Esc</b> ou o bonequinho para sair
      </div>}
    </div>
  );
}
