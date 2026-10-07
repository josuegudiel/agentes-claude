/**
 * Helpers de exportacion. El PDF lo arma pdf-writer.ts (sin jsPDF).
 *
 * Las paginas llegan como JPEG ya codificados (ver pages.ts): el PDF y el
 * JPG los usan tal cual, sin recomprimir.
 */

import { PAGE_JPEG_QUALITY, canvasToBlob, decodeBlob, drawRotated, type Rotation } from './pages';
import { buildPdf, type PaperSize, type PdfPageInput } from './pdf-writer';
import { releaseCanvas } from './pipeline';

export type ExportFormat = 'png' | 'jpg' | 'pdf';

export function isExportFormat(v: unknown): v is ExportFormat {
  return v === 'pdf' || v === 'jpg' || v === 'png';
}

/** Nombre por defecto con la fecha de hoy: "escaneo_2026-10-04" / "scan_2026-10-04". */
export function defaultFilename(lang: 'es' | 'en' = 'es', d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${lang === 'en' ? 'scan' : 'escaneo'}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

/** Calidad de salida: la de escaneo, o reducida para correo/WhatsApp. */
export type ExportQuality = 'max' | 'small';

export function isExportQuality(v: unknown): v is ExportQuality {
  return v === 'max' || v === 'small';
}

/** "Ligera": ~150 dpi en A4 y JPEG 0.72 — suele pesar 4-6x menos. */
const SMALL_MAX_SIDE = 1754;
const SMALL_JPEG_QUALITY = 0.72;

export interface ExportOptions {
  paper?: PaperSize;
  quality?: ExportQuality;
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
 *
 * Una pagina a la vez en memoria. Con calidad maxima, PDF y JPG sin giro
 * usan el JPEG guardado tal cual (sin recomprimir).
 */
export async function exportFiles(
  pages: ExportPageInput[],
  format: ExportFormat,
  baseName: string,
  opts: ExportOptions = {},
): Promise<File[]> {
  if (pages.length === 0) throw new Error('No hay paginas para exportar');
  const base = sanitizeFilename(baseName);
  const small = opts.quality === 'small';

  if (format === 'pdf') {
    const input: PdfPageInput[] = [];
    for (const p of pages) {
      const r = p.rotation ?? 0;
      if (small) {
        // Se reduce sin girar: el giro sigue yendo en la matriz del PDF.
        const blob = await reencode(p.blob, 0, 'image/jpeg', SMALL_JPEG_QUALITY, SMALL_MAX_SIDE);
        input.push({ blob, width: 0, height: 0, rotation: r });
      } else {
        input.push({ blob: p.blob, width: p.width, height: p.height, rotation: r });
      }
    }
    const blob = await buildPdf(input, opts.paper ?? 'auto');
    const name = pages.length > 1 ? `${base}_${pages.length}p.pdf` : `${base}.pdf`;
    return [new File([blob], name, { type: 'application/pdf' })];
  }

  const names = outputNames(base, pages.length, format);
  const files: File[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const r = p.rotation ?? 0;
    if (format === 'jpg') {
      const blob =
        r === 0 && !small
          ? p.blob
          : await reencode(
              p.blob,
              r,
              'image/jpeg',
              small ? SMALL_JPEG_QUALITY : PAGE_JPEG_QUALITY,
              small ? SMALL_MAX_SIDE : Infinity,
            );
      files.push(new File([blob], names[i]!, { type: 'image/jpeg' }));
    } else {
      const png = await reencode(p.blob, r, 'image/png', undefined, small ? SMALL_MAX_SIDE : Infinity);
      files.push(new File([png], names[i]!, { type: 'image/png' }));
    }
  }
  return files;
}

async function reencode(blob: Blob, r: Rotation, mime: string, quality?: number, maxSide = Infinity): Promise<Blob> {
  const img = await decodeBlob(blob);
  const c = drawRotated(img, img.naturalWidth, img.naturalHeight, r, maxSide);
  try {
    return await canvasToBlob(c, mime, quality);
  } finally {
    releaseCanvas(c);
  }
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

/** Chrome (no iOS) rechaza compartir mas de 10 archivos o mas de 50 MB. */
const CHROME_SHARE_MAX_FILES = 10;
const CHROME_SHARE_MAX_BYTES = 50 * 1024 * 1024;

function isChromiumShare(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // En iOS todos los navegadores usan WebKit (otro limite, otras reglas).
  return /Chrome\/|Chromium\//.test(ua) && !/iPhone|iPad|iPod|CriOS/.test(ua);
}

/** El dispositivo "compartiria" en vez de descargar (telefonos y tablets). */
export function prefersShare(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  // Puntero principal tactil: un portatil con pantalla tactil (Surface,
  // Chromebook) tiene puntero fino y descarga, como espera la gente.
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return navigator.maxTouchPoints > 0;
  }
}

function canShareFiles(files: File[]): boolean {
  if (!prefersShare()) return false;
  if (isChromiumShare()) {
    const bytes = files.reduce((a, f) => a + f.size, 0);
    if (files.length > CHROME_SHARE_MAX_FILES || bytes > CHROME_SHARE_MAX_BYTES) return false;
  }
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Entrega los archivos por la mejor via del dispositivo:
 *
 *   - Movil con Web Share de archivos: share sheet nativo (en iPhone
 *     incluye "Guardar imagen/N imagenes" -> FOTOTECA; una descarga normal
 *     termina en Archivos, que no es lo que la gente espera).
 *   - Desktop, sin soporte, o demasiados archivos para compartir: descarga
 *     clasica (una por archivo).
 *
 * 'needs-gesture': Safari exige que share() ocurra DENTRO de un toque del
 * usuario. Si generar el PDF tardo, esa "activacion" ya caduco y share()
 * lanza NotAllowedError. El caller muestra un boton "Guardar" que llama a
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
  // Si el toque sigue "activo" y aun asi share() dice NotAllowedError, no
  // es falta de gesto: es un limite del sistema (tamano/cantidad). Pedir
  // otro toque no serviria: mejor descargar.
  const activeBefore = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
  try {
    await navigator.share({ files });
    return 'shared';
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError') return 'cancelled';
    // Ya hay una hoja de compartir abierta (doble toque): no descargar.
    if (name === 'InvalidStateError') return 'cancelled';
    if (name === 'NotAllowedError') return activeBefore === true ? 'failed' : 'needs-gesture';
    return 'failed';
  }
}

export async function downloadAll(files: File[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 350));
    downloadBlob(files[i]!, files[i]!.name);
  }
}
