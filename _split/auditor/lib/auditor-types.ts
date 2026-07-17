/**
 * Tipos compartidos del auditor GEO/SEO entre cliente y server. NO importar
 * nada server-only desde aqui — este modulo entra en el bundle del cliente.
 * (Los imports de schema.ts son type-only: zod no llega al bundle.)
 */

import type {
  AuditEvent,
  AuditPhase,
  AuditReport,
  Category,
  CategoryScores,
  CheckResult,
  CheckStatus,
  Finding,
  Severity,
} from '@/agents/geo-auditor/schema';

export type {
  AuditEvent,
  AuditPhase,
  AuditReport,
  Category,
  CategoryScores,
  CheckResult,
  CheckStatus,
  Finding,
  Severity,
};

export interface AuditorRequest {
  url: string;
  businessName: string;
  city: string;
}

export type AuditorSSEEvent =
  | AuditEvent
  | { type: 'done'; report: AuditReport }
  | { type: 'error'; message: string; code: string };
