"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { floorLevel, OFFICES, STATUS_LABEL, TOWER, windowBays, type Office } from "@/core/building";
import { buildCity, Mass, setNight, SKY } from "./city";
import { crownTop, elevatorTube, floorShell, lobby, officeTerrace, towerMaterials } from "./tower";

/**
 * The ATLAS headquarters in its city (owner, 01/11/2026: "a página inicial mostra um prédio
 * comercial grande... três andares interativos no meio"; the whole tower is ATLAS's, modelled in
 * tower.ts). Drag turns the camera around the tower, the wheel zooms; the three office floors are
 * glass, labelled and clickable. Choosing one works like a life-sim's city map (owner: "igual àquela
 * DLC de Vida na Cidade"): the camera flies to the floor, the floors above disappear and its walls
 * drop, then the office opens on its own page. Plain geometry only.
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
    scene.fog = new THREE.Fog(SKY, 420, 1200);
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

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 2400);
    const controls = new OrbitControls(camera, labels.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 70; controls.maxDistance = 330;
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
    const shadowed = <T extends THREE.Object3D>(o: T) => { o.traverse((c) => { if (c instanceof THREE.Mesh && !(c.material as THREE.Material).transparent) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
    const W = TOWER.width, D = TOWER.depth, H = TOWER.storey;
    scene.add(shadowed(lobby(m)));
    const lift = elevatorTube(m); scene.add(lift.group);

    interface Floor { number: number; group: THREE.Group; cut: number; walls?: THREE.Mesh[]; office: Office | null; band?: THREE.MeshStandardMaterial; glass?: THREE.MeshPhysicalMaterial; tag?: CSS2DObject; hit?: THREE.Mesh; leader?: THREE.Line; ceiling?: THREE.Mesh }
    const middle = OFFICES[Math.floor(OFFICES.length / 2)].floor;
    const floors: Floor[] = [];
    const bays = { width: windowBays(W), depth: windowBays(D) };

    /** Mullions at the bay edges, as in the office's own windows. */
    const mullions = (mass: Mass) => {
      for (const b of bays.width) for (const z of [D / 2, -D / 2]) mass.box(b.from, 0, z, 0.12, TOWER.ceiling, 0.12, false);
      for (const b of bays.depth) for (const x of [W / 2, -W / 2]) mass.box(x, 0, b.from, 0.12, TOWER.ceiling, 0.12, false);
      mass.box(W / 2, 0, D / 2, 0.12, TOWER.ceiling, 0.12, false);
      mass.box(0, TOWER.sill, D / 2, W, 0.06, 0.1, false); mass.box(0, TOWER.sill, -D / 2, W, 0.06, 0.1, false);
      mass.box(W / 2, TOWER.sill, 0, 0.1, 0.06, D, false); mass.box(-W / 2, TOWER.sill, 0, 0.1, 0.06, D, false);
    };

    /** A small interior that reads from outside: floor, desks with lit screens, people, back rooms. */
    const interior = (office: Office, g: THREE.Group) => {
      const floorColor = office.id === "dividendos" ? "#a07f5f" : office.id === "dash" ? "#2b3138" : "#c9d3de";
      const plate = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.06, D - 0.4), matte(floorColor, 0.7)); plate.position.y = 0.03; g.add(plate);
      if (office.status === "LOCKED") return;
      const desks = new Mass(), screens = new Mass(), rooms = new Mass(), people: [number, number][] = [];
      if (office.id === "dividendos") {
        // Same plan as the office: council, boss and meeting rooms at the back, desks in front.
        for (const x of [-17.33, -10.67, -4, 2.67, 10.67]) rooms.box(x, 0, -10, 0.18, 3, 8, false);
        rooms.box(0, 0, -14 + 0.1, W - 0.4, 3, 0.18, false);
        for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
          const x = -20 + col * 6.5, z = -1.5 + row * 4.2;
          desks.box(x, 0.72, z, 2.8, 0.06, 1.2); screens.box(x, 0.8, z - 0.4, 0.9, 0.55, 0.05);
          people.push([x, z + 0.9]);
        }
        desks.box(16, 0, 1, 7, 0.45, 2.4); desks.box(17, 0, 10, 8, 0.9, 3);
      } else {
        // DASH: a trading horseshoe with many screens; still being set up.
        for (let k = 0; k < 9; k++) {
          const a = Math.PI * (0.15 + (k / 8) * 0.7), x = Math.cos(a) * 13, z = 4 - Math.sin(a) * 8;
          desks.box(x, 0.72, z, 3, 0.06, 1.3); screens.box(x - 0.6, 0.8, z, 0.8, 0.5, 0.05); screens.box(x + 0.6, 0.8, z, 0.8, 0.5, 0.05);
          if (k % 3 === 0) people.push([x, z + 0.9]);
        }
        screens.box(0, 0.6, -12.5, 16, 2.4, 0.1);
        for (const [x, z] of [[-18, 9], [-15.5, 10.5], [18, -9]]) rooms.box(x, 0, z, 1.6, 1.2, 1.6);
      }
      g.add(new THREE.Mesh(desks.geometry(), matte(office.id === "dash" ? "#3a3f46" : "#eceae6", 0.6)));
      g.add(new THREE.Mesh(screens.geometry(), new THREE.MeshStandardMaterial({ color: 0x0d1418, emissive: new THREE.Color(office.id === "dash" ? "#e3a64a" : "#3dffa8"), emissiveIntensity: 0.55 })));
      g.add(new THREE.Mesh(rooms.geometry(), matte(office.id === "dash" ? "#c9a14a" : "#2e4057", 0.8)));
      const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.3, 0.9, 3, 8), matte("#ffffff", 0.7), people.length);
      const tone = new THREE.Color(), dummy = new THREE.Object3D(), shirts = ["#e8543a", "#2f6fd6", "#f2a541", "#22a06b", "#7c4dcc", "#1fa3b8"];
      people.forEach(([x, z], n) => { dummy.position.set(x, 0.75, z); dummy.updateMatrix(); bodies.setMatrixAt(n, dummy.matrix); bodies.setColorAt(n, tone.set(shirts[n % shirts.length])); });
      g.add(bodies);
    };

    for (let number = 1; number <= TOWER.floors; number++) {
      const group = new THREE.Group(), office = OFFICES.find((o) => o.floor === number) ?? null;
      group.position.y = floorLevel(number);
      const floor: Floor = { number, group, cut: 0, office };
      if (!office) group.add(floorShell(number, m));
      else {
        // Office floor: slab, columns and fins, the terrace with planters, and a glass front showing the office.
        group.add(floorShell(number, m, false));
        const terrace = officeTerrace(m); terrace.position.y = 0.45; group.add(terrace);
        const inner = new THREE.Group(); inner.position.y = 0.42; group.add(inner);
        interior(office, inner);
        const glass = new THREE.MeshPhysicalMaterial({ color: office.status === "LOCKED" ? 0xe4f3ec : 0xd8f1ff, transparent: true,
          opacity: office.status === "LOCKED" ? 0.82 : 0.24, roughness: office.status === "LOCKED" ? 0.6 : 0.05, side: THREE.DoubleSide, depthWrite: false });
        const panes = new Mass(); panes.box(0, 0, 0, W, TOWER.ceiling, D, false);
        const frame = new Mass(); mullions(frame);
        floor.walls = [new THREE.Mesh(panes.geometry(), glass), new THREE.Mesh(frame.geometry(), m.white)];
        inner.add(...floor.walls);
        // Ceiling: removed while the floor is shown, so its interior shows from above.
        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), m.slab); ceiling.position.y = TOWER.ceiling + 0.15; inner.add(ceiling);
        floor.ceiling = ceiling;
        // Coloured band at the slab edge: the office's colour, brighter when hovered or chosen.
        const band = new THREE.MeshStandardMaterial({ color: office.color, emissive: new THREE.Color(office.color), emissiveIntensity: 0.25, roughness: 0.5 });
        const strip = new Mass(), hw = W / 2 + 3.05, hd = D / 2 + 3.05;
        strip.box(0, 0, hd, hw * 2, 0.3, 0.08, false); strip.box(0, 0, -hd, hw * 2, 0.3, 0.08, false);
        strip.box(hw, 0, 0, 0.08, 0.3, hd * 2, false); strip.box(-hw, 0, 0, 0.08, 0.3, hd * 2, false);
        const bandMesh = new THREE.Mesh(strip.geometry(), band); bandMesh.position.y = 0.12; group.add(bandMesh);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(W + 6, H, D + 6), new THREE.MeshBasicMaterial({ visible: false }));
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

    // Camera moves towards the selected floor; the floors above it rise out of the way.
    const goal = { target: new THREE.Vector3(0, DEFAULT_TARGET, 0), distance: 0, active: false };
    sync.current = (floor) => {
      current = floor;
      for (const f of floors) {
        f.tag?.element.classList.toggle("selected", f.number === floor);
        if (f.ceiling) f.ceiling.visible = f.number !== floor;
      }
      goal.target.set(0, floor ? floorLevel(floor) + 1.7 : DEFAULT_TARGET, 0);
      goal.distance = floor ? Math.min(Math.max(camera.position.distanceTo(controls.target), 140), 185) : camera.position.distanceTo(controls.target);
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
      const dt = Math.min(clock.getDelta(), 0.1), ease = reduced ? 1 : Math.min(1, dt * 4);
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
        controls.target.lerp(goal.target, ease);
        const offset = camera.position.clone().sub(controls.target);
        const length = offset.length();
        camera.position.copy(controls.target).add(offset.setLength(length + (goal.distance - length) * ease));
        if (controls.target.distanceTo(goal.target) < 0.05 && Math.abs(goal.distance - length) < 0.1) goal.active = false;
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
        // Level view: the floors above the chosen one are hidden and its walls drop (the cutaway).
        f.group.visible = current === null || f.number <= current;
        const cut = f.number === current ? 1 : 0;
        f.cut += (cut - f.cut) * (reduced ? 1 : Math.min(1, dt * 6));
        f.walls?.forEach((w) => (w.scale.y = 1 - f.cut * 0.72));
        if (f.tag) {
          f.tag.center.set(flip > 0 ? 1 : 0, 0.5);
          const y = floorLevel(f.number) + 1.9;
          f.tag.position.set(-side.x * 36 + toCamera.x * 6, floorLevel(middle) + 1.9 + (f.number - middle) * spacing, -side.z * 36 + toCamera.z * 6);
          const ends = f.leader!.geometry.attributes.position as THREE.BufferAttribute;
          ends.setXYZ(0, -side.x * 27 + toCamera.x * 17, y, -side.z * 27 + toCamera.z * 17);
          ends.setXYZ(1, f.tag.position.x, f.tag.position.y, f.tag.position.z); ends.needsUpdate = true;
          const on = f.number === current, over = f.number === hovered || f.number === glow.current;
          f.band!.emissiveIntensity = on ? 1.4 : over ? 0.9 : 0.25;
          if (f.office?.status !== "LOCKED") f.glass!.opacity = on ? 0.1 : 0.24;
          f.tag.element.classList.toggle("hovered", over);
        }
      }
      roof.visible = current === null;
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
