/**
 * Correccion de perspectiva — el corazon de un scanner tipo CamScanner.
 *
 * El usuario marca las 4 esquinas del documento (un cuadrilatero arbitrario)
 * y lo "aplanamos" a un rectangulo via homografia + sampling bilineal.
 *
 * Todo es matematica pura sobre bufferes de pixeles — sin DOM — para poder
 * testearlo en vitest con environment node.
 */

export interface Point {
  x: number;
  y: number;
}

/** Orden fijo: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** Quad que cubre la imagen completa (coordenadas normalizadas 0..1). */
export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Quad con margen del 5% — el "crop sugerido" inicial. */
export const INSET_QUAD: Quad = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
];

export function cloneQuad(q: Quad): Quad {
  return [
    { x: q[0].x, y: q[0].y },
    { x: q[1].x, y: q[1].y },
    { x: q[2].x, y: q[2].y },
    { x: q[3].x, y: q[3].y },
  ];
}

/**
 * true si el quad es un rectangulo alineado a los ejes. En ese caso el
 * pipeline puede usar getImageData directo (100x mas rapido que el warp).
 */
export function isAxisAlignedRect(q: Quad, eps = 1e-4): boolean {
  const [tl, tr, br, bl] = q;
  return (
    Math.abs(tl.y - tr.y) < eps &&
    Math.abs(bl.y - br.y) < eps &&
    Math.abs(tl.x - bl.x) < eps &&
    Math.abs(tr.x - br.x) < eps
  );
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * true si el quad es estrictamente convexo y sin esquinas colineales.
 * Un quad cruzado (el usuario arrastro una esquina "por encima" de otra) o
 * con 3 puntos en linea produce homografias degeneradas — el warp debe
 * rechazarlo y el caller cae al bounding box.
 *
 * Criterio: el seno del angulo en cada esquina (cross product normalizado
 * de los bordes consecutivos) debe tener el mismo signo y magnitud minima.
 */
export function isConvexQuad(q: Quad, minSin = 1e-3): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const c = q[(i + 2) % 4]!;
    const e1x = b.x - a.x;
    const e1y = b.y - a.y;
    const e2x = c.x - b.x;
    const e2y = c.y - b.y;
    const len1 = Math.hypot(e1x, e1y);
    const len2 = Math.hypot(e2x, e2y);
    if (len1 < 1e-9 || len2 < 1e-9) return false;
    const sin = (e1x * e2y - e1y * e2x) / (len1 * len2);
    if (Math.abs(sin) < minSin) return false;
    const s = Math.sign(sin);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Resuelve A·x = b (n x n) por eliminacion gaussiana con pivoteo parcial.
 * Devuelve null si la matriz es singular (quad degenerado / colineal).
 */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Matriz aumentada, copiada para no mutar los argumentos.
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    // Pivoteo parcial: fila con mayor |valor| en esta columna.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = tmp;
    }

    const pv = M[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r]![c]! -= f * M[col]![c]!;
      }
    }
  }

  // Back-substitution.
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= M[r]![c]! * x[c]!;
    x[r] = sum / M[r]![r]!;
  }
  return x;
}

/**
 * Homografia 3x3 (como array de 9, row-major, h8=1) que mapea cada
 * src[i] -> dst[i]. Sistema clasico de 8 ecuaciones:
 *
 *   u = (h0·x + h1·y + h2) / (h6·x + h7·y + 1)
 *   v = (h3·x + h4·y + h5) / (h6·x + h7·y + 1)
 *
 * Devuelve null si los puntos son colineales / el quad esta degenerado.
 */
export function computeHomography(src: Quad, dst: Quad): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [...h, 1];
}

/** Aplica una homografia a un punto. */
export function applyHomography(h: number[], p: Point): Point {
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  return {
    x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w,
    y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w,
  };
}

export interface WarpResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Endereza el cuadrilatero `quadPx` (en pixeles sobre `src`) a un
 * rectangulo. El tamano de salida usa el lado MAS LARGO de cada par de
 * bordes opuestos — asi no perdemos resolucion del lado "cercano" a la
 * camara.
 *
 * Inverse mapping: para cada pixel de salida calculamos de donde viene en
 * la fuente (homografia rect->quad) y sampleamos bilinealmente. Inverse
 * (y no forward) porque garantiza que cada pixel de salida queda pintado,
 * sin agujeros.
 *
 * Si el quad esta degenerado (3 puntos colineales, cruzado, area ~0)
 * devuelve null y el caller decide el fallback (tipicamente bounding-box
 * crop).
 */
export function warpPerspective(src: ImageData, quadPx: Quad): WarpResult | null {
  if (!isConvexQuad(quadPx)) return null;
  const [tl, tr, br, bl] = quadPx;

  const outW = Math.max(1, Math.round(Math.max(dist(tl, tr), dist(bl, br))));
  const outH = Math.max(1, Math.round(Math.max(dist(tl, bl), dist(tr, br))));

  const dstRect: Quad = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];

  // H mapea coordenadas de salida -> coordenadas de la fuente.
  const h = computeHomography(dstRect, quadPx);
  if (!h) return null;

  const sw = src.width;
  const sh = src.height;
  const sdata = src.data;
  const out = new Uint8ClampedArray(outW * outH * 4);

  const h0 = h[0]!, h1 = h[1]!, h2 = h[2]!;
  const h3 = h[3]!, h4 = h[4]!, h5 = h[5]!;
  const h6 = h[6]!, h7 = h[7]!, h8 = h[8]!;

  let o = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++, o += 4) {
      const w = h6 * x + h7 * y + h8;
      const sx = (h0 * x + h1 * y + h2) / w;
      const sy = (h3 * x + h4 * y + h5) / w;

      // Bilineal con clamp a los bordes de la fuente.
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;

      const cx0 = x0 < 0 ? 0 : x0 >= sw ? sw - 1 : x0;
      const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= sw ? sw - 1 : x0 + 1;
      const cy0 = y0 < 0 ? 0 : y0 >= sh ? sh - 1 : y0;
      const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= sh ? sh - 1 : y0 + 1;

      const i00 = (cy0 * sw + cx0) * 4;
      const i10 = (cy0 * sw + cx1) * 4;
      const i01 = (cy1 * sw + cx0) * 4;
      const i11 = (cy1 * sw + cx1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      out[o] =
        sdata[i00]! * w00 + sdata[i10]! * w10 + sdata[i01]! * w01 + sdata[i11]! * w11;
      out[o + 1] =
        sdata[i00 + 1]! * w00 +
        sdata[i10 + 1]! * w10 +
        sdata[i01 + 1]! * w01 +
        sdata[i11 + 1]! * w11;
      out[o + 2] =
        sdata[i00 + 2]! * w00 +
        sdata[i10 + 2]! * w10 +
        sdata[i01 + 2]! * w01 +
        sdata[i11 + 2]! * w11;
      out[o + 3] = 255;
    }
  }

  return { data: out, width: outW, height: outH };
}
