"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ELEVATOR, floorLevel, OFFICES, STATUS_LABEL, TOWER, windowBays, type Office } from "@/core/building";
import { buildCity, facadeTexture, Mass, SHAFT, SKY, TOWER_STYLE } from "./city";

/**
 * The ATLAS tower in its city (owner, 01/11/2026: "a página inicial mostra um prédio comercial
 * grande... três andares interativos no meio"). Drag turns the camera around the tower, the wheel
 * zooms; the three office floors are glass, labelled and selectable. Selecting one works like a
 * life-sim level view (owner: "igual àquela DLC de Vida na Cidade, que escolhe o andar"): the floors
 * above it disappear and its walls drop, so its interior shows from above. Plain geometry only.
 */
export interface BuildingApi { reset: () => void }

const DEFAULT_TARGET = floorLevel(9) + 1.7;

export function Building3D({ selected, onSelect, onEnter, onFail, apiRef }: {
  selected: number | null;
  onSelect: (floor: number | null) => void;
  onEnter: (floor: number) => void;
  onFail: () => void;
  apiRef?: React.RefObject<BuildingApi | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const sync = useRef<(selected: number | null) => void>(() => undefined);
  const handlers = useRef({ onSelect, onEnter, onFail });
  useEffect(() => { handlers.current = { onSelect, onEnter, onFail }; }, [onSelect, onEnter, onFail]);

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
    // Warm, sunny light with soft shadows: the toy-city look of a life simulator.
    scene.add(new THREE.HemisphereLight(0xe3f3ff, 0xa89a7c, 1.25));
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

    scene.add(buildCity({ mobile }));

    // ----- The tower -----
    const matte = (color: THREE.ColorRepresentation, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
    const concrete = matte("#d6d1c7"), dark = matte("#2b2e34", 0.4), metal = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.35, metalness: 0.6 });
    const facade = new THREE.MeshStandardMaterial({ map: facadeTexture(TOWER_STYLE, 3), roughness: 0.3, metalness: 0.2 });
    const shadowed = <T extends THREE.Object3D>(o: T) => { o.traverse((c) => { if (c instanceof THREE.Mesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
    const W = TOWER.width, D = TOWER.depth, H = TOWER.storey;

    // Lobby with the ATLAS sign over the entrance.
    const lobby = new THREE.Group();
    const lobbyGlass = new THREE.Mesh(new THREE.BoxGeometry(W, TOWER.lobby, D), new THREE.MeshStandardMaterial({ color: 0x31475a, roughness: 0.15, metalness: 0.5 }));
    lobbyGlass.position.y = TOWER.lobby / 2; lobby.add(lobbyGlass);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 6), dark); canopy.position.set(0, 4.4, D / 2 + 3); lobby.add(canopy);
    const sign = (text: string, w: number, h: number) => {
      const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = Math.round(1024 * h / w);
      const g = canvas.getContext("2d")!;
      g.fillStyle = "#14181c"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = "#f4efe4"; g.font = `700 ${Math.round(canvas.height * 0.62)}px Manrope Variable, sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, canvas.width / 2, canvas.height * 0.54);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    };
    const entrance = sign("ATLAS", 9, 1.6); entrance.position.set(0, 5.5, D / 2 + 6.02); lobby.add(entrance);
    const shaftCladding = SHAFT();
    const lobbyShaft = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.width + 0.4, TOWER.lobby, ELEVATOR.depth), shaftCladding);
    lobbyShaft.position.set(ELEVATOR.x, TOWER.lobby / 2, D / 2 + ELEVATOR.depth / 2); lobby.add(lobbyShaft);
    scene.add(shadowed(lobby));

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
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.42, D + 0.8), concrete); slab.position.y = 0.21; group.add(slab);
      // The elevator shaft on the front of the tower (its doors open into each floor where the office's entrance was).
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.width + 0.4, H, ELEVATOR.depth), shaftCladding);
      shaft.position.set(ELEVATOR.x, H / 2, D / 2 + ELEVATOR.depth / 2); group.add(shaft);
      const floor: Floor = { number, group, cut: 0, office };
      if (!office) {
        // Each floor shows its own row of the façade pattern (lit and dark windows vary floor to floor).
        const body = new Mass(-(number - 1) * H);
        body.box(0, 0.42, 0, W, H - 0.42, D, false, number * 0.37);
        group.add(new THREE.Mesh(body.geometry(), facade));
      } else {
        const inner = new THREE.Group(); inner.position.y = 0.42; group.add(inner);
        interior(office, inner);
        const glass = new THREE.MeshPhysicalMaterial({ color: office.status === "LOCKED" ? 0xe4edf5 : 0xcfe6f2, transparent: true,
          opacity: office.status === "LOCKED" ? 0.82 : 0.24, roughness: office.status === "LOCKED" ? 0.6 : 0.05, side: THREE.DoubleSide, depthWrite: false });
        const panes = new Mass(); panes.box(0, 0, 0, W, TOWER.ceiling, D, false);
        const frame = new Mass(); mullions(frame);
        floor.walls = [new THREE.Mesh(panes.geometry(), glass), new THREE.Mesh(frame.geometry(), metal)];
        inner.add(...floor.walls);
        // Ceiling: removed while the floor is selected, so its interior shows from above.
        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), concrete); ceiling.position.y = TOWER.ceiling + 0.15; inner.add(ceiling);
        floor.ceiling = ceiling;
        // Coloured band at the slab edge: the office's colour, brighter when hovered or selected.
        const band = new THREE.MeshStandardMaterial({ color: office.color, emissive: new THREE.Color(office.color), emissiveIntensity: 0.25, roughness: 0.5 });
        const strip = new Mass();
        strip.box(0, 0, D / 2 + 0.42, W + 0.9, 0.3, 0.06, false); strip.box(0, 0, -D / 2 - 0.42, W + 0.9, 0.3, 0.06, false);
        strip.box(W / 2 + 0.42, 0, 0, 0.06, 0.3, D + 0.9, false); strip.box(-W / 2 - 0.42, 0, 0, 0.06, 0.3, D + 0.9, false);
        const bandMesh = new THREE.Mesh(strip.geometry(), band); bandMesh.position.y = 0.06; group.add(bandMesh);
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
        tag.addEventListener("dblclick", () => handlers.current.onEnter(number));
        const label = new CSS2DObject(tag); label.center.set(1, 0.5); scene.add(label);
        // Plates are spread apart vertically (floors are only 3.8 m apart); a line ties each to its floor.
        const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: office.color }));
        leader.frustumCulled = false; scene.add(leader);
        Object.assign(floor, { band, glass, tag: label, hit, leader });
      }
      scene.add(shadowed(group));
      floors.push(floor);
    }
    // Roof: parapet, machinery, antenna and the ATLAS name.
    const roof = new THREE.Group(); roof.position.y = floorLevel(TOWER.floors + 1);
    const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.5, D + 0.8), concrete); roofSlab.position.y = 0.25; roof.add(roofSlab);
    const parapet = new Mass();
    parapet.box(0, 0.5, D / 2 + 0.3, W + 0.8, 1.1, 0.2); parapet.box(0, 0.5, -D / 2 - 0.3, W + 0.8, 1.1, 0.2);
    parapet.box(W / 2 + 0.3, 0.5, 0, 0.2, 1.1, D + 0.8); parapet.box(-W / 2 - 0.3, 0.5, 0, 0.2, 1.1, D + 0.8);
    parapet.box(-12, 0.5, -4, 14, 3, 9); parapet.box(10, 0.5, 3, 8, 2.2, 6);
    // Elevator machine room on top of the shaft.
    parapet.box(ELEVATOR.x, 0, D / 2 + ELEVATOR.depth / 2, ELEVATOR.width + 0.4, 3.2, ELEVATOR.depth);
    roof.add(new THREE.Mesh(parapet.geometry(), matte("#b9b3a8")));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 14, 8), metal); mast.position.set(-12, 10.5, -4); roof.add(mast);
    const roofSign = sign("ATLAS", 22, 4); roofSign.position.set(0, 3.6, D / 2 + 0.45); roof.add(roofSign);
    scene.add(shadowed(roof));

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
      const probe = new THREE.Vector3(-side.x * 31, floorLevel(middle), -side.z * 31).project(camera);
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
          f.tag.position.set(-side.x * 31 + toCamera.x * 6, floorLevel(middle) + 1.9 + (f.number - middle) * spacing, -side.z * 31 + toCamera.z * 6);
          const ends = f.leader!.geometry.attributes.position as THREE.BufferAttribute;
          ends.setXYZ(0, -side.x * 24.6 + toCamera.x * 14.6, y, -side.z * 24.6 + toCamera.z * 14.6);
          ends.setXYZ(1, f.tag.position.x, f.tag.position.y, f.tag.position.z); ends.needsUpdate = true;
          const on = f.number === current, over = f.number === hovered;
          f.band!.emissiveIntensity = on ? 1.4 : over ? 0.9 : 0.25;
          if (f.office?.status !== "LOCKED") f.glass!.opacity = on ? 0.1 : 0.24;
          f.tag.element.classList.toggle("hovered", over);
        }
      }
      roof.visible = current === null;
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
