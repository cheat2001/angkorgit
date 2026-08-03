import type { Config } from 'tailwindcss';
import preset from '../../packages/design-system/src/tailwind-preset';

export default {
  presets: [preset as Config],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/design-system/src/**/*.{ts,tsx}'],
} satisfies Config;
