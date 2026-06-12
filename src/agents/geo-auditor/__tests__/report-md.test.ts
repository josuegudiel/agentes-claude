import { describe, expect, it } from 'vitest';
import { renderReportMarkdown } from '../report-md.js';
import type { AuditReport } from '../schema.js';

const REPORT: AuditReport = {
  meta: {
    url: 'https://tallerlopez.gt/',
    finalUrl: 'https://www.tallerlopez.gt/',
    businessName: 'Taller Lopez',
    city: 'Quetzaltenango',
    fetchedAt: '2026-06-09T12:00:00.000Z',
    durationMs: 4200,
    htmlBytes: 12345,
    truncated: false,
  },
  scores: { onpage: 80, geo: 40, presence: null, overall: 60 },
  checks: [
    {
      id: 'onpage.title',
      category: 'onpage',
      status: 'pass',
      weight: 3,
      title: 'Etiqueta <title> descriptiva',
      detail: 'Title presente.',
    },
    {
      id: 'geo.jsonld_local',
      category: 'geo',
      status: 'fail',
      weight: 4,
      title: 'Schema LocalBusiness (JSON-LD)',
      detail: 'No hay datos estructurados JSON-LD.',
      recommendation: 'Agregar JSON-LD LocalBusiness.',
    },
  ],
  findings: [
    {
      checkId: 'geo.jsonld_local',
      category: 'geo',
      severity: 'critical',
      title: 'Schema LocalBusiness (JSON-LD)',
      detail: 'No hay datos estructurados JSON-LD.',
      recommendation: 'Agregar JSON-LD LocalBusiness.',
    },
  ],
  presence: { skipped: true, reason: 'Sin TAVILY_API_KEY: la presencia online no se midio.' },
  executiveSummary: 'El sitio tiene una base aceptable pero es invisible para los motores de IA.',
  llm: { provider: 'groq', model: 'llama-3.1-8b-instant' },
  warnings: ['Sin TAVILY_API_KEY: la presencia online no se midio.'],
};

describe('renderReportMarkdown', () => {
  const md = renderReportMarkdown(REPORT);

  it('incluye encabezado, scores, resumen, hallazgos y avisos', () => {
    expect(md).toContain('# Auditoria GEO/SEO — Taller Lopez (Quetzaltenango)');
    expect(md).toContain('| **Global** | **60/100** |');
    expect(md).toContain('| Presencia online | no medida |');
    expect(md).toContain('invisible para los motores de IA');
    expect(md).toContain('### [CRITICO] Schema LocalBusiness (JSON-LD)');
    expect(md).toContain('- Sin TAVILY_API_KEY');
  });

  it('agrupa los checks por categoria con icono de estado', () => {
    expect(md).toContain('### SEO tecnico on-page');
    expect(md).toContain('✅ **Etiqueta <title> descriptiva**');
    expect(md).toContain('### Preparacion GEO');
    expect(md).toContain('❌ **Schema LocalBusiness (JSON-LD)**');
    expect(md).not.toContain('### Presencia online');
  });

  it('sin resumen ejecutivo omite la seccion', () => {
    const noSummary = renderReportMarkdown({ ...REPORT, executiveSummary: null });
    expect(noSummary).not.toContain('## Resumen ejecutivo');
  });
});
