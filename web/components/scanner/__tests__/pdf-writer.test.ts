import { describe, expect, it } from 'vitest';
import type { Rotation } from '../pages';
import { PAPERS, buildPdf, jpegInfo, pageLayout, type PaperSize } from '../pdf-writer';

/** JPEG minimo valido para las cabeceras (SOI, APP0, SOF0 3 comp, SOS, EOI). */
function fakeJpeg(w: number, h: number, components = 3): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sofLen = 8 + components * 3;
  const sof = [0xff, 0xc0, sofLen >> 8, sofLen & 0xff, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, components];
  for (let c = 0; c < components; c++) sof.push(c + 1, 0x11, 0);
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xda, 0x00, 0x02, 0x00, 0xff, 0xd9]);
}

/** Punto (u, v) de la imagen (v=1 = borde SUPERIOR) en coordenadas de la hoja. */
function map(m: number[], u: number, v: number): [number, number] {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  return [a * u + c * v + e, b * u + d * v + f];
}

describe('jpegInfo', () => {
  it('lee tamano y componentes del SOF', () => {
    expect(jpegInfo(fakeJpeg(3508, 2480))).toEqual({ width: 3508, height: 2480, components: 3 });
    expect(jpegInfo(fakeJpeg(10, 20, 1))).toEqual({ width: 10, height: 20, components: 1 });
  });
  it('null si no es JPEG', () => {
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('pageLayout', () => {
  const W = 3000;
  const H = 4000;
  // Donde termina la esquina superior izquierda de la foto al girarla en
  // sentido horario (coordenadas PDF: origen abajo a la izquierda).
  const corner: Record<Rotation, 'tl' | 'tr' | 'br' | 'bl'> = { 0: 'tl', 90: 'tr', 180: 'br', 270: 'bl' };
  const papers: PaperSize[] = ['auto', 'carta', 'a4', 'oficio'];

  for (const paper of papers) {
    for (const r of [0, 90, 180, 270] as Rotation[]) {
      it(`${paper} · giro ${r}: la foto queda entera, centrada y bien orientada`, () => {
        const lay = pageLayout(W, H, r, paper);
        const sideways = r === 90 || r === 270;
        expect(lay.pageW > lay.pageH).toBe(sideways);
        if (paper !== 'auto') {
          const p = PAPERS[paper];
          expect([lay.pageW, lay.pageH].sort((x, y) => x - y)).toEqual([p.w, p.h].sort((x, y) => x - y));
        }
        const pts = [map(lay.matrix, 0, 0), map(lay.matrix, 1, 0), map(lay.matrix, 0, 1), map(lay.matrix, 1, 1)];
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        // Dentro de la hoja.
        expect(minX).toBeGreaterThanOrEqual(-1e-6);
        expect(minY).toBeGreaterThanOrEqual(-1e-6);
        expect(maxX).toBeLessThanOrEqual(lay.pageW + 1e-6);
        expect(maxY).toBeLessThanOrEqual(lay.pageH + 1e-6);
        // Centrada (margenes iguales) y tocando al menos un par de bordes.
        expect(minX).toBeCloseTo(lay.pageW - maxX, 3);
        expect(minY).toBeCloseTo(lay.pageH - maxY, 3);
        expect(Math.min(minX, minY)).toBeCloseTo(0, 3);
        if (paper === 'auto') {
          expect(minX).toBeCloseTo(0, 3);
          expect(minY).toBeCloseTo(0, 3);
        }
        const tl = map(lay.matrix, 0, 1);
        const want = {
          tl: [minX, maxY],
          tr: [maxX, maxY],
          br: [maxX, minY],
          bl: [minX, minY],
        }[corner[r]];
        expect(tl[0]).toBeCloseTo(want[0]!, 3);
        expect(tl[1]).toBeCloseTo(want[1]!, 3);
      });
    }
  }

  it('A4 escaneado a 2480x3508 en hoja A4 = 300 dpi', () => {
    expect(pageLayout(2480, 3508, 0, 'a4').dpi).toBe(300);
    expect(pageLayout(2480, 3508, 0, 'auto').dpi).toBe(300);
  });
});

async function pdfBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('buildPdf', () => {
  it('xref apunta exactamente a cada objeto y el trailer es valido', async () => {
    const pages = [
      { blob: new Blob([fakeJpeg(300, 400) as BlobPart]), width: 300, height: 400, rotation: 0 as Rotation },
      { blob: new Blob([fakeJpeg(400, 300, 1) as BlobPart]), width: 400, height: 300, rotation: 90 as Rotation },
    ];
    const bytes = await pdfBytes(await buildPdf(pages, 'carta', new Date(Date.UTC(2026, 9, 4))));
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const xref = text.slice(startxref).split('\n');
    const count = Number(xref[1]!.split(' ')[1]);
    expect(count).toBe(4 + pages.length * 3);
    for (let i = 1; i < count; i++) {
      const off = Number(xref[2 + i]!.slice(0, 10));
      expect(text.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
    // Cada entrada xref mide exactamente 20 bytes.
    expect(xref[2]!.length + 1).toBe(20);
    // Gris -> DeviceGray; color -> DeviceRGB; JPEG incrustado sin tocar.
    expect(text).toContain('/ColorSpace /DeviceRGB');
    expect(text).toContain('/ColorSpace /DeviceGray');
    expect(text).toContain('/Filter /DCTDecode');
    // 400x300 girada 90 queda vertical: carta vertical.
    expect(text).toContain('/MediaBox [0 0 612 792]');
  });

  it('pdf.js lo abre: numero de hojas y tamanos', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pages = [
      { blob: new Blob([fakeJpeg(2480, 3508) as BlobPart]), width: 2480, height: 3508, rotation: 0 as Rotation },
      { blob: new Blob([fakeJpeg(2480, 3508) as BlobPart]), width: 2480, height: 3508, rotation: 270 as Rotation },
      { blob: new Blob([fakeJpeg(1000, 1000) as BlobPart]), width: 1000, height: 1000, rotation: 0 as Rotation },
    ];
    const data = await pdfBytes(await buildPdf(pages, 'auto'));
    const task = pdfjs.getDocument({ data, verbosity: 0, stopAtErrors: true });
    const doc = await task.promise;
    expect(doc.numPages).toBe(3);
    const v1 = (await doc.getPage(1)).getViewport({ scale: 1 });
    expect(v1.width).toBeCloseTo(595.28, 0);
    expect(v1.height).toBeCloseTo(841.89, 0);
    const v2 = (await doc.getPage(2)).getViewport({ scale: 1 });
    expect(v2.width).toBeGreaterThan(v2.height);
    await task.destroy();
  });

  it('rechaza una pagina que no es JPEG', async () => {
    await expect(
      buildPdf([{ blob: new Blob(['hola']), width: 1, height: 1, rotation: 0 }]),
    ).rejects.toThrow(/JPEG/);
  });
});
