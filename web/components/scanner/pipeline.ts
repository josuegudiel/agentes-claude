import { estimateStraighten, straightenRowMapper } from './dewarp';
import { AppError } from './errors';
import { applyFilter, type FilterId } from './filters';
import {
  estimateAspectRatio,
  isAxisAlignedRect,
  WARP_MAX_SIDE,
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
  /**
   * Enderezar renglones (hoja doblada/arrugada): rotacion + comba
   * estimadas del propio texto. Por defecto activo.
   */
  straighten?: boolean;
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

  // El enderezado de renglones solo en el render final (las miniaturas
  // son demasiado chicas para ver renglones).
  const straighten = state.straighten !== false && rotW * rotH >= 400_000;
  const processed = extractQuad(ictx, rotW, rotH, state.quad, straighten);
  // Liberar YA el intermedio: iOS Safari tiene un tope de memoria TOTAL de
  // canvas (~384 MB) y no lo devuelve hasta el GC; un canvas de 4096px son
  // ~50 MB. Poner el tamano en 0 libera el backing store inmediatamente.
  releaseCanvas(inter);
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
  straighten: boolean,
): ImageData {
  if (!quad && !straighten) return ictx.getImageData(0, 0, rotW, rotH);
  const q: Quad = quad ?? [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  const quadPx: Quad = [
    { x: q[0].x * rotW, y: q[0].y * rotH },
    { x: q[1].x * rotW, y: q[1].y * rotH },
    { x: q[2].x * rotW, y: q[2].y * rotH },
    { x: q[3].x * rotW, y: q[3].y * rotH },
  ];

  if (!straighten && isAxisAlignedRect(q)) {
    return cropBoundingBox(ictx, rotW, rotH, quadPx);
  }

  const full = ictx.getImageData(0, 0, rotW, rotH);
  // Proporcion real del documento (el centro de la foto es el centro
  // optico: la rotacion en multiplos de 90 grados lo conserva).
  const aspect = estimateAspectRatio(quadPx, { x: rotW / 2, y: rotH / 2 }, Math.max(rotW, rotH));

  // Hoja doblada/arrugada: la perspectiva supone un plano y los renglones
  // quedan torcidos. Se estima el enderezado sobre una version reducida
  // de la pagina ya rectificada y se aplica EN EL MISMO warp final (un
  // solo remuestreo: sin doble suavizado ni pasada extra).
  let rowMapFactory:
    | ((outW: number, outH: number) => (y: number, mx: Float32Array, my: Float32Array) => void)
    | undefined;
  if (straighten) {
    const small = warpPerspective(full, quadPx, 1200, aspect);
    if (small) {
      const img = new ImageData(small.width, small.height);
      img.data.set(small.data);
      const model = estimateStraighten(img);
      if (model) rowMapFactory = (w, h) => straightenRowMapper(model, w, h);
    }
  }

  const warped = warpPerspective(full, quadPx, WARP_MAX_SIDE, aspect, rowMapFactory);
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
 * Lado maximo tras el downscale para el pipeline (filtros/warp O(n)).
 * Un poco mas que el A4 a 300 dpi de salida (3508): margen para el recorte
 * y la perspectiva sin procesar pixeles que no aportan.
 */
const MAX_SIDE = 4032;
/**
 * Tope duro de megapixeles ANTES de aceptar la imagen. Un PNG de pocos KB
 * puede declarar 30000x30000 (bomba de descompresion): el browser intenta
 * materializar ~3.6 GB de bitmap y tumba la pestana. 100 MP (~10000x10000)
 * es mas que cualquier camara de telefono y acota la memoria del decode.
 */
const MAX_MEGAPIXELS = 100;

/**
 * Toma un File (camera o input) y lo carga como HTMLImageElement listo
 * para usar en `renderEdited`. Rechaza imagenes absurdamente grandes
 * (bomba de descompresion / OOM) y pre-escala las que superan MAX_SIDE.
 */
export async function loadImageFromFile(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    let img: HTMLImageElement;
    try {
      img = await loadImage(url);
    } catch (err) {
      // HEIC/HEIF (fotos de Samsung/iPhone en "alta eficiencia"): Chrome
      // en Android no las sabe abrir. Decirlo claro en vez de un error generico.
      const name = (file as File).name ?? '';
      if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(name)) {
        throw new AppError('img.heic');
      }
      throw err;
    }
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;

    // Guarda anti-OOM: si el decode devolvio dimensiones absurdas,
    // abortar con error claro en vez de arrastrar cientos de MB.
    if (!nw || !nh) throw new AppError('img.invalid');
    if ((nw * nh) / 1e6 > MAX_MEGAPIXELS) {
      throw new AppError('img.tooBig', { mp: Math.round((nw * nh) / 1e6), max: MAX_MEGAPIXELS });
    }

    // PNG/WebP/GIF pueden traer transparencia: los filtros la leian como
    // negro. Se aplanan sobre blanco (como una hoja de papel).
    const mayHaveAlpha = /png|webp|gif/i.test(file.type);
    const longest = Math.max(nw, nh);
    if (longest <= MAX_SIDE && !mayHaveAlpha) return img;

    const scale = Math.min(1, MAX_SIDE / longest);
    const c = document.createElement('canvas');
    c.width = Math.round(nw * scale);
    c.height = Math.round(nh * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return img;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // toBlob (asincrono) en vez de toDataURL: no congela la pantalla
    // codificando una foto de 12 MP.
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.92));
    releaseCanvas(c);
    if (!blob) return img;
    const scaledUrl = URL.createObjectURL(blob);
    try {
      return await loadImage(scaledUrl);
    } finally {
      // La imagen ya decodificada no necesita la URL.
      URL.revokeObjectURL(scaledUrl);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Dibuja la imagen ROTADA directamente a tamano reducido (lado mayor <=
 * maxSide), sin pasar por un canvas intermedio a resolucion completa.
 * Es la base del preview del editor: rotar/filtrar a 4096px en cada
 * cambio de esquina congelaba el telefono.
 */
export function renderRotatedPreview(
  image: HTMLImageElement,
  rotation: number,
  maxSide: number,
): HTMLCanvasElement {
  const srcW = image.naturalWidth;
  const srcH = image.naturalHeight;
  const rot = ((rotation % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const rotW = swapped ? srcH : srcW;
  const rotH = swapped ? srcW : srcH;
  const scale = Math.min(1, maxSide / Math.max(rotW, rotH, 1));
  const w = Math.max(1, Math.round(rotW * scale));
  const h = Math.max(1, Math.round(rotH * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d no disponible');
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(image, (-srcW * scale) / 2, (-srcH * scale) / 2, srcW * scale, srcH * scale);
  return c;
}

/** Libera el backing store de un canvas que ya no se usa (ver renderEdited). */
export function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AppError('img.decode'));
    img.src = src;
  });
}
