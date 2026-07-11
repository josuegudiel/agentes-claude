import { z } from 'zod';

/**
 * Schemas compartidos del auditor GEO/SEO. Son la fuente de verdad entre el
 * motor (engine.ts), los checks, la API SSE de la web y el CLI de prospeccion.
 */

export const CategorySchema = z.enum(['onpage', 'geo', 'presence']);
export type Category = z.infer<typeof CategorySchema>;

export const CheckStatusSchema = z.enum(['pass', 'warn', 'fail', 'na']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const SeveritySchema = z.enum(['critical', 'important', 'improvement']);
export type Severity = z.infer<typeof SeveritySchema>;

/** Agrega https:// si el usuario pego el dominio pelado. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export const AuditRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(4)
    .max(2048)
    .transform(normalizeUrl)
    .refine((u) => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        // Exigir un host con punto (dominio real), no 'https://a'.
        return parsed.hostname.includes('.');
      } catch {
        return false;
      }
    }, 'URL invalida'),
  businessName: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  skipPresence: z.boolean().default(false),
});
export type AuditRequest = z.infer<typeof AuditRequestSchema>;

export const CheckResultSchema = z.object({
  /** Identificador estable, ej. 'onpage.title' o 'geo.robots_ai_crawlers'. */
  id: z.string(),
  category: CategorySchema,
  status: CheckStatusSchema,
  /** Peso relativo dentro de su categoria. 'na' no cuenta en el denominador. */
  weight: z.number().positive(),
  title: z.string(),
  /** Evidencia concreta de lo observado (no generica). */
  detail: z.string(),
  recommendation: z.string().optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const FindingSchema = z.object({
  checkId: z.string(),
  category: CategorySchema,
  severity: SeveritySchema,
  title: z.string(),
  detail: z.string(),
  recommendation: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const CategoryScoresSchema = z.object({
  onpage: z.number().min(0).max(100),
  geo: z.number().min(0).max(100),
  /** null cuando el analisis de presencia se omitio (sin Tavily). */
  presence: z.number().min(0).max(100).nullable(),
  overall: z.number().min(0).max(100),
});
export type CategoryScores = z.infer<typeof CategoryScoresSchema>;

export const AuditMetaSchema = z.object({
  url: z.string(),
  finalUrl: z.string(),
  businessName: z.string(),
  city: z.string(),
  fetchedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  htmlBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type AuditMeta = z.infer<typeof AuditMetaSchema>;

export const AuditReportSchema = z.object({
  meta: AuditMetaSchema,
  scores: CategoryScoresSchema,
  checks: z.array(CheckResultSchema),
  /** Hallazgos accionables, ordenados por severidad y peso. */
  findings: z.array(FindingSchema),
  presence: z.object({
    skipped: z.boolean(),
    reason: z.string().optional(),
  }),
  /** Resumen ejecutivo redactado por el LLM; null si el LLM no estaba disponible. */
  executiveSummary: z.string().nullable(),
  llm: z.object({ provider: z.string(), model: z.string() }).nullable(),
  warnings: z.array(z.string()),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

// --- Tavily ---

export const TavilySearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number().optional(),
});
export type TavilySearchResult = z.infer<typeof TavilySearchResultSchema>;

export const TavilyResponseSchema = z.object({
  query: z.string().optional(),
  results: z.array(TavilySearchResultSchema).default([]),
  answer: z.string().nullable().optional(),
});
export type TavilyResponse = z.infer<typeof TavilyResponseSchema>;

// --- Eventos de progreso (consumidos por la API SSE y el CLI) ---

export const AuditPhaseSchema = z.enum(['fetch', 'onpage', 'geo', 'presence', 'summary']);
export type AuditPhase = z.infer<typeof AuditPhaseSchema>;

export type AuditEvent =
  | { type: 'start'; url: string; businessName: string }
  | {
      type: 'phase';
      phase: AuditPhase;
      status: 'running' | 'done' | 'skipped';
      detail?: string;
    }
  | { type: 'check'; id: string; category: Category; status: CheckStatus; title: string }
  | { type: 'scores'; scores: CategoryScores };
