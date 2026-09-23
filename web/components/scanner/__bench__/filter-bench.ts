/**
 * Banco de pruebas OBJETIVO de los filtros de papeleria.
 *
 * Genera documentos sinteticos con verdad de terreno (papel, texto negro,
 * tintas verde/cafe/azul claro, resaltador amarillo, sello rojo, foto) y
 * los "fotografia": dominante calida, degradado de luz, sombra de mano,
 * vineteado, desenfoque leve y ruido de sensor. Luego mide cada filtro:
 *
 *   paperMean   luminancia media del papel (meta ~250-255)
 *   paperStd    uniformidad del papel (sombra residual; meta < 3)
 *   paperChroma tinte residual del papel (meta < 3)
 *   textL       luminancia del texto negro (meta < 40)
 *   contrast    paperMean - textL (mas es mejor)
 *   inkHueErr   error medio de tono de las tintas de color, en grados
 *   inkChroma   croma de salida / croma de verdad (1 = fiel; <0.6 = lavado)
 *   inkVisible  fraccion de pixeles de tinta de color que siguen siendo
 *               distinguibles del papel (DeltaL > 25 o croma > 18)
 *   hiliteKept  el resaltador amarillo sigue visible (croma > 15)
 *   ms          tiempo por megapixel
 *
 * Uso: npx tsx web/components/scanner/__bench__/filter-bench.ts [filtro...]
 */
import { applyFilter, FILTERS, type FilterId } from '../filters';

type Label = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // papel, negro, verde, cafe, azul claro, resaltador, sello, foto
const PAPER = 0, BLACK = 1, GREEN = 2, BROWN = 3, LBLUE = 4, HILITE = 5, STAMP = 6, PHOTO = 7;

const TRUE_RGB: Record<number, [number, number, number]> = {
  [PAPER]: [246, 244, 238],
  [BLACK]: [28, 28, 32],
  [GREEN]: [24, 120, 58],
  [BROWN]: [118, 72, 34],
  [LBLUE]: [90, 140, 215],
  [HILITE]: [245, 236, 110],
  [STAMP]: [196, 40, 44],
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Scene {
  w: number;
  h: number;
  label: Uint8Array;
  img: ImageData;
}

function makeScene(w: number, h: number, variant: number): Scene {
  const r = rng(1234 + variant);
  const label = new Uint8Array(w * h); // 0 = papel
  const text = (x0: number, y0: number, tw: number, th: number, lab: Label, stroke: number): void => {
    // "Palabras": bloques de trazos verticales/horizontales finos.
    for (let x = x0; x < x0 + tw; x += Math.round(th * 0.62)) {
      const glyphW = Math.round(th * 0.45);
      for (let y = y0; y < y0 + th; y++) {
        for (let k = 0; k < stroke; k++) {
          set(x + k, y, lab);
          set(x + glyphW - 1 - k, y, lab);
        }
      }
      for (let k = 0; k < stroke; k++) {
        for (let xx = x; xx < x + glyphW; xx++) {
          set(xx, y0 + k, lab);
          set(xx, y0 + Math.round(th / 2) + k, lab);
          if (r() < 0.5) set(xx, y0 + th - 1 - k, lab);
        }
      }
    }
  };
  function set(x: number, y: number, lab: Label): void {
    if (x >= 0 && y >= 0 && x < w && y < h) label[y * w + x] = lab;
  }
  const th = Math.round(h / 60); // alto de letra ~ 1/60 de la pagina (texto de 11pt)
  const stroke = Math.max(2, Math.round(th / 7));
  let y = Math.round(h * 0.06);
  // Encabezado negro grande
  text(Math.round(w * 0.08), y, Math.round(w * 0.5), th * 2, BLACK, stroke * 2);
  y += th * 4;
  const rows: Label[] = [BLACK, BLACK, GREEN, BLACK, BROWN, BLACK, LBLUE, BLACK, BLACK, GREEN, BROWN, BLACK];
  for (const lab of rows) {
    text(Math.round(w * 0.08), y, Math.round(w * 0.8), th, lab, stroke);
    y += Math.round(th * 2.1);
  }
  // Resaltador sobre una franja (debajo del texto: solo donde es papel)
  const hy = Math.round(h * 0.06) + th * 4 + Math.round(th * 2.1) * 3 - Math.round(th * 0.3);
  for (let yy = hy; yy < hy + Math.round(th * 1.6); yy++)
    for (let xx = Math.round(w * 0.07); xx < Math.round(w * 0.6); xx++)
      if (label[yy * w + xx] === PAPER) label[yy * w + xx] = HILITE;
  // Sello rojo (anillo)
  const cx = Math.round(w * 0.72), cy = Math.round(h * 0.78), R = Math.round(w * 0.1);
  for (let yy = cy - R; yy <= cy + R; yy++)
    for (let xx = cx - R; xx <= cx + R; xx++) {
      const d = Math.hypot(xx - cx, yy - cy);
      if (d <= R && d >= R - stroke * 2.5) set(xx, yy, STAMP);
    }
  text(cx - R * 0.6, cy - th / 2, R * 1.2, th, STAMP, stroke);
  // Foto (bloque con degradado) abajo a la izquierda
  const px0 = Math.round(w * 0.08), py0 = Math.round(h * 0.68), pw = Math.round(w * 0.38), ph = Math.round(h * 0.22);
  for (let yy = py0; yy < py0 + ph; yy++) for (let xx = px0; xx < px0 + pw; xx++) set(xx, yy, PHOTO);

  // --- Render limpio (verdad) ---------------------------------------------
  const clean = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const lab = label[i]!;
    let c: [number, number, number];
    if (lab === PHOTO) {
      const xx = i % w, yy = (i / w) | 0;
      const u = (xx - px0) / pw, v = (yy - py0) / ph;
      c = [60 + 150 * u, 90 + 80 * v, 140 - 90 * u * v];
    } else c = TRUE_RGB[lab]!;
    clean[i * 3] = c[0];
    clean[i * 3 + 1] = c[1];
    clean[i * 3 + 2] = c[2];
  }
  // Tinta con bordes suaves: blur 3x3 del render limpio.
  const soft = blur3(clean, w, h);

  // --- "Fotografia": iluminacion + dominante + sombra + ruido ------------
  const cast = variant % 2 === 0 ? [1.0, 0.9, 0.72] : [0.86, 0.93, 1.0]; // tungsteno / sombra azulada
  const data = new Uint8ClampedArray(w * h * 4);
  const sx = w * (0.55 + 0.3 * r()), sy = h * (0.35 + 0.3 * r());
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx;
      const nx = xx / w, ny = yy / h;
      // Degradado de luz + vineteado
      let L = 0.95 - 0.35 * nx * ny - 0.12 * ((nx - 0.5) ** 2 + (ny - 0.5) ** 2) * 4;
      // Sombra de mano/telefono: elipse suave
      const d = Math.hypot((xx - sx) / (w * 0.28), (yy - sy) / (h * 0.2));
      const shadow = d < 1 ? 0.42 : d < 1.35 ? 0.42 + 0.58 * ((d - 1) / 0.35) : 1;
      L *= shadow;
      for (let ch = 0; ch < 3; ch++) {
        const noise = (r() + r() + r() - 1.5) * 9;
        data[i * 4 + ch] = soft[i * 3 + ch]! * L * cast[ch]! + noise;
      }
      data[i * 4 + 3] = 255;
    }
  }
  const img = { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
  return { w, h, label, img };
}

function blur3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s += src[(yy * w + xx) * 3 + c]!;
            n++;
          }
        out[(y * w + x) * 3 + c] = s / n;
      }
  return out;
}

// --- Color: sRGB -> Lab (para tono y croma) ----------------------------------
function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function interior(label: Uint8Array, w: number, h: number, lab: Label): Uint8Array {
  // Pixeles de la clase cuyo vecindario 5x5 es de la misma clase (evita
  // medir bordes antialiasados).
  const out = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      if (label[y * w + x] !== lab) continue;
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (label[(y + dy) * w + x + dx] !== lab) {
            ok = false;
            break;
          }
      if (ok) out[y * w + x] = 1;
    }
  return out;
}

function strokeCore(label: Uint8Array, w: number, h: number, lab: Label): Uint8Array {
  // Para tinta (trazos finos): pixeles de la clase con vecinos 4-conexos iguales.
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (label[i] === lab && label[i - 1] === lab && label[i + 1] === lab && label[i - w] === lab && label[i + w] === lab)
        out[i] = 1;
    }
  return out;
}

interface Metrics {
  paperMean: number;
  paperStd: number;
  paperChroma: number;
  textL: number;
  contrast: number;
  inkHueErr: number;
  inkChroma: number;
  inkVisible: number;
  hiliteKept: number;
  ms: number;
}

function measure(scene: Scene, out: ImageData, ms: number): Metrics {
  const { w, h, label } = scene;
  const px = out.data;
  const lum = (i: number): number => 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;

  const paper = interior(label, w, h, PAPER);
  let n = 0, s = 0, s2 = 0, chroma = 0;
  for (let i = 0; i < w * h; i++) {
    if (!paper[i]) continue;
    const L = lum(i);
    s += L;
    s2 += L * L;
    const [, a, b] = toLab(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!);
    chroma += Math.hypot(a, b);
    n++;
  }
  const paperMean = s / n;
  const paperStd = Math.sqrt(Math.max(0, s2 / n - paperMean * paperMean));

  const black = strokeCore(label, w, h, BLACK);
  let tn = 0, ts = 0;
  for (let i = 0; i < w * h; i++) if (black[i]) (ts += lum(i)), tn++;
  const textL = ts / tn;

  let hueErr = 0, chromaRatio = 0, visible = 0, inkN = 0;
  for (const lab of [GREEN, BROWN, LBLUE, STAMP] as Label[]) {
    const core = strokeCore(label, w, h, lab);
    const t = TRUE_RGB[lab]!;
    const [, ta, tb] = toLab(t[0], t[1], t[2]);
    const tHue = Math.atan2(tb, ta);
    const tC = Math.hypot(ta, tb);
    for (let i = 0; i < w * h; i++) {
      if (!core[i]) continue;
      const [L, a, b] = toLab(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!);
      const c = Math.hypot(a, b);
      let dh = Math.abs(Math.atan2(b, a) - tHue);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      hueErr += c > 5 ? (dh * 180) / Math.PI : 90;
      chromaRatio += c / tC;
      void L;
      if (paperMean - lum(i) > 25 || c > 18) visible++;
      inkN++;
    }
  }

  const hl = interior(label, w, h, HILITE);
  let hn = 0, hc = 0;
  for (let i = 0; i < w * h; i++) {
    if (!hl[i]) continue;
    const [, a, b] = toLab(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!);
    hc += Math.hypot(a, b);
    hn++;
  }

  return {
    paperMean,
    paperStd,
    paperChroma: chroma / n,
    textL,
    contrast: paperMean - textL,
    inkHueErr: hueErr / inkN,
    inkChroma: chromaRatio / inkN,
    inkVisible: visible / inkN,
    hiliteKept: hn ? hc / hn : 0,
    ms: ms / ((w * h) / 1e6),
  };
}

function cloneImage(img: ImageData): ImageData {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height, colorSpace: 'srgb' } as ImageData;
}

// ImageData no existe en node: los filtros la crean con new ImageData().
if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
  (globalThis as unknown as { ImageData: unknown }).ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace = 'srgb';
    constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
      if (typeof a === 'number') {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.data = a;
        this.width = b;
        this.height = c ?? a.length / 4 / b;
      }
    }
  };
}

const only = process.argv.slice(2) as FilterId[];
const ids = (only.length ? only : FILTERS.map((f) => f.id)) as FilterId[];
const W = Number(process.env.BENCH_W ?? 1200), H = Math.round(W * 1.35);
const scenes = [makeScene(W, H, 0), makeScene(W, H, 1)];

const fmt = (v: number, d = 1): string => v.toFixed(d).padStart(6);
console.log(`escena ${W}x${H} (x${scenes.length} variantes: tungsteno / sombra azulada)`);
console.log('filtro      paperL  pStd  pChrom  textL  contr  hueErr inkC  inkVis hilite  ms/MP');
for (const id of ids) {
  const acc: Metrics[] = [];
  for (const sc of scenes) {
    const copy = cloneImage(sc.img);
    const t0 = performance.now();
    const out = applyFilter(copy, id);
    acc.push(measure(sc, out, performance.now() - t0));
  }
  const avg = (k: keyof Metrics): number => acc.reduce((a, m) => a + m[k], 0) / acc.length;
  console.log(
    `${id.padEnd(10)} ${fmt(avg('paperMean'))} ${fmt(avg('paperStd'))} ${fmt(avg('paperChroma'))} ${fmt(avg('textL'))} ${fmt(avg('contrast'))} ${fmt(avg('inkHueErr'))} ${fmt(avg('inkChroma'), 2)} ${fmt(avg('inkVisible'), 2)} ${fmt(avg('hiliteKept'))} ${fmt(avg('ms'), 0)}`,
  );
}
