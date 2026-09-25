// Biome 2: the pond. Reeds in mist over black water, frogs on leaves, dragonflies.

import type { Level } from '../level';
import type { P } from '../../render/mesh';
import { pieceLantern, pieceWebField, sequence, zonePiece, type Piece } from './shared';
import { clearing } from './sciolka';

/** Tall reed stem standing in the playfield; solid. Returns top point. */
function reed(L: Level, x: number, y0: number, h: number, lean: number, r0 = 6, cattail = false) {
  const r = L.rng;
  const pts: P[] = [];
  const seg = 10;
  const ph = r.range(0, 6);
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push({ x: x + lean * t * t * h + Math.sin(t * 3 + ph) * 6, y: y0 + h * t, r: Math.max(1.5, r0 * (1 - t * 0.7)) });
  }
  L.add({ k: 'tube', pts, sway: 0.15, tone: 1.05 });
  // long blade leaves peeling off the stem (decor)
  const nl = r.int(2, 4);
  for (let k = 0; k < nl; k++) {
    const i = r.int(1, seg - 3);
    const p = pts[i];
    const side = r.chance(0.5) ? -1 : 1;
    L.add({ k: 'blade', x: p.x, y: p.y, ang: Math.PI / 2 - side * r.range(0.25, 0.7), len: r.range(70, 150), w: 3.5, bend: -side * r.range(0.3, 0.9), sway: 1, tone: 1 }, false);
  }
  const top = pts[seg];
  if (cattail) {
    L.add({ k: 'tube', pts: [{ x: top.x, y: top.y - 4, r: 7 }, { x: top.x + lean * 4, y: top.y + 22, r: 9 }, { x: top.x + lean * 8, y: top.y + 44, r: 5 }], sway: 0, tone: 1.5 });
    L.add({ k: 'blade', x: top.x + lean * 8, y: top.y + 44, ang: Math.PI / 2, len: 22, w: 1.2, bend: 0.2, sway: 1, tone: 1 }, false);
  }
  return top;
}

/** Broad leaf platform growing from a wall; a frog may sit on it. */
function platform(L: Level, side: -1 | 1, y: number, reach: number) {
  const wx = L.wallAt(side, y);
  const ang = side < 0 ? 0.08 : Math.PI - 0.08;
  L.bigLeaf(wx + side * 20, y, ang, reach + 20, 18, 0.08, 1.15);
  return { tipX: wx - side * reach, y };
}

const pieceReeds: Piece = (L, y, d) => {
  const r = L.rng;
  const n = r.int(3, 5) + Math.round(d * 2);
  const h = r.range(500, 800);
  const Lw = L.wallAt(-1, y + h / 2) + 60, R = L.wallAt(1, y + h / 2) - 60;
  const xs: number[] = [];
  for (let k = 0; k < n; k++) {
    let x = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = r.range(Lw, R);
      if (xs.every((o) => Math.abs(o - x) > 85 - d * 15)) break;
    }
    xs.push(x);
    const y0 = y + r.range(0, 160);
    reed(L, x, y0, h * r.range(0.7, 1), r.range(-0.12, 0.12), r.range(5, 8), r.chance(0.6));
  }
  if (r.chance(0.6)) L.larvae.push({ x: r.range(Lw, R), y: y + h * 0.6, n: r.int(5, 10), awake: false, t: 0 });
  return y + h + 120;
};

const pieceFallen: Piece = (L, y, d) => {
  const r = L.rng;
  let yy = y + 160;
  const n = r.int(2, 3);
  for (let k = 0; k < n; k++) {
    const side: -1 | 1 = k % 2 ? -1 : 1;
    const Lw = L.wallAt(-1, yy), R = L.wallAt(1, yy);
    const gap = 150 - d * 50;
    const x0 = side < 0 ? Lw - 20 : R + 20;
    const x1 = side < 0 ? R - gap : Lw + gap;
    const drop = r.range(60, 140);
    const pts: P[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push({ x: x0 + (x1 - x0) * t, y: yy + drop * (1 - t) + Math.sin(t * Math.PI) * 18, r: 9 - t * 5 });
    }
    L.add({ k: 'tube', pts, sway: 0, tone: 1 });
    for (let i = 0; i < 4; i++) {
      const p = pts[r.int(1, 7)];
      L.add({ k: 'blade', x: p.x, y: p.y, ang: -Math.PI / 2 + r.range(-0.4, 0.4), len: r.range(30, 70), w: 2.2, bend: r.range(-0.5, 0.5), sway: 1.2, tone: 1 }, false);
    }
    yy += r.range(280, 340);
  }
  return yy + 40;
};

const pieceFrogs: Piece = (L, y, d) => {
  const r = L.rng;
  const n = d > 0.45 ? 3 : 2;
  let yy = y + 200;
  let side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const reach = r.range(90, 140);
    const p = platform(L, side, yy, reach);
    L.frogs.push({ x: p.tipX + side * 34, y: yy + 22, face: -side, state: 0, t: 0, tx: 0, ty: 0, cool: r.range(0.5, 1.5), eaten: 0, blink: r.range(0, 5) });
    if (r.chance(0.5)) reed(L, side < 0 ? r.range(20, 140) : r.range(-140, -20), yy - 120, r.range(300, 420), r.range(-0.1, 0.1), 6, true);
    side = (side * -1) as -1 | 1;
    yy += r.range(340, 420);
  }
  L.hints.push({ y: y - 100, id: 'frogs' });
  if (r.chance(0.6)) L.larvae.push({ x: r.range(-100, 100), y: yy - 100, n: r.int(6, 10), awake: false, t: 0 });
  return yy + 60;
};

const pieceDragonflies = zonePiece('dragonflies', 'dragonflies', (L, y, len) => {
  const r = L.rng;
  for (let k = 0; k < 3; k++) reed(L, r.range(-200, 200), y + r.range(100, len - 400), r.range(250, 400), r.range(-0.1, 0.1), 5, true);
});

const pieceLarvaeReeds: Piece = (L, y) => {
  const r = L.rng;
  const top = reed(L, r.range(-120, 120), y + 60, r.range(420, 520), r.range(-0.1, 0.1), 7, true);
  L.larvae.push({ x: top.x + r.range(-50, 50), y: top.y - 120, n: r.int(10, 15), awake: false, t: 0 });
  platform(L, r.chance(0.5) ? -1 : 1, y + 380, r.range(100, 150));
  return y + 640;
};

function start(L: Level) {
  const r = L.rng;
  L.water = 0;
  // lily pads on the surface
  for (let k = 0; k < 6; k++) L.pads.push({ x: r.range(-260, 260), y: 0, w: r.range(26, 44) });
  // reed beds rising from the water at both sides
  for (let k = 0; k < 8; k++) {
    const side = k % 2 ? -1 : 1;
    reed(L, side * r.range(170, 240), -30, r.range(260, 520), -side * r.range(0.02, 0.12), 6, r.chance(0.7));
  }
  L.larvae.push({ x: r.range(-60, 60), y: 520, n: 12, awake: false, t: 0 });
  return 800;
}

export function genStaw(L: Level) {
  const y = sequence(L, {
    start: start(L),
    lanternFirst: 1900,
    lanternGap: [2200, 2700],
    lantern: pieceLantern,
    force: { 1: 'frogs', 3: 'dragonflies' },
    pieces: { reeds: pieceReeds, fallen: pieceFallen, frogs: pieceFrogs, dragonflies: pieceDragonflies, webs: pieceWebField, larvae: pieceLarvaeReeds },
    weights: (d) => [
      ['reeds', 3],
      ['fallen', 1.5 + d],
      ['frogs', 2 + d * 1.5],
      ['dragonflies', d > 0.15 ? 1.2 + d * 2 : 0],
      ['webs', d > 0.3 ? 0.8 : 0],
      ['larvae', 1.5 - d * 0.5],
    ],
  });
  clearing(L, y);
}
