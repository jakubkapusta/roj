// The swarm: steering toward a moving target through personal orbiting offsets,
// collision against the level SDF, and Kuramoto phase coupling for synchronized blinking.

import { clamp, smoothstep, TAU } from '../core/math';
import type { Level } from './level';
import { FlowField } from './flow';
import { BAL } from './balance';

export const MAX_FLIES = 1000;
export const FREE = 0, STUCK = 1, DEAD = 2;

export class Swarm {
  n = 0;
  x = new Float32Array(MAX_FLIES);
  y = new Float32Array(MAX_FLIES);
  vx = new Float32Array(MAX_FLIES);
  vy = new Float32Array(MAX_FLIES);
  ox = new Float32Array(MAX_FLIES); // personal offset (unit disk)
  oy = new Float32Array(MAX_FLIES);
  orb = new Float32Array(MAX_FLIES); // orbit angular speed
  agil = new Float32Array(MAX_FLIES);
  spd = new Float32Array(MAX_FLIES);
  w1 = new Float32Array(MAX_FLIES); // wander params
  w2 = new Float32Array(MAX_FLIES);
  ph = new Float32Array(MAX_FLIES); // blink phase
  om = new Float32Array(MAX_FLIES); // natural frequency
  bright = new Float32Array(MAX_FLIES);
  state = new Uint8Array(MAX_FLIES);
  timer = new Float32Array(MAX_FLIES);
  web = new Int16Array(MAX_FLIES);
  inWeb = new Int16Array(MAX_FLIES);
  hue = new Float32Array(MAX_FLIES);
  formX = new Float32Array(MAX_FLIES);
  /** seconds a fly has been pressing without getting anywhere, and its sideways wiggle */
  stuckT = new Float32Array(MAX_FLIES);
  wig = new Float32Array(MAX_FLIES);
  wigDir = new Float32Array(MAX_FLIES);
  formY = new Float32Array(MAX_FLIES);
  /** Every fly seeks its own formation point (the final constellation). */
  formOn = false;

  // target & aggregates
  tx = 0;
  ty = 0;
  guiding = false;
  cx = 0;
  cy = 0;
  vcx = 0; // centroid velocity
  vcy = 0;
  radius = 60;
  speed = 0; // smoothed centroid speed
  order = 0; // Kuramoto order parameter r (0..1)
  psi = 0; // mean phase
  coupling = 0;
  flashGlow = 0; // extra brightness after a flash
  free = 0;
  flow = new FlowField();
  speedMul = 1;
  couplingMul = 1;
  private flowT = 0;
  private flowTx = 1e9;
  private flowTy = 1e9;
  private fs = { d: 0, x: 0, y: 0 };

  spawn(x: number, y: number, count: number, spreadV = 80) {
    for (let k = 0; k < count && this.n < MAX_FLIES; k++) {
      const i = this.n++;
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random());
      this.x[i] = x + Math.cos(a) * rr * 10;
      this.y[i] = y + Math.sin(a) * rr * 10;
      this.vx[i] = Math.cos(a) * spreadV * Math.random();
      this.vy[i] = Math.sin(a) * spreadV * Math.random();
      const b = Math.random() * TAU, rb = Math.sqrt(Math.random());
      this.ox[i] = Math.cos(b) * rb;
      this.oy[i] = Math.sin(b) * rb;
      this.orb[i] = (Math.random() - 0.5) * 1.2;
      this.agil[i] = 2.6 + Math.random() * 3.4;
      this.spd[i] = BAL.flySpeed[0] + Math.random() * (BAL.flySpeed[1] - BAL.flySpeed[0]);
      this.w1[i] = 0.8 + Math.random() * 2.2;
      this.w2[i] = Math.random() * TAU;
      this.ph[i] = Math.random() * TAU;
      this.om[i] = (TAU / 1.25) * (0.86 + Math.random() * 0.28);
      this.bright[i] = 0.6;
      this.state[i] = FREE;
      this.timer[i] = 0;
      this.web[i] = -1;
      this.inWeb[i] = -1;
      this.hue[i] = Math.random();
      this.stuckT[i] = 0;
      this.wig[i] = 0;
    }
  }

  kill(i: number) {
    this.state[i] = DEAD;
  }

  /** Remove dead flies (swap with last). */
  compact() {
    let i = 0;
    while (i < this.n) {
      if (this.state[i] === DEAD) {
        const j = --this.n;
        if (i !== j) this.copy(j, i);
      } else i++;
    }
  }

  private copy(from: number, to: number) {
    const arrs = [this.x, this.y, this.vx, this.vy, this.ox, this.oy, this.orb, this.agil, this.spd, this.w1, this.w2, this.ph, this.om, this.bright, this.timer, this.hue, this.formX, this.formY, this.stuckT, this.wig, this.wigDir];
    for (const a of arrs) a[to] = a[from];
    this.state[to] = this.state[from];
    this.web[to] = this.web[from];
    this.inWeb[to] = this.inWeb[from];
  }

  scatterPhases() {
    for (let i = 0; i < this.n; i++) this.ph[i] = Math.random() * TAU;
  }

  update(dt: number, t: number, level: Level | null) {
    const n = this.n;
    // aggregates from last frame
    let sx = 0, sy = 0, cnt = 0, sc = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      if (this.state[i] !== FREE) continue;
      sx += this.x[i];
      sy += this.y[i];
      sc += Math.cos(this.ph[i]);
      ss += Math.sin(this.ph[i]);
      cnt++;
    }
    this.free = cnt;
    if (cnt > 0) {
      const ncx = sx / cnt, ncy = sy / cnt;
      const ivx = (ncx - this.cx) / Math.max(dt, 1e-3), ivy = (ncy - this.cy) / Math.max(dt, 1e-3);
      const k = 1 - Math.exp(-dt * 6);
      this.vcx += (clamp(ivx, -800, 800) - this.vcx) * k;
      this.vcy += (clamp(ivy, -800, 800) - this.vcy) * k;
      this.cx = ncx;
      this.cy = ncy;
      this.order = Math.hypot(sc, ss) / cnt;
      this.psi = Math.atan2(ss, sc);
    } else {
      this.order = 0;
    }
    const sp = Math.hypot(this.vcx, this.vcy);
    this.speed += (sp - this.speed) * (1 - Math.exp(-dt * 3));

    // calm swarm couples strongly -> synchronized pulses
    const calm = smoothstep(140, 35, this.speed);
    this.coupling = (0.2 + calm * 3.2) * this.couplingMul;
    const K = this.coupling;
    const R = this.order, PSI = this.psi;

    const baseR = 6 * Math.sqrt(Math.max(cnt, 25));
    const spread = this.guiding ? 0.85 : 1.3;
    this.radius += (baseR * spread - this.radius) * (1 - Math.exp(-dt * 2));
    const rad = this.radius;
    const tx = this.tx, ty = this.ty;
    this.flashGlow = Math.max(0, this.flashGlow - dt * 2.2);
    this.flowT -= dt;
    if (level && (this.flowT <= 0 || Math.hypot(tx - this.flowTx, ty - this.flowTy) > 14)) {
      this.flow.build(level, tx, ty, this.cx, this.cy);
      this.flowT = 0.07;
      this.flowTx = tx;
      this.flowTy = ty;
    }
    const fs = this.fs;

    for (let i = 0; i < n; i++) {
      // blink phase
      this.ph[i] += (this.om[i] + K * R * Math.sin(PSI - this.ph[i])) * dt;
      if (this.ph[i] > TAU) this.ph[i] -= TAU;
      const c = Math.cos(this.ph[i]);
      const pulse = c > 0 ? c * c * c * c * c * c : 0;
      const st = this.state[i];
      if (st === STUCK) {
        this.timer[i] += dt;
        this.bright[i] = (0.5 + 0.5 * Math.sin(t * 25 + i)) * Math.max(0, 1 - this.timer[i] / 5) * 0.8;
        // struggle
        this.x[i] += (Math.random() - 0.5) * 1.2;
        this.y[i] += (Math.random() - 0.5) * 1.2;
        continue;
      }
      if (st !== FREE) continue;
      this.bright[i] = 0.42 + 0.95 * pulse + this.flashGlow;

      // orbiting personal offset
      const oa = this.orb[i] * dt;
      const ca = Math.cos(oa), sa = Math.sin(oa);
      const ox = this.ox[i] * ca - this.oy[i] * sa;
      const oy = this.ox[i] * sa + this.oy[i] * ca;
      this.ox[i] = ox;
      this.oy[i] = oy;
      let gx = tx + ox * rad, gy = ty + oy * rad;
      if (this.formOn) {
        gx = this.formX[i];
        gy = this.formY[i];
      }

      let dx: number, dy: number;
      if (!this.formOn && level && this.flow.sample(this.x[i], this.y[i], fs) && fs.d > rad * 0.9 + 24) {
        // far from the target: follow the flow around obstacles
        const want = Math.min(this.spd[i] * this.speedMul, fs.d * 3.6);
        // keep a loose slot around the swarm center so the stream stays a swarm
        // (only near the center: a split swarm must not be pulled into the empty middle)
        let sx = this.cx + ox * rad - this.x[i], sy = this.cy + oy * rad - this.y[i];
        const sl = Math.hypot(sx, sy);
        const sk = sl > rad * 2.5 ? 0 : 1.1;
        if (sl > 80) { sx *= 80 / sl; sy *= 80 / sl; }
        dx = fs.x * want + sx * sk;
        dy = fs.y * want + sy * sk;
        // pressed against something for a while: wiggle sideways like an insect feeling its way
        if (this.wig[i] > 0) {
          this.wig[i] -= dt;
          const wd = this.wigDir[i];
          dx = dx * 0.3 - fs.y * wd * 190;
          dy = dy * 0.3 + fs.x * wd * 190;
        }
      } else {
        dx = gx - this.x[i];
        dy = gy - this.y[i];
        const dist = Math.hypot(dx, dy) + 1e-4;
        const want = Math.min(this.spd[i] * this.speedMul, dist * 3.6);
        dx = (dx / dist) * want;
        dy = (dy / dist) * want;
      }
      const ag = this.agil[i];
      const w = this.w1[i], p = this.w2[i];
      const wx = Math.sin(t * w + p) * 38 + Math.sin(t * 2.7 * w + p * 3) * 14;
      const wy = Math.cos(t * w * 0.9 + p * 1.7) * 38 + Math.cos(t * 3.1 * w + p) * 14;
      this.vx[i] += ((dx + wx) - this.vx[i]) * ag * dt;
      this.vy[i] += ((dy + wy) - this.vy[i]) * ag * dt;
      let nx = this.x[i] + this.vx[i] * dt;
      let ny = this.y[i] + this.vy[i] * dt;

      if (level) {
        const d = level.sdfAt(nx, ny);
        const M = 4;
        if (d < M) {
          const e = 2;
          const gxs = level.sdfAt(nx + e, ny) - level.sdfAt(nx - e, ny);
          const gys = level.sdfAt(nx, ny + e) - level.sdfAt(nx, ny - e);
          const gl = Math.hypot(gxs, gys) || 1;
          const ux = gxs / gl, uy = gys / gl;
          const push = Math.min(M - d, 30);
          nx += ux * push;
          ny += uy * push;
          const vn = this.vx[i] * ux + this.vy[i] * uy;
          if (vn < 0) {
            this.vx[i] -= ux * vn * 1.2;
            this.vy[i] -= uy * vn * 1.2;
          }
          this.vx[i] *= 0.96;
          this.vy[i] *= 0.96;
        }
      }
      // progress check for the wiggle
      const moved = Math.hypot(nx - this.x[i], ny - this.y[i]) / Math.max(dt, 1e-3);
      if (moved < 30 && Math.hypot(tx - nx, ty - ny) > rad + 40) {
        this.stuckT[i] += dt;
        if (this.stuckT[i] > 0.45 && this.wig[i] <= 0) {
          this.wig[i] = 0.5 + Math.random() * 0.5;
          this.wigDir[i] = Math.random() < 0.5 ? -1 : 1;
          this.stuckT[i] = 0;
        }
      } else this.stuckT[i] = Math.max(0, this.stuckT[i] - dt * 2);
      this.x[i] = nx;
      this.y[i] = ny;
    }
  }
}
