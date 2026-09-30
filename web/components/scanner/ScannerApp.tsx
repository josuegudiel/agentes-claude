'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureView } from './CaptureView';
import { EditView } from './EditView';
import { ExportView } from './ExportView';
import { IconCheck, IconX } from './icons';
import { filterForMode, isScanMode, type ScanModeId } from './modes';
import { pageFromBlob, pageFromCanvas, type ScanPage } from './pages';
import { loadImageFromFile } from './pipeline';
import { isStorageAvailable, loadPages, savePages } from './storage';

type Stage = 'capture' | 'edit' | 'export';

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
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [restoredCount, setRestoredCount] = useState(0);
  const nextIdRef = useRef(1);

  // Modo de escaneo del visor (define el filtro con el que abre el
  // editor). Se recuerda entre visitas; si el almacenamiento no esta
  // disponible (modo privado) simplemente no se recuerda.
  const [scanMode, setScanMode] = useState<ScanModeId>('doc');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('scanner.mode');
      if (isScanMode(saved)) setScanMode(saved);
    } catch {
      /* sin almacenamiento: modo por defecto */
    }
  }, []);
  const changeScanMode = useCallback((m: ScanModeId) => {
    setScanMode(m);
    try {
      localStorage.setItem('scanner.mode', m);
    } catch {
      /* ignorar */
    }
  }, []);

  // El aviso de "sesion restaurada" se va solo.
  useEffect(() => {
    if (restoredCount === 0) return;
    const t = setTimeout(() => setRestoredCount(0), 4500);
    return () => clearTimeout(t);
  }, [restoredCount]);

  // hydrated es ESTADO (no ref) a proposito: si el usuario confirma una
  // pagina antes de que termine la restauracion, el effect de persistencia
  // tiene que volver a correr cuando hydrated pase a true. Con un ref esa
  // primera pagina nunca se guardaba.
  const [hydrated, setHydrated] = useState(false);
  // El usuario ya actuo: la restauracion no debe sacarlo de la vista en la
  // que esta (solo agrega las paginas guardadas).
  const userActedRef = useRef(false);
  // Aviso de que la persistencia fallo (cuota / modo privado).
  const [persistError, setPersistError] = useState(false);

  // Restauracion al montar.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isStorageAvailable()) return;
        const blobs = await loadPages();
        if (cancelled || blobs.length === 0) return;
        const restored: ScanPage[] = [];
        for (const blob of blobs) {
          try {
            restored.push(await pageFromBlob(blob, nextIdRef.current++));
          } catch {
            // Una pagina corrupta no debe tirar la sesion entera.
          }
        }
        if (cancelled || restored.length === 0) return;
        // Se ANTEPONEN a lo que el usuario haya hecho mientras cargaba:
        // ni se pierde la sesion guardada ni su captura nueva.
        setPages((prev) => [...restored, ...prev]);
        setRestoredCount(restored.length);
        if (!userActedRef.current) setStage('export');
      } catch {
        // Storage roto (modo privado, cuota) — la app funciona sin persistir.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persistencia: las paginas YA son JPEG, se guardan tal cual (sin
  // recomprimir en cada cambio ni en cada recarga).
  useEffect(() => {
    if (!hydrated || !isStorageAvailable()) return;
    let cancelled = false;
    savePages(pages.map((p) => p.blob))
      .then(() => {
        if (!cancelled) setPersistError(false);
      })
      .catch(() => {
        if (!cancelled && pages.length > 0) setPersistError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pages, hydrated]);

  const loadingRef = useRef(false);
  const handleCapture = useCallback(async (files: File[]) => {
    // Evita cargas duplicadas por doble toque mientras decodifica.
    if (loadingRef.current) return;
    loadingRef.current = true;
    userActedRef.current = true;
    setLoadError(null);
    setLoading(true);
    try {
      const loaded: PendingImage[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          const img = await loadImageFromFile(file);
          loaded.push({ id: nextIdRef.current++, img });
        } catch (err) {
          failed.push(err instanceof Error ? err.message : String(err));
        }
      }
      if (failed.length > 0) {
        setLoadError(
          loaded.length > 0
            ? `${failed.length} de ${files.length} imagenes no se pudieron abrir. ${failed[0]}`
            : failed[0]!,
        );
      }
      if (loaded.length === 0) return;
      setPendingImages(loaded);
      setPendingTotal(loaded.length);
      setStage('edit');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const handleConfirm = useCallback(async (canvas: HTMLCanvasElement) => {
    const page = await pageFromCanvas(canvas, nextIdRef.current++);
    setPages((prev) => [...prev, page]);
    // Avanza la cola; el effect de abajo decide a que stage ir cuando
    // se vacia.
    setPendingImages((prev) => prev.slice(1));
  }, []);

  // Cuando la cola de edicion se vacia, pasa a export (o a capture si no
  // hay ninguna pagina — p.ej. el usuario cancelo la unica edicion).
  useEffect(() => {
    if (stage !== 'edit' || pendingImages.length > 0) return;
    setStage(pages.length > 0 ? 'export' : 'capture');
    setPendingTotal(0);
  }, [stage, pendingImages, pages.length]);

  const handleEditBack = useCallback(() => {
    // Descartar varias fotos de una rafaga con un toque es facil de hacer
    // sin querer en el telefono: confirmar.
    if (
      pendingImages.length > 1 &&
      !window.confirm(`Se descartaran ${pendingImages.length} fotos sin editar. ¿Continuar?`)
    ) {
      return;
    }
    setPendingImages([]);
    setPendingTotal(0);
    setStage(pages.length > 0 ? 'export' : 'capture');
  }, [pendingImages.length, pages.length]);

  const handleAddPage = useCallback(() => {
    setLoadError(null);
    setStage('capture');
  }, []);

  // Borrado con "Deshacer" en vez de dialogo: rapido en el telefono y sin
  // perdida por un toque accidental.
  const [lastRemoved, setLastRemoved] = useState<{ page: ScanPage; index: number } | null>(null);
  useEffect(() => {
    if (!lastRemoved) return;
    const t = setTimeout(() => setLastRemoved(null), 6000);
    return () => clearTimeout(t);
  }, [lastRemoved]);

  const handleRemovePage = useCallback(
    (id: number) => {
      const index = pages.findIndex((p) => p.id === id);
      if (index < 0) return;
      setLastRemoved({ page: pages[index]!, index });
      setPages((prev) => prev.filter((p) => p.id !== id));
    },
    [pages],
  );

  const handleUndoRemove = useCallback(() => {
    if (!lastRemoved) return;
    setPages((prev) => {
      if (prev.some((p) => p.id === lastRemoved.page.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(lastRemoved.index, next.length), 0, lastRemoved.page);
      return next;
    });
    setLastRemoved(null);
  }, [lastRemoved]);

  const handleMovePage = useCallback((id: number, delta: -1 | 1) => {
    setPages((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  }, []);

  const handleRestart = useCallback(() => {
    if (
      pages.length > 0 &&
      !window.confirm(
        `Se borraran ${pages.length === 1 ? 'la pagina escaneada' : `las ${pages.length} paginas escaneadas`}. ¿Empezar de nuevo?`,
      )
    ) {
      return;
    }
    setPages([]);
    setPendingImages([]);
    setPendingTotal(0);
    setLoadError(null);
    setRestoredCount(0);
    setLastRemoved(null);
    setPersistError(false);
    setStage('capture');
  }, [pages.length]);

  const queueLabel =
    pendingTotal > 1
      ? `FOTO ${pendingTotal - pendingImages.length + 1}/${pendingTotal}`
      : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Avisos flotantes (no empujan el visor ni el editor) */}
      <div className="top-safe pointer-events-none absolute inset-x-3 z-30 flex flex-col gap-2">
        {loadError && (
          <div
            role="alert"
            className="toast-in pointer-events-auto flex items-start justify-between gap-2 rounded-2xl border border-danger/60 bg-night-900/95 px-3.5 py-2.5 text-sm text-night-100 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur"
          >
            <span>
              <strong className="font-mono text-[11px] font-bold tracking-[0.08em] text-danger">NO SE PUDO ABRIR · </strong>
              {loadError}
            </span>
            <button
              type="button"
              onClick={() => setLoadError(null)}
              aria-label="Cerrar aviso"
              className="-m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-night-300"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}

        {persistError && pages.length > 0 && (
          <div
            role="status"
            className="toast-in pointer-events-auto rounded-2xl border border-warn/60 bg-night-900/95 px-3.5 py-2.5 text-sm text-night-100 backdrop-blur"
          >
            <strong className="font-mono text-[11px] font-bold tracking-[0.08em] text-warn">SIN RESPALDO · </strong>
            No se pudo guardar la sesión (almacenamiento lleno o modo privado). Guarda el archivo ahora: si
            recargas, perderás las páginas.
          </div>
        )}

        {restoredCount > 0 && stage === 'export' && (
          <div
            role="status"
            className="toast-in pointer-events-auto flex items-center justify-between gap-3 rounded-2xl border border-night-700 bg-night-900/95 px-3.5 py-2 text-sm text-night-100 backdrop-blur"
          >
            <span className="flex items-center gap-2">
              <IconCheck className="h-4 w-4 shrink-0 text-volt" />
              Sesión anterior restaurada · {restoredCount} {restoredCount === 1 ? 'página' : 'páginas'}
            </span>
            <button
              type="button"
              onClick={() => setRestoredCount(0)}
              aria-label="Cerrar aviso"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-night-400"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {stage === 'capture' && (
        <CaptureView
          onCapture={handleCapture}
          busy={loading}
          onCancel={pages.length > 0 ? () => setStage('export') : undefined}
          scanMode={scanMode}
          onScanModeChange={changeScanMode}
          pageCount={pages.length}
          lastThumb={pages[pages.length - 1]?.thumb}
        />
      )}

      {stage === 'edit' && pendingImages.length > 0 && (
        <EditView
          // key fuerza el reset del estado del editor (quad, filtro,
          // rotacion) al pasar a la siguiente imagen de la cola.
          key={pendingImages[0]!.id}
          image={pendingImages[0]!.img}
          queueLabel={queueLabel}
          initialFilter={filterForMode(scanMode)}
          onConfirm={handleConfirm}
          onBack={handleEditBack}
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

      {lastRemoved && stage === 'export' && (
        <div
          role="status"
          className="toast-in fixed inset-x-3 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-night-700 bg-night-900 px-4 py-2 text-sm text-night-100 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 13rem)' }}
        >
          <span className="font-mono text-xs font-bold tracking-[0.08em]">PÁGINA ELIMINADA</span>
          <button
            type="button"
            onClick={handleUndoRemove}
            className="min-h-[40px] rounded-lg px-3 font-display text-lg font-extrabold uppercase tracking-[0.1em] text-volt"
          >
            Deshacer
          </button>
        </div>
      )}
    </div>
  );
}
