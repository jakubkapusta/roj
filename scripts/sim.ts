// Headless balance simulator: plays whole runs with the bot, in parallel, and prints stats.
//
//   npm run sim                         # 240 runs, mixed skill 0.35–0.85, all 5 biomes
//   npm run sim -- --runs 400 --skill 0.6
//   npm run sim -- --biome 3 --runs 100 # only biome 3 (1-based), fresh 200 flies
//   BAL='{"shadowMul":1.2}' npm run sim # try knob values from src/game/balance.ts

import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BAL, tuneBal } from '../src/game/balance';
import { BIOMES } from '../src/game/biomes';
import { Game, newRun } from '../src/game/game';
import { mutationOffer } from '../src/game/meta';
import { makeRng } from '../src/core/rng';
import { Bot } from '../src/sim/bot';

type BiomeRes = { b: number; time: number; fliesIn: number; fliesOut: number; gained: number; lost: number; lostBy: Record<string, number>; died: boolean; revived: boolean };
type RunRes = { skill: number; biomes: BiomeRes[]; won: boolean; start: number; final: number; gainedTotal: number; lostTotal: number; time: number; score: number };

const DT = 1 / 30;
const LIMIT = 600; // s per biome before we call it stuck

function arg(name: string, def: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

if (process.env.BAL) tuneBal(JSON.parse(process.env.BAL));

function playRun(seed: number, skill: number, only: number | null): RunRes {
  const rng = makeRng(seed ^ 0x9e3779b9);
  // Math.random drives gameplay randomness; make runs reproducible per seed
  let st = seed >>> 0;
  Math.random = () => {
    st = (st + 0x6d2b79f5) >>> 0;
    let t = st;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let carry = newRun(seed, only ?? 0);
  const start = carry.flies;
  const res: RunRes = { skill, biomes: [], won: false, start, final: 0, gainedTotal: 0, lostTotal: 0, time: 0, score: 0 };
  for (let b = only ?? 0; b < (only !== null ? only + 1 : BIOMES.length); b++) {
    const g = new Game(carry);
    g.viewW = 600;
    g.viewH = 1300;
    const bot = new Bot(skill, rng);
    const fliesIn = g.swarm.n;
    const revBefore = g.reviveUsed;
    let t = 0;
    for (; t < LIMIT; t += DT) {
      bot.step(g, DT);
      g.update(DT);
      g.events.length = 0;
      if (g.particles.length > 200) g.particles.length = 200;
      if (g.state === 'over' || (g.state === 'finished' && g.stateT > 0.3)) break;
    }
    const died = g.state !== 'finished';
    res.biomes.push({ b, time: t, fliesIn, fliesOut: died ? 0 : g.swarm.n, gained: g.gained, lost: g.lost - carry.lost, lostBy: g.lostBy, died, revived: g.reviveUsed && !revBefore });
    res.time += t;
    res.gainedTotal += g.gained;
    res.lostTotal += g.lost - carry.lost;
    res.score = g.total;
    if (died) return res;
    if (b === BIOMES.length - 1 || only !== null) {
      res.won = true;
      res.final = g.swarm.n;
      return res;
    }
    carry = g.next();
    const offer = mutationOffer(carry.seed, carry.biome, carry.mutations);
    if (offer.length) carry.mutations.push(offer[Math.floor(rng() * offer.length)].id);
  }
  return res;
}

// ------------------------------------------------------------ child: play a slice of runs
if (process.argv.includes('--child')) {
  const from = Number(arg('from', '0')), to = Number(arg('to', '0'));
  const skillArg = arg('skill', 'mix');
  const only = arg('biome', '') ? Number(arg('biome', '1')) - 1 : null;
  const out: RunRes[] = [];
  for (let i = from; i < to; i++) {
    const r = makeRng(1000 + i);
    const skill = skillArg === 'mix' ? 0.35 + r() * 0.5 : Number(skillArg);
    out.push(playRun(((i + 1) * 2654435761) >>> 0, skill, only));
  }
  process.send!(out);
  process.exit(0);
}

// ------------------------------------------------------------ parent: fan out, aggregate, report
const runs = Number(arg('runs', '240'));
const workers = Math.min(cpus().length, Number(arg('workers', String(cpus().length))), runs);
const t0 = Date.now();
const self = fileURLToPath(import.meta.url);
const parts: Promise<RunRes[]>[] = [];
for (let w = 0; w < workers; w++) {
  const from = Math.floor((runs * w) / workers), to = Math.floor((runs * (w + 1)) / workers);
  const args = ['--child', '--from', String(from), '--to', String(to), '--skill', arg('skill', 'mix')];
  if (arg('biome', '')) args.push('--biome', arg('biome', '1'));
  parts.push(new Promise((res, rej) => {
    const c = fork(self, args, { execArgv: ['--import', 'tsx'], env: process.env });
    c.on('message', (m) => res(m as RunRes[]));
    c.on('error', rej);
    c.on('exit', (code) => { if (code) rej(new Error(`worker exit ${code}`)); });
  }));
}
const all = (await Promise.all(parts)).flat();
report(all);
console.log(`\n${all.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${workers} workers`);

function pct(n: number, d: number) { return d ? `${((100 * n) / d).toFixed(1)}%` : '—'; }
function avg(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function q(a: number[], p: number) { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; }
function mmss(s: number) { return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; }

function report(all: RunRes[]) {
  const only = arg('biome', '');
  const won = all.filter((r) => r.won);
  console.log(`\n=== ROJ balance — ${all.length} runs, skill ${arg('skill', 'mix')}${only ? `, biome ${only}` : ''} ===`);
  console.log(`BAL overrides: ${process.env.BAL ?? '(none)'}`);
  console.log(`\nWon: ${pct(won.length, all.length)}   Game over: ${pct(all.length - won.length, all.length)} [target ~10%]   revive used: ${pct(all.filter((r) => r.biomes.some((b) => b.revived)).length, all.length)}`);
  const lossless = won.filter((r) => r.lostTotal === 0).length;
  const kept = won.filter((r) => r.final >= r.start).length;
  console.log(`Won with 0 losses: ${pct(lossless, all.length)}   Won with ≥ start flies: ${pct(kept, all.length)}`);
  const deliv = won.map((r) => r.final / (r.start + r.gainedTotal));
  const vsStart = won.map((r) => r.final / r.start);
  console.log(`Delivered (final / start): avg ${(avg(vsStart) * 100).toFixed(0)}%  p10 ${(q(vsStart, 0.1) * 100).toFixed(0)}%  p90 ${(q(vsStart, 0.9) * 100).toFixed(0)}%   [target 30–45%]`);
  console.log(`Delivered of all ever owned (final / (start + gained)): avg ${(avg(deliv) * 100).toFixed(1)}%`);
  console.log(`Run time (won): avg ${mmss(avg(won.map((r) => r.time)))}   score avg ${Math.round(avg(won.map((r) => r.score)))}`);

  console.log('\nbiome            reached  died   time avg (p10–p90)   flies in→out   gained  lost   losses by cause');
  const nb = only ? 1 : BIOMES.length;
  for (let i = 0; i < nb; i++) {
    const b = only ? Number(only) - 1 : i;
    const rs = all.map((r) => r.biomes.find((x) => x.b === b)).filter(Boolean) as BiomeRes[];
    if (!rs.length) continue;
    const fin = rs.filter((x) => !x.died);
    const causes: Record<string, number> = {};
    for (const x of rs) for (const [k, v] of Object.entries(x.lostBy)) causes[k] = (causes[k] ?? 0) + v;
    const totalLost = Object.values(causes).reduce((a, v) => a + v, 0) || 1;
    const cs = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((100 * v) / totalLost)}%`).join(', ');
    const times = fin.map((x) => x.time);
    console.log(
      `${(b + 1 + '. ' + BIOMES[b].name).padEnd(16)} ${String(rs.length).padStart(7)}  ${pct(rs.length - fin.length, rs.length).padStart(5)}  ${mmss(avg(times))} (${mmss(q(times, 0.1))}–${mmss(q(times, 0.9))})`.padEnd(62) +
      `${Math.round(avg(rs.map((x) => x.fliesIn)))}→${Math.round(avg(fin.map((x) => x.fliesOut)))}`.padEnd(15) +
      `${Math.round(avg(rs.map((x) => x.gained)))}`.padEnd(8) + `${Math.round(avg(rs.map((x) => x.lost)))}`.padEnd(7) + cs,
    );
  }
  // by skill band
  console.log('\nskill band   runs   won     game over   delivered');
  for (const [lo, hi] of [[0, 0.5], [0.5, 0.7], [0.7, 1.01]]) {
    const rs = all.filter((r) => r.skill >= lo && r.skill < hi);
    if (!rs.length) continue;
    const w = rs.filter((r) => r.won);
    console.log(`${lo.toFixed(1)}–${Math.min(1, hi).toFixed(1)}      ${String(rs.length).padStart(4)}   ${pct(w.length, rs.length).padEnd(7)} ${pct(rs.length - w.length, rs.length).padEnd(11)} ${(avg(w.map((r) => r.final / (r.start + r.gainedTotal))) * 100).toFixed(0)}%`);
  }
  // where each skill band dies
  const bands: [number, number][] = [[0, 0.5], [0.5, 0.7], [0.7, 1.01]];
  const nbs = only ? 1 : BIOMES.length;
  console.log('\ndeaths by biome   ' + bands.map(([lo, hi]) => `${lo.toFixed(1)}–${Math.min(1, hi).toFixed(1)}`.padEnd(10)).join(''));
  for (let i = 0; i < nbs; i++) {
    const b = only ? Number(only) - 1 : i;
    const cells = bands.map(([lo, hi]) => {
      const rs = all.filter((r) => r.skill >= lo && r.skill < hi);
      const d = rs.filter((r) => r.biomes.some((x) => x.b === b && x.died)).length;
      return pct(d, rs.length).padEnd(10);
    });
    console.log(`${(b + 1 + '. ' + BIOMES[b].name).padEnd(18)}${cells.join('')}`);
  }
  const fin = won.map((r) => r.final);
  console.log(`\nfinal flies (won): p10 ${q(fin, 0.1)}  p50 ${q(fin, 0.5)}  p90 ${q(fin, 0.9)}  max ${q(fin, 1)}   gained total avg ${Math.round(avg(won.map((r) => r.gainedTotal)))}`);
  void BAL;
}
