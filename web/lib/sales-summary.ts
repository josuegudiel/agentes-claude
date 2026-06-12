import type { AuditReport } from './auditor-types';

/**
 * Resumen de venta en texto plano, listo para pegar en WhatsApp o correo.
 * Sin markdown raro: viñetas y saltos de linea que WhatsApp respeta.
 */

function statusLabel(score: number): string {
  if (score >= 70) return 'saludable';
  if (score >= 40) return 'necesita trabajo';
  return 'en riesgo';
}

export function buildSalesSummary(report: AuditReport): string {
  const { meta, scores, findings } = report;
  const criticals = findings.filter((f) => f.severity === 'critical');
  const top = findings.slice(0, 3);

  const lines: string[] = [
    `📊 Auditoría digital — ${meta.businessName} (${meta.city})`,
    `Sitio analizado: ${meta.finalUrl}`,
    '',
    `Resultado global: *${scores.overall}/100* (${statusLabel(scores.overall)})`,
    `• SEO técnico: ${scores.onpage}/100`,
    `• Visibilidad en buscadores con IA (GEO): ${scores.geo}/100`,
    `• Presencia online: ${scores.presence === null ? 'no medida en esta auditoría' : `${scores.presence}/100`}`,
    '',
  ];

  if (top.length > 0) {
    lines.push(
      criticals.length > 0
        ? `⚠️ Se detectaron ${criticals.length} problema(s) crítico(s). Los principales:`
        : 'Principales puntos a mejorar:',
    );
    top.forEach((f, i) => {
      lines.push(`${i + 1}. ${f.title} — ${f.recommendation}`);
    });
    lines.push('');
    lines.push('Todos tienen solución concreta. ¿Le interesa que se lo arreglemos?');
  } else {
    lines.push('✅ El sitio pasó todas las verificaciones aplicables. Excelente base.');
  }

  return lines.join('\n');
}
