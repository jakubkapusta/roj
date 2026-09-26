// Piece sequencing and the pieces several biomes share.

import { clamp } from '../../core/math';
import type { Level } from '../level';
import { BAL } from '../balance';

export type Piece = (L: Level, y: number, d: number) => number;

export type SeqOpts = {
  start: number;
  pieces: Record<string, Piece>;
  /** filler weights by progress d (0..1); threat kinds listed in `threats` are ignored here */
  weights: (d: number) => [string, number][];
  lanternFirst: number;
  lanternGap: [number, number];
  lantern: Piece;
  /**
   * Threat pieces and how many of each the biome gets. They are spread evenly over the
   * biome (only their order is random), so every level has the same amount of danger.
   * `earliest` keeps a kind out of the first part of the biome (0..1).
   */
  threats: Record<string, number>;
  earliest?: Record<string, number>;
  endMargin?: number;
};

/** Fill the level: lanterns every so often, threats at evenly spaced slots, fillers between. */
export function sequence(L: Level, o: SeqOpts) {
  const r = L.rng;
  let y = o.start;
  let nextLantern = o.lanternFirst;
  let last = '';
  const end = L.height - (o.endMargin ?? 1100);

  // shuffle the threats, then push kinds that may not appear yet further back
  const plan: string[] = [];
  for (const [k, n] of Object.entries(o.threats)) for (let i = 0; i < n; i++) plan.push(k);
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  const span = end - o.start;
  const slotY = plan.map((_, i) => o.start + span * ((i + 0.35 + r() * 0.3) / plan.length));
  for (let i = 0; i < plan.length; i++) {
    const min = o.earliest?.[plan[i]] ?? 0;
    if ((slotY[i] - o.start) / span >= min) continue;
    const j = plan.findIndex((k, jj) => jj > i && (slotY[i] - o.start) / span >= (o.earliest?.[k] ?? 0));
    if (j > 0) [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  let ti = 0;

  while (y < end) {
    const d = y / L.height;
    let kind: string;
    if (y >= nextLantern) {
      kind = '__lantern';
      nextLantern = y + r.range(o.lanternGap[0], o.lanternGap[1]);
    } else if (ti < plan.length && y >= slotY[ti] - 150) {
      kind = plan[ti++];
    } else {
      const w = o.weights(d).filter(([k]) => !(k in o.threats) && k !== last);
      let tot = 0;
      for (const e of w) tot += e[1];
      let pick = r() * tot;
      kind = w[0][0];
      for (const e of w) {
        pick -= e[1];
        if (pick <= 0) { kind = e[0]; break; }
      }
    }
    last = kind;
    y = kind === '__lantern' ? o.lantern(L, y, d) : o.pieces[kind](L, y, d);
  }
  return y;
}

// ------------------------------------------------------------ physalis lantern on a branch
export const pieceLantern: Piece = (L, y) => {
  const r = L.rng;
  const yy = y + 380;
  const side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  const { pts } = L.branch(side, yy, 230, 40, 24, { leaves: true });
  const ax = pts[7].x, ay = pts[7].y - pts[7].r * 0.5;
  const len = r.range(70, 100);
  L.lanterns.push({ x: ax, y: ay - len, ax, ay, len, ang: r.range(-0.2, 0.2), av: 0, charge: 0, lit: false, t: 0, star: false });
  L.mushroomCluster(L.wallAt((side * -1) as -1 | 1, yy - 120) + side * 20, yy - 140, -side, 3);
  L.hints.push({ y: yy - 450, id: 'lantern' });
  return yy + 420;
};

// ------------------------------------------------------------ webs
export const pieceWeb: Piece = (L, y, d) => {
  const r = L.rng;
  const yy = y + 260;
  const Lw = L.wallAt(-1, yy), R = L.wallAt(1, yy);
  const width = R - Lw;
  const bypassLeft = r.chance(0.5);
  const webGap = 190;
  const bypass = clamp(78 - d * 25, 55, 80);
  const span = Math.max(0, width - webGap - bypass - 160);
  const webX = bypassLeft ? Lw + bypass + 60 + webGap / 2 + r.range(0, span) : R - bypass - 60 - webGap / 2 - r.range(0, span);
  const sgn = bypassLeft ? 1 : -1;
  const stubX = bypassLeft ? Lw + bypass + 30 : R - bypass - 30;
  L.add({ k: 'blob', x: stubX, y: yy, r: 30, seed: r.int(0, 99), tone: 1, squash: 0.8 });
  if (bypassLeft) L.branch(1, yy + r.range(-15, 15), R - (webX + webGap / 2), r.range(-10, 10), 26, { twigs: true });
  else L.branch(-1, yy + r.range(-15, 15), webX - webGap / 2 - Lw, r.range(-10, 10), 26, { twigs: true });
  L.webs.push(L.makeWeb(webX, yy, webGap / 2 + 6, d));
  const edge = webX - sgn * (webGap / 2 + 4);
  L.add({ k: 'tube', pts: [{ x: stubX, y: yy, r: 14 }, { x: (stubX + edge) / 2, y: yy + 6, r: 10 }, { x: edge, y: yy, r: 6 }], sway: 0, tone: 1 });
  L.hints.push({ y: yy - 330, id: 'web' });
  if (r.chance(0.6)) L.larvae.push({ x: webX, y: yy + 200, n: r.int(6, 10), awake: false, t: 0 });
  return yy + 380;
};

/** Free-hanging webs staggered across an open space, tied to the walls. */
export const pieceWebField: Piece = (L, y, d) => {
  const r = L.rng;
  const n = d > 0.5 ? 3 : 2;
  let yy = y + 220;
  let side = r.chance(0.5) ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const Lw = L.wallAt(-1, yy), R = L.wallAt(1, yy);
    const rad = r.range(62, 84) + d * 12;
    const x = side < 0 ? Lw + rad + r.range(40, 120) : R - rad - r.range(40, 120);
    const w = L.makeWeb(x, yy, rad, d);
    const wx = side < 0 ? Lw : R;
    w.anchors.push([wx, yy + r.range(-40, 60)], [wx, yy - r.range(40, 90)], [x + r.range(-30, 30), yy + rad + r.range(80, 160)]);
    L.webs.push(w);
    if (r.chance(0.5)) L.larvae.push({ x: x - side * r.range(30, 60), y: yy + rad + 50, n: r.int(5, 9), awake: false, t: 0 });
    side = -side;
    yy += r.range(260, 330);
  }
  L.hints.push({ y: y - 150, id: 'web' });
  return yy + 80;
};

// ------------------------------------------------------------ open flight with a zone of flying threats
export function zonePiece(kind: 'bats' | 'dragonflies' | 'moths', hint: string, deco: (L: Level, y: number, len: number) => void): Piece {
  return (L, y, d) => {
    const r = L.rng;
    const len = 1300 + d * 500;
    const base = kind === 'bats' ? BAL.bat.interval : kind === 'dragonflies' ? BAL.dragonfly.interval : BAL.moth.interval;
    L.zones.push({ kind, y0: y, y1: y + len, interval: clamp(base - d * BAL.zoneRamp, 1.1, base), timer: 0.8 });
    L.hints.push({ y: y - 150, id: hint });
    deco(L, y, len);
    if (r.chance(0.7)) L.larvae.push({ x: r.range(-150, 150), y: y + len * 0.5, n: r.int(6, 10), awake: false, t: 0 });
    return y + len;
  };
}

export function hangingVines(L: Level, y: number, len: number) {
  const r = L.rng;
  for (let k = 0; k * 180 < len - 100; k++) {
    const side = r.chance(0.5) ? -1 : 1;
    const x = L.wallAt(side as -1 | 1, y + k * 180) - side * 10;
    L.add({ k: 'blade', x, y: y + 150 + k * 180, ang: -Math.PI / 2 - side * r.range(0.2, 0.6), len: r.range(80, 160), w: 2.5, bend: side * r.range(0.2, 0.6), sway: 1.2, tone: 1 }, false);
  }
}

/** Wind zone: periodic gusts pushing the swarm sideways. */
export function addGust(L: Level, y0: number, y1: number, d: number) {
  const r = L.rng;
  L.gusts.push({ y0, y1, dir: r.chance(0.5) ? -1 : 1, strength: BAL.gust.strength + d * BAL.gust.ramp, period: r.range(4.5, 6.5), phase: r.range(0, 3) });
}
