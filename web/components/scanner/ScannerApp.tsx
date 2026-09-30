'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureView } from './CaptureView';
import { EditView } from './EditView';
import { ExportView } from './ExportView';
import { IconCheck, IconX } from './icons';
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
      ? `Foto ${pendingTotal - pendingImages.length + 1} de ${pendingTotal}`
      : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Steps stage={stage} pageCount={pages.length} />

      {loadError && (
        <div
          role="alert"
          className="stage-in flex shrink-0 items-start justify-between gap-2 rounded-lg border-2 border-stamp-600 bg-stamp-50 px-3 py-2 text-sm text-stamp-700 shadow-paper-sm"
        >
          <span>
            <strong className="font-semibold">No se pudo abrir la imagen.</strong> {loadError}
          </span>
          <button
            type="button"
            onClick={() => setLoadError(null)}
            aria-label="Cerrar aviso"
            className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {persistError && pages.length > 0 && (
        <div
          role="status"
          className="stage-in shrink-0 rounded-lg border-2 border-note-300 bg-note-100 px-3 py-2 text-sm text-note-700 shadow-paper-sm"
        >
          No se pudo guardar la sesion (almacenamiento lleno o modo privado). Guarda el archivo
          ahora: si recargas, perderas las paginas.
        </div>
      )}

      {restoredCount > 0 && stage === 'export' && (
        <div
          role="status"
          className="stage-in flex shrink-0 items-center justify-between gap-3 rounded-lg border-2 border-dashed border-cocoa-900 bg-paper px-3 py-1.5 text-sm text-cocoa-700 shadow-paper-sm"
        >
          <span className="flex items-center gap-2">
            <IconCheck className="h-4 w-4 shrink-0" />
            Sesion anterior restaurada ({restoredCount} {restoredCount === 1 ? 'pagina' : 'paginas'}).
          </span>
          <button
            type="button"
            onClick={() => setRestoredCount(0)}
            aria-label="Cerrar aviso"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-cocoa-500"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {stage === 'capture' && (
        <CaptureView
          onCapture={handleCapture}
          busy={loading}
          onCancel={pages.length > 0 ? () => setStage('export') : undefined}
        />
      )}

      {stage === 'edit' && pendingImages.length > 0 && (
        <EditView
          // key fuerza el reset del estado del editor (quad, filtro,
          // rotacion) al pasar a la siguiente imagen de la cola.
          key={pendingImages[0]!.id}
          image={pendingImages[0]!.img}
          queueLabel={queueLabel}
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
          className="toast-in fixed inset-x-3 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border-2 border-cocoa-900 bg-cocoa-900 px-4 py-2 text-sm text-paper shadow-paper-ink"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 10.5rem)' }}
        >
          <span>Pagina eliminada</span>
          <button
            type="button"
            onClick={handleUndoRemove}
            className="min-h-[40px] rounded-md px-3 font-display text-base font-semibold text-note-300 underline underline-offset-4"
          >
            Deshacer
          </button>
        </div>
      )}
    </div>
  );
}

const STAGE_ORDER: Stage[] = ['capture', 'edit', 'export'];

/**
 * Indicador de progreso como pestanas de carpeta de archivo: la activa
 * "sube" y se funde con la linea base de tinta; las otras quedan
 * hundidas detras.
 */
function Steps({ stage, pageCount }: { stage: Stage; pageCount: number }): React.ReactElement {
  const items: { id: Stage; label: string }[] = [
    { id: 'capture', label: 'Capturar' },
    { id: 'edit', label: 'Editar' },
    { id: 'export', label: pageCount ? `Guardar (${pageCount})` : 'Guardar' },
  ];
  const activeIdx = STAGE_ORDER.indexOf(stage);

  return (
    <ol className="flex shrink-0 items-end gap-1.5 border-b-2 border-cocoa-900 px-1" aria-label="Progreso">
      {items.map((it, i) => {
        const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo';
        return (
          <li
            key={it.id}
            className={`min-w-0 ${state === 'active' ? 'flex-[2] min-[360px]:flex-1' : 'flex-1'}`}
          >
            <div
              className={`folder-tab flex items-center justify-center gap-1.5 px-2 py-1.5 ${
                state === 'active' ? 'tab-active' : 'tab-idle'
              }`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  state === 'active'
                    ? 'bg-stamp-600 text-paper'
                    : state === 'done'
                      ? 'bg-cocoa-900 text-paper'
                      : 'bg-cocoa-900/20 text-cocoa-700'
                }`}
              >
                {state === 'done' ? <IconCheck className="h-3 w-3" /> : i + 1}
              </span>
              {/* En pantallas muy angostas (<360px) solo la pestana activa
                  muestra el texto: las otras quedaban como "Capt..." */}
              <span
                className={`truncate font-display text-sm font-semibold ${
                  state === 'active' ? 'text-cocoa-900' : 'hidden text-cocoa-500 min-[360px]:inline'
                }`}
              >
                {it.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
