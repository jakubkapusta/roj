// DOM overlay: HUD, hints, menu, pause and end screens. Text is Polish.

import type { Game, Carry } from '../game/game';
import { BIOMES, type BiomeDef } from '../game/biomes';
import { MUTATIONS, NIGHTS, SPECIES, speciesUnlocked, today, type BiomeStat, type Meta, type Mutation, type RunSave, type SkyEntry } from '../game/meta';

export type MenuState = { meta: Meta; save: RunSave | null; sky: number };

export type UiHooks = {
  start: (daily: boolean) => void;
  cont: () => void;
  pickSpecies: (id: string) => void;
  pickNight: (n: number) => void;
  sky: () => void;
  pause: () => void;
  resume: () => void;
  menu: () => void;
  toggleMute: () => boolean;
  isMuted: () => boolean;
};

const HINTS: Record<string, [touch: string, mouse: string]> = {
  move: [
    'Przytrzymaj palec i <b>prowadź</b> — rój leci tuż nad palcem',
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

  showMenu(st: MenuState) {
    const { meta, save } = st;
    this.hud.classList.add('hidden');
    this.menu.innerHTML = '';
    this.menu.classList.add('menu');
    const top = el('div', 'right');
    top.style.cssText = 'position:absolute;top:calc(var(--safe-top) + 12px);right:16px';
    top.append(this.muteButton());
    const title = el('h1', 'title', 'Rój');
    const sub = el('p', 'subtitle', 'Przeprowadź świetliki z dna nocnego lasu aż do księżyca');
    const btns = el('div', 'btns');
    if (save) {
      const b = BIOMES[save.carry.biome];
      const c = el('button', 'btn', `Kontynuuj<small>${b.name} · ${save.carry.biome + 1}/${BIOMES.length} · ${save.flies ?? save.carry.flies} świetlików</small>`);
      c.addEventListener('click', () => this.h.cont());
      const n = el('button', 'btn ghost', 'Nowa wyprawa');
      n.addEventListener('click', () => this.h.start(false));
      btns.append(c, n);
    } else {
      const b = el('button', 'btn', 'Leć');
      b.addEventListener('click', () => this.h.start(false));
      btns.append(b);
    }
    // species
    const row = el('div', 'species');
    const desc = el('div', 'sp-desc');
    for (const sp of SPECIES) {
      const open = speciesUnlocked(meta, sp.id);
      const b = el('button', `sp${sp.id === meta.species ? ' on' : ''}${open ? '' : ' locked'}`);
      const orb = el('span', 'orb');
      const [r, g, bl] = sp.rgb.map((v) => Math.round(Math.min(1, v) * 255));
      orb.style.setProperty('--c', `rgb(${r},${g},${bl})`);
      b.append(orb, el('span', 'sp-n', sp.name));
      b.addEventListener('click', () => {
        if (open) this.h.pickSpecies(sp.id);
        else desc.innerHTML = `<i>Zablokowane:</i> ${sp.unlock}`;
      });
      row.append(b);
    }
    desc.textContent = (SPECIES.find((x) => x.id === meta.species) ?? SPECIES[0]).desc;
    const parts: HTMLElement[] = [top, title, sub, btns, row, desc];
    // night
    if (meta.night > 1) {
      const n = Math.min(meta.nightSel, meta.night);
      const nr = el('div', 'night');
      const prev = el('button', 'nb', '‹');
      const next = el('button', 'nb', '›');
      prev.disabled = n <= 1;
      next.disabled = n >= meta.night;
      prev.addEventListener('click', () => this.h.pickNight(n - 1));
      next.addEventListener('click', () => this.h.pickNight(n + 1));
      nr.append(prev, el('span', 'nn', `Noc ${n}`), next);
      parts.push(nr, el('div', 'sp-desc', n > 1 ? `${NIGHTS[n - 1].desc} Wynik ×${(1 + (n - 1) * 0.15).toFixed(2)}` : NIGHTS[0].desc));
    }
    const row2 = el('div', 'row2');
    const d = el('button', 'btn ghost small', `Wyprawa dnia${meta.daily.date === today() && meta.daily.best ? `<small>dziś: ${meta.daily.best}</small>` : '<small>ta sama dla wszystkich</small>'}`);
    d.addEventListener('click', () => this.h.start(true));
    const k = el('button', 'btn ghost small', `Twoje niebo<small>${st.sky ? `konstelacji: ${st.sky}` : 'puste'}</small>`);
    k.addEventListener('click', () => this.h.sky());
    row2.append(d, k);
    parts.push(row2);
    parts.push(el('div', 'meta', meta.best > 0 ? `Rekord <b>${meta.best}</b> · wypraw <b>${meta.runs}</b>` : 'Pięć biomów · od ściółki do gwiazd'));
    this.menu.append(...parts);
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

  /** Between biomes: summary, what's next, and the pick of one of three mutations. */
  showBiomeDone(g: Game | null, carry: Carry, offer: Mutation[], choose: (id: string) => void) {
    const next = BIOMES[carry.biome];
    this.hud.classList.add('hidden');
    this.endEl.innerHTML = '';
    const parts: HTMLElement[] = [];
    if (g) {
      parts.push(el('h2', 'h2 sm', `${g.biome.name} przebyta`));
      const st = el('div', 'stats compact');
      for (const [a, b] of [['Świetliki', g.swarm.n], ['Wysokość', `${g.heightBase + g.heightScore} m`], ['Wynik', g.total]] as [string, string | number][]) {
        st.append(el('span', '', a), el('span', '', String(b)));
      }
      parts.push(st);
    }
    const nx = el('div', 'nextb');
    nx.append(el('div', 'nextb-k', 'Dalej'), el('div', 'nextb-n', next.name), el('p', 'nextb-l', next.lead), el('div', 'nextb-t', next.threats.join(' · ')));
    parts.push(nx, el('div', 'nextb-k', 'Wybierz mutację roju'));
    const cards = el('div', 'muts');
    for (const m of offer) {
      const c = el('button', 'mut', `<b>${m.name}</b><span>${m.desc}</span>`);
      c.addEventListener('click', () => choose(m.id));
      cards.append(c);
    }
    if (!offer.length) {
      const c = el('button', 'btn', 'Leć dalej');
      c.addEventListener('click', () => choose(''));
      cards.append(c);
    }
    parts.push(cards);
    if (carry.mutations.length) parts.push(el('div', 'owned', 'Masz: ' + carry.mutations.map((id) => MUTATIONS.find((m) => m.id === id)?.name).join(' · ')));
    this.endEl.append(...parts);
    this.show(this.endEl, true);
  }

  showPause(carry: Carry) {
    this.pauseEl.innerHTML = '';
    const t = el('h2', 'h2', 'Pauza');
    const lead = el('p', 'lead', 'Rój unosi się w miejscu i czeka.');
    const info = el('div', 'owned');
    const sp = SPECIES.find((x) => x.id === carry.species) ?? SPECIES[0];
    const bits = [`${sp.name} świetliki`, carry.daily ? 'Wyprawa dnia' : `Noc ${carry.night}`];
    if (carry.mutations.length) bits.push(carry.mutations.map((id) => MUTATIONS.find((m) => m.id === id)?.name).join(', '));
    info.textContent = bits.join(' · ');
    const b = el('div', 'btns');
    const r = el('button', 'btn', 'Wznów');
    r.addEventListener('click', () => this.h.resume());
    const m = el('button', 'btn ghost', 'Do menu');
    m.addEventListener('click', () => this.h.menu());
    b.append(r, m);
    const note = el('div', 'owned', 'Wyprawa zapisuje się przy lampionach — wrócisz do niej z menu.');
    this.pauseEl.append(t, lead, info, b, note);
    this.show(this.pauseEl, true);
  }

  showEnd(g: Game, won: boolean, best: number, isBest: boolean, again: () => void, unlocks: string[]) {
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
    if (g.carry.night > 1) rows.push([`Noc ${g.carry.night}`, `×${g.mods.score.toFixed(2)}`]);
    for (const [a, b] of rows) st.append(el('span', '', a), el('span', '', String(b)));
    st.append(el('span', 'total', g.carry.daily ? 'Wyprawa dnia' : 'Wynik'), el('span', 'total', String(g.total)));
    const bestEl = el('div', 'best', isBest ? 'Nowy rekord' : `Rekord: ${best}`);
    const parts: HTMLElement[] = [t, lead, st, bestEl];
    for (const u of unlocks) parts.push(el('div', 'unlock', u));
    const b = el('div', 'btns');
    const r = el('button', 'btn', 'Jeszcze raz');
    r.addEventListener('click', again);
    const m = el('button', 'btn ghost', 'Menu');
    m.addEventListener('click', () => this.h.menu());
    b.append(r, m);
    parts.push(b);
    this.endEl.append(...parts);
    this.show(this.endEl, true);
  }

  /** `#stats`: your real runs in the same shape as the simulator report. */
  showStats(all: BiomeStat[], back: () => void) {
    this.menu.classList.remove('menu');
    this.menu.innerHTML = '';
    const wrap = el('div', 'sky');
    const head = el('div', 'sky-head');
    head.append(el('h2', 'h2 sm', 'Statystyki'));
    const close = el('button', 'btn ghost small', 'Wróć');
    close.addEventListener('click', back);
    head.append(close);
    wrap.append(head);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
    let html = `<table class="stats-t"><tr><th>biom</th><th>n</th><th>zgasł</th><th>czas</th><th>wlot→wylot</th><th>+larwy</th><th>straty wg przyczyny</th></tr>`;
    BIOMES.forEach((b, i) => {
      const rs = all.filter((x) => x.biome === i);
      if (!rs.length) return;
      const fin = rs.filter((x) => !x.died);
      const causes: Record<string, number> = {};
      for (const x of rs) for (const [k, v] of Object.entries(x.lostBy)) causes[k] = (causes[k] ?? 0) + v;
      const tot = Object.values(causes).reduce((a, v) => a + v, 0) || 1;
      const cs = Object.entries(causes).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${Math.round((100 * v) / tot)}%`).join(', ');
      html += `<tr><td>${b.name}</td><td>${rs.length}</td><td>${Math.round((100 * (rs.length - fin.length)) / rs.length)}%</td><td>${mmss(avg(fin.map((x) => x.time)))}</td><td>${Math.round(avg(rs.map((x) => x.fliesIn)))}→${Math.round(avg(fin.map((x) => x.fliesOut)))}</td><td>${Math.round(avg(rs.map((x) => x.gained)))}</td><td>${cs}</td></tr>`;
    });
    html += '</table>';
    wrap.append(el('div', 'stats-wrap', all.length ? html : '<p class="lead">Brak danych — zagraj kilka wypraw.</p>'));
    const copy = el('button', 'btn ghost small', 'Kopiuj surowe dane');
    copy.addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(all)));
    wrap.append(copy);
    this.menu.append(wrap);
    this.show(this.menu, true);
  }

  /** "Twoje niebo": every finished run as a constellation on one night sky. */
  showSky(sky: SkyEntry[], back: () => void) {
    this.menu.classList.remove('menu');
    this.menu.innerHTML = '';
    const wrap = el('div', 'sky');
    const head = el('div', 'sky-head');
    head.append(el('h2', 'h2 sm', 'Twoje niebo'));
    const close = el('button', 'btn ghost small', 'Wróć');
    close.addEventListener('click', back);
    head.append(close);
    wrap.append(head);
    if (!sky.length) {
      wrap.append(el('p', 'lead', 'Niebo jest jeszcze puste. Ukończ wyprawę, a twój rój zostanie tu na zawsze jako konstelacja.'));
    } else {
      const grid = el('div', 'sky-grid');
      [...sky].reverse().forEach((c, i) => grid.append(this.constellationCard(c, i)));
      wrap.append(grid);
    }
    this.menu.append(wrap);
    this.show(this.menu, true);
  }

  private constellationCard(c: SkyEntry, i: number) {
    const card = el('div', 'sky-card');
    const xs = c.stars.map((s) => s[0]), ys = c.stars.map((s) => s[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(80, maxX - minX), h = Math.max(80, maxY - minY);
    const S = 120 / Math.max(w, h);
    const px = (x: number) => 80 + (x - (minX + maxX) / 2) * S;
    const py = (y: number) => 75 - (y - (minY + maxY) / 2) * S;
    const sp = SPECIES.find((x) => x.id === c.species) ?? SPECIES[0];
    const col = `rgb(${sp.rgb.map((v) => Math.round(Math.min(1, v * 0.4 + 0.6) * 255)).join(',')})`;
    let svg = `<svg viewBox="0 0 160 150" class="sky-svg"><defs><filter id="g${i}"><feGaussianBlur stdDeviation="2.2"/></filter></defs>`;
    for (let k = 0; k < 26; k++) {
      const a = Math.sin(i * 91 + k * 17.3) * 43758.5, b = Math.sin(i * 37 + k * 9.1) * 12345.6;
      svg += `<circle cx="${((a - Math.floor(a)) * 160).toFixed(1)}" cy="${((b - Math.floor(b)) * 150).toFixed(1)}" r="0.6" fill="#9fb3d9" opacity="0.5"/>`;
    }
    for (const [a, b] of c.links) svg += `<line x1="${px(c.stars[a][0])}" y1="${py(c.stars[a][1])}" x2="${px(c.stars[b][0])}" y2="${py(c.stars[b][1])}" stroke="#8fb0ff" stroke-opacity=".45" stroke-width="1"/>`;
    c.stars.forEach(([x, y], k) => {
      const r = 2.2 + ((k * 7) % 3) * 0.6;
      svg += `<circle cx="${px(x)}" cy="${py(y)}" r="${r * 2.6}" fill="${col}" opacity=".45" filter="url(#g${i})"/><circle class="tw" style="animation-delay:${(k * 0.37) % 2}s" cx="${px(x)}" cy="${py(y)}" r="${r}" fill="#fff"/>`;
    });
    svg += '</svg>';
    card.innerHTML = svg;
    card.append(el('div', 'sky-name', c.name), el('div', 'sky-meta', `${c.date} · ${c.flies} świetlików · ${c.score} pkt${c.night && c.night > 1 ? ` · Noc ${c.night}` : ''}`));
    return card;
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
