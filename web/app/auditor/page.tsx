import type { Metadata } from 'next';
import { AuditorApp } from '../../components/auditor/AuditorApp';

export const metadata: Metadata = {
  title: 'Auditor GEO/SEO — agentes-claude',
  description:
    'Audita gratis la visibilidad de tu negocio en Google y en los motores de IA (AI Overviews, ChatGPT, Perplexity): SEO tecnico, preparacion GEO y presencia online.',
};

export default function AuditorPage(): React.ReactElement {
  return (
    <main className="relative isolate mx-auto flex min-h-screen max-w-6xl flex-col gap-10 overflow-x-clip px-4 py-8 sm:px-6">
      {/* Fondo: auroras + grid (decorativo, sin capturar eventos) */}
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[560px]">
        <div className="bg-grid absolute inset-0" />
        <div
          className="aurora left-[8%] top-[-120px] h-[340px] w-[420px]"
          style={{ background: 'rgba(16, 185, 129, 0.16)' }}
        />
        <div
          className="aurora right-[4%] top-[-60px] h-[300px] w-[380px]"
          style={{ background: 'rgba(99, 102, 241, 0.13)', animationDelay: '-7s' }}
        />
      </div>

      <header className="animate-rise flex flex-col items-center gap-5 pt-6 text-center">
        <div className="flex w-full items-center justify-between text-xs text-ink-400">
          <a href="/" className="transition hover:text-ink-200">
            {'<-'} Volver al home
          </a>
          <span className="hidden font-mono sm:inline">agentes-claude</span>
        </div>

        <span className="card-glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-emerald-300">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400">
            <span className="dot-ping absolute inset-0 text-emerald-400" />
          </span>
          Auditoria con IA · gratuita · resultados en segundos
        </span>

        <h1 className="max-w-3xl text-balance text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          ¿Tu negocio aparece cuando alguien le pregunta a{' '}
          <span className="text-aurora whitespace-nowrap">ChatGPT o a Google</span>?
        </h1>

        <p className="max-w-2xl text-balance text-sm leading-relaxed text-ink-400 sm:text-base">
          Los buscadores con IA ya responden por los negocios: si tu sitio no esta preparado,
          recomiendan a la competencia. Mide tu SEO tecnico, tu preparacion GEO y tu presencia
          online — y llevate el plan de accion en PDF.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-ink-400">
          {['21 verificaciones tecnicas', 'SEO + GEO + presencia', 'Reporte PDF descargable'].map(
            (chip) => (
              <span key={chip} className="card-glass rounded-full px-3 py-1">
                {chip}
              </span>
            ),
          )}
        </div>
      </header>

      <AuditorApp />

      <footer className="mt-auto border-t border-ink-800/70 pt-5 text-center text-xs text-ink-500">
        Auditoria basada en evidencia: paper GEO (Princeton/KDD 2024), guia oficial de Google para
        IA generativa y estudios de Ahrefs/Semrush 2025-2026.
      </footer>
    </main>
  );
}
