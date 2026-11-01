import * as THREE from "three";
import { TOWER } from "@/core/building";

/**
 * The city around the ATLAS tower (the tower itself is in tower.ts), shared by the building view and
 * the office scene (owner, 01/11/2026: the office now sits on a floor of a tower in a city; the city
 * must be the same seen from the street and from the office windows). Made of plain geometry merged
 * into a handful of meshes, with façades drawn on canvas: no downloaded models or textures.
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
    const pane = g.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
    pane.addColorStop(0, "#d9f1ff"); pane.addColorStop(0.45, "#8cc8ee"); pane.addColorStop(1, "#5aa2d6");
    g.fillStyle = pane; g.fillRect(wx, wy, ww, wh);
    const roll = random();
    if (roll < 0.22) { g.fillStyle = "#ffe9b8"; g.fillRect(wx, wy, ww, wh); }
    else if (roll < 0.4) { g.fillStyle = CURTAINS[Math.floor(random() * CURTAINS.length)]; g.fillRect(wx, wy, ww * 0.28, wh); g.fillRect(wx + ww * 0.72, wy, ww * 0.28, wh); }
    // At night about half the rooms have the light on.
    if (roll < 0.5) { n.fillStyle = roll < 0.22 ? "#ffd98a" : "#f5c46a"; n.fillRect(wx, wy, ww, wh); }
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
  facades.forEach((mass, n) => { if (!mass.empty) city.add(mesh(mass, facadeMaterial(STREET_STYLES[n], seed + n))); });

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
  const hillSpots = mobile ? 16 : 28;
  const hills = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 12), plain("#8cc673", 1), hillSpots);
  for (let n = 0; n < hillSpots; n++) {
    const angle = (n / hillSpots) * Math.PI * 2 + random() * 0.2, r = 560 + random() * 260, w = 90 + random() * 90;
    dummy.position.set(Math.cos(angle) * r, -12, Math.sin(angle) * r); dummy.rotation.set(0, random() * Math.PI, 0);
    dummy.scale.set(w, 30 + random() * 50, w * (0.6 + random() * 0.5)); dummy.updateMatrix(); hills.setMatrixAt(n, dummy.matrix);
    hills.setColorAt(n, tone.setHSL(0.27 + random() * 0.06, 0.38, 0.5 + random() * 0.08));
  }
  city.add(hills);

  // Toy-like cars driving on their side of the street, with headlights that glow at night.
  const CAR_COLORS = [0xf25f5c, 0x2f80ed, 0xf2c94c, 0x27ae60, 0xffffff, 0x9b51e0, 0x56ccf2, 0xf2994a];
  const traffic = cars.map(([x, z, turn]) => {
    const alongZ = turn === 0, across = alongZ ? x : z, line = Math.round(across / PITCH - 0.5) * PITCH + PITCH / 2;
    return { x, z, alongZ, dir: across - line > 0 ? 1 : -1, speed: 7 + random() * 6 };
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
  /** Moves the cars; the caller runs it every frame (they wrap around at the edge of the city). */
  city.userData.update = (dt: number) => {
    for (const c of traffic) {
      if (c.alongZ) { c.z += c.dir * c.speed * dt; if (c.z > span) c.z -= span * 2; if (c.z < -span) c.z += span * 2; }
      else { c.x += c.dir * c.speed * dt; if (c.x > span) c.x -= span * 2; if (c.x < -span) c.x += span * 2; }
    }
    place();
    bodies.instanceMatrix.needsUpdate = cabins.instanceMatrix.needsUpdate = beams.instanceMatrix.needsUpdate = true;
  };
  return city;
}
