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
  { id: 'magic', label: 'Magico', hint: 'Contraste adaptativo por zonas (CLAHE) — revive texto y detalle palidos' },
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
      // Cap 5 (antes 3): una sombra profunda con fondo ~50 necesita
      // gain ~4.9 para levantar el papel a blanco. Con cap 3 la sombra
      // quedaba a medio corregir y los umbrales de abajo la RE-oscurecian
      // — el bug de "las sombras se oscurecen mas".
      const gain = Math.min(5, 245 / b);
      let r = px[i]! * gain;
      let g = px[i + 1]! * gain;
      let bch = px[i + 2]! * gain;

      // Blanqueo suave: los pixeles cuya luma normalizada quedo cerca
      // del papel se empujan a blanco puro con smoothstep — el fondo
      // queda limpio de verdad (como una fotocopia buena) sin escalon
      // duro contra la tinta.
      const nl = 0.299 * r + 0.587 * g + 0.114 * bch;
      if (nl >= 180) {
        const t = Math.min(1, (nl - 180) / 60);
        const s = t * t * (3 - 2 * t);
        r = r + (255 - r) * s;
        g = g + (255 - g) * s;
        bch = bch + (255 - bch) * s;
      } else if (nl < 110) {
        // Oscurecer SOLO tinta franca (nl < 110). La banda media
        // 110..180 (penumbra corregida a medias, sellos claros) se deja
        // intacta: aplicarle el x0.9 aqui era lo que oscurecia las
        // sombras en vez de eliminarlas.
        r *= 0.9;
        g *= 0.9;
        bch *= 0.9;
      }
      px[i] = clamp255(r);
      px[i + 1] = clamp255(g);
      px[i + 2] = clamp255(bch);
    }
  }

  // Texto mas crocante sin franjas de color: enfoque sobre luminancia.
  unsharpLuma(data, 0.4, 3);
  return data;
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
  const bg = estimateBackground(luma, w, h);

  // Referencia: el fondo mas claro de la imagen (percentil alto del mapa
  // de sombra) — normalizamos hacia el, no hacia blanco absoluto, para
  // conservar el tono del papel/superficie original.
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
      const b = Math.max(30, bg.sample(x, y));
      const gain = Math.min(5, ref / b);
      px[i] = clamp255(px[i]! * gain);
      px[i + 1] = clamp255(px[i + 1]! * gain);
      px[i + 2] = clamp255(px[i + 2]! * gain);
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

  // Trazos del texto termico mas definidos.
  unsharpLuma(data, 0.5, 3);
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
 * "Magic" scan: mejora automatica tipo CamScanner, ahora con CLAHE
 * (Contrast-Limited Adaptive Histogram Equalization) — la tecnica que
 * usan los SDKs de escaneo profesionales. A diferencia del clip global
 * de histograma, CLAHE ecualiza POR REGION (tiles con LUT interpolada
 * bilinealmente), asi que levanta el contraste local: texto palido en
 * una zona oscura Y detalle en una zona clara mejoran a la vez. El
 * limite de clip evita amplificar ruido en zonas planas. Remate con
 * enfoque suave de luminancia.
 */
function magicScan(data: ImageData): ImageData {
  // Pre-pase de sombras: normalizacion suave contra el mapa de
  // iluminacion (Lambertiano) ANTES de CLAHE. Sin esto, CLAHE trata la
  // sombra como "contenido" y ecualiza dentro de ella — el resultado
  // percibido era que algunas sombras quedaban MAS oscuras.
  softShadowLift(data, 2.5);
  // Clip alto: los tiles CON contenido se ecualizan fuerte (la
  // proteccion de tiles planos dentro de claheLuma evita amplificar
  // ruido donde no hay detalle real).
  claheLuma(data, 16, 0.8);
  // Estiramiento global de luminancia para asentar negros y blancos
  // (solo si hay rango real que estirar).
  stretchLuma(data, 0.01, 0.99, 40);
  unsharpLuma(data, 0.35, 2);
  return data;
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
