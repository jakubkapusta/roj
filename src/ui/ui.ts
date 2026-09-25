// DOM overlay: HUD, hints, menu, pause and end screens. Text is Polish.

import type { Game } from '../game/game';
import type { BiomeDef } from '../game/biomes';

export type UiHooks = {
  start: () => void;
  pause: () => void;
  resume: () => void;
  menu: () => void;
  toggleMute: () => boolean;
  isMuted: () => boolean;
};

const HINTS: Record<string, [touch: string, mouse: string]> = {
  move: [
    'Przytrzymaj palec w dowolnym miejscu i <b>przeciągnij</b> — rój poleci za ruchem',
    '<b>Przytrzymaj</b> przycisk myszy — rój leci do kursora',
  ],
  shadow: ['Od dołu podnosi się <em>Cień</em>. Leć w górę — w nim świetliki gasną', 'Od dołu podnosi się <em>Cień</em>. Leć w górę — w nim świetliki gasną'],
  squeeze: ['Szybki ruch wyciąga rój w <b>warkocz</b> — przeciśnie się przez wąską szczelinę', 'Szybki ruch wyciąga rój w <b>warkocz</b> — przeciśnie się przez wąską szczelinę'],
  web: [
    'Pajęczyny widać tylko w świetle roju. Omiń ją albo <b>stuknij dwa razy</b> — Rozbłysk ją spali',
    'Pajęczyny widać tylko w świetle roju. Omiń ją albo <b>kliknij dwa razy</b> (lub spacja) — Rozbłysk ją spali',
  ],
  flash: [
    'Złapane świetliki gasną po chwili! <b>Stuknij dwa razy</b>, żeby je uwolnić Rozbłyskiem',
    'Złapane świetliki gasną po chwili! <b>Dwuklik</b> lub <b>spacja</b> uwolni je Rozbłyskiem',
  ],
  lantern: ['Zatrzymaj rój przy <em>lampionie</em>, aż się zapali — da Blask i miejsce odrodzenia', 'Zatrzymaj rój przy <em>lampionie</em>, aż się zapali — da Blask i miejsce odrodzenia'],
  bats: [
    'Nietoperze! <b>Pierścień echa</b> na brzegu zdradza, skąd nadlecą. Rozbłysk je płoszy',
    'Nietoperze! <b>Pierścień echa</b> na brzegu zdradza, skąd nadlecą. Rozbłysk je płoszy',
  ],
  frogs: [
    'Żaby! Gdy <b>oczy rozbłysną</b>, a przez mrok przebiegnie linia — zejdź z niej. Rozbłysk je ogłusza',
    'Żaby! Gdy <b>oczy rozbłysną</b>, a przez mrok przebiegnie linia — zejdź z niej. Rozbłysk je ogłusza',
  ],
  dragonflies: [
    'Ważka zawisa, <b>drży</b> i rzuca się prosto przed siebie. Usuń rój z jej toru',
    'Ważka zawisa, <b>drży</b> i rzuca się prosto przed siebie. Usuń rój z jej toru',
  ],
  owl: [
    'Na gałęzi śpi <em>sowa</em>. Gdy otworzy oczy — <b>Rozbłysk</b> ją oślepi, zanim zanurkuje',
    'Na gałęzi śpi <em>sowa</em>. Gdy otworzy oczy — <b>Rozbłysk</b> ją oślepi, zanim zanurkuje',
  ],
  wind: ['Smugi pyłku zapowiadają <b>podmuch</b>. Trzymaj rój z dala od pajęczyn i ścian', 'Smugi pyłku zapowiadają <b>podmuch</b>. Trzymaj rój z dala od pajęczyn i ścian'],
  rain: ['Deszcz gasi świetliki. Gdy nadciąga <b>ulewa</b>, schowaj rój <em>pod liściem</em>', 'Deszcz gasi świetliki. Gdy nadciąga <b>ulewa</b>, schowaj rój <em>pod liściem</em>'],
  moths: [
    'Ćmy lecą do światła i gaszą świetliki. Zwabi je <em>zapalona gwiazda</em>, Rozbłysk je spali',
    'Ćmy lecą do światła i gaszą świetliki. Zwabi je <em>zapalona gwiazda</em>, Rozbłysk je spali',
  ],
  sync: [
    'Spokojny rój zaczyna <b>błyskać razem</b>. Rozbłysk w szczycie pulsu jest silniejszy i prawie darmowy',
    'Spokojny rój zaczyna <b>błyskać razem</b>. Rozbłysk w szczycie pulsu jest silniejszy i prawie darmowy',
  ],
};

const ICON_PAUSE = '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor"/><path d="M11 5.5c1.2 1.3 1.2 3.7 0 5M12.8 3.8c2.2 2.4 2.2 6 0 8.4" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linecap="round"/></svg>';
const ICON_MUTE = '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class Ui {
  private root: HTMLElement;
  private hud: HTMLElement;
  private countEl: HTMLElement;
  private countNum: HTMLElement;
  private blaskBar: HTMLElement;
  private blaskFill: HTMLElement;
  private syncEl: HTMLElement;
  private syncDot: HTMLElement;
  private heightEl: HTMLElement;
  private progEl: HTMLElement;
  private scoreEl: HTMLElement;
  private biomeEl!: HTMLElement;
  private hintEl: HTMLElement;
  private popEl: HTMLElement;
  private dangerEl: HTMLElement;
  private menu: HTMLElement;
  private pauseEl: HTMLElement;
  private endEl: HTMLElement;
  private muteBtns: HTMLButtonElement[] = [];
  private hintQueue: string[] = [];
  private hintTimer = 0;
  private seen: Set<string>;
  private last = { n: -1, h: -1, s: -1, b: -1 };
  touch = true;

  constructor(private h: UiHooks) {
    this.root = document.getElementById('ui')!;
    try {
      this.seen = new Set(JSON.parse(localStorage.getItem('roj.hints.v1') || '[]'));
    } catch {
      this.seen = new Set();
    }

    // HUD
    this.hud = el('div', 'hud hidden');
    const left = el('div');
    this.countEl = el('div', 'count');
    this.countEl.append(el('span', 'dot'));
    this.countNum = el('span', '', '0');
    this.countEl.append(this.countNum);
    this.blaskBar = el('div', 'blask');
    this.blaskFill = el('i');
    this.blaskBar.append(this.blaskFill);
    for (const v of [10, 35]) {
      const t = el('span', 'tick');
      t.style.left = `${v}%`;
      this.blaskBar.append(t);
    }
    this.syncEl = el('div', 'sync');
    this.syncDot = el('b');
    this.syncEl.append(this.syncDot, document.createTextNode('puls'));
    left.append(this.countEl, this.blaskBar, this.syncEl);
    const mid = el('div', 'center');
    this.heightEl = el('div', 'height', '0<small>METRÓW</small>');
    this.biomeEl = this.heightEl.querySelector('small')!;
    const prog = el('div', 'progress');
    this.progEl = el('i');
    prog.append(this.progEl);
    mid.append(this.heightEl, prog);
    const right = el('div', 'right');
    const mute = this.muteButton();
    const pause = el('button', 'icon-btn', ICON_PAUSE);
    pause.setAttribute('aria-label', 'Pauza');
    pause.addEventListener('click', () => this.h.pause());
    right.append(mute, pause);
    this.hud.append(left, mid, right);
    this.scoreEl = el('div', 'score');
    this.hud.append(this.scoreEl);

    this.dangerEl = el('div', 'danger');
    this.hintEl = el('div', 'hint');
    this.popEl = el('div', 'pop');

    // menu
    this.menu = el('div', 'screen');
    this.pauseEl = el('div', 'screen dim');
    this.endEl = el('div', 'screen dim');
    this.root.append(this.dangerEl, this.hud, this.hintEl, this.popEl, this.menu, this.pauseEl, this.endEl);
  }

  private muteButton() {
    const b = el('button', 'icon-btn', this.h.isMuted() ? ICON_MUTE : ICON_SOUND);
    b.setAttribute('aria-label', 'Dźwięk');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = this.h.toggleMute();
      for (const x of this.muteBtns) x.innerHTML = m ? ICON_MUTE : ICON_SOUND;
    });
    this.muteBtns.push(b);
    return b;
  }

  private show(s: HTMLElement, on: boolean) {
    s.classList.toggle('show', on);
  }

  showMenu(best: number, runs: number) {
    this.hud.classList.add('hidden');
    this.menu.innerHTML = '';
    const title = el('h1', 'title', 'Rój');
    const sub = el('p', 'subtitle', 'Przeprowadź świetliki z dna nocnego lasu aż do księżyca');
    const btn = el('button', 'btn', 'Leć');
    btn.addEventListener('click', () => this.h.start());
    const meta = el('div', 'meta', best > 0 ? `Rekord <b>${best}</b> · wypraw <b>${runs}</b>` : 'Biom 1 z 5 · Ściółka');
    const how = el('div', 'howto', this.touch
      ? '<b>Przeciągaj</b> palcem, by prowadzić rój · <b>stuknij dwa razy</b> — Rozbłysk'
      : '<b>Przytrzymaj mysz</b>, by prowadzić rój · <b>dwuklik</b> lub <b>spacja</b> — Rozbłysk');
    const top = el('div', 'right');
    top.style.cssText = 'position:absolute;top:calc(var(--safe-top) + 12px);right:16px';
    top.append(this.muteButton());
    this.menu.append(top, title, sub, btn, meta, how);
    this.show(this.menu, true);
    this.show(this.pauseEl, false);
    this.show(this.endEl, false);
  }

  hideScreens() {
    this.show(this.menu, false);
    this.show(this.pauseEl, false);
    this.show(this.endEl, false);
    this.hud.classList.remove('hidden');
  }

  setBiome(name: string, idx: number, total: number) {
    this.biomeEl.textContent = `${name} · ${idx}/${total}`;
    this.last.h = -1;
  }

  showBiomeDone(g: Game, next: BiomeDef, cont: () => void) {
    this.hud.classList.add('hidden');
    this.endEl.innerHTML = '';
    const t = el('h2', 'h2', g.biome.name);
    const lead = el('p', 'lead', 'przebyty. Rój leci wyżej.');
    const st = el('div', 'stats');
    for (const [a, b] of [['Świetliki', g.swarm.n], ['Wysokość', `${g.heightBase + g.heightScore} m`], ['Wynik', g.total]] as [string, string | number][]) {
      st.append(el('span', '', a), el('span', '', String(b)));
    }
    const nx = el('div', 'nextb');
    nx.append(el('div', 'nextb-k', 'Dalej'), el('div', 'nextb-n', next.name), el('p', 'nextb-l', next.lead), el('div', 'nextb-t', next.threats.join(' · ')));
    const b = el('button', 'btn', 'Leć dalej');
    b.addEventListener('click', cont);
    this.endEl.append(t, lead, st, nx, b);
    this.show(this.endEl, true);
  }

  showPause() {
    this.pauseEl.innerHTML = '';
    const t = el('h2', 'h2', 'Pauza');
    const lead = el('p', 'lead', 'Rój unosi się w miejscu i czeka.');
    const b = el('div', 'btns');
    const r = el('button', 'btn', 'Wznów');
    r.addEventListener('click', () => this.h.resume());
    const m = el('button', 'btn ghost', 'Porzuć wyprawę');
    m.addEventListener('click', () => this.h.menu());
    b.append(r, m);
    this.pauseEl.append(t, lead, b);
    this.show(this.pauseEl, true);
  }

  showEnd(g: Game, won: boolean, best: number, isBest: boolean, again: () => void) {
    this.hud.classList.add('hidden');
    this.endEl.innerHTML = '';
    const t = el('h2', won ? 'h2' : 'h2 sad', won ? (g.constellation?.name ?? 'Polana') : 'Rój zgasł');
    const lead = el('p', 'lead', won ? 'Nowa konstelacja świeci na twoim niebie.' : `Ostatnie światełko zgasło — ${g.biome.name}.`);
    const st = el('div', 'stats');
    const rows: [string, string | number][] = [
      ['Wysokość', `${g.heightBase + g.heightScore} m`],
      ['Zapalone lampiony', g.lanternsLit],
      ['Obudzone larwy', g.larvaeWoken],
      ['Idealne rozbłyski', g.perfects],
    ];
    if (won) rows.push(['Ocalałe świetliki', g.swarm.n]);
    for (const [a, b] of rows) st.append(el('span', '', a), el('span', '', String(b)));
    st.append(el('span', 'total', 'Wynik'), el('span', 'total', String(g.total)));
    const bestEl = el('div', 'best', isBest ? 'Nowy rekord' : `Rekord: ${best}`);
    const b = el('div', 'btns');
    const r = el('button', 'btn', 'Jeszcze raz');
    r.addEventListener('click', again);
    const m = el('button', 'btn ghost', 'Menu');
    m.addEventListener('click', () => this.h.menu());
    b.append(r, m);
    this.endEl.append(t, lead, st, bestEl, b);
    this.show(this.endEl, true);
  }

  hint(id: string) {
    if (this.seen.has(id) || !HINTS[id]) return;
    this.seen.add(id);
    try { localStorage.setItem('roj.hints.v1', JSON.stringify([...this.seen])); } catch { /* ignore */ }
    this.hintQueue.push(id);
    if (this.hintTimer <= 0) this.nextHint();
  }

  private nextHint() {
    const id = this.hintQueue.shift();
    if (!id) {
      this.hintEl.classList.remove('show');
      return;
    }
    this.hintEl.innerHTML = HINTS[id][this.touch ? 0 : 1];
    this.hintEl.classList.add('show');
    this.hintTimer = 5.5;
  }

  pop(text: string) {
    this.popEl.textContent = text;
    this.popEl.classList.remove('go');
    void this.popEl.offsetWidth;
    this.popEl.classList.add('go');
  }

  hurt() {
    this.countEl.classList.remove('hurt');
    void this.countEl.offsetWidth;
    this.countEl.classList.add('hurt');
  }

  noBlask() {
    this.blaskBar.classList.remove('shake');
    void this.blaskBar.offsetWidth;
    this.blaskBar.classList.add('shake');
  }

  update(g: Game, dt: number) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        this.hintEl.classList.remove('show');
        setTimeout(() => this.nextHint(), 500);
      }
    }
    const s = g.swarm;
    if (s.n !== this.last.n) {
      this.countNum.textContent = String(s.n);
      this.last.n = s.n;
    }
    const hgt = g.heightBase + g.heightScore;
    if (hgt !== this.last.h) {
      this.heightEl.firstChild!.textContent = String(hgt);
      this.progEl.style.width = `${(g.progress * 100).toFixed(1)}%`;
      this.last.h = hgt;
    }
    const sc = g.total;
    if (sc !== this.last.s) {
      this.scoreEl.textContent = `${sc} pkt`;
      this.last.s = sc;
    }
    const bl = Math.round(g.blask);
    if (bl !== this.last.b) {
      this.blaskFill.style.width = `${bl}%`;
      this.blaskBar.classList.toggle('low', bl < 35);
      this.last.b = bl;
    }
    const synced = s.order > 0.55;
    this.syncEl.classList.toggle('on', synced);
    const pulse = synced ? Math.max(0, Math.cos(s.psi)) : 0;
    this.syncDot.style.transform = `scale(${0.6 + pulse * 0.9})`;
    const gap = s.cy - g.shadowY;
    this.dangerEl.style.opacity = String(Math.max(0, Math.min(1, (520 - gap) / 380)));
  }
}
