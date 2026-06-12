import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGeoAudit } from '../engine.js';
import type { TavilyClient } from '../tavily-client.js';
import type { ChatClient } from '../../predictive/chat-client.js';
import type { AuditEvent, AuditRequest } from '../schema.js';

const PAGE = `<html><head>
  <title>Taller Lopez — Mecanica en Quetzaltenango</title>
  <meta name="description" content="Taller mecanico de confianza en Quetzaltenango con 20 años de experiencia y repuestos originales.">
</head><body>
  <h1>Taller Lopez</h1>
  <h2>¿Que servicios ofrecemos?</h2>
  <p>Taller Lopez atiende en zona 3 de Quetzaltenango desde 1995. Llama al 7761-1234.</p>
</body></html>`;

const REQUEST: AuditRequest = {
  url: 'https://tallerlopez.gt/',
  businessName: 'Taller Lopez',
  city: 'Quetzaltenango',
  skipPresence: false,
};

function fakeChat(overrides?: Partial<ChatClient>): ChatClient {
  return {
    modelName: 'fake-model',
    preflight: async () => null,
    chat: async () => {
      throw new Error('chat no usado en el auditor');
    },
    generate: async () => 'Resumen ejecutivo de prueba.',
    ...overrides,
  };
}

function fakeTavily(results: Array<{ title: string; url: string; content: string }>): TavilyClient {
  return {
    search: async () => ({ results }),
  } as unknown as TavilyClient;
}

describe('runGeoAudit', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://tallerlopez.gt/') {
        return new Response(PAGE, { status: 200 });
      }
      return new Response('no', { status: 404 });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('pipeline completo: checks de las 3 categorias, scores, resumen y eventos en orden', async () => {
    const events: AuditEvent[] = [];
    const report = await runGeoAudit(REQUEST, {
      chat: fakeChat(),
      tavily: fakeTavily([
        {
          title: 'Taller Lopez',
          url: 'https://www.google.com/maps/place/x',
          content: 'Taller Lopez',
        },
      ]),
      onEvent: (e) => events.push(e),
    });

    expect(report.checks.some((c) => c.category === 'onpage')).toBe(true);
    expect(report.checks.some((c) => c.category === 'geo')).toBe(true);
    expect(report.checks.some((c) => c.category === 'presence')).toBe(true);
    expect(report.scores.presence).not.toBeNull();
    expect(report.executiveSummary).toBe('Resumen ejecutivo de prueba.');
    expect(report.llm?.model).toBe('fake-model');
    expect(report.presence.skipped).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);

    const phaseEvents = events
      .filter((e): e is Extract<AuditEvent, { type: 'phase' }> => e.type === 'phase')
      .filter((e) => e.status !== 'running')
      .map((e) => `${e.phase}:${e.status}`);
    expect(phaseEvents).toEqual([
      'fetch:done',
      'onpage:done',
      'geo:done',
      'presence:done',
      'summary:done',
    ]);
    expect(events.some((e) => e.type === 'scores')).toBe(true);
  });

  it('sin Tavily: presencia omitida, score presence null y warning visible', async () => {
    const report = await runGeoAudit(REQUEST, { chat: fakeChat(), tavily: null });
    expect(report.presence.skipped).toBe(true);
    expect(report.scores.presence).toBeNull();
    expect(report.warnings.join(' ')).toContain('TAVILY_API_KEY');
  });

  it('si Tavily falla, la auditoria sigue y presence queda omitida', async () => {
    const broken = {
      search: async () => {
        throw new Error('tavily caido');
      },
    } as unknown as TavilyClient;
    const report = await runGeoAudit(REQUEST, { chat: fakeChat(), tavily: broken });
    expect(report.presence.skipped).toBe(true);
    expect(report.scores.presence).toBeNull();
    expect(report.warnings.join(' ')).toContain('tavily caido');
  });

  it('si el LLM falla, entrega el reporte numerico con executiveSummary null', async () => {
    const report = await runGeoAudit(REQUEST, {
      chat: fakeChat({
        generate: async () => {
          throw new Error('groq caido');
        },
      }),
      tavily: null,
    });
    expect(report.executiveSummary).toBeNull();
    expect(report.llm).toBeNull();
    expect(report.scores.overall).toBeGreaterThan(0);
    expect(report.warnings.join(' ')).toContain('resumen ejecutivo no se pudo generar');
  });

  it('modo sin LLM (chat: null): no llama a ningun proveedor', async () => {
    const report = await runGeoAudit(REQUEST, { chat: null, tavily: null });
    expect(report.executiveSummary).toBeNull();
    expect(report.warnings.join(' ')).toContain('modo sin LLM');
  });

  it('skipPresence=true no toca Tavily aunque este disponible', async () => {
    const search = vi.fn();
    const report = await runGeoAudit(
      { ...REQUEST, skipPresence: true },
      { chat: null, tavily: { search } as unknown as TavilyClient },
    );
    expect(report.presence.skipped).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it('si el sitio no responde, lanza SiteFetchError', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    await expect(runGeoAudit(REQUEST, { chat: null, tavily: null })).rejects.toMatchObject({
      name: 'SiteFetchError',
    });
  });
});
