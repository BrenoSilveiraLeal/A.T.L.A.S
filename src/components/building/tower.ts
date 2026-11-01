import * as THREE from "three";
import { ELEVATOR, floorLevel, TOWER } from "@/core/building";
import { buildCity, facadeTexture, Mass, SKY, type FacadeStyle } from "./city";

/**
 * The ATLAS headquarters (owner, 01/11/2026: "personalizar o prédio para ser do A.T.L.A.S e deixar
 * bem mais bonito e bem modelado, no estilo The Sims 4"): a whole tower of the company, shared by the
 * building view and the office scene so both show the same building.
 * - Podium (lobby and floors 1–2), wider, cream stone, with the entrance canopy and the ATLAS sign;
 *   its roof is a garden.
 * - Glass shaft (floors 3–15) with white corner columns and ATLAS-green fins; the office floors have
 *   a terrace with a glass railing and planters (the same terrace the office scene stands on).
 * - Set-back crown (floors 16–18) with a deck terrace, the logo on all four sides and a spire.
 * - A panoramic glass elevator up the front, where each office's elevator doors open.
 * Plain geometry and canvas drawings only; no downloaded models or textures.
 */
export const ATLAS_GREEN = "#5fbf8f";
export const PODIUM_TOP = 3;
export const CROWN_FROM = 16;
const W = TOWER.width, D = TOWER.depth, H = TOWER.storey;
const PODIUM_STYLE: FacadeStyle = { wall: "#f3e9d6", band: "#e3d3b5" };
const CROWN_STYLE: FacadeStyle = { wall: "#eef8f3", band: "#d3ebdf", curtain: true };
const TOWER_STYLE: FacadeStyle = { wall: "#f4f6f8", band: "#dfe5ea", curtain: true };

/** Width and depth of the tower at a floor. */
export function footprint(floor: number): [number, number] {
  if (floor < PODIUM_TOP) return [W + 10, D + 10];
  if (floor >= CROWN_FROM) return [W - 10, D - 8];
  return [W, D];
}

/** Glass of the panoramic elevator (also the office scene's shaft by its doors). */
export const SHAFT = () => new THREE.MeshPhysicalMaterial({ color: 0xc9f0e0, transparent: true, opacity: 0.28, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });

export type TowerMaterials = ReturnType<typeof towerMaterials>;
export function towerMaterials() {
  const matte = (color: THREE.ColorRepresentation, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
  return {
    glass: new THREE.MeshStandardMaterial({ map: facadeTexture(TOWER_STYLE, 3), roughness: 0.25, metalness: 0.15 }),
    crown: new THREE.MeshStandardMaterial({ map: facadeTexture(CROWN_STYLE, 5), roughness: 0.25, metalness: 0.15 }),
    stone: new THREE.MeshStandardMaterial({ map: facadeTexture(PODIUM_STYLE, 4), roughness: 0.75 }),
    slab: matte("#fbf8f2", 0.6), white: matte("#ffffff", 0.5), green: matte(ATLAS_GREEN, 0.5), wood: matte("#c98d5a", 0.7),
    lawn: matte("#7cc35a", 1), deck: matte("#d9a36e", 0.75), leaf: matte("#5fb847", 0.85), trunk: matte("#8a5a3a"),
    rail: new THREE.MeshPhysicalMaterial({ color: 0xd8f1ff, transparent: true, opacity: 0.3, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    tube: SHAFT(),
    cab: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1cf, emissiveIntensity: 0.5, roughness: 0.4 }),
    lobby: new THREE.MeshStandardMaterial({ color: 0xbfe4f5, emissive: 0xffe2a8, emissiveIntensity: 0.25, roughness: 0.15, metalness: 0.3 }),
  };
}

/** A sign drawn on canvas: the ATLAS mark (green rounded square with the "A") and, if asked, the name. */
export function logoSign(w: number, h: number, withName = true) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = Math.round((1024 * h) / w);
  const g = canvas.getContext("2d")!, ch = canvas.height;
  const mark = ch * 0.86, mx = withName ? ch * 0.07 : (canvas.width - mark) / 2, my = ch * 0.07, r = mark * 0.24;
  g.fillStyle = ATLAS_GREEN;
  g.beginPath(); g.roundRect(mx, my, mark, mark, r); g.fill();
  g.fillStyle = "#ffffff"; g.font = `800 ${Math.round(mark * 0.72)}px Manrope Variable, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("A", mx + mark / 2, my + mark * 0.54);
  if (withName) {
    g.fillStyle = "#1d3557"; g.font = `800 ${Math.round(ch * 0.62)}px Manrope Variable, sans-serif`; g.textAlign = "left";
    g.fillText("ATLAS", mx + mark + ch * 0.18, ch * 0.54);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
}

/** Round bushes and trees as instanced spheres (one draw call each kind). */
function greenery(group: THREE.Group, m: TowerMaterials, bushes: [number, number, number, number][], trees: [number, number, number, number][] = []) {
  const dummy = new THREE.Object3D(), tone = new THREE.Color(), FLOWERS = ["#5fb847", "#6cc552", "#5fb847", "#f28fb1", "#f6c453", "#ffffff"];
  if (bushes.length) {
    const b = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), m.leaf, bushes.length);
    bushes.forEach(([x, y, z, s], n) => { dummy.position.set(x, y + s * 0.5, z); dummy.scale.set(s * 1.1, s * 0.85, s * 1.1); dummy.updateMatrix(); b.setMatrixAt(n, dummy.matrix); b.setColorAt(n, tone.set(FLOWERS[n % FLOWERS.length])); });
    group.add(b);
  }
  if (trees.length) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 2.2, 8), m.trunk, trees.length);
    const crowns = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 14, 10), m.leaf, trees.length);
    trees.forEach(([x, y, z, s], n) => {
      dummy.scale.setScalar(s); dummy.position.set(x, y + 1.1 * s, z); dummy.updateMatrix(); trunks.setMatrixAt(n, dummy.matrix);
      dummy.scale.set(s, s * 1.15, s); dummy.position.set(x, y + 3 * s, z); dummy.updateMatrix(); crowns.setMatrixAt(n, dummy.matrix);
      crowns.setColorAt(n, tone.setHSL(0.27 + (n % 5) * 0.015, 0.5, 0.42 + (n % 3) * 0.04));
    });
    group.add(trunks, crowns);
  }
}

/** Glass railing with a white handrail around a rectangle, at height `y`. */
function railing(group: THREE.Group, m: TowerMaterials, hw: number, hd: number, y = 0) {
  const glass = new Mass(), top = new Mass();
  glass.box(0, y, hd, hw * 2, 1.05, 0.05, false); glass.box(0, y, -hd, hw * 2, 1.05, 0.05, false);
  glass.box(hw, y, 0, 0.05, 1.05, hd * 2, false); glass.box(-hw, y, 0, 0.05, 1.05, hd * 2, false);
  top.box(0, y + 1.05, hd, hw * 2 + 0.1, 0.08, 0.12); top.box(0, y + 1.05, -hd, hw * 2 + 0.1, 0.08, 0.12);
  top.box(hw, y + 1.05, 0, 0.12, 0.08, hd * 2 + 0.1); top.box(-hw, y + 1.05, 0, 0.12, 0.08, hd * 2 + 0.1);
  group.add(new THREE.Mesh(glass.geometry(), m.rail), new THREE.Mesh(top.geometry(), m.white));
}

/**
 * The terrace around an office floor: slab, glass railing and wooden planters with flowers along it.
 * The office scene stands on the same terrace, so it matches the building view.
 */
export function officeTerrace(m: TowerMaterials) {
  const g = new THREE.Group(), hw = W / 2 + 2.9, hd = D / 2 + 2.9;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 6, 0.45, D + 6), m.slab); slab.position.y = -0.24; slab.receiveShadow = true; g.add(slab);
  railing(g, m, hw, hd);
  const planters = new Mass(), bushes: [number, number, number, number][] = [];
  for (let x = -hw + 4; x <= hw - 4; x += 8) for (const z of [hd - 0.6, -hd + 0.6]) {
    if (z > 0 && Math.abs(x - ELEVATOR.x) < 4) continue; // keep the elevator landing clear
    planters.box(x, 0, z, 2.6, 0.55, 0.8); bushes.push([x - 0.6, 0.55, z, 0.55], [x + 0.6, 0.55, z, 0.5]);
  }
  for (let z = -hd + 4; z <= hd - 4; z += 8) for (const x of [hw - 0.6, -hw + 0.6]) { planters.box(x, 0, z, 0.8, 0.55, 2.6); bushes.push([x, 0.55, z - 0.6, 0.55], [x, 0.55, z + 0.6, 0.5]); }
  g.add(new THREE.Mesh(planters.geometry(), m.wood));
  greenery(g, m, bushes);
  return g;
}

/** Corner columns (white) and vertical fins (ATLAS green) of a glass floor, `h` high. */
function frame(m: TowerMaterials, fw: number, fd: number, h: number) {
  const cols = new Mass(), fins = new Mass();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cols.box((sx * fw) / 2, 0, (sz * fd) / 2, 1.3, h, 1.3, false);
  for (const x of [-fw / 2 + fw / 6, -fw / 6, fw / 6, fw / 2 - fw / 6]) for (const z of [fd / 2 + 0.3, -fd / 2 - 0.3]) fins.box(x, 0, z, 0.35, h, 0.7, false);
  for (const z of [-fd / 4, fd / 4]) for (const x of [fw / 2 + 0.3, -fw / 2 - 0.3]) fins.box(x, 0, z, 0.7, h, 0.35, false);
  return [new THREE.Mesh(cols.geometry(), m.white), new THREE.Mesh(fins.geometry(), m.green)];
}

/**
 * One floor's shell, for the floors that are not open offices (y = 0 at the floor's level): slab,
 * façade, and the gardens that sit on the podium roof (floor 3) and on the crown's base (floor 16).
 */
export function floorShell(floor: number, m: TowerMaterials, solid = true) {
  const g = new THREE.Group(), [fw, fd] = footprint(floor);
  // Where the tower steps in (podium roof, crown base) the slab covers the wider floor below.
  const [sw, sd] = floor === PODIUM_TOP ? footprint(0) : floor === CROWN_FROM ? footprint(CROWN_FROM - 1) : [fw, fd];
  const slab = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.8, 0.45, sd + 0.8), m.slab); slab.position.y = 0.22; g.add(slab);
  if (solid) {
    const body = new Mass(-(floor - 1) * H);
    body.box(0, 0.45, 0, fw, H - 0.45, fd, false, floor * 0.37);
    g.add(new THREE.Mesh(body.geometry(), floor < PODIUM_TOP ? m.stone : floor >= CROWN_FROM ? m.crown : m.glass));
  }
  if (floor >= PODIUM_TOP) g.add(...frame(m, fw, fd, H));
  if (floor === PODIUM_TOP) {
    // Podium roof garden: lawns, round trees, benches and a glass railing at the podium's edge.
    const [pw, pd] = footprint(0), lawn = new Mass(), wood = new Mass(), trees: [number, number, number, number][] = [], bushes: [number, number, number, number][] = [];
    lawn.box(0, 0, pd / 2 - 2.3, pw - 2, 0.12, 3.6); lawn.box(0, 0, -pd / 2 + 2.3, pw - 2, 0.12, 3.6);
    lawn.box(pw / 2 - 2.3, 0, 0, 3.6, 0.12, pd - 9); lawn.box(-pw / 2 + 2.3, 0, 0, 3.6, 0.12, pd - 9);
    for (let x = -pw / 2 + 5; x <= pw / 2 - 5; x += 9) for (const z of [pd / 2 - 2.3, -pd / 2 + 2.3]) {
      if (z > 0 && Math.abs(x - ELEVATOR.x) < 4) continue;
      trees.push([x, 0.12, z, 0.75]); wood.box(x + 4.5, 0.12, z, 2.2, 0.45, 0.7); bushes.push([x + 2.3, 0.12, z + 0.8, 0.6]);
    }
    for (const x of [pw / 2 - 2.3, -pw / 2 + 2.3]) for (const z of [-8, 0, 8]) bushes.push([x, 0.12, z, 0.75]);
    g.add(new THREE.Mesh(lawn.geometry(), m.lawn), new THREE.Mesh(wood.geometry(), m.wood));
    greenery(g, m, bushes, trees);
    railing(g, m, pw / 2 - 0.2, pd / 2 - 0.2, 0);
  }
  if (floor === CROWN_FROM) {
    // Deck on the setback: wood floor, sun umbrellas, planters.
    const deck = new Mass(), poles = new Mass(), bushes: [number, number, number, number][] = [];
    deck.box(0, 0, D / 2 - 2, W - 2, 0.1, 3.6); deck.box(0, 0, -D / 2 + 2, W - 2, 0.1, 3.6);
    deck.box(W / 2 - 2.4, 0, 0, 4.4, 0.1, D - 8); deck.box(-W / 2 + 2.4, 0, 0, 4.4, 0.1, D - 8);
    g.add(new THREE.Mesh(deck.geometry(), m.deck));
    const shades = new THREE.Group();
    for (const [x, z] of [[-14, D / 2 - 2], [-4, D / 2 - 2], [10, D / 2 - 2], [-10, -D / 2 + 2], [8, -D / 2 + 2]]) {
      poles.box(x, 0.1, z, 0.1, 2.4, 0.1);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 12), (x + z) % 2 ? m.green : m.white); top.position.set(x, 2.6, z); shades.add(top);
      bushes.push([x + 2, 0.1, z, 0.5]);
    }
    g.add(new THREE.Mesh(poles.geometry(), m.white), shades);
    greenery(g, m, bushes);
    railing(g, m, W / 2 - 0.2, D / 2 - 0.2, 0.1);
  }
  return g;
}

/** Lobby (street level): glass with warm light, canopy, the ATLAS sign, planters and flags. */
export function lobby(m: TowerMaterials) {
  const g = new THREE.Group(), [pw, pd] = footprint(0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(pw, TOWER.lobby, pd), m.lobby); glass.position.y = TOWER.lobby / 2; g.add(glass);
  const cols = new Mass();
  for (let x = -pw / 2; x <= pw / 2 + 0.01; x += pw / 6) for (const z of [pd / 2, -pd / 2]) cols.box(x, 0, z, 0.8, TOWER.lobby, 0.8, false);
  for (let z = -pd / 2 + pd / 4; z < pd / 2; z += pd / 4) for (const x of [pw / 2, -pw / 2]) cols.box(x, 0, z, 0.8, TOWER.lobby, 0.8, false);
  g.add(new THREE.Mesh(cols.geometry(), m.white));
  const canopy = new Mass(), posts = new Mass(), planters = new Mass(), bushes: [number, number, number, number][] = [];
  canopy.box(0, 4.6, pd / 2 + 3.5, 20, 0.5, 7);
  for (const x of [-9, 9]) posts.box(x, 0, pd / 2 + 6.5, 0.35, 4.6, 0.35);
  for (const x of [-16, -12.5, 12.5, 16]) { planters.box(x, 0.3, pd / 2 + 2.5, 2.6, 0.7, 1.2); bushes.push([x, 1, pd / 2 + 2.5, 0.75]); }
  g.add(new THREE.Mesh(canopy.geometry(), m.wood), new THREE.Mesh(posts.geometry(), m.green), new THREE.Mesh(planters.geometry(), m.wood));
  greenery(g, m, bushes);
  const sign = logoSign(18, 4); sign.position.set(0, floorLevel(1) + 3.6, pd / 2 + 0.06); g.add(sign);
  const small = logoSign(7, 1.55); small.position.set(0, 5.15, pd / 2 + 7.01); g.add(small);
  // Two flags in ATLAS green by the entrance.
  for (const x of [-22, 22]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 10, 8), m.white); pole.position.set(x, 5.3, pd / 2 + 6); g.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.04), m.green); flag.position.set(x + 1.2, 9.4, pd / 2 + 6); g.add(flag);
  }
  return g;
}

/** Roof of the crown: parapet, the logo on all four sides, a rooftop garden and the spire. */
export function crownTop(m: TowerMaterials) {
  const g = new THREE.Group(), [cw, cd] = footprint(CROWN_FROM);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.8, 0.5, cd + 0.8), m.slab); slab.position.y = 0.25; g.add(slab);
  const band = new Mass(); band.box(0, 0.5, 0, cw + 0.8, 3.2, cd + 0.8, false); g.add(new THREE.Mesh(band.geometry(), m.white));
  const stripe = new Mass(); stripe.box(0, 3.7, 0, cw + 1, 0.35, cd + 1, true); g.add(new THREE.Mesh(stripe.geometry(), m.green));
  for (const [x, z, turn, w] of [[0, cd / 2 + 0.42, 0, 16], [0, -cd / 2 - 0.42, Math.PI, 16], [cw / 2 + 0.42, 0, Math.PI / 2, 12], [-cw / 2 - 0.42, 0, -Math.PI / 2, 12]] as const) {
    const s = logoSign(w, w / 4.5); s.position.set(x, 2.1, z); s.rotation.y = turn; g.add(s);
  }
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(cw - 6, 0.1, cd - 6), m.lawn); lawn.position.y = 0.55; g.add(lawn);
  greenery(g, m, [[-10, 0.6, -4, 0.8], [10, 0.6, 4, 0.8], [-12, 0.6, 5, 0.6], [12, 0.6, -5, 0.6]], [[-6, 0.6, 0, 0.7], [6, 0.6, 0, 0.7]]);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.8, 16, 12), m.white); spire.position.y = 8.5; g.add(spire);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), m.green); tip.position.y = 16.8; g.add(tip);
  return g;
}

/**
 * The panoramic elevator up the front of the shaft, from the podium roof to the crown: a glass tube
 * with green posts and a lit cab. The office's elevator doors open into it. Returns the cab, which the
 * building view moves up and down.
 */
export function elevatorTube(m: TowerMaterials, from = floorLevel(PODIUM_TOP), to = floorLevel(CROWN_FROM)) {
  const g = new THREE.Group(), h = to - from, z = D / 2 + ELEVATOR.depth / 2;
  const tube = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.width, h, ELEVATOR.depth), m.tube); tube.position.set(ELEVATOR.x, from + h / 2, z); g.add(tube);
  const posts = new Mass(), rings = new Mass();
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) posts.box(ELEVATOR.x + (dx * ELEVATOR.width) / 2, from, z + (dz * ELEVATOR.depth) / 2, 0.3, h, 0.3, false);
  for (let y = from; y <= to + 0.01; y += H) rings.box(ELEVATOR.x, y, z, ELEVATOR.width + 0.2, 0.18, ELEVATOR.depth + 0.2);
  g.add(new THREE.Mesh(posts.geometry(), m.green), new THREE.Mesh(rings.geometry(), m.white));
  const cab = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.width - 0.5, 2.8, ELEVATOR.depth - 0.5), m.cab); cab.position.set(ELEVATOR.x, from + 1.5, z); g.add(cab);
  return { group: g, cab, from, to };
}

/**
 * Around one office floor (the office scene): sky, the floor's terrace, the tower below down to the
 * street (podium, glass floors, the elevator tube) and the city. The office floor stays at y = 0.
 */
export function buildSurroundings(scene: THREE.Scene, { floor, mobile = false }: { floor: number; mobile?: boolean }) {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 320, 1100);
  const m = towerMaterials(), street = -floorLevel(floor), group = new THREE.Group(), below = new THREE.Group();
  group.add(officeTerrace(m));
  below.position.y = street;
  below.add(lobby(m));
  for (let f = 1; f < floor; f++) { const shell = floorShell(f, m); shell.position.y = floorLevel(f); below.add(shell); }
  below.add(elevatorTube(m, floorLevel(PODIUM_TOP), floorLevel(floor)).group);
  const city = buildCity({ mobile });
  below.add(city);
  group.add(below);
  scene.add(group);
  return group;
}
