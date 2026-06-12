import type { CategoryScores, CheckResult, Finding, Severity } from './schema.js';

/**
 * Scoring 100% determinista: mismos checks -> mismos numeros. El LLM nunca
 * toca los scores; solo redacta encima de ellos.
 *
 * Credito por check: pass=1.0, warn=0.5, fail=0. Los 'na' (no aplicable /
 * no se pudo medir) se excluyen del denominador para no castigar lo que no
 * se observo.
 */

const CREDIT: Record<string, number> = { pass: 1, warn: 0.5, fail: 0 };

/** Pesos del promedio global. Si presence es null se renormaliza onpage/geo. */
const OVERALL_WEIGHTS = { onpage: 0.4, geo: 0.4, presence: 0.2 } as const;

export function categoryScore(checks: CheckResult[]): number | null {
  const applicable = checks.filter((c) => c.status !== 'na');
  if (applicable.length === 0) return null;
  const earned = applicable.reduce((acc, c) => acc + c.weight * (CREDIT[c.status] ?? 0), 0);
  const total = applicable.reduce((acc, c) => acc + c.weight, 0);
  return Math.round((100 * earned) / total);
}

export function computeScores(
  checks: CheckResult[],
  opts: { presenceSkipped: boolean },
): CategoryScores {
  const byCategory = (cat: CheckResult['category']): CheckResult[] =>
    checks.filter((c) => c.category === cat);

  const onpage = categoryScore(byCategory('onpage')) ?? 0;
  const geo = categoryScore(byCategory('geo')) ?? 0;
  const presence = opts.presenceSkipped ? null : (categoryScore(byCategory('presence')) ?? 0);

  let overall: number;
  if (presence === null) {
    // Renormalizar 0.40/0.40 -> 0.50/0.50 cuando no hay presencia medida.
    overall = Math.round(0.5 * onpage + 0.5 * geo);
  } else {
    overall = Math.round(
      OVERALL_WEIGHTS.onpage * onpage +
        OVERALL_WEIGHTS.geo * geo +
        OVERALL_WEIGHTS.presence * presence,
    );
  }

  return { onpage, geo, presence, overall };
}

export function severityFor(check: CheckResult): Severity | null {
  if (check.status === 'fail') return check.weight >= 3 ? 'critical' : 'important';
  if (check.status === 'warn') return 'improvement';
  return null;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  important: 1,
  improvement: 2,
};

/** Convierte los checks problematicos en hallazgos accionables ordenados. */
export function deriveFindings(checks: CheckResult[]): Finding[] {
  const findings: Finding[] = [];
  for (const check of checks) {
    const severity = severityFor(check);
    if (!severity) continue;
    findings.push({
      checkId: check.id,
      category: check.category,
      severity,
      title: check.title,
      detail: check.detail,
      recommendation: check.recommendation ?? 'Revisar este punto con un especialista GEO/SEO.',
    });
  }
  return findings.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const weightOf = (f: Finding): number => checks.find((c) => c.id === f.checkId)?.weight ?? 0;
    return weightOf(b) - weightOf(a);
  });
}
