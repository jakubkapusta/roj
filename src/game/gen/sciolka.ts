// Biome 1: forest floor.

import { clamp } from '../../core/math';
import type { Level } from '../level';
import { BAL } from '../balance';
import { pickGlow } from '../level';
import { hangingVines, pieceLantern, pieceWeb, pieceWebField, sequence, zonePiece, type Piece } from './shared';

export const pieceBranches: Piece = (L, y, d) => {
  const r = L.rng;
  const n = r.int(2, 3);
  let side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  const gap = 200 - d * 70;
  let yy = y + 150;
  for (let i = 0; i < n; i++) {
    const width = L.wallAt(1, yy) - L.wallAt(-1, yy);
    const len = width - gap + r.range(-30, 30);
    const { pts } = L.branch(side, yy, len, r.range(-30, 60), r.range(18, 28));
    if (r.chance(0.45)) {
      const p = pts[r.int(3, 6)];
      L.larvae.push({ x: p.x, y: p.y + p.r + 14, n: r.int(4, 8), awake: false, t: 0 });
    }
    if (r.chance(0.35)) L.mushroomCluster(pts[2].x, pts[2].y + pts[2].r * 0.6, side, r.int(1, 3));
    side = (side * -1) as -1 | 1;
    yy += r.range(300, 380) - d * 40;
  }
  return yy + 60;
};

export const pieceSqueeze: Piece = (L, y, d) => {
  const r = L.rng;
  const yy = y + 220;
  const Lw = L.wallAt(-1, yy), R = L.wallAt(1, yy);
  const gap = clamp(95 - d * 40, 58, 95);
  const gx = r.range(Lw + 110, R - 110);
  L.branch(-1, yy, gx - gap / 2 - Lw, r.range(-15, 15), 30, { twigs: false });
  L.branch(1, yy + r.range(-20, 20), R - (gx + gap / 2), r.range(-15, 15), 30, { twigs: false });
  L.larvae.push({ x: gx + r.range(-40, 40), y: yy + 160, n: r.int(8, 14), awake: false, t: 0 });
  L.hints.push({ y: yy - 250, id: 'squeeze' });
  return yy + 420;
};

const pieceShelves: Piece = (L, y, d) => {
  const r = L.rng;
  let yy = y + 140;
  const n = r.int(3, 4);
  let side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const wx = L.wallAt(side, yy);
    const w = r.range(70, 110) + d * 20;
    L.add({ k: 'dome', x: wx - side * w * 0.55, y: yy, w, h: w * 0.42, tone: 1.35 });
    L.glows.push({ x: wx - side * w * 0.95, y: yy + 4, r: 60, col: pickGlow(r), phase: r.range(0, 6.28) });
    if (r.chance(0.5)) L.mushroomCluster(wx - side * w * 0.6, yy + w * 0.35, -side, r.int(1, 2));
    if (r.chance(0.35)) L.larvae.push({ x: wx - side * (w + 60), y: yy + 60, n: r.int(4, 7), awake: false, t: 0 });
    side = (side * -1) as -1 | 1;
    yy += r.range(190, 250);
  }
  return yy + 60;
};

export const pieceLarvae: Piece = (L, y, d) => {
  const r = L.rng;
  const yy = y + 200;
  const side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  const { pts } = L.branch(side, yy, r.range(220, 300), r.range(0, 40), 22);
  const p = pts[6];
  L.larvae.push({ x: p.x, y: p.y + 24, n: r.int(10, 16) - Math.round(d * 4), awake: false, t: 0 });
  L.mushroomCluster(pts[3].x, pts[3].y + pts[3].r * 0.7, side, 2);
  L.branch((side * -1) as -1 | 1, yy + 320, r.range(160, 230), r.range(0, 30), 18);
  return yy + 500;
};

const pieceBats = zonePiece('bats', 'bats', (L, y, len) => {
  hangingVines(L, y, len);
  L.branch(L.rng.chance(0.5) ? -1 : 1, y + len - 120, 170, 20, 18);
});

function start(L: Level) {
  const r = L.rng;
  for (let k = 0; k < 7; k++) {
    const x = -300 + k * 100 + r.range(-20, 20);
    L.add({ k: 'blob', x, y: -40, r: r.range(80, 120), seed: r.int(0, 999), tone: 0.9, squash: 0.6 });
  }
  for (let k = 0; k < 40; k++) {
    L.add({ k: 'blade', x: r.range(-280, 280), y: 20, ang: Math.PI / 2 + r.range(-0.4, 0.4), len: r.range(25, 70), w: 2.2, bend: r.range(-0.8, 0.8), sway: 1, tone: 1 }, false);
  }
  L.mushroomCluster(-190, 25, 1, 3);
  L.mushroomCluster(170, 20, -1, 2);
  L.larvae.push({ x: 120, y: 480, n: 10, awake: false, t: 0 });
  L.larvae.push({ x: -150, y: 700, n: 10, awake: false, t: 0 });
  L.branch(1, 820, 200, 30, 20);
  return 1000;
}

/** Widen into a clearing under the moon (end of every forest biome). */
export function clearing(L: Level, y: number) {
  L.widen(y + 200, y + 900, 170);
  L.mushroomCluster(L.wallAt(-1, y + 300) + 30, y + 300, 1, 3);
  L.mushroomCluster(L.wallAt(1, y + 500) - 30, y + 500, -1, 3);
}

export function genSciolka(L: Level) {
  L.hints.push({ y: 0, id: 'move' });
  const y = sequence(L, {
    start: start(L),
    lanternFirst: 2000,
    lanternGap: BAL.lanternGap,
    lantern: pieceLantern,
    pieces: { branches: pieceBranches, squeeze: pieceSqueeze, web: pieceWeb, webField: pieceWebField, shelves: pieceShelves, bats: pieceBats, larvae: pieceLarvae },
    threats: BAL.threats.sciolka,
    earliest: { bats: 0.2, webField: 0.15 },
    weights: (d) => [
      ['branches', 3],
      ['squeeze', 1.2 + d * 1.6],
      ['web', d > 0.06 ? 1.2 + d * 1.5 : 0],
      ['webField', d > 0.15 ? 0.8 + d * 2 : 0],
      ['shelves', 2],
      ['bats', d > 0.2 ? 1.2 + d * 2.5 : 0],
      ['larvae', 1.6 - d * 0.6],
    ],
  });
  clearing(L, y);
}
