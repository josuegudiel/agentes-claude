import { describe, expect, it } from 'vitest';
import { loupePlacement, loupeRects } from '../loupe';

const SIZE = 112;
const ZOOM = 3;
const SPAN = SIZE / ZOOM; // ~37.33px de fuente visibles

describe('loupeRects', () => {
  it('punto en el centro: rect fuente completo, destino cubre toda la lupa', () => {
    const r = loupeRects(200, 150, 400, 300, SIZE, ZOOM);
    expect(r.sx).toBeCloseTo(200 - SPAN / 2, 6);
    expect(r.sy).toBeCloseTo(150 - SPAN / 2, 6);
    expect(r.sw).toBeCloseTo(SPAN, 6);
    expect(r.sh).toBeCloseTo(SPAN, 6);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.dw).toBeCloseTo(SIZE, 6);
    expect(r.dh).toBeCloseTo(SIZE, 6);
  });

  it('esquina (0,0): clamp a 0 y el punto queda bajo la cruz central', () => {
    const r = loupeRects(0, 0, 400, 300, SIZE, ZOOM);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    // El destino se desplaza para que (0,0) fuente caiga en el centro:
    // dx + (cx - sx) * zoom === SIZE / 2.
    expect(r.dx + (0 - r.sx) * ZOOM).toBeCloseTo(SIZE / 2, 6);
    expect(r.dy + (0 - r.sy) * ZOOM).toBeCloseTo(SIZE / 2, 6);
    // Solo media ventana visible.
    expect(r.sw).toBeCloseTo(SPAN / 2, 6);
    expect(r.sh).toBeCloseTo(SPAN / 2, 6);
  });

  it('borde derecho/inferior: el rect no se sale del canvas', () => {
    const w = 400;
    const h = 300;
    const r = loupeRects(w, h, w, h, SIZE, ZOOM);
    expect(r.sx + r.sw).toBeLessThanOrEqual(w + 1e-9);
    expect(r.sy + r.sh).toBeLessThanOrEqual(h + 1e-9);
    // Punto bajo la cruz.
    expect(r.dx + (w - r.sx) * ZOOM).toBeCloseTo(SIZE / 2, 6);
    expect(r.dy + (h - r.sy) * ZOOM).toBeCloseTo(SIZE / 2, 6);
  });

  it('canvas mas chico que la ventana de la lupa: rects no negativos', () => {
    const r = loupeRects(5, 5, 10, 10, SIZE, ZOOM);
    expect(r.sw).toBeGreaterThanOrEqual(0);
    expect(r.sh).toBeGreaterThanOrEqual(0);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.dw).toBe(r.sw * ZOOM);
    expect(r.dh).toBe(r.sh * ZOOM);
  });

  it('la escala destino/fuente siempre es el zoom', () => {
    for (const [cx, cy] of [
      [0, 0],
      [400, 300],
      [37, 250],
      [399, 1],
    ] as const) {
      const r = loupeRects(cx, cy, 400, 300, SIZE, ZOOM);
      if (r.sw > 0) expect(r.dw / r.sw).toBeCloseTo(ZOOM, 9);
      if (r.sh > 0) expect(r.dh / r.sh).toBeCloseTo(ZOOM, 9);
    }
  });
});

describe('loupePlacement', () => {
  it('esquina izquierda -> lupa a la derecha', () => {
    expect(loupePlacement(0.1)).toBe('right');
    expect(loupePlacement(0.49)).toBe('right');
  });

  it('esquina derecha -> lupa a la izquierda', () => {
    expect(loupePlacement(0.5)).toBe('left');
    expect(loupePlacement(0.9)).toBe('left');
  });
});
