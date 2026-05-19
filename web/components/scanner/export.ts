/**
 * Helpers de exportacion. Mantenemos las dependencias fuera del bundle
 * principal: jsPDF se carga con dynamic import solo cuando el usuario
 * pide PDF. Asi `/scanner` no paga ~150 KB extra si nadie exporta a PDF.
 */

export type ExportFormat = 'png' | 'jpg' | 'pdf';

export interface ExportPageInput {
  canvas: HTMLCanvasElement;
  filename: string;
}

export async function exportSinglePage(
  page: ExportPageInput,
  format: ExportFormat,
): Promise<Blob> {
  switch (format) {
    case 'png':
      return canvasToBlob(page.canvas, 'image/png');
    case 'jpg':
      return canvasToBlob(page.canvas, 'image/jpeg', 0.92);
    case 'pdf':
      return canvasesToPdfBlob([page.canvas]);
  }
}

export async function exportPages(
  pages: ExportPageInput[],
  format: ExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  if (pages.length === 0) throw new Error('No hay paginas para exportar');

  // Multi-pagina solo tiene sentido en PDF. En PNG/JPG exportamos la
  // primera pagina y avisamos al caller con el filename del set.
  if (format === 'pdf') {
    const blob = await canvasesToPdfBlob(pages.map((p) => p.canvas));
    const base = pages[0]!.filename;
    const filename = pages.length > 1 ? `${base}_${pages.length}p.pdf` : `${base}.pdf`;
    return { blob, filename };
  }

  const blob = await exportSinglePage(pages[0]!, format);
  const ext = format === 'png' ? 'png' : 'jpg';
  return { blob, filename: `${pages[0]!.filename}.${ext}` };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob fallo'))),
      mime,
      quality,
    );
  });
}

async function canvasesToPdfBlob(canvases: HTMLCanvasElement[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  // Tamanio en puntos PDF (1 pt = 1/72 in). Para no perder calidad,
  // usamos el tamanio real del canvas como tamanio de pagina, asi el ratio
  // se preserva y no escalamos (lo que pixelaria al imprimir).
  const first = canvases[0]!;
  const orientation = first.width >= first.height ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    unit: 'px',
    format: [first.width, first.height],
    orientation,
    hotfixes: ['px_scaling'],
  });

  for (let i = 0; i < canvases.length; i++) {
    const c = canvases[i]!;
    if (i > 0) {
      pdf.addPage(
        [c.width, c.height],
        c.width >= c.height ? 'landscape' : 'portrait',
      );
    }
    // JPEG en lugar de PNG: ~5x mas pequeno para fotos / scans en color.
    // Para B&N puro la diferencia es menor pero igual gana JPEG en tamano.
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    pdf.addImage(dataUrl, 'JPEG', 0, 0, c.width, c.height, undefined, 'FAST');
  }

  return pdf.output('blob');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Pequeno delay antes de revocar: Safari a veces aborta la descarga si la
  // URL se libera dentro del mismo tick.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
