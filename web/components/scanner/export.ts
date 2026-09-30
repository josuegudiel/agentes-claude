/**
 * Helpers de exportacion. jsPDF se carga con dynamic import solo cuando el
 * usuario pide PDF, asi el bundle principal no paga ~150 KB extra.
 *
 * Las paginas llegan como JPEG ya codificados (ver pages.ts): el PDF y el
 * JPG los usan tal cual, sin recomprimir.
 */

import {
  PAGE_JPEG_QUALITY,
  canvasToBlob,
  decodeBlob,
  drawRotated,
  rotatedSize,
  type Rotation,
} from './pages';
import { releaseCanvas } from './pipeline';

export type ExportFormat = 'png' | 'jpg' | 'pdf';

export interface ExportPageInput {
  blob: Blob;
  /** Dimensiones del JPEG (sin girar). */
  width: number;
  height: number;
  /** Giro horario a aplicar al exportar (0 si se omite). */
  rotation?: Rotation;
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

/**
 * Como colocar el JPEG en la pagina PDF para que se vea girado `r` grados
 * (horario) SIN recomprimirlo: el giro va en la matriz de dibujo.
 *
 * Parametros para jsPDF.addImage(x, y, w, h, ..., angle). jsPDF ancla la
 * esquina inferior izquierda de la imagen en (x, y + h) (coordenadas desde
 * arriba) y gira `angle` grados ANTIHORARIO alrededor de ese punto; los
 * x/y de abajo compensan ese giro para que la imagen llene la pagina
 * exacta. Verificado en export.test.ts reproduciendo la matriz de jsPDF.
 */
export function pdfPlacement(
  w: number,
  h: number,
  r: Rotation,
): { pageW: number; pageH: number; x: number; y: number; drawW: number; drawH: number; angle: number } {
  const turned = rotatedSize(w, h, r);
  const page = pdfPageSize(turned.width, turned.height);
  // Tamano de la imagen SIN girar, en puntos.
  const s = page.width / turned.width;
  const drawW = w * s;
  const drawH = h * s;
  const base = { pageW: page.width, pageH: page.height, drawW, drawH };
  switch (r) {
    case 90:
      return { ...base, x: 0, y: -drawH, angle: -90 };
    case 180:
      return { ...base, x: drawW, y: -drawH, angle: -180 };
    case 270:
      return { ...base, x: drawH, y: drawW - drawH, angle: -270 };
    default:
      return { ...base, x: 0, y: 0, angle: 0 };
  }
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
  // Una pagina a la vez en memoria. Un JPG sin giro se entrega tal cual
  // (sin recomprimir); girado o PNG se re-codifica una vez.
  const files: File[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const r = p.rotation ?? 0;
    if (format === 'jpg') {
      const blob = r === 0 ? p.blob : await reencode(p.blob, r, 'image/jpeg', PAGE_JPEG_QUALITY);
      files.push(new File([blob], names[i]!, { type: 'image/jpeg' }));
    } else {
      const png = await reencode(p.blob, r, 'image/png');
      files.push(new File([png], names[i]!, { type: 'image/png' }));
    }
  }
  return files;
}

async function reencode(blob: Blob, r: Rotation, mime: string, quality?: number): Promise<Blob> {
  const img = await decodeBlob(blob);
  const c = drawRotated(img, img.naturalWidth, img.naturalHeight, r);
  try {
    return await canvasToBlob(c, mime, quality);
  } finally {
    releaseCanvas(c);
  }
}

async function pagesToPdfBlob(pages: ExportPageInput[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const place = pages.map((p) => pdfPlacement(p.width, p.height, p.rotation ?? 0));
  const first = place[0]!;
  const pdf = new jsPDF({
    unit: 'pt',
    format: [first.pageW, first.pageH],
    orientation: first.pageW > first.pageH ? 'landscape' : 'portrait',
    compress: true,
  });

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const pl = place[i]!;
    if (i > 0) {
      pdf.addPage([pl.pageW, pl.pageH], pl.pageW > pl.pageH ? 'landscape' : 'portrait');
    }
    // El JPEG se incrusta tal cual (DCTDecode): sin recomprimir, aunque
    // este girado (el giro va en la matriz, ver pdfPlacement).
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    pdf.addImage(bytes, 'JPEG', pl.x, pl.y, pl.drawW, pl.drawH, undefined, 'NONE', pl.angle);
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
