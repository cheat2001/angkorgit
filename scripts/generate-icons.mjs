#!/usr/bin/env node
/**
 * Generates placeholder app icons (PNG) without any dependencies:
 * a Temple Gold rounded square with a simplified three-tower Angkor mark.
 * For release builds, replace with production art and run `pnpm tauri icon`.
 */
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
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** point-in-triangle test */
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function pixel(size) {
  const s = size;
  // rounded-square background in deep slate; towers in temple gold
  const radius = s * 0.22;
  const towers = [
    // [cx, topY, halfWidth, baseY] in unit space
    [0.5, 0.16, 0.1, 0.62],
    [0.26, 0.3, 0.075, 0.62],
    [0.74, 0.3, 0.075, 0.62],
  ];
  return (x, y) => {
    // rounded rect mask
    const dx = Math.max(radius - x, x - (s - radius), 0);
    const dy = Math.max(radius - y, y - (s - radius), 0);
    if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];

    const u = x / s;
    const v = y / s;

    // base platform
    if (v > 0.62 && v < 0.72 && u > 0.14 && u < 0.86) return [217, 119, 6, 255];
    // branch line + node below the temple
    if (v >= 0.78 && v < 0.82 && u > 0.3 && u < 0.7) return [244, 214, 168, 255];
    const nd = Math.hypot(u - 0.5, v - 0.8);
    if (nd < 0.045) return [244, 214, 168, 255];

    for (const [cx, top, half, base] of towers) {
      if (inTriangle(u, v, [cx, top], [cx - half, base], [cx + half, base])) {
        return [217, 119, 6, 255];
      }
    }
    // background: deep slate #111827
    return [17, 24, 39, 255];
  };
}

for (const [name, size] of [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512],
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
  writeFileSync(join(outDir, name), png(size, pixel(size)));
  console.log(`generated icons/${name}`);
}
console.log('\nDone. For .icns/.ico run: pnpm --filter @angkorgit/desktop tauri icon apps/desktop/src-tauri/icons/icon.png');
