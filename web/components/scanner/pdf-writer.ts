/**
 * Escritor de PDF minimo, hecho para este caso: cada pagina es UN JPEG.
 *
 * Por que no jsPDF: jsPDF convierte cada JPEG a un string binario, une todo
 * el documento en un string gigante y lo vuelve a copiar a un ArrayBuffer:
 * ~4x el tamano del PDF en memoria transitoria y segundos de CPU. Con 60
 * paginas (~90 MB) eso puede matar la pestana en un iPhone. Aqui el PDF es
 * un `Blob` armado con partes: cabeceras de texto + los Blobs JPEG tal cual
 * (el navegador no los copia a JS; sin recomprimir).
 *
 * El giro de cada pagina va en la matriz de dibujo (sin tocar el JPEG).
 */

import type { Rotation } from './pages';

export type PaperSize = 'auto' | 'carta' | 'a4' | 'oficio';

/** Tamanos en puntos (1 pt = 1/72 in), vertical. */
export const PAPERS: Record<Exclude<PaperSize, 'auto'>, { w: number; h: number; label: string }> = {
  carta: { w: 612, h: 792, label: 'Carta' }, // 8.5 x 11 in
  a4: { w: 595.28, h: 841.89, label: 'A4' },
  oficio: { w: 612, h: 936, label: 'Oficio' }, // 8.5 x 13 in (Centroamerica)
};

export interface PdfPageInput {
  blob: Blob;
  /** Pixeles del JPEG (sin girar). */
  width: number;
  height: number;
  rotation: Rotation;
}

export interface PageLayout {
  pageW: number;
  pageH: number;
  /** Matriz [a b c d e f] que lleva el cuadrado unidad de la imagen a la hoja. */
  matrix: [number, number, number, number, number, number];
  /** Resolucion efectiva de la imagen impresa en esa hoja. */
  dpi: number;
}

/**
 * Hoja y matriz para una imagen de w x h px girada r (horario).
 *   - 'auto': la hoja tiene la proporcion de la imagen, escalada para caber
 *     en un A4 (no hay bordes blancos).
 *   - papel fijo: hoja exacta (vertical u horizontal segun la imagen) con la
 *     imagen centrada y entera dentro (bordes blancos si la proporcion no
 *     coincide).
 */
export function pageLayout(w: number, h: number, r: Rotation, paper: PaperSize): PageLayout {
  const sideways = r === 90 || r === 270;
  const tw = sideways ? h : w; // imagen ya girada, en px
  const th = sideways ? w : h;
  let pageW: number;
  let pageH: number;
  if (paper === 'auto') {
    const a4 = PAPERS.a4;
    const boxW = th >= tw ? a4.w : a4.h;
    const boxH = th >= tw ? a4.h : a4.w;
    const s = Math.min(boxW / tw, boxH / th);
    pageW = tw * s;
    pageH = th * s;
  } else {
    const p = PAPERS[paper];
    const landscape = tw > th;
    pageW = landscape ? p.h : p.w;
    pageH = landscape ? p.w : p.h;
  }
  const s = Math.min(pageW / tw, pageH / th); // pt por px
  const dw = w * s; // imagen SIN girar, en pt
  const dh = h * s;
  const ox = (pageW - tw * s) / 2;
  const oy = (pageH - th * s) / 2;
  let matrix: PageLayout['matrix'];
  switch (r) {
    case 90:
      matrix = [0, -dw, dh, 0, ox, oy + dw];
      break;
    case 180:
      matrix = [-dw, 0, 0, -dh, ox + dw, oy + dh];
      break;
    case 270:
      matrix = [0, dw, -dh, 0, ox + dh, oy];
      break;
    default:
      matrix = [dw, 0, 0, dh, ox, oy];
  }
  return { pageW, pageH, matrix, dpi: Math.round(72 / s) };
}

/** Componentes de color y tamano de un JPEG (lee el marcador SOF). */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Marcadores sin longitud.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
        components: bytes[i + 9]!,
      };
    }
    if (marker === 0xda) return null; // empezo la imagen sin SOF
    i += 2 + len;
  }
  return null;
}

const num = (n: number): string => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Bytes de un string ASCII (todo el PDF fuera de los JPEG lo es). */
const enc = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

function pdfDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * Arma el PDF. Lee solo la cabecera de cada JPEG (para saber si es color o
 * gris); el resto del JPEG va al Blob sin pasar por JS.
 */
export async function buildPdf(pages: PdfPageInput[], paper: PaperSize = 'auto', now: Date = new Date()): Promise<Blob> {
  if (pages.length === 0) throw new Error('No hay paginas para exportar');
  const parts: BlobPart[] = [];
  const offsets: number[] = [0]; // objeto 0: libre
  let pos = 0;
  const push = (part: Uint8Array | Blob): void => {
    parts.push(part as BlobPart);
    pos += part instanceof Blob ? part.size : part.byteLength;
  };
  const text = (s: string): void => push(enc(s));
  const startObj = (n: number): void => {
    offsets[n] = pos;
    text(`${n} 0 obj\n`);
  };

  // Cabecera + comentario binario (los lectores lo usan para saber que el
  // archivo es binario).
  text('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const n = pages.length;
  // 1 catalogo, 2 arbol de paginas, 3 info; por pagina: hoja, contenido, imagen.
  const pageObj = (i: number): number => 4 + i * 3;
  const kids = Array.from({ length: n }, (_, i) => `${pageObj(i)} 0 R`).join(' ');

  startObj(1);
  text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  text(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);
  startObj(3);
  text(`<< /Producer (ScannerFree) /Creator (ScannerFree) /CreationDate (${pdfDate(now)}) >>\nendobj\n`);

  for (let i = 0; i < n; i++) {
    const p = pages[i]!;
    const head = new Uint8Array(await p.blob.slice(0, 256 * 1024).arrayBuffer());
    const info = jpegInfo(head);
    if (!info) throw new Error(`La página ${i + 1} no es un JPEG válido`);
    const colorSpace =
      info.components === 1 ? '/DeviceGray' : info.components === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
    // Se usa el tamano real del JPEG (por si no coincidiera con el guardado).
    const lay = pageLayout(info.width, info.height, p.rotation, paper);
    const [a, b, c, d, e, f] = lay.matrix;
    const content = `q ${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)} cm /Im0 Do Q`;
    const po = pageObj(i);

    startObj(po);
    text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(lay.pageW)} ${num(lay.pageH)}] ` +
        `/Resources << /XObject << /Im0 ${po + 2} 0 R >> >> /Contents ${po + 1} 0 R >>\nendobj\n`,
    );
    startObj(po + 1);
    text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    startObj(po + 2);
    text(
      `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.blob.size} >>\nstream\n`,
    );
    push(p.blob);
    text('\nendstream\nendobj\n');
  }

  const size = 4 + n * 3;
  const xrefPos = pos;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let k = 1; k < size; k++) xref += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`;
  text(xref);
  text(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
