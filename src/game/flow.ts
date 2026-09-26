// Flow field toward the swarm target: Dijkstra over a coarse grid around the swarm,
// so flies stream around branches and pour through gaps instead of pressing into walls.

import type { Level } from './level';

const CELL = 16;
const COLS = 44;
const ROWS = 72;
const N = COLS * ROWS;
const INF = 1e9;

export class FlowField {
  x0 = -(COLS * CELL) / 2;
  y0 = 0;
  dist = new Float32Array(N);
  blocked = new Uint8Array(N);
  dx = new Float32Array(N);
  dy = new Float32Array(N);
  valid = false;
  private level: Level | null = null;
  private heapI = new Int32Array(N * 8);
  private heapD = new Float32Array(N * 8);
  private hn = 0;

  build(level: Level, tx: number, ty: number, sx: number, sy: number) {
    const cy = sy;
    this.level = level;
    this.y0 = Math.floor((cy - 520) / CELL) * CELL;
    const { x0, y0, dist, blocked } = this;
    for (let r = 0; r < ROWS; r++) {
      const y = y0 + (r + 0.5) * CELL;
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        blocked[i] = level.sdfAt(x0 + (c + 0.5) * CELL, y) < 3 ? 1 : 0;
        dist[i] = INF;
      }
    }
    // a target inside a solid: walk back toward the swarm to the first free spot,
    // so we never pick a cell on the far side of a thin obstacle
    if (level.sdfAt(tx, ty) < 5) {
      const dx = sx - tx, dy = sy - ty, l = Math.hypot(dx, dy) || 1;
      for (let d = 8; d < l; d += 8) {
        const px = tx + (dx / l) * d, py = ty + (dy / l) * d;
        if (level.sdfAt(px, py) >= 6) { tx = px; ty = py; break; }
      }
    }
    let sc = Math.floor((tx - x0) / CELL), sr = Math.floor((ty - y0) / CELL);
    if (sc < 0 || sc >= COLS || sr < 0 || sr >= ROWS) { this.valid = false; return; }
    if (blocked[sr * COLS + sc]) {
      let best = -1, bd = INF;
      for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
        const r = sr + dr, c = sc + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS || blocked[r * COLS + c]) continue;
        // prefer cells toward the swarm
        const wx = x0 + (c + 0.5) * CELL, wy = y0 + (r + 0.5) * CELL;
        const d = dr * dr + dc * dc + Math.hypot(wx - sx, wy - sy) * 0.02;
        if (d < bd) { bd = d; best = r * COLS + c; }
      }
      if (best < 0) { this.valid = false; return; }
      sr = Math.floor(best / COLS);
      sc = best % COLS;
    }
    const s = sr * COLS + sc;
    dist[s] = 0;
    this.hn = 0;
    this.push(s, 0);
    while (this.hn > 0) {
      const [i, d] = this.pop();
      if (d > dist[i]) continue;
      const r = (i / COLS) | 0, c = i - r * COLS;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= ROWS) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const cc = c + dc;
          if (cc < 0 || cc >= COLS) continue;
          const j = rr * COLS + cc;
          if (blocked[j]) continue;
          if (dr && dc && (blocked[r * COLS + cc] || blocked[rr * COLS + c])) continue; // no corner cutting
          // thin obstacles (reeds, twigs) can sit between two free cell centers
          const mx = x0 + (c + 0.5 + dc * 0.5) * CELL, my = y0 + (r + 0.5 + dr * 0.5) * CELL;
          if (level.sdfAt(mx, my) < 1.5) continue;
          if (dr && dc && (level.sdfAt(mx - dc * 4, my - dr * 4) < 1.5 || level.sdfAt(mx + dc * 4, my + dr * 4) < 1.5)) continue;
          const nd = d + (dr && dc ? 1.4142 : 1);
          if (nd < dist[j]) {
            dist[j] = nd;
            this.push(j, nd);
          }
        }
      }
    }
    // direction = toward the lowest neighbour
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        this.dx[i] = 0;
        this.dy[i] = 0;
        if (blocked[i] || dist[i] >= INF) continue;
        let bd = dist[i], bx = 0, by = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= ROWS) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= COLS || (!dr && !dc)) continue;
            const j = rr * COLS + cc;
            if (blocked[j]) continue;
            if (dist[j] < bd) { bd = dist[j]; bx = dc; by = dr; }
          }
        }
        const l = Math.hypot(bx, by) || 1;
        this.dx[i] = bx / l;
        this.dy[i] = by / l;
      }
    }
    this.valid = true;
  }

  /** Path length (world units) and flow direction at a point; null when unknown. */
  sample(x: number, y: number, out: { d: number; x: number; y: number }) {
    if (!this.valid) return false;
    const fx = (x - this.x0) / CELL - 0.5, fy = (y - this.y0) / CELL - 0.5;
    const c = Math.floor(fx), r = Math.floor(fy);
    if (c < 0 || c >= COLS - 1 || r < 0 || r >= ROWS - 1) return false;
    const tx = fx - c, ty = fy - r;
    let wx = 0, wy = 0, wd = 0, ws = 0;
    for (let k = 0; k < 4; k++) {
      const cc = c + (k & 1), rr = r + (k >> 1);
      const i = rr * COLS + cc;
      if (this.blocked[i] || this.dist[i] >= INF) continue;
      // skip cells on the other side of a thin obstacle
      const wx0 = this.x0 + (cc + 0.5) * CELL, wy0 = this.y0 + (rr + 0.5) * CELL;
      if (this.level!.sdfAt((x + wx0) / 2, (y + wy0) / 2) < 1) continue;
      const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty) + 1e-4;
      wx += this.dx[i] * w;
      wy += this.dy[i] * w;
      wd += this.dist[i] * w;
      ws += w;
    }
    if (ws <= 1e-3) {
      // squeezed against a solid: head for the best free cell nearby
      let bi = -1, bd = INF;
      const cc0 = Math.round(fx), rr0 = Math.round(fy);
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const r2 = rr0 + dr, c2 = cc0 + dc;
        if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) continue;
        const i = r2 * COLS + c2;
        if (this.blocked[i] || this.dist[i] >= INF) continue;
        // only cells we can actually reach in a straight line (no hopping over a reed)
        const wx = this.x0 + (c2 + 0.5) * CELL, wy = this.y0 + (r2 + 0.5) * CELL;
        let clear = true;
        for (let q = 0.25; q < 1 && clear; q += 0.25) if (this.level!.sdfAt(x + (wx - x) * q, y + (wy - y) * q) < 1) clear = false;
        if (!clear) continue;
        const d = this.dist[i] + Math.hypot(dr, dc);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi < 0) return false;
      const wx = this.x0 + ((bi % COLS) + 0.5) * CELL, wy = this.y0 + (Math.floor(bi / COLS) + 0.5) * CELL;
      const l = Math.hypot(wx - x, wy - y) || 1;
      out.d = bd * CELL;
      out.x = (wx - x) / l;
      out.y = (wy - y) / l;
      return true;
    }
    const l = Math.hypot(wx, wy);
    out.d = (wd / ws) * CELL;
    out.x = l > 1e-4 ? wx / l : 0;
    out.y = l > 1e-4 ? wy / l : 0;
    return true;
  }

  private push(i: number, d: number) {
    let k = this.hn++;
    const H = this.heapI, D = this.heapD;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (D[p] <= d) break;
      H[k] = H[p];
      D[k] = D[p];
      k = p;
    }
    H[k] = i;
    D[k] = d;
  }

  private pop(): [number, number] {
    const H = this.heapI, D = this.heapD;
    const ri = H[0], rd = D[0];
    const li = H[--this.hn], ld = D[this.hn];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.hn) break;
      if (c + 1 < this.hn && D[c + 1] < D[c]) c++;
      if (D[c] >= ld) break;
      H[k] = H[c];
      D[k] = D[c];
      k = c;
    }
    H[k] = li;
    D[k] = ld;
    return [ri, rd];
  }
}
