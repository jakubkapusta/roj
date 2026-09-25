// Frame pipeline:
//   occluders (1/4) -> swarm light (1/4) -> shadowed light + light shafts (1/4)
//   -> scene (sky, parallax forest, playfield, entities, fog, the Shadow)
//   -> bloom chain -> composite (shockwave, chromatic aberration, ACES, grain).

import { DynBuffer, Program, Target, type GL } from '../gl/gl';
import * as S from './shaders';
import { MeshBuilder, SIL_STRIDE } from './mesh';
import { LAYERS, STRIP, buildStrip } from './backdrop';
import { CHUNK, type Level, type Shape } from '../game/level';
import { makeRng } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import { SWARM_RGB, type Game } from '../game/game';
import { STUCK } from '../game/swarm';

type Mesh = { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; count: number };
type Range = { first: number; count: number; col: [number, number, number]; amb: number; gain: number; rim: number; add: boolean };

export const PLAY_W = 600;
export const PLAY_H = 1100;

const PAL = {
  bot: [0.0006, 0.0018, 0.0025] as [number, number, number],
  top: [0.003, 0.009, 0.015] as [number, number, number],
  fogCol: [0.005, 0.013, 0.02] as [number, number, number],
  solid: [0.014, 0.02, 0.018] as [number, number, number],
};

export class Renderer {
  gl: GL;
  hdr: boolean;
  quality = 1;
  W = 0;
  H = 0;
  s = 1; // device px per world unit
  private occ: Target;
  private light: Target;
  private lit: Target;
  private scene: Target;
  private bloom: Target[];
  private pSprite: Program;
  private pSil: Program;
  private pOcc: Program;
  private pLit: Program;
  private pBg: Program;
  private pFog: Program;
  private pShadow: Program;
  private pDown: Program;
  private pUp: Program;
  private pComp: Program;
  private lightSpr: DynBuffer;
  private backSpr: DynBuffer;
  private sceneSpr: DynBuffer;
  private dynMesh: Mesh;
  private dyn = new MeshBuilder(16384);
  private ranges: Range[] = [];
  private mb = new MeshBuilder(65536);
  private chunks = new Map<number, Mesh>();
  private strips = new Map<string, Mesh>();
  private emptyVao: WebGLVertexArrayObject;
  private level: Level | null = null;
  private seed = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 niedostępny');
    this.gl = gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.occ = new Target(gl, false);
    this.light = new Target(gl, this.hdr);
    this.lit = new Target(gl, this.hdr);
    this.scene = new Target(gl, this.hdr);
    this.bloom = [0, 1, 2, 3, 4].map(() => new Target(gl, this.hdr));

    this.pSprite = new Program(gl, S.SPRITE_VS, S.SPRITE_FS, 'sprite');
    this.pSil = new Program(gl, S.SIL_VS, S.SIL_FS, 'sil');
    this.pOcc = new Program(gl, S.SIL_VS, S.OCC_FS, 'occ');
    this.pLit = new Program(gl, S.FULLSCREEN_VS, S.LIT_FS, 'lit');
    this.pBg = new Program(gl, S.FULLSCREEN_VS, S.BG_FS, 'bg');
    this.pFog = new Program(gl, S.FULLSCREEN_VS, S.FOG_FS, 'fog');
    this.pShadow = new Program(gl, S.FULLSCREEN_VS, S.SHADOW_FS, 'shadow');
    this.pDown = new Program(gl, S.FULLSCREEN_VS, S.DOWN_FS, 'down');
    this.pUp = new Program(gl, S.FULLSCREEN_VS, S.UP_FS, 'up');
    this.pComp = new Program(gl, S.FULLSCREEN_VS, S.COMPOSITE_FS, 'comp');

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const mkSpr = () =>
      new DynBuffer(gl, 8, [
        { loc: 1, size: 4, offset: 0, divisor: 1 },
        { loc: 2, size: 4, offset: 4, divisor: 1 },
      ], 8 * 4096, (g) => {
        g.bindBuffer(g.ARRAY_BUFFER, quad);
        g.enableVertexAttribArray(0);
        g.vertexAttribPointer(0, 2, g.FLOAT, false, 8, 0);
      });
    this.lightSpr = mkSpr();
    this.backSpr = mkSpr();
    this.sceneSpr = mkSpr();
    this.dynMesh = this.makeMesh(null, 0);
    this.emptyVao = gl.createVertexArray()!;
  }

  // ------------------------------------------------------------ sizing
  resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    const W = Math.max(2, Math.round(cssW * dpr)), H = Math.max(2, Math.round(cssH * dpr));
    if (W !== this.W || H !== this.H) {
      this.W = W;
      this.H = H;
      this.canvas.width = W;
      this.canvas.height = H;
      this.occ.resize(W / 4, H / 4);
      this.light.resize(W / 4, H / 4);
      this.lit.resize(W / 4, H / 4);
      this.scene.resize(W, H);
      let bw = W / 2, bh = H / 2;
      for (const b of this.bloom) {
        b.resize(bw, bh);
        bw /= 2;
        bh /= 2;
      }
    }
    const sCss = Math.min(cssW / PLAY_W, cssH / PLAY_H);
    this.s = sCss * (W / cssW);
  }
  get viewW() { return this.W / this.s; }
  get viewH() { return this.H / this.s; }

  setLevel(level: Level) {
    if (this.level === level) return;
    for (const m of this.chunks.values()) this.freeMesh(m);
    this.chunks.clear();
    this.level = level;
    this.seed = level.seed;
    for (const m of this.strips.values()) this.freeMesh(m);
    this.strips.clear();
  }

  // ------------------------------------------------------------ meshes
  private makeMesh(data: Float32Array | null, floats: number): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    if (data) gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, floats), gl.STATIC_DRAW);
    const st = SIL_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 16);
    gl.bindVertexArray(null);
    return { vao, vbo, count: floats / SIL_STRIDE };
  }
  private freeMesh(m: Mesh) {
    this.gl.deleteVertexArray(m.vao);
    this.gl.deleteBuffer(m.vbo);
  }

  private chunkMesh(c: number) {
    let m = this.chunks.get(c);
    if (m) return m;
    const L = this.level!;
    const mb = this.mb;
    mb.reset();
    for (const s of L.shapes[c] ?? []) addShape(mb, s);
    // walls with moss and roots
    const r = makeRng(L.seed * 31 + c * 7919);
    const y0 = c === 0 ? -900 : c * CHUNK - 16;
    const y1 = (c + 1) * CHUNK + 16;
    for (const side of [-1, 1] as const) {
      const pts: { x: number; y: number; thick: number }[] = [];
      for (let y = y0; y <= y1; y += 16) {
        pts.push({ x: L.wallAt(side, y), y, thick: 140 + 60 * Math.sin(y * 0.004 + side) + 20 * Math.sin(y * 0.021) });
      }
      mb.wall(pts, side, 1);
      for (let y = y0 + r.range(0, 30); y < y1; y += r.range(18, 46)) {
        const x = L.wallAt(side, y) - side * 2;
        const a = Math.PI / 2 + side * r.range(0.4, 1.3);
        mb.blade(x, y, a, r.range(10, 34), 1.8, -side * r.range(0.2, 0.9), 0.9, 1);
      }
      for (let y = y0 + r.range(0, 200); y < y1; y += r.range(180, 380)) {
        const x = L.wallAt(side, y);
        const a = Math.PI / 2 + side * r.range(0.9, 1.9);
        const len = r.range(25, 60);
        mb.tube([
          { x: x + side * 6, y, r: 7 },
          { x: x + Math.cos(a) * len * 0.5, y: y + Math.sin(a) * len * 0.5, r: 4 },
          { x: x + Math.cos(a + 0.4 * side) * len, y: y + Math.sin(a + 0.4 * side) * len, r: 1 },
        ], 0.3, 1);
      }
    }
    m = this.makeMesh(mb.data, mb.n);
    this.chunks.set(c, m);
    return m;
  }

  private stripMesh(li: number, idx: number) {
    const key = `${li}:${idx}`;
    let m = this.strips.get(key);
    if (m) return m;
    this.mb.reset();
    buildStrip(this.mb, li, idx, this.seed);
    m = this.makeMesh(this.mb.data, this.mb.n);
    this.strips.set(key, m);
    return m;
  }

  // ------------------------------------------------------------ sprites
  private spr(b: DynBuffer, x: number, y: number, size: number, kind: number, r: number, g: number, bl: number, a = 1) {
    b.ensure(8);
    const d = b.data;
    let i = b.n;
    d[i++] = x; d[i++] = y; d[i++] = size; d[i++] = kind;
    d[i++] = r; d[i++] = g; d[i++] = bl; d[i++] = a;
    b.n = i;
  }

  private beginRange(col: [number, number, number], amb: number, gain: number, rim: number, add: boolean) {
    this.ranges.push({ first: this.dyn.vertexCount, count: 0, col, amb, gain, rim, add });
  }
  private endRange() {
    const r = this.ranges[this.ranges.length - 1];
    r.count = this.dyn.vertexCount - r.first;
  }

  // ------------------------------------------------------------ frame
  render(g: Game, opts: { fade: number; showTarget: boolean }) {
    const gl = this.gl;
    this.resize();
    this.setLevel(g.level);
    g.viewW = this.viewW;
    g.viewH = this.viewH;
    const L = g.level;
    const t = g.time;
    const cx = g.camX, cy = g.camY;
    const vz = (2 * this.s) / this.W, vw = (2 * this.s) / this.H;
    const yMin = cy - this.viewH / 2 - 60, yMax = cy + this.viewH / 2 + 60;

    // visible playfield chunks
    const c0 = Math.max(0, Math.floor((yMin - 350) / CHUNK)), c1 = Math.min(L.shapes.length - 1, Math.floor((yMax + 100) / CHUNK));
    const vis: Mesh[] = [];
    for (let c = c0; c <= c1; c++) vis.push(this.chunkMesh(c));
    for (const [c, m] of this.chunks) if (c < c0 - 2 || c > c1 + 2) { this.freeMesh(m); this.chunks.delete(c); }

    this.buildDynamic(g, yMin, yMax, opts.showTarget);

    const setView = (p: Program, par: number) => p.f4('u_view', cx, cy, vz, vw).f1('u_par', par);

    // 1. occluders
    this.occ.bind();
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    setView(this.pOcc.use(), 1).f1('u_time', t).f1('u_wind', 1);
    for (const m of vis) this.drawMesh(m);

    // 2. raw light
    this.light.bind();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawSprites(this.lightSpr, cx, cy, vz, vw);

    // 3. shadowed light + shafts
    this.lit.bind();
    gl.disable(gl.BLEND);
    const s = g.swarm;
    const lpu = ((s.cx - cx) * vz + 1) / 2, lpv = ((s.cy - cy) * vw + 1) / 2;
    this.pLit.use().tex('u_light', 0, this.light.tex).tex('u_occ', 1, this.occ.tex).f2('u_lp', lpu, lpv).f1('u_shadow', 0.85);
    this.fullscreen();

    // 4. scene
    this.scene.bind();
    const endK = smoothstep(L.height - 2600, L.height - 300, cy);
    this.pBg.use().tex('u_lit', 0, this.lit.tex).f4('u_view', cx, cy, vz, vw).f1('u_time', t)
      .v3('u_bot', PAL.bot).v3('u_top', mixv(PAL.top, [0.03, 0.06, 0.12], endK)).v3('u_swarm', SWARM_RGB).f1('u_fogAmt', 1)
      .f2('u_moon', 0.8, endK);
    this.fullscreen();

    const sil = this.pSil.use();
    sil.f1('u_time', t).f1('u_wind', 1).f2('u_res', this.W, this.H).f2('u_lpos', s.cx, s.cy).v3('u_fogCol', mixv(PAL.fogCol, [0.03, 0.05, 0.09], endK));
    // parallax forest, far to near
    for (let li = 0; li < LAYERS.length; li++) {
      const Ld = LAYERS[li];
      const yl = cy * Ld.par;
      const i0 = Math.floor((yl - this.viewH / 2 - 60) / STRIP), i1 = Math.floor((yl + this.viewH / 2 + 60) / STRIP);
      setView(sil, Ld.par).tex('u_light', 0, this.lit.tex).v3('u_col', Ld.col).f1('u_gain', Ld.gain).f1('u_rim', Ld.rim).v3('u_amb', [1, 1, 1]).f1('u_fog', Ld.fog * (1 - endK * 0.3));
      for (let i = i0; i <= i1; i++) this.drawMesh(this.stripMesh(li, i));
    }
    for (const [k, m] of this.strips) {
      const [li, idx] = k.split(':').map(Number);
      const yl = cy * LAYERS[li].par;
      if (idx * STRIP > yl + this.viewH * 1.5 || (idx + 1) * STRIP < yl - this.viewH * 1.5) { this.freeMesh(m); this.strips.delete(k); }
    }
    // motes behind the playfield
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawSprites(this.backSpr, cx, cy, vz, vw);
    gl.disable(gl.BLEND);

    // playfield solids: lit by the raw (unshadowed) light so edges facing the swarm glow
    sil.use();
    setView(sil, 1).tex('u_light', 0, this.light.tex).v3('u_col', PAL.solid).f1('u_gain', 1.0).f1('u_rim', 1.6).v3('u_amb', [0.55, 0.6, 0.65]).f1('u_fog', 0);
    for (const m of vis) this.drawMesh(m);

    // dynamic silhouettes (bats, lanterns) and threads (webs, stems)
    if (this.ranges.length) {
      const gl2 = this.gl;
      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.dynMesh.vbo);
      gl2.bufferData(gl2.ARRAY_BUFFER, this.dyn.data.subarray(0, this.dyn.n), gl2.DYNAMIC_DRAW);
      gl2.bindVertexArray(this.dynMesh.vao);
      for (const r of this.ranges) {
        if (!r.count) continue;
        if (r.add) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); } else gl.disable(gl.BLEND);
        sil.v3('u_col', r.col).f1('u_gain', r.gain).f1('u_rim', r.rim).v3('u_amb', [r.amb, r.amb, r.amb]);
        gl2.drawArrays(gl2.TRIANGLES, r.first, r.count);
      }
    }

    // glowing things
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawSprites(this.sceneSpr, cx, cy, vz, vw);

    // volumetric haze
    this.pFog.use().tex('u_lit', 0, this.lit.tex).f4('u_view', cx, cy, vz, vw).f1('u_time', t).v3('u_swarm', SWARM_RGB).f1('u_fogAmt', 1);
    this.fullscreen();

    // the Shadow
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.pShadow.use().f4('u_view', cx, cy, vz, vw).f1('u_time', t).f1('u_y', g.shadowY);
    this.fullscreen();
    gl.disable(gl.BLEND);

    // 5. bloom
    let src = this.scene;
    for (let i = 0; i < this.bloom.length; i++) {
      const dst = this.bloom[i];
      dst.bind();
      this.pDown.use().tex('u_src', 0, src.tex).f2('u_texel', 1 / src.w, 1 / src.h).f1('u_pre', i === 0 ? 1 : 0).f1('u_thresh', 0.55);
      this.fullscreen();
      src = dst;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const from = this.bloom[i], to = this.bloom[i - 1];
      to.bind();
      this.pUp.use().tex('u_src', 0, from.tex).f2('u_texel', 1 / from.w, 1 / from.h).f1('u_amt', 1);
      this.fullscreen();
    }
    gl.disable(gl.BLEND);

    // 6. composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    let shock = [0, 0, 0, 0];
    let ca = 0.0012;
    if (g.shock) {
      const k = g.shock.t;
      const amp = Math.pow(1 - k, 2) * (g.shock.perfect ? 1.6 : 1);
      shock = [((g.shock.x - cx) * vz + 1) / 2, ((g.shock.y - cy) * vw + 1) / 2, (k * g.shock.R * 1.6 * vw) / 2, amp];
      ca += amp * 0.004;
    }
    this.pComp.use().tex('u_scene', 0, this.scene.tex).tex('u_bloom', 1, this.bloom[0].tex)
      .f2('u_res', this.W, this.H).f1('u_time', t).f1('u_bloomAmt', 0.85).f1('u_exposure', 1.2).f1('u_ca', ca)
      .f4('u_shock', shock[0], shock[1], shock[2], shock[3]).f3('u_lift', 0.0, 0.004, 0.009).f1('u_sat', 1.1).f1('u_fade', opts.fade);
    this.fullscreen();
  }

  private fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  private drawMesh(m: Mesh) {
    if (!m.count) return;
    this.gl.bindVertexArray(m.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, m.count);
  }
  private drawSprites(b: DynBuffer, cx: number, cy: number, vz: number, vw: number) {
    if (!b.n) return;
    b.upload();
    this.pSprite.use().f4('u_view', cx, cy, vz, vw).f1('u_par', 1);
    this.gl.bindVertexArray(b.vao);
    this.gl.drawArraysInstanced(this.gl.TRIANGLE_STRIP, 0, 4, b.count);
  }

  // ------------------------------------------------------------ per-frame geometry
  private buildDynamic(g: Game, yMin: number, yMax: number, showTarget: boolean) {
    const L = g.level;
    const s = g.swarm;
    const t = g.time;
    const LS = this.lightSpr, BS = this.backSpr, SS = this.sceneSpr;
    LS.reset();
    BS.reset();
    SS.reset();
    this.dyn.reset();
    this.ranges.length = 0;
    const [sr, sg, sb] = SWARM_RGB;
    const inView = (y: number, m = 80) => y > yMin - m && y < yMax + m;

    // --- fireflies
    const n = s.n;
    const lightSize = 75 + 2.4 * Math.sqrt(n);
    const step = n > 420 ? 2 : 1;
    const li = (0.55 / Math.sqrt(Math.max(n, 30))) * step;
    for (let i = 0; i < n; i++) {
      const x = s.x[i], y = s.y[i];
      const b = s.bright[i];
      if (s.state[i] === STUCK) {
        SS.ensure(16);
        this.spr(SS, x, y, 8, 0, 0.9 * b, 0.3 * b, 0.1 * b, 0.6);
        this.spr(SS, x, y, 2.2, 1, 2.2 * b, 0.8 * b, 0.3 * b, 1);
        continue;
      }
      if (i % step === 0) this.spr(LS, x, y, lightSize, 0, sr * b * li, sg * b * li, sb * b * li, 1);
      this.spr(SS, x, y, 9, 0, 0.5 * b, 0.95 * b, 0.22 * b, 0.16);
      this.spr(SS, x, y, 2.5, 1, 2.3 * b, 2.6 * b, 1.3 * b, 1);
    }
    // flash light burst
    if (g.shock) {
      const k = 1 - g.shock.t;
      const I = k * k * (g.shock.perfect ? 3.5 : 2.5);
      this.spr(LS, g.shock.x, g.shock.y, g.shock.R * 1.5, 0, 0.8 * I, 1 * I, 0.6 * I, 1);
      this.spr(SS, g.shock.x, g.shock.y, g.shock.R * (0.3 + g.shock.t * 1.2), 2, 0.6 * k, 1 * k, 0.5 * k, 0.8);
    }
    if (showTarget && s.guiding) this.spr(SS, s.tx, s.ty, 18, 2, sr * 0.25, sg * 0.25, sb * 0.25, 1);

    // --- mushrooms
    for (const m of L.glows) {
      if (!inView(m.y, 150)) continue;
      const d = Math.hypot(m.x - s.cx, m.y - s.cy);
      const react = 0.35 + 1.3 * Math.exp(-(d * d) / (220 * 220)) + Math.sin(t * 1.4 + m.phase) * 0.1;
      const [r, gg, b] = m.col;
      this.spr(SS, m.x, m.y, m.r, 0, r * 0.18 * react, gg * 0.18 * react, b * 0.18 * react, 1);
      this.spr(SS, m.x, m.y + 2, 3.2, 1, r * 1.2 * react, gg * 1.2 * react, b * 1.2 * react, 1);
      this.spr(LS, m.x, m.y, m.r * 3.2, 0, r * 0.12 * react, gg * 0.12 * react, b * 0.12 * react, 1);
    }

    // --- sleeping larvae
    for (const lv of L.larvae) {
      if (lv.awake || !inView(lv.y)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.8 + lv.x);
      this.spr(LS, lv.x, lv.y, 90, 0, 0.1 * pulse + 0.05, 0.2 * pulse + 0.1, 0.05, 1);
      this.spr(SS, lv.x, lv.y, 30, 0, 0.08, 0.2 * (0.6 + pulse * 0.4), 0.05, 1);
      const cnt = Math.min(lv.n, 14);
      for (let k = 0; k < cnt; k++) {
        const a = k * 2.399 + t * 0.2;
        const rr = 4 + Math.sqrt(k) * 5;
        const x = lv.x + Math.cos(a) * rr, y = lv.y + Math.sin(a) * rr * 0.7 + Math.sin(t * 2 + k) * 1.5;
        const b = 0.35 + 0.35 * Math.sin(t * 2.4 + k * 1.3);
        this.spr(SS, x, y, 2, 1, 0.8 * b, 1.4 * b, 0.4 * b, 1);
      }
    }

    // --- webs: threads (lit only by the swarm) and dew glints
    this.beginRange([0.6, 0.66, 0.78], 0.02, 1.7, 0, true);
    for (const w of L.webs) {
      if (w.broken || !inView(w.y, w.r)) continue;
      const sh = w.shake * 2.5;
      const jx = (k: number) => Math.sin(t * 43 + k) * sh;
      const d = Math.hypot(w.x - s.cx, w.y - s.cy);
      const glint = Math.exp(-(d * d) / (190 * 190));
      for (const [ax, ay] of w.anchors) {
        const a = Math.atan2(ay - w.y, ax - w.x);
        const ex = w.x + Math.cos(a) * w.r * 0.95, ey = w.y + Math.sin(a) * w.r * 0.95;
        this.dyn.tube([{ x: ex, y: ey, r: 0.6 }, { x: (ex + ax) / 2, y: (ey + ay) / 2 - 8, r: 0.5 }, { x: ax, y: ay, r: 0.5 }], 0, 1);
      }
      for (let k = 0; k < w.spokes.length; k++) {
        const a = w.spokes[k];
        const ex = w.x + Math.cos(a) * w.r, ey = w.y + Math.sin(a) * w.r;
        this.dyn.tube([
          { x: w.x + jx(k), y: w.y, r: 0.7 },
          { x: (w.x + ex) / 2 + jx(k + 1), y: (w.y + ey) / 2 - 3, r: 0.6 },
          { x: ex, y: ey, r: 0.5 },
        ], 0, 1);
      }
      for (let ring = 1; ring <= w.rings; ring++) {
        const rr = w.r * Math.pow(ring / w.rings, 0.85);
        const pts = [];
        for (let k = 0; k <= w.spokes.length; k++) {
          const a0 = w.spokes[k % w.spokes.length];
          const a1 = w.spokes[(k + 1) % w.spokes.length] + (k + 1 >= w.spokes.length ? Math.PI * 2 : 0);
          pts.push({ x: w.x + Math.cos(a0) * rr + jx(ring + k), y: w.y + Math.sin(a0) * rr, r: 0.45 });
          if (k < w.spokes.length) {
            const am = (a0 + a1) / 2;
            pts.push({ x: w.x + Math.cos(am) * rr * 0.93, y: w.y + Math.sin(am) * rr * 0.93, r: 0.4 });
          }
          if (glint > 0.05 && k < w.spokes.length && (k + ring) % 2 === 0) {
            const gi = glint * (0.6 + 0.4 * Math.sin(t * 3 + k * 2 + ring));
            this.spr(SS, w.x + Math.cos(a0) * rr, w.y + Math.sin(a0) * rr, 5, 3, 1.4 * gi, 1.5 * gi, 1.6 * gi, 1);
          }
        }
        this.dyn.tube(pts, 0, 1);
      }
    }
    this.endRange();

    // --- lanterns (physalis): stem thread, papery body, glow
    this.beginRange([0.04, 0.05, 0.035], 0.6, 1, 1, false);
    for (const l of L.lanterns) {
      if (!inView(l.y, 150)) continue;
      const topx = l.x + Math.sin(l.ang) * 12, topy = l.y + Math.cos(l.ang) * 14;
      this.dyn.tube([
        { x: l.ax, y: l.ay, r: 2 },
        { x: (l.ax + topx) / 2 + Math.sin(l.ang) * 6, y: (l.ay + topy) / 2, r: 1.5 },
        { x: topx, y: topy, r: 1.2 },
      ], 0, 1);
    }
    this.endRange();
    this.beginRange([0.5, 0.18, 0.05], 0.3, 1.3, 1.2, false);
    for (const l of L.lanterns) {
      if (!inView(l.y, 150)) continue;
      const tone = l.lit ? 2.2 : 1;
      this.dyn.blob(l.x, l.y, (a) => 13 * (1 + 0.1 * Math.cos(5 * a + l.ang)) + 9 * Math.pow(Math.max(0, -Math.sin(a - l.ang)), 8), 30, 0, tone, 1.2);
    }
    this.endRange();
    for (const l of L.lanterns) {
      if (!inView(l.y, 300)) continue;
      if (l.lit) {
        const f = 0.92 + 0.08 * Math.sin(t * 9 + l.ax) * Math.sin(t * 5.3);
        this.spr(LS, l.x, l.y, 320, 0, 1.0 * f, 0.5 * f, 0.15 * f, 1);
        this.spr(SS, l.x, l.y, 26, 1, 2.4 * f, 1.1 * f, 0.35 * f, 1);
        this.spr(SS, l.x, l.y, 110, 0, 0.45 * f, 0.18 * f, 0.04 * f, 1);
      } else {
        const p = 0.5 + 0.5 * Math.sin(t * 2.2);
        this.spr(SS, l.x, l.y, 40, 0, 0.12 + 0.05 * p, 0.05, 0.01, 1);
        this.spr(LS, l.x, l.y, 110, 0, 0.1 * p + 0.04, 0.04, 0.0, 1);
        if (l.charge > 0) {
          this.spr(SS, l.x, l.y, 42, 5 + clamp(l.charge, 0, 0.999), sr * 1.4, sg * 1.4, sb * 1.4, 1);
          this.spr(LS, l.x, l.y, 180 * l.charge, 0, 0.6 * l.charge, 0.3 * l.charge, 0.1 * l.charge, 1);
        }
      }
    }

    // --- bats
    this.beginRange([0.03, 0.02, 0.04], 0.5, 1.2, 1.6, false);
    for (const b of g.bats) this.batMesh(b.x, b.y, t * 17 + b.phase, b.vx);
    this.endRange();
    for (const b of g.bats) {
      const e = b.flee > 0 ? 0.3 : 1;
      this.spr(SS, b.x - 3, b.y + 11, 1.6, 4, 1.6 * e, 0.35 * e, 0.2 * e, 1);
      this.spr(SS, b.x + 3, b.y + 11, 1.6, 4, 1.6 * e, 0.35 * e, 0.2 * e, 1);
      this.spr(SS, b.x, b.y + 11, 14, 0, 0.2 * e, 0.03 * e, 0.03 * e, 1);
    }
    for (const w of g.warns) {
      const x = w.side * (g.viewW / 2 - 28) + g.camX;
      for (let k = 0; k < 3; k++) {
        const ph = (w.t * 2.2 + k / 3) % 1;
        const a = (1 - ph) * Math.min(1, w.t * 4);
        this.spr(SS, x, w.y, 10 + ph * 60, 2, 0.8 * a, 0.3 * a, 1.2 * a, 1);
      }
      this.spr(SS, x, w.y, 30, 0, 0.3, 0.1, 0.5, 1);
    }

    // --- particles
    for (const p of g.particles) {
      if (!inView(p.y)) continue;
      const k = 1 - p.life / p.max;
      const f = k * (p.kind === 3 ? 1.6 : 1.2);
      this.spr(SS, p.x, p.y, p.size * (0.4 + 0.6 * Math.sqrt(k)), p.kind, p.r * f, p.g * f, p.b * f, 1);
    }

    // --- ambient motes, lit by proximity to the swarm
    const NM = 170;
    const span = this.viewH + 200;
    for (let k = 0; k < NM; k++) {
      const h1 = fract(Math.sin(k * 12.9898) * 43758.5453);
      const h2 = fract(Math.sin(k * 78.233) * 12543.123);
      const h3 = fract(Math.sin(k * 3.71) * 9543.77);
      const x = (fract(h1 + Math.sin(t * 0.05 + k) * 0.02) - 0.5) * this.viewW + g.camX;
      const y = g.camY - span / 2 + fract(h2 + t * (0.004 + h3 * 0.01)) * span;
      const d = Math.hypot(x - s.cx, y - s.cy);
      const b = Math.exp(-(d * d) / (240 * 240)) * 1.1 + 0.025;
      const tw = 0.6 + 0.4 * Math.sin(t * (1 + h3 * 3) + k);
      this.spr(BS, x, y, 2.5 + h3 * 2.5, 0, 0.7 * b * tw, 0.95 * b * tw, 0.6 * b * tw, 1);
    }
  }

  private batMesh(x: number, y: number, ph: number, vx: number) {
    const f = Math.sin(ph);
    const mb = this.dyn;
    const S = 1.15;
    const tilt = clamp(vx / 600, -0.4, 0.4);
    const wing = (dir: number) => {
      const P = [
        [4, 6], [16, 10 + f * 10], [28, 8 + f * 18], [42, 2 + f * 25], [34, -3 + f * 17],
        [29, -1 + f * 13], [22, -7 + f * 9], [16, -3 + f * 6], [9, -7 + f * 3], [4, -4],
      ];
      const xs: number[] = [], ys: number[] = [];
      const order = dir > 0 ? P : [...P].reverse();
      for (const [px, py] of order) {
        const wx = px * dir * S, wy = py * S + px * tilt * dir * 0.6;
        xs.push(x + wx);
        ys.push(y + wy);
      }
      mb.poly(x + 10 * dir * S, y + (1 + f * 4) * S, xs, ys, 0, 1);
    };
    wing(1);
    wing(-1);
    mb.blob(x, y, () => 8, 16, 0, 1.1, 1.4);
    mb.blob(x, y + 11, () => 6, 14, 0, 1.1, 1);
    // ears
    mb.poly(x - 3, y + 16, [x - 6, x - 1, x - 5], [y + 14, y + 15, y + 22], 0, 1);
    mb.poly(x + 3, y + 16, [x + 1, x + 6, x + 5], [y + 15, y + 14, y + 22], 0, 1);
  }
}

function fract(v: number) {
  return v - Math.floor(v);
}

function mixv(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function addShape(mb: MeshBuilder, s: Shape) {
  switch (s.k) {
    case 'tube': mb.tube(s.pts, s.sway, s.tone); break;
    case 'blob': mb.blob(s.x, s.y, (a) => s.r * (1 + Math.sin(a * 3 + s.seed) * 0.08 + Math.sin(a * 7 + s.seed * 2) * 0.04), 28, 0, s.tone, s.squash); break;
    case 'dome': mb.dome(s.x, s.y, s.w, s.h, s.tone); break;
    case 'leaf': mb.leaf(s.x, s.y, s.ang, s.len, s.w, s.curl, s.sway, s.tone); break;
    case 'blade': mb.blade(s.x, s.y, s.ang, s.len, s.w, s.bend, s.sway, s.tone); break;
  }
}
