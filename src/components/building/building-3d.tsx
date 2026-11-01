"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { floorLevel, OFFICES, STATUS_LABEL, TOWER, windowBays, type Office } from "@/core/building";
import { DESKS } from "@/core/daytrade/desks";
import { buildCity, glows, Mass, roundedSlab, setNight, SKY } from "./city";
import { crownTop, elevatorTube, floorShell, lobby, towerMaterials } from "./tower";

/**
 * The ATLAS headquarters in its city (owner, 01/11/2026: "a página inicial mostra um prédio
 * comercial grande... três andares interativos no meio"; the whole tower is ATLAS's, modelled in
 * tower.ts). Drag turns the camera around the tower, the wheel zooms; the three office floors are
 * glass, labelled and clickable. Choosing one works like a life-sim's city map (owner: "igual àquela
 * DLC de Vida na Cidade"): the camera moves in towards the floor, with the tower whole, and the
 * office opens on its own page. Plain geometry only.
 */
export interface BuildingApi { reset: () => void }

const DEFAULT_TARGET = floorLevel(9) + 1.7;

export function Building3D({ selected, highlight = null, night = false, intro = true, onSelect, onEnter, onFail, apiRef }: {
  /** The floor being entered (camera flies there, level view). */
  selected: number | null;
  /** A floor to glow, such as the office used last. */
  highlight?: number | null;
  /** Night: dark sky, lit windows, street lamps and headlights. */
  night?: boolean;
  /** Opening shot: the camera comes down through the clouds to the tower. */
  intro?: boolean;
  onSelect: (floor: number | null) => void;
  onEnter: (floor: number) => void;
  onFail: () => void;
  apiRef?: React.RefObject<BuildingApi | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sync = useRef<(selected: number | null) => void>(() => undefined);
  const glow = useRef(highlight);
  const dark = useRef(night);
  const opening = useRef(intro);
  const handlers = useRef({ onSelect, onEnter, onFail });
  useEffect(() => { handlers.current = { onSelect, onEnter, onFail }; }, [onSelect, onEnter, onFail]);
  useEffect(() => { glow.current = highlight; }, [highlight]);
  useEffect(() => { dark.current = night; }, [night]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const mobile = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: mobile ? "low-power" : "high-performance" }); }
    catch { queueMicrotask(() => handlers.current.onFail()); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1 : 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = !mobile;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = "building3d-labels";
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 1400, 5200);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    // Warm, sunny light with soft shadows: the toy-city look of a life simulator (moonlight at night).
    const sky = new THREE.HemisphereLight(0xe3f3ff, 0xa89a7c, 1.25); scene.add(sky);
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.2);
    sun.position.set(-90, 160, 110); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 420 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 7000);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 70; controls.maxDistance = 620;
    controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.42;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    const home = () => {
      controls.target.set(0, DEFAULT_TARGET, 0);
      camera.position.setFromSpherical(new THREE.Spherical(el.clientWidth / Math.max(1, el.clientHeight) < 1 ? 290 : 195, 1.12, 0.62)).add(controls.target);
    };
    home();
    const homePosition = camera.position.clone();

    const city = buildCity({ mobile });
    scene.add(city);

    // Opening shot: from above the clouds down to the tower (skipped with reduced motion).
    const clouds = new THREE.Group();
    let introAt = opening.current && !reduced ? 0 : -1;
    const INTRO = 3.6, introFrom = new THREE.Vector3().setFromSpherical(new THREE.Spherical(560, 0.2, 0.62)).add(controls.target);
    if (introAt === 0) {
      const puff = document.createElement("canvas"); puff.width = puff.height = 128;
      const pg = puff.getContext("2d")!, grad = pg.createRadialGradient(64, 64, 4, 64, 64, 62);
      grad.addColorStop(0, "rgba(255,255,255,0.95)"); grad.addColorStop(0.5, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
      pg.fillStyle = grad; pg.fillRect(0, 0, 128, 128);
      const puffTexture = new THREE.CanvasTexture(puff), cloudRandom = Math.random;
      for (let k = 0; k < (mobile ? 40 : 80); k++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture, transparent: true, depthWrite: false, fog: false, opacity: 0.9 }));
        const a = cloudRandom() * Math.PI * 2, r = cloudRandom() * 320;
        s.position.set(Math.cos(a) * r, 230 + cloudRandom() * 120, Math.sin(a) * r); s.scale.setScalar(90 + cloudRandom() * 120);
        clouds.add(s);
      }
      scene.add(clouds);
      camera.position.copy(introFrom); controls.enabled = false;
    }

    // ----- The tower: the ATLAS headquarters from tower.ts, the same one the office scene stands in -----
    const m = towerMaterials();
    const matte = (color: THREE.ColorRepresentation, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
    const shadowed = <T extends THREE.Object3D>(o: T) => {
      o.traverse((c) => { if (c instanceof THREE.Mesh && ![c.material].flat().some((x: THREE.Material) => x.transparent)) { c.castShadow = true; c.receiveShadow = true; } });
      return o;
    };
    const W = TOWER.width, D = TOWER.depth, H = TOWER.storey;
    scene.add(shadowed(lobby(m)));
    const lift = elevatorTube(m); scene.add(lift.group);

    interface Floor { number: number; group: THREE.Group; cut: number; walls?: THREE.Mesh[]; office: Office | null; band?: THREE.MeshStandardMaterial; glass?: THREE.MeshPhysicalMaterial; tag?: CSS2DObject; hit?: THREE.Mesh; leader?: THREE.Line; ceiling?: THREE.Mesh }
    const middle = OFFICES[Math.floor(OFFICES.length / 2)].floor;
    const floors: Floor[] = [];
    const bays = { width: windowBays(W), depth: windowBays(D) };

    // Office floors from outside (owner, 01/11/2026: "a forma que o escritório é vista do lado de fora
    // tá feia"): the tower's rounded outline and white bands, clear glass from sill to head (where the
    // office's own windows are) and, behind it, the office laid out as it is inside, lit at night.
    const OFFICE_R = 4;
    /** Only the sides of an extruded rounded slab (its caps would cover the floor). */
    const sides = (material: THREE.Material) => [new THREE.MeshBasicMaterial({ visible: false }), material];
    /** Mullions round the glass at the bay edges, as in the office's own windows, and on the rounded corners. */
    const mullions = (mass: Mass, y: number, h: number) => {
      const sx = W / 2 - OFFICE_R, sz = D / 2 - OFFICE_R;
      for (const b of bays.width) for (const x of [b.from, b.to]) if (Math.abs(x) <= sx + 0.01) for (const z of [D / 2, -D / 2]) mass.box(x, y, z, 0.1, h, 0.1, false);
      for (const b of bays.depth) for (const z of [b.from, b.to]) if (Math.abs(z) <= sz + 0.01) for (const x of [W / 2, -W / 2]) mass.box(x, y, z, 0.1, h, 0.1, false);
      for (const [cx, cz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) for (const a of [Math.PI / 6, Math.PI / 3]) {
        mass.box(cx * (sx + OFFICE_R * Math.cos(a)), y, cz * (sz + OFFICE_R * Math.sin(a)), 0.1, h, 0.1, false);
      }
    };
    /** Opaque glass below the sill and above the head, in the tint of the tower's glass. */
    const spandrel = new THREE.MeshPhysicalMaterial({ color: 0x9fcbe6, roughness: 0.12, metalness: 0.35, clearcoat: 0.6 });
    const SKINS = ["#f1c9a5", "#d9a47c", "#a86b47", "#7a4a2e", "#e8b896"];
    /** People as simple figures (shirt and head; legs when standing): x, z, shirt, seated, skin. */
    const crowd = (g: THREE.Group, list: [number, number, string, boolean, string?][]) => {
      const standing = list.filter((p) => !p[3]).length, tone = new THREE.Color(), dummy = new THREE.Object3D();
      const torso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.27, 0.5, 3, 10), matte("#ffffff", 0.75), list.length);
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.21, 14, 10), matte("#ffffff", 0.6), list.length);
      const legs = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.55, 3, 8), matte("#2b3140", 0.85), Math.max(1, standing));
      let n = 0;
      list.forEach(([x, z, shirt, seated, skin], k) => {
        const lift = seated ? 0 : 0.3;
        dummy.position.set(x, 0.95 + lift, z); dummy.updateMatrix(); torso.setMatrixAt(k, dummy.matrix); torso.setColorAt(k, tone.set(shirt));
        dummy.position.set(x, 1.52 + lift, z); dummy.updateMatrix(); heads.setMatrixAt(k, dummy.matrix); heads.setColorAt(k, tone.set(skin ?? SKINS[k % SKINS.length]));
        if (!seated) { dummy.position.set(x, 0.45, z); dummy.updateMatrix(); legs.setMatrixAt(n++, dummy.matrix); }
      });
      legs.count = standing;
      g.add(torso, heads, legs);
    };

    /** The office behind the glass, in the plan and colours of its own scene (office-3d / dash-3d). */
    const interior = (office: Office, g: THREE.Group) => {
      const dash = office.id === "dash", locked = office.status === "LOCKED";
      g.add(new THREE.Mesh(roundedSlab(W - 0.3, D - 0.3, OFFICE_R - 0.15, 0.05), matte(dash ? "#2f3540" : locked ? "#c9d3de" : "#a07f5f", 0.7)));
      if (locked) return;
      // Light panels on the ceiling, as in the office; brighter at night.
      const panels = new Mass();
      for (let x = -20; x <= 20; x += 6) for (let z = -10; z <= 10; z += 5) panels.box(x, H - 0.55, z, 1.8, 0.04, 0.6);
      g.add(new THREE.Mesh(panels.geometry(), glows(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, roughness: 0.5 }), 0.7, 2.4)));
      g.add(new THREE.Mesh(roundedSlab(W - 0.3, D - 0.3, OFFICE_R - 0.15, 0.02, H - 0.5),
        glows(new THREE.MeshStandardMaterial({ color: 0xf4f1ea, emissive: 0xffe2b5, roughness: 0.9 }), 0.04, 0.5)));
      const light = new Mass(), wood = new Mass(), dark = new Mass(), sofas = new Mass(), screens = new Mass(), pots: [number, number][] = [];
      const people: [number, number, string, boolean, string?][] = [];
      const SHIRTS = ["#e8543a", "#2f6fd6", "#f2a541", "#22a06b", "#7c4dcc", "#1fa3b8", "#e85d75", "#3d7be0"];
      const rug = (w: number, d: number, x: number, z: number, c: string) => { const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), matte(c, 1)); r.position.set(x, 0.06, z); g.add(r); };
      /** Office chair facing +z (facing 1) or -z (facing -1). */
      const chair = (x: number, z: number, facing: number) => { dark.box(x, 0.42, z, 0.6, 0.1, 0.6); dark.box(x, 0.52, z - facing * 0.3, 0.6, 0.62, 0.08); };
      const screenGlow = glows(new THREE.MeshStandardMaterial({ color: 0x0d1418, emissive: new THREE.Color(dash ? "#f0b45a" : "#8fe3ff"), roughness: 0.3 }), 0.5, 1.3);
      if (!dash) {
        // The dividends office: rugs, the back rooms behind glass with their coloured walls, the four
        // desk islands, the snack bar, the TV lounge, the market corner and the reception.
        rug(29, 8.4, -7.75, 0.4, "#2f3b52"); rug(16, 5.8, -2, 10.4, "#6b3a48"); rug(16.4, 7.6, 15.8, 10.1, "#c98b5e"); rug(12, 8, 16.5, 0.4, "#24504c");
        const slate = new Mass(); slate.box(0, 0, -13.3, 43, 3.1, 0.18);
        g.add(new THREE.Mesh(slate.geometry(), matte("#2e4057", 0.85)));
        [-17.33, -10.67, -4, 2.67, 10.67].forEach((x, i) => {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3, 7.3), matte(["#f07b2b", "#2f6fd6", "#f2b33d", "#1fa3b8"][i % 4], 0.8));
          wall.position.set(x, 1.5, -9.65); g.add(wall);
        });
        const front = new THREE.Mesh(new THREE.BoxGeometry(43, 2.6, 0.05), new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false }));
        front.position.set(0, 1.3, -6); g.add(front);
        dark.box(0, 2.6, -6, 43, 0.06, 0.08);
        // Council rooms: oval table, specialists.
        [-20.67, -14, -7.33, -0.67].forEach((x, i) => {
          wood.box(x, 0.72, -10, 3.6, 0.07, 1.8);
          for (const dx of [-1, 1]) { chair(x + dx * 0.8, -11.4, 1); chair(x + dx * 0.8, -8.6, -1); }
          people.push([x - 0.8, -11.4, ["#22a06b", "#2f6fd6", "#f28c28", "#9b6bff"][i], true], [x + 0.8, -8.6, ["#9b6bff", "#f28c28", "#22a06b", "#2f6fd6"][i], true]);
        });
        // The boss's office and the team meeting room.
        light.box(6.67, 0.72, -11.4, 2.6, 0.08, 1.1); chair(6.67, -12.5, 1); people.push([6.67, -12.5, "#2b2f3a", true]);
        screens.box(6.67, 1.1, -13.1, 3, 1.4, 0.05);
        wood.box(17.3, 0.72, -10, 10.6, 0.08, 2.2);
        for (const x of [12.75, 15.45, 18.15, 20.85]) { chair(x, -11.6, 1); chair(x, -8.4, -1); }
        // Desk islands: four desks two by two, screens back to back, a low divider; the agents at them.
        let n = 0;
        for (const [cx, cz] of [[-19, 0.4], [-11.5, 0.4], [-4, 0.4], [3.5, 0.4]]) {
          dark.box(cx, 0.72, cz, 3.3, 0.38, 0.05);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const x = cx + sx * 0.82, z = cz + sz * 0.45;
            light.box(x, 0.72, z, 1.55, 0.06, 0.8); dark.box(x - 0.7, 0, z, 0.06, 0.72, 0.7); dark.box(x + 0.7, 0, z, 0.06, 0.72, 0.7);
            screens.box(x, 0.85, cz + sz * 0.12, 0.62, 0.38, 0.04);
            chair(x, cz + sz * 1.35, -sz);
            if (n++ % 4 !== 3) people.push([x, cz + sz * 1.35, SHIRTS[n % SHIRTS.length], true]);
          }
        }
        // Market corner: the chart screen on the meeting room's glass, sofas facing it.
        screens.box(16.5, 0.9, -5.85, 5, 1.8, 0.08);
        sofas.box(16.5, 0, 2.6, 5.2, 0.45, 0.9); sofas.box(16.5, 0.45, 3.0, 5.2, 0.5, 0.22);
        people.push([15.3, 2.5, "#1fa3b8", true], [17.6, 2.5, "#e85d75", true]);
        // Snack bar on the right: counter, two high tables, two having a coffee.
        light.box(22.1, 0, 8.6, 1, 1.05, 6); wood.box(22.1, 1.05, 8.6, 1.15, 0.06, 6.1);
        for (const z of [7.6, 11.4]) { wood.box(16.4, 1.05, z, 1.1, 0.05, 1.1); dark.box(16.4, 0, z, 0.1, 1.05, 0.1); }
        people.push([15.6, 7.6, "#f2a541", false], [17.2, 7.6, "#7c4dcc", false]);
        // Pool table and the TV lounge.
        const felt = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 1.4), matte("#2f8f5a", 0.9)); felt.position.set(11.6, 0.82, 11); g.add(felt);
        wood.box(11.6, 0, 11, 2.4, 0.73, 1.2);
        dark.box(-2, 0.35, 7.9, 3.4, 1.8, 0.12); screens.box(-2, 0.5, 8.0, 3.1, 1.5, 0.04);
        sofas.box(-2, 0, 11.6, 7, 0.45, 1); sofas.box(-2, 0.45, 12.05, 7, 0.55, 0.25);
        people.push([-3.5, 11.4, "#22a06b", true], [-0.5, 11.4, "#3d7be0", true]);
        // Reception by the elevator: desk with the receptionist, and the logo wall in ATLAS green.
        light.box(-19.5, 0, 9.4, 3.6, 1.05, 0.8); wood.box(-19.5, 1.05, 9.4, 3.8, 0.06, 0.95);
        people.push([-19.5, 8.6, "#ffffff", true]);
        const logoWall = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 0.15), matte("#5fbf8f", 0.6)); logoWall.position.set(-19.5, 1.3, 6.6); g.add(logoWall);
        pots.push([-22.3, -4.5], [22.3, -4.5], [9.4, 4.6], [-22.4, 4.4], [6.6, 12.6], [-10.6, 12.6], [21.8, 12.2]);
      } else {
        // DASH: the trading floor of dash-3d — dark floor, warm rug, the horseshoe of desks facing the
        // wall screen (supervisor behind), the lounge and the plants.
        const rugMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), matte("#6b4f2f", 0.95));
        rugMesh.scale.set(17, 1, 12); rugMesh.position.set(0, 0.06, 1); g.add(rugMesh);
        screens.box(0, 0.6, -D / 2 + 1.2, 14, 2.4, 0.1); dark.box(0, 0.5, -D / 2 + 1.05, 14.6, 2.6, 0.1);
        const at = new THREE.Vector3(), aim = new THREE.Vector3();
        DESKS.forEach((desk, k) => {
          const supervisor = desk.id === "supervisor", angle = Math.PI * (0.12 + (k / 4) * 0.76);
          at.set(supervisor ? 0 : Math.cos(angle) * 14, 0, supervisor ? 9 : 4.5 - Math.sin(angle) * 9);
          aim.set(0, 0, supervisor ? -20 : -6).sub(at).normalize();
          const desk3d = new THREE.Group(); desk3d.position.copy(at); desk3d.lookAt(0, 0, supervisor ? -20 : -6);
          const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.4), matte("#e9e4dc", 0.6)); top.position.y = 0.76; desk3d.add(top);
          for (let m2 = 0; m2 < (supervisor ? 3 : 2); m2++) {
            const mon = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.54, 0.05), screenGlow); mon.position.set((m2 - (supervisor ? 1 : 0.5)) * 0.98, 1.25, 0.45); desk3d.add(mon);
          }
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), matte("#22262d", 0.6)); seat.position.set(0, 0.5, -0.9); desk3d.add(seat);
          g.add(desk3d);
          people.push([at.x - aim.x * 0.85, at.z - aim.z * 0.85, desk.person.shirt, true, desk.person.skin]);
        });
        sofas.box(16, 0, 8, 6, 0.5, 2); sofas.box(16, 0.5, 8.8, 6, 0.6, 0.4);
        pots.push([-21.5, -11.5], [21.5, -11.5], [-21.5, 11.5], [21.5, 11.5], [-8, -12], [8, -12]);
      }
      g.add(new THREE.Mesh(light.geometry(), matte(dash ? "#e9e4dc" : "#eceae6", 0.6)), new THREE.Mesh(wood.geometry(), matte("#b98a5a", 0.6)));
      g.add(new THREE.Mesh(dark.geometry(), matte("#2b2e34", 0.5)), new THREE.Mesh(sofas.geometry(), matte(dash ? "#3d5a80" : "#46566e", 0.9)));
      g.add(new THREE.Mesh(screens.geometry(), screenGlow));
      if (pots.length) {
        const pot = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.3, 0.6, 14), matte("#f4f6f8", 0.5), pots.length);
        const leaf = new THREE.InstancedMesh(new THREE.SphereGeometry(0.8, 12, 9), matte("#4f9a45", 0.85), pots.length), dummy = new THREE.Object3D();
        pots.forEach(([x, z], k) => { dummy.position.set(x, 0.3, z); dummy.updateMatrix(); pot.setMatrixAt(k, dummy.matrix); dummy.position.y = 1.2; dummy.updateMatrix(); leaf.setMatrixAt(k, dummy.matrix); });
        g.add(pot, leaf);
      }
      crowd(g, people);
    };

    for (let number = 1; number <= TOWER.floors; number++) {
      const group = new THREE.Group(), office = OFFICES.find((o) => o.floor === number) ?? null;
      group.position.y = floorLevel(number);
      const floor: Floor = { number, group, cut: 0, office };
      if (!office) group.add(floorShell(number, m));
      else {
        // Office floor: the same rounded white slab as the other floors; tinted glass up to the sill and
        // above the head, where the office has wall inside; clear glass between them, where its windows
        // are (frosted on the locked floor), with mullions; and the office inside.
        const locked = office.status === "LOCKED", sill = 0.45 + TOWER.sill, head = 0.45 + TOWER.head;
        const slab = new THREE.Mesh(roundedSlab(W + 0.8, D + 0.8, OFFICE_R + 0.4, 0.45), m.slab); group.add(slab);
        group.add(new THREE.Mesh(roundedSlab(W, D, OFFICE_R, sill - 0.45, 0.45), sides(spandrel)));
        group.add(new THREE.Mesh(roundedSlab(W, D, OFFICE_R, H - head, head), sides(spandrel)));
        const glass = new THREE.MeshPhysicalMaterial({ color: locked ? 0xe4f3ec : 0xeaf6ff, transparent: true, opacity: locked ? 0.86 : 0.12,
          roughness: locked ? 0.55 : 0.04, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
        const pane = new THREE.Mesh(roundedSlab(W, D, OFFICE_R, head - sill, sill), sides(glass)); pane.renderOrder = 2;
        const frame = new Mass(); mullions(frame, sill, head - sill);
        floor.walls = [pane, new THREE.Mesh(frame.geometry(), m.white)];
        group.add(...floor.walls);
        const inner = new THREE.Group(); inner.position.y = 0.45; group.add(inner);
        interior(office, inner);
        // Coloured line along the slab edge: the office's colour, brighter when hovered or chosen.
        const band = new THREE.MeshStandardMaterial({ color: office.color, emissive: new THREE.Color(office.color), emissiveIntensity: 0.25, roughness: 0.5 });
        group.add(new THREE.Mesh(roundedSlab(W + 0.96, D + 0.96, OFFICE_R + 0.48, 0.14, 0.16), band));
        const hit = new THREE.Mesh(new THREE.BoxGeometry(W + 1, H, D + 1), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = H / 2; hit.userData.floor = number; group.add(hit);
        // Readable plate (HTML), kept beside the tower on the side the camera looks from.
        const tag = document.createElement("button");
        tag.type = "button"; tag.className = `floor-tag status-${office.status.toLowerCase()}`;
        tag.style.setProperty("--office", office.color);
        tag.innerHTML = `<b>${number}</b><span>${office.name}</span><small>${STATUS_LABEL[office.status]}</small>`;
        tag.setAttribute("aria-label", `Andar ${number}: ${office.name}, ${STATUS_LABEL[office.status]}`);
        tag.addEventListener("pointerdown", (e) => e.stopPropagation());
        tag.addEventListener("click", () => handlers.current.onSelect(number));
        const label = new CSS2DObject(tag); label.center.set(1, 0.5); scene.add(label);
        // Plates are spread apart vertically (floors are only 3.8 m apart); a line ties each to its floor.
        const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: office.color }));
        leader.frustumCulled = false; scene.add(leader);
        Object.assign(floor, { band, glass, tag: label, hit, leader });
      }
      scene.add(shadowed(group));
      floors.push(floor);
    }
    // Crown roof: the logo on all four sides, a rooftop garden and the spire.
    const roof = crownTop(m); roof.position.y = floorLevel(TOWER.floors + 1);
    scene.add(shadowed(roof));
    void matte;

    // ----- Interaction -----
    let current: number | null = null, hovered: number | null = null;
    const pickables = floors.flatMap((f) => (f.hit ? [f.hit] : []));
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      return hit ? (hit.object.userData.floor as number) : null;
    };
    let downAt: { x: number; y: number; t: number } | null = null;
    const onMove = (e: PointerEvent) => { if (e.pointerType === "mouse" && !downAt) { hovered = pick(e); labels.domElement.style.cursor = hovered ? "pointer" : ""; } };
    const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    let lastClick = { floor: 0, at: 0 };
    const onUp = (e: PointerEvent) => {
      const start = downAt; downAt = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;
      const floor = pick(e);
      const now = performance.now();
      if (floor && lastClick.floor === floor && now - lastClick.at < 400) handlers.current.onEnter(floor);
      lastClick = { floor: floor ?? 0, at: now };
      handlers.current.onSelect(floor);
    };
    labels.domElement.addEventListener("pointermove", onMove);
    labels.domElement.addEventListener("pointerdown", onDown);
    labels.domElement.addEventListener("pointerup", onUp);

    // Entering an office: the camera moves in towards its floor (the tower stays whole), then the
    // office opens on its own page.
    const goal = { target: new THREE.Vector3(0, DEFAULT_TARGET, 0), distance: 0, active: false }, orbit = new THREE.Spherical();
    sync.current = (floor) => {
      current = floor;
      for (const f of floors) f.tag?.element.classList.toggle("selected", f.number === floor);
      goal.target.set(0, floor ? floorLevel(floor) + 1.7 : DEFAULT_TARGET, 0);
      // Zoom right up to the chosen floor (the office page then continues inside); the controls let go meanwhile.
      if (floor) { controls.minDistance = 20; controls.maxPolarAngle = 1.45; controls.enabled = false; }
      goal.distance = floor ? 38 : camera.position.distanceTo(controls.target);
      goal.active = true;
    };
    if (apiRef) apiRef.current = { reset: () => { goal.active = false; home(); } };
    const DAY_SKY = new THREE.Color(SKY), NIGHT_SKY = new THREE.Color(0x141c33), SUN_DAY = new THREE.Color(0xfff0d2), SUN_NIGHT = new THREE.Color(0x9fb4ff);
    let nightAmount = dark.current ? 1 : 0;
    const applyNight = () => {
      (scene.background as THREE.Color).lerpColors(DAY_SKY, NIGHT_SKY, nightAmount);
      scene.fog!.color.copy(scene.background as THREE.Color);
      sky.intensity = 1.25 - 0.95 * nightAmount; sun.intensity = 2.2 - 1.85 * nightAmount;
      sun.color.lerpColors(SUN_DAY, SUN_NIGHT, nightAmount);
      renderer.toneMappingExposure = 1.08 - 0.12 * nightAmount;
      // The reflected environment lights everything too: dim it at night.
      scene.environmentIntensity = 1 - 0.85 * nightAmount;
      setNight(scene, nightAmount);
    };
    applyNight();

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();

    const toCamera = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const clock = new THREE.Clock();
    let frame = 0, running = false;
    const tick = () => {
      if (!running) return;
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      if (introAt >= 0) {
        // Down through the clouds; they thin out as the camera passes them.
        introAt += dt;
        const k = Math.min(1, introAt / INTRO), smooth = k * k * (3 - 2 * k);
        camera.position.lerpVectors(introFrom, homePosition, smooth);
        camera.lookAt(controls.target);
        for (const c of clouds.children) ((c as THREE.Sprite).material.opacity = 0.9 * Math.max(0, 1 - Math.max(0, k - 0.35) / 0.4));
        if (k >= 1) {
          introAt = -1; controls.enabled = true; scene.remove(clouds);
          clouds.traverse((c) => { if (c instanceof THREE.Sprite) { c.material.map?.dispose(); c.material.dispose(); } });
        }
      }
      // Day and night: sky, fog, light and every glow (windows, lamps, headlights, lobby) follow.
      const target = dark.current ? 1 : 0;
      if (nightAmount !== target) {
        nightAmount += (target - nightAmount) * (reduced ? 1 : Math.min(1, dt * 2.5));
        if (Math.abs(nightAmount - target) < 0.002) nightAmount = target;
        applyNight();
      }
      if (!reduced) city.userData.update?.(dt);
      if (goal.active) {
        // Entering an office: a slower, deeper move that ends level with its floor, close to the glass.
        const step = reduced ? 1 : Math.min(1, dt * (current !== null ? 2.2 : 4));
        controls.target.lerp(goal.target, step);
        orbit.setFromVector3(camera.position.clone().sub(controls.target));
        orbit.radius += (goal.distance - orbit.radius) * step;
        if (current !== null) orbit.phi += (1.38 - orbit.phi) * step;
        camera.position.setFromSpherical(orbit).add(controls.target);
        if (controls.target.distanceTo(goal.target) < 0.05 && Math.abs(goal.distance - orbit.radius) < 0.1) goal.active = false;
      }
      controls.update();
      // Plates beside the tower, to the left of it from wherever the camera looks (the elevator panel is on the right).
      toCamera.subVectors(camera.position, controls.target).setY(0).normalize();
      side.crossVectors(up, toCamera).normalize();
      // About 52 px between plates whatever the zoom.
      const spacing = (52 * 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, el.clientHeight);
      // Plates on the left of the tower, unless they would run off the left edge: then on the right.
      const probe = new THREE.Vector3(-side.x * 36, floorLevel(middle), -side.z * 36).project(camera);
      const flip = ((probe.x + 1) / 2) * el.clientWidth < 230 ? -1 : 1;
      side.multiplyScalar(flip);
      for (const f of floors) {
        if (f.tag) {
          f.tag.center.set(flip > 0 ? 1 : 0, 0.5);
          const y = floorLevel(f.number) + 1.9;
          f.tag.position.set(-side.x * 36 + toCamera.x * 6, floorLevel(middle) + 1.9 + (f.number - middle) * spacing, -side.z * 36 + toCamera.z * 6);
          const ends = f.leader!.geometry.attributes.position as THREE.BufferAttribute;
          ends.setXYZ(0, -side.x * 24.5 + toCamera.x * 14.5, y, -side.z * 24.5 + toCamera.z * 14.5);
          ends.setXYZ(1, f.tag.position.x, f.tag.position.y, f.tag.position.z); ends.needsUpdate = true;
          const on = f.number === current, over = f.number === hovered || f.number === glow.current;
          f.band!.emissiveIntensity = on ? 1.4 : over ? 0.9 : 0.25;
          f.tag.element.classList.toggle("hovered", over);
        }
      }
      // The panoramic elevator's cab travels up and down the tower.
      if (!reduced) lift.cab.position.y = lift.from + 1.5 + (lift.to - lift.from - 3) * (0.5 - 0.5 * Math.cos(clock.elapsedTime * 0.12));
      renderer.render(scene, camera); labels.render(scene, camera);
    };
    const start = () => { if (!running) { running = true; clock.getDelta(); frame = requestAnimationFrame(tick); } };
    const stop = () => { running = false; cancelAnimationFrame(frame); };
    const visibility = new IntersectionObserver(([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()));
    visibility.observe(el);
    const onPage = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onPage);
    start();

    return () => {
      stop(); visibility.disconnect(); observer.disconnect();
      document.removeEventListener("visibilitychange", onPage);
      labels.domElement.removeEventListener("pointermove", onMove);
      labels.domElement.removeEventListener("pointerdown", onDown);
      labels.domElement.removeEventListener("pointerup", onUp);
      controls.dispose(); pmrem.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); });
        }
      });
      renderer.dispose(); el.replaceChildren();
      sync.current = () => undefined;
      if (apiRef) apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => { sync.current(selected); }, [selected]);

  return <div ref={host} className="building3d-canvas" role="img"
    aria-label={`Prédio ATLAS com ${TOWER.floors} andares numa cidade. Andares interativos: ${OFFICES.map((o) => `${o.floor}, ${o.name} (${STATUS_LABEL[o.status]})`).join("; ")}.`} />;
}
