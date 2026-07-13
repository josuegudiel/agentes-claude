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
        {/* Marca: documento con la linea de escaneo, plana. */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-leaf-500">
          <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
            <path
              d="M9 5h11l5 5v16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 9 26z"
              fill="#ffffff"
            />
            <path d="M20 5l5 5h-4a1 1 0 0 1-1-1z" fill="#B9E3CE" />
            <rect x="5" y="14.4" width="22" height="2.4" rx="1.2" fill="#136E45" />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-stone-800">
            Scanner
          </h1>
          <p className="truncate text-xs text-stone-500">
            Escanea, endereza y exporta — todo en tu telefono.
          </p>
        </div>
      </header>

      <ScannerApp />

      <footer className="safe-bottom mt-auto pt-3 text-center text-[11px] leading-relaxed text-stone-400">
        100% en tu navegador: nada se sube a ningun servidor.
      </footer>
    </main>
  );
}
