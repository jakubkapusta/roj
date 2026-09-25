// Biome level: procedural sequence of hand-designed "pieces", static collision SDF,
// and the entities placed along the way.

import { makeRng, type Rng } from '../core/rng';
import { fbm1 } from '../core/noise';
import { clamp, distToSegment } from '../core/math';
import type { P } from '../render/mesh';

export const HALF_W = 300;
export const CHUNK = 1000;
const CELL = 8;

export type Shape =
  | { k: 'tube'; pts: P[]; sway: number; tone: number }
  | { k: 'blob'; x: number; y: number; r: number; seed: number; tone: number; squash: number }
  | { k: 'dome'; x: number; y: number; w: number; h: number; tone: number }
  | { k: 'leaf'; x: number; y: number; ang: number; len: number; w: number; curl: number; sway: number; tone: number }
  | { k: 'blade'; x: number; y: number; ang: number; len: number; w: number; bend: number; sway: number; tone: number };

type Capsule = { ax: number; ay: number; bx: number; by: number; ra: number; rb: number };
type Circle = { x: number; y: number; r: number; sy: number };

export type Larva = { x: number; y: number; n: number; awake: boolean; t: number };
export type Lantern = { x: number; y: number; ax: number; ay: number; len: number; ang: number; av: number; charge: number; lit: boolean; t: number };
export type Web = {
  x: number; y: number; r: number; spokes: number[]; rings: number;
  anchors: [number, number][];
  caught: number; cap: number; broken: boolean; burn: number; shake: number;
};
export type Glow = { x: number; y: number; r: number; col: [number, number, number]; phase: number };
export type BatZone = { y0: number; y1: number; interval: number; timer: number };
export type Hint = { y: number; id: string };

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
  batZones: BatZone[] = [];
  hints: Hint[] = [];
  // wall border x sampled every WS units
  readonly WS = 16;
  wallL: Float32Array;
  wallR: Float32Array;
  // SDF grid
  cols: number;
  rows: number;
  sdf: Float32Array;

  constructor(seed: number, height = 16000) {
    this.seed = seed;
    this.height = height;
    this.rng = makeRng(seed);
    const nw = Math.ceil((height + 2000) / this.WS) + 2;
    this.wallL = new Float32Array(nw);
    this.wallR = new Float32Array(nw);
    for (let i = 0; i < nw; i++) {
      const y = i * this.WS - 1000;
      this.wallL[i] = -HALF_W + 40 + fbm1(y * 0.0035, seed) * 26 + fbm1(y * 0.0011, seed + 5) * 34 + fbm1(y * 0.02, seed + 9) * 7;
      this.wallR[i] = HALF_W - 40 - fbm1(y * 0.0035, seed + 77) * 26 - fbm1(y * 0.0011, seed + 55) * 34 - fbm1(y * 0.02, seed + 19) * 7;
    }
    for (let c = 0; c * CHUNK < height + 2000; c++) this.shapes.push([]);
    this.generate();
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
  private widen(y0: number, y1: number, amount: number) {
    for (let i = 0; i < this.wallL.length; i++) {
      const y = i * this.WS - 1000;
      const t = clamp((y - y0) / (y1 - y0), 0, 1);
      const s = t * t * (3 - 2 * t);
      this.wallL[i] -= amount * s;
      this.wallR[i] += amount * s;
    }
  }

  // ------------------------------------------------------------ shapes
  private add(s: Shape, collide = true) {
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

  /** Branch growing from a wall toward the middle. Returns tip point. */
  private branch(side: -1 | 1, y: number, len: number, rise: number, thick: number, opts: { twigs?: boolean; leaves?: boolean; tone?: number } = {}) {
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

  private leafTuft(x: number, y: number, ang: number, n: number, size: number) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const a = ang + r.range(-1.1, 1.1);
      this.add({ k: 'leaf', x, y, ang: a, len: r.range(28, 46) * size, w: r.range(7, 11) * size, curl: r.range(-0.5, 0.5), sway: 1, tone: r.range(0.85, 1.15) }, false);
    }
  }

  private mushroomCluster(x: number, y: number, side: number, n: number) {
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

  // ------------------------------------------------------------ pieces
  private generate() {
    const r = this.rng;
    const H = this.height;
    let y = this.pieceStart();
    let nextLantern = 2000;
    let last = '';
    let pieceNo = 0;
    this.hints.push({ y: 0, id: 'move' });
    while (y < H - 1100) {
      const d = y / H;
      let kind: string;
      if (y >= nextLantern) {
        kind = 'lantern';
        nextLantern = y + r.range(2100, 2600);
      } else {
        const w: [string, number][] = [
          ['branches', 3],
          ['squeeze', 1.2 + d * 1.6],
          ['web', d > 0.06 ? 1.2 + d * 1.5 : 0],
          ['webField', d > 0.15 ? 0.8 + d * 2 : 0],
          ['shelves', 2],
          ['bats', d > 0.2 ? 1.2 + d * 2.5 : 0],
          ['larvae', 1.6 - d * 0.6],
        ];
        // first web and first bats are guaranteed early-ish so the player meets them
        if (pieceNo === 2) w.forEach((e) => (e[1] = e[0] === 'web' ? 1 : 0));
        let tot = 0;
        for (const e of w) if (e[0] !== last) tot += e[1];
        let pick = r() * tot;
        kind = 'branches';
        for (const e of w) {
          if (e[0] === last) continue;
          pick -= e[1];
          if (pick <= 0) { kind = e[0]; break; }
        }
      }
      last = kind;
      pieceNo++;
      switch (kind) {
        case 'lantern': y = this.pieceLantern(y, d); break;
        case 'squeeze': y = this.pieceSqueeze(y, d); break;
        case 'web': y = this.pieceWeb(y, d); break;
        case 'webField': y = this.pieceWebField(y, d); break;
        case 'shelves': y = this.pieceShelves(y, d); break;
        case 'bats': y = this.pieceBats(y, d); break;
        case 'larvae': y = this.pieceLarvae(y, d); break;
        default: y = this.pieceBranches(y, d);
      }
    }
    this.pieceEnd(y);
  }

  private pieceStart() {
    const r = this.rng;
    // forest floor: a big mossy mound
    for (let k = 0; k < 7; k++) {
      const x = -300 + k * 100 + r.range(-20, 20);
      this.add({ k: 'blob', x, y: -40, r: r.range(80, 120), seed: r.int(0, 999), tone: 0.9, squash: 0.6 });
    }
    for (let k = 0; k < 40; k++) {
      const x = r.range(-280, 280);
      this.add({ k: 'blade', x, y: 20, ang: Math.PI / 2 + r.range(-0.4, 0.4), len: r.range(25, 70), w: 2.2, bend: r.range(-0.8, 0.8), sway: 1, tone: 1 }, false);
    }
    this.mushroomCluster(-190, 25, 1, 3);
    this.mushroomCluster(170, 20, -1, 2);
    this.larvae.push({ x: 120, y: 480, n: 10, awake: false, t: 0 });
    this.larvae.push({ x: -150, y: 700, n: 10, awake: false, t: 0 });
    this.branch(1, 820, 200, 30, 20);
    return 1000;
  }

  private pieceBranches(y: number, d: number) {
    const r = this.rng;
    const n = r.int(2, 3);
    let side: -1 | 1 = r.chance(0.5) ? -1 : 1;
    const gap = 200 - d * 70;
    let yy = y + 150;
    for (let i = 0; i < n; i++) {
      const width = this.wallAt(1, yy) - this.wallAt(-1, yy);
      const len = width - gap + r.range(-30, 30);
      const { pts } = this.branch(side, yy, len, r.range(-30, 60), r.range(18, 28));
      if (r.chance(0.45)) {
        const p = pts[r.int(3, 6)];
        this.larvae.push({ x: p.x, y: p.y + p.r + 14, n: r.int(4, 8), awake: false, t: 0 });
      }
      if (r.chance(0.35)) this.mushroomCluster(pts[2].x, pts[2].y + pts[2].r * 0.6, side, r.int(1, 3));
      side = (side * -1) as -1 | 1;
      yy += r.range(300, 380) - d * 40;
    }
    return yy + 60;
  }

  private pieceSqueeze(y: number, d: number) {
    const r = this.rng;
    const yy = y + 220;
    const L = this.wallAt(-1, yy), R = this.wallAt(1, yy);
    const gap = clamp(95 - d * 40, 58, 95);
    const gx = r.range(L + 110, R - 110);
    this.branch(-1, yy, gx - gap / 2 - L, r.range(-15, 15), 30, { twigs: false });
    this.branch(1, yy + r.range(-20, 20), R - (gx + gap / 2), r.range(-15, 15), 30, { twigs: false });
    // reward right after the gap
    this.larvae.push({ x: gx + r.range(-40, 40), y: yy + 160, n: r.int(8, 14), awake: false, t: 0 });
    this.hints.push({ y: yy - 250, id: 'squeeze' });
    return yy + 420;
  }

  private pieceWeb(y: number, d: number) {
    const r = this.rng;
    const yy = y + 260;
    const L = this.wallAt(-1, yy), R = this.wallAt(1, yy);
    const width = R - L;
    // two branches leave a wide gap, the web sits in it; a narrow bypass at one side
    const bypassLeft = r.chance(0.5);
    const webGap = 190;
    const bypass = clamp(78 - d * 25, 55, 80);
    const webX = bypassLeft ? L + bypass + 60 + webGap / 2 + r.range(0, width - webGap - bypass - 160) : R - bypass - 60 - webGap / 2 - r.range(0, width - webGap - bypass - 160);
    // branch between bypass and web
    if (bypassLeft) {
      const stubX = L + bypass + 30;
      this.add({ k: 'blob', x: stubX, y: yy, r: 30, seed: r.int(0, 99), tone: 1, squash: 0.8 });
      this.branch(1, yy + r.range(-15, 15), R - (webX + webGap / 2), r.range(-10, 10), 26, { twigs: true });
      this.webs.push(this.makeWeb(webX, yy, webGap / 2 + 6, d));
      // bridge from stub to web
      this.add({ k: 'tube', pts: [{ x: stubX, y: yy, r: 14 }, { x: (stubX + webX - webGap / 2) / 2, y: yy + 6, r: 10 }, { x: webX - webGap / 2 - 4, y: yy, r: 6 }], sway: 0, tone: 1 });
    } else {
      const stubX = R - bypass - 30;
      this.add({ k: 'blob', x: stubX, y: yy, r: 30, seed: r.int(0, 99), tone: 1, squash: 0.8 });
      this.branch(-1, yy + r.range(-15, 15), webX - webGap / 2 - L, r.range(-10, 10), 26, { twigs: true });
      this.webs.push(this.makeWeb(webX, yy, webGap / 2 + 6, d));
      this.add({ k: 'tube', pts: [{ x: stubX, y: yy, r: 14 }, { x: (stubX + webX + webGap / 2) / 2, y: yy + 6, r: 10 }, { x: webX + webGap / 2 + 4, y: yy, r: 6 }], sway: 0, tone: 1 });
    }
    this.hints.push({ y: yy - 330, id: 'web' });
    if (r.chance(0.6)) this.larvae.push({ x: webX, y: yy + 200, n: r.int(6, 10), awake: false, t: 0 });
    return yy + 380;
  }

  /** Free-hanging webs staggered across an open space, tied to the walls. */
  private pieceWebField(y: number, d: number) {
    const r = this.rng;
    const n = d > 0.5 ? 3 : 2;
    let yy = y + 220;
    let side = r.chance(0.5) ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const L = this.wallAt(-1, yy), R = this.wallAt(1, yy);
      const rad = r.range(62, 84) + d * 12;
      const x = side < 0 ? L + rad + r.range(40, 120) : R - rad - r.range(40, 120);
      const w = this.makeWeb(x, yy, rad, d);
      const wx = side < 0 ? L : R;
      w.anchors.push([wx, yy + r.range(-40, 60)], [wx, yy - r.range(40, 90)], [x + r.range(-30, 30), yy + rad + r.range(80, 160)]);
      this.webs.push(w);
      if (r.chance(0.5)) this.larvae.push({ x: x - side * r.range(30, 60), y: yy + rad + 50, n: r.int(5, 9), awake: false, t: 0 });
      side = -side;
      yy += r.range(260, 330);
    }
    this.hints.push({ y: y - 150, id: 'web' });
    return yy + 80;
  }

  private makeWeb(x: number, y: number, r: number, d: number): Web {
    const rng = this.rng;
    const spokes: number[] = [];
    const n = rng.int(9, 13);
    for (let i = 0; i < n; i++) spokes.push((i / n) * Math.PI * 2 + rng.range(-0.15, 0.15));
    return { x, y, r, spokes, rings: rng.int(5, 7), anchors: [], caught: 0, cap: Math.round(26 + d * 14), broken: false, burn: 0, shake: 0 };
  }

  private pieceShelves(y: number, d: number) {
    const r = this.rng;
    let yy = y + 140;
    const n = r.int(3, 4);
    let side: -1 | 1 = r.chance(0.5) ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const wx = this.wallAt(side, yy);
      const w = r.range(70, 110) + d * 20;
      // bracket fungus: half-dome sticking out of the wall
      this.add({ k: 'dome', x: wx - side * w * 0.55, y: yy, w, h: w * 0.42, tone: 1.35 });
      this.glows.push({ x: wx - side * w * 0.95, y: yy + 4, r: 60, col: pickGlow(r), phase: r.range(0, 6.28) });
      if (r.chance(0.5)) this.mushroomCluster(wx - side * w * 0.6, yy + w * 0.35, -side, r.int(1, 2));
      if (r.chance(0.35)) this.larvae.push({ x: wx - side * (w + 60), y: yy + 60, n: r.int(4, 7), awake: false, t: 0 });
      side = (side * -1) as -1 | 1;
      yy += r.range(190, 250);
    }
    return yy + 60;
  }

  private pieceBats(y: number, d: number) {
    const r = this.rng;
    const len = 1300 + d * 500;
    this.batZones.push({ y0: y, y1: y + len, interval: clamp(2.4 - d * 1.3, 1.1, 2.4), timer: 0.8 });
    this.hints.push({ y: y - 150, id: 'bats' });
    // hanging vines only (non-solid) to keep space open
    for (let k = 0; k < 6; k++) {
      const side = r.chance(0.5) ? -1 : 1;
      const x = this.wallAt(side as -1 | 1, y + k * 180) - side * 10;
      this.add({ k: 'blade', x, y: y + 150 + k * 180, ang: -Math.PI / 2 - side * r.range(0.2, 0.6), len: r.range(80, 160), w: 2.5, bend: side * r.range(0.2, 0.6), sway: 1.2, tone: 1 }, false);
    }
    if (r.chance(0.7)) this.larvae.push({ x: r.range(-150, 150), y: y + len * 0.5, n: r.int(6, 10), awake: false, t: 0 });
    this.branch(r.chance(0.5) ? -1 : 1, y + len - 120, 170, 20, 18);
    return y + len;
  }

  private pieceLarvae(y: number, d: number) {
    const r = this.rng;
    const yy = y + 200;
    const side: -1 | 1 = r.chance(0.5) ? -1 : 1;
    const { pts } = this.branch(side, yy, r.range(220, 300), r.range(0, 40), 22);
    const p = pts[6];
    this.larvae.push({ x: p.x, y: p.y + 24, n: r.int(10, 16) - Math.round(d * 4), awake: false, t: 0 });
    this.mushroomCluster(pts[3].x, pts[3].y + pts[3].r * 0.7, side, 2);
    this.branch((side * -1) as -1 | 1, yy + 320, r.range(160, 230), r.range(0, 30), 18);
    return yy + 500;
  }

  private pieceLantern(y: number, _d: number) {
    const r = this.rng;
    const yy = y + 380;
    const side: -1 | 1 = r.chance(0.5) ? -1 : 1;
    const { tip, pts } = this.branch(side, yy, 230, 40, 24, { leaves: true });
    const ax = pts[7].x, ay = pts[7].y - pts[7].r * 0.5;
    const len = r.range(70, 100);
    this.lanterns.push({ x: ax, y: ay - len, ax, ay, len, ang: r.range(-0.2, 0.2), av: 0, charge: 0, lit: false, t: 0 });
    this.mushroomCluster(this.wallAt((side * -1) as -1 | 1, yy - 120) + side * 20, yy - 140, -side, 3);
    this.hints.push({ y: yy - 450, id: 'lantern' });
    void tip;
    return yy + 420;
  }

  private pieceEnd(y: number) {
    // widen into a clearing under the moon
    this.widen(y + 200, y + 900, 170);
    this.mushroomCluster(this.wallAt(-1, y + 300) + 30, y + 300, 1, 3);
    this.mushroomCluster(this.wallAt(1, y + 500) - 30, y + 500, -1, 3);
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

function pickGlow(r: Rng): [number, number, number] {
  return r.pick([
    [0.2, 0.9, 1.0],
    [0.35, 1.0, 0.75],
    [0.55, 0.6, 1.0],
    [0.2, 0.75, 1.0],
  ] as [number, number, number][]);
}
