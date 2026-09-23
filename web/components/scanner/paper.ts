/**
 * Normalizacion de papel: el paso que hace que un escaneo de app parezca
 * de escaner de cama plana.
 *
 * Es el nucleo comun que publicaron Microsoft (Office Lens / whiteboard,
 * Zhang & He) y que comparten las apps comerciales: estimar el COLOR DEL
 * PAPEL en cada zona de la foto, a baja resolucion y POR CANAL, y dividir
 * la imagen por el:
 *
 *     salida_c = entrada_c / papel_c(x, y) * 255
 *
 * Una sola division quita a la vez la sombra de la mano, la caida de luz
 * hacia los bordes y la dominante de color (luz calida, sombra azulada):
 * el papel queda blanco neutro y cada tinta conserva su color real
 * relativo al papel — exactamente lo que "ve" un escaner.
 *
 * Estimacion del mapa de papel (todo a ~512 px, barato):
 *   1. Reduccion por PROMEDIO de area (no muestreo: sin aliasing del texto).
 *   2. CIERRE morfologico por canal (max y luego min, separable): borra el
 *      texto y los trazos, y a diferencia de la dilatacion sola NO corre
 *      los bordes de la sombra (la dilatacion sola dejaba bandas).
 *   3. Zonas que no son papel (fotos, resaltador, logos/bloques oscuros)
 *      se detectan por cromaticidad distinta a la del papel u oscuridad
 *      extrema, y se RELLENAN desde el papel vecino (convolucion
 *      normalizada). Sin esto la division "aplanaba" las fotos a blanco.
 *   4. Suavizado leve para que no se vean los bloques.
 */

export interface PaperMap {
  /** Tamano de la grilla reducida. */
  sw: number;
  sh: number;
  /** Factor de reduccion (pixeles de la imagen por celda). */
  f: number;
  /** Color del papel por celda, por canal (0..255). */
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** Color global del papel (zona mejor iluminada). */
  paper: [number, number, number];
  /** 1 donde la celda NO es papel (foto, recuadro, logo) y su "papel" se
   * relleno desde el vecino; 0 donde es papel. Suavizado. */
  content: Float32Array;
}

/** Lado mayor de la grilla de estimacion. */
const GRID_TARGET = 512;

export function estimatePaper(data: ImageData, target: number = GRID_TARGET): PaperMap {
  const { width: w, height: h } = data;
  const px = data.data;
  const f = Math.max(1, Math.ceil(Math.max(w, h) / target));
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const n = sw * sh;

  // 1. Reduccion por promedio de area. Con celdas grandes (f >= 4) basta
  // promediar 1 de cada 2x2 pixeles: sigue siendo un promedio de >= 4
  // muestras por celda (sin aliasing del texto) a un cuarto del costo.
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const cnt = new Float32Array(n);
  const sub = f >= 4 ? 2 : 1;
  for (let y = 0; y < h; y += sub) {
    const row = ((y / f) | 0) * sw;
    const rowBase = y * w * 4;
    for (let cx = 0; cx < sw; cx++) {
      const xEnd = Math.min(w, (cx + 1) * f);
      let sr = 0, sg = 0, sb = 0, k = 0;
      for (let x = cx * f, i = rowBase + x * 4; x < xEnd; x += sub, i += 4 * sub) {
        sr += px[i]!;
        sg += px[i + 1]!;
        sb += px[i + 2]!;
        k++;
      }
      const c = row + cx;
      r[c] = r[c]! + sr;
      g[c] = g[c]! + sg;
      b[c] = b[c]! + sb;
      cnt[c] = cnt[c]! + k;
    }
  }
  for (let c = 0; c < n; c++) {
    const k = cnt[c]! > 0 ? 1 / cnt[c]! : 0;
    r[c] = r[c]! * k;
    g[c] = g[c]! * k;
    b[c] = b[c]! * k;
  }

  // 2. Cierre morfologico por canal. Radio ~ alto de una linea de texto
  // (1/48 del lado): mayor que las letras, mucho menor que una sombra.
  const rc = Math.max(2, Math.round(Math.max(sw, sh) / 48));
  closing(r, sw, sh, rc);
  closing(g, sw, sh, rc);
  closing(b, sw, sh, rc);

  // Color global del papel: promedio del 10% mas claro del mapa cerrado.
  const lum = new Float32Array(n);
  for (let c = 0; c < n; c++) lum[c] = 0.299 * r[c]! + 0.587 * g[c]! + 0.114 * b[c]!;
  const lTop = percentile(lum, 0.9);
  let pr = 0, pg = 0, pb = 0, pn = 0;
  for (let c = 0; c < n; c++) {
    if (lum[c]! >= lTop) {
      pr += r[c]!;
      pg += g[c]!;
      pb += b[c]!;
      pn++;
    }
  }
  const paper: [number, number, number] = pn
    ? [pr / pn, pg / pn, pb / pn]
    : [255, 255, 255];
  const pSum = paper[0] + paper[1] + paper[2] || 1;
  const pcr = paper[0] / pSum, pcg = paper[1] / pSum, pcb = paper[2] / pSum;
  const pLum = 0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2];

  // 3. Mascara de "esto es papel". La sombra conserva la cromaticidad del
  // papel (solo cambia la intensidad); fotos, resaltador y sellos grandes
  // no. Lo casi negro tampoco es papel (logos, bloques, bordes de mesa).
  const valid = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const s = r[c]! + g[c]! + b[c]!;
    if (s <= 1) continue;
    const d = Math.abs(r[c]! / s - pcr) + Math.abs(g[c]! / s - pcg) + Math.abs(b[c]! / s - pcb);
    if (d < 0.08 && lum[c]! > pLum * 0.22) valid[c] = 1;
  }
  // Ademas: regiones ENCERRADAS por bordes nitidos y mas oscuras que el
  // papel son contenido (fotos, recuadros grises, tablas rellenas), no
  // sombra. La sombra de una mano o del telefono tiene bordes difusos
  // (penumbra de decenas de celdas); una foto pegada tiene un borde recto
  // y marcado. Sin esto, el centro neutro de una foto se tomaba por papel
  // y la division lo "lavaba" a blanco.
  markEnclosedContent(lum, valid, sw, sh, pLum);
  // Erosion de la mascara: los pixeles de borde de una foto son mezcla.
  erodeMask(valid, sw, sh, 2);

  const content = new Float32Array(n);
  for (let c = 0; c < n; c++) content[c] = valid[c]! > 0 ? 0 : 1;

  // Relleno por convolucion normalizada a dos escalas; lo que siga sin
  // vecinos validos (documento casi sin papel visible) toma el papel global.
  let validCount = 0;
  for (let c = 0; c < n; c++) validCount += valid[c]!;
  if (validCount < n * 0.02) {
    r.fill(paper[0]);
    g.fill(paper[1]);
    b.fill(paper[2]);
  } else if (validCount < n) {
    fillInvalid(r, g, b, valid, sw, sh, paper);
  }

  // 4. Suavizado final (mata el escalonado de celdas y el ruido residual).
  const rs = Math.max(1, rc >> 2);
  smooth(r, sw, sh, rs);
  smooth(g, sw, sh, rs);
  smooth(b, sw, sh, rs);
  smooth(content, sw, sh, rs + 1);

  return { sw, sh, f, r, g, b, paper, content };
}

/**
 * Lector por filas del mapa de papel a resolucion completa: `load(y)`
 * llena, para cada x de la fila y, el RECIPROCO del color del papel
 * interpolado (bilineal entre centros de celda) por canal y de su
 * luminancia. Los bucles calientes multiplican en vez de dividir y no
 * hacen llamadas por pixel.
 *
 * `maxGain` acota la ganancia: el papel nunca se toma mas oscuro que
 * papelGlobal / maxGain (una zona negra no se amplifica sin limite).
 */
export interface PaperRows {
  ir: Float32Array;
  ig: Float32Array;
  ib: Float32Array;
  il: Float32Array;
  /** Peso de "contenido" (0 = papel, 1 = foto/recuadro) por pixel. */
  ct: Float32Array;
  load: (y: number) => void;
}

export function paperRows(width: number, map: PaperMap, maxGain: number): PaperRows {
  const w = width;
  const { sw, sh, f, r, g, b, paper, content } = map;
  // Reciprocos a nivel de CELDA (el mapa es suave: interpolar 1/v es
  // indistinguible de 1/interpolar v, y evita 4 divisiones por pixel).
  const fr = Math.max(4, paper[0] / maxGain);
  const fg = Math.max(4, paper[1] / maxGain);
  const fb = Math.max(4, paper[2] / maxGain);
  const fl = Math.max(4, (0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2]) / maxGain);
  const n = sw * sh;
  const gr = new Float32Array(n), gg = new Float32Array(n), gb = new Float32Array(n), gl = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const vr = r[c]!, vg = g[c]!, vb = b[c]!;
    const vl = 0.299 * vr + 0.587 * vg + 0.114 * vb;
    gr[c] = 1 / (vr > fr ? vr : fr);
    gg[c] = 1 / (vg > fg ? vg : fg);
    gb[c] = 1 / (vb > fb ? vb : fb);
    gl[c] = 1 / (vl > fl ? vl : fl);
  }
  // Tramos en X entre centros de celda: cada pixel es el anterior + paso.
  // Centro de la celda cx en coordenadas de pixel: (cx + 0.5) * f - 0.5.
  const cr = new Float32Array(sw), cg = new Float32Array(sw), cb = new Float32Array(sw), cl = new Float32Array(sw);
  const cc = new Float32Array(sw);
  const fillRow = (src: Float32Array, dst: Float32Array): void => {
    const c0 = 0.5 * f - 0.5;
    const first = Math.min(w, Math.max(0, Math.ceil(c0)));
    for (let x = 0; x < first; x++) dst[x] = src[0]!;
    for (let cx = 0; cx < sw - 1; cx++) {
      const xa = (cx + 0.5) * f - 0.5;
      const xs = Math.max(0, Math.ceil(xa));
      const xe = Math.min(w, Math.ceil(xa + f));
      const va = src[cx]!;
      const dv = (src[cx + 1]! - va) / f;
      let v = va + (xs - xa) * dv;
      for (let x = xs; x < xe; x++, v += dv) dst[x] = v;
    }
    const lastC = (sw - 0.5) * f - 0.5;
    for (let x = Math.max(0, Math.ceil(lastC)); x < w; x++) dst[x] = src[sw - 1]!;
  };
  const out: PaperRows = {
    ir: new Float32Array(w),
    ig: new Float32Array(w),
    ib: new Float32Array(w),
    il: new Float32Array(w),
    ct: new Float32Array(w),
    load(y: number): void {
      let gy = (y + 0.5) / f - 0.5;
      gy = gy < 0 ? 0 : gy > sh - 1 ? sh - 1 : gy;
      const y0 = Math.floor(gy);
      const y1 = Math.min(sh - 1, y0 + 1);
      const ty = gy - y0;
      const o0 = y0 * sw, o1 = y1 * sw;
      for (let x = 0; x < sw; x++) {
        cr[x] = gr[o0 + x]! + (gr[o1 + x]! - gr[o0 + x]!) * ty;
        cg[x] = gg[o0 + x]! + (gg[o1 + x]! - gg[o0 + x]!) * ty;
        cb[x] = gb[o0 + x]! + (gb[o1 + x]! - gb[o0 + x]!) * ty;
        cl[x] = gl[o0 + x]! + (gl[o1 + x]! - gl[o0 + x]!) * ty;
        cc[x] = content[o0 + x]! + (content[o1 + x]! - content[o0 + x]!) * ty;
      }
      fillRow(cr, out.ir);
      fillRow(cg, out.ig);
      fillRow(cb, out.ib);
      fillRow(cl, out.il);
      fillRow(cc, out.ct);
    },
  };
  return out;
}

// ---------------------------------------------------------------------------
// Morfologia y relleno sobre la grilla reducida
// ---------------------------------------------------------------------------

/**
 * Parte la grilla en regiones separadas por bordes NITIDOS (salto de
 * luminancia grande entre celdas vecinas, o celdas que ya no son papel
 * por color) y marca como no-papel toda region interior (que no toca el
 * borde) distinta de la principal y con luminancia mediana por debajo
 * del 80% del papel.
 */
function markEnclosedContent(
  lum: Float32Array,
  valid: Float32Array,
  w: number,
  h: number,
  pLum: number,
): void {
  const n = w * h;
  // Borde nitido: salto > 9% del papel entre celdas a distancia 1.
  const jump = pLum * 0.09;
  const edge = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const v = lum[c]!;
      // Las celdas que ya no son papel por color (foto, resaltador) son
      // barrera: una foto con un borde claro no debe "conectarse" con el
      // papel a traves de ese borde.
      if (
        valid[c] === 0 ||
        (x + 1 < w && Math.abs(lum[c + 1]! - v) > jump) ||
        (y + 1 < h && Math.abs(lum[c + w]! - v) > jump)
      ) {
        edge[c] = 1;
      }
    }
  }
  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const touches: boolean[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (edge[s] || label[s]! >= 0) continue;
    const id = sizes.length;
    let size = 0;
    let border = false;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const x = c % w;
      if (x === 0 || x === w - 1 || c < w || c >= n - w) border = true;
      for (let k = 0; k < 4; k++) {
        const q = k === 0 ? (x > 0 ? c - 1 : -1) : k === 1 ? (x + 1 < w ? c + 1 : -1) : k === 2 ? c - w : c + w;
        if (q < 0 || q >= n || edge[q] || label[q]! >= 0) continue;
        label[q] = id;
        stack.push(q);
      }
    }
    sizes.push(size);
    touches.push(border);
  }
  if (sizes.length <= 1) return;
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i]! > sizes[main]!) main = i;

  // Mediana aproximada de luminancia por region (histograma de 64 bins).
  const hist = new Uint32Array(sizes.length * 64);
  for (let c = 0; c < n; c++) {
    const id = label[c]!;
    if (id < 0) continue;
    hist[id * 64 + Math.min(63, (lum[c]! / 4) | 0)]!++;
  }
  const content = new Uint8Array(sizes.length);
  for (let id = 0; id < sizes.length; id++) {
    if (id === main) continue;
    let cum = 0;
    let med = 255;
    for (let k = 0; k < 64; k++) {
      cum += hist[id * 64 + k]!;
      if (cum >= sizes[id]! / 2) {
        med = k * 4 + 2;
        break;
      }
    }
    // Una zona oscura neutra que TOCA el borde de la hoja es sombra (la de
    // la mano o el telefono entra desde afuera, aunque sea de borde duro:
    // sol directo, flash). Encerrada en el interior es contenido.
    if (med < pLum * 0.8 && !touches[id]) content[id] = 1;
  }
  for (let c = 0; c < n; c++) {
    const id = label[c]!;
    // Las celdas de borde nitido tampoco son papel fiable.
    if (id < 0 || content[id]) valid[c] = 0;
  }
}

// ---------------------------------------------------------------------------

/** Cierre (dilatacion max + erosion min) separable, in-place. */
function closing(a: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(a.length);
  runFilter(a, tmp, w, h, r, true, true);
  runFilter(tmp, a, w, h, r, true, false);
  runFilter(a, tmp, w, h, r, false, true);
  runFilter(tmp, a, w, h, r, false, false);
}

/**
 * Max o min en ventana 1D de radio r (horizontal o vertical), con el
 * algoritmo de van Herk / Gil-Werman: O(1) por pixel sin importar el radio.
 * (Dos bucles separados para max y min: sin llamadas por elemento.)
 */
function runFilter(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  r: number,
  isMax: boolean,
  horizontal: boolean,
): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const k = 2 * r + 1;
  const padLen = len + 2 * r;
  const line = new Float32Array(padLen);
  const pre = new Float32Array(padLen);
  const suf = new Float32Array(padLen);
  const step = horizontal ? 1 : w;

  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    for (let p = 0; p < padLen; p++) {
      const q = p - r < 0 ? 0 : p - r >= len ? len - 1 : p - r;
      line[p] = src[base + q * step]!;
    }
    if (isMax) {
      for (let p = 0; p < padLen; p++) {
        const v = line[p]!;
        if (p % k === 0) pre[p] = v;
        else {
          const a = pre[p - 1]!;
          pre[p] = a > v ? a : v;
        }
      }
      for (let p = padLen - 1; p >= 0; p--) {
        const v = line[p]!;
        if (p === padLen - 1 || (p + 1) % k === 0) suf[p] = v;
        else {
          const a = suf[p + 1]!;
          suf[p] = a > v ? a : v;
        }
      }
      for (let q = 0; q < len; q++) {
        const a = suf[q]!, c = pre[q + 2 * r]!;
        dst[base + q * step] = a > c ? a : c;
      }
    } else {
      for (let p = 0; p < padLen; p++) {
        const v = line[p]!;
        if (p % k === 0) pre[p] = v;
        else {
          const a = pre[p - 1]!;
          pre[p] = a < v ? a : v;
        }
      }
      for (let p = padLen - 1; p >= 0; p--) {
        const v = line[p]!;
        if (p === padLen - 1 || (p + 1) % k === 0) suf[p] = v;
        else {
          const a = suf[p + 1]!;
          suf[p] = a < v ? a : v;
        }
      }
      for (let q = 0; q < len; q++) {
        const a = suf[q]!, c = pre[q + 2 * r]!;
        dst[base + q * step] = a < c ? a : c;
      }
    }
  }
}

function erodeMask(m: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(m.length);
  runFilter(m, tmp, w, h, r, false, true);
  runFilter(tmp, m, w, h, r, false, false);
}

/**
 * Rellena celdas invalidas con el promedio ponderado de las validas
 * cercanas (convolucion normalizada: blur(v*m)/blur(m)). Dos escalas: la
 * chica respeta la iluminacion local; la grande cubre huecos grandes.
 */
function fillInvalid(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  valid: Float32Array,
  w: number,
  h: number,
  paper: [number, number, number],
): void {
  const n = r.length;
  // Mezcla CONTINUA de dos escalas (sin costura): la chica manda cerca del
  // papel valido; la grande (con peso bajo) solo pesa donde la chica no
  // llega. Antes se elegia una u otra por umbral y quedaba un rectangulo
  // visible dentro de las fotos.
  const rs = Math.max(2, Math.round(Math.max(w, h) * 0.06));
  const rl = Math.max(4, Math.round(Math.max(w, h) * 0.25));
  const WL = 0.03;
  const mr = new Float32Array(n), mg = new Float32Array(n), mb = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const m = valid[c]!;
    mr[c] = r[c]! * m;
    mg[c] = g[c]! * m;
    mb[c] = b[c]! * m;
  }
  const dS = blur3(valid, w, h, rs), dL = blur3(valid, w, h, rl);
  const rS = blur3(mr, w, h, rs), rL = blur3(mr, w, h, rl);
  const gS = blur3(mg, w, h, rs), gL = blur3(mg, w, h, rl);
  const bS = blur3(mb, w, h, rs), bL = blur3(mb, w, h, rl);
  for (let c = 0; c < n; c++) {
    if (valid[c]! > 0) continue;
    const den = dS[c]! + WL * dL[c]!;
    if (den > 1e-4) {
      r[c] = (rS[c]! + WL * rL[c]!) / den;
      g[c] = (gS[c]! + WL * gL[c]!) / den;
      b[c] = (bS[c]! + WL * bL[c]!) / den;
    } else {
      r[c] = paper[0];
      g[c] = paper[1];
      b[c] = paper[2];
    }
  }
}

/** Aproximacion gaussiana: 3 pasadas de box blur. */
function blur3(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const rr = Math.max(1, Math.round(r / 1.7));
  let a = boxBlur(src, w, h, rr);
  a = boxBlur(a, w, h, rr);
  return boxBlur(a, w, h, rr);
}

function smooth(a: Float32Array, w: number, h: number, r: number): void {
  a.set(boxBlur(boxBlur(a, w, h, r), w, h, r));
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + (k < 0 ? 0 : k >= w ? w - 1 : k)]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s * inv;
      const add = x + r + 1, sub = x - r;
      s += src[row + (add >= w ? w - 1 : add)]! - src[row + (sub < 0 ? 0 : sub)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[(k < 0 ? 0 : k >= h ? h - 1 : k) * w + x]!;
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = s * inv;
      const add = y + r + 1, sub = y - r;
      s += tmp[(add >= h ? h - 1 : add) * w + x]! - tmp[(sub < 0 ? 0 : sub) * w + x]!;
    }
  }
  return dst;
}

function percentile(values: Float32Array, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    hist[v < 0 ? 0 : v > 255 ? 255 : v | 0]!++;
  }
  const target = values.length * p;
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v]!;
    if (cum >= target) return v;
  }
  return 255;
}

export const __test = { closing, runFilter, boxBlur };
