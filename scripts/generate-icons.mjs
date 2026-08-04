#!/usr/bin/env node
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/desktop/src-tauri/icons');
mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const off = y * (size * 4 + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

const BG_TOP = [27, 37, 55]; // deep slate
const BG_BOTTOM = [11, 16, 28];
const GOLD_TOP = [245, 166, 35]; // Temple Gold gradient
const GOLD_BOTTOM = [196, 106, 8];
const CREAM = [244, 214, 168];
const NODE_GOLD = [240, 180, 41];

function inTower(u, v, cx, y0, y1, halfTop, halfBottom) {
  if (v < y0 || v > y1) return false;
  const t = (v - y0) / (y1 - y0);
  return Math.abs(u - cx) <= lerp(halfTop, halfBottom, t);
}
const inCircle = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;

function centerTower(u, v) {
  return (
    inTower(u, v, 0.5, 0.095, 0.215, 0.0, 0.038) ||
    inTower(u, v, 0.5, 0.215, 0.3, 0.044, 0.058) ||
    inTower(u, v, 0.5, 0.3, 0.41, 0.064, 0.078) ||
    inTower(u, v, 0.5, 0.41, 0.6, 0.086, 0.098)
  );
}
function sideTower(u, v, cx) {
  return (
    inTower(u, v, cx, 0.27, 0.365, 0.0, 0.032) ||
    inTower(u, v, cx, 0.365, 0.45, 0.038, 0.05) ||
    inTower(u, v, cx, 0.45, 0.6, 0.056, 0.068)
  );
}

function sample(u, v, cornerRadius) {
  const dx = Math.max(cornerRadius - u, u - (1 - cornerRadius), 0);
  const dy = Math.max(cornerRadius - v, v - (1 - cornerRadius), 0);
  if (dx * dx + dy * dy > cornerRadius * cornerRadius) return null;

  const goldAt = (vv) => mix(GOLD_TOP, GOLD_BOTTOM, Math.min(Math.max((vv - 0.1) / 0.6, 0), 1));

  if (inCircle(u, v, 0.3, 0.795, 0.036)) return NODE_GOLD;
  if (inCircle(u, v, 0.7, 0.795, 0.036)) return NODE_GOLD;
  if (inCircle(u, v, 0.5, 0.855, 0.038)) return CREAM;

  if (v >= 0.787 && v <= 0.803 && u >= 0.3 && u <= 0.7) return CREAM;
  if (Math.abs(u - 0.5) <= 0.008 && v >= 0.72 && v <= 0.855) return CREAM;

  if (inTower(u, v, 0.5, 0.6, 0.655, 0.34, 0.36)) return goldAt(v);
  if (inTower(u, v, 0.5, 0.655, 0.7, 0.4, 0.42)) return goldAt(v);

  if (centerTower(u, v) || sideTower(u, v, 0.285) || sideTower(u, v, 0.715)) return goldAt(v);

  let bg = mix(BG_TOP, BG_BOTTOM, v);
  const glow = Math.max(0, 1 - Math.hypot((u - 0.5) / 0.55, (v - 0.42) / 0.5));
  bg = mix(bg, [58, 63, 76], glow * glow * 0.35);
  return bg;
}

const SS = 4; // 4×4 supersampling
function pixel(x, y, size) {
  const cornerRadius = 0.223;
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) / size;
      const v = (y + (sy + 0.5) / SS) / size;
      const c = sample(u, v, cornerRadius);
      if (c) {
        r += c[0];
        g += c[1];
        b += c[2];
        a += 255;
      }
    }
  }
  const n = SS * SS;
  return a === 0
    ? [0, 0, 0, 0]
    : [Math.round(r / (a / 255)), Math.round(g / (a / 255)), Math.round(b / (a / 255)), Math.round(a / n)];
}

for (const [name, size] of [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 1024],
  ['Square107x107Logo.png', 107],
  ['Square142x142Logo.png', 142],
  ['Square150x150Logo.png', 150],
  ['Square284x284Logo.png', 284],
  ['Square30x30Logo.png', 30],
  ['Square310x310Logo.png', 310],
  ['Square44x44Logo.png', 44],
  ['Square71x71Logo.png', 71],
  ['Square89x89Logo.png', 89],
  ['StoreLogo.png', 50],
]) {
  writeFileSync(join(outDir, name), png(size, pixel));
  console.log(`generated icons/${name}`);
}
console.log('\nDone. For .icns/.ico run: pnpm --filter @angkorgit/desktop exec tauri icon src-tauri/icons/icon.png');
