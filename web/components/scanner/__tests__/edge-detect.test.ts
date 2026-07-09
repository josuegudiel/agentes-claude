import { describe, expect, it } from 'vitest';
import { detectDocumentQuad, quadArea } from '../edge-detect';
import { FULL_QUAD, type Point, type Quad } from '../perspective';

/**
 * Tests de la deteccion automatica de bordes con imagenes sinteticas:
 * un "documento" claro (poligono convexo) sobre fondo oscuro, como una
 * hoja fotografiada sobre una mesa.
 */

function makeImage(
  w: number,
  h: number,
  fill: (x: number, y: number) => number,
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const v = fill(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

/** true si (x,y) esta dentro del quad convexo (orden tl,tr,br,bl). */
function insideQuad(quad: Point[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const s = Math.sign(cross);
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function docImage(w: number, h: number, quadPx: Point[]): ImageData {
  return makeImage(w, h, (x, y) => (insideQuad(quadPx, x, y) ? 230 : 25));
}

function expectCornerNear(actual: Point, expectedPx: Point, w: number, h: number, tolPx: number): void {
  expect(Math.abs(actual.x * w - expectedPx.x)).toBeLessThanOrEqual(tolPx);
  expect(Math.abs(actual.y * h - expectedPx.y)).toBeLessThanOrEqual(tolPx);
}

describe('detectDocumentQuad', () => {
  it('detecta un rectangulo alineado', () => {
    const w = 128;
    const h = 128;
    const rect: Point[] = [
      { x: 20, y: 24 },
      { x: 108, y: 24 },
      { x: 108, y: 104 },
      { x: 20, y: 104 },
    ];
    const quad = detectDocumentQuad(docImage(w, h, rect));
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expectCornerNear(quad![i]!, rect[i]!, w, h, 6);
    }
  });

  it('detecta un documento en perspectiva (trapezoide)', () => {
    const w = 160;
    const h = 128;
    const trap: Point[] = [
      { x: 40, y: 20 },
      { x: 130, y: 30 },
      { x: 120, y: 110 },
      { x: 25, y: 100 },
    ];
    const quad = detectDocumentQuad(docImage(w, h, trap));
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expectCornerNear(quad![i]!, trap[i]!, w, h, 8);
    }
  });

  it('devuelve null en imagen plana (sin documento)', () => {
    const img = makeImage(128, 128, () => 128);
    expect(detectDocumentQuad(img)).toBeNull();
  });

  it('devuelve null con un documento demasiado pequeno (area < 8%)', () => {
    const w = 128;
    const h = 128;
    const tiny: Point[] = [
      { x: 60, y: 60 },
      { x: 70, y: 60 },
      { x: 70, y: 70 },
      { x: 60, y: 70 },
    ];
    expect(detectDocumentQuad(docImage(w, h, tiny))).toBeNull();
  });

  it('devuelve null en imagenes minusculas', () => {
    const img = makeImage(8, 8, (x) => (x > 4 ? 255 : 0));
    expect(detectDocumentQuad(img)).toBeNull();
  });

  it('tolera ruido moderado en el fondo', () => {
    const w = 128;
    const h = 128;
    const rect: Point[] = [
      { x: 24, y: 20 },
      { x: 104, y: 26 },
      { x: 100, y: 108 },
      { x: 20, y: 100 },
    ];
    // LCG deterministico para ruido reproducible (sin Math.random).
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const img = makeImage(w, h, (x, y) => {
      const base = insideQuad(rect, x, y) ? 225 : 30;
      return Math.max(0, Math.min(255, base + (rnd() - 0.5) * 30));
    });
    const quad = detectDocumentQuad(img);
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expectCornerNear(quad![i]!, rect[i]!, w, h, 10);
    }
  });
});

describe('quadArea', () => {
  it('FULL_QUAD tiene area 1', () => {
    expect(quadArea(FULL_QUAD)).toBeCloseTo(1, 10);
  });

  it('quad de medio tamano tiene area 0.25', () => {
    const q: Quad = [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ];
    expect(quadArea(q)).toBeCloseTo(0.25, 10);
  });
});
