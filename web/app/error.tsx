'use client';

import { useI18n } from '../components/scanner/i18n';

const TEXT = {
  es: {
    title: 'Algo salió mal',
    body: 'Tus páginas escaneadas siguen guardadas en este teléfono. Prueba de nuevo o recarga la app.',
    retry: 'Reintentar',
    reload: 'RECARGAR',
  },
  en: {
    title: 'Something went wrong',
    body: 'Your scanned pages are still saved on this phone. Try again or reload the app.',
    retry: 'Try again',
    reload: 'RELOAD',
  },
};

/**
 * Si algo falla al dibujar la app, en vez de la pagina blanca (y en
 * ingles) de Next se muestra esto. Las paginas siguen guardadas en el
 * telefono (IndexedDB): recargar las recupera.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }): React.ReactElement {
  const { lang } = useI18n();
  const x = TEXT[lang];
  return (
    <main className="app-shell mx-auto flex w-full max-w-lg flex-col items-center justify-center gap-5 bg-night-950 px-8 text-center">
      <h1 className="font-display text-3xl font-extrabold uppercase tracking-[0.02em]">{x.title}</h1>
      <p className="text-night-300">
        {x.body}
      </p>
      <div className="flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="press h-14 rounded-2xl bg-volt font-display text-xl font-extrabold uppercase tracking-[0.1em] text-night-950"
        >
          {x.retry}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="press h-12 rounded-2xl border border-night-600 font-mono text-xs font-bold tracking-[0.1em] text-night-200"
        >
          {x.reload}
        </button>
      </div>
    </main>
  );
}
