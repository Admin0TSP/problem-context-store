import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral surface palette — refined later in M4 with a real design system.
        ink: {
          50: '#fafaf9',
          100: '#f4f4f1',
          200: '#e7e7e2',
          300: '#d3d3cc',
          500: '#71716a',
          700: '#3a3a35',
          900: '#0f0f0d',
        },
        accent: {
          DEFAULT: '#5b4fe9',
          fg: '#ffffff',
        },
        severity: {
          low: '#65a30d',
          medium: '#ca8a04',
          high: '#ea580c',
          critical: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
