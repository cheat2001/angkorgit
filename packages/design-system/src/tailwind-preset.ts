import type { Config } from 'tailwindcss';

const preset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          raised: 'hsl(var(--surface-raised) / <alpha-value>)',
          overlay: 'hsl(var(--surface-overlay) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          subtle: 'hsl(var(--border-subtle) / <alpha-value>)',
        },
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        muted: 'hsl(var(--muted-foreground) / <alpha-value>)',
        faint: 'hsl(var(--faint-foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          foreground: 'hsl(var(--danger-foreground) / <alpha-value>)',
        },
        success: 'hsl(var(--success) / <alpha-value>)',
        info: 'hsl(var(--info) / <alpha-value>)',
        'diff-add': 'hsl(var(--diff-add-bg) / <alpha-value>)',
        'diff-del': 'hsl(var(--diff-del-bg) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
      },
      keyframes: {
        locate: {
          '0%': { backgroundColor: 'hsl(var(--primary) / 0.42)', boxShadow: 'inset 3px 0 0 hsl(var(--primary)), 0 0 0 6px hsl(var(--primary) / 0.25)' },
          '60%': { backgroundColor: 'hsl(var(--primary) / 0.16)', boxShadow: 'inset 3px 0 0 hsl(var(--primary)), 0 0 0 2px hsl(var(--primary) / 0)' },
          '100%': { backgroundColor: 'hsl(var(--primary) / 0.1)', boxShadow: 'inset 3px 0 0 hsl(var(--primary)), 0 0 0 0 hsl(var(--primary) / 0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'dialog-in': {
          from: { opacity: '0', transform: 'translate(-50%, -49%) scale(0.97)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
      },
      animation: {
        locate: 'locate 1100ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
};

export default preset;
