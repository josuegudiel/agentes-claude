'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { detectDocumentQuad, DETECT_MAX_SIDE } from './edge-detect';
import { applyFilter, FILTERS, type FilterId } from './filters';
import { IconChevronLeft, IconExpand, IconFrame, IconRotate, IconWand } from './icons';
import { loupePlacement, loupeRects } from './loupe';
import { renderEdited, type EditState } from './pipeline';
import {
  cloneQuad,
  FULL_QUAD,
  INSET_QUAD,
  type Point,
  type Quad,
} from './perspective';

interface Props {
  image: HTMLImageElement;
  onConfirm: (canvas: HTMLCanvasElement, state: EditState) => void;
  onBack: () => void;
}

/**
 * Editor: rotacion, seleccion de 4 esquinas independientes (como
 * CamScanner) y filtros con preview real en miniatura. El render es
 * derivado: cada cambio re-deriva el canvas final desde la imagen
 * original via `renderEdited`, asi nunca acumulamos perdida de calidad
 * al toggle de filtros.
 *
 * Las esquinas se almacenan en coordenadas normalizadas (0..1) sobre la
 * imagen rotada. Si el quad no es un rectangulo alineado, al confirmar se
 * aplica correccion de perspectiva (warp) que "aplana" el documento.
 */
export function EditView({ image, onConfirm, onBack }: Props): React.ReactElement {
  const [rotation, setRotation] = useState(0);
  const [filter, setFilter] = useState<FilterId>('magic');
  const [quad, setQuad] = useState<Quad>(() => cloneQuad(INSET_QUAD));
  const [previewKey, setPreviewKey] = useState(0);
  const [confirming, setConfirming] = useState(false);

  // Canvas para mostrar la vista rotada+filtrada (sin el quad aplicado —
  // dibujamos el quad como overlay encima). Tener el preview SIN warp nos
  // permite ajustar las esquinas sobre la imagen completa.
  const previewRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });

  // Re-render del preview cuando cambia rotacion/filtro.
  useEffect(() => {
    const c = previewRef.current;
    if (!c) return;
    const state: EditState = { rotation, filter, quad: null };
    const out = renderEdited(image, state);

    // Escalamos el canvas mostrado al ancho disponible — el canvas real
    // puede ser de 4000x3000, lo bajamos a algo razonable para preview.
    const containerW = containerRef.current?.clientWidth ?? 800;
    const maxW = Math.min(containerW, 1000);
    const scale = Math.min(1, maxW / out.width);
    c.width = Math.round(out.width * scale);
    c.height = Math.round(out.height * scale);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(out, 0, 0, c.width, c.height);
    setPreviewSize({ w: c.width, h: c.height });
  }, [image, rotation, filter, previewKey]);

  // Re-render en resize del viewport.
  useEffect(() => {
    const onResize = (): void => setPreviewKey((k) => k + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Miniaturas de preview por filtro: version diminuta de la imagen
  // rotada con cada filtro aplicado de verdad. Es barato (~112px de lado
  // x 5 filtros) y le muestra al usuario que hace cada filtro ANTES de
  // tocarlo — como la fila de filtros de CamScanner.
  const [filterThumbs, setFilterThumbs] = useState<Partial<Record<FilterId, string>>>({});
  useEffect(() => {
    const srcW = image.naturalWidth;
    const srcH = image.naturalHeight;
    if (!srcW || !srcH) return;

    const rot = ((rotation % 360) + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    const rotW = swapped ? srcH : srcW;
    const rotH = swapped ? srcW : srcH;
    const scale = Math.min(1, 112 / Math.max(rotW, rotH));
    const w = Math.max(1, Math.round(rotW * scale));
    const h = Math.max(1, Math.round(rotH * scale));

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(image, (-srcW * scale) / 2, (-srcH * scale) / 2, srcW * scale, srcH * scale);
    ctx.restore();

    const base = ctx.getImageData(0, 0, w, h);
    const thumbs: Partial<Record<FilterId, string>> = {};
    for (const f of FILTERS) {
      const copy = new ImageData(w, h);
      copy.data.set(base.data);
      const out = applyFilter(copy, f.id);
      const oc = document.createElement('canvas');
      oc.width = w;
      oc.height = h;
      const octx = oc.getContext('2d');
      if (!octx) continue;
      octx.putImageData(out, 0, 0);
      thumbs[f.id] = oc.toDataURL('image/jpeg', 0.75);
    }
    setFilterThumbs(thumbs);
  }, [image, rotation]);

  // Deteccion automatica de bordes al montar y al rotar. Corre sobre una
  // version reducida (<=256px) de la imagen rotada — es O(n) y a ese
  // tamano tarda ~1ms. Si no encuentra un quad confiable, deja el margen
  // sugerido y el usuario ajusta a mano.
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

  const handleResetQuad = useCallback(() => {
    setQuad(cloneQuad(FULL_QUAD));
  }, []);

  const handleSuggestQuad = useCallback(() => {
    setQuad(cloneQuad(INSET_QUAD));
  }, []);

  // --- Drag de esquinas ----------------------------------------------------
  const draggingRef = useRef<{ corner: number; rect: DOMRect } | null>(null);
  // Esquina activa como estado (no solo ref): dispara el render de la lupa.
  const [dragCorner, setDragCorner] = useState<number | null>(null);

  const onPointerDown = useCallback(
    (corner: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const overlay = e.currentTarget.parentElement;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      draggingRef.current = { corner, rect };
      setDragCorner(corner);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const { corner, rect } = drag;
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
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
  // Mientras se arrastra una esquina, muestra la zona bajo el dedo ampliada
  // con una cruz en el punto exacto. Se dibuja desde el canvas de preview
  // (ya filtrado y escalado), asi que es barata: un drawImage por move.
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

    const r = loupeRects(cx, cy, preview.width, preview.height, LOUPE_SIZE, LOUPE_ZOOM);
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
  }, [dragCorner, quad]);

  const handleConfirm = useCallback(() => {
    // El warp sobre una imagen grande puede tomar unos cientos de ms —
    // deshabilitamos el boton y dejamos que el browser pinte antes.
    setConfirming(true);
    requestAnimationFrame(() => {
      try {
        const state: EditState = { rotation, filter, quad };
        const final = renderEdited(image, state);
        onConfirm(final, state);
      } finally {
        setConfirming(false);
      }
    });
  }, [image, rotation, filter, quad, onConfirm]);

  return (
    <div className="stage-in flex flex-col gap-3">
      {/* Lienzo con overlay del quad */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border-2 border-cocoa-900 bg-kraft-100 shadow-paper"
        style={{ touchAction: 'none' }}
      >
        <canvas ref={previewRef} className="mx-auto block max-w-full" />

        {previewSize.w > 0 && (
          <div
            className="absolute inset-0"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <QuadOverlay quad={quad} />
            {quad.map((p, i) => (
              <Handle key={i} point={p} onDown={onPointerDown(i)} label={CORNER_LABELS[i]!} />
            ))}
          </div>
        )}

        {/* Lupa: visible solo mientras se arrastra una esquina. Se coloca
            del lado contrario a la esquina para que el dedo no la tape. */}
        {dragCorner !== null && (
          <div
            className={`pointer-events-none absolute top-2 overflow-hidden rounded-full border-[3px] border-cocoa-900 shadow-paper-sm ${
              loupePlacement(quad[dragCorner]!.x) === 'right' ? 'right-2' : 'left-2'
            }`}
            style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
            aria-hidden
          >
            <canvas ref={loupeRef} className="block" />
          </div>
        )}
      </div>

      {/* Estado de la deteccion */}
      <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-cocoa-500">
        {autoDetected ? (
          <>
            <IconWand className="h-3.5 w-3.5 text-stamp-600" />
            Bordes detectados automaticamente — ajusta las esquinas si hace falta.
          </>
        ) : (
          'Arrastra las 4 esquinas hasta los bordes del documento.'
        )}
      </p>

      {/* Herramientas */}
      <div className="grid grid-cols-4 gap-2">
        <ToolButton icon={<IconRotate className="h-5 w-5" />} label="Rotar" onClick={handleRotate} />
        <ToolButton icon={<IconWand className="h-5 w-5" />} label="Detectar" onClick={handleDetect} />
        <ToolButton icon={<IconFrame className="h-5 w-5" />} label="Sugerido" onClick={handleSuggestQuad} />
        <ToolButton icon={<IconExpand className="h-5 w-5" />} label="Completa" onClick={handleResetQuad} />
      </div>

      {/* Filtros con preview real */}
      <div>
        <div className="mb-1.5 px-1 font-display text-xs font-semibold uppercase tracking-[0.18em] text-cocoa-500">
          Filtro
        </div>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
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
                className={`chip-stamp flex shrink-0 flex-col items-center gap-1 rounded-lg border-2 border-cocoa-900/25 bg-paper p-1.5 shadow-paper-sm transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                  selected ? 'chip-selected' : ''
                }`}
              >
                <span className="block h-16 w-14 overflow-hidden rounded-md bg-kraft-100">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      aria-hidden
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
                <span
                  className={`text-[10px] font-semibold ${
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

      {/* CTA */}
      <div className="safe-bottom flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost flex min-h-[52px] items-center justify-center gap-1 rounded-lg px-4 font-display text-base font-semibold text-cocoa-900"
        >
          <IconChevronLeft className="h-4 w-4" />
          Volver
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className="btn-scan flex min-h-[52px] flex-1 items-center justify-center rounded-lg px-5 font-display text-base font-semibold"
        >
          {confirming ? 'Procesando...' : 'Aplicar y continuar'}
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
      className="btn-ghost flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-stamp-600"
    >
      {icon}
      <span className="text-[10px] font-semibold text-cocoa-700">{label}</span>
    </button>
  );
}

const CORNER_LABELS = ['esquina superior izquierda', 'esquina superior derecha', 'esquina inferior derecha', 'esquina inferior izquierda'];

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
  const srcW = image.naturalWidth;
  const srcH = image.naturalHeight;
  if (!srcW || !srcH) return null;

  const rot = ((rotation % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const rotW = swapped ? srcH : srcW;
  const rotH = swapped ? srcW : srcH;

  const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(rotW, rotH));
  const w = Math.max(1, Math.round(rotW * scale));
  const h = Math.max(1, Math.round(rotH * scale));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(image, (-srcW * scale) / 2, (-srcH * scale) / 2, srcW * scale, srcH * scale);
  ctx.restore();

  try {
    return detectDocumentQuad(ctx.getImageData(0, 0, w, h));
  } catch {
    // getImageData puede lanzar con imagenes cross-origin "tainted".
    return null;
  }
}

/**
 * Mascara + contorno del quad en un solo SVG. La mascara usa fill-rule
 * evenodd: rect exterior + poligono interior = solo lo de afuera queda
 * oscurecido. viewBox 0-100 con preserveAspectRatio none para que las
 * coordenadas normalizadas mapeen directo a porcentajes.
 */
function QuadOverlay({ quad }: { quad: Quad }): React.ReactElement {
  const pts = quad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  const innerPath = quad
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * 100} ${p.y * 100}`)
    .join(' ');
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={`M0 0 H100 V100 H0 Z ${innerPath} Z`}
        fillRule="evenodd"
        fill="rgba(43, 36, 21, 0.5)"
      />
      <polygon
        points={pts}
        fill="none"
        stroke="#C73E1D"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Handle({
  point,
  onDown,
  label,
}: {
  point: Point;
  onDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  label: string;
}): React.ReactElement {
  return (
    <div
      role="slider"
      aria-label={label}
      onPointerDown={onDown}
      className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-[3px] border-cocoa-900 bg-paper shadow-paper-ink-sm"
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        touchAction: 'none',
      }}
    />
  );
}
