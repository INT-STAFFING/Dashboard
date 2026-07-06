import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Kept at Tailwind's defaults on purpose: the hand-written responsive CSS
    // in globals.css / filterbar.css / admin-gestione.css uses max-width
    // media queries aligned to these same thresholds (sm 640, md 768, lg 1024).
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        petrol: 'var(--petrol)',
        'petrol-d': 'var(--petrol-d)',
        'petrol-l': 'var(--petrol-l)',
        'petrol-bg': 'var(--petrol-bg)',
        gold: 'var(--gold)',
        'gold-d': 'var(--gold-d)',
        'amber-d': 'var(--amber-d)',
        slate: 'var(--slate)',
        'slate-l': 'var(--slate-l)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        good: 'var(--good)',
        bad: 'var(--bad)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
