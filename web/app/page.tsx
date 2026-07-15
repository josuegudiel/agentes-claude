import type { Metadata } from 'next';
import { ScannerApp } from '../components/scanner/ScannerApp';

export const metadata: Metadata = {
  title: 'Scanner — escanea documentos desde tu celular',
  description:
    'Escanea documentos con la camara, deteccion automatica de bordes, correccion de perspectiva, filtros y export a JPG, PNG o PDF. Todo en tu navegador.',
};

/**
 * Home del deploy: el scanner. Mobile-first — header minimo para que el
 * visor de camara quede arriba del fold en un telefono.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 px-4 pt-5 sm:max-w-2xl sm:px-6 sm:pt-8">
      <header className="flex items-center gap-3">
        {/* Marca: etiqueta de papel con sello — dura, sin gradiente. */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-cocoa-900 bg-paper shadow-paper-ink-sm">
          <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
            <path
              d="M9 5h11l5 5v16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 9 26z"
              fill="none"
              stroke="#2B2415"
              strokeWidth="2"
            />
            <path d="M20 5v5h5" fill="none" stroke="#2B2415" strokeWidth="2" />
            <rect x="4.5" y="14.2" width="23" height="2.8" rx="1.4" fill="#C73E1D" />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold leading-none tracking-tight text-cocoa-900">
            Scanner
          </h1>
          <p className="truncate text-xs text-cocoa-500">
            Escanea, endereza y exporta — todo en tu telefono.
          </p>
        </div>
      </header>

      <ScannerApp />

      <footer className="safe-bottom mt-auto pt-3 text-center text-[11px] leading-relaxed text-cocoa-400">
        100% en tu navegador: nada se sube a ningun servidor.
      </footer>
    </main>
  );
}
