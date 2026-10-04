'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Copia de `list` con el elemento de `from` movido a la posicion `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list.slice();
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

/** Mantener presionado este tiempo (ms) antes de poder arrastrar con el dedo. */
const LONG_PRESS_MS = 280;
/** Si el dedo se mueve mas que esto antes, era un scroll: no se arrastra. */
const TOUCH_SLOP = 10;
/** Con mouse se arrastra en cuanto se mueve esto (sin esperar). */
const MOUSE_SLOP = 6;
/** Zona (px) junto al borde del area desplazable que activa el auto-scroll. */
const EDGE = 64;

interface Press {
  id: number;
  kind: 'touch' | 'mouse';
  startX: number;
  startY: number;
  x: number;
  y: number;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  /** Posicion del dedo dentro de la hoja al empezar (para el "fantasma"). */
  offX: number;
  offY: number;
}

export interface Ghost {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Reordenar una grilla arrastrando:
 *
 *   - Dedo: mantener presionada la hoja ~0.3 s y arrastrar. Moverse antes
 *     cuenta como scroll normal de la lista (no se "roba" el gesto).
 *   - Mouse: arrastrar directamente.
 *
 * Mientras se arrastra, `order` es el orden provisorio (la hoja deja su
 * hueco donde caeria) y `ghost` la copia que sigue al dedo. Al soltar se
 * llama `onDrop(id, indiceFinal)` solo si cambio de lugar. Cerca de los
 * bordes del area desplazable la lista se desplaza sola.
 *
 * Cada hoja debe llevar `data-reorder-index={i}` (indice en `order`).
 */
export function useDragReorder({
  ids,
  scrollRef,
  onDrop,
}: {
  ids: number[];
  scrollRef: React.RefObject<HTMLElement | null>;
  onDrop: (id: number, toIndex: number) => void;
}): {
  order: number[];
  ghost: Ghost | null;
  draggingId: number | null;
  startTouch: (id: number, e: React.TouchEvent<HTMLElement>) => void;
  startMouse: (id: number, e: React.PointerEvent<HTMLElement>) => void;
  /** true si el click que llega es el final de un arrastre (ignorarlo). */
  swallowClick: () => boolean;
} {
  const [preview, setPreview] = useState<number[] | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const pressRef = useRef<Press | null>(null);
  const previewRef = useRef<number[] | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  // El click que el navegador dispara al soltar un arrastre NO debe abrir
  // el visor. Se marca al soltar y se limpia al empezar el proximo gesto
  // (no por tiempo: un toque rapido justo despues debe funcionar).
  const swallowNextClick = useRef(false);
  const rafRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const setOrder = (o: number[] | null): void => {
    previewRef.current = o;
    setPreview(o);
  };

  /** Mueve la hoja arrastrada al lugar de la hoja que esta bajo el dedo. */
  const hitTest = useCallback((x: number, y: number) => {
    const p = pressRef.current;
    const order = previewRef.current;
    if (!p?.active || !order) return;
    // La hoja bajo el dedo; si el dedo esta en un hueco o fuera de la
    // grilla (p.ej. debajo de la ultima hoja), la hoja mas cercana: asi
    // soltar "despues de todo" deja la hoja al final.
    let el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-reorder-index]') ?? null;
    if (!el) {
      let best = Infinity;
      scrollRef.current?.querySelectorAll<HTMLElement>('[data-reorder-index]').forEach((cand) => {
        const r = cand.getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          el = cand;
        }
      });
    }
    if (!el) return;
    const to = Number((el as HTMLElement).dataset.reorderIndex);
    const from = order.indexOf(p.id);
    if (Number.isFinite(to) && from >= 0 && to !== from) setOrder(moveItem(order, from, to));
  }, [scrollRef]);

  const finish = useCallback((commit: boolean) => {
    const p = pressRef.current;
    pressRef.current = null;
    if (p?.timer) clearTimeout(p.timer);
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    const order = previewRef.current;
    if (p?.active) {
      swallowNextClick.current = true;
      if (commit && order) {
        const to = order.indexOf(p.id);
        const from = idsRef.current.indexOf(p.id);
        if (to >= 0 && from >= 0 && to !== from) onDropRef.current(p.id, to);
      }
    }
    setOrder(null);
    setGhost(null);
  }, []);

  const activate = useCallback(() => {
    const p = pressRef.current;
    if (!p || p.active) return;
    const rect = p.el.getBoundingClientRect();
    p.active = true;
    p.timer = null;
    p.offX = p.startX - rect.left;
    p.offY = p.startY - rect.top;
    setOrder(idsRef.current.slice());
    setGhost({ id: p.id, x: p.x - p.offX, y: p.y - p.offY, width: rect.width, height: rect.height });
    try {
      navigator.vibrate?.(12);
    } catch {
      /* sin vibracion */
    }
    // Auto-scroll al acercarse a los bordes del area desplazable.
    const tick = (): void => {
      const cur = pressRef.current;
      const box = scrollRef.current;
      if (!cur?.active || !box) return;
      const r = box.getBoundingClientRect();
      let dy = 0;
      if (cur.y < r.top + EDGE) dy = -Math.ceil(((r.top + EDGE - cur.y) / EDGE) * 14);
      else if (cur.y > r.bottom - EDGE) dy = Math.ceil(((cur.y - (r.bottom - EDGE)) / EDGE) * 14);
      if (dy !== 0) {
        const before = box.scrollTop;
        box.scrollTop = before + dy;
        if (box.scrollTop !== before) hitTest(cur.x, cur.y);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [hitTest, scrollRef]);

  const move = useCallback(
    (x: number, y: number) => {
      const p = pressRef.current;
      if (!p) return;
      p.x = x;
      p.y = y;
      if (!p.active) return;
      setGhost((g) => (g ? { ...g, x: x - p.offX, y: y - p.offY } : g));
      hitTest(x, y);
    },
    [hitTest],
  );

  const startTouch = useCallback(
    (id: number, e: React.TouchEvent<HTMLElement>) => {
      if (pressRef.current || e.touches.length !== 1) return;
      swallowNextClick.current = false;
      const t = e.touches[0]!;
      const p: Press = {
        id,
        kind: 'touch',
        startX: t.clientX,
        startY: t.clientY,
        x: t.clientX,
        y: t.clientY,
        el: e.currentTarget,
        timer: null,
        active: false,
        offX: 0,
        offY: 0,
      };
      pressRef.current = p;
      p.timer = setTimeout(activate, LONG_PRESS_MS);

      // touchmove NO pasivo: una vez activo, preventDefault evita que la
      // pagina se desplace con el dedo (iOS y Android).
      const onMove = (ev: TouchEvent): void => {
        const cur = pressRef.current;
        const touch = ev.touches[0];
        if (!cur || !touch) return;
        if (!cur.active) {
          if (Math.hypot(touch.clientX - cur.startX, touch.clientY - cur.startY) > TOUCH_SLOP) finish(false);
          return;
        }
        if (!ev.cancelable) {
          // El navegador ya esta desplazando la pagina: no pelear con el.
          finish(false);
          return;
        }
        ev.preventDefault();
        move(touch.clientX, touch.clientY);
      };
      const onEnd = (): void => finish(true);
      const onCancel = (): void => finish(false);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('touchcancel', onCancel);
      cleanupRef.current = () => {
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onCancel);
      };
    },
    [activate, finish, move],
  );

  const startMouse = useCallback(
    (id: number, e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch' || e.button !== 0 || pressRef.current) return;
      swallowNextClick.current = false;
      pressRef.current = {
        id,
        kind: 'mouse',
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        el: e.currentTarget,
        timer: null,
        active: false,
        offX: 0,
        offY: 0,
      };
      const onMove = (ev: PointerEvent): void => {
        const cur = pressRef.current;
        if (!cur) return;
        if (!cur.active && Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY) > MOUSE_SLOP) {
          cur.x = ev.clientX;
          cur.y = ev.clientY;
          activate();
        }
        move(ev.clientX, ev.clientY);
      };
      const onUp = (): void => finish(true);
      const onCancel = (): void => finish(false);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
    },
    [activate, finish, move],
  );

  // Desmontar a mitad de un arrastre: soltar listeners y timers.
  useEffect(() => () => finish(false), [finish]);

  // iOS Safari decide en el touchstart si los touchmove de ese gesto se
  // pueden cancelar, mirando los listeners que YA existen. El listener del
  // arrastre se agrega durante el touchstart (tarde) y el de React es
  // pasivo: sin esto, preventDefault() se ignora y la lista se desplaza
  // bajo el dedo mientras se arrastra la hoja. Un listener no pasivo
  // permanente (que no hace nada) vuelve cancelables esos touchmove.
  // Mismo truco que usa dnd-kit (TouchSensor.setup).
  useEffect(() => {
    const noop = (): void => {};
    window.addEventListener('touchmove', noop, { passive: false });
    return () => window.removeEventListener('touchmove', noop);
  }, []);

  return {
    order: preview ?? ids,
    ghost,
    draggingId: ghost?.id ?? null,
    startTouch,
    startMouse,
    swallowClick: () => {
      const swallow = swallowNextClick.current;
      swallowNextClick.current = false;
      return swallow;
    },
  };
}
