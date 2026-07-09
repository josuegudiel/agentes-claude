import { applyFilter, type FilterId } from './filters';
import {
  isAxisAlignedRect,
  warpPerspective,
  type Quad,
} from './perspective';

/**
 * Pipeline canonico de procesamiento: imagen original -> rotacion ->
 * correccion de perspectiva (quad de 4 esquinas) -> filtro -> canvas final
 * que se renderiza y se exporta.
 *
 * Mantenemos un solo source-of-truth (la imagen original, en HTMLImageElement)
 * y un objeto `EditState` con los parametros. Re-renderizamos derivando
 * todo. Esto evita el clasico bug de "le aplique B&N, ahora ya no puedo
 * volver a color".
 */

export interface EditState {
  /** 0, 90, 180, 270. */
  rotation: number;
  /**
   * 4 esquinas del documento en coordenadas normalizadas 0..1 sobre la
   * imagen rotada (orden tl, tr, br, bl). null = imagen completa.
   * Si el quad es un rectangulo alineado se hace crop directo; si no,
   * warp de perspectiva.
   */
  quad: Quad | null;
  filter: FilterId;
}

export const DEFAULT_EDIT: EditState = {
  rotation: 0,
  quad: null,
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

  // Canvas intermedio del tamano rotado para poder leer ImageData crudo
  // (mas simple que truquear transforms sobre el output final).
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

  const processed = extractQuad(ictx, rotW, rotH, state.quad);
  const filtered = applyFilter(processed, state.filter);

  const out = document.createElement('canvas');
  out.width = filtered.width;
  out.height = filtered.height;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('canvas 2d no disponible');
  octx.putImageData(filtered, 0, 0);
  return out;
}

/**
 * Extrae la region del quad como ImageData listo para filtrar.
 *
 *   - quad null: la imagen rotada completa.
 *   - quad rectangular alineado: getImageData directo (fast path, sin warp).
 *   - quad arbitrario: warp de perspectiva. Si el warp falla (quad
 *     degenerado, esquinas colineales) caemos a crop del bounding box —
 *     mejor un crop imperfecto que una excepcion en la cara del usuario.
 */
function extractQuad(
  ictx: CanvasRenderingContext2D,
  rotW: number,
  rotH: number,
  quad: Quad | null,
): ImageData {
  if (!quad) return ictx.getImageData(0, 0, rotW, rotH);

  const quadPx: Quad = [
    { x: quad[0].x * rotW, y: quad[0].y * rotH },
    { x: quad[1].x * rotW, y: quad[1].y * rotH },
    { x: quad[2].x * rotW, y: quad[2].y * rotH },
    { x: quad[3].x * rotW, y: quad[3].y * rotH },
  ];

  if (isAxisAlignedRect(quad)) {
    return cropBoundingBox(ictx, rotW, rotH, quadPx);
  }

  const full = ictx.getImageData(0, 0, rotW, rotH);
  const warped = warpPerspective(full, quadPx);
  if (!warped) return cropBoundingBox(ictx, rotW, rotH, quadPx);

  // Copiamos al buffer del ImageData en vez de pasarlo al constructor:
  // el constructor exige Uint8ClampedArray<ArrayBuffer> estricto y el
  // buffer del warp esta tipado como ArrayBufferLike.
  const img = new ImageData(warped.width, warped.height);
  img.data.set(warped.data);
  return img;
}

function cropBoundingBox(
  ictx: CanvasRenderingContext2D,
  rotW: number,
  rotH: number,
  quadPx: Quad,
): ImageData {
  const xs = quadPx.map((p) => p.x);
  const ys = quadPx.map((p) => p.y);
  const x0 = Math.max(0, Math.round(Math.min(...xs)));
  const y0 = Math.max(0, Math.round(Math.min(...ys)));
  const x1 = Math.min(rotW, Math.round(Math.max(...xs)));
  const y1 = Math.min(rotH, Math.round(Math.max(...ys)));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return ictx.getImageData(x0, y0, w, h);
}

/**
 * Toma un File (camera o input) y lo carga como HTMLImageElement listo
 * para usar en `renderEdited`. Si la imagen es enorme (>4096 lado mayor),
 * la pre-escala — los filtros y el warp corren O(n) en pixeles y en un
 * movil de gama media 16MP ya se siente.
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
