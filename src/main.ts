import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/quicksand/500.css';
import '@fontsource/quicksand/600.css';
import './style.css';

import { Renderer } from './render/renderer';
import { Game, newRun, type Carry } from './game/game';
import { dailySeed, loadMeta, logBiome, loadStats, loadRun, loadSky, mutationOffer, saveMeta, SPECIES, saveRun, saveSky, speciesUnlocked, today } from './game/meta';
import { BIOMES } from './game/biomes';
import { Input } from './game/input';
import { Ui } from './ui/ui';
import { Sound } from './audio/audio';

type Mode = 'menu' | 'play' | 'pause' | 'end';

const canvas = document.getElementById('c') as HTMLCanvasElement;
let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  document.getElementById('ui')!.innerHTML = `<div class="screen show"><h2 class="h2">Ups</h2><p class="lead">Ta przeglądarka nie obsługuje WebGL2.</p></div>`;
  throw e;
}

const sound = new Sound();
let mode: Mode = 'menu';
const meta = loadMeta();
let game = makeMenuGame();
let fade = 1;
let fadeTarget = 0;
let endShown = false;


const ui = new Ui({
  start: (daily) => startRun(daily),
  cont: () => continueRun(),
  pickSpecies: (id) => {
    meta.species = id;
    saveMeta(meta);
    if (mode === 'menu') game.rgb = (SPECIES.find((x) => x.id === id) ?? SPECIES[0]).rgb;
    showMenu();
  },
  pickNight: (n) => { meta.nightSel = Math.max(1, Math.min(meta.night, n)); saveMeta(meta); showMenu(); },
  sky: () => ui.showSky(loadSky(), showMenu),
  pause: () => pause(),
  resume: () => resume(),
  menu: () => toMenu(),
  toggleMute: () => {
    sound.unlock();
    sound.setMuted(!sound.muted);
    return sound.muted;
  },
  isMuted: () => sound.muted,
});
ui.touch = matchMedia('(pointer: coarse)').matches;

const input = new Input(canvas, {
  toWorld: (px, py) => {
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    return [game.camX + (px / cssW - 0.5) * renderer.viewW, game.camY - (py / cssH - 0.5) * renderer.viewH];
  },
  getTarget: () => [game.swarm.tx, game.swarm.ty],
  setTarget: (x, y) => game.setTarget(x, y),
  setGuiding: (on) => { game.swarm.guiding = on; },
  flash: () => game.tryFlash(),
  firstGesture: () => sound.unlock(),
  enabled: () => mode === 'play',
});

function makeMenuGame() {
  const g = new Game(newRun(1234, 0, { species: speciesUnlocked(meta, meta.species) ? meta.species : 'zielone' }));
  g.demo = true;
  return g;
}

/** `#b3` in the URL starts a run at biome 3 (1-based) — handy for testing. */
function startBiomeFromHash() {
  const m = /b(\d)/.exec(location.hash);
  return m ? Math.max(0, Math.min(BIOMES.length - 1, Number(m[1]) - 1)) : 0;
}

function showMenu() {
  ui.showMenu({ meta, save: loadRun(), sky: loadSky().length });
}

function startRun(daily = false) {
  meta.runs++;
  saveMeta(meta);
  const seed = daily ? dailySeed() : (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  const species = daily || !speciesUnlocked(meta, meta.species) ? 'zielone' : meta.species;
  const night = daily ? 1 : Math.min(meta.nightSel, meta.night);
  enterBiome(new Game(newRun(seed, daily ? 0 : startBiomeFromHash(), { species, night, daily })));
  setTimeout(() => ui.hint('move'), 800);
}

function continueRun() {
  const sv = loadRun();
  if (!sv) return showMenu();
  if (sv.pending) return offerMutation(null, sv.carry);
  const g = new Game(sv.carry);
  if (sv.lantern >= 0) g.restoreAt(sv);
  enterBiome(g);
}

/** Between biomes (or when resuming there): pick a mutation, then fly on. */
function offerMutation(g: Game | null, next: Carry) {
  mode = 'end';
  saveRun({ v: 1, carry: next, lantern: -1, pending: true });
  ui.showBiomeDone(g, next, mutationOffer(next.seed, next.biome, next.mutations), (id) => {
    if (id) next.mutations.push(id);
    enterBiome(new Game(next));
  });
}

function enterBiome(g: Game) {
  sound.unlock();
  fade = 1;
  fadeTarget = 0;
  game = g;
  mode = 'play';
  endShown = false;
  input.reset();
  ui.touch = input.isTouch || matchMedia('(pointer: coarse)').matches;
  ui.hideScreens();
  ui.setBiome(g.biome.name, g.carry.biome + 1, BIOMES.length);
  sound.setBiome(g.biome.id);
  saveRun(g.snapshot());
}

function pause() {
  if (mode !== 'play') return;
  mode = 'pause';
  input.reset();
  ui.showPause(game.carry);
  sound.suspend(true);
}
function resume() {
  if (mode !== 'pause') return;
  mode = 'play';
  ui.hideScreens();
  sound.suspend(false);
}
function toMenu() {
  sound.suspend(false);
  mode = 'menu';
  game = makeMenuGame();
  fade = 1;
  fadeTarget = 0;
  showMenu();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('pagehide', () => pause());

function handleEvents() {
  for (const e of game.events) {
    switch (e.t) {
      case 'larva': sound.larva(e.n); break;
      case 'lantern':
        sound.lantern(e.k);
        ui.pop(e.star ? 'Gwiazda zapalona' : 'Lampion zapalony');
        saveRun(game.snapshot());
        break;
      case 'flash':
        sound.flash(e.perfect);
        if (e.perfect) {
          ui.pop('Idealnie!');
          meta.perfects++;
          saveMeta(meta);
        }
        break;
      case 'noBlask': sound.noBlask(); ui.noBlask(); break;
      case 'batWarn': sound.batWarn(e.side); break;
      case 'bite': sound.loss(e.n); ui.hurt(); vibrate(25); break;
      case 'shadowLoss': sound.loss(e.n); ui.hurt(); vibrate(15); break;
      case 'caught': sound.caught(); break;
      case 'revive': {
        sound.revive();
        ui.pop('Druga szansa');
        const sv = loadRun();
        if (sv) { sv.reviveUsed = true; saveRun(sv); }
        break;
      }
      case 'finish': sound.finish(); break;
      case 'over': sound.over(); break;
      case 'hint': ui.hint(e.id); break;
      case 'frogAim': sound.croak(); break;
      case 'frogStrike': sound.slurp(); break;
      case 'dragonfly': sound.buzz(); break;
      case 'dash': sound.dash(); break;
      case 'owl': sound.hoot(); break;
      case 'swoop': sound.swoop(); break;
      case 'owlBlind': ui.pop('Sowa oślepiona'); break;
      case 'gust': sound.gust(); break;
      case 'rainWarn': sound.rumble(); ui.pop('Ulewa!'); break;
      case 'thunder': sound.thunder(e.delay); break;
    }
  }
  game.events.length = 0;
}

function vibrate(ms: number) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

function checkEnd() {
  if (endShown) return;
  const won = game.state === 'finished' && game.stateT > (game.constellation ? 7 : 3.2);
  const lost = game.state === 'over' && game.stateT > 1.6;
  if (!won && !lost) return;
  endShown = true;
  mode = 'end';
  input.reset();
  if (!game.demo) {
    logBiome({
      date: today(), biome: game.carry.biome, time: Math.round(game.time), fliesIn: game.fliesIn, fliesOut: won ? game.swarm.n : 0,
      gained: game.gained, lostBy: game.lostBy, died: !won, species: game.carry.species, night: game.carry.night,
    });
  }
  const unlocks: string[] = [];
  const had = { blue: speciesUnlocked(meta, 'blekitne'), amber: speciesUnlocked(meta, 'bursztynowe'), purple: speciesUnlocked(meta, 'purpurowe') };
  if (won && game.biome.id === 'staw') meta.staw = true;
  if (won && !game.isLast) {
    saveMeta(meta);
    offerMutation(game, game.next());
    return;
  }
  saveRun(null);
  if (won && game.constellation) saveConstellation(game);
  const total = game.total;
  const daily = game.carry.daily;
  const isBest = total > meta.best;
  if (isBest) meta.best = total;
  if (won) {
    meta.wins++;
    if (!daily && game.carry.night === meta.night && meta.night < 10) {
      meta.night++;
      meta.nightSel = meta.night;
      unlocks.push(`Odblokowana Noc ${meta.night}`);
    }
  }
  if (daily) meta.daily = { date: today(), best: meta.daily.date === today() ? Math.max(meta.daily.best, total) : total };
  if (!had.blue && speciesUnlocked(meta, 'blekitne')) unlocks.push('Nowy gatunek: Błękitne świetliki');
  if (!had.amber && speciesUnlocked(meta, 'bursztynowe')) unlocks.push('Nowy gatunek: Bursztynowe świetliki');
  if (!had.purple && speciesUnlocked(meta, 'purpurowe')) unlocks.push('Nowy gatunek: Purpurowe świetliki');
  saveMeta(meta);
  ui.showEnd(game, won, meta.best, isBest, () => startRun(daily), unlocks);
}

// ------------------------------------------------------------ adaptive quality
let slow = 0, fast = 0;
function adapt(frameMs: number) {
  if (frameMs > 22) { slow += frameMs / 1000; fast = 0; }
  else if (frameMs < 13) { fast += frameMs / 1000; slow = Math.max(0, slow - frameMs / 2000); }
  if (slow > 2 && renderer.quality > 0.5) {
    renderer.quality = Math.max(0.5, renderer.quality - 0.15);
    slow = 0;
  } else if (fast > 8 && renderer.quality < 1) {
    renderer.quality = Math.min(1, renderer.quality + 0.1);
    fast = 0;
  }
}

// ------------------------------------------------------------ loop
let last = performance.now();
function frame(now: number) {
  const raw = now - last;
  last = now;
  const dt = Math.min(raw / 1000, 1 / 30);
  if (mode === 'menu') {
    const t = game.time;
    game.swarm.guiding = true;
    game.swarm.tx = Math.sin(t * 0.45) * 140 + Math.sin(t * 1.3) * 40;
    game.swarm.ty = 330 + Math.sin(t * 0.7) * 110;
    game.update(dt);
  } else if (mode === 'play' || mode === 'end') {
    input.update(dt);
    const slowmo = game.state === 'reviving' ? 0.35 : game.state === 'over' ? 0.4 : 1;
    game.update(dt * slowmo);
    handleEvents();
    sound.setRain(game.rain);
    ui.update(game, dt);
    checkEnd();
  }
  fade += (fadeTarget - fade) * Math.min(1, dt * 2.5);
  renderer.render(game, { fade, showTarget: input.isTouch });
  if (mode === 'play') adapt(raw);
  requestAnimationFrame(frame);
}

if (location.hash === '#stats') ui.showStats(loadStats(), () => { location.hash = ''; showMenu(); });
else showMenu();
requestAnimationFrame(frame);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ------------------------------------------------------------ persistence
function saveConstellation(g: Game) {
  const c = g.constellation!;
  const cy = c.stars.reduce((a, s) => a + s[1], 0) / c.stars.length;
  const sky = loadSky();
  sky.push({
    name: c.name, stars: c.stars.map(([x, y]) => [Math.round(x), Math.round(y - cy)] as [number, number]), links: c.links,
    flies: g.swarm.n, score: g.total, date: today(), species: g.carry.species, night: g.carry.night,
  });
  saveSky(sky);
}

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__roj = { get game() { return game; }, renderer };
