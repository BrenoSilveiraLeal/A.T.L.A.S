/**
 * Walkable floor of the 3D office (owner, 27/10/2026: the agents walked through furniture, and the
 * boss in first person needs collision). Furniture and walls are rectangles on the floor plan
 * (x1, z1, x2, z2); the grid marks cells too close to them as blocked. `path` finds a route with
 * A* and straightens it where the way is clear; `blocks` answers whether a body of radius `r`
 * fits at a point (first-person collision). Pure, no three.js.
 */
export type V2 = [number, number];
export type Rect = readonly [number, number, number, number];

export class NavGrid {
  private readonly nx: number;
  private readonly nz: number;
  private readonly solid: Uint8Array;

  constructor(
    private readonly bounds: Rect,
    private readonly rects: readonly Rect[],
    private readonly cell = 0.4,
    private readonly pad = 0.32,
  ) {
    this.nx = Math.ceil((bounds[2] - bounds[0]) / cell);
    this.nz = Math.ceil((bounds[3] - bounds[1]) / cell);
    this.solid = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const [x, z] = this.center(i, j);
      this.solid[i + j * this.nx] = this.blocks(x, z, pad) ? 1 : 0;
    }
  }

  /** A body of radius `r` at (x, z) would touch a wall or a piece of furniture. */
  blocks(x: number, z: number, r: number) {
    const [bx1, bz1, bx2, bz2] = this.bounds;
    if (x - r < bx1 || x + r > bx2 || z - r < bz1 || z + r > bz2) return true;
    return this.rects.some(([x1, z1, x2, z2]) => {
      const dx = Math.max(x1 - x, 0, x - x2), dz = Math.max(z1 - z, 0, z - z2);
      return dx * dx + dz * dz < r * r;
    });
  }

  private center(i: number, j: number): V2 { return [this.bounds[0] + (i + 0.5) * this.cell, this.bounds[1] + (j + 0.5) * this.cell]; }
  private cellOf(x: number, z: number): [number, number] {
    return [Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.bounds[0]) / this.cell))),
      Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.bounds[1]) / this.cell)))];
  }
  private free(i: number, j: number) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz && !this.solid[i + j * this.nx]; }

  /** Nearest walkable cell (a seat inside a sofa, a chair at a desk). */
  private nearestFree(i: number, j: number): [number, number] | null {
    if (this.free(i, j)) return [i, j];
    for (let ring = 1; ring < 12; ring++)
      for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++)
        if (Math.max(Math.abs(di), Math.abs(dj)) === ring && this.free(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }

  /** Straight line between two points stays on walkable cells. */
  clear(a: V2, b: V2) {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.cell / 2));
    for (let s = 0; s <= steps; s++) {
      const [i, j] = this.cellOf(a[0] + ((b[0] - a[0]) * s) / Math.max(1, steps), a[1] + ((b[1] - a[1]) * s) / Math.max(1, steps));
      if (!this.free(i, j)) return false;
    }
    return true;
  }

  /** Waypoints from `from` to `to` around the furniture, or null when there is no way. */
  path(from: V2, to: V2): V2[] | null {
    const start = this.nearestFree(...this.cellOf(...from)), goal = this.nearestFree(...this.cellOf(...to));
    if (!start || !goal) return null;
    const key = (i: number, j: number) => i + j * this.nx;
    const g = new Float32Array(this.nx * this.nz).fill(Infinity), came = new Int32Array(this.nx * this.nz).fill(-1);
    const heap: [number, number][] = [];
    const push = (f: number, k: number) => {
      heap.push([f, k]);
      for (let c = heap.length - 1; c > 0;) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let c = 0; ;) {
          const l = c * 2 + 1, r = l + 1; let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m;
        }
      }
      return top;
    };
    const h = (i: number, j: number) => Math.hypot(i - goal[0], j - goal[1]);
    g[key(...start)] = 0; push(h(...start), key(...start));
    const goalKey = key(...goal);
    while (heap.length) {
      const [, k] = pop();
      if (k === goalKey) break;
      const i = k % this.nx, j = Math.floor(k / this.nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (!this.free(ni, nj) || (di && dj && (!this.free(i + di, j) || !this.free(i, j + dj)))) continue;
        const cost = g[k] + (di && dj ? Math.SQRT2 : 1), nk = key(ni, nj);
        if (cost < g[nk]) { g[nk] = cost; came[nk] = k; push(cost + h(ni, nj), nk); }
      }
    }
    if (came[goalKey] === -1 && goalKey !== key(...start)) return null;
    const cells: V2[] = [];
    for (let k = goalKey; k !== -1; k = came[k]) cells.unshift(this.center(k % this.nx, Math.floor(k / this.nx)));
    // Straighten: from each point jump to the farthest point still in clear sight.
    const out: V2[] = [];
    let at: V2 = from;
    for (let a = 0; a < cells.length;) {
      let b = cells.length - 1;
      while (b > a && !this.clear(at, cells[b])) b--;
      at = cells[b]; out.push(at); a = b + 1;
    }
    out.push(to);
    return out;
  }
}
