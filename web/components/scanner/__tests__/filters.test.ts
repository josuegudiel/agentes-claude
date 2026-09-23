import { describe, expect, it } from 'vitest';
import { applyFilter, FILTERS, __test } from '../filters';

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

  it('vivid: preserva color neutro (gris medio) casi sin cambios', () => {
    const img = makeImageData(4, 4, () => [128, 128, 128, 255]);
    const out = applyFilter(img, 'vivid');
    // Gris puro -> la saturacion no cambia nada (R=G=B=Y) y la curva S
    // en el punto medio es ~neutra.
    for (let i = 0; i < out.data.length; i += 4) {
      expect(Math.abs(out.data[i]! - 128)).toBeLessThanOrEqual(2);
      expect(Math.abs(out.data[i + 1]! - 128)).toBeLessThanOrEqual(2);
      expect(Math.abs(out.data[i + 2]! - 128)).toBeLessThanOrEqual(2);
    }
  });

  it('vivid: aumenta saturacion en color puro', () => {
    // Pixel rojo medio (180,80,80) -> el boost de saturacion debe alejar
    // el R del luma y acercar G/B mas al luma.
    const img = makeImageData(2, 2, () => [180, 80, 80, 255]);
    const out = applyFilter(img, 'vivid');
    // R aumenta, G y B bajan.
    expect(out.data[0]!).toBeGreaterThan(180);
    expect(out.data[1]!).toBeLessThan(80);
    expect(out.data[2]!).toBeLessThan(80);
  });

  it('doc: elimina iluminacion despareja — el papel queda blanco parejo', () => {
    // Papel con gradiente de luz (140 a la izquierda, 230 a la derecha)
    // y un bloque de "texto" oscuro en el centro.
    const w = 96;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const paper = 140 + Math.round((x / (w - 1)) * 90);
      const inText = x >= 40 && x < 56 && y >= 26 && y < 38;
      const v = inText ? 25 : paper;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'doc');

    // El papel de AMBOS lados debe quedar igual de blanco (>=225) —
    // antes del filtro el lado izquierdo estaba en 140.
    const leftPaper = out.data[(32 * w + 6) * 4]!;
    const rightPaper = out.data[(32 * w + (w - 6)) * 4]!;
    expect(leftPaper).toBeGreaterThanOrEqual(225);
    expect(rightPaper).toBeGreaterThanOrEqual(225);
    expect(Math.abs(leftPaper - rightPaper)).toBeLessThanOrEqual(15);

    // El texto sigue oscuro.
    const text = out.data[(32 * w + 48) * 4]!;
    expect(text).toBeLessThan(110);
  });

  it('receipt: realza texto desvanecido — el contraste aumenta', () => {
    // Ticket termico: papel 215 con texto gris apenas visible (150).
    const w = 64;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const inText = y >= 24 && y < 40 && x >= 12 && x < 52 && y % 6 < 3;
      const v = inText ? 150 : 215;
      return [v, v, v, 255];
    });
    const before = 215 - 150;
    const out = applyFilter(img, 'receipt');

    const paper = out.data[(6 * w + 6) * 4]!;
    const text = out.data[(25 * w + 30) * 4]!;
    expect(paper).toBeGreaterThanOrEqual(240);
    expect(text).toBeLessThan(110);
    expect(paper - text).toBeGreaterThan(before * 2);
  });

  it('sharpen: aumenta el contraste local en un borde', () => {
    // Step vertical 100|150 en el centro.
    const w = 16;
    const h = 8;
    const img = makeImageData(w, h, (x) => {
      const v = x < 8 ? 100 : 150;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'sharpen');

    // Junto al borde: el lado oscuro se oscurece y el claro se aclara.
    const darkEdge = out.data[(4 * w + 7) * 4]!;
    const brightEdge = out.data[(4 * w + 8) * 4]!;
    expect(darkEdge).toBeLessThan(100);
    expect(brightEdge).toBeGreaterThan(150);

    // Lejos del borde, sin cambios (blur == valor).
    expect(out.data[(4 * w + 2) * 4]).toBe(100);
    expect(out.data[(4 * w + 13) * 4]).toBe(150);
  });

  it('photo: el balance de blancos corrige una dominante de color', () => {
    // Imagen con dominante azul: los canales deben converger.
    const img = makeImageData(16, 16, () => [100, 120, 180, 255]);
    const before = 180 - 100;
    const out = applyFilter(img, 'photo');
    const diff = Math.abs(out.data[2]! - out.data[0]!);
    expect(diff).toBeLessThan(before / 2);
  });

  it('magic: revela el detalle de la mitad en sombra y limpia el gris casi blanco', () => {
    // Mitad izquierda en sombra (papel 55) con franjas de tinta (40); mitad
    // derecha iluminada (papel 215) con franjas apenas visibles (200, 93%
    // del papel: grano/suciedad, no tinta).
    const w = 64;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const dark = x < 32;
      const detail = y % 8 < 4;
      const v = dark ? (detail ? 40 : 55) : detail ? 200 : 215;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'magic');
    const at = (x: number, y: number): number => out.data[(y * w + x) * 4]!;
    // En sombra: la tinta se separa del papel mucho mas que en el original (15).
    expect(Math.abs(at(16, 2) - at(16, 6))).toBeGreaterThan(30);
    // El papel en sombra se levanta a blanco.
    expect(at(16, 6)).toBeGreaterThanOrEqual(230);
    // Lo casi blanco del lado iluminado queda blanco limpio.
    expect(at(48, 2)).toBeGreaterThanOrEqual(240);
    expect(at(48, 6)).toBeGreaterThanOrEqual(240);
  });

  it('vibrance: realza mas los colores apagados que los ya saturados', () => {
    const { vibrancePixel } = __test;
    const satOf = (r: number, g: number, b: number): number => {
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      return (mx - mn) / mx;
    };
    const muted = vibrancePixel(150, 130, 170, 0.8);
    const saturated = vibrancePixel(60, 40, 250, 0.8);
    const mutedGain = satOf(muted[0], muted[1], muted[2]) / satOf(150, 130, 170);
    const saturatedGain =
      satOf(saturated[0], saturated[1], saturated[2]) / satOf(60, 40, 250);
    expect(mutedGain).toBeGreaterThan(saturatedGain);
  });

  it('vibrance: protege los tonos de piel (calidos r>g>b)', () => {
    const { vibrancePixel } = __test;
    const satOf = (r: number, g: number, b: number): number => {
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      return (mx - mn) / mx;
    };
    // Mismo nivel de saturacion, uno calido (piel) y su espejo frio.
    const skin = vibrancePixel(200, 150, 120, 0.8);
    const cool = vibrancePixel(120, 150, 200, 0.8);
    const skinGain = satOf(skin[0], skin[1], skin[2]) / satOf(200, 150, 120);
    const coolGain = satOf(cool[0], cool[1], cool[2]) / satOf(120, 150, 200);
    expect(coolGain).toBeGreaterThan(skinGain);
  });

  it('sharpen: no amplifica ruido sutil (umbral)', () => {
    // Checkerboard de +-1 alrededor de 128: bajo el umbral -> intacto.
    const img = makeImageData(12, 12, (x, y) => {
      const v = 128 + ((x + y) % 2 === 0 ? 1 : -1);
      return [v, v, v, 255];
    });
    const copy = new Uint8ClampedArray(img.data);
    const out = applyFilter(img, 'sharpen');
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(copy[i]);
    }
  });

  it('doc: NO borra tintas de color palidas (texto verde/cafe claro)', () => {
    // Tarjeta blanca (235) con texto verde palido — luma alta pero CON
    // croma. El blanqueo viejo lo empujaba a blanco y lo hacia invisible.
    const w = 96;
    const h = 64;
    const green: [number, number, number, number] = [175, 205, 150, 255];
    const img = makeImageData(w, h, (x, y) => {
      const inText = x >= 20 && x < 76 && y >= 24 && y < 40;
      return inText ? green : [235, 235, 235, 255];
    });
    const out = applyFilter(img, 'doc');
    const i = (30 * w + 48) * 4;
    const r = out.data[i]!;
    const g = out.data[i + 1]!;
    const b = out.data[i + 2]!;
    // Sigue siendo VERDE (croma preservada) y sigue siendo VISIBLE
    // (mas oscuro que el papel, no blanco).
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(g - b).toBeGreaterThanOrEqual(30);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    expect(luma).toBeLessThan(215);
    // El papel sigue blanqueado.
    expect(out.data[(6 * w + 6) * 4]!).toBeGreaterThanOrEqual(240);
  });

  it('doc: una sombra profunda NUNCA queda mas oscura que el original', () => {
    // Papel 230 con una franja de sombra fuerte (papel a 80) y texto.
    const w = 96;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const inShadow = x < 30;
      const paper = inShadow ? 80 : 230;
      const inText = x >= 44 && x < 60 && y >= 26 && y < 38;
      const v = inText ? 25 : paper;
      return [v, v, v, 255];
    });
    const before = new Uint8ClampedArray(img.data);
    const out = applyFilter(img, 'doc');
    // Muestras de papel EN sombra: siempre mas claras que antes.
    for (const [sx, sy] of [[8, 10], [15, 32], [22, 55]] as const) {
      const idx = (sy * w + sx) * 4;
      expect(out.data[idx]!).toBeGreaterThan(before[idx]!);
      expect(out.data[idx]!).toBeGreaterThanOrEqual(200);
    }
  });

  it('magic: el papel en sombra tambien se levanta (no se re-oscurece)', () => {
    const w = 96;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const inShadow = x < 30;
      const paper = inShadow ? 90 : 225;
      const inText = x >= 44 && x < 60 && y >= 26 && y < 38;
      const v = inText ? 30 : paper;
      return [v, v, v, 255];
    });
    const before = new Uint8ClampedArray(img.data);
    const out = applyFilter(img, 'magic');
    const idx = (32 * w + 12) * 4; // papel en sombra
    expect(out.data[idx]!).toBeGreaterThan(before[idx]!);
  });

  it('shadow (Sin sombra): empareja la luz sin blanquear la tinta', () => {
    const w = 96;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const paper = x < 48 ? 110 : 220; // mitad en sombra
      const inText = x >= 20 && x < 32 && y >= 26 && y < 38;
      const v = inText ? 30 : paper;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'shadow');
    const shadowPaper = out.data[(10 * w + 10) * 4]!;
    const litPaper = out.data[(10 * w + 80) * 4]!;
    // Papel de ambos lados queda parejo.
    expect(Math.abs(shadowPaper - litPaper)).toBeLessThanOrEqual(25);
    expect(shadowPaper).toBeGreaterThanOrEqual(180);
    // La tinta sigue siendo oscura (no se blanquea).
    const text = out.data[(30 * w + 26) * 4]!;
    expect(text).toBeLessThan(120);
  });

  it('todos los filtros corren sin lanzar y preservan dimensiones', () => {
    for (const f of FILTERS) {
      const img = makeImageData(24, 18, (x, y) => [
        (x * 37) % 256,
        (y * 53) % 256,
        ((x + y) * 29) % 256,
        255,
      ]);
      const out = applyFilter(img, f.id);
      expect(out.width).toBe(24);
      expect(out.height).toBe(18);
      expect(out.data.length).toBe(24 * 18 * 4);
    }
  });

  it('magic: recupera texto de bajo contraste (papel 200, texto 150)', () => {
    const w = 64;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const inText = y >= 20 && y < 44 && x >= 10 && x < 54 && y % 6 < 2;
      const v = inText ? 150 : 200;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'magic');
    const paper = out.data[(4 * w + 4) * 4]!;
    const text = out.data[(24 * w + 30) * 4]!; // fila de texto (24 % 6 < 2)
    expect(paper).toBeGreaterThanOrEqual(245);
    expect(paper - text).toBeGreaterThan(100); // era 50
  });

  it('magic: una foto en el interior NO se lava a blanco', () => {
    // Papel 235 con una "foto" gris media (120) en el centro: es
    // contenido, no sombra — debe conservar su tono (no subir a blanco).
    const w = 96;
    const h = 96;
    const img = makeImageData(w, h, (x, y) => {
      const inPhoto = x >= 30 && x < 66 && y >= 30 && y < 66;
      const v = inPhoto ? 120 : 235;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'magic');
    const center = out.data[(48 * w + 48) * 4]!;
    expect(center).toBeLessThan(170);
    expect(center).toBeGreaterThanOrEqual(110); // y no se aplasta a negro
  });

  it('magic: el resaltador amarillo se conserva (no se blanquea)', () => {
    const w = 96;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const inHl = y >= 24 && y < 40 && x >= 16 && x < 80;
      return inHl ? [240, 228, 100, 255] : [236, 234, 228, 255];
    });
    const out = applyFilter(img, 'magic');
    const i = (32 * w + 48) * 4;
    // Sigue siendo amarillo: R,G altos y B claramente mas bajo.
    expect(out.data[i]! - out.data[i + 2]!).toBeGreaterThan(80);
    // Y el papel queda blanco neutro.
    const p = (6 * w + 6) * 4;
    expect(out.data[p]!).toBeGreaterThanOrEqual(245);
    expect(Math.abs(out.data[p]! - out.data[p + 2]!)).toBeLessThanOrEqual(4);
  });

  it('magic: quita la dominante de color de la luz (papel neutro)', () => {
    // Foto bajo luz de tungsteno: papel (240, 215, 165) con texto oscuro.
    const w = 96;
    const h = 64;
    const img = makeImageData(w, h, (x, y) => {
      const inText = x >= 30 && x < 66 && y >= 26 && y < 38;
      return inText ? [40, 36, 28, 255] : [240, 215, 165, 255];
    });
    const out = applyFilter(img, 'magic');
    const p = (6 * w + 6) * 4;
    expect(out.data[p]!).toBeGreaterThanOrEqual(245);
    expect(out.data[p + 2]!).toBeGreaterThanOrEqual(245); // el azul ya no falta
  });

  it('bw: un bloque negro ancho queda negro (no se vacia por dentro)', () => {
    const w = 128;
    const h = 96;
    const img = makeImageData(w, h, (x, y) => {
      const inBar = y >= 30 && y < 66 && x >= 16 && x < 112;
      const v = inBar ? 20 : 235;
      return [v, v, v, 255];
    });
    const out = applyFilter(img, 'bw');
    expect(out.data[(48 * w + 64) * 4]!).toBeLessThan(40);
    expect(out.data[(8 * w + 8) * 4]!).toBe(255);
  });

  it('bw: la limpieza borra motas sueltas y conserva los trazos', () => {
    const { removeSpecks } = __test;
    const w = 40;
    const h = 20;
    const ink = new Uint8Array(w * h);
    const out = new Uint8ClampedArray(w * h);
    // Mota de 2 pixeles y trazo de 30 pixeles.
    ink[5 * w + 5] = 1;
    ink[5 * w + 6] = 1;
    for (let x = 5; x < 35; x++) ink[12 * w + x] = 1;
    for (let j = 0; j < ink.length; j++) out[j] = ink[j] ? 0 : 255;
    removeSpecks(ink, out, w, h, 6);
    expect(out[5 * w + 5]).toBe(255);
    expect(out[5 * w + 6]).toBe(255);
    expect(out[12 * w + 20]).toBe(0);
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
