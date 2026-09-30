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
  /** Dimensiones del JPEG guardado (SIN aplicar `rotation`). */
  width: number;
  height: number;
  /**
   * Giro de la hoja en grados, sentido horario. Es solo un dato: el JPEG
   * NO se re-codifica al girar (girar 4 veces no degrada la imagen). Se
   * aplica al exportar — en el PDF sin recomprimir (matriz de la pagina).
   */
  rotation: Rotation;
  /** Miniatura JPEG pequena (dataURL) SIN girar: el giro se muestra con CSS (PageThumb). */
  thumb: string;
}

export type Rotation = 0 | 90 | 180 | 270;

export function isRotation(v: unknown): v is Rotation {
  return v === 0 || v === 90 || v === 180 || v === 270;
}

/** Siguiente giro de 90 grados en sentido horario. */
export function rotateClockwise(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** Tamano de la hoja tal como se ve (con el giro aplicado). */
export function rotatedSize(w: number, h: number, r: Rotation): { width: number; height: number } {
  return r === 90 || r === 270 ? { width: h, height: w } : { width: w, height: h };
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

/**
 * Dibuja `source` (de w x h) girado `r` grados en sentido horario en un
 * canvas nuevo, escalado para que su lado mayor no pase de `maxSide`.
 * El caller es responsable de liberar el canvas (releaseCanvas).
 */
export function drawRotated(
  source: CanvasImageSource,
  w: number,
  h: number,
  r: Rotation,
  maxSide = Infinity,
): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * s));
  const dh = Math.max(1, Math.round(h * s));
  const out = rotatedSize(dw, dh, r);
  const c = document.createElement('canvas');
  c.width = out.width;
  c.height = out.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
  return c;
}

function makeThumb(source: CanvasImageSource, w: number, h: number): string {
  let c: HTMLCanvasElement;
  try {
    c = drawRotated(source, w, h, 0, THUMB_MAX_SIDE);
  } catch {
    return '';
  }
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
  return { id, blob, width, height, rotation: 0, thumb };
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
export async function pageFromBlob(blob: Blob, id: number, rotation: Rotation = 0): Promise<ScanPage> {
  const img = await decodeBlob(blob);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height || (width * height) / 1e6 > RESTORE_MAX_MEGAPIXELS) {
    throw new Error('Pagina guardada con dimensiones invalidas');
  }
  return { id, blob, width, height, rotation, thumb: makeThumb(img, width, height) };
}
