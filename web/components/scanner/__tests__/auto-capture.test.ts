import { describe, expect, it } from 'vitest';
import {
  isStableSequence,
  mapCoverPoint,
  quadShift,
  STABLE_TICKS_NEEDED,
} from '../auto-capture';
import type { Quad } from '../perspective';

function quadAt(offset: number): Quad {
  return [
    { x: 0.1 + offset, y: 0.1 },
    { x: 0.9 + offset, y: 0.12 },
    { x: 0.88 + offset, y: 0.9 },
    { x: 0.08 + offset, y: 0.88 },
  ];
}

describe('quadShift', () => {
  it('cero para quads identicos', () => {
    expect(quadShift(quadAt(0), quadAt(0))).toBe(0);
  });

  it('mide el desplazamiento maximo por esquina', () => {
    expect(quadShift(quadAt(0), quadAt(0.05))).toBeCloseTo(0.05, 6);
  });
});

describe('isStableSequence', () => {
  it('false con menos ticks que los requeridos', () => {
    expect(isStableSequence([quadAt(0), quadAt(0)])).toBe(false);
  });

  it('true con N quads casi identicos', () => {
    const seq = [quadAt(0), quadAt(0.005), quadAt(0.008)];
    expect(seq.length).toBe(STABLE_TICKS_NEEDED);
    expect(isStableSequence(seq)).toBe(true);
  });

  it('false si el telefono se movio en el ultimo tick', () => {
    const seq = [quadAt(0), quadAt(0.005), quadAt(0.09)];
    expect(isStableSequence(seq)).toBe(false);
  });

  it('solo miran los ultimos N: un salto viejo no molesta', () => {
    const seq = [quadAt(0.5), quadAt(0), quadAt(0.005), quadAt(0.008)];
    expect(isStableSequence(seq)).toBe(true);
  });
});

describe('mapCoverPoint', () => {
  it('identidad cuando video y caja tienen el mismo aspect', () => {
    const p = mapCoverPoint({ x: 0.3, y: 0.7 }, 1600, 1200, 400, 300);
    expect(p.x).toBeCloseTo(0.3, 9);
    expect(p.y).toBeCloseTo(0.7, 9);
  });

  it('video mas ancho que la caja: recorta los lados', () => {
    // Video 2:1 en caja 1:1 -> se ve el 50% central del ancho.
    // El centro del video sigue siendo el centro de la caja.
    const center = mapCoverPoint({ x: 0.5, y: 0.5 }, 200, 100, 100, 100);
    expect(center.x).toBeCloseTo(0.5, 9);
    // x=0.25 del video es el borde izquierdo visible.
    const left = mapCoverPoint({ x: 0.25, y: 0.5 }, 200, 100, 100, 100);
    expect(left.x).toBeCloseTo(0, 9);
    // x=0.1 queda FUERA de lo visible (negativo).
    const out = mapCoverPoint({ x: 0.1, y: 0.5 }, 200, 100, 100, 100);
    expect(out.x).toBeLessThan(0);
  });

  it('video mas alto que la caja: recorta arriba/abajo', () => {
    // Video 1:2 en caja 1:1 -> se ve el 50% central del alto.
    const top = mapCoverPoint({ x: 0.5, y: 0.25 }, 100, 200, 100, 100);
    expect(top.y).toBeCloseTo(0, 9);
    const bottom = mapCoverPoint({ x: 0.5, y: 0.75 }, 100, 200, 100, 100);
    expect(bottom.y).toBeCloseTo(1, 9);
  });
});
