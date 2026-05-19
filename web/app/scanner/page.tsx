import type { Metadata } from 'next';
import { ScannerApp } from '../../components/scanner/ScannerApp';

export const metadata: Metadata = {
  title: 'Scanner — agentes-claude',
  description:
    'Escanea documentos desde la camara, edita y recorta, aplica filtros y exporta a JPG, PNG o PDF.',
};

export default function ScannerPage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Scanner
          </h1>
          <p className="text-sm text-ink-400">
            Captura, edita y exporta documentos. Todo corre en el browser —
            tus imagenes nunca salen del dispositivo.
          </p>
        </div>
        <a
          href="/"
          className="text-xs text-ink-400 underline hover:text-ink-200"
        >
          {'<-'} Volver al home
        </a>
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
