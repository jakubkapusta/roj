// A player model for the headless simulator. `skill` 0..1 scales reaction time,
// how reliably threats are noticed, and how well flashes are timed.

import type { Game } from '../game/game';
import { frogMouth } from '../game/hazards';

type Dodge = { x: number; y: number; until: number };

export class Bot {
  private t = 0;
  private next = 0;
  private gx = 0;
  private gy = 0;
  private dodge: Dodge | null = null;
  private shelter: { x: number; y: number } | null = null;
  private wantsPerfect = 0; // time until which a non-urgent flash waits for the pulse
  private lapse = 0; // attention lapse (a look out of the train window) until this time
  constructor(private skill: number, private rnd: () => number = Math.random) {}

  private sees(p: number) {
    return this.rnd() < p;
  }

  step(g: Game, dt: number) {
    this.t += dt;
    const s = g.swarm;
    if (g.state !== 'play') return;
    // now and then the player looks away: the swarm just hovers
    if (this.t < this.lapse) { s.guiding = false; return; }
    if (this.rnd() < dt * (0.02 + (1 - this.skill) * 0.06)) { this.lapse = this.t + 0.8 + this.rnd() * 1.6; return; }
    s.guiding = true;
    if (this.t < this.next) {
      g.setTarget(this.gx, this.gy);
      return;
    }
    const k = this.skill;
    this.next = this.t + 0.08 + (1 - k) * 0.3 + this.rnd() * 0.08;
    this.flash(g);
    this.move(g);
    g.setTarget(this.gx, this.gy);
  }

  // ------------------------------------------------------------ flashing
  private flash(g: Game) {
    const s = g.swarm;
    const k = this.skill;
    const cost = g.mods.flashCost;
    const canPerfect = s.order > 0.55 && Math.cos(s.psi) > g.mods.perfectCos;
    let urgent = false, soft = false;
    // captives in a web starve in a few seconds
    if (s.n - s.free >= 6 && this.sees(0.4 + 0.5 * k)) soft = true;
    // an owl opening its eyes: the one moment a flash blinds it
    for (const o of g.level.owls) if (o.state === 1 && Math.abs(o.y - s.cy) < 500 && this.sees(0.25 + 0.7 * k)) urgent = true;
    for (const b of g.bats) {
      if (b.flee > 0) continue;
      const dx = s.cx - b.x, dy = s.cy - b.y, d = Math.hypot(dx, dy);
      if (d < 190 && (dx * b.vx + dy * b.vy) > 0 && this.sees(0.3 + 0.6 * k)) urgent = true;
    }
    let moths = 0;
    for (const m of g.moths) if (Math.hypot(m.x - s.cx, m.y - s.cy) < 140) moths++;
    if (moths >= 2 || (moths === 1 && g.blask > 70)) soft = true;
    if (urgent && g.blask >= cost) return g.tryFlash();
    if (soft) {
      if (canPerfect || g.blask >= cost + 20 || this.t > this.wantsPerfect + 1.2 * k) {
        if (canPerfect || g.blask >= cost) { g.tryFlash(); this.wantsPerfect = this.t; }
      } else if (this.wantsPerfect < this.t - 2) this.wantsPerfect = this.t;
    }
  }

  // ------------------------------------------------------------ moving
  private move(g: Game) {
    const s = g.swarm;
    const L = g.level;
    const k = this.skill;
    const pace = 0.7 + 0.3 * k;
    let gx = s.cx * 0.6, gy = s.cy + (170 + 110 * k) * pace;

    // the Shadow right behind: just climb
    const rush = s.cy - g.shadowY < 320;

    // dodge in progress
    if (this.dodge && this.t < this.dodge.until) {
      this.gx = this.dodge.x;
      this.gy = this.dodge.y;
      return;
    }
    this.dodge = null;

    if (!rush) {
      // frogs aiming at us
      for (const f of L.frogs) {
        if (f.state !== 1) continue;
        const m = frogMouth(f);
        const dl = distToLine(s.cx, s.cy, m.x, m.y, f.tx, f.ty);
        if (dl < s.radius + 40 && this.sees(0.2 + 0.75 * k)) return this.setDodge(s, m.x, m.y, f.tx, f.ty, 0.9);
      }
      for (const d of g.dragonflies) {
        if (d.state !== 1) continue;
        const ex = d.x + (d.tx - d.x) * 2, ey = d.y + (d.ty - d.y) * 2;
        if (distToLine(s.cx, s.cy, d.x, d.y, ex, ey) < s.radius + 30 && this.sees(0.2 + 0.7 * k)) return this.setDodge(s, d.x, d.y, ex, ey, 0.7, true);
      }
      // bats we can't flash: step out of their line
      for (const b of g.bats) {
        if (b.flee > 0) continue;
        const d = Math.hypot(b.x - s.cx, b.y - s.cy);
        if (d < 320 && g.blask < g.mods.flashCost && this.sees(0.2 + 0.6 * k)) {
          return this.setDodge(s, b.x, b.y, b.x + b.vx, b.y + b.vy, 0.6, true);
        }
      }
    }
    // rain: hide under a leaf when a downpour comes
    if (g.biome.rain && g.rainPhase >= 1 && !rush) {
      if (!this.shelter && this.sees(0.3 + 0.65 * k)) this.shelter = findShelter(g);
      if (this.shelter) {
        this.gx = this.shelter.x;
        this.gy = this.shelter.y;
        return;
      }
    } else this.shelter = null;

    if (!rush) {
      // lantern ahead: light it
      for (const l of L.lanterns) {
        if (l.lit) continue;
        const dy = l.y - s.cy;
        if (dy > -80 && dy < 480 && this.sees(0.5 + 0.5 * k)) { gx = l.x; gy = l.y; break; }
      }
      // larvae nearby: a worthwhile detour
      if (gx === s.cx * 0.6) {
        let best = 1e9;
        for (const lv of L.larvae) {
          if (lv.awake) continue;
          const dy = lv.y - s.cy, dx = lv.x - s.cx;
          if (dy < -40 || dy > 420 || Math.abs(dx) > 280) continue;
          const c = Math.hypot(dx, dy);
          if (c < best && this.sees(0.35 + 0.55 * k)) { best = c; gx = lv.x; gy = lv.y + 20; }
        }
      }
    }
    // steer around webs we can see (they only show in our light)
    for (const w of L.webs) {
      if (w.broken) continue;
      const dy = w.y - s.cy;
      if (dy < -60 || dy > 320) continue;
      const clear = w.r + s.radius * 0.8 + 30;
      if (Math.abs(gx - w.x) < clear && this.sees(0.25 + 0.7 * k)) {
        const left = w.x - clear, right = w.x + clear;
        const sl = L.sdfAt(left, w.y), sr = L.sdfAt(right, w.y);
        gx = sl > sr ? left : right;
        gy = Math.max(gy, w.y + 40);
      }
    }
    this.gx = gx;
    this.gy = gy;
  }

  private setDodge(s: { cx: number; cy: number }, ax: number, ay: number, bx: number, by: number, dur: number, preferUp = false) {
    // move perpendicular to the attack line: away from it, or upward when either side will do
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    let nx = -dy / l, ny = dx / l;
    const side = (s.cx - ax) * nx + (s.cy - ay) * ny;
    if (preferUp ? ny < 0 : side < 0) { nx = -nx; ny = -ny; }
    this.dodge = { x: s.cx + nx * 170, y: s.cy + ny * 170 + 20, until: this.t + dur };
    this.gx = this.dodge.x;
    this.gy = this.dodge.y;
  }
}

function distToLine(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

/** Nearest free spot where a roof covers the whole swarm width. */
function findShelter(g: Game) {
  const s = g.swarm, L = g.level;
  const half = Math.min(90, s.radius * 0.9);
  const covered = (x: number, y: number) => {
    for (let h = 20; h <= 110; h += 15) if (L.sdfAt(x, y + h) < 0) return true;
    return false;
  };
  let best: { x: number; y: number } | null = null, bd = 1e9;
  for (let dy = -150; dy <= 350; dy += 30) {
    for (let dx = -260; dx <= 260; dx += 30) {
      const x = s.cx + dx, y = s.cy + dy;
      if (L.sdfAt(x, y) < 24) continue;
      let ok = true;
      for (let o = -half; o <= half && ok; o += half / 2) ok = covered(x + o, y);
      if (!ok) continue;
      const d = Math.hypot(dx, dy * 1.4);
      if (d < bd) { bd = d; best = { x, y: y - 20 }; }
    }
  }
  return best;
}
