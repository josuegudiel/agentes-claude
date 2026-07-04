import { describe, expect, it } from 'vitest';
import { parseCsvRows, toCsv, slugify, uniqueSlug } from '../run-geo-audit.js';

describe('parseCsvRows', () => {
  it('respeta comillas con comas dentro del valor', () => {
    const rows = parseCsvRows('name,city,url\n"Taller, S.A.",Quetzaltenango,taller.gt\n');
    expect(rows[1]).toEqual(['Taller, S.A.', 'Quetzaltenango', 'taller.gt']);
  });

  it('maneja comillas escapadas ("")', () => {
    const rows = parseCsvRows('name\n"El ""Mejor"" Taller"\n');
    expect(rows[1]).toEqual(['El "Mejor" Taller']);
  });

  it('soporta CRLF y saltos de linea dentro de comillas', () => {
    const rows = parseCsvRows('name,city\r\n"Linea1\nLinea2",Xela\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['Linea1\nLinea2', 'Xela']);
  });

  it('ignora filas totalmente vacias', () => {
    const rows = parseCsvRows('a,b\n\n\nx,y\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x', 'y'],
    ]);
  });

  it('cierra la ultima fila sin salto final', () => {
    const rows = parseCsvRows('a,b\nx,y');
    expect(rows[1]).toEqual(['x', 'y']);
  });
});

describe('toCsv — anti CSV-injection', () => {
  it('neutraliza valores que empiezan con = + - @ con comilla simple', () => {
    const out = toCsv([{ nombre: '=cmd|calc', x: '+1', y: '-2', z: '@ref' }]);
    const dataLine = out.split('\n')[1] ?? '';
    // Cada valor peligroso queda prefijado con ' (y entrecomillado si hace falta).
    expect(dataLine).toContain("'=cmd|calc");
    expect(dataLine).toContain("'+1");
    expect(dataLine).toContain("'-2");
    expect(dataLine).toContain("'@ref");
  });

  it('entrecomilla valores con coma, comilla o salto de linea (incluido \\r)', () => {
    const out = toCsv([{ a: 'x,y', b: 'di "hola"', c: 'l1\rl2' }]);
    const dataLine = out.split('\n')[1] ?? '';
    expect(dataLine).toContain('"x,y"');
    expect(dataLine).toContain('"di ""hola"""');
    expect(dataLine).toContain('"l1\rl2"');
  });

  it('deja valores normales sin tocar', () => {
    const out = toCsv([{ a: 'Taller Lopez', b: '55' }]);
    expect(out).toBe('a,b\nTaller Lopez,55\n');
  });
});

describe('slugify / uniqueSlug', () => {
  it('normaliza acentos y simbolos', () => {
    expect(slugify('Café Río & Más')).toBe('cafe-rio-mas');
  });

  it('evita colisiones anexando sufijo', () => {
    const used = new Set<string>();
    expect(uniqueSlug('cafe-rio', used)).toBe('cafe-rio');
    expect(uniqueSlug('cafe-rio', used)).toBe('cafe-rio-2');
    expect(uniqueSlug('cafe-rio', used)).toBe('cafe-rio-3');
  });

  it('dos nombres que colapsan al mismo slug no se sobrescriben', () => {
    const used = new Set<string>();
    const a = uniqueSlug(slugify('Café Río'), used);
    const b = uniqueSlug(slugify('Cafe Rio'), used);
    expect(a).not.toBe(b);
  });
});
