"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { LocateFixed } from "lucide-react";
import { ELEVATOR, officeById, TOWER, windowBays } from "@/core/building";
import { DESKS, deskState, MARKET_LABEL, DATA_LABEL, type DashStatus } from "@/core/daytrade/desks";
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
 * Drag to turn, wheel to zoom.
 */
export function Dash3D({ status }: { status: DashStatus }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset: () => void; status: (s: DashStatus) => void } | null>(null);
  const [failed, setFailed] = useState(false);
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

    // Floor: dark trading floor with a warm rug under the horseshoe.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matte("#2f3540", 0.75)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 64), matte("#6b4f2f", 0.95)); rug.rotation.x = -Math.PI / 2; rug.scale.set(17, 12, 1); rug.position.set(0, 0.01, 1); rug.receiveShadow = true; scene.add(rug);

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
    // Front: low glass, with the elevator where the entrance is.
    const frontLeft = W / 2 + (ELEVATOR.x - ELEVATOR.width / 2), frontRight = W / 2 - (ELEVATOR.x + ELEVATOR.width / 2);
    panes.box(-W / 2 + frontLeft / 2, 0, D / 2, frontLeft, 1.1, 0.05, false); panes.box(W / 2 - frontRight / 2, 0, D / 2, frontRight, 1.1, 0.05, false);
    frames.box(0, 1.1, D / 2, W, 0.1, 0.16);
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
    const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 4.9), new THREE.MeshBasicMaterial({ map: wallScreen.texture, toneMapped: false }));
    wallMesh.position.set(0, 2.15, -D / 2 + 0.6); scene.add(wallMesh);
    add(new THREE.Mesh(new THREE.BoxGeometry(14.4, 5.3, 0.3), metal)).position.set(0, 2.15, -D / 2 + 0.42);

    // Horseshoe of desks facing the wall, one agent each.
    const people: { group: THREE.Group; head: THREE.Mesh; phase: number }[] = [];
    const monitors: { draw: (s: DashStatus) => void }[] = [];
    const deskMat = matte("#e9e4dc", 0.6), chairMat = matte("#22262d", 0.6), screenBack = matte("#1b1e24", 0.4);
    DESKS.forEach((desk, k) => {
      const supervisor = desk.id === "supervisor";
      // Five desks on an arc facing the wall screen, the supervisor's behind them in the middle.
      const angle = Math.PI * (0.12 + (k / 4) * 0.76);
      const x = supervisor ? 0 : Math.cos(angle) * 14, z = supervisor ? 9 : 4.5 - Math.sin(angle) * 9;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.lookAt(0, 0, supervisor ? -20 : -6);
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.4), deskMat); top.position.set(0, 0.76, 0); g.add(top);
      for (const sx of [-1.5, 1.5]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.76, 1.2), metal); leg.position.set(sx, 0.38, 0); g.add(leg); }
      // Two or three monitors with what the desk sees.
      const count = supervisor ? 3 : 2;
      for (let n = 0; n < count; n++) {
        const s = screen(512, 300), offset = (n - (count - 1) / 2) * 0.98;
        const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.54), new THREE.MeshBasicMaterial({ map: s.texture, toneMapped: false }));
        mon.position.set(offset, 1.25, 0.45); mon.rotation.y = Math.PI; g.add(mon);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.58, 0.04), screenBack); back.position.set(offset, 1.25, 0.48); g.add(back);
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), metal); stand.position.set(offset, 0.96, 0.5); g.add(stand);
        monitors.push({ draw: (st) => {
          const c = s.g; c.fillStyle = "#070b12"; c.fillRect(0, 0, 512, 300);
          c.fillStyle = desk.person.shirt; c.fillRect(0, 0, 512, 46); c.fillStyle = "#06090f"; c.font = "bold 26px sans-serif"; c.textBaseline = "middle"; c.fillText(desk.role.toUpperCase(), 16, 24);
          c.strokeStyle = "#2a3446"; c.lineWidth = 2; for (let y = 90; y < 280; y += 45) { c.beginPath(); c.moveTo(16, y); c.lineTo(496, y); c.stroke(); }
          c.fillStyle = "#8fa0b8"; c.font = "bold 30px sans-serif"; c.textAlign = "center";
          c.fillText(deskState(st) === "IDLE" ? "SEM DADOS" : "OBSERVANDO", 256, n === 0 ? 150 : 170);
          c.font = "20px sans-serif"; c.fillStyle = "#5c6b82"; c.fillText(st.mode === "SIMULATED" ? "modo simulado · nada é enviado" : "", 256, 220); c.textAlign = "left";
          s.texture.needsUpdate = true;
        } });
      }
      // Chair and the agent sitting at it.
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), chairMat); chair.position.set(0, 0.5, -0.9); g.add(chair);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.1), chairMat); back.position.set(0, 0.95, -1.25); g.add(back);
      const person = new THREE.Group(); person.position.set(0, 0, -0.85);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 10), matte(desk.person.shirt, 0.7)); body.position.y = 1.0; person.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), matte(desk.person.skin, 0.6)); head.position.y = 1.6; person.add(head);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), matte(desk.person.hair, 0.8)); hair.position.y = 1.62; person.add(hair);
      g.add(person); people.push({ group: person, head, phase: k * 1.7 });
      // Label: who and which desk.
      const tag = document.createElement("div"); tag.className = "dash-desk-tag"; tag.style.setProperty("--desk", desk.person.shirt);
      tag.innerHTML = `<b>${desk.person.name}</b><span>${desk.role}</span>`;
      const label = new CSS2DObject(tag); label.position.set(0, 2.3, -0.85); g.add(label);
      add(g);
    });

    // Lounge, plants and a board with the rules.
    const sofa = new Mass(); sofa.box(16, 0, 8, 6, 0.5, 2); sofa.box(16, 0.5, 8.8, 6, 0.6, 0.4); add(new THREE.Mesh(sofa.geometry(), matte("#3d5a80", 0.9)));
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.08, 24), deskMat); table.position.set(16, 0.45, 5.6); add(table);
    for (const [px, pz] of [[-22, -12], [22, -12], [-22, 12], [22, 12], [-8, -12], [8, -12]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.6, 16), white); pot.position.set(px, 0.3, pz); add(pot);
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), matte("#4f9a45", 0.85)); leaves.position.set(px, 1.2, pz); add(leaves);
    }
    const rules = screen(800, 520); {
      const g = rules.g; g.fillStyle = "#fbfbf8"; g.fillRect(0, 0, 800, 520); g.fillStyle = "#1d3557"; g.font = "bold 44px sans-serif"; g.textBaseline = "top"; g.fillText("Regras da mesa", 36, 30);
      g.font = "30px sans-serif"; g.fillStyle = "#2b2e34";
      ["1. Sem dado confiável, não operar", "2. Toda ordem passa pelo risco", "3. Stop confirmado na corretora", "4. Não operar também é resultado", "5. IA não decide ordens"].forEach((t, i) => g.fillText(t, 40, 110 + i * 76));
      rules.texture.needsUpdate = true;
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.08), new THREE.MeshBasicMaterial({ map: rules.texture })); board.position.set(-W / 2 + 0.2, 1.8, -4); board.rotation.y = Math.PI / 2; scene.add(board);

    const sync = (s: DashStatus) => { drawWall(s); monitors.forEach((m) => m.draw(s)); };
    sync(initial.current);
    api.current = { reset, status: sync };

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
        for (const p of people) { p.head.rotation.y = Math.sin(t * 0.4 + p.phase) * 0.35; p.group.position.y = Math.sin(t * 1.3 + p.phase) * 0.01; }
      }
      controls.update(); renderer.render(scene, camera); labels.render(scene, camera);
    };
    const start = () => { if (!running) { running = true; clock.getDelta(); frame = requestAnimationFrame(tick); } };
    const stop = () => { running = false; cancelAnimationFrame(frame); };
    const visibility = new IntersectionObserver(([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop())); visibility.observe(el);
    const onPage = () => (document.hidden ? stop() : start()); document.addEventListener("visibilitychange", onPage);
    start();
    return () => {
      stop(); visibility.disconnect(); observer.disconnect(); document.removeEventListener("visibilitychange", onPage);
      controls.dispose(); pmrem.dispose();
      scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }); } });
      renderer.dispose(); el.replaceChildren(); api.current = null;
    };
  }, []);

  useEffect(() => { api.current?.status(status); }, [status]);

  if (failed) return <div className="dash3d dash3d-failed" role="status">O 3D não está disponível neste aparelho. O painel abaixo mostra o estado da mesa.</div>;
  return (
    <div className="dash3d">
      <div ref={host} className="dash3d-canvas" role="img" aria-label={`Sala do DASH no andar ${FLOOR} da sede ATLAS: ${DESKS.length} mesas (${DESKS.map((d) => `${d.person.name}, ${d.role}`).join("; ")}), telão e a cidade lá fora.`} />
      <button type="button" className="dash3d-reset" onClick={() => api.current?.reset()} aria-label="Centralizar a sala" title="Centralizar"><LocateFixed size={17} /></button>
    </div>
  );
}
