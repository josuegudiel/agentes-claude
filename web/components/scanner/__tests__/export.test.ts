import { describe, expect, it } from 'vitest';
import { outputNames, pdfPageSize, pdfPlacement, sanitizeFilename } from '../export';

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

/**
 * Reproduce la matriz que escribe jsPDF.addImage con rotacion: traslada a
 * (x, pageH - y - h) en coordenadas PDF (y hacia arriba), gira `angle`
 * grados antihorario y escala a (w, h). (u, v) es un punto de la imagen
 * en [0,1]^2 con v=1 en el borde SUPERIOR de la foto.
 */
function jspdfPoint(pl: ReturnType<typeof pdfPlacement>, u: number, v: number): [number, number] {
  const t = (pl.angle * Math.PI) / 180;
  const c = Number(Math.cos(t).toFixed(4));
  const s = Number(Math.sin(t).toFixed(4));
  const px = u * pl.drawW;
  const py = v * pl.drawH;
  return [pl.x + c * px - s * py, pl.pageH - pl.y - pl.drawH + s * px + c * py];
}

describe('pdfPlacement', () => {
  const W = 3000;
  const H = 4000;
  // Donde debe terminar la esquina superior izquierda de la foto al girarla
  // en sentido horario (en coordenadas PDF: origen abajo a la izquierda).
  const cases = [
    { r: 0, topLeft: 'arriba-izq' },
    { r: 90, topLeft: 'arriba-der' },
    { r: 180, topLeft: 'abajo-der' },
    { r: 270, topLeft: 'abajo-izq' },
  ] as const;

  for (const { r, topLeft } of cases) {
    it(`giro ${r}: la foto llena la hoja y su esquina sup. izq. queda ${topLeft}`, () => {
      const pl = pdfPlacement(W, H, r);
      // La hoja tiene la orientacion de la foto girada.
      const landscape = r === 90 || r === 270;
      expect(pl.pageW > pl.pageH).toBe(landscape);
      expect(Math.max(pl.pageW, pl.pageH)).toBeLessThanOrEqual(841.89 + 1e-6);

      const corners = [jspdfPoint(pl, 0, 0), jspdfPoint(pl, 1, 0), jspdfPoint(pl, 0, 1), jspdfPoint(pl, 1, 1)];
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      // Cubre exactamente la hoja (ni se sale ni deja franjas).
      expect(Math.min(...xs)).toBeCloseTo(0, 1);
      expect(Math.min(...ys)).toBeCloseTo(0, 1);
      expect(Math.max(...xs)).toBeCloseTo(pl.pageW, 1);
      expect(Math.max(...ys)).toBeCloseTo(pl.pageH, 1);

      const expected: Record<string, [number, number]> = {
        'arriba-izq': [0, pl.pageH],
        'arriba-der': [pl.pageW, pl.pageH],
        'abajo-der': [pl.pageW, 0],
        'abajo-izq': [0, 0],
      };
      const tl = jspdfPoint(pl, 0, 1);
      expect(tl[0]).toBeCloseTo(expected[topLeft]![0], 1);
      expect(tl[1]).toBeCloseTo(expected[topLeft]![1], 1);
    });
  }
});
