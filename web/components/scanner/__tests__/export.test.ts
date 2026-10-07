import { describe, expect, it } from 'vitest';
import { defaultFilename, outputNames, sanitizeFilename } from '../export';

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

describe('outputNames', () => {
  it('un archivo sin sufijo, varios numerados', () => {
    expect(outputNames('doc', 1, 'jpg')).toEqual(['doc.jpg']);
    expect(outputNames('doc', 3, 'png')).toEqual(['doc_1.png', 'doc_2.png', 'doc_3.png']);
  });
});

describe('defaultFilename', () => {
  it('usa la fecha local AAAA-MM-DD', () => {
    expect(defaultFilename('es', new Date(2026, 9, 4, 23, 59))).toBe('escaneo_2026-10-04');
    expect(defaultFilename('es', new Date(2027, 0, 9))).toBe('escaneo_2027-01-09');
    expect(defaultFilename('en', new Date(2027, 0, 9))).toBe('scan_2027-01-09');
  });
});
