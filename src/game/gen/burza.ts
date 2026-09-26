// Biome 4: the storm. Rain comes in waves; big leaves are roofs to hide under.

import type { Level } from '../level';
import { BAL } from '../balance';
import { addGust, hangingVines, pieceLantern, pieceWebField, sequence, zonePiece, type Piece } from './shared';
import { pieceBranches, pieceSqueeze, clearing } from './sciolka';

/** A roof: one or two broad leaves from a wall with a sheltered pocket underneath. */
function roof(L: Level, side: -1 | 1, y: number, reach: number) {
  const r = L.rng;
  const wx = L.wallAt(side, y);
  const ang = side < 0 ? r.range(0.05, 0.2) : Math.PI - r.range(0.05, 0.2);
  L.bigLeaf(wx + side * 25, y, ang, reach + 25, r.range(28, 36), r.range(0.18, 0.3), 1.1);
  // stem holding it
  L.add({ k: 'tube', pts: [{ x: wx + side * 10, y: y - 70, r: 6 }, { x: wx - side * 20, y: y - 30, r: 4 }, { x: wx - side * 40, y: y - 4, r: 2.5 }], sway: 0, tone: 1 });
  return wx - side * reach;
}

const pieceShelters: Piece = (L, y, d) => {
  const r = L.rng;
  let yy = y + 200;
  const n = r.int(2, 3);
  let side: -1 | 1 = r.chance(0.5) ? -1 : 1;
  for (let k = 0; k < n; k++) {
    roof(L, side, yy, r.range(150, 230) - d * 30);
    if (r.chance(0.45)) L.larvae.push({ x: L.wallAt(side, yy) - side * 70, y: yy - 60, n: r.int(5, 8), awake: false, t: 0 });
    side = (side * -1) as -1 | 1;
    yy += r.range(300, 380) + d * 60;
  }
  return yy + 40;
};

const pieceGusts: Piece = (L, y, d) => {
  const r = L.rng;
  const len = 900 + d * 400;
  addGust(L, y, y + len, d);
  roof(L, r.chance(0.5) ? -1 : 1, y + len * 0.5, r.range(160, 210));
  L.hints.push({ y: y - 120, id: 'wind' });
  return y + len;
};

const pieceBats = zonePiece('bats', 'bats', (L, y, len) => {
  hangingVines(L, y, len);
  roof(L, L.rng.chance(0.5) ? -1 : 1, y + len * 0.45, 190);
});

function start(L: Level) {
  const r = L.rng;
  roof(L, -1, 380, 220);
  roof(L, 1, 700, 200);
  L.larvae.push({ x: r.range(-60, 60), y: 520, n: 12, awake: false, t: 0 });
  L.hints.push({ y: 0, id: 'rain' });
  return 900;
}

export function genBurza(L: Level) {
  const y = sequence(L, {
    start: start(L),
    lanternFirst: 1900,
    lanternGap: BAL.lanternGap,
    lantern: pieceLantern,
    pieces: { shelters: pieceShelters, branches: pieceBranches, squeeze: pieceSqueeze, gusts: pieceGusts, bats: pieceBats, webs: pieceWebField },
    threats: BAL.threats.burza,
    weights: (d) => [
      ['shelters', 3],
      ['branches', 2],
      ['squeeze', 1 + d],
      ['gusts', 1.2 + d],
      ['bats', 0.6 + d],
      ['webs', 0.5 + d * 0.5],
    ],
  });
  clearing(L, y);
}
