import { describe, expect, it } from 'vitest';
import { rotateClockwise, rotatedSize } from '../pages';
import { IMPORT_MAX_SIDE, importScale, isPdfFile } from '../pdf-import';
import { moveItem } from '../reorder';

describe('moveItem', () => {
  it('mueve hacia adelante y hacia atras sin perder elementos', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem([1, 2, 3, 4], 1, 3)).toEqual([1, 3, 4, 2]);
  });

  it('mismo lugar o indice invalido: copia sin cambios', () => {
    const a = [1, 2, 3];
    const b = moveItem(a, 1, 1);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    expect(moveItem(a, 5, 0)).toEqual(a);
  });

  it('destino fuera de rango se acota a los extremos', () => {
    expect(moveItem([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, -5)).toEqual([3, 1, 2]);
  });
});

describe('giro de paginas', () => {
  it('rotateClockwise da la vuelta completa', () => {
    expect(rotateClockwise(0)).toBe(90);
    expect(rotateClockwise(90)).toBe(180);
    expect(rotateClockwise(180)).toBe(270);
    expect(rotateClockwise(270)).toBe(0);
  });

  it('rotatedSize intercambia lados solo en 90/270', () => {
    expect(rotatedSize(3, 4, 0)).toEqual({ width: 3, height: 4 });
    expect(rotatedSize(3, 4, 90)).toEqual({ width: 4, height: 3 });
    expect(rotatedSize(3, 4, 180)).toEqual({ width: 3, height: 4 });
    expect(rotatedSize(3, 4, 270)).toEqual({ width: 4, height: 3 });
  });
});

describe('importScale', () => {
  it('A4 se lee a 300 dpi (2480 x 3508)', () => {
    const s = importScale(595.28, 841.89);
    expect(Math.round(595.28 * s)).toBeGreaterThanOrEqual(2479);
    expect(Math.round(841.89 * s)).toBeLessThanOrEqual(IMPORT_MAX_SIDE);
  });

  it('hojas enormes no pasan del lado maximo ni de 12 MP', () => {
    for (const [w, h] of [
      [2384, 3370], // A0
      [5000, 400], // banner
      [3000, 3000],
    ] as const) {
      const s = importScale(w, h);
      expect(Math.max(w, h) * s).toBeLessThanOrEqual(IMPORT_MAX_SIDE + 1e-6);
      expect(w * s * h * s).toBeLessThanOrEqual(12e6 + 1);
    }
  });

  it('una carta chica se lee a 300 dpi', () => {
    expect(importScale(612, 792)).toBeCloseTo(300 / 72, 6);
  });
});

describe('isPdfFile', () => {
  it('por tipo o por extension', () => {
    expect(isPdfFile(new File([], 'a.bin', { type: 'application/pdf' }))).toBe(true);
    expect(isPdfFile(new File([], 'TAREA.PDF'))).toBe(true);
    expect(isPdfFile(new File([], 'foto.jpg', { type: 'image/jpeg' }))).toBe(false);
  });
});
