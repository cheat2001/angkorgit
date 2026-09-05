import type { Config } from 'tailwindcss';
import preset from '../../packages/design-system/src/tailwind-preset';

export default {
  presets: [preset as Config],
  content: ['./src/**/*.{astro,ts,tsx}', '../../packages/design-system/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      letterSpacing: {
        tightest: '-0.03em',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', '"Times New Roman"', 'serif'],
      },
    },
  },
} satisfies Config;
