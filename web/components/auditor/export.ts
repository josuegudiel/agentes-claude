import type { AuditReport, Severity } from '../../lib/auditor-types';
import { downloadBlob } from '../scanner/export';

/**
 * Exporta el reporte de auditoria como PDF de texto. jsPDF se carga con
 * dynamic import — la pagina /auditor no paga el peso si nadie exporta.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'CRITICO',
  important: 'IMPORTANTE',
  improvement: 'MEJORA',
};

export async function exportReportPdf(report: AuditReport): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

  const margin = 48;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number): void => {
    if (y + needed > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  const writeLines = (
    text: string,
    opts: { size: number; bold?: boolean; gapAfter?: number },
  ): void => {
    pdf.setFontSize(opts.size);
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    const lines = pdf.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      ensureSpace(opts.size * 1.4);
      pdf.text(line, margin, y);
      y += opts.size * 1.4;
    }
    y += opts.gapAfter ?? 0;
  };

  writeLines(`Auditoria GEO/SEO — ${report.meta.businessName}`, {
    size: 18,
    bold: true,
  });
  writeLines(
    `${report.meta.city} · ${report.meta.finalUrl} · ${new Date(report.meta.fetchedAt).toLocaleDateString()}`,
    { size: 10, gapAfter: 12 },
  );

  writeLines('Scores', { size: 13, bold: true, gapAfter: 2 });
  writeLines(
    [
      `Global: ${report.scores.overall}/100`,
      `SEO tecnico: ${report.scores.onpage}/100`,
      `Preparacion GEO: ${report.scores.geo}/100`,
      `Presencia online: ${report.scores.presence === null ? 'no medida' : `${report.scores.presence}/100`}`,
    ].join('   |   '),
    { size: 10, gapAfter: 12 },
  );

  if (report.executiveSummary) {
    writeLines('Resumen ejecutivo', { size: 13, bold: true, gapAfter: 2 });
    writeLines(report.executiveSummary, { size: 10, gapAfter: 12 });
  }

  writeLines('Hallazgos priorizados', { size: 13, bold: true, gapAfter: 4 });
  if (report.findings.length === 0) {
    writeLines('Sin hallazgos: todos los checks aplicables pasaron.', {
      size: 10,
      gapAfter: 12,
    });
  }
  for (const finding of report.findings) {
    writeLines(`[${SEVERITY_LABEL[finding.severity]}] ${finding.title}`, {
      size: 11,
      bold: true,
    });
    writeLines(`Evidencia: ${finding.detail}`, { size: 10 });
    writeLines(`Solucion: ${finding.recommendation}`, { size: 10, gapAfter: 8 });
  }

  if (report.warnings.length > 0) {
    writeLines('Avisos', { size: 13, bold: true, gapAfter: 2 });
    for (const warning of report.warnings) {
      writeLines(`- ${warning}`, { size: 9 });
    }
  }

  const slug = report.meta.businessName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  downloadBlob(pdf.output('blob'), `auditoria-geo-${slug || 'negocio'}.pdf`);
}
