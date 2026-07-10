'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureView } from './CaptureView';
import { EditView } from './EditView';
import { ExportView } from './ExportView';
import { IconCheck, IconX } from './icons';
import { loadImageFromFile } from './pipeline';
import { isStorageAvailable, loadPages, savePages } from './storage';

type Stage = 'capture' | 'edit' | 'export';

interface Page {
  canvas: HTMLCanvasElement;
  thumb: string;
}

interface PendingImage {
  id: number;
  img: HTMLImageElement;
}

/**
 * State machine principal del scanner:
 *
 *   capture -> edit -> (acumula pagina) -> export
 *                              ^
 *                              | "agregar pagina" desde export
 *                              |
 *                          vuelve a capture
 *
 * Las paginas se persisten en IndexedDB: al recargar la pestana se
 * restauran y la app arranca directo en la vista de export.
 */
export function ScannerApp(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('capture');
  // Cola de imagenes por editar (>1 cuando el usuario capturo en rafaga o
  // subio varios archivos). Se editan una a una, en orden.
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [restoredCount, setRestoredCount] = useState(0);
  const nextIdRef = useRef(1);

  // hydrated evita que el effect de persistencia escriba [] en IndexedDB
  // antes de que la restauracion inicial termine (borraria la sesion).
  const hydratedRef = useRef(false);

  // Restauracion al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isStorageAvailable()) return;
        const blobs = await loadPages();
        if (cancelled || blobs.length === 0) return;
        const restored: Page[] = [];
        for (const blob of blobs) {
          const canvas = await blobToCanvas(blob);
          restored.push({ canvas, thumb: canvas.toDataURL('image/jpeg', 0.6) });
        }
        if (cancelled) return;
        setPages(restored);
        setRestoredCount(restored.length);
        setStage('export');
      } catch {
        // Storage roto (modo privado, cuota) — la app funciona sin persistir.
      } finally {
        if (!cancelled) hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persistencia: cada cambio en pages re-escribe IndexedDB. Guardamos
  // fire-and-forget — un fallo de cuota no debe romper el flujo de scan.
  useEffect(() => {
    if (!hydratedRef.current || !isStorageAvailable()) return;
    let cancelled = false;
    (async () => {
      try {
        const blobs: Blob[] = [];
        for (const p of pages) {
          blobs.push(await canvasToBlob(p.canvas));
        }
        if (!cancelled) await savePages(blobs);
      } catch {
        // Sin espacio / modo privado: seguimos sin persistir.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pages]);

  const handleCapture = useCallback(async (files: File[]) => {
    setLoadError(null);
    try {
      const loaded: PendingImage[] = [];
      for (const file of files) {
        const img = await loadImageFromFile(file);
        loaded.push({ id: nextIdRef.current++, img });
      }
      if (loaded.length === 0) return;
      setPendingImages(loaded);
      setPendingTotal(loaded.length);
      setStage('edit');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleConfirm = useCallback(
    (canvas: HTMLCanvasElement) => {
      const thumb = canvas.toDataURL('image/jpeg', 0.6);
      setPages((prev) => [...prev, { canvas, thumb }]);
      // Avanza la cola; el effect de abajo decide a que stage ir cuando
      // se vacia.
      setPendingImages((prev) => prev.slice(1));
    },
    [],
  );

  // Cuando la cola de edicion se vacia, pasa a export (o a capture si no
  // hay ninguna pagina — p.ej. el usuario cancelo la unica edicion).
  useEffect(() => {
    if (stage !== 'edit' || pendingImages.length > 0) return;
    setStage(pages.length > 0 ? 'export' : 'capture');
    setPendingTotal(0);
  }, [stage, pendingImages, pages.length]);

  const handleAddPage = useCallback(() => {
    setStage('capture');
  }, []);

  const handleRemovePage = useCallback((index: number) => {
    setPages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMovePage = useCallback((index: number, delta: -1 | 1) => {
    setPages((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }, []);

  const handleRestart = useCallback(() => {
    setPages([]);
    setPendingImages([]);
    setPendingTotal(0);
    setLoadError(null);
    setRestoredCount(0);
    setStage('capture');
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Steps stage={stage} pageCount={pages.length} />

      {loadError && (
        <div className="stage-in rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          <strong className="font-semibold">Error cargando imagen:</strong>{' '}
          {loadError}
        </div>
      )}

      {restoredCount > 0 && stage === 'export' && (
        <div className="stage-in flex items-center justify-between gap-3 rounded-2xl border border-scan-500/25 bg-scan-500/10 px-4 py-2.5 text-sm text-scan-200">
          <span className="flex items-center gap-2">
            <IconCheck className="h-4 w-4 shrink-0" />
            Sesion anterior restaurada ({restoredCount}{' '}
            {restoredCount === 1 ? 'pagina' : 'paginas'}).
          </span>
          <button
            type="button"
            onClick={() => setRestoredCount(0)}
            aria-label="Cerrar aviso"
            className="btn-ghost flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-carbon-300"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {stage === 'capture' && (
        <CaptureView
          onCapture={handleCapture}
          onCancel={pages.length > 0 ? () => setStage('export') : undefined}
        />
      )}

      {stage === 'edit' && pendingImages.length > 0 && (
        <>
          {pendingTotal > 1 && (
            <p className="text-center text-xs font-medium text-scan-300">
              Editando pagina {pendingTotal - pendingImages.length + 1} de {pendingTotal}
            </p>
          )}
          <EditView
            // key fuerza el reset del estado del editor (quad, filtro,
            // rotacion) al pasar a la siguiente imagen de la cola.
            key={pendingImages[0]!.id}
            image={pendingImages[0]!.img}
            onConfirm={handleConfirm}
            onBack={() => {
              // Descarta la cola completa.
              setPendingImages([]);
              setPendingTotal(0);
              setStage(pages.length > 0 ? 'export' : 'capture');
            }}
          />
        </>
      )}

      {stage === 'export' && (
        <ExportView
          pages={pages}
          onAddPage={handleAddPage}
          onRemovePage={handleRemovePage}
          onMovePage={handleMovePage}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob fallo'))),
      'image/jpeg',
      0.92,
    );
  });
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo restaurar la pagina'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d no disponible');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const STAGE_ORDER: Stage[] = ['capture', 'edit', 'export'];

/**
 * Indicador de progreso del flujo: 3 pasos con conectores que se
 * "encienden" al avanzar. Compacto en movil, con labels siempre visibles.
 */
function Steps({
  stage,
  pageCount,
}: {
  stage: Stage;
  pageCount: number;
}): React.ReactElement {
  const items: { id: Stage; label: string }[] = [
    { id: 'capture', label: 'Capturar' },
    { id: 'edit', label: 'Editar' },
    { id: 'export', label: pageCount ? `Exportar (${pageCount})` : 'Exportar' },
  ];
  const activeIdx = STAGE_ORDER.indexOf(stage);

  return (
    <ol className="flex items-center gap-1.5" aria-label="Progreso">
      {items.map((it, i) => {
        const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
        return (
          <li key={it.id} className="flex min-w-0 flex-1 items-center gap-1.5">
            <div
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors ${
                state === 'active'
                  ? 'border-scan-500/60 bg-scan-500/10 text-scan-200 shadow-glow-sm'
                  : state === 'done'
                    ? 'border-carbon-700 bg-carbon-850 text-scan-400'
                    : 'border-carbon-700/60 bg-carbon-900/60 text-carbon-500'
              }`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  state === 'active'
                    ? 'bg-scan-400 text-carbon-950'
                    : state === 'done'
                      ? 'bg-scan-500/25 text-scan-300'
                      : 'bg-carbon-800 text-carbon-500'
                }`}
              >
                {state === 'done' ? <IconCheck className="h-3 w-3" /> : i + 1}
              </span>
              <span className="truncate font-display text-xs font-medium">
                {it.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
