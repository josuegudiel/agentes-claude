import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Nunito para todo: terminales redondeadas = calido y friendly.
        // (Deliberadamente NO Inter/Space Grotesk — defaults de IA.)
        display: ['var(--font-body)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
      colors: {
        // Escala original del proyecto (la usan las paginas estacionadas).
        ink: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // Tema del scanner: "papel fresco" — claro, plano, un solo acento.
        paper: '#FAF8F3',
        leaf: {
          50: '#EEF8F2',
          100: '#DCF1E5',
          200: '#B9E3CE',
          300: '#8BD0AC',
          500: '#1E9E64',
          600: '#188A56',
          700: '#136E45',
        },
      },
    },
  },
  plugins: [],
};

export default config;
