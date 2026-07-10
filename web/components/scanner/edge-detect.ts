import { isConvexQuad, type Quad } from './perspective';

/**
 * Deteccion automatica de los bordes del documento — el "auto-crop" de
 * CamScanner. Dada una imagen (ya reducida a ~256px por el caller),
 * devuelve el quad de las 4 esquinas del documento o null si no hay un
 * candidato confiable.
 *
 * Estrategia (sin OpenCV, puro TS, testeable en node):
 *
 *   1. Grises + blur 3x3 + gradiente Sobel (magnitud Y direccion).
 *   2. Mapa de bordes binario con umbral adaptativo.
 *   3. PRIMARIO — Hough dirigido por gradiente: cada pixel de borde vota
 *      solo por lineas cuya normal coincide con su direccion de
 *      gradiente (+-6 grados). Los bordes del documento son las lineas
 *      LARGAS mas votadas; un blob puntual o una mano en el encuadre no
 *      acumulan votos de linea y quedan fuera — esto es lo que hace al
 *      detector robusto donde el metodo de extremos era torpe.
 *   4. Los picos de Hough se agrupan en dos familias de orientacion
 *      (~perpendiculares); si falta un borde (documento cortado por el
 *      encuadre) se agregan los bordes de la imagen como candidatos
 *      debiles. Se enumeran pares de cada familia, se intersectan y el
 *      quad valido con mejor puntaje gana.
 *   5. FALLBACK — extremos diagonales (min x+y, max x-y, ...) si Hough
 *      no encuentra un quad valido.
 *   6. Validacion geometrica comun: convexidad + area 8%..98%.
 *
 * Es una heuristica de "sugerencia": el usuario siempre puede ajustar las
 * esquinas a mano despues. Si la deteccion no es confiable devolvemos
 * null y el editor mantiene el quad por defecto.
 */

/** Lado maximo recomendado de la imagen de entrada. Mas grande funciona
 * pero es O(n) en pixeles y no mejora la deteccion. */
export const DETECT_MAX_SIDE = 256;

interface EdgeData {
  w: number;
  h: number;
  /** Mapa binario de bordes (1 = borde). */
  edge: Uint8Array;
  /** Direccion del gradiente (radianes, [-PI, PI)) por pixel de borde. */
  angle: Float32Array;
  edgeCount: number;
}

export function detectDocumentQuad(img: ImageData): Quad | null {
  const w = img.width;
  const h = img.height;
  if (w < 16 || h < 16) return null;

  const edges = extractEdges(img);
  if (!edges) return null;

  // Muy pocos pixeles de borde: no hay estructura suficiente.
  if (edges.edgeCount < Math.max(24, (w + h) / 8)) return null;

  const byLines = detectByHoughLines(edges);
  if (byLines) return byLines;

  return detectByExtremes(edges);
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

// ---------------------------------------------------------------------------
// Preprocesamiento: grises -> blur -> Sobel -> umbral -> limpieza
// ---------------------------------------------------------------------------

function extractEdges(img: ImageData): EdgeData | null {
  const w = img.width;
  const h = img.height;
  const px = img.data;

  // 1. Grises.
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    gray[j] = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
  }

  // Blur 3x3 barato (media) para matar ruido de un pixel.
  const blurred = blur3x3(gray, w, h);

  // 2. Sobel: magnitud + direccion del gradiente.
  const mag = new Float32Array(w * h);
  const angle = new Float32Array(w * h);
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
      angle[i] = Math.atan2(gy, gx);
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

  const raw = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) {
    if (mag[i]! >= threshold) raw[i] = 1;
  }

  // 4. Limpieza: descartar pixeles de borde aislados (tipico ruido).
  const edge = new Uint8Array(w * h);
  let edgeCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!raw[i]) continue;
      const neighbors =
        raw[i - w - 1]! + raw[i - w]! + raw[i - w + 1]! +
        raw[i - 1]! + raw[i + 1]! +
        raw[i + w - 1]! + raw[i + w]! + raw[i + w + 1]!;
      if (neighbors < 2) continue;
      edge[i] = 1;
      edgeCount++;
    }
  }

  return { w, h, edge, angle, edgeCount };
}

// ---------------------------------------------------------------------------
// Deteccion primaria: Hough de lineas dirigido por gradiente
// ---------------------------------------------------------------------------

interface HoughLine {
  /** Orientacion de la normal en grados [0, 180). */
  theta: number;
  /** Distancia con signo al origen: x*cos(theta) + y*sin(theta). */
  rho: number;
  votes: number;
}

const THETA_BINS = 180; // 1 grado por bin
const RHO_STEP = 2; // px por bin
const GRAD_TOLERANCE = 6; // +-grados de voto alrededor del gradiente

function detectByHoughLines(edges: EdgeData): Quad | null {
  const { w, h, edge, angle } = edges;
  const rhoMax = Math.ceil(Math.hypot(w, h));
  const rhoBins = Math.ceil((2 * rhoMax) / RHO_STEP) + 1;
  const acc = new Uint32Array(THETA_BINS * rhoBins);

  // Tablas de cos/sin por bin de theta.
  const cosT = new Float32Array(THETA_BINS);
  const sinT = new Float32Array(THETA_BINS);
  for (let t = 0; t < THETA_BINS; t++) {
    const rad = (t * Math.PI) / 180;
    cosT[t] = Math.cos(rad);
    sinT[t] = Math.sin(rad);
  }

  // Votacion dirigida: cada pixel de borde vota solo en la vecindad
  // angular de su gradiente. 13 bins por pixel en vez de 180 — 14x mas
  // rapido y picos mucho mas nitidos.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!edge[i]) continue;
      // Normal de la linea = direccion del gradiente, plegada a [0,180).
      let base = (angle[i]! * 180) / Math.PI;
      if (base < 0) base += 360;
      for (let d = -GRAD_TOLERANCE; d <= GRAD_TOLERANCE; d++) {
        let t = Math.round(base + d) % 360;
        if (t >= 180) t -= 180;
        // OJO: no hay que "compensar" el plegado con un cambio de signo
        // en rho — cos/sin del angulo YA plegado codifican el signo
        // correcto por si solos (cos(t-180) = -cos t hace el trabajo).
        const rho = x * cosT[t]! + y * sinT[t]!;
        const rIdx = Math.round((rho + rhoMax) / RHO_STEP);
        if (rIdx < 0 || rIdx >= rhoBins) continue;
        acc[t * rhoBins + rIdx]!++;
      }
    }
  }

  // Un borde de documento deberia abarcar una fraccion notable del lado
  // menor de la imagen.
  const minVotes = Math.max(12, Math.round(0.18 * Math.min(w, h)));

  const rawPeaks = extractPeaks(acc, rhoBins, rhoMax, minVotes, 16);
  if (rawPeaks.length < 2) return null;

  // Re-verificacion contra el mapa de bordes: el acumulador de Hough con
  // ventana angular +-6 permite "colusion" — pixeles de segmentos NO
  // relacionados (p.ej. un blob distractor + la punta de un borde real)
  // pueden sumar votos a una linea fantasma que no existe fisicamente.
  // El soporte real (pixeles de borde a <=2px de la linea con gradiente
  // compatible) desenmascara esas lineas: un blob de 8px nunca llega al
  // minimo. Sustituimos votes por el soporte medido.
  const peaks: HoughLine[] = [];
  for (const p of rawPeaks) {
    const support = lineSupport(edges, p);
    if (support >= minVotes) peaks.push({ ...p, votes: support });
  }
  peaks.sort((a, b) => b.votes - a.votes);
  if (peaks.length < 2) return null;

  // Familias de orientacion: A alrededor de la linea mas fuerte, B en la
  // banda ~perpendicular. Los documentos son cuadrilateros casi
  // rectangulares, asi que sus 4 bordes caen en estas dos familias.
  const ref = peaks[0]!;
  const famA: HoughLine[] = [];
  const famB: HoughLine[] = [];
  for (const p of peaks) {
    const d = orientDist(p.theta, ref.theta);
    if (d <= 28) famA.push(p);
    else if (d >= 62) famB.push(p);
  }

  // Documento cortado por el encuadre: agrega los bordes de la imagen
  // como candidatos debiles a la familia que corresponda.
  addImageBorders(famA, famB, ref.theta, w, h, minVotes);

  if (famA.length < 2 || famB.length < 2) return null;

  const minSep = 0.25 * Math.min(w, h);
  let best: { quad: Quad; score: number } | null = null;

  for (let i = 0; i < famA.length; i++) {
    for (let j = i + 1; j < famA.length; j++) {
      const a1 = famA[i]!;
      const a2 = alignTo(famA[i]!, famA[j]!);
      if (Math.abs(a1.rho - a2.rho) < minSep) continue;
      for (let k = 0; k < famB.length; k++) {
        for (let l = k + 1; l < famB.length; l++) {
          const b1 = famB[k]!;
          const b2 = alignTo(famB[k]!, famB[l]!);
          if (Math.abs(b1.rho - b2.rho) < minSep) continue;

          const c1 = intersect(a1, b1);
          const c2 = intersect(a1, b2);
          const c3 = intersect(a2, b2);
          const c4 = intersect(a2, b1);
          if (!c1 || !c2 || !c3 || !c4) continue;

          const quad = orderCorners([c1, c2, c3, c4], w, h);
          if (!quad) continue;

          const area = quadArea(quad);
          if (area < 0.08 || area > 0.98) continue;
          if (!isConvexQuad(quad, 5e-3)) continue;

          // Puntaje: fuerza de las 4 lineas, con leve preferencia por
          // quads mas grandes (el documento suele dominar el encuadre).
          const score =
            (a1.votes + a2.votes + b1.votes + b2.votes) * (0.5 + area);
          if (!best || score > best.score) best = { quad, score };
        }
      }
    }
  }

  return best?.quad ?? null;
}

/** Picos del acumulador con supresion de no-maximos en vecindad 5x5. */
function extractPeaks(
  acc: Uint32Array,
  rhoBins: number,
  rhoMax: number,
  minVotes: number,
  maxPeaks: number,
): HoughLine[] {
  const peaks: HoughLine[] = [];
  for (let t = 0; t < THETA_BINS; t++) {
    for (let r = 0; r < rhoBins; r++) {
      const v = acc[t * rhoBins + r]!;
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        // theta es circular modulo 180.
        const tt = (t + dt + THETA_BINS) % THETA_BINS;
        for (let dr = -2; dr <= 2; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rhoBins) continue;
          const nv = acc[tt * rhoBins + rr]!;
          if (nv > v || (nv === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      peaks.push({ theta: t, rho: r * RHO_STEP - rhoMax, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  return peaks.slice(0, maxPeaks);
}

/** Distancia angular entre orientaciones (modulo 180). */
function orientDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

/**
 * Soporte fisico de una linea: cuantos pixeles de borde estan a <=2px de
 * ella Y con direccion de gradiente compatible con su normal (+-10 deg).
 */
function lineSupport(edges: EdgeData, line: HoughLine): number {
  const { w, h, edge, angle } = edges;
  const rad = (line.theta * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let support = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!edge[i]) continue;
      if (Math.abs(x * cos + y * sin - line.rho) > 2) continue;
      let g = (angle[i]! * 180) / Math.PI;
      if (g < 0) g += 360;
      if (g >= 180) g -= 180;
      if (orientDist(g, line.theta) > 10) continue;
      support++;
    }
  }
  return support;
}

/**
 * Reexpresa `line` en la misma "rama" angular que `ref` para poder
 * comparar rhos: (theta, rho) y (theta-180, -rho) son la misma linea.
 */
function alignTo(ref: HoughLine, line: HoughLine): HoughLine {
  if (Math.abs(line.theta - ref.theta) <= 90) return line;
  const theta = line.theta > ref.theta ? line.theta - 180 : line.theta + 180;
  return { theta, rho: -line.rho, votes: line.votes };
}

/**
 * Si a una familia le falta su segundo borde (documento cortado por el
 * encuadre), agrega los bordes de la imagen con orientacion compatible
 * como candidatos debiles.
 */
function addImageBorders(
  famA: HoughLine[],
  famB: HoughLine[],
  refTheta: number,
  w: number,
  h: number,
  minVotes: number,
): void {
  const borders: HoughLine[] = [
    { theta: 0, rho: 0, votes: minVotes }, // x = 0 (izquierda)
    { theta: 0, rho: w - 1, votes: minVotes }, // x = w-1 (derecha)
    { theta: 90, rho: 0, votes: minVotes }, // y = 0 (arriba)
    { theta: 90, rho: h - 1, votes: minVotes }, // y = h-1 (abajo)
  ];
  for (const b of borders) {
    const d = orientDist(b.theta, refTheta);
    const fam = d <= 28 ? famA : d >= 62 ? famB : null;
    if (!fam || fam.length >= 2) continue;
    // No duplicar un borde ya detectado en posicion similar.
    const dup = fam.some(
      (l) => orientDist(l.theta, b.theta) <= 4 && Math.abs(alignTo(b, l).rho - b.rho) < 6,
    );
    if (!dup) fam.push(b);
  }
}

/** Interseccion de dos lineas en forma normal (theta grados, rho). */
function intersect(a: HoughLine, b: HoughLine): { x: number; y: number } | null {
  const t1 = (a.theta * Math.PI) / 180;
  const t2 = (b.theta * Math.PI) / 180;
  const det = Math.sin(t2 - t1);
  if (Math.abs(det) < 1e-6) return null;
  const x = (a.rho * Math.sin(t2) - b.rho * Math.sin(t1)) / det;
  const y = (b.rho * Math.cos(t1) - a.rho * Math.cos(t2)) / det;
  return { x, y };
}

/**
 * Ordena 4 esquinas como tl,tr,br,bl (horario en coords de pantalla),
 * valida que caigan dentro de la imagen (con 5% de tolerancia — las
 * intersecciones pueden salirse apenas cuando el borde coincide con el
 * limite del encuadre) y devuelve el quad normalizado y clampeado.
 */
function orderCorners(
  pts: { x: number; y: number }[],
  w: number,
  h: number,
): Quad | null {
  const margin = 0.05;
  for (const p of pts) {
    if (
      p.x < -margin * w || p.x > (1 + margin) * w ||
      p.y < -margin * h || p.y > (1 + margin) * h
    ) {
      return null;
    }
  }

  const cx = (pts[0]!.x + pts[1]!.x + pts[2]!.x + pts[3]!.x) / 4;
  const cy = (pts[0]!.y + pts[1]!.y + pts[2]!.y + pts[3]!.y) / 4;
  const sorted = [...pts].sort(
    (p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx),
  );
  // atan2 ascendente con y hacia abajo = orden horario en pantalla.
  // Rotar para que la primera sea la esquina superior-izquierda.
  let tlIdx = 0;
  let bestSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = sorted[i]!.x + sorted[i]!.y;
    if (s < bestSum) {
      bestSum = s;
      tlIdx = i;
    }
  }
  const ordered = [0, 1, 2, 3].map((i) => sorted[(tlIdx + i) % 4]!);

  const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
  return [
    { x: clamp01(ordered[0]!.x / w), y: clamp01(ordered[0]!.y / h) },
    { x: clamp01(ordered[1]!.x / w), y: clamp01(ordered[1]!.y / h) },
    { x: clamp01(ordered[2]!.x / w), y: clamp01(ordered[2]!.y / h) },
    { x: clamp01(ordered[3]!.x / w), y: clamp01(ordered[3]!.y / h) },
  ];
}

// ---------------------------------------------------------------------------
// Fallback: extremos diagonales (el metodo original)
// ---------------------------------------------------------------------------

function detectByExtremes(edges: EdgeData): Quad | null {
  const { w, h, edge } = edges;

  let tlScore = Infinity;
  let trScore = -Infinity;
  let brScore = -Infinity;
  let blScore = -Infinity;
  let tlP = { x: 0, y: 0 };
  let trP = { x: 0, y: 0 };
  let brP = { x: 0, y: 0 };
  let blP = { x: 0, y: 0 };

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!edge[y * w + x]) continue;
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

  const quad: Quad = [
    { x: tlP.x / w, y: tlP.y / h },
    { x: trP.x / w, y: trP.y / h },
    { x: brP.x / w, y: brP.y / h },
    { x: blP.x / w, y: blP.y / h },
  ];

  if (!isConvexQuad(quad, 5e-3)) return null;

  const area = quadArea(quad);
  if (area < 0.08 || area > 0.99) return null;

  return quad;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

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
