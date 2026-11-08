import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), 'packages/design-system/src', file), 'utf8');

type Vars = Record<string, string>;

function blocks(css: string): Map<string, { vars: Vars; light: boolean }> {
  const out = new Map<string, { vars: Vars; light: boolean }>();
  for (const match of css.matchAll(/^([.:][^{\n]+)\{([^}]*)\}/gm)) {
    const vars: Vars = {};
    for (const [, name, value] of match[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
    out.set(match[1].trim(), { vars, light: /color-scheme:\s*light/.test(match[2]) });
  }
  return out;
}

function luminance(hsl: string): number {
  const [h, s, l] = hsl.split(/\s+/).map((part) => parseFloat(part));
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = blocks(read('tokens.css'));
const darkBase = tokens.get('.dark')!.vars;
const lightBase = tokens.get('.light')!.vars;

const palettes: Array<[string, Vars]> = [
  ['dark', darkBase],
  ['light', lightBase],
  ...[...blocks(read('themes.css')).entries()]
    .filter(([selector]) => selector.startsWith('.theme-'))
    .map(([selector, { vars, light }]): [string, Vars] => [
      selector.slice('.theme-'.length),
      { ...(light ? lightBase : darkBase), ...vars },
    ]),
];

const tierOf = (vars: Vars, key: string) =>
  Math.min(contrast(vars[key], vars.background), contrast(vars[key], vars.surface));

describe('theme text contrast', () => {
  it('covers every theme', () => {
    expect(palettes.length).toBe(16);
  });

  it.each(palettes)('%s keeps body, muted and faint text readable and in order', (_, vars) => {
    const body = tierOf(vars, 'foreground');
    const muted = tierOf(vars, 'muted-foreground');
    const faint = tierOf(vars, 'faint-foreground');
    expect(body).toBeGreaterThanOrEqual(7);
    expect(muted).toBeGreaterThanOrEqual(5.5);
    expect(faint).toBeGreaterThanOrEqual(4.5);
    expect(body).toBeGreaterThan(muted);
    expect(muted).toBeGreaterThan(faint);
  });

  it.each(palettes)('%s gives code comments their own colour', (_, vars) => {
    expect(vars['syntax-comment']).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/);
  });
});
