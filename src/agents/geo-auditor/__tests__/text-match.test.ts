import { describe, expect, it } from 'vitest';
import { containsWord, isSameSite, normalizeHost, normalizeText } from '../checks/text-match.js';

describe('normalizeText', () => {
  it('minusculas y sin acentos (la ñ se reduce a n, aceptable para matching)', () => {
    expect(normalizeText('LEÓN Ñandú')).toBe('leon nandu');
  });
});

describe('containsWord', () => {
  it('coincide por palabra completa ignorando acentos', () => {
    expect(containsWord('Muebleria en León centro', 'Leon')).toBe(true);
    expect(containsWord('Muebleria en Leon centro', 'León')).toBe(true);
  });

  it('NO coincide como subcadena de otra palabra', () => {
    expect(containsWord('Gimnasio Leonidas', 'Leon')).toBe(false);
    expect(containsWord('nuestro fundador Napoleon', 'Leon')).toBe(false);
  });

  it('coincide frases con espacios', () => {
    expect(containsWord('Servicios en Ciudad de Guatemala hoy', 'Ciudad de Guatemala')).toBe(true);
  });

  it('needle vacio es false', () => {
    expect(containsWord('lo que sea', '')).toBe(false);
  });
});

describe('isSameSite / normalizeHost', () => {
  it('normaliza www', () => {
    expect(normalizeHost('WWW.Example.com')).toBe('example.com');
  });

  it('mismo dominio con/sin www y subdominios', () => {
    expect(isSameSite('www.example.com', 'example.com')).toBe(true);
    expect(isSameSite('example.com', 'www.example.com')).toBe(true);
    expect(isSameSite('blog.example.com', 'example.com')).toBe(true);
    expect(isSameSite('otro.com', 'example.com')).toBe(false);
    // No confundir sufijo parcial:
    expect(isSameSite('notexample.com', 'example.com')).toBe(false);
  });
});
