/**
 * Helpers de exportacion. jsPDF se carga con dynamic import solo cuando el
 * usuario pide PDF, asi el bundle principal no paga ~150 KB extra.
 *
 * Las paginas llegan como JPEG ya codificados (ver pages.ts): el PDF y el
 * JPG los usan tal cual, sin recomprimir.
 */

export type ExportFormat = 'png' | 'jpg' | 'pdf';

export interface ExportPageInput {
  blob: Blob;
  width: number;
  height: number;
}

const DEFAULT_NAME = 'escaneo';
const MAX_NAME_LENGTH = 80;

/**
 * Nombre de archivo seguro SIN destrozar el espanol: se conservan letras
 * y numeros Unicode (a, n, u con tilde...), "_" y "-". Espacios y el resto
 * -> "_" (sin repetidos). Antes "Contraseña" salia "Contrase_a".
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || DEFAULT_NAME;
}

/** A4 en puntos PDF (1 pt = 1/72 in). */
const A4_SHORT_PT = 595.28;
const A4_LONG_PT = 841.89;

/**
 * Tamano fisico de la pagina PDF: el aspecto de la imagen, escalado para
 * caber en un A4 (en su orientacion). Antes se usaba 1 px = 1 pt: una
 * pagina de 4096px media 1.4 m y al imprimir salia ampliada/cortada.
 * La resolucion no se pierde: el JPEG se incrusta completo (~350 dpi).
 */
export function pdfPageSize(w: number, h: number): { width: number; height: number } {
  const portrait = h >= w;
  const boxW = portrait ? A4_SHORT_PT : A4_LONG_PT;
  const boxH = portrait ? A4_LONG_PT : A4_SHORT_PT;
  const s = Math.min(boxW / w, boxH / h);
  return { width: w * s, height: h * s };
}

/** Nombres de salida: "base.ext" para 1 archivo, "base_1.ext".. para varios. */
export function outputNames(base: string, count: number, ext: string): string[] {
  if (count === 1) return [`${base}.${ext}`];
  return Array.from({ length: count }, (_, i) => `${base}_${i + 1}.${ext}`);
}

/**
 * Genera los archivos a entregar:
 *   - PDF: un solo archivo con todas las paginas.
 *   - JPG/PNG: UN ARCHIVO POR PAGINA (antes se exportaba solo la primera y
 *     el resto se perdia sin aviso claro).
 */
export async function exportFiles(
  pages: ExportPageInput[],
  format: ExportFormat,
  baseName: string,
): Promise<File[]> {
  if (pages.length === 0) throw new Error('No hay paginas para exportar');
  const base = sanitizeFilename(baseName);

  if (format === 'pdf') {
    const blob = await pagesToPdfBlob(pages);
    const name = pages.length > 1 ? `${base}_${pages.length}p.pdf` : `${base}.pdf`;
    return [new File([blob], name, { type: 'application/pdf' })];
  }

  const names = outputNames(base, pages.length, format);
  if (format === 'jpg') {
    return pages.map((p, i) => new File([p.blob], names[i]!, { type: 'image/jpeg' }));
  }

  // PNG: decodificar pagina por pagina (una sola en memoria a la vez).
  const files: File[] = [];
  for (let i = 0; i < pages.length; i++) {
    const png = await jpegToPng(pages[i]!.blob);
    files.push(new File([png], names[i]!, { type: 'image/png' }));
  }
  return files;
}

async function jpegToPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas 2d no disponible');
    ctx.drawImage(bmp, 0, 0);
    const out = await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar el PNG'))), 'image/png'),
    );
    c.width = 0;
    c.height = 0;
    return out;
  } finally {
    bmp.close();
  }
}

async function pagesToPdfBlob(pages: ExportPageInput[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const first = pdfPageSize(pages[0]!.width, pages[0]!.height);
  const pdf = new jsPDF({
    unit: 'pt',
    format: [first.width, first.height],
    orientation: first.width > first.height ? 'landscape' : 'portrait',
    compress: true,
  });

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const size = pdfPageSize(p.width, p.height);
    if (i > 0) {
      pdf.addPage([size.width, size.height], size.width > size.height ? 'landscape' : 'portrait');
    }
    // El JPEG se incrusta tal cual (DCTDecode): sin recomprimir.
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    pdf.addImage(bytes, 'JPEG', 0, 0, size.width, size.height, undefined, 'NONE');
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

export type SaveResult = 'shared' | 'downloaded' | 'cancelled' | 'needs-gesture';

function canShareFiles(files: File[]): boolean {
  const isTouchDevice =
    typeof navigator !== 'undefined' &&
    (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  return (
    isTouchDevice &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    navigator.canShare({ files })
  );
}

/**
 * Entrega los archivos por la mejor via del dispositivo:
 *
 *   - Movil con Web Share de archivos: share sheet nativo (en iPhone
 *     incluye "Guardar imagen/N imagenes" -> FOTOTECA; una descarga normal
 *     termina en Archivos, que no es lo que la gente espera).
 *   - Desktop o sin soporte: descarga clasica (una por archivo).
 *
 * 'needs-gesture': Safari exige que share() ocurra DENTRO de un toque del
 * usuario. Si generar el PDF tardo, esa "activacion" ya caduco y share()
 * lanza NotAllowedError. Antes se caia a descarga (el JPG terminaba en
 * Archivos). Ahora el caller muestra un boton "Guardar" que llama a
 * shareFiles() en un toque nuevo, con los archivos ya listos.
 */
export async function saveFiles(files: File[]): Promise<SaveResult> {
  if (canShareFiles(files)) {
    const r = await shareFiles(files);
    if (r !== 'failed') return r;
  }
  await downloadAll(files);
  return 'downloaded';
}

/** Llama a navigator.share. Debe invocarse directo desde un toque. */
export async function shareFiles(
  files: File[],
): Promise<'shared' | 'cancelled' | 'needs-gesture' | 'failed'> {
  try {
    await navigator.share({ files });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    if (err instanceof Error && err.name === 'NotAllowedError') return 'needs-gesture';
    return 'failed';
  }
}

export async function downloadAll(files: File[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 350));
    downloadBlob(files[i]!, files[i]!.name);
  }
}
