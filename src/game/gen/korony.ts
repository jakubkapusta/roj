// Biome 3: the canopy. Thick boughs with leaf clusters, moonlight, owls and gusts.

import type { Level } from '../level';
import { BAL } from '../balance';
import { addGust, hangingVines, pieceLantern, pieceWebField, sequence, zonePiece, type Piece } from './shared';
import { pieceSqueeze, pieceLarvae, clearing } from './sciolka';

function leafCluster(L: Level, x: number, y: number, size: number) {
  const r = L.rng;
  const n = Math.round(6 + size * 6);
  for (let k = 0; k < n; k++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0, 28 * size);
    L.add({ k: 'leaf', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, ang: a + r.range(-0.6, 0.6), len: r.range(26, 42) * size, w: r.range(8, 12) * size, curl: r.range(-0.4, 0.4), sway: 1, tone: r.range(0.9, 1.2) }, false);
  }
}

const pieceBoughs: Piece = (L, y, d) => {
  const r = L.rng;
  const n = r.int(2, 3);
  let side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  let yy = y + 180;
  const gap = 190 - d * 60;
  for (let i = 0; i < n; i++) {
    const width = L.wallAt(1, yy) - L.wallAt(-1, yy);
    const { pts, tip } = L.branch(side, yy, width - gap + r.range(-30, 20), r.range(-20, 70), r.range(30, 40), { leaves: false });
    leafCluster(L, tip.x, tip.y + 10, 1.1);
    leafCluster(L, pts[5].x, pts[5].y + 30, 0.8);
    if (r.chance(0.4)) L.larvae.push({ x: pts[4].x, y: pts[4].y + 50, n: r.int(5, 9), awake: false, t: 0 });
    side = (side * -1) as -1 | 1;
    yy += r.range(330, 400);
  }
  return yy + 60;
};

const pieceOwl: Piece = (L, y, d) => {
  const r = L.rng;
  const yy = y + 420;
  const side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  const { pts } = L.branch(side, yy, r.range(170, 210), r.range(0, 20), 34, { leaves: false, twigs: false });
  const p = pts[5];
  L.owls.push({ x: p.x, y: p.y + p.r + 26, side, state: 0, t: 0, px: p.x, py: p.y + p.r + 26, vx: 0, vy: 0, bites: 0 });
  leafCluster(L, pts[9].x, pts[9].y + 20, 1.2);
  // open space around the owl so the swoop has room, a few boughs on the far side
  L.branch((side * -1) as -1 | 1, yy + 380, r.range(140, 190), 30, 24);
  if (d > 0.5) L.branch(side, yy + 700, r.range(130, 170), 20, 22);
  L.hints.push({ y: yy - 520, id: 'owl' });
  return yy + 820;
};

const pieceGusts: Piece = (L, y, d) => {
  const r = L.rng;
  const len = 1000 + d * 400;
  addGust(L, y, y + len, d);
  for (let k = 0; k < 2; k++) {
    const side: -1 | 1 = k ? 1 : -1;
    const { tip } = L.branch(side, y + 250 + k * 380 + r.range(-40, 40), r.range(120, 170), 20, 24, { leaves: false });
    leafCluster(L, tip.x, tip.y, 0.9);
  }
  if (d > 0.35 && r.chance(0.7)) {
    // a web in the middle of the gusty space: the wind pushes the swarm toward it
    const wy = y + 460, wx = r.range(-60, 60);
    const w = L.makeWeb(wx, wy, 70 + d * 14, d);
    w.anchors.push([L.wallAt(-1, wy), wy + 30], [L.wallAt(1, wy), wy - 20], [wx, wy + 190]);
    L.webs.push(w);
  }
  L.hints.push({ y: y - 120, id: 'wind' });
  return y + len;
};

const pieceBats = zonePiece('bats', 'bats', (L, y, len) => hangingVines(L, y, len));

export function genKorony(L: Level) {
  const y = sequence(L, {
    start: 700,
    lanternFirst: 1700,
    lanternGap: BAL.lanternGap,
    lantern: pieceLantern,
    pieces: { boughs: pieceBoughs, owl: pieceOwl, gusts: pieceGusts, bats: pieceBats, squeeze: pieceSqueeze, larvae: pieceLarvae, webs: pieceWebField },
    threats: BAL.threats.korony,
    weights: (d) => [
      ['boughs', 3],
      ['owl', 1.6 + d * 1.5],
      ['gusts', 1.2 + d],
      ['bats', 1 + d * 1.5],
      ['squeeze', 1 + d],
      ['larvae', 1.2],
      ['webs', 0.6 + d],
    ],
  });
  clearing(L, y);
}
