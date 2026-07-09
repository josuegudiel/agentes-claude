'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureView } from './CaptureView';
import { EditView } from './EditView';
import { ExportView } from './ExportView';
import { loadImageFromFile } from './pipeline';
import { isStorageAvailable, loadPages, savePages } from './storage';

type Stage = 'capture' | 'edit' | 'export';

interface Page {
  canvas: HTMLCanvasElement;
  thumb: string;
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
  const [pendingImage, setPendingImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [restoredCount, setRestoredCount] = useState(0);

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

  const handleCapture = useCallback(async (file: File) => {
    setLoadError(null);
    try {
      const img = await loadImageFromFile(file);
      setPendingImage(img);
      setStage('edit');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleConfirm = useCallback(
    (canvas: HTMLCanvasElement) => {
      const thumb = canvas.toDataURL('image/jpeg', 0.6);
      setPages((prev) => [...prev, { canvas, thumb }]);
      setPendingImage(null);
      setStage('export');
    },
    [],
  );

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
    setPendingImage(null);
    setLoadError(null);
    setRestoredCount(0);
    setStage('capture');
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Steps stage={stage} pageCount={pages.length} />

      {loadError && (
        <div className="rounded-md border border-rose-700/40 bg-rose-900/20 p-3 text-sm text-rose-200">
          <strong>Error cargando imagen:</strong> {loadError}
        </div>
      )}

      {restoredCount > 0 && stage === 'export' && (
        <div className="flex items-center justify-between rounded-md border border-sky-700/40 bg-sky-900/20 px-3 py-2 text-sm text-sky-200">
          <span>
            Sesion anterior restaurada ({restoredCount}{' '}
            {restoredCount === 1 ? 'pagina' : 'paginas'}).
          </span>
          <button
            type="button"
            onClick={() => setRestoredCount(0)}
            className="text-xs text-sky-400 underline"
          >
            Ok
          </button>
        </div>
      )}

      {stage === 'capture' && (
        <CaptureView
          onCapture={handleCapture}
          onCancel={pages.length > 0 ? () => setStage('export') : undefined}
        />
      )}

      {stage === 'edit' && pendingImage && (
        <EditView
          image={pendingImage}
          onConfirm={handleConfirm}
          onBack={() => {
            setPendingImage(null);
            setStage(pages.length > 0 ? 'export' : 'capture');
          }}
        />
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

function Steps({
  stage,
  pageCount,
}: {
  stage: Stage;
  pageCount: number;
}): React.ReactElement {
  const items: { id: Stage; label: string }[] = [
    { id: 'capture', label: '1. Capturar' },
    { id: 'edit', label: '2. Editar' },
    { id: 'export', label: `3. Exportar${pageCount ? ` (${pageCount})` : ''}` },
  ];
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {items.map((it) => {
        const active = it.id === stage;
        return (
          <li
            key={it.id}
            className={`rounded-full border px-3 py-1 ${
              active
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-ink-700 bg-ink-900 text-ink-400'
            }`}
          >
            {it.label}
          </li>
        );
      })}
    </ol>
  );
}
