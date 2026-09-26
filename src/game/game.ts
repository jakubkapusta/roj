// Game rules for one biome of a run: swarm, pickups, hazards, the rising Shadow, flash, scoring.

import { clamp, damp, TAU } from '../core/math';
import { hashString, makeRng } from '../core/rng';
import { Level, HALF_W, type Lantern } from './level';
import { Swarm, FREE, STUCK } from './swarm';
import { BIOMES, type BiomeDef } from './biomes';
import * as HZ from './hazards';
import { BAL } from './balance';
import { computeMods, SPECIES, type Mods, type RunSave } from './meta';

/** What a run carries from one biome to the next. */
export type Carry = {
  seed: number;
  biome: number;
  flies: number;
  blask: number;
  score: number;
  lanterns: number;
  larvae: number;
  perfects: number;
  heightBase: number;
  reviveUsed: boolean;
  lost: number;
  species: string;
  night: number;
  mutations: string[];
  daily: boolean;
};

export function newRun(seed: number, biome = 0, opts: { species?: string; night?: number; daily?: boolean } = {}): Carry {
  const species = opts.species ?? 'zielone', night = opts.night ?? 1;
  const m = computeMods(species, night, []);
  return {
    seed, biome, flies: m.startFlies, blask: m.startBlask, score: 0, lanterns: 0, larvae: 0, perfects: 0, heightBase: 0,
    reviveUsed: !m.revive, lost: 0, species, night, mutations: [], daily: !!opts.daily,
  };
}

export type Constellation = { name: string; stars: [number, number][]; links: [number, number][]; t: number };

export type GameEvent =
  | { t: 'larva'; x: number; y: number; n: number }
  | { t: 'lantern'; x: number; y: number; k: number; star: boolean }
  | { t: 'flash'; perfect: boolean }
  | { t: 'noBlask' }
  | { t: 'batWarn'; side: number }
  | { t: 'bite'; n: number }
  | { t: 'caught' }
  | { t: 'shadowLoss'; n: number }
  | { t: 'revive' }
  | { t: 'finish' }
  | { t: 'over' }
  | { t: 'hint'; id: string }
  | { t: 'frogAim' }
  | { t: 'frogStrike' }
  | { t: 'dragonfly' }
  | { t: 'dash' }
  | { t: 'owl' }
  | { t: 'swoop' }
  | { t: 'owlBlind' }
  | { t: 'gust' }
  | { t: 'rainWarn' }
  | { t: 'thunder'; delay: number };

export type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  r: number; g: number; b: number; kind: number; grav: number; drag: number;
};

export type Bat = {
  x: number; y: number; vx: number; vy: number; t: number;
  flee: number; bites: number; phase: number;
};

export type BatWarn = { side: number; y: number; t: number; speed: number };

export type Shock = { x: number; y: number; t: number; R: number; perfect: boolean };


const MAX_ALIVE = () => BAL.maxFlies;

export class Game {
  level: Level;
  biome: BiomeDef;
  carry: Carry;
  mods: Mods;
  rgb: [number, number, number];
  swarm = new Swarm();
  time = 0;
  state: 'play' | 'reviving' | 'finished' | 'over' = 'play';
  stateT = 0;
  camX = 0;
  camY = 400;
  viewW = 600;
  viewH = 1100;
  shadowY = -600;
  blask = 60;
  score = 0;
  maxY = 0;
  lanternsLit = 0;
  larvaeWoken = 0;
  perfects = 0;
  lost = 0;
  /** flies lost per cause, for the simulator */
  lostBy: Record<string, number> = {};
  /** flies gained from larvae and lanterns in this biome */
  gained = 0;
  reviveUsed = false;
  lastLantern: Lantern | null = null;
  bats: Bat[] = [];
  warns: BatWarn[] = [];
  particles: Particle[] = [];
  shock: Shock | null = null;
  events: GameEvent[] = [];
  private hintIdx = 0;
  private flashCd = 0;
  private biteSoundCd = 0;
  private caughtCd = 0;
  private shadowAcc = 0;
  private dynHints = new Set<string>();
  finishBonus = 0;
  heightBase = 0;
  /** Menu backdrop: swarm only, no hazards. */
  demo = false;
  dragonflies: HZ.Dragonfly[] = [];
  moths: HZ.Moth[] = [];
  drops: HZ.Drop[] = [];
  wind = 0;
  windDir = 0;
  rain = 0;
  rainPhase = 0;
  rainT = 6;
  lightning = 0;
  boltT = 3;
  boltX = 0;
  boltSeed = 0;
  constellation: Constellation | null = null;
  /** flies at the start of this biome (for stats) */
  fliesIn = 0;

  constructor(carry: Carry) {
    this.carry = carry;
    this.biome = BIOMES[carry.biome];
    this.mods = computeMods(carry.species, carry.night, carry.mutations);
    this.rgb = (SPECIES.find((x) => x.id === carry.species) ?? SPECIES[0]).rgb;
    this.level = new Level(hashString(`${carry.seed}:${carry.biome}`), this.biome);
    this.blask = carry.blask;
    this.score = carry.score;
    this.lanternsLit = carry.lanterns;
    this.larvaeWoken = carry.larvae;
    this.perfects = carry.perfects;
    this.heightBase = carry.heightBase;
    this.reviveUsed = carry.reviveUsed || !this.mods.revive;
    this.swarm.speedMul = this.mods.speed;
    this.swarm.couplingMul = this.mods.coupling;
    // fewer sleeping larvae on harder nights (deterministic per larva)
    if (this.mods.larvaKeep < 1) this.level.larvae = this.level.larvae.filter((_, i) => ((i * 2654435761) >>> 0) / 4294967296 < this.mods.larvaKeep || i < 2);
    this.lost = carry.lost;
    this.swarm.spawn(0, 260, carry.flies, 120);
    this.fliesIn = carry.flies;
    this.swarm.tx = 0;
    this.swarm.ty = 300;
    this.swarm.cx = 0;
    this.swarm.cy = 260;
    this.camY = 260 + 1100 * 0.12;
  }

  get progress() {
    return clamp(this.maxY / this.level.height, 0, 1);
  }
  get heightScore() {
    return Math.floor(this.maxY / 10);
  }
  get total() {
    return Math.round((this.score + this.heightBase + this.heightScore + this.finishBonus) * this.mods.score);
  }
  /** Bite caps grow with the swarm (sqrt), so big swarms lose more and small ones don't spiral. */
  get biteMul() {
    const [lo, hi] = BAL.biteScale;
    return Math.min(hi, Math.max(lo, Math.sqrt(this.swarm.free / BAL.biteRef)));
  }
  get isLast() {
    return this.carry.biome >= BIOMES.length - 1;
  }
  /** Save point: the last lit lantern with the counters as they are now. */
  snapshot(): RunSave {
    const idx = this.lastLantern ? this.level.lanterns.indexOf(this.lastLantern) : -1;
    if (idx < 0) return { v: 1, carry: this.carry, lantern: -1 };
    return {
      v: 1, carry: this.carry, lantern: idx, flies: Math.max(this.swarm.n, 40), blask: this.blask, score: this.score,
      lanterns: this.lanternsLit, larvae: this.larvaeWoken, perfects: this.perfects, lost: this.lost, reviveUsed: this.reviveUsed,
    };
  }

  /** Resume a saved run at its last lantern. */
  restoreAt(sv: RunSave) {
    const L = this.level;
    const l = L.lanterns[sv.lantern];
    if (!l) return;
    for (let i = 0; i <= sv.lantern; i++) { L.lanterns[i].lit = true; L.lanterns[i].charge = 1; }
    this.lastLantern = l;
    for (const lv of L.larvae) if (lv.y < l.y + 100) lv.awake = true;
    for (const w of L.webs) if (w.y < l.y - 300) w.broken = true;
    for (const o of L.owls) if (o.y < l.y) o.state = 3;
    this.blask = sv.blask ?? this.blask;
    this.score = sv.score ?? this.score;
    this.lanternsLit = sv.lanterns ?? this.lanternsLit;
    this.larvaeWoken = sv.larvae ?? this.larvaeWoken;
    this.perfects = sv.perfects ?? this.perfects;
    this.lost = sv.lost ?? this.lost;
    this.reviveUsed = !!sv.reviveUsed || !this.mods.revive;
    const s = this.swarm;
    s.n = 0;
    s.spawn(l.x, l.y - 30, sv.flies ?? this.carry.flies, 100);
    s.cx = l.x; s.cy = l.y - 30; s.tx = l.x; s.ty = l.y;
    this.maxY = l.y - 30;
    this.shadowY = l.y - 1000;
    this.camY = s.cy + 1100 * 0.12;
    this.time = 5;
    while (this.hintIdx < L.hints.length && L.hints[this.hintIdx].y < l.y) this.hintIdx++;
  }

  /** Carry state into the next biome. */
  next(): Carry {
    return {
      seed: this.carry.seed,
      biome: this.carry.biome + 1,
      flies: Math.max(this.swarm.n, BAL.carryMin),
      blask: Math.max(this.blask, 40),
      score: this.score + this.finishBonus,
      lanterns: this.lanternsLit,
      larvae: this.larvaeWoken,
      perfects: this.perfects,
      heightBase: this.heightBase + this.heightScore,
      reviveUsed: this.reviveUsed,
      lost: this.lost,
      species: this.carry.species,
      night: this.carry.night,
      mutations: [...this.carry.mutations],
      daily: this.carry.daily,
    };
  }

  // ------------------------------------------------------------ input
  setTarget(x: number, y: number) {
    const s = this.swarm;
    const hw = this.level.wallAt(1, y) - 10;
    const lw = this.level.wallAt(-1, y) + 10;
    x = clamp(x, lw, hw);
    y = clamp(y, this.camY - this.viewH / 2 + 40, this.camY + this.viewH / 2 - 40);
    // keep the target on a leash so it can't run away from a blocked swarm
    const dx = x - s.cx, dy = y - s.cy;
    const d = Math.hypot(dx, dy), max = 240 + s.radius;
    if (d > max) {
      x = s.cx + (dx / d) * max;
      y = s.cy + (dy / d) * max;
    }
    s.tx = x;
    s.ty = y;
  }

  tryFlash() {
    if (this.state !== 'play' || this.flashCd > 0) return;
    const s = this.swarm;
    const M = this.mods;
    const perfect = s.order > 0.55 && Math.cos(s.psi) > M.perfectCos && s.free >= 8;
    const cost = perfect ? M.perfectCost : M.flashCost;
    if (this.blask < cost) {
      this.events.push({ t: 'noBlask' });
      return;
    }
    this.blask -= cost;
    this.flashCd = 0.35;
    const R = (180 + 6 * Math.sqrt(Math.max(s.free, 1))) * (perfect ? 1.5 : 1) * M.flashR;
    const cx = s.cx, cy = s.cy;
    this.shock = { x: cx, y: cy, t: 0, R, perfect };
    s.flashGlow = perfect ? 2.4 : 1.6;
    s.scatterPhases();
    // webs burn, captives are freed
    for (let w = 0; w < this.level.webs.length; w++) {
      const web = this.level.webs[w];
      if (web.broken) continue;
      if (Math.hypot(web.x - cx, web.y - cy) < R + web.r) {
        web.broken = true;
        web.burn = 1;
        for (let i = 0; i < s.n; i++) {
          if (s.state[i] === STUCK && s.web[i] === w) {
            s.state[i] = FREE;
            s.web[i] = -1;
            s.inWeb[i] = w;
            s.timer[i] = 0;
            s.vx[i] = (Math.random() - 0.5) * 200;
            s.vy[i] = (Math.random() - 0.5) * 200;
          }
        }
        for (const a of web.spokes) {
          for (let k = 0; k < 5; k++) {
            const rr = Math.random() * web.r;
            this.emit(web.x + Math.cos(a) * rr, web.y + Math.sin(a) * rr, 1, 0.55, 0.2, 3, 40, 0.8, 4, -30);
          }
        }
      }
    }
    for (const b of this.bats) if (Math.hypot(b.x - cx, b.y - cy) < R + 30) b.flee = 1;
    HZ.flashHazards(this, cx, cy, R);
    for (const l of this.level.lanterns) if (!l.lit && Math.hypot(l.x - cx, l.y - cy) < R) this.lightLantern(l);
    if (cy - this.shadowY < R + 500) this.shadowY -= perfect ? 320 : 200;
    for (let k = 0; k < (perfect ? 60 : 36); k++) {
      const a = Math.random() * TAU, v = 120 + Math.random() * 260;
      this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.7 + Math.random() * 0.5, size: 3 + Math.random() * 4, r: 1, g: 1, b: 0.7, kind: 3, grav: 0, drag: 2.2 });
    }
    if (perfect) {
      this.perfects++;
      this.score += 25;
    }
    this.events.push({ t: 'flash', perfect });
  }

  // ------------------------------------------------------------ update
  update(dt: number) {
    const s = this.swarm;
    const L = this.level;
    this.time += dt;
    this.stateT += dt;
    this.flashCd = Math.max(0, this.flashCd - dt);
    this.biteSoundCd -= dt;
    this.caughtCd -= dt;

    if (this.state === 'finished' && !this.constellation) {
      s.tx = 0;
      s.ty = s.cy + 120;
      s.guiding = true;
    }
    if (this.constellation) this.constellation.t += dt;

    s.update(dt, this.time, L);

    if (this.demo) {
      this.updateLanterns(dt);
      this.updateParticles(dt);
      this.camY += (s.cy + this.viewH * 0.12 - this.camY) * damp(2, dt);
      return;
    }

    if (this.state === 'play') {
      this.blask = Math.min(100, this.blask + dt * this.mods.regen);
      this.updateShadow(dt);
      this.updateWebs(dt);
      this.updateBats(dt);
      this.updateZones(dt);
      this.updatePickups(dt);
      this.updateHints();
      if (s.free > 0) this.maxY = Math.max(this.maxY, s.cy);
      if (s.cy > L.height - 350 && s.free > 0) {
        this.state = 'finished';
        this.stateT = 0;
        this.finishBonus = s.free * 3;
        if (this.isLast) this.formConstellation();
        this.events.push({ t: 'finish' });
      }
    } else {
      this.updateBats(dt);
      this.updateWebs(dt);
    }
    HZ.updateFrogs(this, dt);
    HZ.updateDragonflies(this, dt);
    HZ.updateOwls(this, dt);
    HZ.updateMoths(this, dt);
    if (this.state === 'play') HZ.updateGusts(this, dt);
    else this.wind *= Math.exp(-dt * 2);
    if (this.biome.rain) HZ.updateRain(this, dt);
    this.updateLanterns(dt);

    s.compact();

    if (this.state === 'play' && s.n === 0) {
      if (!this.reviveUsed) {
        this.state = 'reviving';
        this.stateT = 0;
      } else {
        this.state = 'over';
        this.stateT = 0;
        this.events.push({ t: 'over' });
      }
    }
    if (this.state === 'reviving' && this.stateT > 1.4) this.revive();

    // camera
    if (s.n > 0) {
      const ty = s.cy + this.viewH * 0.12;
      this.camY += (ty - this.camY) * damp(this.state === 'reviving' ? 1.5 : 3.2, dt);
    }

    if (this.shock) {
      this.shock.t += dt;
      if (this.shock.t > 1) this.shock = null;
    }
    this.updateParticles(dt);
  }

  private revive() {
    const s = this.swarm;
    this.reviveUsed = true;
    const at = this.lastLantern ? { x: this.lastLantern.x, y: this.lastLantern.y - 30 } : { x: 0, y: Math.max(this.maxY - 200, 260) };
    s.spawn(at.x, at.y, 70, 160);
    s.cx = at.x;
    s.cy = at.y;
    s.tx = at.x;
    s.ty = at.y + 40;
    this.shadowY = Math.min(this.shadowY, at.y - 900);
    this.bats.length = 0;
    this.warns.length = 0;
    this.dragonflies.length = 0;
    this.moths.length = 0;
    this.blask = Math.max(this.blask, 50);
    this.state = 'play';
    this.stateT = 0;
    for (let k = 0; k < 50; k++) {
      const a = Math.random() * TAU, v = 60 + Math.random() * 200;
      this.particles.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 1 + Math.random(), size: 4, r: 0.7, g: 1, b: 0.4, kind: 3, grav: 0, drag: 1.5 });
    }
    this.events.push({ t: 'revive' });
  }

  private updateShadow(dt: number) {
    const s = this.swarm;
    const d = this.progress;
    let speed = (this.biome.shadowBase + this.biome.shadowRamp * d) * this.mods.shadow;
    const gap = s.cy - this.shadowY;
    if (gap > BAL.shadowLeash) speed += (gap - BAL.shadowLeash) * BAL.shadowCatchUp;
    if (this.time < 4) speed = 0;
    this.shadowY += speed * dt;
    const kill = this.shadowY + 12;
    const p = 1 - Math.exp(-BAL.shadowKill * dt);
    let n = 0;
    for (let i = 0; i < s.n; i++) {
      if (s.state[i] === 2) continue;
      if (s.y[i] < kill && Math.random() < p) {
        s.kill(i);
        this.emit(s.x[i], s.y[i], 0.7, 0.3, 1, 0, 14, 0.6, 1, 30);
        n++;
      }
    }
    if (n) {
      this.lost += n;
      this.lostBy.shadow = (this.lostBy.shadow ?? 0) + n;
      this.shadowAcc += n;
    }
    if (this.shadowAcc > 0 && this.biteSoundCd <= 0) {
      this.events.push({ t: 'shadowLoss', n: this.shadowAcc });
      this.shadowAcc = 0;
      this.biteSoundCd = 0.25;
    }
    if (gap < 420 && !this.dynHints.has('shadow') && this.time > 6) {
      this.dynHints.add('shadow');
      this.events.push({ t: 'hint', id: 'shadow' });
    }
  }

  private updateWebs(dt: number) {
    const s = this.swarm;
    const webs = this.level.webs;
    for (let w = 0; w < webs.length; w++) {
      const web = webs[w];
      web.shake = Math.max(0, web.shake - dt * 3);
      if (web.burn > 0) web.burn = Math.max(0, web.burn - dt * 1.2);
      if (web.broken || Math.abs(web.y - s.cy) > 700) continue;
      const r2 = (web.r * 0.9) ** 2;
      for (let i = 0; i < s.n; i++) {
        if (s.state[i] !== FREE) continue;
        const dx = s.x[i] - web.x, dy = s.y[i] - web.y;
        const inside = dx * dx + dy * dy < r2;
        if (inside && s.inWeb[i] !== w) {
          s.inWeb[i] = w;
          if (web.caught < web.cap + this.mods.webCap && Math.random() < this.mods.webCatch) {
            s.state[i] = STUCK;
            s.web[i] = w;
            s.timer[i] = 0;
            s.vx[i] = 0;
            s.vy[i] = 0;
            web.caught++;
            web.shake = 1;
            if (this.caughtCd <= 0) {
              this.events.push({ t: 'caught' });
              this.caughtCd = 0.3;
            }
            if (!this.dynHints.has('flash')) {
              this.dynHints.add('flash');
              this.events.push({ t: 'hint', id: 'flash' });
            }
          }
        } else if (!inside && s.inWeb[i] === w) s.inWeb[i] = -1;
      }
    }
    for (let i = 0; i < s.n; i++) {
      if (s.state[i] === STUCK && s.timer[i] > BAL.web.starve) {
        s.kill(i);
        this.lost++;
        this.lostBy.web = (this.lostBy.web ?? 0) + 1;
        this.emit(s.x[i], s.y[i], 1, 0.5, 0.2, 0, 10, 0.8, 1, 20);
      }
    }
  }

  private updateBats(dt: number) {
    const s = this.swarm;
    const L = this.level;
    const d = this.progress;
    if (this.state === 'play') {
      for (const z of L.zones) {
        if (z.kind !== 'bats' || s.cy < z.y0 || s.cy > z.y1) continue;
        z.timer -= dt;
        if (z.timer <= 0) {
          z.timer = z.interval * this.mods.hazard * (0.8 + Math.random() * 0.4);
          const side = Math.random() < 0.5 ? -1 : 1;
          const y = clamp(s.cy + (Math.random() * 340 - 80), this.camY - this.viewH / 2 + 100, this.camY + this.viewH / 2 - 100);
          this.warns.push({ side, y, t: 0, speed: BAL.bat.speed + d * BAL.bat.speedRamp });
          this.events.push({ t: 'batWarn', side });
        }
      }
    }
    for (let k = this.warns.length - 1; k >= 0; k--) {
      const w = this.warns[k];
      w.t += dt;
      if (w.t >= BAL.bat.warn * this.mods.warn) {
        this.warns.splice(k, 1);
        // bats come out from behind the side trunks
        const x = w.side * (HALF_W + 40);
        // aim where the swarm will be
        const px = s.cx + s.vcx * 0.5, py = s.cy + s.vcy * 0.5;
        const dx = px - x, dy = py - w.y;
        const l = Math.hypot(dx, dy) || 1;
        this.bats.push({ x, y: w.y, vx: (dx / l) * w.speed, vy: (dy / l) * w.speed, t: 0, flee: 0, bites: 0, phase: Math.random() * TAU });
      }
    }
    let bitten = 0;
    for (let k = this.bats.length - 1; k >= 0; k--) {
      const b = this.bats[k];
      b.t += dt;
      if (b.flee > 0) {
        const dx = b.x - s.cx, dy = b.y - s.cy;
        const l = Math.hypot(dx, dy) || 1;
        b.vx += ((dx / l) * 520 - b.vx) * dt * 3;
        b.vy += ((dy / l) * 520 + 200 - b.vy) * dt * 3;
      }
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const wob = Math.cos(b.t * 5.5 + b.phase) * 70;
      b.x += b.vx * dt + (-b.vy / sp) * wob * dt;
      b.y += b.vy * dt + (b.vx / sp) * wob * dt;
      if (b.flee <= 0 && b.bites < BAL.bat.bites * this.biteMul && this.state === 'play') {
        for (let i = 0; i < s.n && b.bites < BAL.bat.bites * this.biteMul; i++) {
          if (s.state[i] !== FREE) continue;
          const dx = s.x[i] - b.x, dy = s.y[i] - b.y;
          if (dx * dx + dy * dy < 26 * 26) {
            if (Math.random() < this.mods.dodge) continue;
            s.kill(i);
            b.bites++;
            bitten++;
            this.emit(s.x[i], s.y[i], 1, 0.9, 0.4, 0, 8, 0.5, 1, 0);
          }
        }
      }
      const out = Math.abs(b.x) > this.viewW / 2 + 300 || Math.abs(b.y - this.camY) > this.viewH;
      if (b.t > 1 && out) this.bats.splice(k, 1);
    }
    if (bitten) {
      this.lost += bitten;
      this.lostBy.bat = (this.lostBy.bat ?? 0) + bitten;
      this.events.push({ t: 'bite', n: bitten });
    }
  }

  private updateZones(dt: number) {
    const s = this.swarm;
    for (const z of this.level.zones) {
      if (z.kind === 'bats' || s.cy < z.y0 || s.cy > z.y1) continue;
      z.timer -= dt;
      if (z.timer > 0) continue;
      z.timer = z.interval * this.mods.hazard * (0.8 + Math.random() * 0.4);
      if (z.kind === 'dragonflies') {
        if (this.dragonflies.length < 2) HZ.spawnDragonfly(this);
      } else if (this.moths.length < 7) {
        HZ.spawnMoth(this);
        if (Math.random() < 0.3 + this.progress * 0.5) HZ.spawnMoth(this);
      }
    }
  }

  private formConstellation() {
    const s = this.swarm;
    const r = makeRng(hashString(`${this.carry.seed}:sky`));
    const n = clamp(4 + Math.floor(s.free / 45), 4, 9);
    const y0 = s.cy + 320;
    const stars: [number, number][] = [[r.range(-80, 80), y0]];
    const links: [number, number][] = [];
    for (let k = 1; k < n; k++) {
      const from = k > 3 && r.chance(0.3) ? r.int(0, k - 2) : k - 1;
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        const a = r.range(0, TAU), d = r.range(80, 140);
        x = clamp(stars[from][0] + Math.cos(a) * d, -210, 210);
        y = clamp(stars[from][1] + Math.sin(a) * d, y0 - 180, y0 + 240);
        if (stars.every(([sx, sy]) => Math.hypot(sx - x, sy - y) > 70)) break;
      }
      stars.push([x, y]);
      links.push([from, k]);
    }
    const adj = ['Mała', 'Wielka', 'Śpiąca', 'Tańcząca', 'Zbłąkana', 'Cicha', 'Srebrna', 'Północna', 'Leśna', 'Senna'];
    const noun = ['Ważka', 'Żaba', 'Sowa', 'Paproć', 'Kropla', 'Ćma', 'Trzcina', 'Iskra', 'Gałązka', 'Latarnia', 'Miechunka'];
    this.constellation = { name: `${r.pick(adj)} ${r.pick(noun)}`, stars, links, t: 0 };
    let k = 0;
    for (let i = 0; i < s.n; i++) {
      const [x, y] = stars[k++ % n];
      const a = Math.random() * TAU, d = Math.random() * 7;
      s.formX[i] = x + Math.cos(a) * d;
      s.formY[i] = y + Math.sin(a) * d;
    }
    s.formOn = true;
  }

  private updatePickups(_dt: number) {
    const s = this.swarm;
    const L = this.level;
    if (s.free === 0) return;
    const mercy = BAL.mercy.find(([below]) => s.free < below)?.[1] ?? 1;
    for (const lv of L.larvae) {
      if (lv.awake) continue;
      if (Math.abs(lv.y - s.cy) > 400) continue;
      const d = Math.hypot(lv.x - s.cx, lv.y - s.cy);
      if (d < s.radius + 45) {
        lv.awake = true;
        const n = Math.min(Math.round(lv.n * mercy * this.mods.larva), MAX_ALIVE() - s.n);
        if (n > 0) s.spawn(lv.x, lv.y, n, 140);
        this.gained += Math.max(0, n);
        this.larvaeWoken += n;
        this.score += 5 * n;
        for (let k = 0; k < 18; k++) {
          const a = Math.random() * TAU, v = 40 + Math.random() * 120;
          this.particles.push({ x: lv.x, y: lv.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 30, life: 0, max: 0.6 + Math.random() * 0.6, size: 3 + Math.random() * 3, r: 0.7, g: 1, b: 0.45, kind: 3, grav: -20, drag: 2 });
        }
        this.events.push({ t: 'larva', x: lv.x, y: lv.y, n });
      }
    }
    for (const l of L.lanterns) {
      if (l.lit || Math.abs(l.y - s.cy) > 350) continue;
      let c = 0;
      for (let i = 0; i < s.n; i++) {
        if (s.state[i] !== FREE) continue;
        const dx = s.x[i] - l.x, dy = s.y[i] - l.y;
        if (dx * dx + dy * dy < 95 * 95) c++;
      }
      const need = Math.min(20, Math.max(5, Math.floor(s.free * 0.4)));
      if (c >= need) l.charge += _dt / 0.9;
      else l.charge = Math.max(0, l.charge - _dt * 0.6);
      if (l.charge >= 1) this.lightLantern(l);
    }
  }

  private lightLantern(l: Lantern) {
    l.lit = true;
    l.charge = 1;
    this.lanternsLit++;
    this.lastLantern = l;
    this.blask = Math.min(100, this.blask + this.mods.lanternBlask);
    if (this.mods.lanternFlies) this.swarm.spawn(l.x, l.y, Math.min(this.mods.lanternFlies, MAX_ALIVE() - this.swarm.n), 150);
    this.score += 100;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * TAU, v = 60 + Math.random() * 180;
      this.particles.push({ x: l.x, y: l.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.8 + Math.random() * 0.8, size: 3 + Math.random() * 4, r: 1, g: 0.6, b: 0.2, kind: 3, grav: -30, drag: 2 });
    }
    this.events.push({ t: 'lantern', x: l.x, y: l.y, k: this.lanternsLit, star: l.star });
  }

  private updateLanterns(dt: number) {
    const s = this.swarm;
    for (const l of this.level.lanterns) {
      l.t += dt;
      // pendulum pushed by the passing swarm
      const d = Math.hypot(l.x - s.cx, l.y - s.cy);
      const push = d < 160 ? s.vcx * 0.004 * (1 - d / 160) : 0;
      l.av += (-l.ang * 7 - l.av * 0.8 + push + Math.sin(this.time * 0.9 + l.ax) * 0.15) * dt;
      l.ang += l.av * dt;
      l.x = l.ax + Math.sin(l.ang) * l.len;
      l.y = l.ay - Math.cos(l.ang) * l.len;
    }
  }

  private updateHints() {
    const h = this.level.hints;
    while (this.hintIdx < h.length && this.swarm.cy > h[this.hintIdx].y) {
      this.events.push({ t: 'hint', id: h[this.hintIdx].id });
      this.hintIdx++;
    }
    const s = this.swarm;
    if (!this.dynHints.has('sync') && this.time > 25 && s.order > 0.7) {
      this.dynHints.add('sync');
      this.events.push({ t: 'hint', id: 'sync' });
    }
  }

  emit(x: number, y: number, r: number, g: number, b: number, kind: number, speed: number, life: number, size: number, grav: number) {
    if (this.particles.length > 700) this.particles.shift();
    const a = Math.random() * TAU, v = Math.random() * speed;
    this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: life * (0.6 + Math.random() * 0.8), size: size * (2 + Math.random() * 2), r, g, b, kind, grav, drag: 1.5 });
  }

  private updateParticles(dt: number) {
    const ps = this.particles;
    for (let k = ps.length - 1; k >= 0; k--) {
      const p = ps[k];
      p.life += dt;
      if (p.life >= p.max) {
        ps[k] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy = p.vy * dr - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
}
