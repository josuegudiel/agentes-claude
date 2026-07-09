import { isConvexQuad, type Quad } from './perspective';

/**
 * Deteccion automatica de los bordes del documento — el "auto-crop" de
 * CamScanner. Dada una imagen (ya reducida a ~256px por el caller),
 * devuelve el quad de las 4 esquinas del documento o null si no hay un
 * candidato confiable.
 *
 * Algoritmo (sin OpenCV, puro TS, testeable en node):
 *   1. Grises + blur suave (reduce ruido del sensor).
 *   2. Gradiente Sobel -> mapa de bordes binario (umbral por percentil).
 *   3. Limpieza: descartar pixeles de borde aislados (sin vecinos).
 *   4. Esquinas por extremos diagonales: tl = min(x+y), tr = max(x-y),
 *      br = max(x+y), bl = min(x-y).
 *   5. Validacion: quad convexo, area 8%..99% de la imagen.
 *
 * Es una heuristica de "sugerencia": el usuario siempre puede ajustar las
 * esquinas a mano despues. Si la deteccion no es confiable devolvemos null
 * y el editor mantiene el quad por defecto.
 */

/** Lado maximo recomendado de la imagen de entrada. Mas grande funciona
 * pero es O(n) en pixeles y no mejora la deteccion. */
export const DETECT_MAX_SIDE = 256;

export function detectDocumentQuad(img: ImageData): Quad | null {
  const w = img.width;
  const h = img.height;
  if (w < 16 || h < 16) return null;

  // 1. Grises.
  const gray = new Float32Array(w * h);
  const px = img.data;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    gray[j] = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
  }

  // Blur 3x3 barato (media) para matar ruido de un pixel.
  const blurred = blur3x3(gray, w, h);

  // 2. Sobel.
  const mag = new Float32Array(w * h);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = blurred[i - w - 1]!;
      const t = blurred[i - w]!;
      const tr = blurred[i - w + 1]!;
      const l = blurred[i - 1]!;
      const r = blurred[i + 1]!;
      const bl = blurred[i + w - 1]!;
      const b = blurred[i + w]!;
      const br = blurred[i + w + 1]!;
      const gx = -tl - 2 * l - bl + tr + 2 * r + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      const m = Math.abs(gx) + Math.abs(gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }

  // Imagen plana: no hay gradientes -> no hay documento.
  if (maxMag < 60) return null;

  // 3. Umbral adaptativo: percentil 92 de magnitudes no nulas, acotado
  // por una fraccion del maximo. El percentil gobierna en fotos reales
  // (mucha textura debil, pocos bordes fuertes); la fraccion del maximo
  // gobierna en imagenes muy limpias donde TODOS los gradientes no nulos
  // son borde real y el percentil seria demasiado agresivo. El piso
  // absoluto evita que una imagen casi plana "detecte" ruido.
  const threshold = Math.max(50, Math.min(percentileNonZero(mag, 0.92), 0.3 * maxMag));

  const edge = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) {
    if (mag[i]! >= threshold) edge[i] = 1;
  }

  // 4. Esquinas por extremos diagonales, ignorando pixeles aislados
  // (sin al menos 2 vecinos de borde en su 3x3 — tipico ruido).
  let tlScore = Infinity;
  let trScore = -Infinity;
  let brScore = -Infinity;
  let blScore = -Infinity;
  let tlP = { x: 0, y: 0 };
  let trP = { x: 0, y: 0 };
  let brP = { x: 0, y: 0 };
  let blP = { x: 0, y: 0 };
  let edgeCount = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!edge[i]) continue;
      const neighbors =
        edge[i - w - 1]! + edge[i - w]! + edge[i - w + 1]! +
        edge[i - 1]! + edge[i + 1]! +
        edge[i + w - 1]! + edge[i + w]! + edge[i + w + 1]!;
      if (neighbors < 2) continue;
      edgeCount++;

      const sum = x + y;
      const diffTr = x - y;
      const diffBl = y - x;
      if (sum < tlScore) {
        tlScore = sum;
        tlP = { x, y };
      }
      if (sum > brScore) {
        brScore = sum;
        brP = { x, y };
      }
      if (diffTr > trScore) {
        trScore = diffTr;
        trP = { x, y };
      }
      if (diffBl > blScore) {
        blScore = diffBl;
        blP = { x, y };
      }
    }
  }

  // Muy pocos pixeles de borde: no hay estructura suficiente.
  if (edgeCount < Math.max(24, (w + h) / 8)) return null;

  const quad: Quad = [
    { x: tlP.x / w, y: tlP.y / h },
    { x: trP.x / w, y: trP.y / h },
    { x: brP.x / w, y: brP.y / h },
    { x: blP.x / w, y: blP.y / h },
  ];

  // 5. Validaciones geometricas.
  if (!isConvexQuad(quad, 5e-3)) return null;

  const area = quadArea(quad);
  if (area < 0.08 || area > 0.99) return null;

  return quad;
}

/** Area del quad (shoelace) en coordenadas normalizadas — fraccion 0..1. */
export function quadArea(q: Quad): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function blur3x3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(w - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(h - 1, y + 1);
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          sum += src[yy * w + xx]!;
          n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

/**
 * Percentil p (0..1) de los valores > 0 del array. Histograma de enteros —
 * los magnitudes Sobel caben en 0..2040.
 */
function percentileNonZero(values: Float32Array, p: number): number {
  const hist = new Uint32Array(2048);
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v <= 0) continue;
    hist[Math.min(2047, Math.round(v))]!++;
    count++;
  }
  if (count === 0) return Infinity;
  const target = count * p;
  let cum = 0;
  for (let v = 0; v < 2048; v++) {
    cum += hist[v]!;
    if (cum >= target) return v;
  }
  return 2047;
}
