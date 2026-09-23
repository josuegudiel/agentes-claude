import { releaseCanvas } from './pipeline';

/**
 * Modelo de una pagina escaneada ya procesada.
 *
 * Las paginas se guardan como JPEG (Blob), NO como canvas vivos: un canvas
 * de 4096x3072 ocupa ~50 MB y iOS Safari tiene un tope de memoria TOTAL de
 * canvas (~384 MB). Con canvases, a la 7a-8a pagina el navegador dejaba de
 * crear canvas nuevos y el "Aplicar" fallaba en silencio. Un JPEG de la
 * misma pagina pesa ~1-2 MB.
 *
 * Ademas el Blob es exactamente lo que se persiste en IndexedDB y lo que
 * se mete en el PDF: se codifica UNA vez (sin recompresiones al reordenar
 * o al recargar la pestana).
 */
export interface ScanPage {
  id: number;
  blob: Blob;
  width: number;
  height: number;
  /** Miniatura JPEG pequena (dataURL) para la grilla. */
  thumb: string;
}

export const PAGE_JPEG_QUALITY = 0.92;
const THUMB_MAX_SIDE = 360;

/**
 * Tope de megapixeles al restaurar desde IndexedDB. En operacion normal
 * las paginas vienen acotadas a <=4096px, pero si el almacenamiento del
 * origen fuera manipulado un blob gigante causaria OOM al recargar.
 */
export const RESTORE_MAX_MEGAPIXELS = 100;

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime = 'image/jpeg',
  quality: number | undefined = PAGE_JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo codificar la pagina'))),
      mime,
      quality,
    );
  });
}

function makeThumb(source: CanvasImageSource, w: number, h: number): string {
  const s = Math.min(1, THUMB_MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.72);
  releaseCanvas(c);
  return url;
}

/** Codifica el canvas del editor como pagina y LIBERA el canvas. */
export async function pageFromCanvas(canvas: HTMLCanvasElement, id: number): Promise<ScanPage> {
  const { width, height } = canvas;
  const thumb = makeThumb(canvas, width, height);
  const blob = await canvasToBlob(canvas);
  releaseCanvas(canvas);
  return { id, blob, width, height, thumb };
}

export function decodeBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('No se pudo leer la pagina'));
    el.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

/** Reconstruye una pagina desde el Blob persistido (restauracion). */
export async function pageFromBlob(blob: Blob, id: number): Promise<ScanPage> {
  const img = await decodeBlob(blob);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height || (width * height) / 1e6 > RESTORE_MAX_MEGAPIXELS) {
    throw new Error('Pagina guardada con dimensiones invalidas');
  }
  return { id, blob, width, height, thumb: makeThumb(img, width, height) };
}
