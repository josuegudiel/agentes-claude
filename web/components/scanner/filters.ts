import { estimatePaper, paperRows } from './paper';

/**
 * Filtros tipo "scanner de movil" sobre un canvas 2D.
 *
 * Todos operan in-place sobre `ImageData`. El caller hace el getImageData /
 * putImageData; aqui solo manipulamos los pixeles. Esto nos deja componer
 * filtros sin pasar canvas para todos lados.
 *
 * La suite cubre tres usos:
 *   - Papeleria (magic, doc, grayscale, receipt, shadow, bw): el nucleo de
 *     las apps de escaneo comerciales — se estima el color del papel por
 *     zona y por canal (paper.ts) y se divide por el: sombras, caida de
 *     luz y dominante de color fuera; luego curva tonal con recorte a
 *     blanco que respeta el color de la tinta.
 *   - Fotos (photo, vivid): balance de blancos gray-world, estiramiento
 *     de luminancia por percentiles y curva S — sin los viros de color
 *     del clip por canal.
 *   - Generales (sharpen): enfoque unsharp de luminancia.
 */

export type FilterId =
  | 'original'
  | 'magic'
  | 'doc'
  | 'shadow'
  | 'receipt'
  | 'bw'
  | 'grayscale'
  | 'sharpen'
  | 'photo'
  | 'vivid';

export interface FilterMeta {
  id: FilterId;
  label: string;
  /** Descripcion corta para tooltip. */
  hint: string;
}

export const FILTERS: FilterMeta[] = [
  { id: 'original', label: 'Original', hint: 'Sin procesamiento' },
  { id: 'magic', label: 'Magico', hint: 'Escaneo automatico: papel parejo, tinta firme, colores intactos' },
  { id: 'doc', label: 'Documento', hint: 'Blanquea el papel y quita sombras; conserva sellos y firmas en color' },
  { id: 'shadow', label: 'Sin sombra', hint: 'Solo levanta sombras y empareja la luz — sin blanquear ni tocar colores' },
  { id: 'receipt', label: 'Factura', hint: 'Realza texto desvanecido de tickets, facturas y papel termico' },
  { id: 'bw', label: 'B&N', hint: 'Blanco y negro adaptativo (Sauvola) para maxima legibilidad' },
  { id: 'grayscale', label: 'Gris', hint: 'Escala de grises con contraste automatico' },
  { id: 'sharpen', label: 'Nitido', hint: 'Enfoca capturas levemente borrosas' },
  { id: 'photo', label: 'Foto', hint: 'Balance de blancos y contraste natural para fotografias' },
  { id: 'vivid', label: 'Vivido', hint: 'Colores intensos y contraste marcado' },
];

export function applyFilter(data: ImageData, filter: FilterId): ImageData {
  switch (filter) {
    case 'original':
      return data;
    case 'magic':
      return magicScan(data);
    case 'doc':
      return docEnhance(data);
    case 'shadow':
      return shadowLift(data);
    case 'receipt':
      return receiptEnhance(data);
    case 'bw':
      return sauvolaBw(data);
    case 'grayscale':
      return grayscaleContrast(data);
    case 'sharpen':
      return unsharp(data);
    case 'photo':
      return photoEnhance(data);
    case 'vivid':
      return vividBoost(data);
    default:
      return data;
  }
}

// ---------------------------------------------------------------------------
// Papeleria: nucleo de escaneo (normalizacion de papel + curva tonal)
// ---------------------------------------------------------------------------
//
// Mismo esqueleto que las apps comerciales (ver paper.ts):
//
//   1. Enfoque de luminancia ANTES de todo: enfocar despues del recorte a
//      blanco dibuja halos oscuros sobre el papel blanco puro.
//   2. Division por el color del papel local, POR CANAL: sombras, caida de
//      luz y dominante de color fuera en un paso. El papel queda en ~248
//      (con margen: el blanco puro lo pone la curva, suavemente).
//   3. Curva tonal en LUT: punto negro en el percentil de la tinta, punto
//      blanco en la MEDIANA del papel (la mitad del grano ya es blanco),
//      gamma que da "peso de tinta" y un hombro suave hacia el blanco.
//   4. Recorte a blanco que depende del COLOR: solo lo casi neutro y claro
//      se vuelve blanco puro. Resaltador, sellos, lapiz azul claro: nunca.
//   5. Saturacion leve (x1.1-1.2) de la tinta de color, escalada con la
//      luminancia (sin virar el tono).

interface ScanPreset {
  /** >1 da "peso" a la tinta (oscurece medios-bajos). */
  gamma: number;
  /** Desde donde (0..1 del rango) el papel rueda a blanco puro. */
  knee: number;
  /** Percentil del punto negro (0..1). */
  blackP: number;
  /** Tope del punto negro (no aplastar documentos sin tinta oscura). */
  blackCap: number;
  /** Refuerzo de croma de la tinta (1 = fiel). */
  chroma: number;
  /** Salida en escala de grises. */
  gray: boolean;
  /** Enfoque de luminancia previo (0 = off). */
  sharpen: number;
}

/** Nivel al que la division lleva el papel (margen bajo 255 para la curva). */
const PAPER_LEVEL = 248;
/** Ganancia maxima de la division: mas alla solo se amplifica ruido. */
const MAX_GAIN = 4;
const LUT_SCALE = 3; // LUT de 0..~340 en pasos de 1/3 de nivel
const LUT_SIZE = 1024;

function scannerCore(data: ImageData, o: ScanPreset): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;
  if (w < 16 || h < 16) {
    // Demasiado chica para estimar el papel: solo el modo de color.
    if (o.gray) {
      for (let i = 0; i < px.length; i += 4) {
        const v = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
      }
    }
    return data;
  }
  const n = w * h;

  // Luminancia (8 bits) y su version suavizada 3x3: la usan el enfoque y
  // la decision de "esto es papel blanco" (sobre la suavizada, el ruido
  // del sensor amplificado en las sombras no deja puntitos grises).
  const L = new Uint8Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    L[j] = (77 * px[i]! + 150 * px[i + 1]! + 29 * px[i + 2]! + 128) >> 8;
  }
  const Lb = box3u8(L, w, h);

  const map = estimatePaper(data);
  const rows = paperRows(w, map, MAX_GAIN);
  const PLV = PAPER_LEVEL;

  // --- Estadisticas sobre una muestra (1 de cada 3x3) ----------------------
  const hist = new Uint32Array(LUT_SIZE);
  let total = 0;
  const step = n > 400_000 ? 3 : 1;
  for (let y = 0; y < h; y += step) {
    rows.load(y);
    const IR = rows.ir, IG = rows.ig, IB = rows.ib;
    for (let x = 0, i = y * w * 4; x < w; x += step, i += 4 * step) {
      const yv = PLV * (0.299 * px[i]! * IR[x]! + 0.587 * px[i + 1]! * IG[x]! + 0.114 * px[i + 2]! * IB[x]!);
      const idx = (yv * LUT_SCALE + 0.5) | 0;
      hist[idx < LUT_SIZE ? idx : LUT_SIZE - 1]!++;
      total++;
    }
  }
  const pct = (p: number): number => {
    const target = total * p;
    let cum = 0;
    for (let v = 0; v < LUT_SIZE; v++) {
      cum += hist[v]!;
      if (cum >= target) return v / LUT_SCALE;
    }
    return 255;
  };
  const bp = Math.min(pct(o.blackP), o.blackCap);
  // Punto blanco: mediana de lo que es papel (cerca del nivel de papel).
  let wp = PAPER_LEVEL;
  {
    const lo = Math.round((PAPER_LEVEL - 40) * LUT_SCALE);
    let cnt = 0;
    for (let v = lo; v < LUT_SIZE; v++) cnt += hist[v]!;
    let cum = 0;
    for (let v = lo; v < LUT_SIZE; v++) {
      cum += hist[v]!;
      if (cum >= cnt / 2) {
        wp = v / LUT_SCALE;
        break;
      }
    }
  }
  wp = clampRange(wp, 200, 252);
  const range = Math.max(40, wp - bp);

  // --- LUT de la curva -----------------------------------------------------
  const lut = new Float32Array(LUT_SIZE);
  for (let v = 0; v < LUT_SIZE; v++) {
    let t = (v / LUT_SCALE - bp) / range;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const base = Math.pow(t, o.gamma);
    let k = (t - o.knee) / (1 - o.knee);
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const roll = k * k * (3 - 2 * k);
    lut[v] = 255 * (base + (1 - base) * roll);
  }
  const whiteLo = wp - 30;
  const amount = o.sharpen;
  const [pr0, pg0, pb0] = map.paper;
  const paperLum = 0.299 * pr0 + 0.587 * pg0 + 0.114 * pb0;

  // --- Pasada unica a resolucion completa ----------------------------------
  // (px es Uint8ClampedArray: la asignacion ya recorta a 0..255 y redondea.)
  const gray = o.gray;
  const chroma = o.chroma;
  for (let y = 0; y < h; y++) {
    rows.load(y);
    const IR = rows.ir, IG = rows.ig, IB = rows.ib, IL = rows.il, CT = rows.ct;
    for (let x = 0, j = y * w, i = j * 4; x < w; x++, j++, i += 4) {
      // 1. Enfoque (unsharp de luminancia con umbral) como ganancia.
      const l = L[j]!;
      let sg = PLV;
      if (amount > 0 && l > 0) {
        const d = l - Lb[j]!;
        if (d > 3 || d < -3) {
          let q = (l + amount * d) / l;
          q = q < 0 ? 0 : q > 3 ? 3 : q;
          sg = PLV * q;
        }
      }
      // 2. Division por el papel local, por canal.
      const nr = px[i]! * sg * IR[x]!;
      const ng = px[i + 1]! * sg * IG[x]!;
      const nb = px[i + 2]! * sg * IB[x]!;
      const yv = 0.299 * nr + 0.587 * ng + 0.114 * nb;
      // 3. Curva tonal. En contenido (fotos, recuadros) la curva nunca deja
      // el pixel mas oscuro que el original: la curva es para tinta sobre
      // papel, no para aplastar una foto oscura.
      const idx = (yv * LUT_SCALE + 0.5) | 0;
      let t = lut[idx < LUT_SIZE ? idx : LUT_SIZE - 1]!;
      const cw = CT[x]!;
      if (cw > 0.01 && t < l) t += (l - t) * cw;
      // 4. Recorte a blanco segun claridad (sobre la luminancia suavizada:
      // inmune al ruido) y color (lo que tiene color nunca se blanquea).
      const ys = Lb[j]! * PLV * IL[x]!;
      const yw = ys > yv ? ys : yv;
      if (gray) {
        let wg = (yw - whiteLo) / 30;
        wg = wg < 0 ? 0 : wg > 1 ? 1 : wg;
        const v = t + (255 - t) * wg * wg * (3 - 2 * wg);
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        continue;
      }
      if (yw <= whiteLo) {
        // Tinta / zona oscura: solo color.
        let ratio = t / (yv > 1 ? yv : 1);
        ratio = ratio < 0.35 ? 0.35 : ratio > 1.4 ? 1.4 : ratio;
        const k = chroma * (0.45 + 0.55 * ratio);
        px[i] = t + (nr - yv) * k;
        px[i + 1] = t + (ng - yv) * k;
        px[i + 2] = t + (nb - yv) * k;
        continue;
      }
      const mx = nr > ng ? (nr > nb ? nr : nb) : ng > nb ? ng : nb;
      const mn = nr < ng ? (nr < nb ? nr : nb) : ng < nb ? ng : nb;
      let wy = (yw - whiteLo) / 30;
      wy = wy > 1 ? 1 : wy;
      // El ruido de color crece con la ganancia (sombra levantada): el
      // umbral de "esto tiene color" crece con ella.
      const gainHere = IL[x]! * paperLum;
      let wc = (mx - mn - 14 - 10 * gainHere) / 25;
      wc = wc < 0 ? 0 : wc > 1 ? 1 : wc;
      const white = wy * wy * (3 - 2 * wy) * (1 - wc * wc * (3 - 2 * wc));
      if (white >= 0.999) {
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        continue;
      }
      // 5. Color de la tinta: la desviacion respecto del gris, escalada con
      // el cambio de luminancia (sin virar el tono) y un refuerzo leve.
      let ratio = t / (yv > 1 ? yv : 1);
      ratio = ratio < 0.35 ? 0.35 : ratio > 1.4 ? 1.4 : ratio;
      const k = chroma * (0.45 + 0.55 * ratio) * (1 - white);
      const base = t + (255 - t) * white;
      px[i] = base + (nr - yv) * k;
      px[i + 1] = base + (ng - yv) * k;
      px[i + 2] = base + (nb - yv) * k;
    }
  }
  cleanBorders(data);
  return data;
}

/** Box blur 3x3 sobre luminancia de 8 bits (bordes replicados). */
function box3u8(src: Uint8Array, w: number, h: number): Uint8Array {
  const tmp = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = src[row + (x > 0 ? x - 1 : 0)]!;
      const c = src[row + (x + 1 < w ? x + 1 : x)]!;
      tmp[row + x] = a + src[row + x]! + c;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const dn = (y + 1 < h ? y + 1 : y) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = (tmp[up + x]! + tmp[row + x]! + tmp[dn + x]! + 4) / 9;
    }
  }
  return out;
}

/**
 * "Magico": escaneo automatico — papel blanco parejo, tinta firme,
 * colores fieles. El modo por defecto.
 */
function magicScan(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.2,
    knee: 0.82,
    blackP: 0.015,
    blackCap: 60,
    chroma: 1.12,
    gray: false,
    sharpen: 0.55,
  });
}

/**
 * "Documento": como Magico pero con mas peso de tinta y colores mas
 * vivos — texto muy negro, sellos y firmas bien marcados.
 */
function docEnhance(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.45,
    knee: 0.78,
    blackP: 0.02,
    blackCap: 70,
    chroma: 1.25,
    gray: false,
    sharpen: 0.7,
  });
}

/**
 * "Gris": escaneo en escala de grises (modo grayscale de un escaner).
 */
function grayscaleContrast(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.25,
    knee: 0.82,
    blackP: 0.015,
    blackCap: 60,
    chroma: 1,
    gray: true,
    sharpen: 0.55,
  });
}

/**
 * "Factura": tickets termicos y texto desvanecido — gris con gamma fuerte
 * y punto negro alto, que vuelve legible la tinta palida.
 */
function receiptEnhance(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.8,
    knee: 0.76,
    blackP: 0.05,
    blackCap: 140,
    chroma: 1,
    gray: true,
    sharpen: 0.8,
  });
}

/**
 * "Sin sombra": SOLO empareja la luz. Divide por el papel local y vuelve
 * a multiplicar por el color del papel en su zona mejor iluminada: la
 * sombra y la caida de luz desaparecen pero el papel conserva su tono y
 * no hay curva ni blanqueo.
 */
function shadowLift(data: ImageData): ImageData {
  const { width: w, height: h } = data;
  if (w < 16 || h < 16) return data;
  const px = data.data;
  const map = estimatePaper(data);
  const rows = paperRows(w, map, MAX_GAIN);
  const [rr, rg, rb] = map.paper;
  for (let y = 0; y < h; y++) {
    rows.load(y);
    const IR = rows.ir, IG = rows.ig, IB = rows.ib;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      px[i] = px[i]! * rr * IR[x]!;
      px[i + 1] = px[i + 1]! * rg * IG[x]!;
      px[i + 2] = px[i + 2]! * rb * IB[x]!;
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Blanco y negro
// ---------------------------------------------------------------------------

/**
 * Blanco y negro de escaner: la calidad sale del ENTORNO del umbral, no
 * del umbral en si (con el fondo normalizado, incluso Otsu basta):
 *
 *   1. Normalizacion de papel (sombras fuera ANTES de umbralizar).
 *   2. Sauvola T = m*(1 + k*(s/R - 1)) con ventana del tamano de ~2
 *      lineas de texto (1/30 del ancho). Media y desvio se calculan a 1/4
 *      de resolucion e interpolan: 16x menos memoria y trabajo, y la
 *      superficie de umbral es suave por naturaleza.
 *   3. Luminancia mezclada con min(R,G,B): el rojo claro y el azul de
 *      lapicera no se pierden.
 *   4. Limpieza de motas: componentes negros diminutos (ruido, polvo) se
 *      borran; puntos de "i" y signos se conservan.
 *   5. Bordes suavizados (antialias de 1-2 niveles de gris), como el modo
 *      "antialiased" de los SDK comerciales: letras lisas, no dentadas.
 */
function sauvolaBw(data: ImageData): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;
  const n = w * h;
  const L = new Float32Array(n);

  if (w >= 16 && h >= 16) {
    const map = estimatePaper(data);
    const rows = paperRows(w, map, MAX_GAIN);
    for (let y = 0; y < h; y++) {
      rows.load(y);
      const IR = rows.ir, IG = rows.ig, IB = rows.ib;
      for (let x = 0, j = y * w, i = j * 4; x < w; x++, j++, i += 4) {
        const nr = px[i]! * 250 * IR[x]!;
        const ng = px[i + 1]! * 250 * IG[x]!;
        const nb = px[i + 2]! * 250 * IB[x]!;
        const yv = 0.299 * nr + 0.587 * ng + 0.114 * nb;
        const mn = nr < ng ? (nr < nb ? nr : nb) : ng < nb ? ng : nb;
        const v = 0.7 * yv + 0.3 * mn;
        L[j] = v > 255 ? 255 : v;
      }
    }
  } else {
    for (let j = 0, i = 0; j < n; j++, i += 4) {
      L[j] = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    }
  }

  // Estadisticas locales a 1/4 de resolucion (promedios de bloque de L y L^2).
  const f = w * h > 250_000 ? 4 : 1;
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const s1 = new Float32Array(sw * sh);
  const s2 = new Float32Array(sw * sh);
  const cnt = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const row = ((y / f) | 0) * sw;
    for (let x = 0, j = y * w; x < w; x++, j++) {
      const c = row + ((x / f) | 0);
      const v = L[j]!;
      s1[c] = s1[c]! + v;
      s2[c] = s2[c]! + v * v;
      cnt[c] = cnt[c]! + 1;
    }
  }
  for (let c = 0; c < s1.length; c++) {
    s1[c] = s1[c]! / cnt[c]!;
    s2[c] = s2[c]! / cnt[c]!;
  }
  const radius = Math.max(2, Math.round(Math.max(w, h) / 60 / f));
  const mean = boxBlurF32(s1, sw, sh, radius);
  const meanSq = boxBlurF32(s2, sw, sh, radius);
  // Umbral por celda.
  const K = 0.25;
  const R = 128;
  const thr = new Float32Array(sw * sh);
  for (let c = 0; c < thr.length; c++) {
    const m = mean[c]!;
    const sd = Math.sqrt(Math.max(0, meanSq[c]! - m * m));
    // Con el fondo ya normalizado (papel ~250) los niveles absolutos
    // significan algo: lo muy oscuro es tinta aunque la ventana entera sea
    // oscura (Sauvola "vacia" el interior de bloques/titulos anchos) y lo
    // muy claro es papel aunque la ventana sea clara (resaltador).
    const tv = m * (1 + K * (sd / R - 1));
    thr[c] = tv < 110 ? 110 : tv > 200 ? 200 : tv;
  }

  // Decision dura (para la limpieza de motas) + valor suavizado.
  const ink = new Uint8Array(n);
  const out = new Uint8ClampedArray(n);
  const SOFT = 7; // semiancho de la rampa de antialias, en niveles
  for (let y = 0; y < h; y++) {
    let gy = (y + 0.5) / f - 0.5;
    gy = gy < 0 ? 0 : gy > sh - 1 ? sh - 1 : gy;
    const y0 = Math.floor(gy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = gy - y0;
    for (let x = 0, j = y * w; x < w; x++, j++) {
      let gx = (x + 0.5) / f - 0.5;
      gx = gx < 0 ? 0 : gx > sw - 1 ? sw - 1 : gx;
      const x0 = Math.floor(gx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = gx - x0;
      const a = thr[y0 * sw + x0]! + (thr[y0 * sw + x1]! - thr[y0 * sw + x0]!) * tx;
      const b = thr[y1 * sw + x0]! + (thr[y1 * sw + x1]! - thr[y1 * sw + x0]!) * tx;
      const t = a + (b - a) * ty;
      const d = L[j]! - t;
      if (d < 0) ink[j] = 1;
      const v = 128 + (d * 128) / SOFT;
      out[j] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  // Motas: componentes de tinta con area menor que ~1/3 de un punto.
  // Umbral bajo a proposito: el punto de una "i" a 300 dpi ocupa ~20-30
  // px y NO debe caer (con 2.5x se borraban: "Instalacıon"). El ruido que
  // sobrevive a la normalizacion es de 1-6 px.
  const minArea = Math.max(3, Math.round(((Math.max(w, h) / 1000) ** 2) * 0.6));
  if (w * h > 40_000) removeSpecks(ink, out, w, h, minArea);

  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const v = out[j]!;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  cleanBorders(data);
  return data;
}

/**
 * Limpieza de bordes: si el recorte quedo 1-2 px por fuera de la hoja, la
 * mesa aparece como un filo oscuro pegado al borde. Por cada fila/columna
 * se recorre desde el borde hacia adentro: una corrida oscura que NACE en
 * el borde y termina antes del 1.2% del lado se pinta de blanco. El texto
 * nunca toca el borde (margenes), asi que no se ve afectado.
 */
function cleanBorders(data: ImageData): void {
  const { width: w, height: h } = data;
  const px = data.data;
  const dark = (i: number): boolean => 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]! < 170;
  const paint = (i: number): void => {
    px[i] = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
  };
  const maxX = Math.max(2, Math.round(w * 0.012));
  const maxY = Math.max(2, Math.round(h * 0.012));
  const sweep = (count: number, maxDepth: number, idx: (line: number, d: number) => number): void => {
    for (let line = 0; line < count; line++) {
      let d = 0;
      while (d < maxDepth && dark(idx(line, d))) d++;
      if (d > 0 && d < maxDepth) for (let k = 0; k < d; k++) paint(idx(line, k));
    }
  };
  sweep(h, maxX, (y, d) => (y * w + d) * 4); // izquierda
  sweep(h, maxX, (y, d) => (y * w + (w - 1 - d)) * 4); // derecha
  sweep(w, maxY, (x, d) => (d * w + x) * 4); // arriba
  sweep(w, maxY, (x, d) => ((h - 1 - d) * w + x) * 4); // abajo
}

/**
 * Borra componentes conexos (8-vecinos) de tinta con area < minArea.
 * Cada componente se recorre ENTERO (pila iterativa) para marcarlo como
 * visto — cortar la exploracion a medias haria que un trozo de una letra
 * grande pareciera una mota y se borrara. Costo lineal en pixeles.
 */
function removeSpecks(
  ink: Uint8Array,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  minArea: number,
): void {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const comp = new Int32Array(minArea);
  for (let s = 0; s < ink.length; s++) {
    if (!ink[s] || seen[s]) continue;
    let cn = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (cn < minArea) comp[cn] = p;
      cn++;
      const x = p % w;
      const row = p - x;
      for (let dy = -w; dy <= w; dy += w) {
        const yy = row + dy;
        if (yy < 0 || yy >= ink.length) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy + xx;
          if (ink[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (cn < minArea) {
      for (let k = 0; k < cn; k++) out[comp[k]!] = 255;
    }
  }
  void h;
}

// ---------------------------------------------------------------------------
// Generales
// ---------------------------------------------------------------------------

/**
 * "Nitido": enfoque unsharp-mask sobre LUMINANCIA (no por canal — el
 * enfoque por canal genera franjas de color en los bordes). El umbral
 * evita amplificar ruido del sensor en zonas planas.
 */
function unsharp(data: ImageData): ImageData {
  unsharpLuma(data, 1.1, 3);
  return data;
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

/**
 * "Foto": auto-mejora natural para fotografias. Balance de blancos
 * gray-world (corrige dominantes de color de la luz), estiramiento de
 * LUMINANCIA por percentiles (sin virar tonos, a diferencia del clip por
 * canal), curva S suave y VIBRANCE — realza los colores apagados mas que
 * los ya saturados y protege los tonos de piel, como el ajuste homonimo
 * de Lightroom/Photoshop. Resultado con punch pero natural.
 */
function photoEnhance(data: ImageData): ImageData {
  const px = data.data;

  // 1. Gray-world: la media de cada canal deberia ser gris neutro.
  let mr = 0;
  let mg = 0;
  let mb = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    mr += px[i]!;
    mg += px[i + 1]!;
    mb += px[i + 2]!;
  }
  mr /= n;
  mg /= n;
  mb /= n;
  const grayAvg = (mr + mg + mb) / 3;
  const gainR = clampRange(grayAvg / Math.max(1, mr), 0.75, 1.35);
  const gainG = clampRange(grayAvg / Math.max(1, mg), 0.75, 1.35);
  const gainB = clampRange(grayAvg / Math.max(1, mb), 0.75, 1.35);

  for (let i = 0; i < px.length; i += 4) {
    px[i] = clamp255(px[i]! * gainR);
    px[i + 1] = clamp255(px[i + 1]! * gainG);
    px[i + 2] = clamp255(px[i + 2]! * gainB);
  }

  // 2. Estiramiento de luminancia (post-WB) + curva S + saturacion,
  // aplicados como ratio sobre la luma para no virar el color.
  const luma = lumaOf(data);
  const lo = percentileF32(luma, 0.005);
  const hi = percentileF32(luma, 0.995);
  const stretch = hi - lo >= 5;
  const scale = stretch ? 255 / (hi - lo) : 1;
  const SCURVE = 0.3;

  for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
    const l = Math.max(1, luma[j]!);
    let nl = stretch ? (l - lo) * scale : l;
    nl = nl < 0 ? 0 : nl > 255 ? 255 : nl;
    const xs = nl / 255;
    const smooth = 255 * xs * xs * (3 - 2 * xs);
    const target = nl + SCURVE * (smooth - nl);
    const ratio = target / l;

    const r = px[i]! * ratio;
    const g = px[i + 1]! * ratio;
    const b = px[i + 2]! * ratio;

    const [vr, vg, vb] = vibrancePixel(r, g, b, 0.45);
    px[i] = clamp255(vr);
    px[i + 1] = clamp255(vg);
    px[i + 2] = clamp255(vb);
  }
  return data;
}

/**
 * "Vivido": vibrance fuerte + curva S marcada sobre la luminancia. La
 * vibrance (a diferencia de la saturacion plana) empuja mas los colores
 * apagados y hace "aterrizaje suave" en los ya saturados — punch intenso
 * sin clipping de color ni pieles naranjas.
 */
function vividBoost(data: ImageData): ImageData {
  const px = data.data;
  const SCURVE = 0.55;

  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = vibrancePixel(px[i]!, px[i + 1]!, px[i + 2]!, 1.1);

    // Curva S sobre la luma, aplicada como ratio (no vira el tono).
    const ly = Math.max(1, 0.299 * r + 0.587 * g + 0.114 * b);
    const xs = Math.min(255, ly) / 255;
    const smooth = 255 * xs * xs * (3 - 2 * xs);
    const ratio = (ly + SCURVE * (smooth - ly)) / ly;

    px[i] = clamp255(r * ratio);
    px[i + 1] = clamp255(g * ratio);
    px[i + 2] = clamp255(b * ratio);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Primitivas de mejora (unsharp de luminancia, vibrance)
// ---------------------------------------------------------------------------

/**
 * Unsharp mask sobre LUMINANCIA aplicado como ratio a RGB: enfoca sin
 * generar franjas de color en los bordes (defecto tipico del unsharp por
 * canal). `threshold` ignora diferencias pequenas — no amplifica el
 * ruido del sensor en zonas planas.
 */
function unsharpLuma(data: ImageData, amount: number, threshold: number): void {
  const { width: w, height: h } = data;
  const px = data.data;
  const luma = lumaOf(data);
  const blurred = boxBlurF32(luma, w, h, 1);

  for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
    const l = luma[j]!;
    const diff = l - blurred[j]!;
    if (Math.abs(diff) <= threshold) continue;
    const ratio = (l + amount * diff) / Math.max(1, l);
    px[i] = clamp255(px[i]! * ratio);
    px[i + 1] = clamp255(px[i + 1]! * ratio);
    px[i + 2] = clamp255(px[i + 2]! * ratio);
  }
}

/**
 * Vibrance por pixel: boost de saturacion NO lineal — proporcional a lo
 * apagado que esta el color (los ya saturados casi no cambian, sin
 * clipping) y con proteccion de tonos de piel (r>g>b calidos reciben
 * menos de la mitad del boost).
 */
function vibrancePixel(
  r: number,
  g: number,
  b: number,
  amount: number,
): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx <= 1 ? 0 : (mx - mn) / mx;

  let boost = amount * (1 - sat);
  // Tonos de piel (calidos, r>g>b): boost reducido para no dejar caras
  // naranjas.
  if (r > g && g > b) boost *= 0.45;

  const f = 1 + boost;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [y + (r - y) * f, y + (g - y) * f, y + (b - y) * f];
}

// ---------------------------------------------------------------------------
// Utilidades compartidas
// ---------------------------------------------------------------------------

/** Luminancia BT.601 como Float32Array. */
function lumaOf(data: ImageData): Float32Array {
  const px = data.data;
  const out = new Float32Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    out[j] = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
  }
  return out;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Percentil p (0..1) de un histograma de 256 bins ya construido. */
function histPercentile(hist: Uint32Array, count: number, p: number): number {
  const target = count * p;
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v]!;
    if (cum >= target) return v;
  }
  return 255;
}

/** Percentil p (0..1) de un Float32Array via histograma entero 0..255. */
function percentileF32(values: Float32Array, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    hist[v < 0 ? 0 : v > 255 ? 255 : Math.round(v)]!++;
  }
  const target = values.length * p;
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v]!;
    if (cum >= target) return v;
  }
  return 255;
}

/**
 * Box blur separable sobre floats. Warmup explicito de (2r+1) muestras
 * clampeadas al borde y despues sliding window — mismos semantics que la
 * version u8 historica (input constante -> output constante).
 */
function boxBlurF32(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const window = 2 * r + 1;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      sum += src[row + Math.min(w - 1, Math.max(0, k))]!;
    }
    tmp[row] = sum / window;
    for (let x = 1; x < w; x++) {
      sum += src[row + Math.min(w - 1, x + r)]!;
      sum -= src[row + Math.max(0, x - r - 1)]!;
      tmp[row + x] = sum / window;
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    }
    dst[x] = sum / window;
    for (let y = 1; y < h; y++) {
      sum += tmp[Math.min(h - 1, y + r) * w + x]!;
      sum -= tmp[Math.max(0, y - r - 1) * w + x]!;
      dst[y * w + x] = sum / window;
    }
  }
  return dst;
}

/**
 * Version u8 del box blur (mantiene la API historica usada en tests).
 */
function boxBlurSeparable(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
): Uint8ClampedArray {
  const f = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) f[i] = src[i]!;
  const blurred = boxBlurF32(f, w, h, r);
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < out.length; i++) out[i] = blurred[i]!;
  return out;
}

// Exportado para tests unitarios — no usar fuera de este modulo.
export const __test = {
  boxBlurSeparable,
  boxBlurF32,
  unsharpLuma,
  vibrancePixel,
  removeSpecks,
};
