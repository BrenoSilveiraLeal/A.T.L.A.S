import * as THREE from "three";
import { ELEVATOR, floorLevel, TOWER } from "@/core/building";
import { addPalms, buildCity, facadeMaterial, glows, Mass, NIGHT_SKY, prefersNight, roundedBody, roundedSlab, setNight, SKY, type FacadeStyle } from "./city";

/**
 * The ATLAS headquarters (owner, 01/11/2026: "personalizar o prédio para ser do A.T.L.A.S", "bem
 * mais bonito e bem modelado, no estilo The Sims 4", "mais moderno, como a foto"): the whole tower is
 * the company's, shared by the building view and the office scene so both show the same building.
 * - Podium (lobby and floors 1–2): wider, blue glass with rounded corners, entrance canopy, the
 *   ATLAS sign and flags; its roof is a garden with palms.
 * - Shaft (floors 3–15): glass with rounded corners and a white slab band at every floor; the office
 *   floors are clear glass on a plain slab, showing the office inside (no balconies).
 * - Crown (floors 16–18): set back, green-tinted glass, a deck with sun umbrellas, and on the roof
 *   an infinity pool with palms and loungers, under the logo on all four sides.
 * - A panoramic glass elevator up the front, where each office's elevator doors open.
 * Plain geometry and canvas drawings only; no downloaded models or textures.
 */
export const ATLAS_GREEN = "#5fbf8f";
export const PODIUM_TOP = 3;
export const CROWN_FROM = 16;
const W = TOWER.width, D = TOWER.depth, H = TOWER.storey;
/** Corner radius of the glass body. */
const R = 4;
const TOWER_STYLE: FacadeStyle = { wall: "#f7fafc", band: "#ffffff", curtain: true, glass: ["#e6f6ff", "#8fcaee", "#3f8cc8"], lit: 0.06 };
const PODIUM_STYLE: FacadeStyle = { wall: "#eef3f6", band: "#ffffff", curtain: true, glass: ["#d9eef9", "#7fb8de", "#3a77a8"], lit: 0.12 };
const CROWN_STYLE: FacadeStyle = { wall: "#f2faf6", band: "#ffffff", curtain: true, glass: ["#e8fbf3", "#9fdcc4", "#4aa886"], lit: 0.06 };

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
    glass: facadeMaterial(TOWER_STYLE, 3, { roughness: 0.2, metalness: 0.2 }),
    crown: facadeMaterial(CROWN_STYLE, 5, { roughness: 0.2, metalness: 0.2 }),
    podium: facadeMaterial(PODIUM_STYLE, 4, { roughness: 0.2, metalness: 0.2 }),
    slab: matte("#ffffff", 0.45), white: matte("#ffffff", 0.5), green: matte(ATLAS_GREEN, 0.5), wood: matte("#c98d5a", 0.7),
    lawn: matte("#7cc35a", 1), deck: matte("#d9a36e", 0.75), leaf: matte("#5fb847", 0.85), stone: matte("#e9e4dc", 0.8),
    rail: new THREE.MeshPhysicalMaterial({ color: 0xd8f1ff, transparent: true, opacity: 0.3, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    tube: SHAFT(),
    water: glows(new THREE.MeshStandardMaterial({ color: 0x45d0f5, emissive: 0x2fb8e8, roughness: 0.1, metalness: 0.1 }), 0.3, 1),
    cab: glows(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1cf, roughness: 0.4 }), 0.5, 1.6),
    lobby: glows(new THREE.MeshStandardMaterial({ color: 0xbfe4f5, emissive: 0xffe2a8, roughness: 0.15, metalness: 0.3 }), 0.25, 1.4),
  };
}

/** A sign drawn on canvas: the ATLAS mark (green rounded square with the "A") and, if asked, the name. */
export function logoSign(w: number, h: number, withName = true) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = Math.round((1024 * h) / w);
  const g = canvas.getContext("2d")!, ch = canvas.height;
  const mark = ch * 0.86, my = (ch - mark) / 2, r = mark * 0.24;
  const gap = ch * 0.12, textArea = canvas.width - mark - gap - ch * 0.12;
  let textSize = ch * 0.92;
  g.font = `800 ${Math.round(textSize)}px Manrope Variable, sans-serif`;
  while (g.measureText("ATLAS").width > textArea && textSize > ch * 0.5) {
    textSize -= 1;
    g.font = `800 ${Math.round(textSize)}px Manrope Variable, sans-serif`;
  }
  const textWidth = withName ? g.measureText("ATLAS").width : 0;
  const mx = withName ? (canvas.width - (mark + gap + textWidth)) / 2 : (canvas.width - mark) / 2;
  g.fillStyle = ATLAS_GREEN;
  g.beginPath(); g.roundRect(mx, my, mark, mark, r); g.fill();
  g.fillStyle = "#ffffff"; g.font = `800 ${Math.round(mark * 0.72)}px Manrope Variable, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("A", mx + mark / 2, my + mark * 0.54);
  if (withName) {
    g.fillStyle = "#1d3557"; g.font = `800 ${Math.round(textSize)}px Manrope Variable, sans-serif`; g.textAlign = "left";
    g.fillText("ATLAS", mx + mark + gap, ch / 2);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
}

/** Round bushes as instanced spheres (one draw call): [x, y, z, scale]. */
function bushes(group: THREE.Group, m: TowerMaterials, spots: [number, number, number, number][]) {
  if (!spots.length) return;
  const dummy = new THREE.Object3D(), tone = new THREE.Color(), FLOWERS = ["#5fb847", "#6cc552", "#5fb847", "#f28fb1", "#f6c453", "#ffffff"];
  const b = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), m.leaf, spots.length);
  spots.forEach(([x, y, z, s], n) => { dummy.position.set(x, y + s * 0.5, z); dummy.scale.set(s * 1.1, s * 0.85, s * 1.1); dummy.updateMatrix(); b.setMatrixAt(n, dummy.matrix); b.setColorAt(n, tone.set(FLOWERS[n % FLOWERS.length])); });
  group.add(b);
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
 * The slab under an office floor (top at y = 0): just the white slab edge, no balcony (owner,
 * 01/11/2026: "não gostei dessas varandinhas, tire"). The office scene stands on the same slab.
 */
export function officeSlab(m: TowerMaterials) {
  // The office-floor edge is a small reveal wider than the floors visible below,
  // so its rounded lip reads clearly around the glass façade.
  const slab = new THREE.Mesh(roundedSlab(W + 1.2, D + 1.2, R + 0.6, 0.45, -0.465), m.slab);
  slab.receiveShadow = true;
  return slab;
}

/**
 * One floor's shell (y = 0 at the floor's level): a white rounded slab and, unless `solid` is false
 * (the open office floors), the rounded glass body; plus the gardens on the podium roof (floor 3)
 * and on the crown's base (floor 16).
 */
export function floorShell(floor: number, m: TowerMaterials, solid = true) {
  const g = new THREE.Group(), [fw, fd] = footprint(floor), r = floor < PODIUM_TOP ? 6 : R;
  // Where the tower steps in (podium roof, crown base) the slab covers the wider floor below.
  const [sw, sd] = floor === PODIUM_TOP ? footprint(0) : floor === CROWN_FROM ? footprint(CROWN_FROM - 1) : [fw, fd];
  const sr = floor === PODIUM_TOP ? 6 : r;
  const slab = new THREE.Mesh(roundedSlab(sw + 0.8, sd + 0.8, sr + 0.4, 0.45), m.slab); slab.receiveShadow = true; g.add(slab);
  if (solid) g.add(new THREE.Mesh(roundedBody(fw, fd, r, 0.45, H - 0.45, -(floor - 1) * H, floor * 0.37), floor < PODIUM_TOP ? m.podium : floor >= CROWN_FROM ? m.crown : m.glass));
  if (floor === PODIUM_TOP) {
    // Podium roof garden: lawns, palms, benches and a glass railing at the podium's edge.
    const [pw, pd] = footprint(0), lawn = new Mass(), wood = new Mass(), palms: [number, number, number, number][] = [], flowers: [number, number, number, number][] = [];
    lawn.box(0, 0.45, pd / 2 - 2.3, pw - 4, 0.12, 3.6); lawn.box(0, 0.45, -pd / 2 + 2.3, pw - 4, 0.12, 3.6);
    lawn.box(pw / 2 - 2.3, 0.45, 0, 3.6, 0.12, pd - 9); lawn.box(-pw / 2 + 2.3, 0.45, 0, 3.6, 0.12, pd - 9);
    for (let x = -pw / 2 + 5; x <= pw / 2 - 5; x += 9) for (const z of [pd / 2 - 2.3, -pd / 2 + 2.3]) {
      if (z > 0 && Math.abs(x - ELEVATOR.x) < 4) continue;
      palms.push([x, 0.57, z, 0.6]); wood.box(x + 4.5, 0.57, z, 2.2, 0.45, 0.7); flowers.push([x + 2.3, 0.57, z + 0.8, 0.6]);
    }
    for (const x of [pw / 2 - 2.3, -pw / 2 + 2.3]) for (const z of [-8, 0, 8]) flowers.push([x, 0.57, z, 0.75]);
    g.add(new THREE.Mesh(lawn.geometry(), m.lawn), new THREE.Mesh(wood.geometry(), m.wood));
    bushes(g, m, flowers); addPalms(g, palms);
    railing(g, m, pw / 2 - 0.4, pd / 2 - 0.4, 0.45);
  }
  if (floor === CROWN_FROM) {
    // Deck on the setback: wood floor, sun umbrellas, planters.
    const deck = new Mass(), poles = new Mass(), flowers: [number, number, number, number][] = [];
    deck.box(0, 0.45, D / 2 - 2, W - 4, 0.1, 3.6); deck.box(0, 0.45, -D / 2 + 2, W - 4, 0.1, 3.6);
    deck.box(W / 2 - 2.4, 0.45, 0, 4.4, 0.1, D - 8); deck.box(-W / 2 + 2.4, 0.45, 0, 4.4, 0.1, D - 8);
    g.add(new THREE.Mesh(deck.geometry(), m.deck));
    const shades = new THREE.Group();
    for (const [x, z] of [[-14, D / 2 - 2], [-4, D / 2 - 2], [10, D / 2 - 2], [-10, -D / 2 + 2], [8, -D / 2 + 2]]) {
      poles.box(x, 0.55, z, 0.1, 2.4, 0.1);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 12), (x + z) % 2 ? m.green : m.white); top.position.set(x, 3, z); shades.add(top);
      flowers.push([x + 2, 0.55, z, 0.5]);
    }
    g.add(new THREE.Mesh(poles.geometry(), m.white), shades);
    bushes(g, m, flowers);
    railing(g, m, W / 2 - 0.4, D / 2 - 0.4, 0.55);
  }
  return g;
}

/** Lobby (street level): glass with warm light, canopy, the ATLAS sign, planters, palms and flags. */
export function lobby(m: TowerMaterials) {
  const g = new THREE.Group(), [pw, pd] = footprint(0);
  g.add(new THREE.Mesh(roundedSlab(pw, pd, 6, TOWER.lobby), m.lobby));
  const fins = new Mass();
  for (let x = -pw / 2 + 8; x <= pw / 2 - 8 + 0.01; x += (pw - 16) / 6) for (const z of [pd / 2 + 0.1, -pd / 2 - 0.1]) fins.box(x, 0, z, 0.35, TOWER.lobby, 0.4, false);
  g.add(new THREE.Mesh(fins.geometry(), m.white));
  const canopy = new Mass(), posts = new Mass(), planters = new Mass(), flowers: [number, number, number, number][] = [];
  canopy.box(0, 4.6, pd / 2 + 3.5, 20, 0.5, 7);
  for (const x of [-9, 9]) posts.box(x, 0, pd / 2 + 6.5, 0.35, 4.6, 0.35);
  for (const x of [-16, -12.5, 12.5, 16]) { planters.box(x, 0.3, pd / 2 + 2.5, 2.6, 0.7, 1.2); flowers.push([x, 1, pd / 2 + 2.5, 0.75]); }
  g.add(new THREE.Mesh(canopy.geometry(), m.white), new THREE.Mesh(posts.geometry(), m.green), new THREE.Mesh(planters.geometry(), m.stone));
  bushes(g, m, flowers);
  addPalms(g, [[-20, 0.3, pd / 2 + 4, 0.95], [20, 0.3, pd / 2 + 4, 0.95], [-26, 0.3, pd / 2 + 2, 0.85], [26, 0.3, pd / 2 + 2, 0.85]]);
  // Center the complete plaque on the podium facade's centerline. The logo artwork centers its
  // mark and name together inside the board, so the sign and its backing stay aligned as a unit.
  const plaque = new THREE.Group();
  plaque.position.set(0, floorLevel(1) + 3.6, pd / 2 + 0.55);
  const board = new THREE.Mesh(new THREE.BoxGeometry(19.2, 4.8, 0.25), m.white); plaque.add(board);
  const sign = logoSign(18, 4); sign.position.z = 0.14; plaque.add(sign);
  g.add(plaque);
  const small = logoSign(7, 1.55); small.position.set(0, 5.15, pd / 2 + 7.01); g.add(small);
  for (const x of [-23, 23]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 10, 8), m.white); pole.position.set(x, 5.3, pd / 2 + 7); g.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.04), m.green); flag.position.set(x + 1.2, 9.4, pd / 2 + 7); g.add(flag);
  }
  return g;
}

/** Roof of the crown: white band with the logo on all four sides, infinity pool, palms and loungers. */
export function crownTop(m: TowerMaterials) {
  const g = new THREE.Group(), [cw, cd] = footprint(CROWN_FROM);
  g.add(new THREE.Mesh(roundedSlab(cw + 0.8, cd + 0.8, R + 0.4, 0.5), m.slab));
  g.add(new THREE.Mesh(roundedSlab(cw + 0.8, cd + 0.8, R + 0.4, 2.6, 0.5), m.white));
  g.add(new THREE.Mesh(roundedSlab(cw + 1.1, cd + 1.1, R + 0.55, 0.35, 3.1), m.green));
  for (const [x, z, turn, w] of [[0, cd / 2 + 0.42, 0, 16], [0, -cd / 2 - 0.42, Math.PI, 16], [cw / 2 + 0.42, 0, Math.PI / 2, 10], [-cw / 2 - 0.42, 0, -Math.PI / 2, 10]] as const) {
    const s = logoSign(w, w / 4.5); s.position.set(x, 1.8, z); s.rotation.y = turn; g.add(s);
  }
  // Roof deck behind the parapet: infinity pool along the front, loungers, palms, a glass railing.
  const deck = new Mass(), loungers = new Mass();
  deck.box(0, 0.5, 0, cw - 2, 0.15, cd - 2);
  g.add(new THREE.Mesh(deck.geometry(), m.deck));
  const pool = new Mass(); pool.box(0, 0.66, cd / 2 - 4.5, cw - 8, 0.08, 5); g.add(new THREE.Mesh(pool.geometry(), m.water));
  for (let x = -cw / 2 + 5; x <= cw / 2 - 5; x += 4) loungers.box(x, 0.66, -1, 1, 0.35, 2.2);
  g.add(new THREE.Mesh(loungers.geometry(), m.white));
  addPalms(g, [[-cw / 2 + 3, 0.65, -cd / 2 + 3, 0.6], [cw / 2 - 3, 0.65, -cd / 2 + 3, 0.6], [-cw / 2 + 3, 0.65, 2, 0.5], [cw / 2 - 3, 0.65, 2, 0.5]]);
  railing(g, m, cw / 2 - 0.6, cd / 2 - 0.6, 3.45);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 9, 10), m.white); mast.position.set(-cw / 2 + 6, 7.5, -cd / 2 + 4); g.add(mast);
  return g;
}

/**
 * The elevator's glass: a front pane and two side panes, each its own mesh, and no back pane against
 * the tower (owner, 10/11/2026: the glass "fica piscando"). A transparent box drew its back face on
 * the façade's own plane and sorted its faces differently every frame, so it flickered.
 */
export function shaftGlass(material: THREE.Material, x: number, y0: number, z: number, h: number, width: number = ELEVATOR.width, depth: number = ELEVATOR.depth) {
  const g = new THREE.Group();
  const pane = (w: number, px: number, pz: number, turn: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(px, y0 + h / 2, pz); mesh.rotation.y = turn; g.add(mesh);
  };
  // Inset a few cm from the posts and the façade so no two surfaces share a plane.
  pane(width - 0.1, x, z + depth / 2 - 0.03, 0);
  for (const side of [-1, 1]) pane(depth - 0.1, x + side * (width / 2 - 0.03), z + 0.04, Math.PI / 2);
  return g;
}

/**
 * The panoramic elevator up the front of the shaft, from the podium roof to the crown: a glass tube
 * with green posts and a lit cab. The office's elevator doors open into it. Returns the cab, which the
 * building view moves up and down.
 */
export function elevatorTube(m: TowerMaterials, from = floorLevel(PODIUM_TOP), to = floorLevel(CROWN_FROM)) {
  const g = new THREE.Group(), h = to - from, z = D / 2 + ELEVATOR.depth / 2;
  g.add(shaftGlass(m.tube, ELEVATOR.x, from, z, h));
  const posts = new Mass(), rings = new Mass();
  // Slim white posts (they cross the office floors' glass, so they stay discreet).
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) posts.box(ELEVATOR.x + (dx * ELEVATOR.width) / 2, from, z + (dz * ELEVATOR.depth) / 2, 0.16, h, 0.16, false);
  for (let y = from; y <= to + 0.01; y += H) rings.box(ELEVATOR.x, y, z, ELEVATOR.width + 0.2, 0.18, ELEVATOR.depth + 0.2);
  g.add(new THREE.Mesh(posts.geometry(), m.white), new THREE.Mesh(rings.geometry(), m.white));
  const cab = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.width - 0.5, 2.8, ELEVATOR.depth - 0.5), m.cab); cab.position.set(ELEVATOR.x, from + 1.5, z); g.add(cab);
  return { group: g, cab, from, to };
}

/**
 * Around one office floor (the office scene): sky, the floor's slab, the tower below down to the
 * street (podium, glass floors, the elevator tube) and the city. The office floor stays at y = 0.
 */
export function buildSurroundings(scene: THREE.Scene, { floor, mobile = false }: { floor: number; mobile?: boolean }) {
  // Same city, same tower and the same day or night as on the map.
  const night = prefersNight(), sky = night ? NIGHT_SKY : SKY;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 1200, 5000);
  const m = towerMaterials(), street = -floorLevel(floor), group = new THREE.Group(), below = new THREE.Group();
  group.add(officeSlab(m));
  below.position.y = street;
  below.add(lobby(m));
  for (let f = 1; f < floor; f++) { const shell = floorShell(f, m); shell.position.y = floorLevel(f); below.add(shell); }
  // The office scene runs its own cab in this tube (it stops at this floor), so the tube's still cab is hidden.
  const lift = elevatorTube(m, floorLevel(PODIUM_TOP), floorLevel(floor)); lift.cab.visible = false;
  below.add(lift.group);
  const city = buildCity({ mobile });
  below.add(city);
  group.add(below);
  // The cars down in the street keep driving (the office scene calls this every frame).
  group.userData.update = city.userData.update;
  group.userData.night = night;
  setNight(group, night ? 1 : 0);
  scene.add(group);
  return group;
}
