// Procedural parallax forest behind the playfield. Pure visuals, generated in strips
// so trunks continue seamlessly while the camera climbs.

import { makeRng, hashString } from '../core/rng';
import { MeshBuilder, type P } from './mesh';

export type LayerDef = {
  par: number;
  col: [number, number, number];
  fog: number;
  gain: number;
  rim: number;
  spacing: number;
  trunkR: [number, number];
  skip: number;
  branches: number;
};

export const LAYERS: LayerDef[] = [
  { par: 0.22, col: [0.012, 0.026, 0.036], fog: 0.55, gain: 0.35, rim: 0.2, spacing: 120, trunkR: [5, 11], skip: 0.25, branches: 5 },
  { par: 0.45, col: [0.008, 0.017, 0.022], fog: 0.35, gain: 0.6, rim: 0.4, spacing: 190, trunkR: [9, 18], skip: 0.3, branches: 6 },
  { par: 0.72, col: [0.005, 0.01, 0.011], fog: 0.12, gain: 0.9, rim: 0.8, spacing: 300, trunkR: [14, 28], skip: 0.35, branches: 6 },
];

export const STRIP = 1200;
const XR = 1250;

function h(layer: number, a: number, salt = 0) {
  const x = Math.sin(layer * 127.1 + a * 311.7 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

export function buildStrip(mb: MeshBuilder, li: number, idx: number, seed: number) {
  const L = LAYERS[li];
  const y0 = idx * STRIP - 30, y1 = (idx + 1) * STRIP + 30;
  const r = makeRng(hashString(`${seed}:${li}:${idx}`));
  const cols = Math.ceil((XR * 2) / L.spacing);
  const trunks: { fx: (y: number) => number; fr: (y: number) => number }[] = [];
  for (let c = 0; c < cols; c++) {
    if (h(li, c, 1) < L.skip) continue;
    const bx = -XR + c * L.spacing + (h(li, c, 2) - 0.5) * L.spacing * 0.6;
    const br = L.trunkR[0] + h(li, c, 3) * (L.trunkR[1] - L.trunkR[0]);
    const ph = h(li, c, 4) * 100;
    const fx = (y: number) => bx + Math.sin(y * 0.0017 + ph) * 22 + Math.sin(y * 0.006 + ph * 2) * 5;
    const fr = (y: number) => br * (1 + 0.12 * Math.sin(y * 0.004 + ph));
    trunks.push({ fx, fr });
    const pts: P[] = [];
    for (let y = y0; y <= y1; y += 60) pts.push({ x: fx(y), y, r: fr(y) });
    mb.tube(pts, 0, 1);
  }
  // branches with leaves
  const nb = L.branches + r.int(0, 3);
  for (let k = 0; k < nb && trunks.length; k++) {
    const t = r.pick(trunks);
    const y = r.range(y0 + 40, y1 - 40);
    const x = t.fx(y);
    const dir = r.chance(0.5) ? 1 : -1;
    const len = r.range(60, 190) * (0.6 + li * 0.25);
    const rise = r.range(10, 90);
    const pts: P[] = [];
    const seg = 6;
    for (let i = 0; i <= seg; i++) {
      const q = i / seg;
      pts.push({ x: x + dir * len * q, y: y + rise * q - q * q * 20, r: Math.max(1, t.fr(y) * 0.45 * (1 - q * 0.85)) });
    }
    mb.tube(pts, pts.map((_, i) => (i / seg) * 0.4), 1);
    const tip = pts[seg];
    const nl = r.int(3, 6);
    for (let j = 0; j < nl; j++) {
      const q = r.range(0.4, 1);
      const p = pts[Math.round(q * seg)];
      mb.leaf(p.x, p.y, (dir > 0 ? 0 : Math.PI) + r.range(-1.2, 1.2), r.range(18, 36) * (0.7 + li * 0.2), r.range(5, 9) * (0.7 + li * 0.2), r.range(-0.5, 0.5), 0.8, r.range(0.9, 1.2));
    }
    void tip;
  }
  // hanging vines and grass tufts
  const nv = r.int(2, 5);
  for (let k = 0; k < nv; k++) {
    mb.blade(r.range(-XR, XR), r.range(y0, y1), -Math.PI / 2 + r.range(-0.3, 0.3), r.range(60, 200), 2 + li, r.range(-0.4, 0.4), 1.2, 1);
  }
  // ferns
  const nf = r.int(1, 3);
  for (let k = 0; k < nf && trunks.length; k++) {
    const t = r.pick(trunks);
    const y = r.range(y0, y1);
    const x = t.fx(y);
    const dir = r.chance(0.5) ? 1 : -1;
    const spine: P[] = [];
    const len = r.range(90, 160);
    const seg = 8;
    for (let i = 0; i <= seg; i++) {
      const q = i / seg;
      const a = (dir > 0 ? 0.5 : Math.PI - 0.5) - dir * q * 1.1;
      spine.push({ x: x + Math.cos(a) * len * q, y: y + Math.sin(a) * len * q, r: 2.2 * (1 - q) + 0.5 });
    }
    mb.tube(spine, spine.map((_, i) => i / seg), 1);
    for (let i = 1; i < seg; i++) {
      const p = spine[i], q = spine[i + 1];
      const a = Math.atan2(q.y - p.y, q.x - p.x);
      const s = (1 - i / seg) * 22 + 6;
      mb.leaf(p.x, p.y, a + 1.1, s, 3.5, 0.3, (i / seg) * 1.2, 1.1);
      mb.leaf(p.x, p.y, a - 1.1, s, 3.5, -0.3, (i / seg) * 1.2, 1.1);
    }
  }
}
