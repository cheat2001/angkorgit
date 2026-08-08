import { mkdir, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, '..', '..', 'docs', 'assets');
const outDir = join(root, 'public', 'screenshots');

const targets = [
  { name: 'graph', width: 1800, quality: 82 },
  { name: 'diff', width: 1600, quality: 82 },
  { name: 'command-palette', width: 1400, quality: 82 },
  { name: 'theme-setting', width: 1400, quality: 82 },
  { name: 'ai-config-setting', width: 1400, quality: 82 },
  { name: 'shortcut-key', width: 1400, quality: 82 },
  { name: 'welcome', width: 1400, quality: 85 },
];

const variants = ['', '-light'];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const { name, width, quality } of targets) {
  for (const variant of variants) {
    const input = join(srcDir, `${name}${variant}.png`);
    const output = join(outDir, `${name}${variant}.webp`);
    const { width: srcWidth } = await sharp(input).metadata();
    const scaled = width >= srcWidth ? null : width / srcWidth;
    await sharp(input)
      .rotate()
      .resize(width, undefined, { withoutEnlargement: true })
      .webp({ quality })
      .toFile(output);
    const { size } = await stat(output);
    const { size: srcSize } = await stat(input);
    const dims = scaled ? `${width}w` : `${srcWidth}w`;
    console.log(
      `${output}  ${dims}  ${(size / 1024).toFixed(0)} KB  (source ${(srcSize / 1024).toFixed(0)} KB, ${Math.round(100 - (size / srcSize) * 100)}% smaller)`,
    );
  }
}

console.log('Screenshots optimized.');

const ogOut = join(outDir, '..', 'og.png');
await sharp(join(root, 'scripts', 'og-source.svg'))
  .png({ quality: 90 })
  .toFile(ogOut);
const ogMeta = await sharp(ogOut).metadata();
const ogSize = await stat(ogOut);
console.log(`${ogOut}  ${ogMeta.width}x${ogMeta.height}  ${(ogSize.size / 1024).toFixed(0)} KB`);
