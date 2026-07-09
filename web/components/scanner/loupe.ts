/**
 * Matematica de la lupa de precision del editor. En movil el dedo tapa
 * exactamente la esquina que estas ajustando — CamScanner resuelve esto
 * con una lupa que muestra la zona bajo el dedo ampliada. Aqui va el
 * calculo puro (testeable en node); el dibujo vive en EditView.
 */

export interface LoupeRects {
  /** Rectangulo fuente (en pixeles del canvas de preview), ya clampeado. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Donde dibujar ese rect dentro de la lupa para que el punto quede
   * centrado bajo la cruz aunque el rect se haya clampeado en un borde. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Calcula el rect fuente (centrado en cx,cy y clampeado a los limites del
 * canvas) y el rect destino correspondiente dentro de la lupa.
 *
 * Invariante clave: el pixel (cx, cy) de la fuente siempre cae en el
 * centro de la lupa — cuando el rect se clampea contra un borde, el
 * destino se desplaza en la misma proporcion en vez de "resbalar".
 */
export function loupeRects(
  cx: number,
  cy: number,
  srcW: number,
  srcH: number,
  size: number,
  zoom: number,
): LoupeRects {
  const span = size / zoom;
  const half = span / 2;

  let sx = cx - half;
  let sy = cy - half;
  let sw = span;
  let sh = span;
  let dx = 0;
  let dy = 0;

  if (sx < 0) {
    dx = -sx * zoom;
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    dy = -sy * zoom;
    sh += sy;
    sy = 0;
  }
  if (sx + sw > srcW) sw = srcW - sx;
  if (sy + sh > srcH) sh = srcH - sy;

  sw = Math.max(0, sw);
  sh = Math.max(0, sh);

  return { sx, sy, sw, sh, dx, dy, dw: sw * zoom, dh: sh * zoom };
}

/**
 * De que lado del contenedor poner la lupa para que el dedo no la tape:
 * esquina en la mitad izquierda -> lupa arriba a la derecha, y viceversa.
 */
export function loupePlacement(cornerX: number): 'left' | 'right' {
  return cornerX < 0.5 ? 'right' : 'left';
}
