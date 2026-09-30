'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectDocumentQuad, DETECT_MAX_SIDE } from './edge-detect';
import { applyFilter, FILTERS, type FilterId } from './filters';
import { IconChevronLeft, IconExpand, IconFrame, IconRotate, IconWand } from './icons';
import { loupePlacement, loupeRects } from './loupe';
import { releaseCanvas, renderEdited, renderRotatedPreview, type EditState } from './pipeline';
import { cloneQuad, FULL_QUAD, INSET_QUAD, type Point, type Quad } from './perspective';

interface Props {
  image: HTMLImageElement;
  /** "Foto 2 de 5" cuando se edita una cola (rafaga / varios archivos). */
  queueLabel?: string | undefined;
  onConfirm: (canvas: HTMLCanvasElement, state: EditState) => Promise<void> | void;
  onBack: () => void;
}

/** Resolucion maxima de la base del preview (lado mayor, px reales). */
const PREVIEW_BASE_MAX = 1400;
/** Margen interno del lienzo para que las esquinas en el borde no se corten. */
const STAGE_PAD = 22;

/**
 * Editor: rotacion, seleccion de 4 esquinas independientes (como
 * CamScanner) y filtros con preview real en miniatura. El render final es
 * derivado: al confirmar se re-deriva desde la imagen original via
 * `renderEdited`, asi nunca acumulamos perdida de calidad.
 *
 * Disposicion movil: el lienzo ocupa el alto libre y se ajusta al ancho Y
 * al alto (antes una foto vertical empujaba filtros y "Aplicar" fuera de
 * la pantalla y habia que hacer scroll... tocando fuera del lienzo).
 */
export function EditView({ image, queueLabel, onConfirm, onBack }: Props): React.ReactElement {
  const [rotation, setRotation] = useState(0);
  const [filter, setFilter] = useState<FilterId>('magic');
  const [quad, setQuad] = useState<Quad>(() => cloneQuad(INSET_QUAD));
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Esquina en arrastre (tambien pausa los re-renders de preview/thumbs).
  const [dragCorner, setDragCorner] = useState<number | null>(null);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  // Tamano disponible del lienzo (cambia con rotacion del telefono, teclado,
  // barras del navegador...).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = (): void => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Base del preview: imagen rotada a resolucion reducida, UNA vez por
  // rotacion. Antes cada cambio de esquina/filtro rotaba la foto completa
  // (hasta 4096px) — segundos de congelamiento en un telefono.
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let b: HTMLCanvasElement | null = null;
    try {
      b = renderRotatedPreview(image, rotation, PREVIEW_BASE_MAX);
    } catch {
      b = null;
    }
    setBase(b);
    return () => {
      if (b) releaseCanvas(b);
    };
  }, [image, rotation]);

  // Tamano mostrado: la imagen ajustada (contain) dentro del lienzo menos
  // el margen para los tiradores.
  const display = useMemo(() => {
    if (!base || stageSize.w === 0 || stageSize.h === 0) return null;
    const availW = Math.max(40, stageSize.w - STAGE_PAD * 2);
    const availH = Math.max(40, stageSize.h - STAGE_PAD * 2);
    const s = Math.min(availW / base.width, availH / base.height);
    return { w: Math.round(base.width * s), h: Math.round(base.height * s) };
  }, [base, stageSize]);

  // Render del preview: base SIN filtrar + el filtro aplicado SOLO dentro
  // del quad (clip poligonal) — WYSIWYG con el export, que filtra el
  // documento ya recortado.
  useEffect(() => {
    const c = previewRef.current;
    if (!c || !base || !display) return;
    if (dragCorner !== null) return; // al soltar se refresca

    // Pixeles reales = CSS * devicePixelRatio (tope 2): nitido en pantallas
    // retina sin disparar el costo del filtro.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.min(base.width, Math.round(display.w * dpr)));
    c.height = Math.max(1, Math.round((c.width * base.height) / base.width));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base, 0, 0, c.width, c.height);

    if (filter === 'original') return;
    const xs = quad.map((p) => p.x * c.width);
    const ys = quad.map((p) => p.y * c.height);
    const bx = Math.max(0, Math.floor(Math.min(...xs)));
    const by = Math.max(0, Math.floor(Math.min(...ys)));
    const bw = Math.min(c.width, Math.ceil(Math.max(...xs))) - bx;
    const bh = Math.min(c.height, Math.ceil(Math.max(...ys))) - by;
    if (bw <= 4 || bh <= 4) return;
    try {
      const sub = ctx.getImageData(bx, by, bw, bh);
      applyFilter(sub, filter);
      const tmp = document.createElement('canvas');
      tmp.width = bw;
      tmp.height = bh;
      const tctx = tmp.getContext('2d');
      if (tctx) {
        tctx.putImageData(sub, 0, 0);
        ctx.save();
        ctx.beginPath();
        quad.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * c.width, p.y * c.height);
          else ctx.lineTo(p.x * c.width, p.y * c.height);
        });
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(tmp, bx, by);
        ctx.restore();
      }
      releaseCanvas(tmp);
    } catch {
      // getImageData puede fallar con canvas tainted — preview sin filtro.
    }
  }, [base, display, filter, quad, dragCorner]);

  // Miniaturas por filtro: cada filtro aplicado al RECORTE warpeado del
  // quad — exactamente el resultado que se exportaria, en miniatura. Se
  // regeneran al soltar una esquina.
  const [filterThumbs, setFilterThumbs] = useState<Partial<Record<FilterId, string>>>({});
  useEffect(() => {
    if (dragCorner !== null) return;
    const srcW = image.naturalWidth;
    const srcH = image.naturalHeight;
    if (!srcW || !srcH) return;

    // Fuente reducida (~360px) para que el warp del thumb sea barato.
    const preScale = Math.min(1, 360 / Math.max(srcW, srcH));
    const small = document.createElement('canvas');
    small.width = Math.max(8, Math.round(srcW * preScale));
    small.height = Math.max(8, Math.round(srcH * preScale));
    const sctx = small.getContext('2d');
    if (!sctx) return;
    sctx.drawImage(image, 0, 0, small.width, small.height);

    let warped: HTMLCanvasElement;
    try {
      // Mismo pipeline que el export: rotacion -> warp del quad.
      warped = renderEdited(small, { rotation, quad, filter: 'original' });
    } catch {
      return;
    } finally {
      releaseCanvas(small);
    }

    const tScale = Math.min(1, 112 / Math.max(warped.width, warped.height));
    const w = Math.max(1, Math.round(warped.width * tScale));
    const h = Math.max(1, Math.round(warped.height * tScale));
    const tc = document.createElement('canvas');
    tc.width = w;
    tc.height = h;
    const tctx = tc.getContext('2d');
    if (!tctx) return;
    tctx.drawImage(warped, 0, 0, w, h);
    releaseCanvas(warped);

    const baseData = tctx.getImageData(0, 0, w, h);
    const thumbs: Partial<Record<FilterId, string>> = {};
    for (const f of FILTERS) {
      const copy = new ImageData(w, h);
      copy.data.set(baseData.data);
      tctx.putImageData(applyFilter(copy, f.id), 0, 0);
      thumbs[f.id] = tc.toDataURL('image/jpeg', 0.75);
    }
    releaseCanvas(tc);
    setFilterThumbs(thumbs);
  }, [image, rotation, quad, dragCorner]);

  // Deteccion automatica de bordes al montar y al rotar.
  const [autoDetected, setAutoDetected] = useState<boolean | null>(null);
  useEffect(() => {
    const detected = detectQuadForImage(image, rotation);
    if (detected) {
      setQuad(detected);
      setAutoDetected(true);
    } else {
      setQuad(cloneQuad(INSET_QUAD));
      setAutoDetected(false);
    }
  }, [image, rotation]);

  const handleRotate = useCallback(() => {
    // El effect de deteccion re-posiciona el quad para la nueva rotacion.
    setRotation((r) => (r + 90) % 360);
  }, []);

  const handleDetect = useCallback(() => {
    const detected = detectQuadForImage(image, rotation);
    if (detected) {
      setQuad(detected);
      setAutoDetected(true);
    } else {
      setAutoDetected(false);
    }
  }, [image, rotation]);

  // --- Arrastre de esquinas ------------------------------------------------
  // Se guarda el DESFASE entre el dedo y la esquina al tocar: la esquina se
  // mueve con el dedo sin "saltar" bajo la yema (antes se teletransportaba
  // al punto de contacto y quedaba tapada).
  const draggingRef = useRef<{ corner: number; rect: DOMRect; dx: number; dy: number } | null>(null);
  const quadRef = useRef(quad);
  quadRef.current = quad;

  const onPointerDown = useCallback(
    (corner: number) => (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      const overlay = e.currentTarget.parentElement;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const start = quadRef.current[corner]!;
      draggingRef.current = { corner, rect, dx: start.x - px, dy: start.y - py };
      setDragCorner(corner);
      setConfirmError(null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const { corner, rect, dx, dy } = drag;
    const x = clamp01((e.clientX - rect.left) / rect.width + dx);
    const y = clamp01((e.clientY - rect.top) / rect.height + dy);
    setQuad((prev) => {
      const next = cloneQuad(prev);
      next[corner] = { x, y };
      return next;
    });
  }, []);

  const onPointerUp = useCallback(() => {
    draggingRef.current = null;
    setDragCorner(null);
  }, []);

  // --- Lupa de precision ----------------------------------------------------
  const loupeRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (dragCorner === null) return;
    const loupe = loupeRef.current;
    const preview = previewRef.current;
    if (!loupe || !preview) return;
    const ctx = loupe.getContext('2d');
    if (!ctx) return;

    const p = quad[dragCorner]!;
    const cx = p.x * preview.width;
    const cy = p.y * preview.height;

    loupe.width = LOUPE_SIZE;
    loupe.height = LOUPE_SIZE;
    ctx.fillStyle = '#F5EEDF';
    ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

    // La lupa amplifica respecto del tamano MOSTRADO (el canvas puede
    // tener 2x pixeles por dpr).
    const zoom = LOUPE_ZOOM * ((display?.w ?? preview.width) / preview.width);
    const r = loupeRects(cx, cy, preview.width, preview.height, LOUPE_SIZE, zoom);
    if (r.sw > 0 && r.sh > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(preview, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    }

    ctx.strokeStyle = 'rgba(199,62,29,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE_SIZE / 2, 0);
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE);
    ctx.moveTo(0, LOUPE_SIZE / 2);
    ctx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2);
    ctx.stroke();
  }, [dragCorner, quad, display]);

  // Guarda contra doble-confirmacion: un doble tap antes de que el
  // re-render aplique disabled={confirming} podria encolar dos paginas.
  const confirmedRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const handleConfirm = useCallback(() => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    // rAF + setTimeout: el callback de rAF corre ANTES del siguiente paint,
    // asi que con solo rAF el trabajo pesado bloqueaba el hilo sin que el
    // boton llegara a mostrar "Procesando...". El timeout cede un frame.
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (unmountedRef.current) return;
        void (async () => {
          try {
            const state: EditState = { rotation, filter, quad };
            const final = renderEdited(image, state);
            await onConfirm(final, state);
            // Sin reset: onConfirm desmonta este editor (avanza la cola).
          } catch {
            if (unmountedRef.current) return;
            confirmedRef.current = false;
            setConfirming(false);
            setConfirmError(
              'No se pudo procesar la pagina (memoria insuficiente). Guarda las paginas que ya tienes e intenta de nuevo.',
            );
          }
        })();
      }, 0);
    });
  }, [image, rotation, filter, quad, onConfirm]);

  const hint = autoDetected
    ? 'Bordes detectados: ajusta las esquinas si hace falta'
    : 'Arrastra las 4 esquinas a los bordes del documento';

  return (
    <div className="stage-in flex min-h-0 flex-1 flex-col gap-2.5">
      {/* Lienzo con overlay del quad */}
      <div
        ref={stageRef}
        className="relative flex min-h-[150px] flex-1 items-center justify-center overflow-hidden rounded-lg border-2 border-cocoa-900 bg-cocoa-900/90 shadow-paper"
        style={{ touchAction: 'none' }}
      >
        {display && (
          <div
            className="relative"
            style={{ width: display.w, height: display.h }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <canvas ref={previewRef} className="block h-full w-full" />
            <QuadOverlay quad={quad} />
            {quad.map((p, i) => (
              <Handle
                key={i}
                point={p}
                active={dragCorner === i}
                onDown={onPointerDown(i)}
                onNudge={(dx, dy) =>
                  setQuad((prev) => {
                    const next = cloneQuad(prev);
                    next[i] = {
                      x: clamp01(next[i]!.x + dx),
                      y: clamp01(next[i]!.y + dy),
                    };
                    return next;
                  })
                }
                label={CORNER_LABELS[i]!}
              />
            ))}
          </div>
        )}

        {/* Lupa: visible solo mientras se arrastra una esquina. Se coloca
            del lado contrario a la esquina para que el dedo no la tape. */}
        {dragCorner !== null && (
          <div
            className={`pointer-events-none absolute top-2 overflow-hidden rounded-full border-[3px] border-paper shadow-paper-ink ${
              loupePlacement(quad[dragCorner]!.x) === 'right' ? 'right-2' : 'left-2'
            }`}
            style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
            aria-hidden
          >
            <canvas ref={loupeRef} className="block" />
          </div>
        )}

        {queueLabel && dragCorner === null && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-stamp-600 px-2.5 py-1 font-display text-xs font-bold text-paper">
            {queueLabel}
          </span>
        )}
      </div>

      <p className="flex shrink-0 items-center justify-center gap-1.5 text-center text-xs text-cocoa-500">
        {autoDetected && <IconWand className="h-3.5 w-3.5 shrink-0 text-stamp-600" />}
        <span className="truncate">{hint}</span>
      </p>

      {/* Herramientas */}
      <div className="grid shrink-0 grid-cols-4 gap-2">
        <ToolButton icon={<IconRotate className="h-5 w-5" />} label="Rotar" onClick={handleRotate} />
        <ToolButton icon={<IconWand className="h-5 w-5" />} label="Detectar" onClick={handleDetect} />
        <ToolButton
          icon={<IconFrame className="h-5 w-5" />}
          label="Margen"
          onClick={() => setQuad(cloneQuad(INSET_QUAD))}
        />
        <ToolButton
          icon={<IconExpand className="h-5 w-5" />}
          label="Todo"
          onClick={() => setQuad(cloneQuad(FULL_QUAD))}
        />
      </div>

      {/* Filtros con preview real */}
      <div className="shrink-0" role="group" aria-label="Filtro">
        <div className="no-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 pt-1.5">
          {FILTERS.map((f) => {
            const selected = filter === f.id;
            const thumb = filterThumbs[f.id];
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                title={f.hint}
                aria-pressed={selected}
                className={`chip-stamp flex shrink-0 snap-start flex-col items-center gap-1 rounded-lg border-2 border-cocoa-900/25 bg-paper p-1 shadow-paper-sm ${
                  selected ? 'chip-selected' : ''
                }`}
              >
                <span className="block h-14 w-12 overflow-hidden rounded bg-kraft-100">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" aria-hidden className="h-full w-full object-cover" />
                  )}
                </span>
                <span
                  className={`text-[11px] font-semibold leading-none ${
                    selected ? 'text-stamp-700' : 'text-cocoa-500'
                  }`}
                >
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {confirmError && (
        <p role="alert" className="shrink-0 rounded-md border-2 border-stamp-600 bg-stamp-50 px-3 py-2 text-xs text-stamp-700">
          {confirmError}
        </p>
      )}

      {/* CTA: siempre visible al pie, al alcance del pulgar */}
      <div className="safe-bottom flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={confirming}
          className="btn-ghost flex min-h-[52px] items-center justify-center gap-1 rounded-lg px-4 font-display text-base font-semibold text-cocoa-900"
        >
          <IconChevronLeft className="h-4 w-4" />
          Volver
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className="btn-scan flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-lg px-5 font-display text-base font-semibold"
        >
          {confirming && <span className="spinner spinner-sm" aria-hidden />}
          {confirming ? 'Procesando...' : 'Aplicar'}
        </button>
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-ghost flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-stamp-600"
    >
      {icon}
      <span className="text-[11px] font-semibold text-cocoa-700">{label}</span>
    </button>
  );
}

const CORNER_LABELS = [
  'esquina superior izquierda',
  'esquina superior derecha',
  'esquina inferior derecha',
  'esquina inferior izquierda',
];

const LOUPE_SIZE = 112;
const LOUPE_ZOOM = 3;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Dibuja la imagen rotada a tamano reducido (<=DETECT_MAX_SIDE) y corre la
 * deteccion de bordes. Devuelve el quad en coordenadas normalizadas (que
 * son invariantes al escalado, asi que valen directo sobre la imagen
 * rotada a resolucion completa) o null.
 */
function detectQuadForImage(image: HTMLImageElement, rotation: number): Quad | null {
  let c: HTMLCanvasElement | null = null;
  try {
    c = renderRotatedPreview(image, rotation, DETECT_MAX_SIDE);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const q = detectDocumentQuad(ctx.getImageData(0, 0, c.width, c.height));
    return q ? insetQuad(q, 0.006) : null;
  } catch {
    // getImageData puede lanzar con imagenes cross-origin "tainted".
    return null;
  } finally {
    if (c) releaseCanvas(c);
  }
}

/**
 * Encoge el quad hacia su centro una fraccion minima. La deteccion corre
 * a 256 px: +-1 px de error ahi es una tira de mesa de 10-15 px en la
 * pagina final, que despues del filtro se ve como un filo negro. Las apps
 * comerciales recortan apenas hacia adentro por la misma razon.
 */
function insetQuad(q: Quad, frac: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: p.x + (cx - p.x) * frac * 2, y: p.y + (cy - p.y) * frac * 2 })) as Quad;
}

/**
 * Mascara + contorno del quad en un solo SVG. La mascara usa fill-rule
 * evenodd: rect exterior + poligono interior = solo lo de afuera queda
 * oscurecido. viewBox 0-100 con preserveAspectRatio none para que las
 * coordenadas normalizadas mapeen directo a porcentajes.
 */
function QuadOverlay({ quad }: { quad: Quad }): React.ReactElement {
  const pts = quad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  const innerPath = quad.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * 100} ${p.y * 100}`).join(' ');
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={`M0 0 H100 V100 H0 Z ${innerPath} Z`} fillRule="evenodd" fill="rgba(43, 36, 21, 0.5)" />
      <polygon points={pts} fill="none" stroke="#C73E1D" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Handle({
  point,
  active,
  onDown,
  onNudge,
  label,
}: {
  point: Point;
  active: boolean;
  onDown: (e: React.PointerEvent<HTMLElement>) => void;
  onNudge: (dx: number, dy: number) => void;
  label: string;
}): React.ReactElement {
  // Un handle de esquina es 2D — no un slider de un valor. Es un boton
  // enfocable que ademas de arrastrarse se puede mover con las flechas
  // (1% por pulsacion), asi el recorte es operable sin puntero.
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      onNudge(m[0], m[1]);
    }
  };
  // Area tactil de 48px (recomendacion de accesibilidad movil) con un
  // punto visible mas chico: facil de agarrar sin tapar el borde.
  return (
    <button
      type="button"
      aria-label={`${label}: ${Math.round(point.x * 100)}% horizontal, ${Math.round(point.y * 100)}% vertical. Usa las flechas para ajustar.`}
      onPointerDown={onDown}
      onKeyDown={onKeyDown}
      className="group absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded-full outline-none"
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, touchAction: 'none' }}
    >
      <span
        className={`block rounded-full border-[3px] border-cocoa-900 shadow-paper-ink-sm transition-transform group-focus-visible:ring-2 group-focus-visible:ring-stamp-600 ${
          active ? 'h-7 w-7 scale-110 bg-stamp-600' : 'h-6 w-6 bg-paper'
        }`}
      />
    </button>
  );
}
