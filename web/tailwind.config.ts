import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Diseno "Obturador": Barlow Condensed (titulos y etiquetas en
        // mayusculas, como los rotulos de una camara), JetBrains Mono (datos
        // tecnicos: resolucion, dpi, contadores) e Instrument Sans (texto).
        display: ['var(--font-display)', 'Arial Narrow', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
        // Tema del scanner: "Obturador" — app de camara profesional.
        // Negros neutros y UN solo acento (lima "volt"); ambar solo para
        // advertencias y rojo solo para acciones destructivas.
        night: {
          950: '#0B0B0C',
          900: '#111113',
          850: '#161618',
          800: '#1D1D20',
          700: '#242428',
          600: '#3A3A3E',
          500: '#5C5C62',
          400: '#8A8A8F',
          300: '#B4B4B8',
          200: '#D6D6D9',
          100: '#F2F2F0',
        },
        volt: {
          DEFAULT: '#D4FF3A',
          600: '#B8E61F',
        },
        warn: '#FFB020',
        danger: '#FF5A4F',
      },
    },
  },
  plugins: [],
};

export default config;
