import { beforeAll, describe, expect, it } from 'vitest';
import { straightenText } from '../dewarp';

/**
 * Tests del enderezado por renglones: una pagina sintetica con renglones
 * de "palabras" (bloques oscuros) inclinados y combados; despues de
 * enderezar, cada renglon debe quedar a la misma altura a la izquierda y
 * a la derecha.
 */

beforeAll(() => {
  if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
    (globalThis as unknown as { ImageData: unknown }).ImageData = class {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace = 'srgb';
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
      }
    };
  }
});

const W = 1000;
const H = 1300;

/** Pagina con 18 renglones; y(x) = base + tilt*(x-cx) + bow*((x-cx)/cx)^2. */
function makePage(tiltDeg: number, bowPx: number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4).fill(245);
  const t = Math.tan((tiltDeg * Math.PI) / 180);
  const cx = W / 2;
  for (let line = 0; line < 18; line++) {
    const base = 150 + line * 55;
    for (let x = 100; x < 900; x++) {
      // Palabras de ~40 px con espacios de ~12 px; letras con huecos.
      const inWord = (x - 100) % 52 < 40 && (x % 7) !== 0;
      if (!inWord) continue;
      const u = (x - cx) / cx;
      const yc = base + t * (x - cx) + bowPx * u * u;
      for (let y = Math.round(yc - 7); y <= Math.round(yc + 7); y++) {
        const i = (y * W + x) * 4;
        data[i] = 25;
        data[i + 1] = 25;
        data[i + 2] = 25;
      }
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: W, height: H, colorSpace: 'srgb' } as ImageData;
}

/** Centroide vertical de la tinta de cada renglon en una franja de columnas. */
function lineRows(img: ImageData, x0: number, x1: number): number[] {
  const prof = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = x0; x < x1; x++) {
      if (img.data[(y * W + x) * 4]! < 128) prof[y] = prof[y]! + 1;
    }
  }
  const rows: number[] = [];
  let y = 0;
  while (y < H) {
    if (prof[y]! > 0) {
      let s = 0, n = 0;
      while (y < H && prof[y]! > 0) {
        s += y * prof[y]!;
        n += prof[y]!;
        y++;
      }
      if (n > 20) rows.push(s / n);
    } else y++;
  }
  return rows;
}

describe('straightenText', () => {
  it('endereza renglones inclinados 2 grados y combados', () => {
    const src = makePage(2, 10);
    const before = lineRows(src, 150, 200).map((l, i) => Math.abs(l - lineRows(src, 800, 850)[i]!));
    const res = straightenText(src);
    expect(res).not.toBeNull();
    expect(Math.abs(res!.angle - 2)).toBeLessThan(0.4);
    const left = lineRows(res!.data, 150, 200);
    const right = lineRows(res!.data, 800, 850);
    const mid = lineRows(res!.data, 480, 520);
    expect(left.length).toBeGreaterThanOrEqual(15);
    // Antes: ~22 px de diferencia entre izquierda y derecha.
    expect(Math.max(...before)).toBeGreaterThan(15);
    // Despues: cada renglon a la misma altura (+-2 px) en los 3 puntos.
    const n = Math.min(left.length, right.length, mid.length);
    for (let i = 2; i < n - 2; i++) {
      expect(Math.abs(left[i]! - right[i]!)).toBeLessThan(2.5);
      expect(Math.abs(left[i]! - mid[i]!)).toBeLessThan(2.5);
    }
  });

  it('una pagina ya derecha no se toca', () => {
    expect(straightenText(makePage(0, 0))).toBeNull();
  });

  it('sin renglones (pagina en blanco) no hace nada', () => {
    const blank = {
      data: new Uint8ClampedArray(W * H * 4).fill(240),
      width: W,
      height: H,
      colorSpace: 'srgb',
    } as ImageData;
    expect(straightenText(blank)).toBeNull();
  });
});
