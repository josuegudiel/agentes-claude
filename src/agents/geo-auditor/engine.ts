import { logger } from '../../core/logger.js';
import type { ChatClient } from '../predictive/chat-client.js';
import { chatClientProvider, makeChatClient } from '../predictive/chat-client-factory.js';
import { parseSiteHtml } from './html.js';
import { fetchSite, SiteFetchError } from './site-fetcher.js';
import { runOnpageChecks } from './checks/onpage.js';
import { runGeoChecks } from './checks/geo.js';
import { runPresenceChecks } from './checks/presence.js';
import { computeScores, deriveFindings } from './scoring.js';
import { executiveSummaryPrompt } from './prompts.js';
import { isTavilyConfigured, TavilyClient } from './tavily-client.js';
import type {
  AuditEvent,
  AuditReport,
  AuditRequest,
  CheckResult,
  TavilySearchResult,
} from './schema.js';

/**
 * Orquestador del auditor GEO/SEO. Pipeline determinista:
 *   fetch -> checks onpage -> checks geo -> presencia (Tavily, opcional)
 *   -> scoring -> resumen ejecutivo (LLM, degradable).
 *
 * El LLM solo redacta: si falla, el reporte numerico se entrega igual.
 */

export interface GeoAuditOptions {
  /** Inyectable para tests; default makeChatClient(). null = sin LLM. */
  chat?: ChatClient | null;
  /** Inyectable para tests; default TavilyClient si hay API key. */
  tavily?: TavilyClient | null;
  onEvent?: (event: AuditEvent) => void;
  /** Aborta la auditoria (fetch/Tavily/LLM) si el cliente desconecta. */
  signal?: AbortSignal;
}

export async function runGeoAudit(
  req: AuditRequest,
  opts: GeoAuditOptions = {},
): Promise<AuditReport> {
  const log = logger.child({ component: 'geo-auditor.engine' });
  const emit = (event: AuditEvent): void => {
    try {
      opts.onEvent?.(event);
    } catch (err) {
      // Un listener roto no debe tumbar la auditoria, pero dejamos traza para
      // poder diagnosticar por que un stream quedo incompleto.
      log.debug({ err: (err as Error).message, event: event.type }, 'listener onEvent fallo');
    }
  };
  const startedAt = Date.now();
  const warnings: string[] = [];

  const throwIfAborted = (): void => {
    if (opts.signal?.aborted) throw new SiteFetchError('Auditoria abortada.', { code: 'ABORTED' });
  };

  emit({ type: 'start', url: req.url, businessName: req.businessName });

  // --- 1. Fetch del sitio (si esto falla, falla la auditoria entera) ---
  emit({ type: 'phase', phase: 'fetch', status: 'running' });
  const fetched = await fetchSite(req.url, opts.signal ? { signal: opts.signal } : undefined);
  const site = parseSiteHtml(fetched.html, {
    baseHost: new URL(fetched.finalUrl).hostname,
  });
  if (fetched.truncated) {
    warnings.push('El HTML supero 2MB y se analizo truncado.');
  }
  emit({ type: 'phase', phase: 'fetch', status: 'done', detail: fetched.finalUrl });

  const checks: CheckResult[] = [];
  const emitChecks = (results: CheckResult[]): void => {
    for (const c of results) {
      checks.push(c);
      emit({ type: 'check', id: c.id, category: c.category, status: c.status, title: c.title });
    }
  };

  // --- 2. SEO tecnico on-page ---
  emit({ type: 'phase', phase: 'onpage', status: 'running' });
  emitChecks(runOnpageChecks({ site, finalUrl: fetched.finalUrl, sitemap: fetched.sitemap }));
  emit({ type: 'phase', phase: 'onpage', status: 'done' });

  // --- 3. Preparacion GEO ---
  throwIfAborted();
  emit({ type: 'phase', phase: 'geo', status: 'running' });
  emitChecks(
    runGeoChecks({
      site,
      robotsTxt: fetched.robotsTxt,
      llmsTxt: fetched.llmsTxt,
      businessName: req.businessName,
      city: req.city,
    }),
  );
  emit({ type: 'phase', phase: 'geo', status: 'done' });

  // --- 4. Presencia online (opcional / degradable) ---
  throwIfAborted();
  const presence = await runPresencePhase(req, fetched.finalUrl, opts, emitChecks, warnings, emit);

  // --- 5. Scoring determinista ---
  const scores = computeScores(checks, { presenceSkipped: presence.skipped });
  const findings = deriveFindings(checks);
  emit({ type: 'scores', scores });

  // --- 6. Resumen ejecutivo con LLM (degradable) ---
  throwIfAborted();
  emit({ type: 'phase', phase: 'summary', status: 'running' });
  let executiveSummary: string | null = null;
  let llm: AuditReport['llm'] = null;
  const chat = opts.chat === undefined ? makeChatClient() : opts.chat;
  if (chat) {
    try {
      const text = await chat.generate(
        executiveSummaryPrompt({
          businessName: req.businessName,
          city: req.city,
          scores,
          topFindings: findings,
          presenceSkipped: presence.skipped,
        }),
        { temperature: 0.4 },
      );
      const trimmed = text.trim();
      // Un resumen vacio (LLM devolvio solo espacios) se trata como fallo, para
      // mantener solo dos estados coherentes: texto util o null (sin llm).
      if (!trimmed) throw new Error('el LLM devolvio un resumen vacio');
      executiveSummary = trimmed;
      llm = { provider: providerName(), model: chat.modelName };
      emit({ type: 'phase', phase: 'summary', status: 'done' });
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'LLM no disponible; reporte sin resumen');
      warnings.push('El resumen ejecutivo no se pudo generar (LLM no disponible).');
      emit({ type: 'phase', phase: 'summary', status: 'skipped', detail: 'LLM no disponible' });
    }
  } else {
    warnings.push('Resumen ejecutivo omitido (modo sin LLM).');
    emit({ type: 'phase', phase: 'summary', status: 'skipped', detail: 'sin LLM' });
  }

  return {
    meta: {
      url: req.url,
      finalUrl: fetched.finalUrl,
      businessName: req.businessName,
      city: req.city,
      fetchedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      htmlBytes: fetched.htmlBytes,
      truncated: fetched.truncated,
    },
    scores,
    checks,
    findings,
    presence,
    executiveSummary,
    llm,
    warnings,
  };
}

async function runPresencePhase(
  req: AuditRequest,
  finalUrl: string,
  opts: GeoAuditOptions,
  emitChecks: (results: CheckResult[]) => void,
  warnings: string[],
  emit: (event: AuditEvent) => void,
): Promise<AuditReport['presence']> {
  if (req.skipPresence) {
    const reason = 'Analisis de presencia desactivado para esta auditoria.';
    // Emitir el warning tambien aqui, para que el reporte explique el 'no medida'
    // igual que cuando falta Tavily (consistencia en PDF/markdown).
    warnings.push(reason);
    emit({ type: 'phase', phase: 'presence', status: 'skipped', detail: 'desactivado' });
    return { skipped: true, reason };
  }

  let tavily: TavilyClient | null;
  if (opts.tavily !== undefined) {
    tavily = opts.tavily;
  } else {
    tavily = isTavilyConfigured() ? new TavilyClient() : null;
  }
  if (!tavily) {
    const reason = 'Sin TAVILY_API_KEY: la presencia online no se midio.';
    warnings.push(reason);
    emit({ type: 'phase', phase: 'presence', status: 'skipped', detail: 'sin Tavily' });
    return { skipped: true, reason };
  }

  emit({ type: 'phase', phase: 'presence', status: 'running' });
  try {
    const [general, reviews] = await Promise.all([
      tavily.search(`"${req.businessName}" ${req.city}`),
      tavily.search(`${req.businessName} ${req.city} opiniones reseñas`),
    ]);
    const results = dedupeByUrl([...general.results, ...reviews.results]);
    emitChecks(
      runPresenceChecks({
        businessName: req.businessName,
        city: req.city,
        ownHost: new URL(finalUrl).hostname.toLowerCase(),
        results,
      }),
    );
    emit({ type: 'phase', phase: 'presence', status: 'done' });
    return { skipped: false };
  } catch (err) {
    const reason = `La busqueda de presencia fallo (${(err as Error).message}); se omitio del score.`;
    warnings.push(reason);
    emit({ type: 'phase', phase: 'presence', status: 'skipped', detail: 'Tavily fallo' });
    return { skipped: true, reason };
  }
}

function dedupeByUrl(results: TavilySearchResult[]): TavilySearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function providerName(): string {
  // Si el chat vino inyectado no sabemos el provider real; reportamos el del factory.
  try {
    return chatClientProvider();
  } catch {
    return 'desconocido';
  }
}
