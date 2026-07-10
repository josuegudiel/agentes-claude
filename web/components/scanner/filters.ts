/**
 * Filtros tipo "scanner de movil" sobre un canvas 2D.
 *
 * Todos operan in-place sobre `ImageData`. El caller hace el getImageData /
 * putImageData; aqui solo manipulamos los pixeles. Esto nos deja componer
 * filtros sin pasar canvas para todos lados.
 *
 * La suite cubre tres usos:
 *   - Papeleria (doc, receipt, bw): correccion de iluminacion — se estima
 *     el "fondo" (el papel) con dilatacion + blur a escala reducida y se
 *     normaliza la imagen contra el; las sombras y la luz despareja
 *     desaparecen y el papel queda blanco.
 *   - Fotos (photo, vivid): balance de blancos gray-world, estiramiento
 *     de luminancia por percentiles y curva S — sin los viros de color
 *     del clip por canal.
 *   - Generales (magic, grayscale, sharpen): auto-mejora, grises con
 *     contraste y enfoque unsharp.
 */

export type FilterId =
  | 'original'
  | 'magic'
  | 'doc'
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
  { id: 'magic', label: 'Magico', hint: 'Auto-mejora general tipo escaner' },
  { id: 'doc', label: 'Documento', hint: 'Blanquea el papel y quita sombras; conserva sellos y firmas en color' },
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
// Papeleria
// ---------------------------------------------------------------------------

/**
 * "Documento": correccion de iluminacion (flat-field). Estima el fondo
 * (papel) con dilatacion + blur a escala reducida y divide la imagen por
 * el: las sombras y la luz despareja desaparecen, el papel queda blanco
 * uniforme y la tinta/sellos conservan su color. El filtro estrella para
 * papeleria fotografiada con el celular.
 */
function docEnhance(data: ImageData): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;

  const luma = lumaOf(data);
  const bg = estimateBackground(luma, w, h);

  for (let y = 0, i = 0, j = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4, j++) {
      const b = Math.max(30, bg.sample(x, y));
      // 245 y no 255: deja una pizca de textura de papel en vez de
      // clippear todo a blanco puro.
      const gain = Math.min(3, 245 / b);
      let r = px[i]! * gain;
      let g = px[i + 1]! * gain;
      let bch = px[i + 2]! * gain;
      // Oscurece levemente la tinta (medios-bajos) para ganar contraste.
      r = r < 160 ? r * 0.92 : r;
      g = g < 160 ? g * 0.92 : g;
      bch = bch < 160 ? bch * 0.92 : bch;
      px[i] = clamp255(r);
      px[i + 1] = clamp255(g);
      px[i + 2] = clamp255(bch);
    }
  }
  return data;
}

/**
 * "Factura": pensado para tickets termicos y facturas con texto gris
 * desvanecido. Grises + correccion de iluminacion + estiramiento por
 * percentiles + gamma que oscurece los medios: el texto apenas visible
 * se vuelve legible.
 */
function receiptEnhance(data: ImageData): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;

  const luma = lumaOf(data);
  const bg = estimateBackground(luma, w, h);

  // Normalizacion contra el fondo -> buffer de trabajo en gris.
  const norm = new Float32Array(w * h);
  for (let y = 0, j = 0; y < h; y++) {
    for (let x = 0; x < w; x++, j++) {
      const b = Math.max(30, bg.sample(x, y));
      norm[j] = Math.min(255, (luma[j]! * 245) / b);
    }
  }

  // Estiramiento: el percentil 5 (la tinta mas oscura presente) va a
  // negro y el 99 a blanco. El piso en 120 evita machacar imagenes que
  // no tienen tinta oscura de verdad.
  const lo = Math.min(percentileF32(norm, 0.05), 120);
  const hi = Math.max(percentileF32(norm, 0.99), lo + 30);
  const scale = 255 / (hi - lo);

  // Gamma 1.3 como LUT de 256 entradas: oscurece los medios (texto
  // desvanecido) sin tocar blancos ni negros, y sin pagar Math.pow por
  // pixel (2.7M llamadas a resolucion de camara).
  const gammaLut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    gammaLut[v] = 255 * Math.pow(v / 255, 1.3);
  }

  for (let j = 0, i = 0; j < norm.length; j++, i += 4) {
    let v = (norm[j]! - lo) * scale;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    const out = gammaLut[Math.round(v)]!;
    px[i] = out;
    px[i + 1] = out;
    px[i + 2] = out;
  }
  return data;
}

/**
 * Blanco y negro adaptativo con umbral de Sauvola: t = m*(1 + k*(s/R - 1))
 * donde m y s son media y desvio locales. A diferencia del umbral por
 * media simple, Sauvola usa el desvio local — en zonas planas (papel con
 * manchas suaves) el umbral baja y no aparece pimienta; en zonas de texto
 * el umbral sube y los trazos finos no se comen.
 */
function sauvolaBw(data: ImageData): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;

  const luma = lumaOf(data);
  const sq = new Float32Array(w * h);
  for (let j = 0; j < luma.length; j++) sq[j] = luma[j]! * luma[j]!;

  const radius = Math.max(8, Math.round(Math.min(w, h) * 0.04));
  const mean = boxBlurF32(luma, w, h, radius);
  const meanSq = boxBlurF32(sq, w, h, radius);

  const K = 0.2;
  const R = 128;
  for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
    const m = mean[j]!;
    const variance = Math.max(0, meanSq[j]! - m * m);
    const std = Math.sqrt(variance);
    const t = m * (1 + K * (std / R - 1));
    const v = luma[j]! < t ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Generales
// ---------------------------------------------------------------------------

/**
 * "Magic" scan: mejora automatica tipo CamScanner. Sube brillo en las zonas
 * claras (papel), oscurece tinta, recorta extremos del histograma. No es
 * tan agresivo como B&N — preserva sellos y firmas en color tenue.
 */
function magicScan(data: ImageData): ImageData {
  const px = data.data;

  // Auto-contraste por canal: clip al 1% y 99% del histograma.
  // Usamos un flag explicito (loSet) para distinguir "lo todavia no
  // asignado" de "lo asignado al valor 0" — sin esto, una imagen con
  // muchos pixeles puros en bin 0 hacia overwrite continuo de lo[c].
  const lo = [0, 0, 0];
  const hi = [255, 255, 255];
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let i = c; i < px.length; i += 4) hist[px[i]!]!++;
    const total = px.length / 4;
    let cum = 0;
    const loTarget = total * 0.01;
    const hiTarget = total * 0.99;
    let loSet = false;
    for (let v = 0; v < 256; v++) {
      cum += hist[v]!;
      if (!loSet && cum >= loTarget) {
        lo[c] = v;
        loSet = true;
      }
      if (cum >= hiTarget) {
        hi[c] = v;
        break;
      }
    }
  }

  const scale = [
    255 / Math.max(1, hi[0]! - lo[0]!),
    255 / Math.max(1, hi[1]! - lo[1]!),
    255 / Math.max(1, hi[2]! - lo[2]!),
  ];

  // Aplicamos el clip + un gamma 0.9 (oscurece levemente la tinta).
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = (px[i + c]! - lo[c]!) * scale[c]!;
      v = Math.max(0, Math.min(255, v));
      // Gamma sin Math.pow (caro): aproximacion lineal por tramos.
      v = v < 128 ? v * 0.92 : 255 - (255 - v) * 0.92;
      px[i + c] = v;
    }
  }
  return data;
}

/** Grises + estiramiento de contraste por percentiles sobre la luminancia. */
function grayscaleContrast(data: ImageData): ImageData {
  const px = data.data;
  const luma = lumaOf(data);

  const lo = percentileF32(luma, 0.01);
  const hi = percentileF32(luma, 0.99);
  // Imagen casi uniforme: no estirar (evita amplificar ruido).
  const stretch = hi - lo >= 5;
  const scale = stretch ? 255 / (hi - lo) : 1;

  for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
    let v = stretch ? (luma[j]! - lo) * scale : luma[j]!;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  return data;
}

/**
 * Enfoque unsharp-mask: out = v + amount * (v - blur3x3(v)). Recupera
 * capturas levemente borrosas (pulso, autofoco lento) sin halos gracias
 * al radio chico.
 */
function unsharp(data: ImageData): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;
  const src = new Uint8ClampedArray(px); // copia para leer el vecindario
  const AMOUNT = 0.9;

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w;
    const y1 = y * w;
    const y2 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      const i = (y1 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur =
          (src[(y0 + x0) * 4 + c]! + src[(y0 + x) * 4 + c]! + src[(y0 + x2) * 4 + c]! +
            src[(y1 + x0) * 4 + c]! + src[(y1 + x) * 4 + c]! + src[(y1 + x2) * 4 + c]! +
            src[(y2 + x0) * 4 + c]! + src[(y2 + x) * 4 + c]! + src[(y2 + x2) * 4 + c]!) / 9;
        const v = src[i + c]!;
        px[i + c] = clamp255(v + AMOUNT * (v - blur));
      }
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Fotos
// ---------------------------------------------------------------------------

/**
 * "Foto": auto-mejora natural para fotografias. Balance de blancos
 * gray-world (corrige dominantes de color de la luz), estiramiento de
 * LUMINANCIA por percentiles (sin virar tonos, a diferencia del clip por
 * canal de magic), curva S suave y +12% de saturacion.
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
  const SAT = 1.12;

  for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
    const l = Math.max(1, luma[j]!);
    let nl = stretch ? (l - lo) * scale : l;
    nl = nl < 0 ? 0 : nl > 255 ? 255 : nl;
    const xs = nl / 255;
    const smooth = 255 * xs * xs * (3 - 2 * xs);
    const target = nl + SCURVE * (smooth - nl);
    const ratio = target / l;

    let r = px[i]! * ratio;
    let g = px[i + 1]! * ratio;
    let b = px[i + 2]! * ratio;

    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * SAT;
    g = y + (g - y) * SAT;
    b = y + (b - y) * SAT;

    px[i] = clamp255(r);
    px[i + 1] = clamp255(g);
    px[i + 2] = clamp255(b);
  }
  return data;
}

/**
 * "Vivido": saturacion fuerte + curva S marcada sobre la luminancia.
 * Para fotos lavadas que necesitan punch (tickets a color, folletos).
 */
function vividBoost(data: ImageData): ImageData {
  const px = data.data;
  const SAT = 1.4;
  const SCURVE = 0.55;

  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]!;
    let g = px[i + 1]!;
    let b = px[i + 2]!;

    // Saturacion: alejar del gris (luma) preservando la luminancia.
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * SAT;
    g = y + (g - y) * SAT;
    b = y + (b - y) * SAT;

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
// Estimacion de fondo (papel) para los filtros de papeleria
// ---------------------------------------------------------------------------

interface Background {
  /** Muestra bilineal del fondo estimado en coordenadas de la imagen. */
  sample: (x: number, y: number) => number;
}

/**
 * Estima la iluminacion del papel: baja la luma a <=768px, elimina la
 * tinta con 2 pasadas de dilatacion (max local 3x3) y suaviza con box
 * blur grande. El fondo es baja frecuencia por definicion, asi que
 * calcularlo a escala reducida da el mismo resultado 16x mas barato.
 */
function estimateBackground(luma: Float32Array, w: number, h: number): Background {
  const scale = Math.min(1, 768 / Math.max(w, h));
  const dw = Math.max(8, Math.round(w * scale));
  const dh = Math.max(8, Math.round(h * scale));

  // Downsample por muestreo directo (el blur posterior promedia igual).
  // Anotacion explicita: dilate3x3 devuelve Float32Array<ArrayBufferLike>
  // y la inferencia del constructor (ArrayBuffer estricto) no lo acepta.
  let small: Float32Array = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(h - 1, Math.round((y * h) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.round((x * w) / dw));
      small[y * dw + x] = luma[sy * w + sx]!;
    }
  }

  // Dilatacion 3x3 x2: la tinta (fina y oscura) desaparece del estimado.
  small = dilate3x3(small, dw, dh);
  small = dilate3x3(small, dw, dh);

  const radius = Math.max(6, Math.round(Math.min(dw, dh) * 0.05));
  const bg = boxBlurF32(small, dw, dh, radius);

  const fx = dw / w;
  const fy = dh / h;
  return {
    sample(x: number, y: number): number {
      const gx = Math.min(dw - 1.001, Math.max(0, x * fx));
      const gy = Math.min(dh - 1.001, Math.max(0, y * fy));
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const i00 = bg[y0 * dw + x0]!;
      const i10 = bg[y0 * dw + x0 + 1]!;
      const i01 = bg[(y0 + 1) * dw + x0]!;
      const i11 = bg[(y0 + 1) * dw + x0 + 1]!;
      return (
        i00 * (1 - tx) * (1 - ty) +
        i10 * tx * (1 - ty) +
        i01 * (1 - tx) * ty +
        i11 * tx * ty
      );
    },
  };
}

function dilate3x3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1);
    const y2 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      let m = 0;
      for (let yy = y0; yy <= y2; yy++) {
        for (let xx = x0; xx <= x2; xx++) {
          const v = src[yy * w + xx]!;
          if (v > m) m = v;
        }
      }
      out[y * w + x] = m;
    }
  }
  return out;
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
export const __test = { boxBlurSeparable, boxBlurF32, estimateBackground, dilate3x3 };
