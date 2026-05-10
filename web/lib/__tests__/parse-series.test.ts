import { describe, expect, it } from 'vitest';
import { parseSeries } from '../parse-series.js';

describe('parseSeries', () => {
  it('parsea CSV simple con espacios', () => {
    const r = parseSeries('1, 2, 3, 4, 5, 6, 7, 8');
    expect(r.ok).toBe(true);
    expect(r.series).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('parsea valores separados por nueva linea', () => {
    const r = parseSeries('1\n2\n3\n4\n5\n6\n7\n8\n9');
    expect(r.ok).toBe(true);
    expect(r.series).toHaveLength(9);
  });

  it('parsea JSON array', () => {
    const r = parseSeries('[1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]');
    expect(r.ok).toBe(true);
    expect(r.series).toEqual([1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
  });

  it('rechaza serie demasiado corta', () => {
    const r = parseSeries('1, 2, 3');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/al menos 8/);
  });

  it('rechaza valores no numericos', () => {
    const r = parseSeries('1, 2, abc, 4, 5, 6, 7, 8');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/posicion 2/);
  });

  it('rechaza texto vacio', () => {
    expect(parseSeries('').ok).toBe(false);
    expect(parseSeries('   ').ok).toBe(false);
  });

  it('rechaza JSON invalido que empieza con [', () => {
    const r = parseSeries('[1, 2, oops');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON/);
  });

  it('rechaza JSON object (no array)', () => {
    const r = parseSeries('{"a": 1}');
    // No empieza con "[", asi que cae al parser de tokens. "{a": no es numero.
    expect(r.ok).toBe(false);
  });

  it('mezcla separadores: comas + saltos + punto y coma', () => {
    const r = parseSeries('1, 2; 3\n4 5,6;7\n8, 9');
    expect(r.ok).toBe(true);
    expect(r.series).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
