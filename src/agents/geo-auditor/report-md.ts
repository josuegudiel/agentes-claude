import type { AuditReport, CheckStatus, Severity } from './schema.js';

/**
 * Render markdown del reporte para el CLI de prospeccion. Puro y testeable:
 * un AuditReport -> un string. El PDF de la web tiene su propio render.
 */

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
  na: '·',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'CRITICO',
  important: 'IMPORTANTE',
  improvement: 'MEJORA',
};

export function renderReportMarkdown(report: AuditReport): string {
  const { meta, scores } = report;
  const lines: string[] = [];

  lines.push(`# Auditoria GEO/SEO — ${meta.businessName} (${meta.city})`);
  lines.push('');
  lines.push(`- Sitio: ${meta.finalUrl}`);
  lines.push(`- Fecha: ${meta.fetchedAt}`);
  lines.push(`- Duracion: ${(meta.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  lines.push('## Scores');
  lines.push('');
  lines.push('| Categoria | Score |');
  lines.push('|---|---|');
  lines.push(`| **Global** | **${scores.overall}/100** |`);
  lines.push(`| SEO tecnico | ${scores.onpage}/100 |`);
  lines.push(`| Preparacion GEO (visibilidad en IA) | ${scores.geo}/100 |`);
  lines.push(
    `| Presencia online | ${scores.presence === null ? 'no medida' : `${scores.presence}/100`} |`,
  );
  lines.push('');

  if (report.executiveSummary) {
    lines.push('## Resumen ejecutivo');
    lines.push('');
    lines.push(report.executiveSummary);
    lines.push('');
  }

  if (report.findings.length > 0) {
    lines.push('## Hallazgos priorizados');
    lines.push('');
    for (const f of report.findings) {
      lines.push(`### [${SEVERITY_LABEL[f.severity]}] ${f.title}`);
      lines.push('');
      lines.push(`- Evidencia: ${f.detail}`);
      lines.push(`- Solucion: ${f.recommendation}`);
      lines.push('');
    }
  } else {
    lines.push('## Hallazgos priorizados');
    lines.push('');
    lines.push('Sin hallazgos: todos los checks aplicables pasaron.');
    lines.push('');
  }

  lines.push('## Detalle de checks');
  lines.push('');
  for (const category of ['onpage', 'geo', 'presence'] as const) {
    const group = report.checks.filter((c) => c.category === category);
    if (group.length === 0) continue;
    lines.push(`### ${categoryLabel(category)}`);
    lines.push('');
    for (const c of group) {
      lines.push(`- ${STATUS_ICON[c.status]} **${c.title}** — ${c.detail}`);
    }
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('## Avisos');
    lines.push('');
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  return lines.join('\n');
}

function categoryLabel(category: 'onpage' | 'geo' | 'presence'): string {
  switch (category) {
    case 'onpage':
      return 'SEO tecnico on-page';
    case 'geo':
      return 'Preparacion GEO';
    case 'presence':
      return 'Presencia online';
  }
}
