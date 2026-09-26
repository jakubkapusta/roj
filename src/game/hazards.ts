// Biome hazards beyond webs and bats: frogs, dragonflies, owls, gusts, rain + lightning, moths.
// Each works on the Game's state; the renderer draws them from the same arrays.

import { clamp, TAU } from '../core/math';
import { FREE } from './swarm';
import type { Game } from './game';
import { HALF_W } from './level';
import { BAL } from './balance';

export type Dragonfly = {
  x: number; y: number; vx: number; vy: number; t: number;
  state: number; // 0 approach, 1 aim, 2 dash, 3 leave
  hx: number; hy: number; tx: number; ty: number;
  dashes: number; bites: number; phase: number;
};
export type Moth = { x: number; y: number; vx: number; vy: number; t: number; eaten: number; phase: number; eatT: number; leave: boolean };
export type Drop = { x: number; y: number; vy: number };


/** Kill fly i with a small burst of embers. */
function killFly(g: Game, i: number, r: number, gg: number, b: number, cause: string) {
  const s = g.swarm;
  s.kill(i);
  g.lost++;
  g.lostBy[cause] = (g.lostBy[cause] ?? 0) + 1;
  g.emit(s.x[i], s.y[i], r, gg, b, 0, 10, 0.5, 1, 10);
}

/** Kill free flies within `rad` of segment a-b, up to `max`. Returns kills. */
function killAlong(g: Game, ax: number, ay: number, bx: number, by: number, rad: number, max: number, col: [number, number, number], cause: string) {
  const s = g.swarm;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const r2 = rad * rad;
  let n = 0;
  for (let i = 0; i < s.n && n < max; i++) {
    if (s.state[i] !== FREE) continue;
    let t = ((s.x[i] - ax) * dx + (s.y[i] - ay) * dy) / l2;
    t = clamp(t, 0, 1);
    const qx = ax + dx * t - s.x[i], qy = ay + dy * t - s.y[i];
    if (qx * qx + qy * qy < r2) {
      if (Math.random() < g.mods.dodge) continue;
      killFly(g, i, col[0], col[1], col[2], cause);
      n++;
    }
  }
  return n;
}

// ------------------------------------------------------------ frogs
export function frogMouth(f: { x: number; y: number; face: number }) {
  return { x: f.x + f.face * 20, y: f.y + 9 };
}

export function updateFrogs(g: Game, dt: number) {
  const s = g.swarm;
  for (const f of g.level.frogs) {
    f.blink -= dt;
    if (f.blink < -0.15) f.blink = 2 + Math.random() * 4;
    if (Math.abs(f.y - s.cy) > 700) continue;
    f.t += dt;
    const m = frogMouth(f);
    switch (f.state) {
      case 0: {
        f.cool -= dt;
        const d = Math.hypot(s.cx - m.x, s.cy - m.y);
        if (f.cool <= 0 && d < BAL.frog.range && s.free > 0 && g.state === 'play') {
          // aim where the swarm is heading, but never beyond reach
          let tx = s.cx + s.vcx * 0.45, ty = s.cy + s.vcy * 0.45;
          const dx = tx - m.x, dy = ty - m.y, l = Math.hypot(dx, dy) || 1;
          const reach = Math.min(l + 40, BAL.frog.range + 40);
          tx = m.x + (dx / l) * reach;
          ty = m.y + (dy / l) * reach;
          f.tx = tx;
          f.ty = ty;
          f.state = 1;
          f.t = 0;
          g.events.push({ t: 'frogAim' });
        }
        break;
      }
      case 1:
        if (f.t > BAL.frog.aim * g.mods.warn) { f.state = 2; f.t = 0; g.events.push({ t: 'frogStrike' }); }
        break;
      case 2: {
        const k = Math.min(1, f.t / 0.1);
        const ex = m.x + (f.tx - m.x) * k, ey = m.y + (f.ty - m.y) * k;
        const n = killAlong(g, m.x, m.y, ex, ey, 14, BAL.frog.bites * g.biteMul - f.eaten, [1, 0.5, 0.6], 'frog');
        f.eaten += n;
        if (n) g.events.push({ t: 'bite', n });
        if (f.t > 0.16) { f.state = 3; f.t = 0; }
        break;
      }
      case 3:
        if (f.t > 0.25) { f.state = 0; f.t = 0; f.cool = BAL.frog.cool * (1 + Math.random() * 0.5) * g.mods.hazard; f.eaten = 0; }
        break;
      case 4:
        if (f.t > 3) { f.state = 0; f.t = 0; f.cool = 1; }
        break;
    }
  }
}

// ------------------------------------------------------------ dragonflies
function hoverPoint(g: Game) {
  const s = g.swarm;
  const side = Math.random() < 0.5 ? -1 : 1;
  return { x: clamp(s.cx + side * (150 + Math.random() * 80), -250, 250), y: s.cy + 120 + Math.random() * 140 };
}

export function spawnDragonfly(g: Game) {
  const h = hoverPoint(g);
  g.dragonflies.push({ x: h.x + (Math.random() - 0.5) * 300, y: g.camY + g.viewH / 2 + 60, vx: 0, vy: -200, t: 0, state: 0, hx: h.x, hy: h.y, tx: 0, ty: 0, dashes: 0, bites: 0, phase: Math.random() * TAU });
  g.events.push({ t: 'dragonfly' });
}

export function updateDragonflies(g: Game, dt: number) {
  const s = g.swarm;
  for (let k = g.dragonflies.length - 1; k >= 0; k--) {
    const d = g.dragonflies[k];
    d.t += dt;
    if (d.state === 0 || d.state === 3) {
      const tx = d.state === 3 ? d.x + (d.x > 0 ? 400 : -400) : d.hx;
      const ty = d.state === 3 ? d.y + 500 : d.hy;
      const dx = tx - d.x, dy = ty - d.y, l = Math.hypot(dx, dy) || 1;
      const sp = d.state === 3 ? 520 : Math.min(420, l * 3);
      d.vx += ((dx / l) * sp - d.vx) * dt * 5;
      d.vy += ((dy / l) * sp - d.vy) * dt * 5;
      d.x += d.vx * dt + Math.sin(d.t * 9 + d.phase) * 30 * dt;
      d.y += d.vy * dt + Math.cos(d.t * 7 + d.phase) * 30 * dt;
      if (d.state === 0 && (l < 18 || d.t > 3)) {
        d.state = 1;
        d.t = 0;
        d.tx = s.cx + s.vcx * 0.3;
        d.ty = s.cy + s.vcy * 0.3;
      }
      if (d.state === 3 && Math.abs(d.y - g.camY) > g.viewH) g.dragonflies.splice(k, 1);
    } else if (d.state === 1) {
      d.x += Math.sin(d.t * 40) * 0.6;
      if (d.t > BAL.dragonfly.aim * g.mods.warn) {
        d.state = 2;
        d.t = 0;
        const dx = d.tx - d.x, dy = d.ty - d.y, l = Math.hypot(dx, dy) || 1;
        d.vx = (dx / l) * BAL.dragonfly.dash;
        d.vy = (dy / l) * BAL.dragonfly.dash;
        // overshoot through the target
        d.tx += (dx / l) * 110;
        d.ty += (dy / l) * 110;
        g.events.push({ t: 'dash' });
      }
    } else if (d.state === 2) {
      const ox = d.x, oy = d.y;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const n = killAlong(g, ox, oy, d.x, d.y, 16, BAL.dragonfly.bites * g.biteMul - d.bites, [0.4, 0.9, 1], 'dragonfly');
      d.bites += n;
      if (n) g.events.push({ t: 'bite', n });
      if ((d.tx - d.x) * d.vx + (d.ty - d.y) * d.vy <= 0) {
        d.dashes++;
        d.bites = 0;
        d.t = 0;
        d.vx *= 0.2;
        d.vy *= 0.2;
        if (d.dashes >= 3) d.state = 3;
        else {
          const h = hoverPoint(g);
          d.hx = h.x;
          d.hy = h.y;
          d.state = 0;
        }
      }
    }
  }
}

// ------------------------------------------------------------ owls
export function updateOwls(g: Game, dt: number) {
  const s = g.swarm;
  for (const o of g.level.owls) {
    if (o.state === 3) continue;
    o.t += dt;
    if (o.state === 0) {
      if (Math.abs(s.cy - o.y) < 380 && s.free > 0 && g.state === 'play') {
        o.state = 1;
        o.t = 0;
        g.events.push({ t: 'owl' });
      }
    } else if (o.state === 1) {
      if (o.t > BAL.owl.warn * g.mods.warn) {
        o.state = 2;
        o.t = 0;
        // bezier through the predicted swarm position, exit on the other side
        const tx = s.cx + s.vcx * 0.55, ty = s.cy + s.vcy * 0.55;
        const ex = -o.side * 520, ey = ty + 320;
        o.vx = tx;
        o.vy = ty;
        (o as OwlPath).ex = ex;
        (o as OwlPath).ey = ey;
        g.events.push({ t: 'swoop' });
      }
    } else if (o.state === 2) {
      const p = o as OwlPath;
      const T = 1.15;
      const u = Math.min(1, o.t / T);
      // control point so that the curve passes through the target at u = 0.5
      const cx = 2 * o.vx - (o.x + p.ex) / 2, cy = 2 * o.vy - (o.y + p.ey) / 2;
      const nx = (1 - u) * (1 - u) * o.x + 2 * (1 - u) * u * cx + u * u * p.ex;
      const ny = (1 - u) * (1 - u) * o.y + 2 * (1 - u) * u * cy + u * u * p.ey;
      if (!p.veer) {
        const n = killAlong(g, o.px, o.py, nx, ny, 34, BAL.owl.bites * g.biteMul - o.bites, [1, 0.8, 0.5], 'owl');
        o.bites += n;
        if (n) g.events.push({ t: 'bite', n });
        o.px = nx;
        o.py = ny;
      } else {
        o.px += (o.px - s.cx > 0 ? 1 : -1) * 500 * dt;
        o.py += 420 * dt;
      }
      if (u >= 1) o.state = 3;
    } else if (o.state === 4) {
      if (o.t > 2.2) o.state = 3;
    }
  }
}
type OwlPath = { ex: number; ey: number; veer?: boolean } & Game['level']['owls'][number];

// ------------------------------------------------------------ gusts
/** 0..1 strength of the gust affecting y right now, negative phase = warning. */
export function gustAt(g: Game, y: number): { dir: number; env: number; warn: number } {
  for (const z of g.level.gusts) {
    if (y < z.y0 || y > z.y1) continue;
    const ph = ((g.time + z.phase) % z.period + z.period) % z.period;
    const warn = ph < 1 ? ph : 0;
    const a = ph - 1;
    const env = a > 0 && a < 1.8 ? Math.sin((a / 1.8) * Math.PI) : 0;
    return { dir: z.dir, env: env * z.strength, warn };
  }
  return { dir: 0, env: 0, warn: 0 };
}

export function updateGusts(g: Game, dt: number) {
  const s = g.swarm;
  const gs = gustAt(g, s.cy);
  g.wind = gs.env / 600;
  g.windDir = gs.dir;
  if (gs.warn > 0 && gs.warn < dt * 1.5) g.events.push({ t: 'gust' });
  if (gs.env > 0) {
    const f = gs.dir * gs.env * dt;
    for (let i = 0; i < s.n; i++) if (s.state[i] === FREE) s.vx[i] += f;
  }
  // visible streaks while warning or blowing
  if ((gs.warn > 0 || gs.env > 0) && Math.random() < dt * 40) {
    const x = -gs.dir * (g.viewW / 2 + 20);
    const y = g.camY + (Math.random() - 0.5) * g.viewH;
    g.particles.push({ x, y, vx: gs.dir * (700 + Math.random() * 400), vy: (Math.random() - 0.5) * 60, life: 0, max: 1.4, size: 26, r: 0.35, g: 0.4, b: 0.45, kind: 6, grav: 0, drag: 0 });
  }
}

// ------------------------------------------------------------ rain and lightning
export function updateRain(g: Game, dt: number) {
  const s = g.swarm;
  const L = g.level;
  // cycle: calm -> warning -> downpour
  g.rainT -= dt;
  if (g.rainT <= 0) {
    if (g.rainPhase === 0) { g.rainPhase = 1; g.rainT = 1.8; g.events.push({ t: 'rainWarn' }); }
    else if (g.rainPhase === 1) { g.rainPhase = 2; g.rainT = BAL.rain.pourTime + g.progress * BAL.rain.pourRamp; }
    else { g.rainPhase = 0; g.rainT = BAL.rain.calmTime + Math.random() * 4 - g.progress * 2; }
  }
  const target = g.rainPhase === 2 ? 1 : g.rainPhase === 1 ? 0.35 : 0.12;
  g.rain += (target - g.rain) * Math.min(1, dt * 2);
  // lethal drops
  const rate = BAL.rain.calm + g.rain * BAL.rain.pour;
  let spawn = rate * dt;
  while (spawn > 0) {
    if (Math.random() < spawn) {
      g.drops.push({ x: (Math.random() - 0.5) * 620, y: g.camY + g.viewH / 2 + 40, vy: -(950 + Math.random() * 250) });
    }
    spawn -= 1;
  }
  let hits = 0;
  for (let k = g.drops.length - 1; k >= 0; k--) {
    const d = g.drops[k];
    const oy = d.y;
    d.y += d.vy * dt;
    let dead = d.y < g.camY - g.viewH / 2 - 60;
    // swept test so fast drops can't tunnel through a thin leaf
    let hitY = NaN;
    for (let yy = oy; yy >= d.y; yy -= 8) if (L.sdfAt(d.x, yy) < 0) { hitY = yy; break; }
    if (!dead && hitY === hitY) {
      d.y = hitY;
      dead = true;
      for (let j = 0; j < 3; j++) g.particles.push({ x: d.x, y: d.y, vx: (Math.random() - 0.5) * 140, vy: 60 + Math.random() * 90, life: 0, max: 0.35, size: 3, r: 0.4, g: 0.5, b: 0.6, kind: 0, grav: 500, drag: 0 });
    }
    if (!dead && g.state === 'play') {
      for (let i = 0; i < s.n; i++) {
        if (s.state[i] !== FREE) continue;
        if (Math.abs(s.x[i] - d.x) < 6 && s.y[i] <= oy && s.y[i] >= d.y) {
          killFly(g, i, 0.5, 0.7, 1, 'rain');
          hits++;
          dead = true;
          break;
        }
      }
    }
    if (dead) g.drops.splice(k, 1);
  }
  if (hits) g.events.push({ t: 'bite', n: hits });
  // lightning
  g.lightning = Math.max(0, g.lightning - dt * 2.2);
  g.boltT -= dt;
  if (g.boltT <= 0) {
    g.boltT = 6 + Math.random() * 7;
    g.lightning = 1;
    g.boltX = (Math.random() - 0.5) * 500;
    g.boltSeed = Math.random() * 1000;
    g.events.push({ t: 'thunder', delay: 0.25 + Math.random() * 0.9 });
  }
}

// ------------------------------------------------------------ moths
export function spawnMoth(g: Game) {
  const side = Math.random() < 0.5 ? -1 : 1;
  g.moths.push({ x: side * (HALF_W + 30), y: g.camY + (Math.random() * 0.8 - 0.2) * g.viewH / 2, vx: -side * 120, vy: 0, t: 0, eaten: 0, phase: Math.random() * TAU, eatT: 0, leave: false });
}

export function updateMoths(g: Game, dt: number) {
  const s = g.swarm;
  for (let k = g.moths.length - 1; k >= 0; k--) {
    const m = g.moths[k];
    m.t += dt;
    // drawn to the nearest light: a lit star lantern beats the swarm when closer
    let tx = s.cx, ty = s.cy, best = Math.hypot(s.cx - m.x, s.cy - m.y) + (s.free ? 0 : 1e6);
    let orbit = false;
    for (const l of g.level.lanterns) {
      if (!l.lit) continue;
      const d = Math.hypot(l.x - m.x, l.y - m.y);
      if (d < 420 && d * 0.7 < best) { best = d * 0.7; tx = l.x; ty = l.y; orbit = true; }
    }
    if (m.leave) { tx = m.x + (m.x > 0 ? 500 : -500); ty = m.y + 400; }
    if (orbit && !m.leave) {
      tx += Math.cos(m.t * 2.2 + m.phase) * 55;
      ty += Math.sin(m.t * 2.2 + m.phase) * 40;
    }
    const dx = tx - m.x, dy = ty - m.y, l = Math.hypot(dx, dy) || 1;
    const sp = m.leave ? 260 : BAL.moth.speed;
    m.vx += ((dx / l) * sp - m.vx) * dt * 2.2 + Math.sin(m.t * 13 + m.phase) * 400 * dt;
    m.vy += ((dy / l) * sp - m.vy) * dt * 2.2 + Math.cos(m.t * 11 + m.phase) * 400 * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (!m.leave && !orbit && g.state === 'play') {
      m.eatT -= dt;
      if (m.eatT <= 0) {
        for (let i = 0; i < s.n; i++) {
          if (s.state[i] !== FREE) continue;
          const ddx = s.x[i] - m.x, ddy = s.y[i] - m.y;
          if (ddx * ddx + ddy * ddy < 24 * 24) {
            killFly(g, i, 0.8, 0.7, 0.9, 'moth');
            m.eaten++;
            m.eatT = BAL.moth.eatEvery;
            g.events.push({ t: 'bite', n: 1 });
            break;
          }
        }
        if (m.eaten >= BAL.moth.bites * g.biteMul) m.leave = true;
      }
    }
    if (m.leave && Math.abs(m.y - g.camY) > g.viewH) g.moths.splice(k, 1);
  }
}

// ------------------------------------------------------------ flash
export function flashHazards(g: Game, cx: number, cy: number, R: number) {
  for (const f of g.level.frogs) {
    const m = frogMouth(f);
    if (Math.hypot(m.x - cx, m.y - cy) < R + 60 && f.state !== 4) { f.state = 4; f.t = 0; }
  }
  for (const d of g.dragonflies) if (Math.hypot(d.x - cx, d.y - cy) < R + 40) d.state = 3;
  for (const o of g.level.owls) {
    const px = o.state === 2 ? o.px : o.x, py = o.state === 2 ? o.py : o.y;
    if (Math.hypot(px - cx, py - cy) > R + 120) continue;
    if (o.state === 1) {
      o.state = 4;
      o.t = 0;
      g.score += 50;
      g.events.push({ t: 'owlBlind' });
    } else if (o.state === 2) (o as OwlPath).veer = true;
  }
  for (let k = g.moths.length - 1; k >= 0; k--) {
    const m = g.moths[k];
    if (Math.hypot(m.x - cx, m.y - cy) > R + 30) continue;
    for (let j = 0; j < 10; j++) g.emit(m.x, m.y, 1, 0.6, 0.3, 3, 90, 0.7, 2, -40);
    g.moths.splice(k, 1);
    g.score += 10;
  }
}
