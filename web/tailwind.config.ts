import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Zilla Slab (slab serif con caracter de sello/imprenta) para
        // titulos y CTAs; Public Sans para el cuerpo. Deliberadamente
        // NADA de Inter/Space Grotesk/Nunito — defaults de IA.
        display: ['var(--font-display)', 'Georgia', 'serif'],
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
        // Tema del scanner: "El Escritorio" — papeleria fisica.
        // Kraft (papel madera), cocoa (tinta calida), stamp (rojo sello),
        // note (amarillo nota adhesiva), paper (papel blanco calido).
        kraft: {
          50: '#FBF7EE',
          100: '#F5EEDF',
          200: '#EDE4D3',
          300: '#DFD2B8',
          400: '#C9B896',
        },
        cocoa: {
          300: '#AD9F87',
          400: '#8A7E68',
          500: '#6E6350',
          700: '#4A4132',
          900: '#2B2415',
        },
        stamp: {
          50: '#FBEEE8',
          100: '#F7DDD3',
          600: '#C73E1D',
          700: '#A93317',
        },
        note: {
          100: '#F9EAC0',
          300: '#EBCB6E',
          700: '#8A6914',
        },
        paper: '#FDFBF5',
      },
      boxShadow: {
        // Sombras DURAS desplazadas — recorte de papel, no blur difuso.
        paper: '3px 3px 0 0 rgba(43, 36, 21, 0.16)',
        'paper-sm': '2px 2px 0 0 rgba(43, 36, 21, 0.14)',
        'paper-ink': '3px 3px 0 0 #2B2415',
        'paper-ink-sm': '2px 2px 0 0 #2B2415',
      },
    },
  },
  plugins: [],
};

export default config;
