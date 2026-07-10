import type { Metadata } from 'next';
import { ScannerApp } from '../components/scanner/ScannerApp';

export const metadata: Metadata = {
  title: 'Scanner — escanea documentos desde tu celular',
  description:
    'Escanea documentos con la camara, deteccion automatica de bordes, correccion de perspectiva, filtros y export a JPG, PNG o PDF. Todo en tu navegador.',
};

/**
 * Home del deploy: el scanner. Este deploy de Vercel es exclusivamente
 * para el agente scanner — los demas agentes (predictivo, auditor) estan
 * estacionados en carpetas privadas (_predictive/, _auditor/) y tendran
 * su propia pagina/deploy mas adelante.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Scanner
        </h1>
        <p className="text-sm text-ink-400">
          Captura, edita y exporta documentos. Deteccion automatica de
          bordes y correccion de perspectiva.
        </p>
      </header>

      <section className="rounded-md border border-ink-800 bg-ink-900 p-4">
        <ScannerApp />
      </section>

      <footer className="mt-auto border-t border-ink-800 pt-4 text-xs text-ink-500">
        100% client-side: camara via <code>getUserMedia</code>, crop y
        filtros con canvas 2D, PDF con jsPDF. No hay backend, no se sube
        nada a ningun servidor.
      </footer>
    </main>
  );
}
