// Everything that outlives a single run: species, nights, mutations, unlocks and saves.

import { hashString, makeRng } from '../core/rng';
import type { V3 } from './biomes';

// ------------------------------------------------------------ modifiers
/** Numbers the rules read; species, night and mutations each tweak them. */
export type Mods = {
  startFlies: number;
  startBlask: number;
  flashCost: number;
  perfectCost: number;
  flashR: number;
  perfectCos: number; // how close to the pulse peak a perfect flash must be (cos of phase)
  light: number;
  speed: number;
  coupling: number;
  larva: number;
  larvaKeep: number; // fraction of sleeping larvae that exist at all
  lanternBlask: number;
  lanternFlies: number;
  webCatch: number;
  webCap: number;
  shadow: number;
  hazard: number; // interval / cooldown multiplier (lower = more often)
  warn: number; // warning time multiplier
  regen: number;
  dodge: number;
  revive: boolean;
  score: number;
};

export function baseMods(): Mods {
  return {
    startFlies: 200, startBlask: 60, flashCost: 35, perfectCost: 10, flashR: 1, perfectCos: 0.72,
    light: 1, speed: 1, coupling: 1, larva: 1, larvaKeep: 1, lanternBlask: 40, lanternFlies: 0,
    webCatch: 0.5, webCap: 0, shadow: 1, hazard: 1, warn: 1, regen: 1, dodge: 0, revive: true, score: 1,
  };
}

// ------------------------------------------------------------ species
export type Species = { id: string; name: string; desc: string; rgb: V3; unlock: string; apply: (m: Mods) => void };

export const SPECIES: Species[] = [
  { id: 'zielone', name: 'Zielone', desc: 'Zrównoważone. Klasyka nocnego lasu.', rgb: [0.62, 1.0, 0.28], unlock: '', apply: () => {} },
  {
    id: 'blekitne', name: 'Błękitne', desc: 'Szybsze o 15%, ale świecą słabiej.', rgb: [0.35, 0.78, 1.0], unlock: 'Przeleć przez Staw',
    apply: (m) => { m.speed *= 1.15; m.light *= 0.82; },
  },
  {
    id: 'bursztynowe', name: 'Bursztynowe', desc: 'Jasne i liczne (240), ale wolniejsze.', rgb: [1.0, 0.68, 0.22], unlock: 'Ukończ całą wyprawę',
    apply: (m) => { m.light *= 1.3; m.startFlies = 240; m.speed *= 0.9; },
  },
  {
    id: 'purpurowe', name: 'Purpurowe', desc: 'Mistrzowie rozbłysków: tańsze, szybciej się zgrywają. Tylko 160 świetlików.', rgb: [0.82, 0.45, 1.0], unlock: '15 idealnych rozbłysków',
    apply: (m) => { m.flashCost -= 10; m.coupling *= 1.6; m.perfectCos = 0.55; m.startBlask = 100; m.startFlies = 160; },
  },
];

// ------------------------------------------------------------ nights (ascension)
export const NIGHTS: { desc: string; apply: (m: Mods) => void }[] = [
  { desc: 'Zwykła noc.', apply: () => {} },
  { desc: 'Cień podnosi się szybciej.', apply: (m) => { m.shadow *= 1.15; } },
  { desc: 'Mniej uśpionych larw.', apply: (m) => { m.larvaKeep *= 0.75; } },
  { desc: 'Rozbłysk kosztuje więcej.', apply: (m) => { m.flashCost += 5; } },
  { desc: 'Drapieżniki atakują częściej.', apply: (m) => { m.hazard *= 0.8; } },
  { desc: 'Mniejszy rój na start.', apply: (m) => { m.startFlies = Math.round(m.startFlies * 0.8); } },
  { desc: 'Pajęczyny są chciwsze.', apply: (m) => { m.webCatch = Math.min(0.9, m.webCatch + 0.12); m.webCap += 10; } },
  { desc: 'Bez drugiej szansy.', apply: (m) => { m.revive = false; } },
  { desc: 'Blask odnawia się wolniej.', apply: (m) => { m.regen *= 0.6; } },
  { desc: 'Gęstszy mrok, jeszcze szybszy Cień.', apply: (m) => { m.light *= 0.82; m.shadow *= 1.12; } },
];

// ------------------------------------------------------------ mutations
export type Mutation = { id: string; name: string; desc: string; apply: (m: Mods) => void };

export const MUTATIONS: Mutation[] = [
  { id: 'jasny', name: 'Jasny rój', desc: 'Światło sięga o 30% dalej.', apply: (m) => { m.light *= 1.3; } },
  { id: 'tani', name: 'Lekki rozbłysk', desc: 'Rozbłysk kosztuje 10 Blasku mniej.', apply: (m) => { m.flashCost -= 10; } },
  { id: 'wielki', name: 'Wielki rozbłysk', desc: 'Rozbłysk sięga o 35% dalej.', apply: (m) => { m.flashR *= 1.35; } },
  { id: 'rytm', name: 'Wspólny rytm', desc: 'Rój szybciej zaczyna błyskać razem, idealny rozbłysk łatwiej trafić.', apply: (m) => { m.coupling *= 1.7; m.perfectCos -= 0.15; } },
  { id: 'plodny', name: 'Płodność', desc: 'Larwy dają o połowę więcej świetlików.', apply: (m) => { m.larva *= 1.5; } },
  { id: 'lampy', name: 'Żar lampionów', desc: 'Lampion daje +30 Blasku i 12 nowych świetlików.', apply: (m) => { m.lanternBlask += 30; m.lanternFlies += 12; } },
  { id: 'zwinny', name: 'Zwinność', desc: 'Rój leci o 15% szybciej.', apply: (m) => { m.speed *= 1.15; } },
  { id: 'sliski', name: 'Śliskie skrzydła', desc: 'Pajęczyny łapią dwa razy rzadziej.', apply: (m) => { m.webCatch *= 0.5; } },
  { id: 'swit', name: 'Przedświt', desc: 'Cień podnosi się o 20% wolniej.', apply: (m) => { m.shadow *= 0.8; } },
  { id: 'czujny', name: 'Czujność', desc: 'Zagrożenia zapowiadają się o połowę dłużej.', apply: (m) => { m.warn *= 1.5; } },
  { id: 'iskra', name: 'Iskra', desc: 'Blask odnawia się dwa razy szybciej.', apply: (m) => { m.regen *= 2; } },
  { id: 'pancerz', name: 'Twarde pancerzyki', desc: 'Co czwarty atak chybia.', apply: (m) => { m.dodge = 1 - (1 - m.dodge) * 0.75; } },
];

export function computeMods(species: string, night: number, mutations: string[]): Mods {
  const m = baseMods();
  (SPECIES.find((s) => s.id === species) ?? SPECIES[0]).apply(m);
  for (let n = 1; n < night && n < NIGHTS.length; n++) NIGHTS[n].apply(m);
  for (const id of mutations) MUTATIONS.find((x) => x.id === id)?.apply(m);
  m.flashCost = Math.max(10, m.flashCost);
  m.score = 1 + (night - 1) * 0.15;
  return m;
}

/** Three distinct mutations the player doesn't have yet, seeded so a daily run offers the same. */
export function mutationOffer(seed: number, biome: number, owned: string[]) {
  const r = makeRng(hashString(`${seed}:mut:${biome}`));
  const pool = MUTATIONS.filter((m) => !owned.includes(m.id));
  const out: Mutation[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

// ------------------------------------------------------------ meta save
export type Meta = {
  best: number;
  runs: number;
  wins: number;
  perfects: number;
  staw: boolean; // has cleared the pond
  night: number; // highest unlocked night (1-based)
  species: string;
  nightSel: number;
  daily: { date: string; best: number };
};

const META_KEY = 'roj.meta.v1';

export function loadMeta(): Meta {
  let m: Partial<Meta> = {};
  try { m = JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { /* ignore */ }
  return {
    best: m.best ?? 0,
    runs: m.runs ?? 0,
    wins: m.wins ?? 0,
    perfects: m.perfects ?? 0,
    staw: m.staw ?? false,
    night: Math.max(1, m.night ?? 1),
    species: m.species ?? 'zielone',
    nightSel: Math.max(1, m.nightSel ?? 1),
    daily: m.daily ?? { date: '', best: 0 },
  };
}

export function saveMeta(m: Meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

export function speciesUnlocked(m: Meta, id: string) {
  switch (id) {
    case 'blekitne': return m.staw || m.wins > 0;
    case 'bursztynowe': return m.wins > 0;
    case 'purpurowe': return m.perfects >= 15;
    default: return true;
  }
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dailySeed() {
  return hashString(`roj-daily-${today()}`);
}

// ------------------------------------------------------------ constellations ("Twoje niebo")
export type SkyEntry = { name: string; stars: [number, number][]; links: [number, number][]; flies: number; score: number; date: string; species?: string; night?: number };

export function loadSky(): SkyEntry[] {
  try { return JSON.parse(localStorage.getItem('roj.sky.v1') || '[]'); } catch { return []; }
}
export function saveSky(sky: SkyEntry[]) {
  try { localStorage.setItem('roj.sky.v1', JSON.stringify(sky)); } catch { /* ignore */ }
}

// ------------------------------------------------------------ run save (resume on the next ride)
import type { Carry } from './game';

export type RunSave = {
  v: 1;
  carry: Carry;
  /** index of the last lit lantern to resume at, -1 = start of the biome */
  lantern: number;
  /** biome finished, the mutation is still to be chosen (carry is already the next biome's) */
  pending?: boolean;
  flies?: number;
  blask?: number;
  score?: number;
  lanterns?: number;
  larvae?: number;
  perfects?: number;
  lost?: number;
  reviveUsed?: boolean;
};

const RUN_KEY = 'roj.run.v1';
export function loadRun(): RunSave | null {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null');
    return r && r.v === 1 ? r : null;
  } catch { return null; }
}
export function saveRun(r: RunSave | null) {
  try {
    if (r) localStorage.setItem(RUN_KEY, JSON.stringify(r));
    else localStorage.removeItem(RUN_KEY);
  } catch { /* ignore */ }
}
