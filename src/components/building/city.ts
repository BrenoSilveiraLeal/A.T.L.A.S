import * as THREE from "three";
import { ELEVATOR, floorLevel, TOWER } from "@/core/building";

/**
 * The city around the ATLAS tower, shared by the building view and the office scene (owner,
 * 01/11/2026: the office now sits on a floor of a tower in a city; the city must be the same seen
 * from the street and from the office windows). Made of plain geometry merged into a handful of
 * meshes, with façades drawn on canvas: no downloaded models or textures.
 */
/**
 * Look (owner, 01/11/2026: "é pra ter uma pegada mais The Sims 4"): a sunny, saturated toy-city
 * palette — pastel stucco façades with white window frames, round trees and bushes, warm light.
 * Only the mood is borrowed; every shape and colour here is our own.
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

/** A façade: wall colour, the band at each slab, and whether the windows run edge to edge (curtain wall). */
export interface FacadeStyle { wall: string; band: string; curtain?: boolean }
/** The neighbours' façades: pastel stucco and a couple of glass towers. */
export const STREET_STYLES: readonly FacadeStyle[] = [
  { wall: "#ec9a82", band: "#d77d65" }, { wall: "#f0cf72", band: "#d9b453" }, { wall: "#73c2b4", band: "#58a698" },
  { wall: "#b3a5dd", band: "#988ac4" }, { wall: "#f3e7cf", band: "#ddcdab" }, { wall: "#cf7458", band: "#b35d43" },
  { wall: "#7fb0e0", band: "#5f93c6", curtain: true }, { wall: "#9ad19a", band: "#7dba7d" },
];
/** The ATLAS tower: blue glass with white mullions and spandrels. */
export const TOWER_STYLE: FacadeStyle = { wall: "#f4f6f8", band: "#dfe5ea", curtain: true };

/** A façade texture: window bays of the tower's size with white frames, sky-blue glass and a few lit or curtained rooms. */
export function facadeTexture(style: FacadeStyle, seed: number) {
  const size = 512, cell = size / TILE, random = seeded(seed);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = style.wall; g.fillRect(0, 0, size, size);
  const CURTAINS = ["#f6d6a8", "#f3b6b0", "#bfe3d0", "#fff3d6"];
  for (let row = 0; row < TILE; row++) for (let col = 0; col < TILE; col++) {
    const x = col * cell, y = row * cell;
    // Band at the slab of every storey, then a white-framed window.
    g.fillStyle = style.band; g.fillRect(x, y + cell * 0.84, cell, cell * 0.16);
    const inset = style.curtain ? cell * 0.05 : cell * 0.18;
    const wx = x + inset, wy = y + (style.curtain ? cell * 0.06 : cell * 0.16), ww = cell - inset * 2, wh = cell * (style.curtain ? 0.74 : 0.56);
    g.fillStyle = "#ffffff"; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    const pane = g.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
    pane.addColorStop(0, "#d9f1ff"); pane.addColorStop(0.45, "#8cc8ee"); pane.addColorStop(1, "#5aa2d6");
    g.fillStyle = pane; g.fillRect(wx, wy, ww, wh);
    const roll = random();
    if (roll < 0.22) { g.fillStyle = "#ffe9b8"; g.fillRect(wx, wy, ww, wh); }
    else if (roll < 0.4) { g.fillStyle = CURTAINS[Math.floor(random() * CURTAINS.length)]; g.fillRect(wx, wy, ww * 0.28, wh); g.fillRect(wx + ww * 0.72, wy, ww * 0.28, wh); }
    // Sky glint and the middle mullion.
    g.fillStyle = "rgba(255,255,255,0.45)"; g.beginPath(); g.moveTo(wx, wy + wh * 0.35); g.lineTo(wx + ww * 0.35, wy); g.lineTo(wx + ww * 0.5, wy); g.lineTo(wx, wy + wh * 0.5); g.fill();
    g.fillStyle = "#ffffff"; g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
    if (!style.curtain) { g.fillStyle = style.band; g.fillRect(wx - 5, wy + wh + 3, ww + 10, 4); }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
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

const plain = (color: THREE.ColorRepresentation, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness });
/** Cladding of the elevator shaft, the same seen from the street and from the office. */
export const SHAFT = () => new THREE.MeshStandardMaterial({ color: 0x46505a, roughness: 0.55, metalness: 0.25 });
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
  const reach = mobile ? 2 : 3;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), plain("#5c6472", 0.95));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; city.add(ground);

  const plinths = new Mass(), lawns = new Mass(), plaza = new Mass(), marks = new Mass(), roofs = new Mass(), terracotta = new Mass();
  const facades = STREET_STYLES.map(() => new Mass());
  const trees: [number, number, number][] = [], bushes: [number, number, number][] = [], lamps: [number, number][] = [], cars: [number, number, number][] = [];
  const treeRow = (x0: number, z0: number, x1: number, z1: number, step: number) => {
    const n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / step);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / Math.max(1, n), z = z0 + ((z1 - z0) * i) / Math.max(1, n);
      if (random() < 0.8) trees.push([x, z, 0.8 + random() * 0.5]); else lamps.push([x, z]);
      // Round bushes between the trees.
      if (i < n && random() < 0.7) bushes.push([x + (x1 - x0) / Math.max(1, n) / 2, z + (z1 - z0) / Math.max(1, n) / 2, 0.6 + random() * 0.5]);
    }
  };

  for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
    const cx = i * PITCH, cz = j * PITCH, edge = BLOCK / 2 - 2.5;
    const center = i === 0 && j === 0;
    const park = !center && random() < 0.16;
    (center ? plaza : plinths).box(cx, 0, cz, BLOCK, 0.3, BLOCK);
    // Trees along the sidewalk, on the side of the street.
    treeRow(cx - edge, cz + edge, cx + edge, cz + edge, 11); treeRow(cx - edge, cz - edge, cx + edge, cz - edge, 11);
    treeRow(cx - edge, cz - edge + 8, cx - edge, cz + edge - 8, 11); treeRow(cx + edge, cz - edge + 8, cx + edge, cz + edge - 8, 11);
    if (center) {
      // Lawns in the plaza around the tower.
      for (const [x, z] of [[-17, 21], [17, 21], [-17, -21], [17, -21]]) lawns.box(cx + x, 0.3, cz + z, 18, 0.06, 7);
      continue;
    }
    if (park) {
      lawns.box(cx, 0.3, cz, BLOCK - 8, 0.05, BLOCK - 8);
      for (let k = 0; k < 18; k++) trees.push([cx + (random() - 0.5) * (BLOCK - 14), cz + (random() - 0.5) * (BLOCK - 14), 1 + random() * 0.6]);
      for (let k = 0; k < 24; k++) bushes.push([cx + (random() - 0.5) * (BLOCK - 12), cz + (random() - 0.5) * (BLOCK - 12), 0.5 + random() * 0.6]);
      continue;
    }
    // One, two or four buildings on the block; taller downtown, near the tower.
    const near = Math.max(Math.abs(i), Math.abs(j));
    const layout = random();
    const lots: [number, number, number, number][] = layout < 0.3 ? [[cx, cz, BLOCK - 10, BLOCK - 10]]
      : layout < 0.6 ? [[cx - 13, cz, 24, BLOCK - 10], [cx + 13, cz, 24, BLOCK - 10]]
      : [[cx - 13, cz - 13, 24, 24], [cx + 13, cz - 13, 24, 24], [cx - 13, cz + 13, 24, 24], [cx + 13, cz + 13, 24, 24]];
    for (const [x, z, w, d] of lots) {
      // The blocks next to the tower stay lower, so the ATLAS tower stands out.
      const height = Math.round((near === 1 ? 10 : 16) + random() ** 1.6 * (near === 1 ? 28 : 70));
      const style = Math.floor(random() * STREET_STYLES.length), target = facades[style], shift = random();
      const bw = w - random() * 4, bd = d - random() * 4;
      target.box(x, 0.3, z, bw, height, bd, false, shift);
      // Flat roofs with a coloured cornice; the low ones get a terracotta roof top.
      (height < 22 && !STREET_STYLES[style].curtain ? terracotta : roofs).box(x, height + 0.3, z, bw + 0.6, 0.6, bd + 0.6);
      // A setback crown on some of the taller ones, and machinery on the roof.
      if (height > 40 && random() < 0.5) { const top = 6 + random() * 10; target.box(x, height + 0.9, z, bw * 0.6, top, bd * 0.6, false, shift); roofs.box(x, height + top + 0.9, z, bw * 0.6 + 0.6, 0.6, bd * 0.6 + 0.6); }
      else roofs.box(x + (random() - 0.5) * bw * 0.4, height + 0.9, z + (random() - 0.5) * bd * 0.4, 4, 2.2, 3);
    }
  }
  // Lane markings (yellow centre lines) and cars on every street between the blocks.
  const span = (reach + 0.5) * PITCH;
  for (let k = -reach; k <= reach + 1; k++) {
    const line = (k - 0.5) * PITCH;
    for (let s = -span; s < span; s += 9) {
      marks.box(line, 0.02, s, 0.3, 0.01, 4.5); marks.box(s, 0.02, line, 4.5, 0.01, 0.3);
      if (random() < 0.1) cars.push([line + (random() < 0.5 ? -3 : 3), s, 0]);
      if (random() < 0.1) cars.push([s, line + (random() < 0.5 ? -3 : 3), Math.PI / 2]);
    }
  }

  city.add(mesh(plinths, plain("#e8dfcc")), mesh(plaza, plain("#f1e8d6")), mesh(lawns, plain("#7cc35a", 1)), mesh(marks, plain("#f2c94c", 0.6)));
  city.add(mesh(roofs, plain("#c3c7cc")), mesh(terracotta, plain("#d0714f", 0.7)));
  facades.forEach((mass, n) => { if (!mass.empty) city.add(mesh(mass, new THREE.MeshStandardMaterial({ map: facadeTexture(STREET_STYLES[n], seed + n), roughness: STREET_STYLES[n].curtain ? 0.35 : 0.75 }))); });

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
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffe9b0, emissiveIntensity: 0.5 }), lamps.length);
  lamps.forEach(([x, z], n) => {
    dummy.scale.setScalar(1); dummy.position.set(x, 2.8, z); dummy.updateMatrix(); poles.setMatrixAt(n, dummy.matrix);
    dummy.position.set(x, 5.4, z); dummy.updateMatrix(); bulbs.setMatrixAt(n, dummy.matrix);
  });
  city.add(trunks, crowns, shrubs, poles, bulbs);

  // Toy-like cars: a body and a lighter cabin.
  const CAR_COLORS = [0xf25f5c, 0x2f80ed, 0xf2c94c, 0x27ae60, 0xffffff, 0x9b51e0, 0x56ccf2, 0xf2994a];
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 1, 4.4), plain("#ffffff", 0.35), cars.length);
  const cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.8, 2.2), plain("#dff2ff", 0.2), cars.length);
  cars.forEach(([x, z, turn], n) => {
    dummy.scale.setScalar(1); dummy.rotation.set(0, turn, 0);
    dummy.position.set(x, 0.6, z); dummy.updateMatrix(); bodies.setMatrixAt(n, dummy.matrix);
    dummy.position.set(x, 1.45, z); dummy.updateMatrix(); cabins.setMatrixAt(n, dummy.matrix);
    bodies.setColorAt(n, tone.set(CAR_COLORS[n % CAR_COLORS.length]));
  });
  city.add(bodies, cabins);
  return city;
}

/**
 * Around one office floor (the office scene): sky, the floor's slab with a glass-railed terrace,
 * the tower below down to the street and the city. The office floor stays at y = 0.
 */
export function buildSurroundings(scene: THREE.Scene, { floor, mobile = false }: { floor: number; mobile?: boolean }) {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 320, 1100);
  const street = -floorLevel(floor), group = new THREE.Group();

  // The floor slab runs out past the walls as a terrace with a glass railing (the entrance door opens onto it).
  const slab = new THREE.Mesh(new THREE.BoxGeometry(TOWER.width + 6, 0.45, TOWER.depth + 6), plain("#c9c4ba"));
  slab.position.y = -0.24; slab.receiveShadow = true; group.add(slab);
  const railGlass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.22, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const rails = new Mass(), posts = new Mass();
  const hw = TOWER.width / 2 + 2.9, hd = TOWER.depth / 2 + 2.9;
  rails.box(0, 0, hd, hw * 2, 1.05, 0.04, false); rails.box(0, 0, -hd, hw * 2, 1.05, 0.04, false);
  rails.box(hw, 0, 0, 0.04, 1.05, hd * 2, false); rails.box(-hw, 0, 0, 0.04, 1.05, hd * 2, false);
  posts.box(0, 1.05, hd, hw * 2, 0.06, 0.08); posts.box(0, 1.05, -hd, hw * 2, 0.06, 0.08);
  posts.box(hw, 1.05, 0, 0.08, 0.06, hd * 2); posts.box(-hw, 1.05, 0, 0.08, 0.06, hd * 2);
  group.add(new THREE.Mesh(rails.geometry(), railGlass), mesh(posts, new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.35, metalness: 0.6 })));

  // The tower below, floor after floor down to the lobby.
  const below = new Mass(street + TOWER.lobby);
  below.box(0, street + TOWER.lobby, 0, TOWER.width + 0.4, -street - TOWER.lobby - 0.47, TOWER.depth + 0.4, false);
  group.add(mesh(below, new THREE.MeshStandardMaterial({ map: facadeTexture(TOWER_STYLE, 3), roughness: 0.3, metalness: 0.2 })));
  const lobby = new THREE.Mesh(new THREE.BoxGeometry(TOWER.width + 0.4, TOWER.lobby, TOWER.depth + 0.4), new THREE.MeshStandardMaterial({ color: 0x2c3a46, roughness: 0.2, metalness: 0.4 }));
  lobby.position.y = street + TOWER.lobby / 2; group.add(lobby);
  // The elevator shaft up the front of the tower, from the street to this floor.
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(ELEVATOR.width + 0.4, -street - 0.45, ELEVATOR.depth), SHAFT());
  shaft.position.set(ELEVATOR.x, street / 2 - 0.225, TOWER.depth / 2 + ELEVATOR.depth / 2); shaft.receiveShadow = true; group.add(shaft);

  const city = buildCity({ mobile });
  city.position.y = street; group.add(city);
  scene.add(group);
  return group;
}
