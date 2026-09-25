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
import { frogMouth } from '../game/hazards';
import { STUCK } from '../game/swarm';

type Mesh = { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; count: number };
type Range = { first: number; count: number; col: [number, number, number]; amb: number; gain: number; rim: number; add: boolean };

export const PLAY_W = 600;
export const PLAY_H = 1100;

type V3 = [number, number, number];

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
    const style = L.biome.wallStyle;
    for (const side of [-1, 1] as const) {
      const pts: { x: number; y: number; thick: number }[] = [];
      for (let y = y0; y <= y1; y += 16) {
        const th = 185 + 14 * Math.sin(y * 0.0017 + side * 2) + 5 * Math.sin(y * 0.011);
        pts.push({ x: L.wallAt(side, y), y, thick: th });
      }
      if (style === 'clouds') {
        mb.wall(pts.map((p) => ({ ...p, x: p.x + side * 30 })), side, 0.9);
        for (let y = y0 + r.range(0, 40); y < y1; y += r.range(28, 60)) {
          const pr = r.chance(0.3) ? r.range(22, 40) : r.range(45, 85);
          const x = L.wallAt(side, y) + side * (pr - 18) + side * r.range(0, 40);
          const sv = r.range(0, 100);
          mb.blob(x, y, (a) => pr * (1 + Math.sin(a * 3 + sv) * 0.06), 24, 0, r.range(1.0, 1.25), 0.8);
        }
        continue;
      }
      if (style === 'reeds') {
        for (let y = y0 + r.range(0, 30); y < y1; y += r.range(22, 50)) {
          const x = L.wallAt(side, y) + side * r.range(-4, 60);
          const h = r.range(160, 320);
          mb.tube([{ x, y, r: 5 }, { x: x - side * 6, y: y + h * 0.5, r: 4 }, { x: x - side * 16, y: y + h, r: 1.5 }], [0, 0.2, 0.5], 1.05);
          mb.blade(x, y + h * r.range(0.2, 0.6), Math.PI / 2 + side * r.range(0.3, 0.9), r.range(60, 130), 3, side * r.range(0.3, 0.9), 1, 1);
        }
        continue;
      }
      mb.wall(pts, side, 1);
      // bark: long vertical ridges on the trunk, lit when the swarm passes
      for (let k = 0; k < 5; k++) {
        const off = 22 + k * 32 + r.range(-6, 6);
        let y = y0 + r.range(0, 120);
        while (y < y1) {
          const len = r.range(120, 420);
          const ridge: { x: number; y: number; r: number }[] = [];
          for (let yy = y; yy <= Math.min(y + len, y1); yy += 30) {
            const q = (yy - y) / len;
            ridge.push({ x: L.wallAt(side, yy) + side * (off + Math.sin(yy * 0.01 + k) * 4), y: yy, r: 2.6 * Math.sin(Math.PI * Math.min(1, q)) + 0.4 });
          }
          if (ridge.length > 1) mb.tube(ridge, 0, 1.35);
          y += len + r.range(40, 160);
        }
      }
      // branch stubs on the outer side of the trunk so it reads as a tree from both sides
      for (let y = y0 + r.range(0, 300); y < y1; y += r.range(300, 600)) {
        const x = L.wallAt(side, y) + side * 180;
        const len = r.range(60, 160);
        mb.tube([{ x: x - side * 10, y, r: 12 }, { x: x + side * len * 0.4, y: y + len * 0.3, r: 7 }, { x: x + side * len * 0.8, y: y + len * 0.6, r: 2 }], 0.2, 1);
      }
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
    buildStrip(this.mb, li, idx, this.seed, this.level!.biome.backdrop);
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
    const B = g.biome;
    const PAL = B.pal;
    const t = g.time;
    const cx = g.camX, cy = g.camY;
    const wind = B.wind + g.wind * 2.5;
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
    setView(this.pOcc.use(), 1).f1('u_time', t).f1('u_wind', wind);
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
    const endK = B.id === 'niebo' ? 0 : smoothstep(L.height - 2600, L.height - 300, cy);
    const flash = g.lightning > 0 ? g.lightning * (0.6 + 0.4 * Math.sin(t * 60)) : 0;
    this.pBg.use().tex('u_lit', 0, this.lit.tex).f4('u_view', cx, cy, vz, vw).f1('u_time', t)
      .v3('u_bot', PAL.bot).v3('u_top', mixv(PAL.top, [0.03, 0.06, 0.12], endK)).v3('u_swarm', SWARM_RGB).f1('u_fogAmt', PAL.fogAmt)
      .f2('u_moon', 0.8, Math.max(B.moon, endK)).f1('u_stars', Math.max(B.stars, endK * 0.4)).f1('u_aurora', B.aurora)
      .f1('u_beams', B.id === 'korony' ? 1 : endK * 0.5).f1('u_flash', flash);
    this.fullscreen();

    const sil = this.pSil.use();
    sil.f1('u_time', t).f1('u_wind', wind).f2('u_res', this.W, this.H).f2('u_lpos', s.cx, s.cy).v3('u_fogCol', mixv(mixv(PAL.fogCol, [0.03, 0.05, 0.09], endK), [0.05, 0.055, 0.08], flash * 0.6));
    // parallax forest, far to near
    for (let li = 0; li < LAYERS.length; li++) {
      const Ld = LAYERS[li];
      const yl = cy * Ld.par;
      const i0 = Math.floor((yl - this.viewH / 2 - 60) / STRIP), i1 = Math.floor((yl + this.viewH / 2 + 60) / STRIP);
      const tl = 0.4 + li * 0.3;
      sil.f3('u_topLight', PAL.topLight[0] * tl, PAL.topLight[1] * tl, PAL.topLight[2] * tl);
      setView(sil, Ld.par).tex('u_light', 0, this.lit.tex).v3('u_col', PAL.layers[li]).f1('u_gain', Ld.gain).f1('u_rim', Ld.rim).v3('u_amb', [1, 1, 1]).f1('u_fog', PAL.layerFog[li] * (1 - endK * 0.3));
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
    const sa = PAL.solidAmb;
    sil.v3('u_topLight', PAL.topLight);
    setView(sil, 1).tex('u_light', 0, this.light.tex).v3('u_col', PAL.solid).f1('u_gain', 1.0).f1('u_rim', PAL.rim).v3('u_amb', [sa * 0.9, sa, sa * 1.08]).f1('u_fog', 0);
    for (const m of vis) this.drawMesh(m);

    // dynamic silhouettes (bats, lanterns) and threads (webs, stems)
    if (this.ranges.length) {
      sil.f3('u_topLight', PAL.topLight[0] * 0.3, PAL.topLight[1] * 0.3, PAL.topLight[2] * 0.3);
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
    this.pFog.use().tex('u_lit', 0, this.lit.tex).f4('u_view', cx, cy, vz, vw).f1('u_time', t).v3('u_swarm', SWARM_RGB).f1('u_fogAmt', PAL.fogAmt);
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
      .f4('u_shock', shock[0], shock[1], shock[2], shock[3]).v3('u_lift', PAL.lift).f1('u_sat', PAL.sat).f1('u_fade', opts.fade);
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
      if (l.star || !inView(l.y, 150)) continue;
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
      if (l.star || !inView(l.y, 150)) continue;
      const tone = l.lit ? 2.2 : 1;
      this.dyn.blob(l.x, l.y, (a) => 13 * (1 + 0.1 * Math.cos(5 * a + l.ang)) + 9 * Math.pow(Math.max(0, -Math.sin(a - l.ang)), 8), 30, 0, tone, 1.2);
    }
    this.endRange();
    for (const l of L.lanterns) {
      if (!inView(l.y, 300)) continue;
      if (l.star) {
        // guiding star: a sparkle that blooms when lit
        const tw = 0.85 + 0.15 * Math.sin(t * 3 + l.x);
        if (l.lit) {
          this.spr(LS, l.x, l.y, 340, 0, 0.5 * tw, 0.6 * tw, 1.0 * tw, 1);
          this.spr(SS, l.x, l.y, 70, 3, 2.2 * tw, 2.4 * tw, 3 * tw, 1);
          this.spr(SS, l.x, l.y, 120, 0, 0.2, 0.25, 0.5, 1);
        } else {
          this.spr(SS, l.x, l.y, 34, 3, 0.35 * tw, 0.4 * tw, 0.6 * tw, 1);
          this.spr(LS, l.x, l.y, 100, 0, 0.05, 0.06, 0.12, 1);
        }
        if (!l.lit && l.charge > 0) {
          this.spr(SS, l.x, l.y, 42, 5 + clamp(l.charge, 0, 0.999), sr * 1.4, sg * 1.4, sb * 1.4, 1);
          this.spr(LS, l.x, l.y, 180 * l.charge, 0, 0.3 * l.charge, 0.4 * l.charge, 0.7 * l.charge, 1);
        }
        continue;
      }
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
      // echo rings on the trunk the bat is about to leave
      const x = g.level.wallAt(w.side as -1 | 1, w.y) + w.side * 6;
      for (let k = 0; k < 3; k++) {
        const ph = (w.t * 2.2 + k / 3) % 1;
        const a = (1 - ph) * Math.min(1, w.t * 4);
        this.spr(SS, x, w.y, 10 + ph * 60, 2, 0.8 * a, 0.3 * a, 1.2 * a, 1);
      }
      this.spr(SS, x, w.y, 30, 0, 0.3, 0.1, 0.5, 1);
    }

    this.buildHazards(g, inView);

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


  // ------------------------------------------------------------ biome hazards and weather
  private buildHazards(g: Game, inView: (y: number, m?: number) => boolean) {
    const L = g.level;
    const s = g.swarm;
    const t = g.time;
    const LS = this.lightSpr, SS = this.sceneSpr, BS = this.backSpr;
    const mb = this.dyn;

    // --- water surface, lily pads and reflections (pond)
    if (L.water !== null && inView(L.water, 400)) {
      const wy = L.water;
      this.beginRange([0.006, 0.014, 0.018], 0.8, 0.6, 2.2, false);
      mb.poly(0, wy - 600, [-1600, 1600, 1600, -1600], [wy - 1200, wy - 1200, wy, wy], 0, 1);
      for (const p of L.pads) mb.blob(p.x, wy + 2, (a) => p.w * (a > 5.9 || a < 0.25 ? 0.75 : 1), 20, 0, 1.4, 0.22);
      this.endRange();
      // mirrored fireflies wobbling on the surface
      for (let i = 0; i < s.n; i += 2) {
        const dy = s.y[i] - wy;
        if (dy < 0 || dy > 700) continue;
        const k = Math.exp(-dy / 260) * 0.55;
        const rx = s.x[i] + Math.sin(t * 2 + dy * 0.05) * (3 + dy * 0.02);
        const b = s.bright[i] * k;
        this.spr(SS, rx, wy - dy * 0.9, 3, 1, 1.4 * b, 1.6 * b, 0.8 * b, 1);
      }
      const dy = s.cy - wy;
      if (dy > 0 && dy < 900) {
        const k = Math.exp(-dy / 300);
        this.spr(SS, s.cx, wy - 4, 160 * (1 + dy / 400), 6, 0.35 * k, 0.55 * k, 0.2 * k, 1);
        this.spr(SS, s.cx, wy - dy * 0.9, 90, 0, 0.12 * k, 0.2 * k, 0.06 * k, 1);
      }
    }

    // --- frogs
    this.beginRange([0.03, 0.06, 0.03], 1.0, 1.3, 1.8, false);
    for (const f of L.frogs) if (inView(f.y, 60)) this.frogMesh(f.x, f.y, f.face, f.state === 1 ? Math.sin(f.t * 30) : 0);
    this.endRange();
    this.beginRange([0.8, 0.25, 0.32], 0.9, 1, 0.5, false);
    for (const f of L.frogs) {
      if (!inView(f.y, 400) || (f.state !== 2 && f.state !== 3)) continue;
      const m = frogMouth(f);
      const k = f.state === 2 ? Math.min(1, f.t / 0.1) : 1 - Math.min(1, f.t / 0.25);
      const ex = m.x + (f.tx - m.x) * k, ey = m.y + (f.ty - m.y) * k;
      mb.tube([{ x: m.x, y: m.y, r: 4 }, { x: (m.x + ex) / 2, y: (m.y + ey) / 2 - 4 * k, r: 3.2 }, { x: ex, y: ey, r: 3 }], 0, 1);
      mb.blob(ex, ey, () => 6, 10, 0, 1.3, 1);
    }
    this.endRange();
    for (const f of L.frogs) {
      if (!inView(f.y, 60)) continue;
      const hx = f.x + f.face * 12, hy = f.y + 28;
      const aim = f.state === 1 ? Math.min(1, f.t / 0.5) : 0;
      const closed = f.state === 4 || f.blink < 0;
      if (!closed) {
        const e = 0.35 + aim * 2.2;
        for (const o of [-6, 6]) this.spr(SS, hx + o, hy, 3, 4, 1.8 * e, 1.1 * e, 0.2 * e, 1);
        this.spr(SS, hx, hy, 20, 0, 0.25 * e, 0.15 * e, 0.02 * e, 1);
      } else if (f.state === 4) {
        for (let k = 0; k < 3; k++) {
          const a = t * 3 + k * 2.1;
          this.spr(SS, hx + Math.cos(a) * 12, hy + 10 + Math.sin(a) * 4, 5, 3, 1, 0.9, 0.5, 1);
        }
      }
      if (f.state === 1) {
        // aim line: dotted, filling toward the target
        const m = frogMouth(f);
        const n = 16;
        for (let k = 1; k <= n; k++) {
          const q = k / n;
          if (q > aim * 1.3) break;
          const a = (0.6 + 0.4 * Math.sin(t * 22 - k * 0.8)) * Math.min(1, aim * 1.5);
          this.spr(SS, m.x + (f.tx - m.x) * q, m.y + (f.ty - m.y) * q, 3.4, 1, 2.6 * a, 0.8 * a, 1.0 * a, 1);
          this.spr(SS, m.x + (f.tx - m.x) * q, m.y + (f.ty - m.y) * q, 12, 0, 0.3 * a, 0.08 * a, 0.12 * a, 1);
        }
        const pr = 0.7 + 0.3 * Math.sin(t * 18);
        this.spr(SS, f.tx, f.ty, 30 * (1.4 - aim * 0.4), 2, 1.8 * aim * pr, 0.5 * aim * pr, 0.7 * aim * pr, 1);
      }
    }

    // --- dragonflies
    this.beginRange([0.015, 0.03, 0.035], 0.6, 1.2, 1.4, false);
    for (const d of g.dragonflies) this.dragonflyBody(d.x, d.y, this.dragonAngle(d, s));
    this.endRange();
    this.beginRange([0.25, 0.55, 0.7], 0.12, 1.4, 0, true);
    for (const d of g.dragonflies) this.dragonflyWings(d.x, d.y, this.dragonAngle(d, s), t * 60 + d.phase);
    this.endRange();
    for (const d of g.dragonflies) {
      const a = this.dragonAngle(d, s);
      const hx = d.x + Math.cos(a) * 12, hy = d.y + Math.sin(a) * 12;
      const e = d.state === 1 ? 2.2 : 0.8;
      this.spr(SS, hx, hy, 3, 4, 0.3 * e, 0.9 * e, 1.2 * e, 1);
      if (d.state === 1) {
        const q = Math.min(1, d.t / 0.55);
        for (let k = 1; k <= 10; k++) {
          const u = k / 10;
          const al = q * (1 - u) * 0.9;
          this.spr(SS, d.x + (d.tx - d.x) * u, d.y + (d.ty - d.y) * u, 2, 1, 0.3 * al, 0.9 * al, 1.3 * al, 1);
        }
      }
      if (d.state === 2) this.spr(SS, d.x, d.y, 26, 0, 0.1, 0.35, 0.5, 1);
    }

    // --- owls
    this.beginRange([0.022, 0.018, 0.028], 0.55, 1.2, 1.6, false);
    for (const o of L.owls) {
      if (o.state === 3) continue;
      const x = o.state === 2 ? o.px : o.x, y = o.state === 2 ? o.py : o.y;
      if (inView(y, 120)) this.owlMesh(x, y, o.state === 2 ? 1 : 0, t, o.side);
    }
    this.endRange();
    for (const o of L.owls) {
      if (o.state === 3) continue;
      const x = o.state === 2 ? o.px : o.x, y = o.state === 2 ? o.py : o.y;
      if (!inView(y, 120)) continue;
      const open = o.state === 1 ? Math.min(1, o.t / 0.25) : o.state === 2 ? 1 : 0;
      if (open > 0) {
        for (const e of [-9, 9]) {
          this.spr(SS, x + e, y + 20, 6.5 * open, 1, 3 * open, 2 * open, 0.3 * open, 1);
          this.spr(SS, x + e, y + 20, 22, 0, 0.5 * open, 0.3 * open, 0.02, 1);
        }
        this.spr(LS, x, y + 20, 120, 0, 0.3 * open, 0.2 * open, 0.02, 1);
      } else if (o.state === 4) {
        for (let k = 0; k < 3; k++) {
          const a = t * 3 + k * 2.1;
          this.spr(SS, x + Math.cos(a) * 20, y + 40 + Math.sin(a) * 6, 6, 3, 1, 0.9, 0.5, 1);
        }
      } else {
        // asleep: a faint breathing hint so it can be spotted
        const b = 0.05 + 0.04 * Math.sin(t * 1.5);
        this.spr(SS, x, y + 20, 30, 0, b, b * 0.8, b * 0.3, 1);
      }
    }

    // --- moths
    this.beginRange([0.03, 0.025, 0.03], 0.7, 1.3, 1.3, false);
    for (const m of g.moths) if (inView(m.y, 40)) this.mothMesh(m.x, m.y, t * 34 + m.phase);
    this.endRange();
    for (const m of g.moths) {
      if (!inView(m.y, 40)) continue;
      this.spr(SS, m.x, m.y + 4, 1.4, 4, 0.8, 0.5, 0.9, 1);
      if (Math.random() < 0.15) g.particles.push({ x: m.x, y: m.y, vx: (Math.random() - 0.5) * 20, vy: -20, life: 0, max: 0.8, size: 2, r: 0.3, g: 0.25, b: 0.35, kind: 0, grav: 20, drag: 1 });
    }

    // --- rain: ambient streaks + lethal drops
    if (g.biome.rain) {
      const n = Math.round(80 + g.rain * 260);
      const span = this.viewH + 200;
      const lf = g.lightning;
      for (let k = 0; k < n; k++) {
        const h1 = fract(Math.sin(k * 91.7) * 43758.5);
        const h2 = fract(Math.sin(k * 17.3) * 23421.6);
        const x = (h1 - 0.5) * this.viewW * 1.05 + g.camX - g.wind * g.windDir * 20;
        const y = g.camY + span / 2 - fract(h2 + t * (1.1 + h1 * 0.5)) * span;
        const d = Math.hypot(x - s.cx, y - s.cy);
        const b = Math.exp(-(d * d) / (260 * 260)) * 0.9 + 0.06 + lf * 0.8;
        this.spr(BS, x, y, 16 + h2 * 10, 7, 0.4 * b, 0.5 * b, 0.6 * b, 1);
      }
      for (const d of g.drops) this.spr(SS, d.x, d.y, 18, 7, 0.9, 1.1, 1.4, 1);
      // water dripping from leaf tips
      for (const p of L.leafTips) {
        if (!inView(p.y, 50)) continue;
        const ph = fract(t * (0.7 + g.rain * 1.3) + p.x * 0.013);
        const dd = Math.hypot(p.x - s.cx, p.y - s.cy);
        const b = Math.exp(-(dd * dd) / (220 * 220)) + 0.15 + g.lightning;
        this.spr(SS, p.x, p.y - 4 - ph * ph * 160, 4, 1, 0.5 * b * (1 - ph), 0.65 * b * (1 - ph), 0.9 * b * (1 - ph), 1);
      }
    }
    // --- lightning: flash light + bolt
    if (g.lightning > 0) {
      const I = g.lightning * (0.6 + 0.4 * Math.sin(t * 60)) * 2;
      this.spr(LS, g.camX + g.boltX * 0.4, g.camY + this.viewH * 0.45, this.viewH * 1.6, 0, 0.55 * I, 0.6 * I, 0.9 * I, 1);
      if (g.lightning > 0.55) {
        const r = makeRng(Math.floor(g.boltSeed));
        const pts = [];
        let x = g.camX + g.boltX, y = g.camY + this.viewH / 2 + 50;
        const yEnd = g.camY - this.viewH * r.range(0.1, 0.4);
        while (y > yEnd) {
          pts.push({ x, y, r: 1.8 });
          x += r.range(-40, 40);
          y -= r.range(30, 70);
        }
        pts.push({ x, y, r: 0.5 });
        this.beginRange([2, 2.2, 3], 1, 0, 0, true);
        mb.tube(pts, 0, 1);
        this.endRange();
      }
    }

    // --- the final constellation
    const c = g.constellation;
    if (c) {
      const k = clamp((c.t - 1.6) / 1.5, 0, 1);
      if (k > 0) {
        this.beginRange([0.35 * k, 0.5 * k, 0.9 * k], 1, 0, 0, true);
        for (const [a, b] of c.links) {
          const [x0, y0] = c.stars[a], [x1, y1] = c.stars[b];
          mb.tube([{ x: x0, y: y0, r: 1.1 }, { x: x1, y: y1, r: 1.1 }], 0, 1);
        }
        this.endRange();
        for (const [x, y] of c.stars) {
          this.spr(SS, x, y, 46, 3, 1.5 * k, 1.8 * k, 2.4 * k, 1);
          this.spr(LS, x, y, 200, 0, 0.3 * k, 0.4 * k, 0.6 * k, 1);
        }
      }
    }
  }

  private dragonAngle(d: { state: number; vx: number; vy: number; tx: number; ty: number; x: number; y: number }, s: { cx: number; cy: number }) {
    if (d.state === 2) return Math.atan2(d.vy, d.vx);
    if (d.state === 1) return Math.atan2(d.ty - d.y, d.tx - d.x);
    return Math.atan2(s.cy - d.y, s.cx - d.x);
  }

  private frogMesh(x0: number, y0: number, face0: number, quiver: number) {
    // drawn at 1.35x around the sitting point
    const S = 1.35;
    const mb = this.dyn;
    const face = face0;
    const x = x0, y = y0;
    const first = mb.vertexCount;
    this.frogShape(mb, x, y, face, quiver);
    const d = mb.data;
    for (let v = first; v < mb.vertexCount; v++) {
      const i = v * 7;
      d[i] = x + (d[i] - x) * S;
      d[i + 1] = y + (d[i + 1] - y) * S;
    }
  }

  private frogShape(mb: MeshBuilder, x: number, y: number, face: number, quiver: number) {
    // body, head and eye bulges
    mb.blob(x - face * 3, y + 11, (a) => 17 * (1 + 0.12 * Math.cos(a * 2)), 22, 0, 1, 0.72);
    mb.blob(x + face * 9, y + 16 + quiver * 0.8, () => 10, 18, 0, 1.05, 0.75);
    for (const o of [-4.5, 4.5]) mb.blob(x + face * 9 + o, y + 21, () => 4.2, 12, 0, 1.2, 1);
    // throat sac swelling while aiming
    if (quiver) mb.blob(x + face * 13, y + 10, () => 6 + Math.abs(quiver) * 3, 12, 0, 1.4, 0.8);
    // folded legs
    mb.tube([{ x: x - face * 16, y: y + 8, r: 5 }, { x: x - face * 22, y: y + 2, r: 4 }, { x: x - face * 10, y: y - 2, r: 2.5 }, { x: x - face * 2, y: y - 3, r: 1.5 }], 0, 1);
    mb.tube([{ x: x + face * 8, y: y + 6, r: 3 }, { x: x + face * 14, y: y - 1, r: 2.2 }, { x: x + face * 19, y: y - 3, r: 1.2 }], 0, 1);
  }

  private dragonflyBody(x: number, y: number, a: number) {
    const mb = this.dyn;
    const c = Math.cos(a), sn = Math.sin(a);
    const P = (u: number, v: number) => ({ x: x + c * u - sn * v, y: y + sn * u + c * v });
    const tail = [];
    for (let k = 0; k <= 8; k++) {
      const u = -4 - k * 5.5;
      const p = P(u, Math.sin(k * 0.6) * 1.2);
      tail.push({ x: p.x, y: p.y, r: 2.6 - k * 0.2 });
    }
    mb.tube(tail, 0, 1);
    const th = P(2, 0);
    mb.blob(th.x, th.y, () => 5, 12, 0, 1.1, 1);
    const hd = P(10, 0);
    mb.blob(hd.x, hd.y, () => 4.2, 12, 0, 1.2, 1);
  }

  private dragonflyWings(x: number, y: number, a: number, ph: number) {
    const mb = this.dyn;
    const c = Math.cos(a), sn = Math.sin(a);
    const flap = Math.sin(ph) * 0.18;
    for (const side of [-1, 1]) {
      for (const [off, len, ang] of [[4, 30, 1.35], [-1, 27, 1.75]] as const) {
        const wa = a + side * (ang + flap);
        const bx = x + c * off, by = y + sn * off;
        mb.leaf(bx, by, wa, len, 4.2, 0, 0, 1);
      }
    }
    void c;
  }

  private owlMesh(x: number, y: number, spread: number, t: number, side: number) {
    const mb = this.dyn;
    mb.blob(x, y, (a) => 24 * (1 + 0.18 * Math.pow(Math.max(0, -Math.sin(a)), 2)), 26, 0, 1, 1.35);
    mb.blob(x, y + 22, () => 17, 22, 0, 1.05, 0.9);
    mb.poly(x - 12, y + 35, [x - 16, x - 6, x - 13], [y + 30, y + 31, y + 44], 0, 1.1);
    mb.poly(x + 12, y + 35, [x + 6, x + 16, x + 13], [y + 31, y + 30, y + 44], 0, 1.1);
    // facial disc
    for (const e of [-9, 9]) mb.blob(x + e, y + 20, () => 8, 14, 0, 1.35, 1);
    if (spread > 0) {
      const f = Math.sin(t * 9) * 0.5 + 0.5;
      for (const dir of [-1, 1]) {
        const xs: number[] = [], ys: number[] = [];
        const P = [[10, 10], [40, 22 + f * 10], [80, 20 + f * 24], [110, 6 + f * 30], [96, -6 + f * 20], [84, -2 + f * 14], [70, -10 + f * 10], [56, -4 + f * 6], [40, -12], [16, -8]];
        const ord = dir > 0 ? P : [...P].reverse();
        for (const [px, py] of ord) { xs.push(x + px * dir); ys.push(y + py); }
        mb.poly(x + 40 * dir, y + 4, xs, ys, 0, 1);
      }
    } else {
      // folded wings as side bulges
      for (const dir of [-1, 1]) mb.blob(x + dir * 15, y - 4, () => 12, 16, 0, 0.9, 1.6);
    }
    void side;
  }

  private mothMesh(x: number, y: number, ph: number) {
    const mb = this.dyn;
    const f = Math.abs(Math.sin(ph));
    for (const dir of [-1, 1]) {
      const w = 5 + f * 11;
      mb.blob(x + dir * w * 0.8, y + 3, () => w, 14, 0, 1.1, 0.8 + (1 - f) * 0.4);
      mb.blob(x + dir * w * 0.6, y - 4, () => w * 0.7, 12, 0, 1, 0.8);
    }
    mb.tube([{ x, y: y + 6, r: 2.6 }, { x, y: y - 8, r: 1.4 }], 0, 1.2);
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
    case 'broad': mb.broadLeaf(s.x, s.y, s.ang, s.len, s.w, s.droop, s.tone); break;
  }
}
