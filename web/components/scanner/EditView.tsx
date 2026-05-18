'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FILTERS, type FilterId } from './filters';
import {
  DEFAULT_EDIT,
  renderEdited,
  type Crop,
  type EditState,
} from './pipeline';

interface Props {
  image: HTMLImageElement;
  onConfirm: (canvas: HTMLCanvasElement, state: EditState) => void;
  onBack: () => void;
}

type Corner = 'tl' | 'tr' | 'br' | 'bl';

/**
 * Editor: rotacion, crop con 4 handles, y filtros. El render es derivado:
 * cada cambio re-deriva el canvas final desde la imagen original via
 * `renderEdited`, asi nunca acumulamos perdida de calidad al toggle de
 * filtros.
 *
 * El crop se almacena en coordenadas normalizadas (0..1) sobre la imagen
 * rotada — asi no se rompe al rotar mientras hay crop activo.
 */
export function EditView({ image, onConfirm, onBack }: Props): React.ReactElement {
  const [rotation, setRotation] = useState(0);
  const [filter, setFilter] = useState<FilterId>('magic');
  const [crop, setCrop] = useState<Crop | null>({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
  const [previewKey, setPreviewKey] = useState(0);

  // Canvas para mostrar la vista rotada+filtrada (sin el crop aplicado —
  // dibujamos el crop como overlay encima). Tener el preview SIN crop nos
  // permite ajustar los handles sobre la imagen completa.
  const previewRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });

  // Re-render del preview cuando cambia rotacion/filtro.
  useEffect(() => {
    const c = previewRef.current;
    if (!c) return;
    const state: EditState = { rotation, filter, crop: null };
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
    // Al rotar, mantenemos el crop normalizado pero "rotado" — para no
    // confundir al usuario, lo reseteamos a un margen razonable.
    setCrop({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
  }, []);

  const handleResetCrop = useCallback(() => {
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
  }, []);

  const handleAutoCrop = useCallback(() => {
    setCrop({ x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
  }, []);

  // --- Drag de handles -----------------------------------------------------
  const draggingRef = useRef<{ corner: Corner; rect: DOMRect } | null>(null);

  const onPointerDown = useCallback(
    (corner: Corner) => (e: React.PointerEvent<HTMLDivElement>) => {
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
    if (!drag || !crop) return;
    const { corner, rect } = drag;
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);

    let { x: cx, y: cy, width: cw, height: ch } = crop;
    const right = cx + cw;
    const bottom = cy + ch;

    switch (corner) {
      case 'tl':
        cw = Math.max(0.05, right - x);
        ch = Math.max(0.05, bottom - y);
        cx = right - cw;
        cy = bottom - ch;
        break;
      case 'tr':
        cw = Math.max(0.05, x - cx);
        ch = Math.max(0.05, bottom - y);
        cy = bottom - ch;
        break;
      case 'br':
        cw = Math.max(0.05, x - cx);
        ch = Math.max(0.05, y - cy);
        break;
      case 'bl':
        cw = Math.max(0.05, right - x);
        ch = Math.max(0.05, y - cy);
        cx = right - cw;
        break;
    }
    setCrop({ x: cx, y: cy, width: cw, height: ch });
  }, [crop]);

  const onPointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  const handleConfirm = useCallback(() => {
    const state: EditState = { rotation, filter, crop };
    const final = renderEdited(image, state);
    onConfirm(final, state);
  }, [image, rotation, filter, crop, onConfirm]);

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg bg-ink-950"
        style={{ touchAction: 'none' }}
      >
        <canvas ref={previewRef} className="block max-w-full" />

        {/* Crop overlay */}
        {crop && previewSize.w > 0 && (
          <div
            className="absolute inset-0"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Mascara: oscurecemos lo que esta fuera del crop. Usamos 4
                divs en vez de un SVG con clip-path porque es mas barato y
                respeta el aspect ratio del canvas escalado. */}
            <Mask crop={crop} size={previewSize} />

            {/* Marco del crop */}
            <div
              className="pointer-events-none absolute border-2 border-emerald-400"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
              }}
            />

            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <Handle
                key={c}
                corner={c}
                crop={crop}
                onDown={onPointerDown(c)}
              />
            ))}
          </div>
        )}
      </div>

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
          onClick={handleAutoCrop}
          className="rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm hover:bg-ink-700"
        >
          Crop sugerido
        </button>
        <button
          type="button"
          onClick={handleResetCrop}
          className="rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm hover:bg-ink-700"
        >
          Sin crop
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
          className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
        >
          Aplicar y continuar
        </button>
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function Mask({
  crop,
  size,
}: {
  crop: Crop;
  size: { w: number; h: number };
}): React.ReactElement {
  void size;
  // 4 rectangulos alrededor del crop. Usamos rgba con pointer-events:none
  // para no robar drag a los handles.
  const bg = 'rgba(0,0,0,0.55)';
  return (
    <>
      <div
        className="pointer-events-none absolute"
        style={{ background: bg, left: 0, top: 0, right: 0, height: `${crop.y * 100}%` }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          background: bg,
          left: 0,
          top: `${crop.y * 100}%`,
          width: `${crop.x * 100}%`,
          height: `${crop.height * 100}%`,
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          background: bg,
          left: `${(crop.x + crop.width) * 100}%`,
          top: `${crop.y * 100}%`,
          right: 0,
          height: `${crop.height * 100}%`,
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          background: bg,
          left: 0,
          top: `${(crop.y + crop.height) * 100}%`,
          right: 0,
          bottom: 0,
        }}
      />
    </>
  );
}

function Handle({
  corner,
  crop,
  onDown,
}: {
  corner: Corner;
  crop: Crop;
  onDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}): React.ReactElement {
  const positions: Record<Corner, { left: string; top: string; cursor: string }> = {
    tl: {
      left: `${crop.x * 100}%`,
      top: `${crop.y * 100}%`,
      cursor: 'nwse-resize',
    },
    tr: {
      left: `${(crop.x + crop.width) * 100}%`,
      top: `${crop.y * 100}%`,
      cursor: 'nesw-resize',
    },
    br: {
      left: `${(crop.x + crop.width) * 100}%`,
      top: `${(crop.y + crop.height) * 100}%`,
      cursor: 'nwse-resize',
    },
    bl: {
      left: `${crop.x * 100}%`,
      top: `${(crop.y + crop.height) * 100}%`,
      cursor: 'nesw-resize',
    },
  };
  const p = positions[corner];
  return (
    <div
      role="slider"
      aria-label={`Handle ${corner}`}
      onPointerDown={onDown}
      className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500 shadow-md"
      style={{ left: p.left, top: p.top, cursor: p.cursor, touchAction: 'none' }}
    />
  );
}

export { DEFAULT_EDIT };
