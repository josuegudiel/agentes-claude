import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  computeHomography,
  estimateAspectRatio,
  FULL_QUAD,
  isAxisAlignedRect,
  isConvexQuad,
  solveLinear,
  warpPerspective,
  type Quad,
} from '../perspective';

/**
 * Tests de la matematica de perspectiva. Todo corre en node — la
 * homografia y el warp son funciones puras sobre bufferes.
 */

function makeImageData(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const [r, g, b] = fill(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('solveLinear', () => {
  it('resuelve un sistema 2x2 conocido', () => {
    // 2x + y = 5 ; x - y = 1  ->  x=2, y=1
    const x = solveLinear(
      [
        [2, 1],
        [1, -1],
      ],
      [5, 1],
    );
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(2, 10);
    expect(x![1]).toBeCloseTo(1, 10);
  });

  it('devuelve null en matriz singular', () => {
    const x = solveLinear(
      [
        [1, 2],
        [2, 4],
      ],
      [3, 6],
    );
    expect(x).toBeNull();
  });

  it('maneja pivoteo (cero en la diagonal)', () => {
    // 0x + y = 3 ; x + 0y = 7 — requiere swap de filas.
    const x = solveLinear(
      [
        [0, 1],
        [1, 0],
      ],
      [3, 7],
    );
    expect(x).not.toBeNull();
    expect(x![0]).toBeCloseTo(7, 10);
    expect(x![1]).toBeCloseTo(3, 10);
  });
});

describe('computeHomography', () => {
  const unitSquare: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it('identidad: mismo quad -> mapeo identidad', () => {
    const h = computeHomography(unitSquare, unitSquare);
    expect(h).not.toBeNull();
    const mid = applyHomography(h!, { x: 0.5, y: 0.5 });
    expect(mid.x).toBeCloseTo(0.5, 8);
    expect(mid.y).toBeCloseTo(0.5, 8);
    const p = applyHomography(h!, { x: 0.25, y: 0.75 });
    expect(p.x).toBeCloseTo(0.25, 8);
    expect(p.y).toBeCloseTo(0.75, 8);
  });

  it('mapea las 4 esquinas exactamente en un warp trapezoidal', () => {
    const trapezoid: Quad = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.15 },
      { x: 0.95, y: 0.9 },
      { x: 0.05, y: 0.85 },
    ];
    const h = computeHomography(unitSquare, trapezoid);
    expect(h).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(h!, unitSquare[i]!);
      expect(mapped.x).toBeCloseTo(trapezoid[i]!.x, 8);
      expect(mapped.y).toBeCloseTo(trapezoid[i]!.y, 8);
    }
  });

  it('escala + traslacion pura', () => {
    const dst: Quad = [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 60 },
      { x: 10, y: 60 },
    ];
    const h = computeHomography(unitSquare, dst);
    expect(h).not.toBeNull();
    // Centro del cuadrado unitario -> centro del rect destino.
    const c = applyHomography(h!, { x: 0.5, y: 0.5 });
    expect(c.x).toBeCloseTo(20, 6);
    expect(c.y).toBeCloseTo(40, 6);
  });

  it('devuelve null cuando los puntos FUENTE son colineales (sistema singular)', () => {
    const degenerateSrc: Quad = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const h = computeHomography(degenerateSrc, unitSquare);
    expect(h).toBeNull();
  });
});

describe('isConvexQuad', () => {
  it('true para FULL_QUAD y trapezoides normales', () => {
    expect(isConvexQuad(FULL_QUAD)).toBe(true);
    expect(
      isConvexQuad([
        { x: 0.2, y: 0.1 },
        { x: 0.8, y: 0.15 },
        { x: 0.95, y: 0.9 },
        { x: 0.05, y: 0.85 },
      ]),
    ).toBe(true);
  });

  it('false para quad cruzado (esquinas intercambiadas)', () => {
    // tr y tl intercambiados -> el contorno se cruza.
    expect(
      isConvexQuad([
        { x: 1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    ).toBe(false);
  });

  it('false con 3 esquinas colineales', () => {
    expect(
      isConvexQuad([
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toBe(false);
  });

  it('false con dos esquinas en el mismo punto', () => {
    expect(
      isConvexQuad([
        { x: 0.3, y: 0.3 },
        { x: 0.3, y: 0.3 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    ).toBe(false);
  });
});

describe('isAxisAlignedRect', () => {
  it('true para FULL_QUAD', () => {
    expect(isAxisAlignedRect(FULL_QUAD)).toBe(true);
  });

  it('false para trapezoide', () => {
    const q: Quad = [
      { x: 0.1, y: 0 },
      { x: 0.9, y: 0.05 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(isAxisAlignedRect(q)).toBe(false);
  });
});

describe('warpPerspective', () => {
  it('quad = imagen completa -> copia identica', () => {
    const w = 8;
    const h = 6;
    const src = makeImageData(w, h, (x, y) => [x * 30, y * 40, 128]);
    const quadPx: Quad = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    const out = warpPerspective(src, quadPx);
    expect(out).not.toBeNull();
    expect(out!.width).toBe(w);
    expect(out!.height).toBe(h);
    // Sampling en coordenadas enteras -> valores exactos.
    for (let i = 0; i < src.data.length; i += 4) {
      expect(out!.data[i]).toBe(src.data[i]);
      expect(out!.data[i + 1]).toBe(src.data[i + 1]);
      expect(out!.data[i + 2]).toBe(src.data[i + 2]);
    }
  });

  it('sub-rectangulo alineado -> crop exacto', () => {
    const w = 10;
    const h = 10;
    const src = makeImageData(w, h, (x, y) => [x * 20, y * 20, 0]);
    // Rect de (2,3) a (7,8): 5x5.
    const quadPx: Quad = [
      { x: 2, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 8 },
      { x: 2, y: 8 },
    ];
    const out = warpPerspective(src, quadPx);
    expect(out).not.toBeNull();
    expect(out!.width).toBe(5);
    expect(out!.height).toBe(5);
    // Pixel (0,0) de salida = pixel (2,3) de la fuente.
    expect(out!.data[0]).toBe(2 * 20);
    expect(out!.data[1]).toBe(3 * 20);
  });

  it('endereza un trapezoide: los bordes convergen al contenido del quad', () => {
    const w = 40;
    const h = 40;
    // Imagen negra con un "documento" blanco en trapezoide.
    const tl = { x: 10, y: 8 };
    const tr = { x: 32, y: 12 };
    const br = { x: 30, y: 34 };
    const bl = { x: 8, y: 30 };
    const src = makeImageData(w, h, () => [0, 0, 0]);
    // Pintamos blanco el centro aproximado del trapezoide (un bloque).
    for (let y = 15; y < 25; y++) {
      for (let x = 15; x < 25; x++) {
        const i = (y * w + x) * 4;
        src.data[i] = 255;
        src.data[i + 1] = 255;
        src.data[i + 2] = 255;
      }
    }
    const out = warpPerspective(src, [tl, tr, br, bl]);
    expect(out).not.toBeNull();
    // El tamano usa el lado mas largo de cada par de bordes opuestos.
    const top = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const bottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    expect(out!.width).toBe(Math.round(Math.max(top, bottom)));
    // El centro del output deberia caer dentro del bloque blanco.
    const cx = Math.floor(out!.width / 2);
    const cy = Math.floor(out!.height / 2);
    const ci = (cy * out!.width + cx) * 4;
    expect(out!.data[ci]).toBeGreaterThan(200);
  });

  it('acota la salida al lado maximo conservando el aspecto', () => {
    // Quad muy inclinado: su borde superior mide la diagonal (~566px)
    // sobre una fuente de 400px. Con tope 300 la salida no pasa de 300.
    const src = makeImageData(400, 400, () => [128, 128, 128]);
    const quadPx: Quad = [
      { x: 0, y: 0 },
      { x: 400, y: 400 },
      { x: 300, y: 400 },
      { x: 0, y: 120 },
    ];
    const free = warpPerspective(src, quadPx, 10_000);
    const capped = warpPerspective(src, quadPx, 300);
    expect(free).not.toBeNull();
    expect(capped).not.toBeNull();
    expect(free!.width).toBeGreaterThan(400);
    expect(Math.max(capped!.width, capped!.height)).toBe(300);
    expect(capped!.width / capped!.height).toBeCloseTo(free!.width / free!.height, 1);
  });

  it('devuelve null para quad degenerado', () => {
    const src = makeImageData(4, 4, () => [100, 100, 100]);
    const degenerate: Quad = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(warpPerspective(src, degenerate)).toBeNull();
  });

  it('alpha de salida siempre opaco', () => {
    const src = makeImageData(6, 6, () => [50, 60, 70]);
    const quadPx: Quad = [
      { x: 1, y: 1 },
      { x: 5, y: 2 },
      { x: 4, y: 5 },
      { x: 0, y: 4 },
    ];
    const out = warpPerspective(src, quadPx);
    expect(out).not.toBeNull();
    for (let i = 3; i < out!.data.length; i += 4) {
      expect(out!.data[i]).toBe(255);
    }
  });
});

describe('estimateAspectRatio (Zhang & He)', () => {
  /** Proyecta un rectangulo W x H (en su plano) con una camara pinhole. */
  function project(
    W: number,
    H: number,
    f: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    dist: number,
  ): Quad {
    const pts = [
      [-W / 2, -H / 2],
      [W / 2, -H / 2],
      [W / 2, H / 2],
      [-W / 2, H / 2],
    ];
    const cX = Math.cos(rx), sX = Math.sin(rx), cY = Math.cos(ry), sY = Math.sin(ry);
    return pts.map(([x, y]) => {
      // Rotacion en X (inclinacion hacia atras) y en Y (giro lateral).
      let X = x!, Y = y!, Z = 0;
      [Y, Z] = [Y * cX - Z * sX, Y * sX + Z * cX];
      [X, Z] = [X * cY + Z * sY, -X * sY + Z * cY];
      Z += dist;
      return { x: cx + (f * X) / Z, y: cy + (f * Y) / Z };
    }) as Quad;
  }

  it('recupera la proporcion A4 de una hoja fotografiada inclinada', () => {
    const q = project(210, 297, 3000, 2016, 1512, 0.55, 0.3, 700);
    const top = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
    const left = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y);
    const naive = top / left;
    const est = estimateAspectRatio(q, { x: 2016, y: 1512 }, 4032)!;
    const truth = 210 / 297;
    // La proporcion "por bordes" esta muy lejos; la estimada, a <2%.
    expect(Math.abs(naive - truth) / truth).toBeGreaterThan(0.08);
    expect(Math.abs(est - truth) / truth).toBeLessThan(0.02);
  });

  it('foto frontal: coincide con el cociente de bordes', () => {
    const q = project(300, 200, 3000, 2016, 1512, 0, 0, 800);
    const est = estimateAspectRatio(q, { x: 2016, y: 1512 }, 4032)!;
    expect(est).toBeCloseTo(1.5, 2);
  });

  it('solo inclinacion en un eje (trapecio) tambien funciona', () => {
    const q = project(216, 279, 2800, 2016, 1512, 0.6, 0, 650);
    const est = estimateAspectRatio(q, { x: 2016, y: 1512 }, 4032)!;
    expect(Math.abs(est - 216 / 279) / (216 / 279)).toBeLessThan(0.03);
  });
});
