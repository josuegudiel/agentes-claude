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

  it('detecta un documento rotado 45 grados con precision de warp', () => {
    const w = 160;
    const h = 160;
    const cx = 80;
    const cy = 80;
    const rad = (45 * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const local: Point[] = [
      { x: -48, y: -32 },
      { x: 48, y: -32 },
      { x: 48, y: 32 },
      { x: -48, y: 32 },
    ];
    const rot = local.map((p) => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos,
    }));
    const quad = detectDocumentQuad(docImage(w, h, rot));
    expect(quad).not.toBeNull();
    for (const expected of rot) {
      const nearest = Math.min(
        ...quad!.map((p) => Math.hypot(p.x * w - expected.x, p.y * h - expected.y)),
      );
      expect(nearest).toBeLessThanOrEqual(5);
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

  it('detecta un documento MUY rotado (~35deg) — caso torpe del metodo de extremos', () => {
    const w = 160;
    const h = 160;
    // Rectangulo 90x60 rotado 35 grados alrededor del centro de la imagen.
    const cx = 80;
    const cy = 80;
    const rad = (35 * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const local: Point[] = [
      { x: -45, y: -30 },
      { x: 45, y: -30 },
      { x: 45, y: 30 },
      { x: -45, y: 30 },
    ];
    const rot = local.map((p) => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos,
    }));
    const quad = detectDocumentQuad(docImage(w, h, rot));
    expect(quad).not.toBeNull();
    // Con rotacion fuerte, las esquinas "tl/tr/br/bl" detectadas pueden
    // quedar rotadas un slot respecto a las que generamos: comparamos
    // como CONJUNTO — cada esquina real debe tener una detectada cerca.
    for (const expected of rot) {
      const nearest = Math.min(
        ...quad!.map((p) => Math.hypot(p.x * w - expected.x, p.y * h - expected.y)),
      );
      expect(nearest).toBeLessThanOrEqual(8);
    }
  });

  it('ignora un distractor puntual en el fondo — el otro caso torpe', () => {
    const w = 160;
    const h = 128;
    const rect: Point[] = [
      { x: 40, y: 30 },
      { x: 130, y: 34 },
      { x: 126, y: 104 },
      { x: 36, y: 98 },
    ];
    const img = makeImage(w, h, (x, y) => {
      // Blob brillante 8x8 pegado a la esquina de la imagen: con el
      // metodo de extremos secuestraba la esquina tl del quad.
      if (x >= 3 && x < 11 && y >= 3 && y < 11) return 235;
      return insideQuad(rect, x, y) ? 230 : 25;
    });
    const quad = detectDocumentQuad(img);
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expectCornerNear(quad![i]!, rect[i]!, w, h, 8);
    }
  });

  it('documento cortado por el encuadre: usa el borde de la imagen', () => {
    const w = 160;
    const h = 128;
    // El lado izquierdo del documento queda fuera del encuadre (x<0):
    // solo se ven 3 bordes; el cuarto debe sintetizarse con el borde de
    // la imagen.
    const rect: Point[] = [
      { x: -20, y: 24 },
      { x: 120, y: 28 },
      { x: 116, y: 104 },
      { x: -24, y: 100 },
    ];
    const quad = detectDocumentQuad(docImage(w, h, rect));
    expect(quad).not.toBeNull();
    // Las dos esquinas izquierdas deben quedar clampeadas al borde x=0.
    expect(quad![0]!.x * w).toBeLessThanOrEqual(4);
    expect(quad![3]!.x * w).toBeLessThanOrEqual(4);
    // Las derechas cerca de las reales.
    expectCornerNear(quad![1]!, rect[1]!, w, h, 8);
    expectCornerNear(quad![2]!, rect[2]!, w, h, 8);
  });

  it('detecta un documento con bordes casi VERTICALES (regresion Hough theta<0)', () => {
    // Bordes verticales = gradiente casi horizontal (base<6): el bug de
    // theta negativo perdia justo estos votos. Documento alto y angosto.
    const w = 128;
    const h = 160;
    const rect: Point[] = [
      { x: 44, y: 18 },
      { x: 86, y: 18 },
      { x: 86, y: 142 },
      { x: 44, y: 142 },
    ];
    const quad = detectDocumentQuad(docImage(w, h, rect));
    expect(quad).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expectCornerNear(quad![i]!, rect[i]!, w, h, 8);
    }
  });

  it('rechaza un quad SIN contraste real con el alrededor', () => {
    // Rectangulo con borde marcado pero interior casi igual al fondo
    // (145 vs 128): hay lineas detectables, pero no es un documento.
    const w = 128;
    const h = 128;
    const rect: Point[] = [
      { x: 24, y: 24 },
      { x: 104, y: 24 },
      { x: 104, y: 104 },
      { x: 24, y: 104 },
    ];
    const img = makeImage(w, h, (x, y) =>
      insideQuad(rect, x, y) ? 145 : 128,
    );
    expect(detectDocumentQuad(img)).toBeNull();
  });

  it('acepta el mismo quad cuando el contraste es real', () => {
    const w = 128;
    const h = 128;
    const rect: Point[] = [
      { x: 24, y: 24 },
      { x: 104, y: 24 },
      { x: 104, y: 104 },
      { x: 24, y: 104 },
    ];
    const img = makeImage(w, h, (x, y) =>
      insideQuad(rect, x, y) ? 200 : 90,
    );
    expect(detectDocumentQuad(img)).not.toBeNull();
  });

  it('allowImageBorders:false rechaza el documento cortado por el encuadre', () => {
    const w = 160;
    const h = 128;
    const rect: Point[] = [
      { x: -20, y: 24 },
      { x: 120, y: 28 },
      { x: 116, y: 104 },
      { x: -24, y: 100 },
    ];
    const img = docImage(w, h, rect);
    // Con bordes permitidos (default) lo encuentra...
    expect(detectDocumentQuad(img)).not.toBeNull();
    // ...pero en modo camara-en-vivo (sin bordes sinteticos) lo rechaza.
    expect(detectDocumentQuad(img, { allowImageBorders: false })).toBeNull();
  });

  it('minArea alto rechaza documentos chicos en el encuadre', () => {
    const w = 160;
    const h = 160;
    // Documento de ~11% del area: pasa con default (8%) pero no con 15%.
    const rect: Point[] = [
      { x: 55, y: 55 },
      { x: 108, y: 57 },
      { x: 106, y: 110 },
      { x: 53, y: 108 },
    ];
    const img = docImage(w, h, rect);
    expect(detectDocumentQuad(img)).not.toBeNull();
    expect(detectDocumentQuad(img, { minArea: 0.15 })).toBeNull();
  });

  it('una sola franja del fondo no fabrica un documento', () => {
    // Fondo claro con UNA franja oscura vertical (p.ej. pata de mesa):
    // dos lineas paralelas cercanas no forman quad valido.
    const w = 128;
    const h = 128;
    const img = makeImage(w, h, (x) => (x >= 58 && x < 72 ? 40 : 215));
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
