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
// Papeleria
// ---------------------------------------------------------------------------

/**
 * "Documento": escaneo de alto contraste — papel blanco puro, tinta
 * asentada, sellos y tintas de color reforzados. Preset fuerte del
 * nucleo profesional.
 */
function docEnhance(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.3,
    knee: 0.8,
    blackP: 0.02,
    blackCap: 80,
    chroma: 1.4,
    gray: false,
    sharpen: 0.6,
  });
}

/**
 * "Sin sombra": SOLO correccion de iluminacion (modelo Lambertiano —
 * imagen / mapa de sombra = reflectancia). Levanta sombras y empareja la
 * luz sin blanquear, sin contraste extra y sin tocar los colores: para
 * cuando Documento resulta demasiado agresivo o para fotos de objetos
 * con sombras de la mano/telefono.
 */
function shadowLift(data: ImageData): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;

  const luma = lumaOf(data);
  if (w < 32 || h < 32) return data;
  const bg = estimateShading(luma, w, h);

  // Referencia: el papel mas claro de la imagen — normalizamos hacia el,
  // no hacia blanco absoluto, para conservar el tono original.
  let ref = 0;
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      const b = bg.sample(x, y);
      if (b > ref) ref = b;
    }
  }
  ref = Math.min(250, Math.max(120, ref));

  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const b = Math.max(40, bg.sample(x, y));
      const gain = Math.min(5, ref / b);
      px[i] = clamp255(px[i]! * gain);
      px[i + 1] = clamp255(px[i + 1]! * gain);
      px[i + 2] = clamp255(px[i + 2]! * gain);
    }
  }
  return data;
}

/**
 * "Factura": para tickets termicos y texto desvanecido — grises con
 * gamma fuerte que vuelve legible la tinta palida.
 */
function receiptEnhance(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.7,
    knee: 0.78,
    blackP: 0.05,
    blackCap: 150,
    chroma: 1,
    gray: true,
    sharpen: 0.7,
  });
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

  // Binarizar sobre la luma APLANADA: sombras e iluminacion despareja
  // fuera ANTES del umbral — como un scanner fisico en modo B/N.
  const raw = lumaOf(data);
  const luma = new Float32Array(w * h);
  if (w >= 32 && h >= 32) {
    const shade = estimateShading(raw, w, h);
    for (let y = 0, j = 0; y < h; y++) {
      for (let x = 0; x < w; x++, j++) {
        const s = Math.max(40, shade.sample(x, y));
        luma[j] = Math.min(255, (raw[j]! * 245) / s);
      }
    }
  } else {
    luma.set(raw);
  }
  const sq = new Float32Array(w * h);
  for (let j = 0; j < luma.length; j++) sq[j] = luma[j]! * luma[j]!;

  // Ventana grande (8% del lado menor): una ventana menor que el ancho de
  // un trazo grueso deja las letras "huecas".
  const radius = Math.max(12, Math.round(Math.min(w, h) * 0.08));
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
 * "Magico": escaneo automatico — papel blanco parejo, tinta firme,
 * colores preservados. Preset suave del nucleo profesional.
 */
function magicScan(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.08,
    knee: 0.86,
    blackP: 0.02,
    blackCap: 90,
    chroma: 1.15,
    gray: false,
    sharpen: 0.45,
  });
}

/**
 * Levantado de sombras suave: normaliza contra el mapa de iluminacion
 * con gain acotado. Usado como pre-pase de otros filtros.
 */
function softShadowLift(data: ImageData, maxGain: number): void {
  const { width: w, height: h } = data;
  const px = data.data;
  const luma = lumaOf(data);
  const bg = estimateBackground(luma, w, h);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const b = Math.max(40, bg.sample(x, y));
      const gain = Math.min(maxGain, 235 / b);
      if (gain <= 1) continue;
      px[i] = clamp255(px[i]! * gain);
      px[i + 1] = clamp255(px[i + 1]! * gain);
      px[i + 2] = clamp255(px[i + 2]! * gain);
    }
  }
}

/**
 * Estiramiento global de luminancia por percentiles, aplicado como ratio
 * a RGB (no vira el color). `minRange` evita amplificar ruido en
 * imagenes casi planas.
 */
function stretchLuma(data: ImageData, pLo: number, pHi: number, minRange: number): void {
  const px = data.data;
  const luma = lumaOf(data);
  const lo = percentileF32(luma, pLo);
  const hi = percentileF32(luma, pHi);
  if (hi - lo < minRange) return;
  const scale = 255 / (hi - lo);
  for (let j = 0, i = 0; j < luma.length; j++, i += 4) {
    const l = Math.max(1, luma[j]!);
    let nl = (l - lo) * scale;
    nl = nl < 0 ? 0 : nl > 255 ? 255 : nl;
    const ratio = nl / l;
    px[i] = clamp255(px[i]! * ratio);
    px[i + 1] = clamp255(px[i + 1]! * ratio);
    px[i + 2] = clamp255(px[i + 2]! * ratio);
  }
}

/**
 * "Gris": escaneo en escala de grises — mismo nucleo (aplanado + curva)
 * con salida gris. Como un scanner fisico en modo grayscale.
 */
function grayscaleContrast(data: ImageData): ImageData {
  return scannerCore(data, {
    gamma: 1.15,
    knee: 0.85,
    blackP: 0.02,
    blackCap: 90,
    chroma: 1,
    gray: true,
    sharpen: 0.4,
  });
}

/**
 * "Nitido": enfoque unsharp-mask sobre LUMINANCIA (no por canal — el
 * enfoque por canal genera franjas de color en los bordes). El umbral
 * evita amplificar ruido del sensor en zonas planas: solo se enfoca
 * donde la diferencia local supera el minimo.
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
// Nucleo profesional de escaneo (pipeline tipo Dropbox Scanner)
// ---------------------------------------------------------------------------
//
// Todos los filtros de papeleria comparten UN nucleo, como una app
// profesional o un scanner fisico:
//
//   1. Iluminacion por PERCENTIL POR BLOQUES: en cada bloque (~1/10 del
//      lado) el percentil 85 de luma es "el papel" de esa zona — robusto
//      a texto, logos y fotos (a diferencia de la dilatacion, que dejaba
//      halos alrededor de zonas oscuras grandes). Los bloques dominados
//      por tinta heredan el papel vecino (max 3x3) y la grilla se suaviza
//      e interpola bilinealmente.
//   2. Aplanado: luma / mapa de iluminacion — papel parejo, sombras
//      fuera, como el vidrio de un scanner.
//   3. CURVA TONAL SUAVE via LUT: punto negro = percentil de la tinta,
//      punto blanco = percentil del papel; gamma que asienta la tinta y
//      un "roll-off" suave que funde el papel a blanco puro. Sin ramas
//      por pixel: cero artefactos de posterizacion.
//   4. Croma uniforme: el color (sellos, tintas verdes/cafe, logos) se
//      preserva y refuerza parejo — nunca se blanquea.

interface ScanPreset {
  /** >1 asienta la tinta (oscurece medios-bajos). */
  gamma: number;
  /** Desde que punto (0..1) el papel rueda a blanco puro. */
  knee: number;
  /** Percentil del punto negro (0..1). */
  blackP: number;
  /** Tope del punto negro (no machacar imagenes sin tinta oscura). */
  blackCap: number;
  /** Refuerzo de croma (1 = sin cambio). */
  chroma: number;
  /** Salida en escala de grises. */
  gray: boolean;
  /** Enfoque de luminancia al final (0 = off). */
  sharpen: number;
}

function scannerCore(data: ImageData, o: ScanPreset): ImageData {
  const { width: w, height: h } = data;
  const px = data.data;
  const luma = lumaOf(data);

  // 1-2. Aplanado contra el mapa de iluminacion.
  const flat = new Float32Array(w * h);
  if (w >= 32 && h >= 32) {
    const shade = estimateShading(luma, w, h);
    for (let y = 0, j = 0; y < h; y++) {
      for (let x = 0; x < w; x++, j++) {
        const s = Math.max(40, shade.sample(x, y));
        const gain = Math.min(5, Math.max(0.5, 245 / s));
        flat[j] = Math.min(255, luma[j]! * gain);
      }
    }
  } else {
    flat.set(luma);
  }

  // 3. Puntos negro/blanco + LUT de curva tonal.
  const bp = Math.min(percentileF32(flat, o.blackP), o.blackCap);
  let wp = percentileF32(flat, 0.93);
  if (wp - bp < 60) wp = bp + 60;
  wp = Math.min(252, wp);

  // Imagen sin rango real (uniforme): identidad — nada que escanear.
  const uniform = percentileF32(flat, 0.95) - percentileF32(flat, 0.05) < 10;

  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    if (uniform) {
      lut[v] = v;
      continue;
    }
    let n = (v - bp) / (wp - bp);
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    const base = Math.pow(n, o.gamma);
    let k = (n - o.knee) / (1 - o.knee);
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const roll = k * k * (3 - 2 * k);
    lut[v] = 255 * (base + (1 - base) * roll);
  }

  // 4. Aplicar: ratio de luma a RGB + croma uniforme (o gris).
  for (let j = 0, i = 0; j < flat.length; j++, i += 4) {
    const target = lut[Math.min(255, Math.round(flat[j]!))]!;
    if (o.gray) {
      px[i] = target;
      px[i + 1] = target;
      px[i + 2] = target;
      continue;
    }
    const ratio = target / Math.max(1, luma[j]!);
    const r = px[i]! * ratio;
    const g = px[i + 1]! * ratio;
    const b = px[i + 2]! * ratio;
    px[i] = clamp255(target + (r - target) * o.chroma);
    px[i + 1] = clamp255(target + (g - target) * o.chroma);
    px[i + 2] = clamp255(target + (b - target) * o.chroma);
  }

  if (o.sharpen > 0) unsharpLuma(data, o.sharpen, 3);
  return data;
}

interface ShadingMap {
  sample: (x: number, y: number) => number;
}

/**
 * Mapa de iluminacion por percentil por bloques (el estimador robusto):
 * p85 de luma por bloque = papel local; max 3x3 en la grilla para que
 * los bloques dominados por tinta/fotos hereden el papel vecino;
 * suavizado y muestreo bilineal.
 */
function estimateShading(luma: Float32Array, w: number, h: number): ShadingMap {
  const bs = Math.max(16, Math.round(Math.min(w, h) / 10));
  const gx = Math.max(2, Math.ceil(w / bs));
  const gy = Math.max(2, Math.ceil(h / bs));

  const grid = new Float32Array(gx * gy);
  const hist = new Uint32Array(256);
  for (let by = 0; by < gy; by++) {
    for (let bx = 0; bx < gx; bx++) {
      hist.fill(0);
      const x0 = bx * bs;
      const y0 = by * bs;
      const x1 = Math.min(w, x0 + bs);
      const y1 = Math.min(h, y0 + bs);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[Math.min(255, Math.round(luma[y * w + x]!))]!++;
          count++;
        }
      }
      let v85 = 255;
      let cum = 0;
      const targetCount = count * 0.85;
      for (let v = 0; v < 256; v++) {
        cum += hist[v]!;
        if (cum >= targetCount) {
          v85 = v;
          break;
        }
      }
      grid[by * gx + bx] = v85;
    }
  }

  // NOTA: NO se hace "herencia" del papel vecino (max 3x3) — confunde
  // sombra con tinta: un bloque de papel EN SOMBRA heredaria el papel
  // iluminado del vecino, el gain se anularia y la curva tonal mandaria
  // la sombra a negro. El percentil 85 por bloque ya es robusto a texto
  // y tinta normal por si solo.

  // Sin suavizado explicito de la grilla: mezclaria bloques de sombra
  // con vecinos iluminados (sobre-estimando el papel en sombra). La
  // interpolacion BILINEAL entre centros de bloque ya da transiciones
  // continuas.
  let sm = grid;
  for (let pass = 0; pass < 0; pass++) {
    const next = new Float32Array(gx * gy);
    for (let by = 0; by < gy; by++) {
      for (let bx = 0; bx < gx; bx++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = by + dy;
            const xx = bx + dx;
            if (yy < 0 || yy >= gy || xx < 0 || xx >= gx) continue;
            sum += sm[yy * gx + xx]!;
            n++;
          }
        }
        next[by * gx + bx] = sum / n;
      }
    }
    sm = next;
  }

  const gridFinal = sm;
  return {
    sample(x: number, y: number): number {
      // Coordenada en el espacio de CENTROS de bloque.
      let fx = (x - bs / 2) / bs;
      let fy = (y - bs / 2) / bs;
      fx = Math.min(gx - 1.001, Math.max(0, fx));
      fy = Math.min(gy - 1.001, Math.max(0, fy));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const i00 = gridFinal[y0 * gx + x0]!;
      const i10 = gridFinal[y0 * gx + x0 + 1]!;
      const i01 = gridFinal[(y0 + 1) * gx + x0]!;
      const i11 = gridFinal[(y0 + 1) * gx + x0 + 1]!;
      return (
        i00 * (1 - tx) * (1 - ty) +
        i10 * tx * (1 - ty) +
        i01 * (1 - tx) * ty +
        i11 * tx * ty
      );
    },
  };
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
// Primitivas de mejora (CLAHE, unsharp de luminancia, vibrance)
// ---------------------------------------------------------------------------

/**
 * CLAHE (Contrast-Limited Adaptive Histogram Equalization) sobre la
 * luminancia, aplicado como ratio a RGB para preservar el color.
 *
 * Pipeline clasico: la imagen se divide en tiles (~8x8), cada tile
 * construye su histograma de luma, se recorta al limite de clip
 * (clipFactor x promedio de bin, el exceso se redistribuye — esto evita
 * amplificar ruido en zonas planas) y su CDF se convierte en una LUT.
 * Cada pixel interpola BILINEALMENTE entre las LUTs de los 4 tiles
 * vecinos: transicion continua, sin bordes de bloque.
 *
 * `strength` mezcla el resultado con el original (1 = efecto completo).
 */
function claheLuma(data: ImageData, clipFactor: number, strength: number): void {
  const { width: w, height: h } = data;
  if (w < 8 || h < 8) return;
  const px = data.data;
  const luma = lumaOf(data);

  // Grilla de tiles adaptativa: ~64px por tile, entre 2x2 y 8x8.
  const tilesX = Math.max(2, Math.min(8, Math.round(w / 64)));
  const tilesY = Math.max(2, Math.min(8, Math.round(h / 64)));
  const tileW = Math.ceil(w / tilesX);
  const tileH = Math.ceil(h / tilesY);

  // LUT por tile.
  const luts = new Float32Array(tilesX * tilesY * 256);
  const hist = new Uint32Array(256);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      hist.fill(0);
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(w, x0 + tileW);
      const y1 = Math.min(h, y0 + tileH);
      const count = (x1 - x0) * (y1 - y0);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[Math.min(255, Math.round(luma[y * w + x]!))]!++;
        }
      }

      const base = (ty * tilesX + tx) * 256;

      // Proteccion de tiles planos: si el rango util (p2..p98) del tile
      // es minusculo, ahi no hay detalle — solo ruido de sensor o papel
      // liso. Ecualizarlo amplificaria el ruido x10; LUT identidad.
      const p2 = histPercentile(hist, count, 0.02);
      const p98 = histPercentile(hist, count, 0.98);
      if (p98 - p2 < 12) {
        for (let v = 0; v < 256; v++) luts[base + v] = v;
        continue;
      }

      // Clip + redistribucion del exceso.
      const clipLimit = Math.max(1, Math.round((clipFactor * count) / 256));
      let excess = 0;
      for (let v = 0; v < 256; v++) {
        const over = hist[v]! - clipLimit;
        if (over > 0) {
          hist[v] = clipLimit;
          excess += over;
        }
      }
      const perBin = excess / 256;
      // CDF -> LUT.
      let cum = 0;
      for (let v = 0; v < 256; v++) {
        cum += hist[v]! + perBin;
        luts[base + v] = (cum / count) * 255;
      }
    }
  }

  // Interpolacion bilineal entre LUTs de tiles vecinos, por pixel.
  for (let y = 0, j = 0, i = 0; y < h; y++) {
    // Coordenada del pixel en el espacio de centros de tile.
    const gy = clampRange(y / tileH - 0.5, 0, tilesY - 1.001);
    const ty0 = Math.floor(gy);
    const fy = gy - ty0;
    for (let x = 0; x < w; x++, j++, i += 4) {
      const gx = clampRange(x / tileW - 0.5, 0, tilesX - 1.001);
      const tx0 = Math.floor(gx);
      const fx = gx - tx0;

      const l = Math.min(255, Math.round(luma[j]!));
      const l00 = luts[(ty0 * tilesX + tx0) * 256 + l]!;
      const l10 = luts[(ty0 * tilesX + tx0 + 1) * 256 + l]!;
      const l01 = luts[((ty0 + 1) * tilesX + tx0) * 256 + l]!;
      const l11 = luts[((ty0 + 1) * tilesX + tx0 + 1) * 256 + l]!;
      const mapped =
        l00 * (1 - fx) * (1 - fy) +
        l10 * fx * (1 - fy) +
        l01 * (1 - fx) * fy +
        l11 * fx * fy;

      const target = luma[j]! + strength * (mapped - luma[j]!);
      const ratio = target / Math.max(1, luma[j]!);
      px[i] = clamp255(px[i]! * ratio);
      px[i + 1] = clamp255(px[i + 1]! * ratio);
      px[i + 2] = clamp255(px[i + 2]! * ratio);
    }
  }
}

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
  estimateBackground,
  dilate3x3,
  claheLuma,
  unsharpLuma,
  vibrancePixel,
};
