import type { ITheme } from '@xterm/xterm';

const FALLBACK_DARK: ITheme = { background: '#0D1220', foreground: '#E2E6EF', cursor: '#D97706' };
const FALLBACK_LIGHT: ITheme = { background: '#FFFFFF', foreground: '#1A2233', cursor: '#D97706' };

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function readToken(style: CSSStyleDeclaration, name: string): Hsl | null {
  const raw = style.getPropertyValue(name).trim();
  const match = raw.match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!match) return null;
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

function toHex({ h, s, l }: Hsl, alpha?: number): string {
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const hue = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  let [r, g, b] = [0, 0, 0];
  if (hue < 1) [r, g, b] = [chroma, x, 0];
  else if (hue < 2) [r, g, b] = [x, chroma, 0];
  else if (hue < 3) [r, g, b] = [0, chroma, x];
  else if (hue < 4) [r, g, b] = [0, x, chroma];
  else if (hue < 5) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];
  const m = light - chroma / 2;
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v + m)) * 255)
      .toString(16)
      .padStart(2, '0');
  const base = `#${channel(r)}${channel(g)}${channel(b)}`;
  if (alpha === undefined) return base;
  return `${base}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

function lighten(color: Hsl, amount: number): Hsl {
  return { ...color, l: Math.min(96, Math.max(4, color.l + amount)) };
}

export function terminalThemeFromTokens(): ITheme {
  if (typeof document === 'undefined') return FALLBACK_DARK;
  const root = document.documentElement;
  const dark = root.classList.contains('dark');
  const style = getComputedStyle(root);
  const token = (name: string) => readToken(style, name);

  const surface = token('--surface');
  const foreground = token('--foreground');
  if (!surface || !foreground) return dark ? FALLBACK_DARK : FALLBACK_LIGHT;

  const primary = token('--primary') ?? { h: 32, s: 93, l: 50 };
  const muted = token('--muted-foreground') ?? foreground;
  const faint = token('--faint-foreground') ?? muted;
  const raised = token('--surface-raised') ?? surface;
  const danger = token('--danger') ?? { h: 0, s: 84, l: 60 };
  const success = token('--success') ?? { h: 142, s: 71, l: 45 };
  const info = token('--info') ?? { h: 199, s: 89, l: 48 };
  const yellow = token('--graph-6') ?? { h: 43, s: 96, l: 56 };
  const magenta = token('--graph-7') ?? { h: 292, s: 84, l: 61 };
  const cyan = token('--graph-5') ?? { h: 174, s: 62, l: 47 };
  const brightStep = dark ? 10 : -8;

  return {
    background: toHex(surface),
    foreground: toHex(foreground),
    cursor: toHex(primary),
    cursorAccent: toHex(surface),
    selectionBackground: toHex(primary, 0.3),
    selectionInactiveBackground: toHex(primary, 0.18),
    black: toHex(dark ? raised : foreground),
    brightBlack: toHex(faint),
    red: toHex(danger),
    brightRed: toHex(lighten(danger, brightStep)),
    green: toHex(success),
    brightGreen: toHex(lighten(success, brightStep)),
    yellow: toHex(yellow),
    brightYellow: toHex(lighten(yellow, brightStep)),
    blue: toHex(info),
    brightBlue: toHex(lighten(info, brightStep)),
    magenta: toHex(magenta),
    brightMagenta: toHex(lighten(magenta, brightStep)),
    cyan: toHex(cyan),
    brightCyan: toHex(lighten(cyan, brightStep)),
    white: toHex(dark ? muted : raised),
    brightWhite: toHex(dark ? foreground : surface),
  };
}
