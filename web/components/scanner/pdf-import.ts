/**
 * "Añadir PDF": convierte cada hoja de un PDF en una pagina del scanner
 * (JPEG, igual que una escaneada) para poder completarlo, reordenarlo y
 * volver a exportarlo. Caso tipico: se exporto el PDF, faltaba una hoja.
 *
 * Todo ocurre en el telefono (pdf.js), sin subir nada. pdf.js y su worker
 * (~1.8 MB) se cargan SOLO la primera vez que alguien importa un PDF; el
 * worker y los decodificadores se sirven desde /pdfjs (ver
 * scripts/copy-pdfjs.mjs).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageFromCanvas, type ScanPage } from './pages';
import { releaseCanvas } from './pipeline';

/** Tope de hojas por PDF: cada una ocupa ~0.5-2 MB en el telefono. */
export const MAX_IMPORT_PAGES = 60;
/** 300 dpi: lo mismo que usa el PDF exportado (A4 -> 2480x3508). */
const RENDER_DPI = 300;
/** Lado mayor maximo, igual que una pagina escaneada. */
export const IMPORT_MAX_SIDE = 3508;
/** Y un tope de area para hojas raras (planos, banners). */
const IMPORT_MAX_PIXELS = 12e6;
/** Hasta 50 MB: mas que eso no es un documento del colegio. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export class PdfImportError extends Error {
  override name = 'PdfImportError';
}

/**
 * Escala de render para una hoja de `wPt` x `hPt` puntos: 300 dpi, pero sin
 * pasar del lado maximo ni del tope de pixeles.
 */
export function importScale(wPt: number, hPt: number): number {
  let s = RENDER_DPI / 72;
  s = Math.min(s, IMPORT_MAX_SIDE / Math.max(wPt, hPt));
  s = Math.min(s, Math.sqrt(IMPORT_MAX_PIXELS / (wPt * hPt)));
  return s;
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    // Build "legacy": funciona en iPhones con iOS algo viejo.
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return m;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null; // reintentable (p.ej. se corto la red)
    });
  }
  return pdfjsPromise;
}

export interface ImportResult {
  pages: ScanPage[];
  /** Hojas que tenia el PDF (puede ser > pages.length si se trunco). */
  total: number;
}

/**
 * Importa las hojas de `file`. `nextId` entrega ids de pagina;
 * `onProgress(hecho, total)` avisa el avance (una hoja a la vez en memoria).
 */
export async function importPdf(
  file: File,
  nextId: () => number,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new PdfImportError('El PDF es demasiado grande (máximo 50 MB).');
  }
  const pdfjs = await loadPdfJs().catch(() => {
    throw new PdfImportError('No se pudo cargar el lector de PDF. Revisa tu conexión e inténtalo de nuevo.');
  });

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    wasmUrl: '/pdfjs/wasm/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    verbosity: 0,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (err) {
    void task.destroy();
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') {
      throw new PdfImportError('Ese PDF tiene contraseña. Ábrelo sin contraseña o guarda una copia sin protección.');
    }
    if (name === 'InvalidPDFException') {
      throw new PdfImportError('El archivo no es un PDF válido o está dañado.');
    }
    throw new PdfImportError('No se pudo abrir el PDF.');
  }

  try {
    const total = doc.numPages;
    const count = Math.min(total, MAX_IMPORT_PAGES);
    const pages: ScanPage[] = [];
    onProgress?.(0, count);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: importScale(base.width, base.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          releaseCanvas(canvas);
          throw new PdfImportError('Tu navegador no pudo dibujar la hoja.');
        }
        // Fondo blanco: el JPEG no tiene transparencia (saldria negro).
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        try {
          await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
        } catch (err) {
          releaseCanvas(canvas);
          throw err instanceof PdfImportError
            ? err
            : new PdfImportError(`No se pudo leer la hoja ${i} del PDF.`);
        }
        // pageFromCanvas codifica a JPEG y libera el canvas.
        pages.push(await pageFromCanvas(canvas, nextId()));
      } finally {
        page.cleanup();
      }
      onProgress?.(i, count);
    }
    return { pages, total };
  } finally {
    void task.destroy();
  }
}
