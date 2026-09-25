// Silhouette geometry. Every vertex carries a pseudo-normal and an "edge" factor
// (0 = spine/inside, 1 = outline) so the shader can shade flat shapes as if they
// were rounded and catch rim light from the swarm.
//
// Vertex layout (7 floats): x, y, nx, ny, edge, sway, tone

export const SIL_STRIDE = 7;

export type P = { x: number; y: number; r: number };

export class MeshBuilder {
  data: Float32Array;
  n = 0;
  constructor(initial = 8192) {
    this.data = new Float32Array(initial);
  }
  reset() { this.n = 0; }
  get vertexCount() { return this.n / SIL_STRIDE; }

  private grow(extra: number) {
    if (this.n + extra <= this.data.length) return;
    let len = this.data.length;
    while (len < this.n + extra) len *= 2;
    const d = new Float32Array(len);
    d.set(this.data.subarray(0, this.n));
    this.data = d;
  }

  v(x: number, y: number, nx: number, ny: number, edge: number, sway: number, tone: number) {
    this.grow(SIL_STRIDE);
    const d = this.data;
    let i = this.n;
    d[i++] = x; d[i++] = y; d[i++] = nx; d[i++] = ny; d[i++] = edge; d[i++] = sway; d[i++] = tone;
    this.n = i;
  }

  /**
   * Tapered tube along a polyline. `sway` may be a number or per-point array (0 at root).
   */
  tube(pts: P[], sway: number | number[] = 0, tone = 1) {
    const n = pts.length;
    if (n < 2) return;
    const L: number[] = [], R: number[] = [], N: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const p = pts[i];
      L.push(p.x + nx * p.r, p.y + ny * p.r);
      R.push(p.x - nx * p.r, p.y - ny * p.r);
      N.push(nx, ny);
    }
    const sw = (i: number) => (typeof sway === 'number' ? sway * (i / (n - 1)) : sway[i]);
    for (let i = 0; i < n - 1; i++) {
      const j = i + 1;
      const p = pts[i], q = pts[j];
      const si = sw(i), sj = sw(j);
      // left half: L_i, C_i, L_j / C_i, C_j, L_j
      this.v(L[i * 2], L[i * 2 + 1], N[i * 2], N[i * 2 + 1], 1, si, tone);
      this.v(p.x, p.y, 0, 0, 0, si, tone);
      this.v(L[j * 2], L[j * 2 + 1], N[j * 2], N[j * 2 + 1], 1, sj, tone);
      this.v(p.x, p.y, 0, 0, 0, si, tone);
      this.v(q.x, q.y, 0, 0, 0, sj, tone);
      this.v(L[j * 2], L[j * 2 + 1], N[j * 2], N[j * 2 + 1], 1, sj, tone);
      // right half
      this.v(p.x, p.y, 0, 0, 0, si, tone);
      this.v(R[i * 2], R[i * 2 + 1], -N[i * 2], -N[i * 2 + 1], 1, si, tone);
      this.v(R[j * 2], R[j * 2 + 1], -N[j * 2], -N[j * 2 + 1], 1, sj, tone);
      this.v(p.x, p.y, 0, 0, 0, si, tone);
      this.v(R[j * 2], R[j * 2 + 1], -N[j * 2], -N[j * 2 + 1], 1, sj, tone);
      this.v(q.x, q.y, 0, 0, 0, sj, tone);
    }
    // round cap at the start if it's thick
    const s = pts[0];
    if (s.r > 3) this.cap(s.x, s.y, s.r, Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x), sw(0), tone);
  }

  private cap(cx: number, cy: number, r: number, dir: number, sway: number, tone: number) {
    const seg = 6;
    for (let k = 0; k < seg; k++) {
      const a0 = dir - Math.PI / 2 + (Math.PI * k) / seg;
      const a1 = dir - Math.PI / 2 + (Math.PI * (k + 1)) / seg;
      this.v(cx, cy, 0, 0, 0, sway, tone);
      this.v(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, Math.cos(a0), Math.sin(a0), 1, sway, tone);
      this.v(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, Math.cos(a1), Math.sin(a1), 1, sway, tone);
    }
  }

  /** Closed shape as a fan from its center. `radius(a)` gives the outline. */
  blob(cx: number, cy: number, radius: (a: number) => number, seg = 28, sway = 0, tone = 1, squashY = 1) {
    const px: number[] = [], py: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const r = radius(a);
      px.push(cx + Math.cos(a) * r);
      py.push(cy + Math.sin(a) * r * squashY);
    }
    for (let k = 0; k < seg; k++) {
      const n0 = this.outNormal(px, py, k, seg), n1 = this.outNormal(px, py, k + 1, seg);
      this.v(cx, cy, 0, 0, 0, sway, tone);
      this.v(px[k], py[k], n0[0], n0[1], 1, sway, tone);
      this.v(px[k + 1], py[k + 1], n1[0], n1[1], 1, sway, tone);
    }
  }

  private outNormal(px: number[], py: number[], k: number, seg: number): [number, number] {
    const a = (k - 1 + seg) % seg, b = (k + 1) % seg;
    const tx = px[b] - px[a], ty = py[b] - py[a];
    const l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l];
  }

  /** Mushroom cap: dome from x0..x1 at base y, height h (can be negative for hanging). */
  dome(cx: number, cy: number, w: number, h: number, tone = 1, sway = 0) {
    const seg = 16;
    const pts: [number, number][] = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const a = Math.PI * (1 - t);
      pts.push([cx + Math.cos(a) * w, cy + Math.sin(a) * h * (0.9 + 0.1 * Math.sin(t * 9))]);
    }
    // underside slightly curved
    const bx0 = cx - w, bx1 = cx + w;
    const ccx = cx, ccy = cy + h * 0.25;
    for (let k = 0; k < seg; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
      const n0x = x0 - cx, n0y = (y0 - cy) * 1.4, l0 = Math.hypot(n0x, n0y) || 1;
      const n1x = x1 - cx, n1y = (y1 - cy) * 1.4, l1 = Math.hypot(n1x, n1y) || 1;
      this.v(ccx, ccy, 0, 0, 0, sway, tone);
      this.v(x0, y0, n0x / l0, n0y / l0, 1, sway, tone);
      this.v(x1, y1, n1x / l1, n1y / l1, 1, sway, tone);
    }
    const sgn = Math.sign(h) || 1;
    this.v(ccx, ccy, 0, 0, 0, sway, tone);
    this.v(bx1, cy, 0, -sgn, 1, sway, tone);
    this.v(bx0, cy, 0, -sgn, 1, sway, tone);
  }

  /** Leaf: tube with lens-shaped profile along a gently curved spine. */
  leaf(x: number, y: number, ang: number, len: number, width: number, curl: number, sway: number, tone = 1) {
    const pts: P[] = [];
    const seg = 7;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const a = ang + curl * t;
      const d = len * t;
      pts.push({
        x: x + Math.cos(ang) * d + Math.cos(a + Math.PI / 2) * curl * d * 0.15,
        y: y + Math.sin(ang) * d + Math.sin(a + Math.PI / 2) * curl * d * 0.15,
        r: Math.max(0.4, Math.sin(Math.PI * Math.pow(t, 0.8)) * width),
      });
    }
    const sw = pts.map((_, k) => sway * (k / seg));
    this.tube(pts, sw, tone);
  }

  /** Spine of a broad leaf: straight out, drooping at the tip. */
  static broadSpine(x: number, y: number, ang: number, len: number, w: number, droop: number) {
    const pts: P[] = [];
    const seg = 10;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      pts.push({
        x: x + dx * len * t,
        y: y + dy * len * t - droop * len * t * t,
        r: Math.max(0.6, w * Math.sin(Math.PI * Math.pow(t, 0.62)) * (1 - 0.25 * t)),
      });
    }
    return pts;
  }

  /** Broad leaf with a lighter midrib. */
  broadLeaf(x: number, y: number, ang: number, len: number, w: number, droop: number, tone = 1) {
    const pts = MeshBuilder.broadSpine(x, y, ang, len, w, droop);
    this.tube(pts, pts.map((_, k) => (k / pts.length) * 0.25), tone);
    this.tube(pts.map((p, k) => ({ x: p.x, y: p.y + 0.5, r: 1.1 * (1 - k / pts.length) + 0.3 })), pts.map((_, k) => (k / pts.length) * 0.25), tone * 1.9);
  }

  /** Blade of grass / thin tendril, curving by `bend`. */
  blade(x: number, y: number, ang: number, len: number, w: number, bend: number, sway: number, tone = 1) {
    const pts: P[] = [];
    const seg = 6;
    let a = ang, px = x, py = y;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      pts.push({ x: px, y: py, r: Math.max(0.3, w * (1 - t)) });
      a += bend / seg;
      px += Math.cos(a) * (len / seg);
      py += Math.sin(a) * (len / seg);
    }
    this.tube(pts, pts.map((_, k) => sway * Math.pow(k / seg, 1.5)), tone);
  }

  /**
   * Wall band: border (edge 1, lit rim facing the playfield) -> spine (edge 0) -> outer rim.
   * `outward` is -1 for the left wall, +1 for the right one.
   */
  wall(border: { x: number; y: number; thick: number }[], outward: number, tone = 1) {
    const col = (i: number) => {
      const a = border[Math.max(0, i - 1)], b = border[Math.min(border.length - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
      let nx = -ty / l, ny = tx / l;
      if (nx * -outward < 0) { nx = -nx; ny = -ny; }
      const p = border[i];
      return {
        bx: p.x, by: p.y, nx, ny,
        sx: p.x + outward * p.thick * 0.35, sy: p.y,
        ox: p.x + outward * p.thick, oy: p.y,
      };
    };
    for (let i = 0; i < border.length - 1; i++) {
      const a = col(i), b = col(i + 1);
      this.v(a.bx, a.by, a.nx, a.ny, 1, 0, tone);
      this.v(a.sx, a.sy, 0, 0, 0, 0, tone);
      this.v(b.bx, b.by, b.nx, b.ny, 1, 0, tone);
      this.v(a.sx, a.sy, 0, 0, 0, 0, tone);
      this.v(b.sx, b.sy, 0, 0, 0, 0, tone);
      this.v(b.bx, b.by, b.nx, b.ny, 1, 0, tone);
      this.v(a.sx, a.sy, 0, 0, 0, 0, tone);
      this.v(a.ox, a.oy, -a.nx, a.ny, 1, 0, tone);
      this.v(b.sx, b.sy, 0, 0, 0, 0, tone);
      this.v(a.ox, a.oy, -a.nx, a.ny, 1, 0, tone);
      this.v(b.ox, b.oy, -b.nx, b.ny, 1, 0, tone);
      this.v(b.sx, b.sy, 0, 0, 0, 0, tone);
    }
  }

  /** Arbitrary polygon as a fan from (cx, cy). Outline points in order. */
  poly(cx: number, cy: number, xs: number[], ys: number[], sway = 0, tone = 1) {
    const n = xs.length;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const n0 = this.outNormal(xs, ys, k, n), n1 = this.outNormal(xs, ys, j, n);
      this.v(cx, cy, 0, 0, 0, sway, tone);
      this.v(xs[k], ys[k], n0[0], n0[1], 1, sway, tone);
      this.v(xs[j], ys[j], n1[0], n1[1], 1, sway, tone);
    }
  }
}
