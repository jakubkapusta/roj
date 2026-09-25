// GLSL ES 3.00 sources. All lighting is in linear space; the composite pass tone-maps.

const H = `#version 300 es
precision highp float;
`;

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float s = 0., a = .5;
  for (int i = 0; i < 4; i++){ s += vnoise(p)*a; p = p*2.03 + vec2(17.1, 3.7); a *= .5; }
  return s;
}
`;

export const FULLSCREEN_VS = `${H}
out vec2 v_uv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

// ---------------------------------------------------------------- sprites
export const SPRITE_VS = `${H}
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_ps;   // x, y, size, kind
layout(location=2) in vec4 a_col;  // rgb, intensity
uniform vec4 u_view;               // cam x, cam y, 2s/W, 2s/H
uniform float u_par;
out vec2 v_uv;
out vec4 v_col;
out float v_kind;
void main(){
  v_uv = a_corner;
  v_col = a_col;
  v_kind = a_ps.w;
  vec2 p = a_ps.xy + a_corner * a_ps.z;
  gl_Position = vec4((p - u_view.xy * u_par) * u_view.zw, 0., 1.);
}`;

export const SPRITE_FS = `${H}
in vec2 v_uv;
in vec4 v_col;
in float v_kind;
out vec4 o;
void main(){
  float d = length(v_uv);
  if (d > 1.) discard;
  float s;
  if (v_kind < .5) {            // soft glow
    s = exp(-d*d*4.5) * (1. - smoothstep(.8, 1., d));
  } else if (v_kind < 1.5) {    // bright core
    s = smoothstep(1., .15, d); s *= s;
  } else if (v_kind < 2.5) {    // ring
    s = exp(-pow((d - .8) * 10., 2.));
  } else if (v_kind < 3.5) {    // sparkle
    vec2 a = abs(v_uv);
    float st = max(exp(-a.x*30.)*exp(-a.y*2.5), exp(-a.y*30.)*exp(-a.x*2.5));
    s = exp(-d*d*10.) + st * .7;
    s *= 1. - smoothstep(.85, 1., d);
  } else if (v_kind < 4.5) {    // hard disk (dark bits, eyes)
    s = smoothstep(1., .8, d);
  } else {                      // progress arc, fraction = kind - 5
    float frac = v_kind - 5.;
    float ang = atan(v_uv.x, v_uv.y) / 6.2831853 + .5;
    s = exp(-pow((d - .82) * 14., 2.)) * step(1. - frac, ang);
  }
  o = vec4(v_col.rgb * s * v_col.a, s * v_col.a);
}`;

// ---------------------------------------------------------------- silhouettes
export const SIL_VS = `${H}
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_nrm;
layout(location=2) in vec3 a_est;  // edge, sway, tone
uniform vec4 u_view;
uniform float u_par;
uniform float u_time;
uniform float u_wind;
out vec2 v_nrm;
out float v_edge;
out float v_tone;
out vec2 v_world;
void main(){
  vec2 p = a_pos;
  float s = a_est.y;
  p.x += (sin(u_time*1.1 + a_pos.y*.013 + a_pos.x*.007)*.7 + sin(u_time*2.3 + a_pos.x*.05)*.3) * s * 5. * u_wind;
  p.y += sin(u_time*1.7 + a_pos.x*.02) * s * 1.5 * u_wind;
  v_nrm = a_nrm;
  v_edge = a_est.x;
  v_tone = a_est.z;
  v_world = p - u_view.xy * u_par + u_view.xy;
  gl_Position = vec4((p - u_view.xy * u_par) * u_view.zw, 0., 1.);
}`;

export const SIL_FS = `${H}
in vec2 v_nrm;
in float v_edge;
in float v_tone;
in vec2 v_world;
uniform sampler2D u_light;
uniform vec2 u_res;
uniform vec3 u_col;
uniform vec2 u_lpos;      // swarm center, world
uniform float u_gain;
uniform float u_rim;
uniform vec3 u_amb;
uniform vec3 u_fogCol;
uniform float u_fog;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 L = texture(u_light, uv).rgb;
  float e = v_edge;
  vec3 n = normalize(vec3(v_nrm * e, 1. - e * .85 + .05));
  vec2 toL = u_lpos - v_world;
  float dl = length(toL);
  vec3 ld = normalize(vec3(toL, 70.));
  float diff = max(dot(n, ld), 0.);
  float facing = max(dot(v_nrm, toL / (dl + 1e-3)), 0.);
  float rim = pow(e, 5.) * facing;
  vec3 base = u_col * v_tone;
  vec3 c = base * u_amb + base * L * (.15 + diff * 1.2) * u_gain + L * rim * u_rim;
  c = mix(c, u_fogCol, u_fog);
  o = vec4(c, 1.);
}`;

// occluder mask: solids drawn flat
export const OCC_FS = `${H}
out vec4 o;
void main(){ o = vec4(1.); }`;

// ---------------------------------------------------------------- lit pass
export const LIT_FS = `${H}
${NOISE}
in vec2 v_uv;
uniform sampler2D u_light;
uniform sampler2D u_occ;
uniform vec2 u_lp;        // swarm center in uv
uniform float u_shadow;
out vec4 o;
void main(){
  vec3 raw = texture(u_light, v_uv).rgb;
  vec2 d = u_lp - v_uv;
  float dist = length(d);
  float j = hash12(gl_FragCoord.xy);
  // shadows: occluders between this pixel and the swarm
  const int NS = 14;
  vec2 st = d / float(NS);
  vec2 p = v_uv + st * j;
  float occ = 0.;
  for (int i = 0; i < NS; i++) { occ += texture(u_occ, p).r; p += st; }
  float vis = exp(-occ * .6);
  // light shafts: short radial blur of unoccluded light toward the swarm
  const int NR = 14;
  vec2 st2 = d / max(dist, 1e-4) * min(dist, .2) / float(NR);
  p = v_uv + st2 * j;
  float scat = 0., w = 1., ws = 0.;
  for (int i = 0; i < NR; i++) {
    float l = dot(texture(u_light, p).rgb, vec3(.3333)) * (1. - texture(u_occ, p).r);
    scat += l * w; ws += w; w *= .9; p += st2;
  }
  o = vec4(raw * mix(1., vis, u_shadow), scat / ws * mix(1., vis, .6));
}`;

// ---------------------------------------------------------------- background
export const BG_FS = `${H}
${NOISE}
in vec2 v_uv;
uniform sampler2D u_lit;
uniform vec4 u_view;
uniform float u_time;
uniform vec3 u_bot;
uniform vec3 u_top;
uniform vec3 u_swarm;
uniform float u_fogAmt;
uniform vec2 u_moon;      // moon uv y (can be > 1 = offscreen), strength
out vec4 o;
void main(){
  vec2 wp = (v_uv * 2. - 1.) / u_view.zw + u_view.xy * .12;
  vec3 c = mix(u_bot, u_top, clamp(v_uv.y * .9 + .05, 0., 1.));
  float f = fbm(wp * .0025 + vec2(u_time * .012, -u_time * .006));
  f = smoothstep(.25, .85, f);
  vec4 L = texture(u_lit, v_uv);
  c += f * u_fogAmt * (L.rgb * .05 + u_swarm * L.a * .12);
  c += f * u_top * .5;
  // moon glow for the clearing at the end
  vec2 mp = vec2(.5, u_moon.x);
  vec2 dm = (v_uv - mp) * vec2(u_view.w / u_view.z, 1.);
  float md = length(dm);
  c += vec3(.55, .65, .9) * (exp(-md * 7.) * .6 + smoothstep(.07, .065, md) * 2.5) * u_moon.y;
  o = vec4(c, 1.);
}`;

export const FOG_FS = `${H}
${NOISE}
in vec2 v_uv;
uniform sampler2D u_lit;
uniform vec4 u_view;
uniform float u_time;
uniform vec3 u_swarm;
uniform float u_fogAmt;
out vec4 o;
void main(){
  vec2 wp = (v_uv * 2. - 1.) / u_view.zw + u_view.xy * .95;
  float f = fbm(wp * .004 + vec2(u_time * .03, u_time * .011));
  f = smoothstep(.3, .9, f);
  vec4 L = texture(u_lit, v_uv);
  vec3 c = (L.rgb * .015 + u_swarm * L.a * .1) * (.2 + f) * u_fogAmt;
  o = vec4(c, 0.);
}`;

// ---------------------------------------------------------------- the Shadow (Cień)
export const SHADOW_FS = `${H}
${NOISE}
in vec2 v_uv;
uniform vec4 u_view;
uniform float u_time;
uniform float u_y;
out vec4 o;
void main(){
  vec2 wp = (v_uv * 2. - 1.) / u_view.zw + u_view.xy;
  float n1 = fbm(vec2(wp.x * .006, u_time * .22));
  float n2 = vnoise(vec2(wp.x * .035, u_time * .5));
  float tend = pow(max(n2 - .35, 0.) / .65, 2.5) * 190.;
  float edge = u_y + (n1 - .5) * 150. + tend;
  float dy = wp.y - edge;
  float a = 1. - smoothstep(-90., 25., dy);
  float band = exp(-pow(dy / 30., 2.)) + exp(-pow((dy + 60.) / 90., 2.)) * .35;
  float swirl = fbm(wp * .01 + vec2(0., -u_time * .3));
  vec3 col = vec3(.28, .06, .48) * band * (.5 + swirl) * 1.4;
  // faint eyes deep in the dark
  vec2 cell = floor(wp / vec2(140., 110.));
  vec2 fr = fract(wp / vec2(140., 110.)) - .5;
  float h = hash12(cell);
  float blink = step(.93, fract(u_time * .13 + h * 7.));
  float eyes = 0.;
  if (h > .72 && dy < -120.) {
    vec2 e1 = (fr - vec2(-.07, 0.)) * vec2(140., 110.);
    vec2 e2 = (fr - vec2(.07, 0.)) * vec2(140., 110.);
    eyes = (smoothstep(3.5, 1.5, length(e1 * vec2(1., 1.8))) + smoothstep(3.5, 1.5, length(e2 * vec2(1., 1.8)))) * (1. - blink);
  }
  col += vec3(.9, .35, 1.) * eyes * 1.5 * smoothstep(-120., -300., dy);
  o = vec4(col, a);
}`;

// ---------------------------------------------------------------- bloom
export const DOWN_FS = `${H}
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_pre;       // 1 on the first (threshold) pass
uniform float u_thresh;
out vec4 o;
void main(){
  vec2 t = u_texel;
  vec3 a = texture(u_src, v_uv + t * vec2(-1., -1.)).rgb;
  vec3 b = texture(u_src, v_uv + t * vec2( 1., -1.)).rgb;
  vec3 c = texture(u_src, v_uv + t * vec2(-1.,  1.)).rgb;
  vec3 d = texture(u_src, v_uv + t * vec2( 1.,  1.)).rgb;
  vec3 e = texture(u_src, v_uv).rgb;
  vec3 s = (a + b + c + d) * .125 + e * .5;
  if (u_pre > .5) {
    float br = max(s.r, max(s.g, s.b));
    float knee = u_thresh * .5;
    float rq = clamp(br - u_thresh + knee, 0., 2. * knee);
    rq = rq * rq / (4. * knee + 1e-4);
    s *= max(rq, br - u_thresh) / max(br, 1e-4);
  }
  o = vec4(s, 1.);
}`;

export const UP_FS = `${H}
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_amt;
out vec4 o;
void main(){
  vec2 t = u_texel;
  vec3 s = texture(u_src, v_uv).rgb * 4.;
  s += texture(u_src, v_uv + t * vec2(-1., 0.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2( 1., 0.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2(0., -1.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2(0.,  1.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2(-1., -1.)).rgb;
  s += texture(u_src, v_uv + t * vec2( 1., -1.)).rgb;
  s += texture(u_src, v_uv + t * vec2(-1.,  1.)).rgb;
  s += texture(u_src, v_uv + t * vec2( 1.,  1.)).rgb;
  o = vec4(s / 16. * u_amt, 1.);
}`;

// ---------------------------------------------------------------- composite
export const COMPOSITE_FS = `${H}
${NOISE}
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_res;
uniform float u_time;
uniform float u_bloomAmt;
uniform float u_exposure;
uniform float u_ca;
uniform vec4 u_shock;      // center uv, radius (in height units), amplitude
uniform vec3 u_lift;
uniform float u_sat;
uniform float u_fade;      // 0..1 fade to black
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
void main(){
  vec2 uv = v_uv;
  float asp = u_res.x / u_res.y;
  vec2 dd = (uv - u_shock.xy) * vec2(asp, 1.);
  float r = length(dd);
  float k = exp(-pow((r - u_shock.z) * 16., 2.)) * u_shock.w;
  uv -= (dd / (r + 1e-4)) * k * .025 / vec2(asp, 1.);
  vec2 cd = (uv - .5) * (u_ca + k * .02);
  vec3 c = vec3(texture(u_scene, uv + cd).r, texture(u_scene, uv).g, texture(u_scene, uv - cd).b);
  c += texture(u_bloom, uv).rgb * u_bloomAmt;
  c *= u_exposure;
  c = aces(c);
  float l = dot(c, vec3(.2126, .7152, .0722));
  c = mix(vec3(l), c, u_sat);
  c += u_lift * (1. - l);
  vec2 q = v_uv - .5;
  c *= 1. - dot(q * vec2(asp > 1. ? .7 : 1., 1.), q) * 1.1;
  c = pow(max(c, 0.), vec3(1. / 2.2));
  c += (hash12(gl_FragCoord.xy + fract(u_time * 7.3) * 311.) - .5) * .035;
  c *= 1. - u_fade;
  o = vec4(c, 1.);
}`;
