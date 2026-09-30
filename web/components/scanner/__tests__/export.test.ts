import { describe, expect, it } from 'vitest';
import { outputNames, pdfPageSize, sanitizeFilename } from '../export';

describe('sanitizeFilename', () => {
  it('conserva letras con tilde y la ene', () => {
    expect(sanitizeFilename('Contraseña')).toBe('Contraseña');
    expect(sanitizeFilename('Recibo_Médico-2026')).toBe('Recibo_Médico-2026');
  });

  it('reemplaza espacios y simbolos sin dejar "_" repetidos', () => {
    expect(sanitizeFilename('factura  de   junio!!')).toBe('factura_de_junio');
    expect(sanitizeFilename('a/b\\c:d*e?f')).toBe('a_b_c_d_e_f');
  });

  it('no permite rutas ni nombres vacios', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFilename('')).toBe('escaneo');
    expect(sanitizeFilename('   ')).toBe('escaneo');
    expect(sanitizeFilename('***')).toBe('escaneo');
  });

  it('limita el largo', () => {
    expect(sanitizeFilename('x'.repeat(300))).toHaveLength(80);
  });
});

describe('pdfPageSize', () => {
  it('una pagina vertical cabe en A4 vertical conservando el aspecto', () => {
    const s = pdfPageSize(3000, 4000);
    expect(s.width).toBeLessThanOrEqual(595.28 + 1e-6);
    expect(s.height).toBeLessThanOrEqual(841.89 + 1e-6);
    expect(s.width / s.height).toBeCloseTo(3000 / 4000, 6);
  });

  it('una pagina horizontal usa A4 apaisado', () => {
    const s = pdfPageSize(4000, 3000);
    expect(s.width).toBeGreaterThan(s.height);
    expect(s.width).toBeLessThanOrEqual(841.89 + 1e-6);
    expect(s.height).toBeLessThanOrEqual(595.28 + 1e-6);
  });

  it('ya no mide 1 pt por pixel (paginas de metro y medio)', () => {
    const s = pdfPageSize(4096, 4096);
    expect(s.width).toBeLessThan(600);
  });
});

describe('outputNames', () => {
  it('un archivo sin sufijo, varios numerados', () => {
    expect(outputNames('doc', 1, 'jpg')).toEqual(['doc.jpg']);
    expect(outputNames('doc', 3, 'png')).toEqual(['doc_1.png', 'doc_2.png', 'doc_3.png']);
  });
});
