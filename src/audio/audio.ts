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
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.07;
    const wlg = ctx.createGain();
    wlg.gain.value = 180;
    wl.connect(wlg).connect(wf.frequency);
    wsrc.connect(wf).connect(wg).connect(this.amb);
    wsrc.start();
    wl.start();
    // crickets
    const tick = () => {
      if (!this.ctx) return;
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
