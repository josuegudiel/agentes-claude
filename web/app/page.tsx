import type { Metadata } from 'next';
import { ScannerApp } from '../components/scanner/ScannerApp';

export const metadata: Metadata = {
  title: 'Scanner — escanea documentos desde tu celular',
  description:
    'Escanea documentos con la camara, deteccion automatica de bordes, correccion de perspectiva, filtros y export a JPG, PNG o PDF. Todo en tu navegador.',
};

/**
 * Home del deploy: el scanner. Mobile-first: la app ocupa exactamente el
 * alto de la pantalla (app-shell) y cada vista reparte ese alto — visor o
 * lienzo arriba, acciones abajo al alcance del pulgar, sin scroll de pagina.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main className="app-shell mx-auto flex w-full max-w-lg flex-col gap-2.5 sm:max-w-2xl">
      <header className="flex shrink-0 items-center gap-2.5">
        {/* Marca: etiqueta de papel con sello — dura, sin gradiente. */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-cocoa-900 bg-paper shadow-paper-ink-sm">
          <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
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
          <h1 className="font-display text-xl font-bold leading-none tracking-tight text-cocoa-900">
            Scanner
          </h1>
          <p className="truncate text-xs text-cocoa-500">
            Todo en tu telefono: nada se sube a ningun servidor.
          </p>
        </div>
      </header>

      <ScannerApp />
    </main>
  );
}
