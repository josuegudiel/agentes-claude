import { closing } from './paper';
import { solveLinear } from './perspective';

/**
 * Enderezado por lineas de texto ("dewarp" basado en texto).
 *
 * La correccion de perspectiva con 4 esquinas supone que la hoja es un
 * plano. Una hoja real esta doblada, arrugada o curvada: los renglones
 * salen inclinados y combados aunque las esquinas esten bien. Las apps
 * comerciales lo resuelven con redes neuronales; la version clasica (la
 * de page_dewarp de Matt Zucker, simplificada) usa el propio texto como
 * regla: los renglones de un documento son RECTOS y HORIZONTALES, asi que
 * cualquier inclinacion o curva que tengan en la foto es deformacion.
 *
 *   1. A ~1200 px: se aplana el fondo y se marca la tinta.
 *   2. Se "untan" las letras en horizontal para que cada renglon sea una
 *      mancha alargada; se aceptan solo manchas anchas y finas (renglones,
 *      no tablas ni QR).
 *   3. Cada renglon da su linea central, ajustada con una cuadratica.
 *   4. Inclinacion global = mediana de las pendientes (rotacion).
 *   5. Lo que queda (la comba) se modela con una superficie suave de
 *      desplazamiento vertical D(x, y), cuadratica en x e y, ajustada por
 *      minimos cuadrados a todos los renglones.
 *   6. Se remapea la imagen a resolucion completa (bilineal).
 *
 * Salvaguardas: pocos renglones, inclinaciones absurdas o una comba
 * exagerada (= deteccion dudosa) -> no se toca nada o solo se rota.
 */

export interface StraightenResult {
  data: ImageData;
  /** Rotacion aplicada, en grados. */
  angle: number;
  /** Desplazamiento vertical maximo aplicado por la comba, en px. */
  maxShift: number;
  lines: number;
}

interface LineFit {
  /** Muestras de la linea central (coordenadas de la imagen reducida). */
  xs: number[];
  ys: number[];
  width: number;
  height: number;
}

const WORK_WIDTH = 1200;

/** Diagnostico opcional: por que se descarto (para depurar con fotos reales). */
export interface StraightenDebug {
  reason?: string;
  candidates?: number;
  lines?: number;
  angle?: number;
  maxShift?: number;
  /** Candidatos rechazados/aceptados: [x0, y0, ancho, alto, motivo]. */
  blobs?: [number, number, number, number, string][];
}

/**
 * Modelo de enderezado estimado sobre una imagen ("marco"): rotacion +
 * comba por renglon, en coordenadas de la version reducida del marco.
 */
export interface StraightenModel {
  frameW: number;
  frameH: number;
  /** marco -> reducida: x_reducida = x_marco / s. */
  s: number;
  cx: number;
  cy: number;
  sw: number;
  cos: number;
  sin: number;
  curves: { Y: number; r: Float32Array }[];
  angle: number;
  maxShift: number;
  lines: number;
}

/**
 * Enderezado completo de una imagen (estimacion + remapeo). El pipeline
 * usa estimateStraighten + straightenRowMapper para combinarlo con la
 * perspectiva en un solo remuestreo; esta funcion queda para usos sueltos
 * y tests.
 */
export function straightenText(src: ImageData, dbg: StraightenDebug = {}): StraightenResult | null {
  const m = estimateStraighten(src, dbg);
  if (!m) return null;
  const out = remap(src, straightenRowMapper(m, src.width, src.height));
  return { data: out, angle: m.angle, maxShift: m.maxShift, lines: m.lines };
}

export function estimateStraighten(src: ImageData, dbg: StraightenDebug = {}): StraightenModel | null {
  const { width: W, height: H } = src;
  if (W < 400 || H < 400) return null;

  // --- 1. Reduccion a gris + tinta ------------------------------------------
  const s = Math.max(1, W / WORK_WIDTH);
  const sw = Math.max(1, Math.round(W / s));
  const sh = Math.max(1, Math.round(H / s));
  const gray = downscaleGray(src, sw, sh);
  const bg = new Float32Array(gray);
  closing(bg, sw, sh, Math.max(3, Math.round(Math.max(sw, sh) / 60)));
  const ink = new Uint8Array(sw * sh);
  for (let i = 0; i < ink.length; i++) {
    if (gray[i]! < bg[i]! * 0.72) ink[i] = 1;
  }

  // --- 2. Untado horizontal + componentes ----------------------------------
  const gap = Math.max(4, Math.round(sw / 80));
  const smear = new Uint8Array(ink);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    let last = -1;
    for (let x = 0; x < sw; x++) {
      if (!ink[row + x]) continue;
      if (last >= 0 && x - last - 1 <= gap) for (let k = last + 1; k < x; k++) smear[row + k] = 1;
      last = x;
    }
  }
  const lines = findTextLines(smear, sw, sh, dbg);
  dbg.lines = lines.length;
  if (lines.length < 2) {
    dbg.reason = 'pocos renglones';
    return null;
  }

  // --- 3-4. Pendiente de cada renglon en el centro -> rotacion ---------------
  const cx = sw / 2, cy = sh / 2;
  const slopes: { v: number; w: number }[] = [];
  for (const ln of lines) {
    const q = fitQuadratic(ln.xs, ln.ys, cx);
    if (q) slopes.push({ v: q[1], w: ln.width });
  }
  if (slopes.length < 2) {
    dbg.reason = 'renglones sin ajuste valido';
    return null;
  }
  const theta = Math.atan(weightedMedian(slopes));
  dbg.angle = (theta * 180) / Math.PI;
  if (Math.abs(theta) > (8 * Math.PI) / 180) {
    dbg.reason = 'inclinacion absurda';
    return null;
  }
  const cos = Math.cos(theta), sin = Math.sin(theta);

  // --- 5. Comba residual en el marco rotado ----------------------------------
  // Cada renglon aporta su curva residual r_i(x') = y'_i(x') - Y_i (Y_i =
  // su altura en el centro). Entre renglones se interpola linealmente; por
  // encima del primero y debajo del ultimo, constante. Local y acotado: un
  // pie de pagina combado distinto del parrafo se corrige con su propia
  // curva, y en zonas sin texto no se inventa nada.
  const maxDev = sh * 0.03;
  const curves: { Y: number; r: Float32Array }[] = [];
  for (const ln of lines) {
    const xr: number[] = [], yr: number[] = [];
    for (let k = 0; k < ln.xs.length; k++) {
      const dx = ln.xs[k]! - cx, dy = ln.ys[k]! - cy;
      xr.push(cx + dx * cos + dy * sin);
      yr.push(cy - dx * sin + dy * cos);
    }
    const q = fitQuadratic(xr, yr, cx);
    if (!q) continue;
    let xmin = Infinity, xmax = -Infinity;
    for (const x of xr) {
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
    }
    const r = new Float32Array(sw);
    let dev = 0;
    for (let x = 0; x < sw; x++) {
      // Fuera del tramo medido, el valor del extremo (sin extrapolar la
      // parabola, que se dispara).
      const xc = x < xmin ? xmin : x > xmax ? xmax : x;
      const u = xc - cx;
      const v = q[1] * u + q[2] * u * u; // q[0] es Y_i: r = y' - Y_i
      r[x] = v;
      if (Math.abs(v) > dev) dev = Math.abs(v);
    }
    // Un renglon con una comba enorme es una deteccion dudosa.
    if (dev > maxDev) continue;
    curves.push({ Y: q[0], r });
  }
  curves.sort((a, b) => a.Y - b.Y);
  // Renglones casi a la misma altura (dos manchas del mismo renglon):
  // quedarse con uno para no crear saltos.
  const uniq: { Y: number; r: Float32Array }[] = [];
  for (const c of curves) {
    if (uniq.length && c.Y - uniq[uniq.length - 1]!.Y < sh * 0.008) continue;
    uniq.push(c);
  }

  // Limite de estiramiento: entre dos renglones vecinos la correccion no
  // puede variar mas del 10% de la distancia que los separa (si no, el
  // texto intermedio se estira o aplasta). Se propaga desde el renglon
  // mas ancho — el mas confiable — hacia arriba y hacia abajo.
  if (uniq.length >= 2) {
    let anchor = 0;
    let bestW = -1;
    uniq.forEach((c, i) => {
      let span = 0;
      for (let x = 1; x < sw; x++) if (c.r[x] !== c.r[x - 1]) span++;
      if (span > bestW) {
        bestW = span;
        anchor = i;
      }
    });
    const clampPair = (from: number, to: number): void => {
      const a = uniq[from]!, b = uniq[to]!;
      const lim = Math.abs(b.Y - a.Y) * 0.1;
      for (let x = 0; x < sw; x++) {
        const lo = a.r[x]! - lim, hi = a.r[x]! + lim;
        const v = b.r[x]!;
        b.r[x] = v < lo ? lo : v > hi ? hi : v;
      }
    };
    for (let i = anchor + 1; i < uniq.length; i++) clampPair(i - 1, i);
    for (let i = anchor - 1; i >= 0; i--) clampPair(i + 1, i);
  }

  let maxShift = 0;
  for (const c of uniq) for (let x = 0; x < sw; x++) maxShift = Math.max(maxShift, Math.abs(c.r[x]!));
  dbg.maxShift = maxShift * s;
  const useBow = uniq.length >= 2;
  if (!useBow) maxShift = 0;

  const angleDeg = (theta * 180) / Math.PI;
  // Nada que corregir (menos de ~0.15 grados y menos de 1.5 px de comba).
  if (Math.abs(angleDeg) < 0.15 && maxShift * s < 1.5) {
    dbg.reason = 'nada que corregir';
    return null;
  }

  return {
    frameW: W,
    frameH: H,
    s,
    cx,
    cy,
    sw,
    cos,
    sin,
    curves: useBow ? uniq : [],
    angle: angleDeg,
    maxShift: maxShift * s,
    lines: uniq.length,
  };
}

/**
 * Funcion por fila para una salida de OW x OH (misma proporcion que el
 * marco, cualquier resolucion): para cada X de la fila Y devuelve en
 * (mx, my) el punto de la salida SIN enderezar del que hay que tomar el
 * pixel. Se enchufa al warp de perspectiva: un solo remuestreo en total.
 */
export function straightenRowMapper(
  m: StraightenModel,
  OW: number,
  OH: number,
): (Y: number, mx: Float32Array, my: Float32Array) => void {
  // salida -> reducida
  const g = m.frameW / OW / m.s;
  const gy = m.frameH / OH / m.s;
  const { cx, cy, sw, cos, sin, curves } = m;
  const xi0 = new Int32Array(OW), xi1 = new Int32Array(OW), xt = new Float32Array(OW);
  for (let X = 0; X < OW; X++) {
    let v = X * g;
    v = v < 0 ? 0 : v > sw - 1 ? sw - 1 : v;
    xi0[X] = Math.floor(v);
    xi1[X] = Math.min(sw - 1, xi0[X]! + 1);
    xt[X] = v - xi0[X]!;
  }
  const rowD = new Float32Array(sw);
  let seg = 0;
  return (Y, mx, my) => {
    const yr = Y * gy;
    if (curves.length === 0) rowD.fill(0);
    else if (yr <= curves[0]!.Y) rowD.set(curves[0]!.r);
    else if (yr >= curves[curves.length - 1]!.Y) rowD.set(curves[curves.length - 1]!.r);
    else {
      while (seg < curves.length - 2 && curves[seg + 1]!.Y < yr) seg++;
      while (seg > 0 && curves[seg]!.Y > yr) seg--;
      const a = curves[seg]!, b = curves[seg + 1]!;
      const t = (yr - a.Y) / (b.Y - a.Y);
      for (let x = 0; x < sw; x++) rowD[x] = a.r[x]! + (b.r[x]! - a.r[x]!) * t;
    }
    const maxX = OW - 1, maxY = OH - 1;
    for (let X = 0; X < OW; X++) {
      const i0 = xi0[X]!;
      const d = rowD[i0]! + (rowD[xi1[X]!]! - rowD[i0]!) * xt[X]!;
      const dx = X * g - cx, dy = yr + d - cy;
      let sx = (cx + dx * cos - dy * sin) / g;
      let sy = (cy + dx * sin + dy * cos) / gy;
      sx = sx < 0 ? 0 : sx > maxX ? maxX : sx;
      sy = sy < 0 ? 0 : sy > maxY ? maxY : sy;
      mx[X] = sx;
      my[X] = sy;
    }
  };
}

// ---------------------------------------------------------------------------

function downscaleGray(src: ImageData, sw: number, sh: number): Float32Array {
  const { width: W, height: H, data } = src;
  const out = new Float32Array(sw * sh);
  const cnt = new Float32Array(sw * sh);
  const fx = sw / W, fy = sh / H;
  for (let y = 0; y < H; y++) {
    const row = Math.min(sh - 1, (y * fy) | 0) * sw;
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const c = row + Math.min(sw - 1, (x * fx) | 0);
      out[c] = out[c]! + 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      cnt[c] = cnt[c]! + 1;
    }
  }
  for (let c = 0; c < out.length; c++) out[c] = out[c]! / Math.max(1, cnt[c]!);
  return out;
}

/**
 * Componentes 4-conexos de la mascara untada; se quedan los que parecen
 * renglones (anchos, finos, bastante llenos) y se muestrea su linea
 * central (punto medio entre el pixel de tinta mas alto y el mas bajo de
 * cada columna).
 */
function findTextLines(mask: Uint8Array, w: number, h: number, dbg: StraightenDebug): LineFit[] {
  const label = new Int32Array(w * h).fill(-1);
  const out: LineFit[] = [];
  const stack: number[] = [];
  const maxH = Math.max(6, h * 0.05);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]! >= 0) continue;
    const id = s;
    let x0 = w, x1 = -1, y0 = h, y1 = -1, count = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && label[p - 1]! < 0) { label[p - 1] = id; stack.push(p - 1); }
      if (x + 1 < w && mask[p + 1] && label[p + 1]! < 0) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && mask[p - w] && label[p - w]! < 0) { label[p - w] = id; stack.push(p - w); }
      if (y + 1 < h && mask[p + w] && label[p + w]! < 0) { label[p + w] = id; stack.push(p + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw >= w * 0.15) dbg.candidates = (dbg.candidates ?? 0) + 1;
    // Renglon: al menos 25% del ancho, alto de una o dos lineas, alargado
    // y razonablemente lleno (una tabla o un QR no lo son).
    const why =
      bw < w * 0.25 ? 'angosto' : bh > maxH ? 'alto' : bw < bh * 8 ? 'poco alargado' : count < bw * bh * 0.25 ? 'vacio' : '';
    if (bw >= w * 0.15 && dbg.blobs) dbg.blobs.push([x0, y0, bw, bh, why || 'ok']);
    if (why) continue;
    const xs: number[] = [], ys: number[] = [];
    const step = Math.max(2, Math.round(bw / 60));
    for (let x = x0; x <= x1; x += step) {
      // Centro del PRIMER tramo de tinta desde arriba (de al menos 3 px):
      // si la mancha son dos renglones fundidos, sigue el de arriba en vez
      // de saltar a medio camino donde el de abajo es mas corto.
      let top = -1, bot = -1;
      for (let y = y0; y <= y1 + 1; y++) {
        const on = y <= y1 && label[y * w + x] === id;
        if (on) {
          if (top < 0) top = y;
          bot = y;
        } else if (top >= 0) {
          if (bot - top + 1 >= 3) break;
          top = -1;
          bot = -1;
        }
      }
      if (top >= 0 && bot - top + 1 >= 3) {
        xs.push(x);
        ys.push((top + bot) / 2);
      }
    }
    if (xs.length >= 8) out.push({ xs, ys, width: bw, height: bh });
  }
  // Dos renglones fundidos en una mancha dan una linea central falsa (a
  // medio camino): fuera todo lo mucho mas alto que un renglon tipico.
  if (out.length >= 3) {
    const hs = out.map((l) => l.height).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length / 2)]!;
    return out.filter((l) => l.height <= med * 1.6);
  }
  return out;
}

/**
 * Ajuste y = a + b*(x-xc) + c*(x-xc)^2 robusto (un reajuste sin atipicos).
 * Devuelve [a, b, c] o null si el ajuste es malo.
 */
function fitQuadratic(xs: number[], ys: number[], xc: number): [number, number, number] | null {
  const fit = (idx: number[]): number[] | null => {
    const A: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const b = [0, 0, 0];
    for (const k of idx) {
      const u = xs[k]! - xc;
      const v = [1, u, u * u];
      for (let i = 0; i < 3; i++) {
        b[i] = b[i]! + v[i]! * ys[k]!;
        for (let j = 0; j < 3; j++) A[i]![j] = A[i]![j]! + v[i]! * v[j]!;
      }
    }
    return solveLinear(A, b);
  };
  const all = xs.map((_, k) => k);
  let q = fit(all);
  if (!q) return null;
  const res = all.map((k) => Math.abs(ys[k]! - (q![0]! + q![1]! * (xs[k]! - xc) + q![2]! * (xs[k]! - xc) ** 2)));
  const sorted = [...res].sort((a, b) => a - b);
  const mad = sorted[Math.floor(sorted.length / 2)]! + 0.5;
  const keep = all.filter((k) => res[k]! <= mad * 3);
  if (keep.length < 6) return null;
  q = fit(keep);
  if (!q) return null;
  // Residuo final: un renglon mal detectado (dos lineas fundidas en
  // diagonal, un dibujo) no debe influir.
  let rss = 0;
  for (const k of keep) {
    const e = ys[k]! - (q[0]! + q[1]! * (xs[k]! - xc) + q[2]! * (xs[k]! - xc) ** 2);
    rss += e * e;
  }
  if (Math.sqrt(rss / keep.length) > 3) return null;
  return [q[0]!, q[1]!, q[2]!];
}

function weightedMedian(items: { v: number; w: number }[]): number {
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, it) => a + it.w, 0);
  let acc = 0;
  for (const it of s) {
    acc += it.w;
    if (acc >= total / 2) return it.v;
  }
  return s[s.length - 1]!.v;
}

/** Remapeo bilineal de una imagen con un mapeador por filas. */
function remap(src: ImageData, rowMap: (Y: number, mx: Float32Array, my: Float32Array) => void): ImageData {
  const { width: W, height: H, data } = src;
  const out = new ImageData(W, H);
  const o = out.data;
  const mx = new Float32Array(W), my = new Float32Array(W);
  for (let Y = 0; Y < H; Y++) {
    rowMap(Y, mx, my);
    for (let X = 0, oi = Y * W * 4; X < W; X++, oi += 4) {
      let sx = mx[X]!, sy = my[X]!;
      if (sx > W - 1.001) sx = W - 1.001;
      if (sy > H - 1.001) sy = H - 1.001;
      const x0 = sx | 0, y0 = sy | 0;
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      o[oi] = data[i00]! * w00 + data[i10]! * w10 + data[i01]! * w01 + data[i11]! * w11;
      o[oi + 1] = data[i00 + 1]! * w00 + data[i10 + 1]! * w10 + data[i01 + 1]! * w01 + data[i11 + 1]! * w11;
      o[oi + 2] = data[i00 + 2]! * w00 + data[i10 + 2]! * w10 + data[i01 + 2]! * w01 + data[i11 + 2]! * w11;
      o[oi + 3] = 255;
    }
  }
  return out;
}
