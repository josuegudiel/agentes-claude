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
import { AppError } from './errors';
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

/** Error de importacion; `code` es una clave de i18n ("pdf.*"). */
export class PdfImportError extends AppError {
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
const pdfjsBase = (version: string): string => `/pdfjs/${version}/`;
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    // Build "legacy": funciona en iPhones con iOS algo viejo.
    // (scripts/downlevel.cjs la baja a iOS 15.4+, incluido el worker).
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      // La carpeta lleva la version (scripts/copy-pdfjs.mjs): el worker
      // siempre coincide con esta copia de la libreria.
      m.GlobalWorkerOptions.workerSrc = `${pdfjsBase(m.version)}pdf.worker.min.mjs`;
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
  /** Hojas que no se pudieron leer (se saltan, no abortan la importacion). */
  failed: number;
  /** El usuario cancelo: no se devuelve ninguna hoja. */
  cancelled: boolean;
}

/**
 * Importa las hojas de `file`. `nextId` entrega ids de pagina;
 * `onProgress(hecho, total)` avisa el avance (una hoja a la vez en memoria).
 */
export async function importPdf(
  file: File,
  nextId: () => number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new PdfImportError('pdf.tooBig');
  }
  const pdfjs = await loadPdfJs().catch((err: unknown) => {
    // ChunkLoadError = no llego el archivo (sin red, o la app se actualizo
    // mientras estaba abierta). Cualquier otra cosa: el navegador no puede.
    const name = err instanceof Error ? err.name : '';
    throw new PdfImportError(
      name === 'ChunkLoadError' ? 'pdf.loadNetwork' : 'pdf.loadBrowser',
    );
  });
  const empty = (): ImportResult => ({ pages: [], total: 0, failed: 0, cancelled: true });
  if (signal?.aborted) return empty();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    wasmUrl: `${pdfjsBase(pdfjs.version)}wasm/`,
    standardFontDataUrl: `${pdfjsBase(pdfjs.version)}standard_fonts/`,
    cMapUrl: `${pdfjsBase(pdfjs.version)}cmaps/`,
    // Tope a las imagenes dentro del PDF (pixeles): un PDF armado con una
    // imagen gigante no puede agotar la memoria del telefono.
    maxImageSize: 40e6,
    // Sin scripts ni formularios XFA (ya son los valores por defecto).
    enableXfa: false,
    cMapPacked: true,
    verbosity: 0,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (err) {
    void task.destroy();
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') {
      throw new PdfImportError('pdf.password');
    }
    if (name === 'InvalidPDFException') {
      throw new PdfImportError('pdf.invalid');
    }
    throw new PdfImportError('pdf.open');
  }

  try {
    const total = doc.numPages;
    const count = Math.min(total, MAX_IMPORT_PAGES);
    const pages: ScanPage[] = [];
    let failed = 0;
    onProgress?.(0, count);
    for (let i = 1; i <= count; i++) {
      if (signal?.aborted) return empty();
      // Una hoja ilegible (o sin memoria para dibujarla) se salta: no se
      // pierden las demas.
      try {
        pages.push(await renderPage(doc, i, nextId));
      } catch {
        failed++;
      }
      onProgress?.(i, count);
    }
    if (signal?.aborted) return empty();
    if (pages.length === 0 && failed > 0) {
      throw new PdfImportError('pdf.noneRead');
    }
    return { pages, total, failed, cancelled: false };
  } finally {
    void task.destroy();
  }
}

async function renderPage(doc: PDFDocumentProxy, i: number, nextId: () => number): Promise<ScanPage> {
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
      throw new PdfImportError('pdf.draw');
    }
    // Fondo blanco: el JPEG no tiene transparencia (saldria negro).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    } catch (err) {
      releaseCanvas(canvas);
      throw err;
    }
    // pageFromCanvas codifica a JPEG y libera el canvas (tambien si falla).
    return await pageFromCanvas(canvas, nextId());
  } finally {
    page.cleanup();
  }
}
