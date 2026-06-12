import { describe, expect, it } from 'vitest';
import { buildSalesSummary } from '../sales-summary';
import type { AuditReport } from '../auditor-types';

const REPORT: AuditReport = {
  meta: {
    url: 'https://tallerlopez.gt/',
    finalUrl: 'https://www.tallerlopez.gt/',
    businessName: 'Taller Lopez',
    city: 'Quetzaltenango',
    fetchedAt: '2026-06-12T12:00:00.000Z',
    durationMs: 4200,
    htmlBytes: 12345,
    truncated: false,
  },
  scores: { onpage: 80, geo: 35, presence: null, overall: 55 },
  checks: [],
  findings: [
    {
      checkId: 'geo.jsonld_local',
      category: 'geo',
      severity: 'critical',
      title: 'Schema LocalBusiness (JSON-LD)',
      detail: 'No hay datos estructurados.',
      recommendation: 'Agregar JSON-LD LocalBusiness.',
    },
    {
      checkId: 'geo.city_in_title',
      category: 'geo',
      severity: 'critical',
      title: 'Ciudad en el title / H1',
      detail: 'No menciona la ciudad.',
      recommendation: 'Incluir la ciudad en el title.',
    },
    {
      checkId: 'onpage.favicon',
      category: 'onpage',
      severity: 'improvement',
      title: 'Favicon',
      detail: 'Sin favicon.',
      recommendation: 'Agregar favicon.',
    },
    {
      checkId: 'geo.whatsapp',
      category: 'geo',
      severity: 'improvement',
      title: 'Boton de WhatsApp',
      detail: 'Sin wa.me.',
      recommendation: 'Agregar boton de WhatsApp.',
    },
  ],
  presence: { skipped: true, reason: 'sin clave' },
  executiveSummary: null,
  llm: null,
  warnings: [],
};

describe('buildSalesSummary', () => {
  const text = buildSalesSummary(REPORT);

  it('incluye nombre, ciudad, sitio y scores', () => {
    expect(text).toContain('Taller Lopez (Quetzaltenango)');
    expect(text).toContain('https://www.tallerlopez.gt/');
    expect(text).toContain('*55/100* (necesita trabajo)');
    expect(text).toContain('SEO técnico: 80/100');
    expect(text).toContain('GEO): 35/100');
    expect(text).toContain('no medida en esta auditoría');
  });

  it('lista maximo 3 hallazgos con su solucion y el conteo de criticos', () => {
    expect(text).toContain('2 problema(s) crítico(s)');
    expect(text).toContain('1. Schema LocalBusiness (JSON-LD) — Agregar JSON-LD LocalBusiness.');
    expect(text).toContain('3. Favicon — Agregar favicon.');
    expect(text).not.toContain('4.');
    expect(text).toContain('¿Le interesa que se lo arreglemos?');
  });

  it('sitio perfecto: mensaje positivo sin lista', () => {
    const clean = buildSalesSummary({ ...REPORT, findings: [] });
    expect(clean).toContain('pasó todas las verificaciones');
    expect(clean).not.toContain('1.');
  });
});
