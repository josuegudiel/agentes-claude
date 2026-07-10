import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
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
        // Tema del scanner: "darkroom" carbon azulado + luz de escaner.
        carbon: {
          950: '#06080e',
          900: '#0a0d15',
          850: '#0f131d',
          800: '#151a27',
          700: '#212940',
          600: '#323d5c',
          500: '#4a5675',
          400: '#71809f',
          300: '#9aa7c2',
          200: '#c4cdde',
        },
        scan: {
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
        paper: '#f4f1e7',
      },
      boxShadow: {
        glow: '0 0 28px rgba(45, 212, 191, 0.30)',
        'glow-sm': '0 0 14px rgba(45, 212, 191, 0.35)',
        card: '0 10px 30px -12px rgba(0, 0, 0, 0.6)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};

export default config;
