// Biome 5: above the clouds. Cloud islands, cold currents, moths drawn to light, star lanterns.

import type { Level } from '../level';
import { BAL } from '../balance';
import { addGust, sequence, zonePiece, type Piece } from './shared';

/** Cloud island: overlapping puffs, solid. */
function cloud(L: Level, x: number, y: number, w: number) {
  const r = L.rng;
  const n = Math.max(3, Math.round(w / 38));
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1);
    const px = x - w / 2 + t * w + r.range(-10, 10);
    const pr = (0.55 + Math.sin(t * Math.PI) * 0.6) * r.range(30, 42);
    L.add({ k: 'blob', x: px, y: y + Math.sin(t * Math.PI) * 14 + r.range(-6, 6), r: pr, seed: r.int(0, 999), tone: r.range(1.05, 1.3), squash: 0.72 });
  }
}

const pieceIslands: Piece = (L, y, d) => {
  const r = L.rng;
  let yy = y + 200;
  const n = r.int(2, 4);
  for (let k = 0; k < n; k++) {
    const Lw = L.wallAt(-1, yy), R = L.wallAt(1, yy);
    const w = r.range(140, 240) + d * 40;
    const x = r.range(Lw + w / 2 + 40, R - w / 2 - 40);
    cloud(L, x, yy, w);
    if (r.chance(0.4)) L.larvae.push({ x: x + r.range(-40, 40), y: yy + 90, n: r.int(5, 9), awake: false, t: 0 });
    yy += r.range(280, 360);
  }
  return yy;
};

const pieceMoths = zonePiece('moths', 'moths', (L, y, len) => {
  const r = L.rng;
  cloud(L, r.range(-120, 120), y + len * 0.4, r.range(120, 180));
});

const pieceCurrents: Piece = (L, y, d) => {
  const r = L.rng;
  const len = 900 + d * 300;
  addGust(L, y, y + len, d * 0.8);
  cloud(L, r.chance(0.5) ? -150 : 150, y + len * 0.5, r.range(150, 200));
  L.hints.push({ y: y - 120, id: 'wind' });
  return y + len;
};

const pieceStardust: Piece = (L, y) => {
  const r = L.rng;
  for (let k = 0; k < 3; k++) L.larvae.push({ x: r.range(-180, 180), y: y + 150 + k * 170, n: r.int(6, 10), awake: false, t: 0 });
  cloud(L, r.range(-100, 100), y + 620, r.range(160, 220));
  return y + 760;
};

const pieceStar: Piece = (L, y) => {
  const r = L.rng;
  const yy = y + 380;
  const x = r.range(-140, 140);
  L.lanterns.push({ x, y: yy, ax: x, ay: yy, len: 0, ang: 0, av: 0, charge: 0, lit: false, t: 0, star: true });
  cloud(L, x + r.range(-40, 40), yy - 170, r.range(160, 220));
  L.hints.push({ y: yy - 450, id: 'lantern' });
  return yy + 380;
};

export function genNiebo(L: Level) {
  const r = L.rng;
  // start just above the cloud sea
  for (let k = 0; k < 8; k++) L.add({ k: 'blob', x: -320 + k * 90 + r.range(-15, 15), y: -30, r: r.range(70, 100), seed: r.int(0, 999), tone: 1.15, squash: 0.55 });
  const y = sequence(L, {
    start: 700,
    lanternFirst: 1600,
    lanternGap: BAL.lanternGap,
    lantern: pieceStar,
    pieces: { islands: pieceIslands, moths: pieceMoths, currents: pieceCurrents, stardust: pieceStardust },
    threats: BAL.threats.niebo,
    weights: (d) => [
      ['islands', 3],
      ['moths', 1.8 + d * 2],
      ['currents', 1 + d],
      ['stardust', 0.7],
    ],
    endMargin: 1400,
  });
  // open sky for the finale
  L.widen(y + 100, y + 800, 200);
}
