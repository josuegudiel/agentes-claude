import { describe, expect, it } from 'vitest';
import { applyFilter, __test } from '../filters';

/**
 * Tests unitarios de los filtros. Trabajamos con ImageData-shape objetos
 * (Uint8ClampedArray RGBA) — no necesitamos jsdom porque los filtros no
 * tocan el DOM, solo bufferes de pixeles.
 *
 * El objetivo central: cubrir el bug del box blur (sliding window mal
 * inicializado) que dejaba el filtro B&N adaptativo casi inservible para
 * documentos con fondo no-blanco.
 */

const { boxBlurSeparable } = __test;

function makeImageData(
  w: number,
  h: number,
  fill: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const [r, g, b, a] = fill(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

function makeGray(w: number, h: number, fill: (x: number, y: number) => number): Uint8ClampedArray {
  const arr = new Uint8ClampedArray(w * h);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      arr[i] = fill(x, y);
    }
  }
  return arr;
}

describe('boxBlurSeparable', () => {
  it('preserva input constante (regresion del bug del sliding window)', () => {
    // Antes del fix, el blur metia un offset proporcional a -r*src[0]/(2r+1)
    // y el resultado para input constante=200 daba ~100 en lugar de 200.
    const w = 32;
    const h = 32;
    const src = makeGray(w, h, () => 200);
    const out = boxBlurSeparable(src, w, h, 5);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(200);
    }
  });

  it('preserva input constante con radio chico', () => {
    const w = 16;
    const h = 16;
    const src = makeGray(w, h, () => 128);
    const out = boxBlurSeparable(src, w, h, 1);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(128);
    }
  });

  it('promedio correcto en step function 1D', () => {
    // r=1, w=5, step en x=2: el promedio en cada posicion debe coincidir
    // con el calculo manual con clamping de bordes.
    const w = 5;
    const h = 1;
    const src = makeGray(w, h, (x) => (x >= 2 ? 255 : 0));
    const out = boxBlurSeparable(src, w, h, 1);
    // Esperado:
    //  out[0] = avg(src[clamp(-1)], src[0], src[1]) = avg(0,0,0) = 0
    //  out[1] = avg(src[0], src[1], src[2])         = avg(0,0,255) = 85
    //  out[2] = avg(src[1], src[2], src[3])         = avg(0,255,255) = 170
    //  out[3] = avg(src[2], src[3], src[4])         = avg(255,255,255) = 255
    //  out[4] = avg(src[3], src[4], src[clamp(5)])  = avg(255,255,255) = 255
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(85);
    expect(out[2]).toBe(170);
    expect(out[3]).toBe(255);
    expect(out[4]).toBe(255);
  });

  it('suaviza una imagen 2D sin alterar el promedio global', () => {
    const w = 64;
    const h = 64;
    // Patron checkerboard 8x8: el promedio global es ~127.
    const src = makeGray(w, h, (x, y) =>
      Math.floor(x / 8) + Math.floor(y / 8) % 2 === 0 ? 0 : 255,
    );
    const out = boxBlurSeparable(src, w, h, 16);

    let srcSum = 0;
    let outSum = 0;
    for (let i = 0; i < src.length; i++) {
      srcSum += src[i]!;
      outSum += out[i]!;
    }
    // El promedio se preserva con ~1% de tolerancia (errores de cuantizacion
    // por Uint8ClampedArray).
    expect(Math.abs(outSum - srcSum) / src.length).toBeLessThan(3);
  });
});

describe('applyFilter', () => {
  it('grayscale: convierte color a gris preservando luminancia', () => {
    // Pixel rojo puro -> luma BT.601 = 0.299 * 255 = ~76.
    const img = makeImageData(2, 2, () => [255, 0, 0, 255]);
    const out = applyFilter(img, 'grayscale');
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(76);
      expect(out.data[i + 1]).toBe(76);
      expect(out.data[i + 2]).toBe(76);
      expect(out.data[i + 3]).toBe(255);
    }
  });

  it('bw: imagen blanca uniforme -> todo blanco', () => {
    const img = makeImageData(16, 16, () => [255, 255, 255, 255]);
    const out = applyFilter(img, 'bw');
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(255);
    }
  });

  it('bw: detecta texto oscuro sobre papel claro', () => {
    // Papel 240 con un cuadro de "texto" negro en el medio.
    const w = 32;
    const h = 32;
    const img = makeImageData(w, h, (x, y) => {
      const inText = x >= 12 && x < 20 && y >= 12 && y < 20;
      const v = inText ? 20 : 240;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'bw');

    // El centro del bloque de texto deberia ser negro (<128).
    const centerIdx = (16 * w + 16) * 4;
    expect(out.data[centerIdx]).toBeLessThan(128);

    // Una esquina del papel deberia ser blanca (>=128).
    const cornerIdx = (2 * w + 2) * 4;
    expect(out.data[cornerIdx]).toBeGreaterThanOrEqual(128);
  });

  it('color: preserva color neutro (gris) sin saturar', () => {
    const img = makeImageData(4, 4, () => [128, 128, 128, 255]);
    const out = applyFilter(img, 'color');
    // Gris puro -> la saturacion no cambia nada (R=G=B=Y). Solo el
    // contraste alrededor de 128 que no mueve este valor.
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(128);
      expect(out.data[i + 1]).toBe(128);
      expect(out.data[i + 2]).toBe(128);
    }
  });

  it('color: aumenta saturacion en color puro', () => {
    // Pixel rojo medio (180,80,80) -> el boost de saturacion debe alejar
    // el R del luma y acercar G/B mas al luma.
    const img = makeImageData(2, 2, () => [180, 80, 80, 255]);
    const out = applyFilter(img, 'color');
    // R aumenta, G y B bajan.
    expect(out.data[0]!).toBeGreaterThan(180);
    expect(out.data[1]!).toBeLessThan(80);
    expect(out.data[2]!).toBeLessThan(80);
  });

  it('magic: clipea histograma y centra en el rango (0..255)', () => {
    // Imagen con valores entre 50 y 200 — el magic clip deberia expandir
    // el rango usable cerca de [0..255].
    const img = makeImageData(32, 32, (x) => {
      const v = 50 + Math.floor((x / 32) * 150);
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'magic');

    // Verificamos que el rango de salida es mas amplio que el de entrada
    // (output minimo cerca de 0, output maximo cerca de 255).
    let min = 255;
    let max = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      min = Math.min(min, out.data[i]!);
      max = Math.max(max, out.data[i]!);
    }
    expect(min).toBeLessThan(40);
    expect(max).toBeGreaterThan(215);
  });

  it('original: no muta los pixeles', () => {
    const img = makeImageData(4, 4, (x, y) => [x * 60, y * 60, 100, 255]);
    const copy = new Uint8ClampedArray(img.data);
    const out = applyFilter(img, 'original');
    for (let i = 0; i < out.data.length; i++) {
      expect(out.data[i]).toBe(copy[i]);
    }
  });
});
