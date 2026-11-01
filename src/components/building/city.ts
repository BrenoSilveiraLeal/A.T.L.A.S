import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TOWER } from "@/core/building";

/**
 * The city around the ATLAS tower (the tower itself is in tower.ts), shared by the building view and
 * the office scene (owner, 01/11/2026: the office now sits on a floor of a tower in a city; the city
 * must be the same seen from the street and from the office windows). Made of plain geometry merged
 * into a handful of meshes, with façades drawn on canvas: no downloaded models or textures.
 */
/**
 * Look (owner, 01/11/2026: "pegada The Sims 4", then "mais moderno, como a foto"): a sunny modern
 * downtown — glass towers with white slab bands (boxes on podiums, cylinders, stepped), roof pools
 * and gardens, LED panels, palms and round trees, crosswalks, a few colourful low-rise blocks.
 * Only the mood of the reference is borrowed; every shape and colour here is our own.
 */
export const SKY = 0x9fd0f2;
/** Distance between street centre lines; each block is BLOCK wide, the rest is street. */
export const PITCH = 80, BLOCK = 58;

/** Deterministic random numbers, so the city is laid out the same way everywhere. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One façade tile covers this many window bays and storeys, so the lit windows do not repeat too often. */
const TILE = 8;

/**
 * A façade: wall colour, the band at each slab, whether the windows run edge to edge (curtain
 * wall), the glass gradient (light to dark) and how many rooms show a warm light by day.
 */
export interface FacadeStyle { wall: string; band: string; curtain?: boolean; glass?: readonly [string, string, string]; lit?: number }
const SKY_GLASS = ["#dff3ff", "#8fcbef", "#4f97cf"] as const;
/** Modern glass towers (first four) and colourful low-rise blocks (last three). */
export const STREET_STYLES: readonly FacadeStyle[] = [
  { wall: "#f4f8fb", band: "#ffffff", curtain: true, glass: SKY_GLASS, lit: 0.08 },
  { wall: "#dfeaf3", band: "#f6f9fb", curtain: true, glass: ["#cfe7f7", "#6fa9d6", "#2f6b9e"], lit: 0.06 },
  { wall: "#2e3b4c", band: "#465569", curtain: true, glass: ["#8fb6d6", "#3e5d7c", "#1e3147"], lit: 0.1 },
  { wall: "#e6f5f1", band: "#ffffff", curtain: true, glass: ["#e2fbf5", "#8fd8ca", "#45a092"], lit: 0.06 },
  { wall: "#f3ead9", band: "#e5d6bb", lit: 0.25 },
  { wall: "#ec9a82", band: "#d77d65", lit: 0.25 },
  { wall: "#f0cf72", band: "#d9b453", lit: 0.25 },
];
export const TOWER_STYLES = [0, 1, 2, 3], LOW_STYLES = [4, 5, 6];

/**
 * A façade: window bays of the tower's size with white frames, sky-blue glass and a few lit or
 * curtained rooms (`map`), plus the same rooms' lights for the night (`lights`, an emissive map).
 */
export function facadeMaps(style: FacadeStyle, seed: number) {
  const size = 512, cell = size / TILE, random = seeded(seed);
  const canvas = document.createElement("canvas"), night = document.createElement("canvas");
  canvas.width = canvas.height = night.width = night.height = size;
  const g = canvas.getContext("2d")!, n = night.getContext("2d")!;
  g.fillStyle = style.wall; g.fillRect(0, 0, size, size);
  n.fillStyle = "#000000"; n.fillRect(0, 0, size, size);
  const CURTAINS = ["#f6d6a8", "#f3b6b0", "#bfe3d0", "#fff3d6"];
  for (let row = 0; row < TILE; row++) for (let col = 0; col < TILE; col++) {
    const x = col * cell, y = row * cell;
    // Band at the slab of every storey, then a white-framed window.
    g.fillStyle = style.band; g.fillRect(x, y + cell * 0.84, cell, cell * 0.16);
    const inset = style.curtain ? cell * 0.05 : cell * 0.18;
    const wx = x + inset, wy = y + (style.curtain ? cell * 0.06 : cell * 0.16), ww = cell - inset * 2, wh = cell * (style.curtain ? 0.74 : 0.56);
    g.fillStyle = "#ffffff"; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    const [g0, g1, g2] = style.glass ?? SKY_GLASS, litByDay = style.lit ?? 0.22;
    const pane = g.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
    pane.addColorStop(0, g0); pane.addColorStop(0.45, g1); pane.addColorStop(1, g2);
    g.fillStyle = pane; g.fillRect(wx, wy, ww, wh);
    const roll = random();
    if (roll < litByDay) { g.fillStyle = "#ffe9b8"; g.fillRect(wx, wy, ww, wh); }
    else if (roll < litByDay + 0.15) { g.fillStyle = CURTAINS[Math.floor(random() * CURTAINS.length)]; g.fillRect(wx, wy, ww * 0.28, wh); g.fillRect(wx + ww * 0.72, wy, ww * 0.28, wh); }
    // At night about half the rooms have the light on.
    if (roll < 0.5) { n.fillStyle = roll < litByDay ? "#ffd98a" : "#f5c46a"; n.fillRect(wx, wy, ww, wh); }
    // Sky glint and the middle mullion.
    g.fillStyle = "rgba(255,255,255,0.45)"; g.beginPath(); g.moveTo(wx, wy + wh * 0.35); g.lineTo(wx + ww * 0.35, wy); g.lineTo(wx + ww * 0.5, wy); g.lineTo(wx, wy + wh * 0.5); g.fill();
    g.fillStyle = "#ffffff"; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
    if (!style.curtain) { g.fillStyle = style.band; g.fillRect(wx - 5, wy + wh + 3, ww + 10, 4); }
  }
  const texture = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  };
  return { map: texture(canvas), lights: texture(night) };
}

/**
 * Marks a material's glow for day and night: `setNight` moves `emissiveIntensity` between the two
 * (window lights, street lamps, the lobby).
 */
export function glows<T extends THREE.MeshStandardMaterial>(material: T, day: number, night: number): T {
  material.userData.glow = { day, night };
  material.emissiveIntensity = day;
  return material;
}

/** A façade material that lights its rooms at night. */
export function facadeMaterial(style: FacadeStyle, seed: number, options: THREE.MeshStandardMaterialParameters = {}) {
  const { map, lights } = facadeMaps(style, seed);
  return glows(new THREE.MeshStandardMaterial({ map, emissiveMap: lights, emissive: 0xffffff, roughness: style.curtain ? 0.3 : 0.75, ...options }), 0, 1.1);
}

/** Day (0) to night (1): every marked glow under `root` follows. */
export function setNight(root: THREE.Object3D, amount: number) {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const glow = m.userData.glow as { day: number; night: number } | undefined;
      if (!glow || seen.has(m)) continue;
      seen.add(m);
      (m as THREE.MeshStandardMaterial).emissiveIntensity = glow.day + (glow.night - glow.day) * amount;
    }
  });
}

/**
 * Collects boxes into one geometry. Side faces get UVs in metres (one tile = TILE bays × TILE
 * storeys, aligned to `levelBase`), so windows keep the tower's size whatever the box's size.
 */
export class Mass {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  constructor(private readonly levelBase = 0) {}

  private quad(corners: number[][], normal: number[], uvs: number[][]) {
    const base = this.pos.length / 3;
    corners.forEach((c, i) => { this.pos.push(...c); this.nor.push(...normal); this.uv.push(...uvs[i]); });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Box centred on x/z, from y0 up `h`. `top` adds the roof face; `shift` moves the window pattern. */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, top = true, shift = 0) {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
    const su = TOWER.bay * TILE, sv = TOWER.storey * TILE;
    const v0 = (y0 - this.levelBase) / sv, v1 = (y1 - this.levelBase) / sv;
    const side = (a: number[], b: number[], n: number[], len: number) => {
      const u0 = shift, u1 = shift + len / su;
      this.quad([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], n, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    };
    side([x0, z1], [x1, z1], [0, 0, 1], w);
    side([x1, z1], [x1, z0], [1, 0, 0], d);
    side([x1, z0], [x0, z0], [0, 0, -1], w);
    side([x0, z0], [x0, z1], [-1, 0, 0], d);
    if (top) this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[0, 0], [w / su, 0], [w / su, d / su], [0, d / su]]);
  }

  get empty() { return this.idx.length === 0; }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setIndex(this.idx);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/**
 * An open glass cylinder (a round tower or a rounded corner) with UVs in metres like `Mass`, so its
 * windows have the same size as on the flat façades. Same attributes as `Mass`, so they merge.
 */
export function cylinder(x: number, y0: number, z: number, r: number, h: number, levelBase = 0, shift = 0, segments = 28) {
  const geometry = new THREE.CylinderGeometry(r, r, h, segments, 1, true).translate(x, y0 + h / 2, z);
  const uv = geometry.attributes.uv as THREE.BufferAttribute, pos = geometry.attributes.position as THREE.BufferAttribute;
  const su = TOWER.bay * TILE, sv = TOWER.storey * TILE, around = (2 * Math.PI * r) / su;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, shift + uv.getX(i) * around, (pos.getY(i) - levelBase) / sv);
  return geometry;
}

/** Rounded-rectangle outline, centred on the origin. */
export function roundedRect(w: number, d: number, r: number) {
  const s = new THREE.Shape(), x = w / 2, z = d / 2;
  s.moveTo(-x + r, -z); s.lineTo(x - r, -z); s.absarc(x - r, -z + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, z - r); s.absarc(x - r, z - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, z); s.absarc(-x + r, z - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -z + r); s.absarc(-x + r, -z + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
/** A flat slab with rounded corners, from y0 up `h`. */
export function roundedSlab(w: number, d: number, r: number, h: number, y0 = 0) {
  return new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth: h, bevelEnabled: false, curveSegments: 10 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}
/** Glass body with rounded corners (two crossed boxes and four corner cylinders), one geometry. */
export function roundedBody(w: number, d: number, r: number, y0: number, h: number, levelBase = 0, shift = 0) {
  const flat = new Mass(levelBase);
  flat.box(0, y0, 0, w - 2 * r, h, d, false, shift); flat.box(0, y0, 0, w, h, d - 2 * r, false, shift);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => cylinder(sx * (w / 2 - r), y0, sz * (d / 2 - r), r, h, levelBase, shift, 12));
  const geometry = mergeGeometries([flat.geometry().toNonIndexed(), ...corners.map((c) => c.toNonIndexed())])!;
  geometry.computeBoundingSphere();
  return geometry;
}

/** A palm crown: drooping fronds around the top of the trunk (origin at the trunk's top). */
function palmCrown() {
  const fronds = Array.from({ length: 8 }, (_, k) => new THREE.BoxGeometry(0.55, 0.06, 3.4).translate(0, 0, 1.6).rotateX(0.45).rotateY((k / 8) * Math.PI * 2));
  return mergeGeometries(fronds)!;
}
/** Palms (trunk and crown, one draw call each): [x, y, z, scale]. */
export function addPalms(group: THREE.Object3D, spots: readonly (readonly [number, number, number, number])[]) {
  if (!spots.length) return;
  const dummy = new THREE.Object3D(), tone = new THREE.Color();
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.28, 7, 7).translate(0, 3.5, 0), new THREE.MeshStandardMaterial({ color: 0xa47a52, roughness: 0.9 }), spots.length);
  const crowns = new THREE.InstancedMesh(palmCrown(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), spots.length);
  spots.forEach(([x, y, z, s], n) => {
    const lean = ((n * 37) % 10) / 100 - 0.05;
    dummy.position.set(x, y, z); dummy.rotation.set(lean, n * 1.3, -lean); dummy.scale.setScalar(s); dummy.updateMatrix(); trunks.setMatrixAt(n, dummy.matrix);
    dummy.position.set(x + lean * 7 * s, y + 7 * s, z + lean * 7 * s); dummy.rotation.set(0, n * 1.3, 0); dummy.updateMatrix(); crowns.setMatrixAt(n, dummy.matrix);
    crowns.setColorAt(n, tone.setHSL(0.28 + (n % 4) * 0.02, 0.55, 0.36 + (n % 3) * 0.05));
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);
}

/** LED panels on façades: bright abstract adverts (no real brands), glowing more at night. */
function billboardTexture(k: number) {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 384;
  const g = canvas.getContext("2d")!, palettes = [["#ff6b9a", "#ffb86b"], ["#4fd1ff", "#7b61ff"], ["#59e3a7", "#2f9bff"], ["#ffd84f", "#ff7a59"]];
  const [a, b] = palettes[k % palettes.length], grad = g.createLinearGradient(0, 0, 256, 384);
  grad.addColorStop(0, a); grad.addColorStop(1, b); g.fillStyle = grad; g.fillRect(0, 0, 256, 384);
  g.fillStyle = "rgba(255,255,255,0.85)"; g.beginPath(); g.arc(128, 150, 70 - k * 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)"; g.fillRect(40, 270, 176, 22); g.fillRect(70, 305, 116, 16);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const plain = (color: THREE.ColorRepresentation, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
const mesh = (mass: Mass, material: THREE.Material, shadows = false) => {
  const m = new THREE.Mesh(mass.geometry(), material);
  m.receiveShadow = true; m.castShadow = shadows;
  return m;
};

/**
 * Streets, sidewalks, parks, trees, cars and the other buildings on a grid of blocks around the
 * tower's block (which stays a plaza). The group's origin is at street level.
 */
export function buildCity({ mobile = false, seed = 7 }: { mobile?: boolean; seed?: number } = {}) {
  const random = seeded(seed), city = new THREE.Group();
  // The city's edge, in blocks from the centre, changes with the direction: it spreads out along
  // valleys between the hills instead of being a circle (owner, 01/11/2026: "se estender mais entre
  // as montanhas").
  const size = mobile ? 3.2 : 5.2;
  const edgeAt = (angle: number) => size * (0.74 + 0.3 * Math.sin(3 * angle + 0.6) + 0.12 * Math.sin(5 * angle + 2.1));
  const reach = Math.ceil(size * 1.18);
  // Grass everywhere; asphalt only under the city's blocks, so the city ends in green land, not in road.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), plain("#86bf6a", 1));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; city.add(ground);
  /** Blocks inside the city's irregular edge (the centre block, the ATLAS plaza, always is). */
  const inside = (i: number, j: number) => Math.abs(i) <= reach && Math.abs(j) <= reach && (i === 0 && j === 0 || Math.hypot(i, j) <= edgeAt(Math.atan2(j, i)) + 0.2);
  /** Distance from the centre to the city's edge in a direction, in metres. */
  const edgeMetres = (angle: number) => (edgeAt(angle) + 0.6) * PITCH;
  const ROAD = 14;
  const asphalt = new Mass();

  const plinths = new Mass(), lawns = new Mass(), plaza = new Mass(), marks = new Mass(), zebra = new Mass(), roofs = new Mass(), terracotta = new Mass();
  const pools = new Mass(), decks = new Mass();
  const facades = STREET_STYLES.map(() => new Mass()), rounds: THREE.BufferGeometry[][] = STREET_STYLES.map(() => []);
  const boards: THREE.BufferGeometry[][] = [[], [], [], []], discs: THREE.BufferGeometry[] = [];
  const trees: [number, number, number][] = [], bushes: [number, number, number][] = [], lamps: [number, number][] = [];
  /** Cars: x, z, heading, and the stretch of street they drive along (they loop within it). */
  const cars: [number, number, number, number, number][] = [];
  const palms: [number, number, number, number][] = [];
  const treeRow = (x0: number, z0: number, x1: number, z1: number, step: number) => {
    const n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / step);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / Math.max(1, n), z = z0 + ((z1 - z0) * i) / Math.max(1, n), roll = random();
      // Palms and round trees alternate along the sidewalk, with a street lamp now and then.
      if (roll < 0.4) palms.push([x, 0.3, z, 0.8 + random() * 0.3]); else if (roll < 0.8) trees.push([x, z, 0.8 + random() * 0.5]); else lamps.push([x, z]);
      if (i < n && random() < 0.7) bushes.push([x + (x1 - x0) / Math.max(1, n) / 2, z + (z1 - z0) / Math.max(1, n) / 2, 0.6 + random() * 0.5]);
    }
  };
  /** A rooftop: pool with deck, garden with palms, or light machinery (no dark helipads). */
  const rooftop = (x: number, y: number, z: number, w: number, d: number) => {
    roofs.box(x, y, z, w + 0.8, 0.6, d + 0.8);
    const kind = random(), top = y + 0.6;
    if (kind < 0.35 && w > 14) { decks.box(x, top, z, w - 2, 0.12, d - 2); pools.box(x, top + 0.12, z, (w - 2) * 0.55, 0.08, (d - 2) * 0.45); palms.push([x + w * 0.35, top, z + d * 0.32, 0.55], [x - w * 0.35, top, z - d * 0.32, 0.5]); }
    else if (kind < 0.7) { lawns.box(x, top, z, w - 3, 0.15, d - 3); palms.push([x, top, z, 0.6]); bushes.push([x + w * 0.3, z + d * 0.3, 0.7], [x - w * 0.3, z - d * 0.25, 0.6]); }
    else roofs.box(x + (random() - 0.5) * w * 0.4, top, z + (random() - 0.5) * d * 0.4, 4, 2.2, 3);
  };
  /** An LED panel on the face of a tower that looks at +z or -z. */
  const billboard = (x: number, y: number, z: number, facing: 1 | -1) => {
    const plane = new THREE.PlaneGeometry(7, 10.5).rotateY(facing > 0 ? 0 : Math.PI).translate(x, y, z + facing * 0.2);
    boards[Math.floor(random() * boards.length)].push(plane);
  };

  for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
    if (!inside(i, j)) continue;
    const cx = i * PITCH, cz = j * PITCH, edge = BLOCK / 2 - 2.5;
    const center = i === 0 && j === 0;
    asphalt.box(cx, 0, cz, PITCH, 0.02, PITCH);
    const park = !center && random() < 0.14;
    (center ? plaza : plinths).box(cx, 0, cz, BLOCK, 0.3, BLOCK);
    treeRow(cx - edge, cz + edge, cx + edge, cz + edge, 11); treeRow(cx - edge, cz - edge, cx + edge, cz - edge, 11);
    treeRow(cx - edge, cz - edge + 8, cx - edge, cz + edge - 8, 11); treeRow(cx + edge, cz - edge + 8, cx + edge, cz + edge - 8, 11);
    if (center) {
      // The ATLAS plaza: lawns with palms around the tower.
      for (const [x, z] of [[-17, 21], [17, 21], [-17, -21], [17, -21]]) { lawns.box(cx + x, 0.3, cz + z, 18, 0.06, 7); palms.push([cx + x - 6, 0.36, cz + z, 0.9], [cx + x + 6, 0.36, cz + z, 0.85]); }
      continue;
    }
    if (park) {
      lawns.box(cx, 0.3, cz, BLOCK - 8, 0.05, BLOCK - 8);
      for (let k = 0; k < 12; k++) trees.push([cx + (random() - 0.5) * (BLOCK - 14), cz + (random() - 0.5) * (BLOCK - 14), 1 + random() * 0.6]);
      for (let k = 0; k < 8; k++) palms.push([cx + (random() - 0.5) * (BLOCK - 14), 0.35, cz + (random() - 0.5) * (BLOCK - 14), 0.9 + random() * 0.3]);
      for (let k = 0; k < 24; k++) bushes.push([cx + (random() - 0.5) * (BLOCK - 12), cz + (random() - 0.5) * (BLOCK - 12), 0.5 + random() * 0.6]);
      continue;
    }
    // Downtown: modern towers (box on a podium, round, stepped) and some colourful low-rise blocks.
    // Taller downtown, lower and more low-rise blocks towards the edge.
    const near = Math.max(Math.abs(i), Math.abs(j)), kind = random(), out = Math.hypot(i, j) / edgeAt(Math.atan2(j, i));
    const lowRise = near === 1 ? kind < 0.5 : kind < 0.15 + Math.max(0, out - 0.45) * 0.9;
    if (lowRise) {
      const lots: [number, number, number, number][] = random() < 0.5 ? [[cx - 13, cz, 24, BLOCK - 10], [cx + 13, cz, 24, BLOCK - 10]]
        : [[cx - 13, cz - 13, 24, 24], [cx + 13, cz - 13, 24, 24], [cx - 13, cz + 13, 24, 24], [cx + 13, cz + 13, 24, 24]];
      for (const [x, z, w, d] of lots) {
        const h = Math.round(10 + random() * 12), style = LOW_STYLES[Math.floor(random() * LOW_STYLES.length)];
        facades[style].box(x, 0.3, z, w - 2, h, d - 2, false, random());
        if (random() < 0.5) terracotta.box(x, h + 0.3, z, w - 1.4, 0.6, d - 1.4); else rooftop(x, h + 0.3, z, w - 2, d - 2);
      }
      continue;
    }
    const style = TOWER_STYLES[Math.floor(random() * TOWER_STYLES.length)], shift = random();
    const podium = 7 + Math.round(random() * 5), fade = Math.max(0.35, 1.15 - out * 0.8);
    const tall = Math.round(((near === 1 ? 26 : 40) + random() ** 1.4 * (near === 1 ? 26 : 70)) * (near === 1 ? 1 : fade));
    // Podium: a low glass base filling most of the block, with a garden on top.
    facades[style].box(cx, 0.3, cz, BLOCK - 8, podium, BLOCK - 8, false, shift);
    roofs.box(cx, podium + 0.3, cz, BLOCK - 7, 0.6, BLOCK - 7);
    lawns.box(cx + (BLOCK - 8) / 2 - 4, podium + 0.9, cz, 5, 0.15, BLOCK - 14);
    const base = podium + 0.9, shape = random();
    if (shape < 0.3) {
      // Round tower.
      const r = 12 + random() * 3;
      rounds[style].push(cylinder(cx, base, cz, r, tall, 0, shift));
      discs.push(new THREE.CylinderGeometry(r + 0.6, r + 0.6, 0.6, 28).translate(cx, base + tall + 0.3, cz));
      if (random() < 0.5) { pools.box(cx, base + tall + 0.65, cz, r, 0.08, r * 0.5); palms.push([cx + r * 0.55, base + tall + 0.6, cz, 0.5]); }
    } else if (shape < 0.6) {
      // Stepped tower: three set-backs.
      let w = 34, d = 30, y = base;
      for (const part of [0.5, 0.3, 0.2]) {
        const h = Math.round(tall * part);
        facades[style].box(cx, y, cz, w, h, d, false, shift); y += h;
        rooftop(cx, y, cz, w, d); y += 0.6; w -= 8; d -= 7;
      }
      if (random() < 0.4) billboard(cx - 34 / 2 + 5, base + 10, cz + 15, 1);
    } else {
      // Slab tower, sometimes with a crown.
      const w = 30 + random() * 8, d = 22 + random() * 6;
      facades[style].box(cx, base, cz, w, tall, d, false, shift);
      rooftop(cx, base + tall, cz, w, d);
      if (random() < 0.45) billboard(cx + w / 2 - 5, base + 12, cz + d / 2, 1);
      if (random() < 0.3) billboard(cx - w / 2 + 5, base + 14, cz - d / 2, -1);
    }
  }
  // Streets between the blocks: each runs only as far as the blocks beside it; every other one goes
  // on out of the city as an avenue into the outskirts. Yellow centre lines, crosswalks, cars.
  const span = (k: number, alongZ: boolean): [number, number] => {
    const list: number[] = [];
    for (let n = -reach; n <= reach; n++) if (alongZ ? inside(k - 1, n) || inside(k, n) : inside(n, k - 1) || inside(n, k)) list.push(n);
    return list.length ? [Math.min(...list) * PITCH - PITCH / 2, Math.max(...list) * PITCH + PITCH / 2] : [0, 0];
  };
  const streets: { line: number; from: number; to: number; alongZ: boolean }[] = [];
  for (let k = -reach; k <= reach + 1; k++) for (const alongZ of [true, false]) {
    const line = (k - 0.5) * PITCH, [from, to] = span(k, alongZ);
    if (to <= from) continue;
    streets.push({ line, from, to, alongZ });
    if (k % 2 !== 0) continue;
    for (const [a, b] of [[to, to + 150], [from - 150, from]]) {
      const mid = (a + b) / 2, len = b - a;
      if (alongZ) asphalt.box(line, 0, mid, ROAD, 0.02, len); else asphalt.box(mid, 0, line, len, 0.02, ROAD);
    }
  }
  for (const s of streets) {
    for (let p = s.from; p < s.to; p += 9) {
      const nearCrossing = Math.abs(((p + PITCH / 2) % PITCH + PITCH) % PITCH - PITCH / 2) > PITCH / 2 - 14;
      if (!nearCrossing) { if (s.alongZ) marks.box(s.line, 0.02, p, 0.3, 0.01, 4.5); else marks.box(p, 0.02, s.line, 4.5, 0.01, 0.3); }
      if (random() < 0.1) cars.push([s.alongZ ? s.line + (random() < 0.5 ? -3 : 3) : p, s.alongZ ? p : s.line + (random() < 0.5 ? -3 : 3), s.alongZ ? 0 : Math.PI / 2, s.from, s.to]);
    }
  }
  for (let k = -reach; k <= reach + 1; k++) for (let m = -reach; m <= reach + 1; m++) {
    const line = (k - 0.5) * PITCH, cross = (m - 0.5) * PITCH, [a, b] = span(k, true), [c, d] = span(m, false);
    if (cross < a || cross > b || line < c || line > d) continue; // no crossing out here
    for (let t = -8; t <= 8; t += 1.6) {
      zebra.box(line + t, 0.03, cross - 13, 0.8, 0.01, 3.2); zebra.box(line + t, 0.03, cross + 13, 0.8, 0.01, 3.2);
      zebra.box(cross - 13, 0.03, line + t, 3.2, 0.01, 0.8); zebra.box(cross + 13, 0.03, line + t, 3.2, 0.01, 0.8);
    }
  }

  // The outskirts, out to the hills: a lake, woods and little houses with gardens, all along the city's edge.
  const lakeAt = new THREE.Vector2(Math.cos(2.4) * (edgeMetres(2.4) + 150), Math.sin(2.4) * (edgeMetres(2.4) + 150));
  const shore = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(78, 1, 52).translate(lakeAt.x, 0.02, lakeAt.y), plain("#e8d9b4", 1));
  const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(70, 1, 45).translate(lakeAt.x, 0.05, lakeAt.y),
    glows(new THREE.MeshStandardMaterial({ color: 0x5cc4ea, emissive: 0x1e6f9a, roughness: 0.12, metalness: 0.2 }), 0.08, 0.25));
  city.add(shore, lake);
  const yards = new Mass(), outskirts = Math.round((mobile ? 0.5 : 1) * 170);
  const free = (x: number, z: number, r: number) => Math.hypot(x - lakeAt.x, z - lakeAt.y) > 85 + r && !inside(Math.round(x / PITCH), Math.round(z / PITCH)) && Math.hypot(x, z) > edgeMetres(Math.atan2(z, x)) - 10 + r;
  for (let n = 0; n < outskirts; n++) {
    const a = random() * Math.PI * 2, r = edgeMetres(a) + 20 + random() * 170, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!free(x, z, 12)) continue;
    const w = 9 + random() * 5, d = 8 + random() * 5, h = 5 + random() * 3;
    yards.box(x, 0, z, w + 7, 0.12, d + 7);
    facades[LOW_STYLES[Math.floor(random() * LOW_STYLES.length)]].box(x, 0.12, z, w, h, d, false, random());
    terracotta.box(x, h + 0.12, z, w + 1, 0.8, d + 1);
    trees.push([x + w / 2 + 2.5, z + d / 2 + 2, 0.7 + random() * 0.3]);
    if (random() < 0.5) bushes.push([x - w / 2 - 1.5, z + d / 2 + 2.5, 0.6]);
  }
  for (let n = 0; n < (mobile ? 10 : 22); n++) {
    const a = random() * Math.PI * 2, r = edgeMetres(a) + 50 + random() * 220, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    for (let k = 0; k < 16; k++) {
      const x = cx + (random() - 0.5) * 50, z = cz + (random() - 0.5) * 50;
      if (free(x, z, 3)) { if (random() < 0.85) trees.push([x, z, 1 + random() * 0.8]); else palms.push([x, 0, z, 1 + random() * 0.3]); }
    }
  }
  city.add(mesh(asphalt, plain("#4c5463", 0.95)), mesh(yards, plain("#9fd07f", 1)));

  city.add(mesh(plinths, plain("#d9dde2")), mesh(plaza, plain("#eef0f2")), mesh(lawns, plain("#7cc35a", 1)), mesh(marks, plain("#f2c94c", 0.6)), mesh(zebra, plain("#f4f6f8", 0.6)));
  city.add(mesh(roofs, plain("#e9edf1", 0.7)), mesh(terracotta, plain("#d0714f", 0.7)), mesh(decks, plain("#d9a36e", 0.75)));
  if (discs.length) city.add(new THREE.Mesh(mergeGeometries(discs)!, plain("#e9edf1", 0.7)));
  if (!pools.empty) city.add(mesh(pools, glows(new THREE.MeshStandardMaterial({ color: 0x4fd1f0, emissive: 0x2fb8e8, roughness: 0.15, metalness: 0.1 }), 0.25, 0.8)));
  facades.forEach((mass, n) => {
    const geometries = [...(mass.empty ? [] : [mass.geometry().toNonIndexed()]), ...rounds[n].map((g) => g.toNonIndexed())];
    if (geometries.length) { const m = new THREE.Mesh(mergeGeometries(geometries)!, facadeMaterial(STREET_STYLES[n], seed + n)); m.receiveShadow = true; city.add(m); }
  });
  boards.forEach((list, k) => {
    if (!list.length) return;
    const texture = billboardTexture(k);
    city.add(new THREE.Mesh(mergeGeometries(list)!, glows(new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, roughness: 0.4 }), 0.35, 1.3)));
  });
  addPalms(city, palms);

  // Round trees, bushes and street lamps: one draw call each kind.
  const tone = new THREE.Color(), dummy = new THREE.Object3D();
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.28, 2.6, 8), plain("#8a5a3a"), trees.length);
  const crowns = new THREE.InstancedMesh(new THREE.SphereGeometry(2.1, 14, 10), plain("#5fae45", 0.85), trees.length);
  trees.forEach(([x, z, s], n) => {
    dummy.position.set(x, 0.3 + 1.3 * s, z); dummy.scale.setScalar(s); dummy.rotation.set(0, n, 0); dummy.updateMatrix(); trunks.setMatrixAt(n, dummy.matrix);
    dummy.position.set(x, 0.3 + 3.7 * s, z); dummy.scale.set(s, s * 1.15, s); dummy.updateMatrix(); crowns.setMatrixAt(n, dummy.matrix);
    crowns.setColorAt(n, tone.setHSL(0.24 + random() * 0.09, 0.55, 0.4 + random() * 0.12));
  });
  const shrubs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), plain("#6cbf4f", 0.9), bushes.length);
  const FLOWERS = ["#6cbf4f", "#6cbf4f", "#7fcb5a", "#f28fb1", "#f6c453"];
  bushes.forEach(([x, z, s], n) => {
    dummy.position.set(x, 0.3 + 0.55 * s, z); dummy.scale.set(s * 1.2, s * 0.8, s * 1.2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); shrubs.setMatrixAt(n, dummy.matrix);
    shrubs.setColorAt(n, tone.set(FLOWERS[Math.floor(random() * FLOWERS.length)]));
  });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 6), plain("#3f4a56", 0.5), lamps.length);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 10, 8), glows(new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffe9b0 }), 0.4, 3), lamps.length);
  lamps.forEach(([x, z], n) => {
    dummy.scale.setScalar(1); dummy.position.set(x, 2.8, z); dummy.updateMatrix(); poles.setMatrixAt(n, dummy.matrix);
    dummy.position.set(x, 5.4, z); dummy.updateMatrix(); bulbs.setMatrixAt(n, dummy.matrix);
  });
  city.add(trunks, crowns, shrubs, poles, bulbs);

  // Rolling green hills around the city, fading into the distance.
  const hillSpots = mobile ? 18 : 34;
  const hills = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 12), plain("#8cc673", 1), hillSpots);
  for (let n = 0; n < hillSpots; n++) {
    const angle = (n / hillSpots) * Math.PI * 2 + random() * 0.2, r = edgeMetres(angle) + 280 + random() * 240, w = 100 + random() * 100;
    dummy.position.set(Math.cos(angle) * r, -12, Math.sin(angle) * r); dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.scale.set(w, 30 + random() * 50, w * (0.6 + random() * 0.5)); dummy.updateMatrix(); hills.setMatrixAt(n, dummy.matrix);
    hills.setColorAt(n, tone.setHSL(0.27 + random() * 0.06, 0.38, 0.5 + random() * 0.08));
  }
  city.add(hills);

  // Toy-like cars driving on their side of the street, with headlights that glow at night.
  const CAR_COLORS = [0xf25f5c, 0x2f80ed, 0xf2c94c, 0x27ae60, 0xffffff, 0x9b51e0, 0x56ccf2, 0xf2994a];
  const traffic = cars.map(([x, z, turn, from, to]) => {
    const alongZ = turn === 0, across = alongZ ? x : z, line = Math.round(across / PITCH - 0.5) * PITCH + PITCH / 2;
    return { x, z, alongZ, dir: across - line > 0 ? 1 : -1, speed: 7 + random() * 6, from, to };
  });
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 1, 4.4), plain("#ffffff", 0.35), traffic.length);
  const cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.8, 2.2), plain("#dff2ff", 0.2), traffic.length);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.3, 0.1), glows(new THREE.MeshStandardMaterial({ color: 0xfffbe8, emissive: 0xfff2c4 }), 0.2, 3), traffic.length);
  traffic.forEach((_, n) => bodies.setColorAt(n, tone.set(CAR_COLORS[n % CAR_COLORS.length])));
  const place = () => traffic.forEach((c, n) => {
    dummy.scale.setScalar(1); dummy.rotation.set(0, c.alongZ ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
    dummy.position.set(c.x, 0.6, c.z); dummy.updateMatrix(); bodies.setMatrixAt(n, dummy.matrix);
    dummy.position.set(c.x, 1.45, c.z); dummy.updateMatrix(); cabins.setMatrixAt(n, dummy.matrix);
    dummy.position.set(c.x + (c.alongZ ? 0 : c.dir * 2.22), 0.75, c.z + (c.alongZ ? c.dir * 2.22 : 0)); dummy.updateMatrix(); beams.setMatrixAt(n, dummy.matrix);
  });
  place();
  city.add(bodies, cabins, beams);
  /** Moves the cars; the caller runs it every frame (each loops along its own street, inside the city). */
  city.userData.update = (dt: number) => {
    for (const c of traffic) {
      const length = c.to - c.from;
      if (c.alongZ) { c.z += c.dir * c.speed * dt; if (c.z > c.to) c.z -= length; if (c.z < c.from) c.z += length; }
      else { c.x += c.dir * c.speed * dt; if (c.x > c.to) c.x -= length; if (c.x < c.from) c.x += length; }
    }
    place();
    bodies.instanceMatrix.needsUpdate = cabins.instanceMatrix.needsUpdate = beams.instanceMatrix.needsUpdate = true;
  };
  return city;
}
