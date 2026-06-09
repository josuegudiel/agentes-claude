import type { Metadata } from 'next';
import { AuditorApp } from '../../components/auditor/AuditorApp';

export const metadata: Metadata = {
  title: 'Auditor GEO/SEO — agentes-claude',
  description:
    'Audita gratis la visibilidad de tu negocio en Google y en los motores de IA (AI Overviews, ChatGPT, Perplexity): SEO tecnico, preparacion GEO y presencia online.',
};

export default function AuditorPage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Auditor GEO/SEO para negocios locales
          </h1>
          <p className="text-sm text-ink-400">
            ¿Tu negocio aparece cuando alguien le pregunta a Google o a ChatGPT? Auditoria gratuita:
            SEO tecnico, preparacion GEO y presencia online.
          </p>
        </div>
        <a href="/" className="text-xs text-ink-400 underline hover:text-ink-200">
          {'<-'} Volver al home
        </a>
      </header>

      <AuditorApp />

      <footer className="mt-auto border-t border-ink-800 pt-4 text-xs text-ink-500">
        Los buscadores con IA ya responden por los negocios: si tu sitio no esta preparado,
        recomiendan a la competencia. <code>POST /api/auditor</code> stream SSE.
      </footer>
    </main>
  );
}
