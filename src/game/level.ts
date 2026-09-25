// Biome level container: walls, silhouette shapes, entities and the baked collision SDF.
// The pieces themselves are built by the biome generators in ./gen.

import { makeRng, type Rng } from '../core/rng';
import { fbm1 } from '../core/noise';
import { clamp, distToSegment } from '../core/math';
import { MeshBuilder, type P } from '../render/mesh';
import type { BiomeDef } from './biomes';
import { GENERATORS } from './gen';

export const HALF_W = 300;
export const CHUNK = 1000;
const CELL = 8;

export type Shape =
  | { k: 'tube'; pts: P[]; sway: number; tone: number }
  | { k: 'blob'; x: number; y: number; r: number; seed: number; tone: number; squash: number }
  | { k: 'dome'; x: number; y: number; w: number; h: number; tone: number }
  | { k: 'leaf'; x: number; y: number; ang: number; len: number; w: number; curl: number; sway: number; tone: number }
  | { k: 'blade'; x: number; y: number; ang: number; len: number; w: number; bend: number; sway: number; tone: number }
  | { k: 'broad'; x: number; y: number; ang: number; len: number; w: number; droop: number; tone: number };

type Capsule = { ax: number; ay: number; bx: number; by: number; ra: number; rb: number };
type Circle = { x: number; y: number; r: number; sy: number };

export type Larva = { x: number; y: number; n: number; awake: boolean; t: number };
export type Lantern = { x: number; y: number; ax: number; ay: number; len: number; ang: number; av: number; charge: number; lit: boolean; t: number; star: boolean };
export type Web = {
  x: number; y: number; r: number; spokes: number[]; rings: number;
  anchors: [number, number][];
  caught: number; cap: number; broken: boolean; burn: number; shake: number;
};
export type Glow = { x: number; y: number; r: number; col: [number, number, number]; phase: number };
export type ZoneKind = 'bats' | 'dragonflies' | 'moths';
export type Zone = { kind: ZoneKind; y0: number; y1: number; interval: number; timer: number };
export type Hint = { y: number; id: string };
/** state: 0 idle, 1 aiming, 2 tongue out, 3 retracting, 4 stunned */
export type Frog = { x: number; y: number; face: number; state: number; t: number; tx: number; ty: number; cool: number; eaten: number; blink: number };
/** state: 0 asleep, 1 eyes open (warning), 2 swooping, 3 gone, 4 blinded */
export type Owl = { x: number; y: number; side: number; state: number; t: number; px: number; py: number; vx: number; vy: number; bites: number };
export type Gust = { y0: number; y1: number; dir: number; strength: number; period: number; phase: number };
export type Pad = { x: number; y: number; w: number };

export class Level {
  readonly height: number;
  readonly rng: Rng;
  readonly seed: number;
  shapes: Shape[][] = []; // by chunk
  private caps: Capsule[] = [];
  private circles: Circle[] = [];
  larvae: Larva[] = [];
  lanterns: Lantern[] = [];
  webs: Web[] = [];
  glows: Glow[] = [];
  zones: Zone[] = [];
  frogs: Frog[] = [];
  owls: Owl[] = [];
  gusts: Gust[] = [];
  pads: Pad[] = [];
  /** tips of big leaves: rain drips from them */
  leafTips: P[] = [];
  hints: Hint[] = [];
  /** y where the level's water surface is (Staw), or null */
  water: number | null = null;
  // wall border x sampled every WS units
  readonly WS = 16;
  wallL: Float32Array;
  wallR: Float32Array;
  // SDF grid
  cols: number;
  rows: number;
  sdf: Float32Array;

  constructor(seed: number, readonly biome: BiomeDef) {
    const height = biome.height;
    this.seed = seed;
    this.height = height;
    this.rng = makeRng(seed);
    const amp = biome.wallStyle === 'clouds' ? 1.8 : 1;
    const nw = Math.ceil((height + 2000) / this.WS) + 2;
    this.wallL = new Float32Array(nw);
    this.wallR = new Float32Array(nw);
    for (let i = 0; i < nw; i++) {
      const y = i * this.WS - 1000;
      this.wallL[i] = -HALF_W + 40 + (fbm1(y * 0.0035, seed) * 26 + fbm1(y * 0.0011, seed + 5) * 34 + fbm1(y * 0.02, seed + 9) * 7) * amp;
      this.wallR[i] = HALF_W - 40 - (fbm1(y * 0.0035, seed + 77) * 26 + fbm1(y * 0.0011, seed + 55) * 34 + fbm1(y * 0.02, seed + 19) * 7) * amp;
    }
    for (let c = 0; c * CHUNK < height + 2000; c++) this.shapes.push([]);
    GENERATORS[biome.id](this);
    this.cols = Math.ceil((HALF_W * 2) / CELL) + 1;
    this.rows = Math.ceil((height + 1000) / CELL) + 1;
    this.sdf = new Float32Array(this.cols * this.rows);
    this.bakeSdf();
  }

  // ------------------------------------------------------------ walls
  wallAt(side: -1 | 1, y: number) {
    const arr = side < 0 ? this.wallL : this.wallR;
    const f = (y + 1000) / this.WS;
    const i = clamp(Math.floor(f), 0, arr.length - 2);
    const t = clamp(f - i, 0, 1);
    return arr[i] * (1 - t) + arr[i + 1] * t;
  }
  /** Widen walls smoothly around a y range (used by the final clearing). */
  widen(y0: number, y1: number, amount: number) {
    for (let i = 0; i < this.wallL.length; i++) {
      const y = i * this.WS - 1000;
      const t = clamp((y - y0) / (y1 - y0), 0, 1);
      const s = t * t * (3 - 2 * t);
      this.wallL[i] -= amount * s;
      this.wallR[i] += amount * s;
    }
  }

  // ------------------------------------------------------------ shapes
  add(s: Shape, collide = true) {
    const y = s.k === 'tube' ? s.pts[0].y : s.y;
    const c = clamp(Math.floor(y / CHUNK), 0, this.shapes.length - 1);
    this.shapes[c].push(s);
    if (!collide) return;
    if (s.k === 'tube') {
      for (let i = 0; i < s.pts.length - 1; i++) {
        const a = s.pts[i], b = s.pts[i + 1];
        this.caps.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, ra: a.r, rb: b.r });
      }
    } else if (s.k === 'blob') {
      this.circles.push({ x: s.x, y: s.y, r: s.r * 0.92, sy: s.squash });
    } else if (s.k === 'dome') {
      // approximate the cap with a flattened circle
      this.circles.push({ x: s.x, y: s.y + s.h * 0.35, r: s.w * 0.95, sy: Math.abs(s.h) / s.w * 0.75 });
    }
  }

  /** Collision-only capsule chain (for shapes whose mesh is decorative, e.g. big leaves). */
  solidOnly(pts: P[]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      this.caps.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, ra: a.r, rb: b.r });
    }
  }

  /** Big solid leaf (roof / platform): lens-shaped silhouette plus a capsule spine. */
  bigLeaf(x: number, y: number, ang: number, len: number, w: number, droop = 0.18, tone = 1) {
    this.add({ k: 'broad', x, y, ang, len, w, droop, tone }, false);
    this.solidOnly(MeshBuilder.broadSpine(x, y, ang, len, w * 0.55, droop).map((p) => ({ ...p, r: Math.max(2, p.r) })));
    this.leafTips.push(MeshBuilder.broadSpine(x, y, ang, len, w, droop).pop()!);
  }

  /** Branch growing from a wall toward the middle. Returns tip point. */
  branch(side: -1 | 1, y: number, len: number, rise: number, thick: number, opts: { twigs?: boolean; leaves?: boolean; tone?: number } = {}) {
    const r = this.rng;
    const x0 = this.wallAt(side, y) + side * 30;
    const seg = 9;
    const pts: P[] = [];
    const dir = -side;
    const wob = r.range(0, 100);
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      pts.push({
        x: x0 + dir * (len + 30) * t,
        y: y + rise * t + Math.sin(t * 3 + wob) * 10 * t - t * t * len * 0.08,
        r: Math.max(2.5, thick * (1 - t * 0.85)),
      });
    }
    const tone = opts.tone ?? 1;
    this.add({ k: 'tube', pts, sway: 0, tone });
    const tip = pts[seg];
    if (opts.twigs !== false) {
      const nt = r.int(1, 3);
      for (let k = 0; k < nt; k++) {
        const i = r.int(3, seg - 2);
        const p = pts[i];
        const up = r.chance(0.7) ? 1 : -1;
        const a = Math.PI / 2 * up + dir * r.range(0.3, 0.9) * (up > 0 ? -1 : 1) * -1;
        const l = r.range(35, 80);
        const tw: P[] = [];
        for (let j = 0; j <= 4; j++) {
          const t = j / 4;
          tw.push({ x: p.x + Math.cos(a) * l * t, y: p.y + Math.sin(a) * l * t + t * t * 6, r: Math.max(1.2, p.r * 0.45 * (1 - t)) });
        }
        this.add({ k: 'tube', pts: tw, sway: 0.25, tone });
        if (opts.leaves !== false) this.leafTuft(tw[4].x, tw[4].y, a, r.int(2, 3), 0.8);
      }
    }
    if (opts.leaves !== false) this.leafTuft(tip.x, tip.y, dir > 0 ? 0 : Math.PI, r.int(2, 4), 1);
    // moss/grass on top
    const blades = r.int(3, 7);
    for (let k = 0; k < blades; k++) {
      const i = r.int(1, seg - 2);
      const p = pts[i];
      this.add({ k: 'blade', x: p.x + r.range(-8, 8), y: p.y + p.r * 0.7, ang: Math.PI / 2 + r.range(-0.5, 0.5), len: r.range(12, 30), w: 1.6, bend: r.range(-0.6, 0.6), sway: 1, tone }, false);
    }
    return { tip, pts };
  }

  leafTuft(x: number, y: number, ang: number, n: number, size: number) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const a = ang + r.range(-1.1, 1.1);
      this.add({ k: 'leaf', x, y, ang: a, len: r.range(28, 46) * size, w: r.range(7, 11) * size, curl: r.range(-0.5, 0.5), sway: 1, tone: r.range(0.85, 1.15) }, false);
    }
  }

  mushroomCluster(x: number, y: number, side: number, n: number) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const h = r.range(18, 44);
      const lean = r.range(-0.35, 0.35) + side * 0.2;
      const bx = x + r.range(-18, 18);
      const tx = bx + Math.sin(lean) * h, ty = y + Math.cos(lean) * h;
      const stem: P[] = [];
      for (let j = 0; j <= 4; j++) {
        const t = j / 4;
        stem.push({ x: bx + (tx - bx) * t, y: y + (ty - y) * t, r: 2.8 - t * 0.8 });
      }
      this.add({ k: 'tube', pts: stem, sway: 0, tone: 1.3 }, false);
      const w = r.range(9, 17);
      this.add({ k: 'dome', x: tx, y: ty, w, h: w * r.range(0.5, 0.8), tone: 1.6 }, false);
      this.glows.push({ x: tx, y: ty + 3, r: w * 3.2, col: pickGlow(r), phase: r.range(0, 6.28) });
    }
  }

  makeWeb(x: number, y: number, r: number, d: number): Web {
    const rng = this.rng;
    const spokes: number[] = [];
    const n = rng.int(9, 13);
    for (let i = 0; i < n; i++) spokes.push((i / n) * Math.PI * 2 + rng.range(-0.15, 0.15));
    return { x, y, r, spokes, rings: rng.int(5, 7), anchors: [], caught: 0, cap: Math.round(26 + d * 14), broken: false, burn: 0, shake: 0 };
  }

  // ------------------------------------------------------------ SDF
  private bakeSdf() {
    const { cols, rows } = this;
    const band = 16; // rows per band
    const nb = Math.ceil(rows / band);
    const bucketsC: number[][] = Array.from({ length: nb }, () => []);
    const bucketsO: number[][] = Array.from({ length: nb }, () => []);
    const toBand = (y: number) => clamp(Math.floor(y / CELL / band), 0, nb - 1);
    const M = 48;
    this.caps.forEach((c, i) => {
      const r = Math.max(c.ra, c.rb) + M;
      const b0 = toBand(Math.min(c.ay, c.by) - r), b1 = toBand(Math.max(c.ay, c.by) + r);
      for (let b = b0; b <= b1; b++) bucketsC[b].push(i);
    });
    this.circles.forEach((c, i) => {
      const r = c.r + M;
      const b0 = toBand(c.y - r), b1 = toBand(c.y + r);
      for (let b = b0; b <= b1; b++) bucketsO[b].push(i);
    });
    for (let row = 0; row < rows; row++) {
      const y = row * CELL;
      const wl = this.wallAt(-1, y), wr = this.wallAt(1, y);
      const bc = bucketsC[Math.floor(row / band)], bo = bucketsO[Math.floor(row / band)];
      for (let col = 0; col < cols; col++) {
        const x = col * CELL - HALF_W;
        let d = Math.min(x - wl, wr - x);
        if (d > -M) {
          for (const i of bc) {
            const c = this.caps[i];
            const s = distToSegment(x, y, c.ax, c.ay, c.bx, c.by);
            const dd = s.d - (c.ra + (c.rb - c.ra) * s.t);
            if (dd < d) d = dd;
          }
          for (const i of bo) {
            const c = this.circles[i];
            const dx = x - c.x, dy = (y - c.y) / c.sy;
            const dd = (Math.sqrt(dx * dx + dy * dy) - c.r) * Math.min(1, c.sy + 0.2);
            if (dd < d) d = dd;
          }
        }
        this.sdf[row * cols + col] = Math.min(d, M);
      }
    }
  }

  /** Signed distance to solid (positive = free space). */
  sdfAt(x: number, y: number) {
    const fx = (x + HALF_W) / CELL, fy = y / CELL;
    if (fx < 0 || fx >= this.cols - 1) return -10;
    if (fy < 0) return Math.min(x - this.wallAt(-1, y), this.wallAt(1, y) - x);
    if (fy >= this.rows - 1) return 48;
    const ix = fx | 0, iy = fy | 0;
    const tx = fx - ix, ty = fy - iy;
    const i = iy * this.cols + ix;
    const s = this.sdf;
    const a = s[i] + (s[i + 1] - s[i]) * tx;
    const b = s[i + this.cols] + (s[i + this.cols + 1] - s[i + this.cols]) * tx;
    return a + (b - a) * ty;
  }
}

export function pickGlow(r: Rng): [number, number, number] {
  return r.pick([
    [0.2, 0.9, 1.0],
    [0.35, 1.0, 0.75],
    [0.55, 0.6, 1.0],
    [0.2, 0.75, 1.0],
  ] as [number, number, number][]);
}
