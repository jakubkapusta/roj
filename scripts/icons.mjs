// Generates the PWA icons (PNG) procedurally: a glowing swarm on a night-forest square.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// a fixed little swarm
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const flies = Array.from({ length: 70 }, () => {
  const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.2;
  return [0.5 + Math.cos(a) * d, 0.53 + Math.sin(a) * d * 0.9, 0.006 + rnd() * 0.006];
});
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

function pixel(u, v, maskable) {
  // background: deep teal night with two trunk silhouettes
  let r = 3 + 10 * (1 - v), g = 10 + 22 * (1 - v), b = 14 + 30 * (1 - v);
  const trunk = (cx, w) => Math.abs(u - cx - Math.sin(v * 3) * 0.01) < w;
  if (trunk(0.12, 0.07) || trunk(0.9, 0.06)) { r *= 0.35; g *= 0.35; b *= 0.35; }
  // glow
  const dx = u - 0.5, dy = v - 0.53, d2 = dx * dx + dy * dy;
  const glow = Math.exp(-d2 / 0.018) * 0.9 + Math.exp(-d2 / 0.08) * 0.25;
  r += glow * 110; g += glow * 190; b += glow * 50;
  for (const [fx, fy, fr] of flies) {
    const e = Math.hypot(u - fx, v - fy) / fr;
    if (e < 3) { const k = Math.exp(-e * e * 1.2); r += k * 240; g += k * 255; b += k * 170; }
  }
  // rounded corners unless maskable (the OS masks those itself)
  let a = 255;
  if (!maskable) {
    const R = 0.2, qx = Math.max(Math.abs(u - 0.5) - (0.5 - R), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - R), 0);
    const dd = Math.hypot(qx, qy) - R;
    a = clamp(255 * Math.min(1, Math.max(0, -dd * 300)));
  }
  return [clamp(r), clamp(g), clamp(b), a];
}

writeFileSync('public/icon-192.png', png(192, (u, v) => pixel(u, v, false)));
writeFileSync('public/icon-512.png', png(512, (u, v) => pixel(u, v, false)));
writeFileSync('public/icon-maskable-512.png', png(512, (u, v) => pixel(0.5 + (u - 0.5) * 1.25, 0.5 + (v - 0.5) * 1.25, true)));
writeFileSync('public/apple-touch-icon.png', png(180, (u, v) => pixel(u, v, true)));
console.log('icons written');
