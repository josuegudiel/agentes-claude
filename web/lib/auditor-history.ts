import type { AuditReport, CategoryScores } from './auditor-types';

/**
 * Historial de auditorias en localStorage. Sirve para el flujo de venta:
 * auditar -> aplicar mejoras -> re-auditar y mostrar el delta al cliente.
 * Logica pura separada del storage para poder testearla sin navegador.
 */

export interface AuditHistoryEntry {
  ts: number;
  /** URL final normalizada (sirve de clave para comparar auditorias). */
  url: string;
  businessName: string;
  city: string;
  scores: CategoryScores;
}

const STORAGE_KEY = 'geo-auditor-history';
const MAX_ENTRIES = 30;

export function entryFromReport(report: AuditReport): AuditHistoryEntry {
  return {
    ts: Date.now(),
    url: normalizeKey(report.meta.finalUrl),
    businessName: report.meta.businessName,
    city: report.meta.city,
    scores: report.scores,
  };
}

export function normalizeKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Agrega una entrada y devuelve la anterior del mismo sitio (para el delta). */
export function appendEntry(
  list: AuditHistoryEntry[],
  entry: AuditHistoryEntry,
): { list: AuditHistoryEntry[]; previous: AuditHistoryEntry | null } {
  const previous = [...list].reverse().find((e) => e.url === entry.url) ?? null;
  const next = [...list, entry].slice(-MAX_ENTRIES);
  return { list: next, previous };
}

/** Delta de score global de una entrada vs la auditoria anterior del mismo sitio. */
export function deltaFor(list: AuditHistoryEntry[], entry: AuditHistoryEntry): number | null {
  const idx = list.findIndex((e) => e.ts === entry.ts && e.url === entry.url);
  const before = (idx === -1 ? list : list.slice(0, idx)).filter((e) => e.url === entry.url).at(-1);
  return before ? entry.scores.overall - before.scores.overall : null;
}

// --- Capa de storage (solo navegador) ---

export function loadHistory(): AuditHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function persistHistory(list: AuditHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage lleno o bloqueado: el historial es un extra, no un requisito.
  }
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem
  }
}
