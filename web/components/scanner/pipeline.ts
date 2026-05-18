import { applyFilter, type FilterId } from './filters';

/**
 * Pipeline canonico de procesamiento: imagen original -> rotacion -> crop ->
 * filtro -> ImageBitmap final que se renderiza y se exporta.
 *
 * Mantenemos un solo source-of-truth (la imagen original, en HTMLImageElement)
 * y un objeto `EditState` con los parametros. Re-renderizamos derivando
 * todo. Esto evita el clasico bug de "le aplique B&N, ahora ya no puedo
 * volver a color".
 */

export interface Crop {
  /** Coordenadas normalizadas 0..1 sobre la imagen rotada. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditState {
  /** 0, 90, 180, 270. */
  rotation: number;
  /** Crop opcional. Si es null, exportamos la imagen completa. */
  crop: Crop | null;
  filter: FilterId;
}

export const DEFAULT_EDIT: EditState = {
  rotation: 0,
  crop: null,
  filter: 'original',
};

/**
 * Render del pipeline completo en un canvas. Devuelve el canvas para que el
 * caller lo monte en el DOM o lo serialice. No reusamos un canvas global:
 * Next.js + StrictMode dobla renders en dev y los canvases compartidos
 * generan flicker.
 */
export function renderEdited(
  source: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number },
  state: EditState,
): HTMLCanvasElement {
  const srcW =
    (source as HTMLImageElement).naturalWidth ??
    (source as HTMLCanvasElement).width ??
    0;
  const srcH =
    (source as HTMLImageElement).naturalHeight ??
    (source as HTMLCanvasElement).height ??
    0;
  if (!srcW || !srcH) throw new Error('source sin dimensiones');

  // Rotacion -> nuevas dimensiones logicas.
  const rot = ((state.rotation % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const rotW = swapped ? srcH : srcW;
  const rotH = swapped ? srcW : srcH;

  // Crop (en pixeles, post-rotacion).
  const crop = state.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const cx = Math.max(0, Math.round(crop.x * rotW));
  const cy = Math.max(0, Math.round(crop.y * rotH));
  const cw = Math.max(1, Math.round(crop.width * rotW));
  const ch = Math.max(1, Math.round(crop.height * rotH));

  // Canvas intermedio del tamano rotado para poder leer ImageData crudo del
  // recorte (mas simple que truquear transforms sobre el output final).
  const inter = document.createElement('canvas');
  inter.width = rotW;
  inter.height = rotH;
  const ictx = inter.getContext('2d');
  if (!ictx) throw new Error('canvas 2d no disponible');

  ictx.save();
  ictx.translate(rotW / 2, rotH / 2);
  ictx.rotate((rot * Math.PI) / 180);
  ictx.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH);
  ictx.restore();

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('canvas 2d no disponible');

  const cropped = ictx.getImageData(cx, cy, cw, ch);
  const filtered = applyFilter(cropped, state.filter);
  octx.putImageData(filtered, 0, 0);
  return out;
}

/**
 * Toma un File (camera o input) y lo carga como HTMLImageElement listo
 * para usar en `renderEdited`. Si la imagen es enorme (>4096 lado mayor),
 * la pre-escala — Claude vision tampoco necesita mas resolucion, y los
 * filtros corren O(n) en pixeles.
 */
export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const MAX = 4096;
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= MAX) return img;

    const scale = MAX / longest;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await loadImage(c.toDataURL('image/jpeg', 0.92));
  } finally {
    // url se libera tras el .decode(); si ya cargamos una version escalada
    // a partir de data URL, el blob original ya no se necesita.
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}
