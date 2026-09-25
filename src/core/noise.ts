// 1D/2D value noise for level generation (deterministic, seedable).

function h1(i: number, seed: number) {
  let x = Math.imul(i ^ seed, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return ((x >>> 0) / 4294967296) * 2 - 1;
}

export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return h1(i, seed) * (1 - u) + h1(i + 1, seed) * u;
}

export function fbm1(x: number, seed = 0, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += noise1(x * f, seed + o * 131) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
