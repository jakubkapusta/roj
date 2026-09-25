import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/quicksand/500.css';
import '@fontsource/quicksand/600.css';
import './style.css';

import { Renderer } from './render/renderer';
import { Game } from './game/game';
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
let game = makeMenuGame();
let fade = 1;
let fadeTarget = 0;
let endShown = false;

const meta = loadMeta();

const ui = new Ui({
  start: () => startRun(),
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
  unitsPerPx: () => {
    const cssW = canvas.clientWidth || window.innerWidth;
    return renderer.viewW / cssW;
  },
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
  const g = new Game(1234);
  g.demo = true;
  return g;
}

function startRun() {
  sound.unlock();
  fade = 1;
  fadeTarget = 0;
  game = new Game((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  mode = 'play';
  endShown = false;
  input.reset();
  ui.touch = input.isTouch || matchMedia('(pointer: coarse)').matches;
  ui.hideScreens();
  meta.runs++;
  saveMeta();
  setTimeout(() => ui.hint('move'), 800);
}

function pause() {
  if (mode !== 'play') return;
  mode = 'pause';
  input.reset();
  ui.showPause();
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
  ui.showMenu(meta.best, meta.runs);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('pagehide', () => pause());

function handleEvents() {
  for (const e of game.events) {
    switch (e.t) {
      case 'larva': sound.larva(e.n); break;
      case 'lantern': sound.lantern(e.k); ui.pop('Lampion zapalony'); break;
      case 'flash':
        sound.flash(e.perfect);
        if (e.perfect) ui.pop('Idealnie!');
        break;
      case 'noBlask': sound.noBlask(); ui.noBlask(); break;
      case 'batWarn': sound.batWarn(e.side); break;
      case 'bite': sound.loss(e.n); ui.hurt(); vibrate(25); break;
      case 'shadowLoss': sound.loss(e.n); ui.hurt(); vibrate(15); break;
      case 'caught': sound.caught(); break;
      case 'revive': sound.revive(); ui.pop('Druga szansa'); break;
      case 'finish': sound.finish(); break;
      case 'over': sound.over(); break;
      case 'hint': ui.hint(e.id); break;
    }
  }
  game.events.length = 0;
}

function vibrate(ms: number) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

function checkEnd() {
  if (endShown) return;
  const won = game.state === 'finished' && game.stateT > 3.2;
  const lost = game.state === 'over' && game.stateT > 1.6;
  if (!won && !lost) return;
  endShown = true;
  mode = 'end';
  input.reset();
  const total = game.total;
  const isBest = total > meta.best;
  if (isBest) meta.best = total;
  if (won) meta.wins++;
  saveMeta();
  ui.showEnd(game, won, meta.best, isBest, () => startRun());
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
    ui.update(game, dt);
    checkEnd();
  }
  fade += (fadeTarget - fade) * Math.min(1, dt * 2.5);
  renderer.render(game, { fade, showTarget: input.isTouch });
  if (mode === 'play') adapt(raw);
  requestAnimationFrame(frame);
}

ui.showMenu(meta.best, meta.runs);
requestAnimationFrame(frame);

// ------------------------------------------------------------ persistence
function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem('roj.meta.v1') || '{}');
    return { best: m.best | 0, runs: m.runs | 0, wins: m.wins | 0 };
  } catch {
    return { best: 0, runs: 0, wins: 0 };
  }
}
function saveMeta() {
  try { localStorage.setItem('roj.meta.v1', JSON.stringify(meta)); } catch { /* ignore */ }
}

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__roj = { get game() { return game; }, renderer };
