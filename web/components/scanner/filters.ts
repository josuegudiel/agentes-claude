/**
 * Filtros tipo "scanner de movil" sobre un canvas 2D.
 *
 * Todos operan in-place sobre `ImageData`. El caller hace el getImageData /
 * putImageData; aqui solo manipulamos los pixeles. Esto nos deja componer
 * filtros sin pasar canvas para todos lados.
 */

export type FilterId =
  | 'original'
  | 'magic'
  | 'grayscale'
  | 'bw'
  | 'color';

export interface FilterMeta {
  id: FilterId;
  label: string;
  /** Descripcion corta para tooltip. */
  hint: string;
}

export const FILTERS: FilterMeta[] = [
  { id: 'original', label: 'Original', hint: 'Sin procesamiento' },
  { id: 'color', label: 'Color', hint: 'Realza contraste y saturacion' },
  { id: 'magic', label: 'Magico', hint: 'Auto-mejora tipo escaner' },
  { id: 'grayscale', label: 'Gris', hint: 'Escala de grises' },
  { id: 'bw', label: 'B&N', hint: 'Blanco y negro adaptativo' },
];

export function applyFilter(data: ImageData, filter: FilterId): ImageData {
  switch (filter) {
    case 'original':
      return data;
    case 'grayscale':
      return grayscale(data);
    case 'bw':
      return adaptiveBw(data);
    case 'magic':
      return magicScan(data);
    case 'color':
      return colorBoost(data);
    default:
      return data;
  }
}

function grayscale(data: ImageData): ImageData {
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    // Luma BT.601 — la formula clasica que mantiene la luminancia perceptual.
    const y = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    px[i] = y;
    px[i + 1] = y;
    px[i + 2] = y;
  }
  return data;
}

/**
 * Blanco y negro adaptativo. En vez de usar un umbral fijo (que se carga
 * los documentos mal iluminados), calculamos un umbral local promediando
 * por ventanas. Es una aproximacion barata de "Adaptive Mean Thresholding"
 * de OpenCV — no es perfecta, pero es 50x mas rapida y se ve bien en doc.
 */
function adaptiveBw(data: ImageData): ImageData {
  const { width, height } = data;
  const px = data.data;

  // Paso 1: pasar a gris y guardar en un buffer plano (mas rapido que
  // releer RGBA en el blur).
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    gray[j] = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
  }

  // Paso 2: blur 2-pass box filter (separable) para tener un "fondo"
  // estimado por pixel. Radio ~5% del lado menor — funciona bien para
  // hojas A4 y tarjetas.
  const radius = Math.max(4, Math.floor(Math.min(width, height) * 0.03));
  const blurred = boxBlurSeparable(gray, width, height, radius);

  // Paso 3: comparar pixel vs blur local. Si pixel < blur - C -> negro.
  const C = 10;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = gray[j]! < blurred[j]! - C ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  return data;
}

function boxBlurSeparable(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(w * h);
  const dst = new Uint8ClampedArray(w * h);
  const window = 2 * r + 1;

  // Horizontal pass. Sliding window con warmup explicito: la suma
  // inicial cubre los (2r+1) pixeles clampeados en el borde izquierdo.
  // Despues incrementamos: add src[x+r], sub src[x-r-1], ambos clampeados.
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

  // Vertical pass — misma logica, columna a columna.
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

// Exportado para tests unitarios — no usar fuera de este modulo.
export const __test = { boxBlurSeparable };

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

/**
 * Color boost: sube saturacion y contraste sin pasarse. Para fotos a color
 * de documentos (recibos termicos, tickets, etc.) que se ven lavadas.
 */
function colorBoost(data: ImageData): ImageData {
  const px = data.data;
  const sat = 1.25; // 25% mas saturacion
  const con = 1.15; // 15% mas contraste

  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]!;
    let g = px[i + 1]!;
    let b = px[i + 2]!;

    // Saturacion: alejar/acercar al gris (luma).
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * sat;
    g = y + (g - y) * sat;
    b = y + (b - y) * sat;

    // Contraste alrededor de 128.
    r = 128 + (r - 128) * con;
    g = 128 + (g - 128) * con;
    b = 128 + (b - 128) * con;

    px[i] = clamp(r);
    px[i + 1] = clamp(g);
    px[i + 2] = clamp(b);
  }
  return data;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
