// All sound is synthesized: night ambience, bell notes in D minor pentatonic, effects.

const SCALE = [0, 3, 5, 7, 10]; // minor pentatonic intervals
const BASE = 293.66; // D4

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private verb!: ConvolverNode;
  private amb!: GainNode;
  muted = false;
  private noiseBuf!: AudioBuffer;
  private lastLoss = 0;
  private biome = 'sciolka';
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private padGain!: GainNode;

  constructor() {
    try {
      this.muted = localStorage.getItem('roj.mute') === '1';
    } catch { /* ignore */ }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(3.2);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.55;
    this.verb.connect(verbGain).connect(this.master);
    this.fx = ctx.createGain();
    this.fx.gain.value = 1;
    this.fx.connect(this.master);
    this.fx.connect(this.verb);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem('roj.mute', m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  suspend(s: boolean) {
    if (!this.ctx) return;
    if (s) this.ctx.suspend();
    else this.ctx.resume();
  }

  private impulse(sec: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }

  private noise(dest: AudioNode, t: number, dur: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur);
    return src;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.0;
    this.amb.gain.setTargetAtTime(1, ctx.currentTime, 2);
    this.amb.connect(this.master);
    // soft drone
    for (const [f, g] of [[73.4, 0.05], [110, 0.03], [146.8, 0.012]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = ctx.createGain();
      lg.gain.value = g * 0.5;
      const gg = ctx.createGain();
      gg.gain.value = g;
      lfo.connect(lg).connect(gg.gain);
      o.connect(gg).connect(this.amb);
      o.start();
      lfo.start();
    }
    // wind
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = this.noiseBuf;
    wsrc.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 380;
    const wg = ctx.createGain();
    wg.gain.value = 0.035;
    this.windGain = wg;
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.07;
    const wlg = ctx.createGain();
    wlg.gain.value = 180;
    wl.connect(wlg).connect(wf.frequency);
    wsrc.connect(wf).connect(wg).connect(this.amb);
    wsrc.start();
    wl.start();
    // rain (storm)
    const rsrc = ctx.createBufferSource();
    rsrc.buffer = this.noiseBuf;
    rsrc.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1400;
    rf.Q.value = 0.5;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rsrc.connect(rf).connect(this.rainGain).connect(this.amb);
    rsrc.start();
    // airy pad above the clouds
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const pf = ctx.createBiquadFilter();
    pf.type = 'lowpass';
    pf.frequency.value = 1200;
    pf.connect(this.padGain).connect(this.verb);
    for (const f of [146.8, 220, 293.7, 349.2, 440]) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.012;
        o.connect(g).connect(pf);
        o.start();
      }
    }
    // frogs croaking far away (pond)
    const croakTick = () => {
      if (!this.ctx) return;
      if (this.biome === 'staw') this.croak(0.25, Math.random() * 1.6 - 0.8);
      setTimeout(croakTick, 700 + Math.random() * 2200);
    };
    croakTick();
    // crickets
    const tick = () => {
      if (!this.ctx) return;
      if (this.biome === 'burza' || this.biome === 'niebo') { setTimeout(tick, 1000); return; }
      const now = this.ctx.currentTime;
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      pan.connect(this.amb);
      const f = 4200 + Math.random() * 900;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const o = this.ctx.createOscillator();
        o.frequency.value = f;
        const g = this.ctx.createGain();
        const t0 = now + k * 0.065;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.012, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045);
        o.connect(g).connect(pan);
        o.start(t0);
        o.stop(t0 + 0.06);
      }
      setTimeout(tick, 350 + Math.random() * 1400);
    };
    tick();
  }

  setBiome(id: string) {
    this.biome = id;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.padGain.gain.setTargetAtTime(id === 'niebo' ? 1 : 0, t, 2);
    this.windGain.gain.setTargetAtTime(id === 'korony' ? 0.06 : id === 'burza' ? 0.08 : id === 'niebo' ? 0.05 : 0.035, t, 1.5);
    if (id !== 'burza') this.rainGain.gain.setTargetAtTime(0, t, 1);
  }

  /** 0..1 rain intensity (storm only). */
  setRain(v: number) {
    if (!this.ctx || this.biome !== 'burza') return;
    this.rainGain.gain.setTargetAtTime(0.05 + v * 0.22, this.ctx.currentTime, 0.3);
  }

  croak(vol = 1, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.fx);
    for (let k = 0; k < 2; k++) {
      const t0 = t + k * 0.13;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, t0);
      o.frequency.exponentialRampToValueAtTime(110, t0 + 0.1);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 520;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.09 * vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(f).connect(g).connect(p);
      o.start(t0);
      o.stop(t0 + 0.14);
    }
  }

  slurp() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + 0.25);
  }

  buzz() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 95;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 32;
    const lg = ctx.createGain();
    lg.gain.value = 0.03;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.2);
    g.gain.linearRampToValueAtTime(0, t + 1.2);
    lfo.connect(lg).connect(g.gain);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    o.connect(f).connect(g).connect(this.fx);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.3);
    lfo.stop(t + 1.3);
  }

  dash() {
    this.whoosh(0.35, 2500, 700, 0.14);
  }

  swoop() {
    this.whoosh(1.1, 300, 1800, 0.25);
  }

  gust() {
    this.whoosh(2.2, 200, 900, 0.12);
  }

  private whoosh(dur: number, f0: number, f1: number, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.noise(bp, t, dur + 0.05);
    bp.connect(g).connect(this.fx);
  }

  hoot() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [dt, dur] of [[0, 0.25], [0.45, 0.5]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const t0 = t + dt;
      o.frequency.setValueAtTime(390, t0);
      o.frequency.linearRampToValueAtTime(360, t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.fx);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }

  rumble() {
    this.thunder(0, 0.5);
  }

  thunder(delay: number, vol = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    this.noise(lp, t, 3.1);
    lp.connect(g).connect(this.master);
  }

  /** Bell in the pentatonic scale; step can be any integer (wraps into octaves). */
  bell(step: number, vol = 0.18, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const oct = Math.floor(step / SCALE.length);
    const deg = ((step % SCALE.length) + SCALE.length) % SCALE.length;
    const f = BASE * Math.pow(2, oct + SCALE[deg] / 12);
    const t = ctx.currentTime + when;
    for (const [mul, g, dec] of [[1, 1, 2.2], [2.76, 0.35, 0.8], [5.4, 0.12, 0.35], [0.5, 0.2, 1.6]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const gn = ctx.createGain();
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(vol * g, t + 0.006);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(gn).connect(this.fx);
      o.start(t);
      o.stop(t + dec + 0.05);
    }
  }

  larva(n: number) {
    const base = 10 + Math.floor(Math.random() * 3);
    const k = Math.min(4, 2 + Math.floor(n / 6));
    for (let i = 0; i < k; i++) this.bell(base + i, 0.07, i * 0.07);
  }

  lantern(k: number) {
    this.bell(5 + ((k * 2) % 7), 0.22);
    this.bell(7 + ((k * 2) % 7), 0.12, 0.12);
    this.bell(10 + ((k * 2) % 7), 0.08, 0.26);
  }

  flash(perfect: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    this.noise(bp, t, 0.7);
    bp.connect(g).connect(this.fx);
    const chord = perfect ? [0, 2, 4, 5, 7] : [0, 2, 4];
    chord.forEach((s, i) => this.bell(10 + s, perfect ? 0.1 : 0.07, i * (perfect ? 0.03 : 0.02)));
  }

  noBlask() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  batWarn(side: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = side * 0.8;
    pan.connect(this.fx);
    for (let k = 0; k < 4; k++) {
      const o = ctx.createOscillator();
      const t0 = t + k * 0.11;
      o.frequency.setValueAtTime(7200, t0);
      o.frequency.exponentialRampToValueAtTime(2800, t0 + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      o.connect(g).connect(pan);
      o.start(t0);
      o.stop(t0 + 0.08);
    }
  }

  loss(n: number) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastLoss < 0.08) return;
    this.lastLoss = t;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.2, 0.05 + n * 0.012), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + 0.25);
  }

  caught() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1100 + Math.random() * 300, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + 0.18);
  }

  revive() {
    [0, 2, 4, 7, 9].forEach((s, i) => this.bell(5 + s, 0.1, i * 0.12));
  }
  finish() {
    [0, 2, 4, 5, 7, 9, 10, 12].forEach((s, i) => this.bell(5 + s, 0.12, i * 0.14));
  }
  over() {
    [7, 5, 4, 2, 0].forEach((s, i) => this.bell(s, 0.1, i * 0.22));
  }
}
