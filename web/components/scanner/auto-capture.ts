import type { Quad } from './perspective';

/**
 * Logica pura del modo auto-captura: mientras la camara esta en vivo se
 * corre la deteccion de bordes sobre frames reducidos; cuando el quad
 * detectado se mantiene ESTABLE varios ticks seguidos (el usuario dejo de
 * mover el telefono), se dispara la captura sola — el flujo de CamScanner.
 * Si la deteccion falla de forma sostenida, el caller muestra la alerta
 * de "poco contraste".
 */

/** Ticks consecutivos con quad estable para disparar la captura. */
export const STABLE_TICKS_NEEDED = 3;
/** Movimiento maximo por esquina entre ticks (coords normalizadas 0..1). */
export const STABILITY_TOLERANCE = 0.03;
/** Ticks consecutivos SIN deteccion antes de avisar "poco contraste". */
export const LOW_CONTRAST_TICKS = 9;
/** Pausa tras una auto-captura antes de volver a buscar (ms). */
export const AUTO_COOLDOWN_MS = 2600;

/**
 * Tras una captura, cuanto debe cambiar la escena (esquina que mas se
 * movio, coords 0..1) para volver a auto-capturar. Sin esto, una hoja que
 * se queda quieta se capturaba una y otra vez cada ~3 s.
 */
export const REARM_SHIFT = 0.12;

/** Distancia maxima entre esquinas correspondientes de dos quads. */
export function quadShift(a: Quad, b: Quad): number {
  let max = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y);
    if (d > max) max = d;
  }
  return max;
}

/**
 * true si la secuencia (mas reciente al final) tiene al menos `needed`
 * quads consecutivos donde cada salto entre vecinos es < `tolerance`.
 */
export function isStableSequence(
  history: Quad[],
  needed: number = STABLE_TICKS_NEEDED,
  tolerance: number = STABILITY_TOLERANCE,
): boolean {
  if (history.length < needed) return false;
  const recent = history.slice(-needed);
  for (let i = 1; i < recent.length; i++) {
    if (quadShift(recent[i - 1]!, recent[i]!) > tolerance) return false;
  }
  return true;
}

/**
 * Mapea un punto normalizado del FRAME DE VIDEO al espacio visible del
 * contenedor cuando el video se muestra con object-fit: cover (el video
 * se recorta por el centro para llenar la caja). Sin este mapeo, el
 * overlay del quad queda corrido cuando el aspect del video no coincide
 * con el del visor.
 *
 * Devuelve coords normalizadas del contenedor; pueden salirse de [0,1]
 * si el punto cae en la zona recortada.
 */
export function mapCoverPoint(
  p: { x: number; y: number },
  videoW: number,
  videoH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number } {
  if (videoW <= 0 || videoH <= 0 || boxW <= 0 || boxH <= 0) return p;
  const videoAspect = videoW / videoH;
  const boxAspect = boxW / boxH;

  if (videoAspect > boxAspect) {
    // El video es mas ancho: cover recorta los lados.
    const visibleFrac = boxAspect / videoAspect; // fraccion visible del ancho
    const x0 = (1 - visibleFrac) / 2;
    return { x: (p.x - x0) / visibleFrac, y: p.y };
  }
  // El video es mas alto: cover recorta arriba/abajo.
  const visibleFrac = videoAspect / boxAspect;
  const y0 = (1 - visibleFrac) / 2;
  return { x: p.x, y: (p.y - y0) / visibleFrac };
}

/**
 * Re-armado de la auto-captura despues de una foto: se vuelve a armar
 * cuando deja de verse el documento (se cambio la hoja / se movio el
 * telefono) o cuando el documento visible es claramente otro.
 * `reference` es el quad de la ultima captura (o el primero visto al abrir
 * la camara); null = aun no hay referencia.
 */
export function shouldRearm(reference: Quad | null, quad: Quad | null): boolean {
  if (!quad) return true;
  if (!reference) return false;
  return quadShift(reference, quad) > REARM_SHIFT;
}
