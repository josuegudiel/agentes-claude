'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FILTERS, type FilterId } from './filters';
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
 * CamScanner) y filtros. El render es derivado: cada cambio re-deriva el
 * canvas final desde la imagen original via `renderEdited`, asi nunca
 * acumulamos perdida de calidad al toggle de filtros.
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

  const handleRotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
    // Las coordenadas del quad son relativas a la imagen rotada; tras
    // rotar dejan de corresponder al documento. Reset al margen sugerido.
    setQuad(cloneQuad(INSET_QUAD));
  }, []);

  const handleResetQuad = useCallback(() => {
    setQuad(cloneQuad(FULL_QUAD));
  }, []);

  const handleSuggestQuad = useCallback(() => {
    setQuad(cloneQuad(INSET_QUAD));
  }, []);

  // --- Drag de esquinas ----------------------------------------------------
  const draggingRef = useRef<{ corner: number; rect: DOMRect } | null>(null);

  const onPointerDown = useCallback(
    (corner: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const overlay = e.currentTarget.parentElement;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      draggingRef.current = { corner, rect };
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
  }, []);

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
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg bg-ink-950"
        style={{ touchAction: 'none' }}
      >
        <canvas ref={previewRef} className="block max-w-full" />

        {/* Overlay del quad */}
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
      </div>

      <p className="text-xs text-ink-500">
        Arrastra las 4 esquinas hasta los bordes del documento. Si el quad no
        es rectangular, se endereza automaticamente (correccion de
        perspectiva).
      </p>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleRotate}
          className="rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm hover:bg-ink-700"
        >
          Rotar 90deg
        </button>
        <button
          type="button"
          onClick={handleSuggestQuad}
          className="rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm hover:bg-ink-700"
        >
          Crop sugerido
        </button>
        <button
          type="button"
          onClick={handleResetQuad}
          className="rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm hover:bg-ink-700"
        >
          Pagina completa
        </button>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Filtro
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              title={f.hint}
              className={`rounded-md border px-3 py-2 text-sm ${
                filter === f.id
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                  : 'border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800"
        >
          Volver a capturar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {confirming ? 'Procesando...' : 'Aplicar y continuar'}
        </button>
      </div>
    </div>
  );
}

const CORNER_LABELS = ['esquina superior izquierda', 'esquina superior derecha', 'esquina inferior derecha', 'esquina inferior izquierda'];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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
        fill="rgba(0,0,0,0.55)"
      />
      <polygon
        points={pts}
        fill="none"
        stroke="#34d399"
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
      className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-emerald-500 shadow-md"
      style={{
        left: `${point.x * 100}%`,
        top: `${point.y * 100}%`,
        touchAction: 'none',
      }}
    />
  );
}
