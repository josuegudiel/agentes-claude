'use client';

// Primero: la politica de Trusted Types debe existir antes de cargar
// workers o registrar el service worker.
import './trusted-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureView } from './CaptureView';
import { EditView } from './EditView';
import { defaultFilename, isExportFormat, type ExportFormat } from './export';
import { ExportView } from './ExportView';
import { IconCheck, IconX } from './icons';
import { filterForMode, isScanMode, type ScanModeId } from './modes';
import { newUid, pageFromBlob, pageFromCanvas, rotateClockwise, type ScanPage } from './pages';
import { PdfImportError, importPdf } from './pdf-import';
import { loadImageFromFile } from './pipeline';
import { moveItem } from './reorder';
import {
  SessionConflictError,
  deleteLegacyDb,
  isStorageAvailable,
  loadLegacyPages,
  loadSession,
  saveSession,
} from './storage';

type Stage = 'loading' | 'capture' | 'edit' | 'export';

interface PendingImage {
  id: number;
  /** Clave en el almacenamiento: la foto sobrevive a una recarga. */
  uid: string;
  /** Foto original (se guarda tal cual mientras no se edite). */
  blob: Blob;
  img: HTMLImageElement;
}

interface Notice {
  text: string;
  /** Visible solo en esta etapa (por defecto: export). */
  stage?: Stage;
}

/** Ventana para "Deshacer" una eliminacion. */
const UNDO_MS = 6000;
/** Si IndexedDB no responde (bloqueado), no dejar la app en negro. */
const RESTORE_TIMEOUT_MS = 2500;

/**
 * State machine principal del scanner:
 *
 *   loading -> capture -> edit -> (acumula pagina) -> export
 *                                        ^
 *                                        | "Escanear" desde export
 *                                        |
 *                                    vuelve a capture
 *
 * La sesion (paginas, fotos sin editar, nombre y formato) se guarda en
 * IndexedDB (storage.ts) y se restaura al recargar. 'loading' existe para
 * no abrir la camara (ni su permiso en iOS) antes de saber si hay que ir
 * directo a export.
 */
export function ScannerApp(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('loading');
  // Cola de imagenes por editar (>1 cuando el usuario capturo en rafaga o
  // subio varios archivos). Se editan una a una, en orden.
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [filename, setFilename] = useState<string>(() => defaultFilename());
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [notice, setNotice] = useState<Notice | null>(null);
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

  // El aviso se va solo.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // ---------------------------------------------------------------------
  // Persistencia
  // ---------------------------------------------------------------------
  const [hydrated, setHydrated] = useState(false);
  // Solo se guarda despues de un cambio del usuario (nunca como efecto de
  // restaurar: una restauracion parcial no debe borrar lo que no se leyo).
  const dirtyRef = useRef(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);
  // Revision de la sesion que esta pestana leyo/escribio por ultima vez.
  const revRef = useRef(0);
  // El usuario cambio nombre o formato (la restauracion no debe pisarlos).
  const userTouchedRef = useRef(false);
  const [persistError, setPersistError] = useState<'none' | 'failed' | 'conflict'>('none');
  const [persistDismissed, setPersistDismissed] = useState(false);
  // Fotos sin editar encontradas al restaurar (se ofrece continuar).
  const [orphanPending, setOrphanPending] = useState<{ uid: string; blob: Blob }[]>([]);

  // Paginas eliminadas que todavia se pueden recuperar (pila de deshacer).
  const [removed, setRemoved] = useState<{ page: ScanPage; index: number }[]>([]);

  // Restauracion al montar.
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setStage((s) => (s === 'loading' ? 'capture' : s));
    }, RESTORE_TIMEOUT_MS);
    (async () => {
      let goExport = false;
      try {
        if (!isStorageAvailable()) return;
        const loaded = await loadSession();
        if (cancelled) return;
        if (loaded) {
          const { session, blobs } = loaded;
          revRef.current = session.rev;
          const restored: ScanPage[] = [];
          let missing = 0;
          for (const p of session.pages) {
            const blob = blobs.get(p.uid);
            if (!blob) {
              missing++;
              continue;
            }
            restored.push({ ...p, id: nextIdRef.current++, blob });
          }
          // Si el usuario ya cambio nombre/formato mientras cargaba, gana el suyo.
          if (session.filename && !userTouchedRef.current) setFilename(session.filename);
          if (isExportFormat(session.format) && !userTouchedRef.current) setFormat(session.format);
          // La base anterior (si quedo de una migracion) se borra en un
          // arranque POSTERIOR: en WebKit borrarla invalida los Blobs que la
          // sesion migrada aun tiene en memoria.
          void deleteLegacyDb();
          const pend = session.pending.flatMap((uid) => {
            const blob = blobs.get(uid);
            return blob ? [{ uid, blob }] : [];
          });
          if (restored.length > 0) {
            // Se ANTEPONEN a lo que el usuario haya hecho si la restauracion
            // tardo (no se pisa su pagina nueva).
            setPages((prev) => [...restored, ...prev]);
            goExport = true;
            setNotice({
              text:
                `Sesión anterior restaurada · ${restored.length} ${restored.length === 1 ? 'página' : 'páginas'}` +
                (missing > 0 ? ` (${missing} no se pudieron recuperar)` : ''),
            });
          }
          setOrphanPending(pend);
        } else {
          // Migracion desde la base anterior (sin metadatos: decodificar).
          const legacy = await loadLegacyPages();
          if (cancelled || legacy.length === 0) return;
          const restored: ScanPage[] = [];
          for (const { blob, rotation } of legacy) {
            try {
              restored.push(await pageFromBlob(blob, nextIdRef.current++, rotation));
            } catch {
              /* una pagina corrupta no tira la sesion */
            }
          }
          if (cancelled) return;
          if (restored.length > 0) {
            setPages((prev) => [...restored, ...prev]);
            goExport = true;
            setNotice({
              text: `Sesión anterior restaurada · ${restored.length} ${restored.length === 1 ? 'página' : 'páginas'}`,
            });
          }
          // Guardar en el formato nuevo; la base vieja se borra en el
          // proximo arranque (ver arriba).
          dirtyRef.current = true;
        }
      } catch {
        // Storage roto (modo privado, cuota): la app funciona sin persistir.
      } finally {
        if (!cancelled) {
          clearTimeout(timeout);
          setHydrated(true);
          setStage((s) => (s === 'loading' ? (goExport ? 'export' : 'capture') : s));
        }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  // Guardado: una sola escritura a la vez; si llegan cambios mientras se
  // guarda, al terminar se guarda solo el ultimo estado (no se apilan).
  const latestRef = useRef({ pages, pendingImages, filename, format, removed, orphanPending });
  latestRef.current = { pages, pendingImages, filename, format, removed, orphanPending };
  const savingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const conflictRef = useRef(false);

  const flushSave = useCallback(async () => {
    if (!isStorageAvailable() || conflictRef.current) return;
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      do {
        saveAgainRef.current = false;
        dirtyRef.current = false;
        const s = latestRef.current;
        try {
          revRef.current = await saveSession(
            {
              pages: s.pages.map(({ uid, rotation, width, height, thumb, blob }) => ({
                uid,
                rotation,
                width,
                height,
                thumb,
                blob,
              })),
              // Las fotos sin editar de la vez anterior se conservan hasta
              // que el usuario elija continuar o descartar.
              pending: [
                ...s.pendingImages.map(({ uid, blob }) => ({ uid, blob })),
                ...s.orphanPending.filter((o) => !s.pendingImages.some((p) => p.uid === o.uid)),
              ],
              filename: s.filename,
              format: s.format,
              keep: s.removed.map((r) => r.page.uid),
            },
            revRef.current,
          );
          setPersistError('none');
        } catch (err) {
          if (err instanceof SessionConflictError) {
            conflictRef.current = true;
            setPersistError('conflict');
            setPersistDismissed(false);
            return;
          }
          dirtyRef.current = true; // reintentar en el proximo cambio / al ocultar
          setPersistError('failed');
          return;
        }
      } while (saveAgainRef.current);
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !dirtyRef.current) return;
    void flushSave();
  }, [pages, pendingImages, orphanPending, filename, format, hydrated, flushSave]);

  // Al ir a otra app (compartir por WhatsApp...) reintentar si quedo algo
  // sin guardar: iOS puede descartar la pestana en segundo plano.
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden' && hydrated && dirtyRef.current) void flushSave();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [hydrated, flushSave]);

  // ---------------------------------------------------------------------
  // Captura y edicion
  // ---------------------------------------------------------------------
  const loadingRef = useRef(false);
  const handleCapture = useCallback(async (files: Blob[]) => {
    // Evita cargas duplicadas por doble toque mientras decodifica.
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadError(null);
    setLoading(true);
    try {
      const loaded: PendingImage[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          const img = await loadImageFromFile(file);
          loaded.push({ id: nextIdRef.current++, uid: newUid(), blob: file, img });
        } catch (err) {
          failed.push(err instanceof Error ? err.message : String(err));
        }
      }
      if (failed.length > 0) {
        setLoadError(
          loaded.length > 0
            ? `${failed.length} de ${files.length} imágenes no se pudieron abrir. ${failed[0]}`
            : failed[0]!,
        );
      }
      if (loaded.length === 0) return;
      markDirty();
      setPendingImages(loaded);
      setPendingTotal(loaded.length);
      setStage('edit');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [markDirty]);

  const handleConfirm = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const page = await pageFromCanvas(canvas, nextIdRef.current++);
      markDirty();
      setPages((prev) => [...prev, page]);
      // Avanza la cola; el effect de abajo decide a que stage ir cuando
      // se vacia.
      setPendingImages((prev) => prev.slice(1));
    },
    [markDirty],
  );

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
      !window.confirm(`Se descartarán ${pendingImages.length} fotos sin editar. ¿Continuar?`)
    ) {
      return;
    }
    markDirty();
    setPendingImages([]);
    setPendingTotal(0);
    setStage(pages.length > 0 ? 'export' : 'capture');
  }, [pendingImages.length, pages.length, markDirty]);

  // Fotos sin editar de una sesion anterior (p.ej. iOS recargo la pestana
  // a mitad de una rafaga).
  const resumeOrphans = useCallback(async () => {
    const list = orphanPending;
    if (list.length === 0) return;
    setLoading(true);
    try {
      const loaded: PendingImage[] = [];
      for (const o of list) {
        try {
          loaded.push({ id: nextIdRef.current++, uid: o.uid, blob: o.blob, img: await loadImageFromFile(o.blob) });
        } catch {
          /* foto ilegible: se descarta */
        }
      }
      markDirty();
      setOrphanPending([]);
      if (loaded.length === 0) {
        setLoadError('No se pudieron abrir las fotos sin editar.');
        return;
      }
      setPendingImages(loaded);
      setPendingTotal(loaded.length);
      setStage('edit');
    } finally {
      setLoading(false);
    }
  }, [orphanPending, markDirty]);

  const discardOrphans = useCallback(() => {
    markDirty();
    setOrphanPending([]);
  }, [markDirty]);

  // ---------------------------------------------------------------------
  // Importar PDF
  // ---------------------------------------------------------------------
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const importAbortRef = useRef<AbortController | null>(null);
  const handleImportPdf = useCallback(
    async (file: File) => {
      if (importAbortRef.current || loadingRef.current) return;
      const ac = new AbortController();
      importAbortRef.current = ac;
      setLoadError(null);
      setImporting({ done: 0, total: 0 });
      try {
        const result = await importPdf(
          file,
          () => nextIdRef.current++,
          (done, t) => setImporting({ done, total: t }),
          ac.signal,
        );
        if (result.cancelled) return;
        const added = result.pages;
        if (added.length === 0) {
          setLoadError('Ese PDF no tiene hojas.');
          return;
        }
        markDirty();
        setPages((prev) => [...prev, ...added]);
        setStage('export');
        let text =
          result.total > added.length + result.failed
            ? `PDF añadido · primeras ${added.length} de ${result.total} hojas`
            : `PDF añadido · ${added.length} ${added.length === 1 ? 'hoja' : 'hojas'}`;
        if (result.failed > 0) text += ` (${result.failed} no se pudieron leer)`;
        setNotice({ text });
      } catch (err) {
        setLoadError(err instanceof PdfImportError ? err.message : 'No se pudo abrir el PDF.');
      } finally {
        importAbortRef.current = null;
        setImporting(null);
      }
    },
    [markDirty],
  );

  const handleAddPage = useCallback(() => {
    setLoadError(null);
    setStage('capture');
  }, []);

  // ---------------------------------------------------------------------
  // Paginas: quitar (con deshacer), mover, girar
  // ---------------------------------------------------------------------
  // Borrado con "Deshacer" en vez de dialogo: rapido en el telefono y sin
  // perdida por un toque accidental. Varias eliminaciones seguidas se
  // pueden deshacer una por una.
  useEffect(() => {
    if (removed.length === 0) return;
    const t = setTimeout(() => setRemoved([]), UNDO_MS);
    return () => clearTimeout(t);
  }, [removed]);

  const handleRemovePage = useCallback(
    (id: number) => {
      const index = pages.findIndex((p) => p.id === id);
      if (index < 0) return;
      markDirty();
      setRemoved((prev) => [...prev, { page: pages[index]!, index }]);
      setPages((prev) => prev.filter((p) => p.id !== id));
    },
    [pages, markDirty],
  );

  const handleUndoRemove = useCallback(() => {
    const last = removed[removed.length - 1];
    if (!last) return;
    markDirty();
    setPages((prev) => {
      if (prev.some((p) => p.id === last.page.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(last.index, next.length), 0, last.page);
      return next;
    });
    setRemoved((prev) => prev.slice(0, -1));
  }, [removed, markDirty]);

  const handleMovePage = useCallback(
    (id: number, delta: -1 | 1) => {
      markDirty();
      setPages((prev) => {
        const index = prev.findIndex((p) => p.id === id);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= prev.length) return prev;
        return moveItem(prev, index, target);
      });
    },
    [markDirty],
  );

  const handleReorderPage = useCallback(
    (id: number, toIndex: number) => {
      markDirty();
      setPages((prev) => {
        const from = prev.findIndex((p) => p.id === id);
        return from < 0 ? prev : moveItem(prev, from, toIndex);
      });
    },
    [markDirty],
  );

  // Girar es solo un dato de la pagina (el JPEG no se toca).
  const handleRotatePage = useCallback(
    (id: number) => {
      markDirty();
      setPages((prev) => prev.map((p) => (p.id === id ? { ...p, rotation: rotateClockwise(p.rotation) } : p)));
    },
    [markDirty],
  );

  const changeFilename = useCallback(
    (v: string) => {
      userTouchedRef.current = true;
      markDirty();
      setFilename(v);
    },
    [markDirty],
  );
  const changeFormat = useCallback(
    (f: ExportFormat) => {
      userTouchedRef.current = true;
      markDirty();
      setFormat(f);
    },
    [markDirty],
  );

  const handleRestart = useCallback(() => {
    const n = pages.length;
    if (
      n > 0 &&
      !window.confirm(`Se borrarán ${n === 1 ? 'la página' : `las ${n} páginas`} de este documento. ¿Empezar de nuevo?`)
    ) {
      return;
    }
    setPages([]);
    setPendingImages([]);
    setPendingTotal(0);
    setLoadError(null);
    setNotice(null);
    setRemoved([]);
    setOrphanPending([]);
    setFilename(defaultFilename());
    setStage('capture');
    // Guardado normal de una sesion vacia: borra los blobs registro por
    // registro. (Con conflicto de pestanas no se toca el almacenamiento:
    // la sesion guardada es de la otra pestana.)
    markDirty();
  }, [pages.length, markDirty]);

  const queueLabel =
    pendingTotal > 1
      ? `FOTO ${pendingTotal - pendingImages.length + 1}/${pendingTotal}`
      : undefined;

  const showNotice = notice && (notice.stage ?? 'export') === stage;
  const showPersist =
    !persistDismissed &&
    persistError !== 'none' &&
    (persistError === 'conflict' || pages.length > 0) &&
    stage === 'export';

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
              className="-m-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-night-300"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}

        {showPersist && (
          <div
            role="status"
            className="toast-in pointer-events-auto flex items-start justify-between gap-2 rounded-2xl border border-warn/60 bg-night-900/95 px-3.5 py-2.5 text-sm text-night-100 backdrop-blur"
          >
            {persistError === 'conflict' ? (
              <span>
                <strong className="font-mono text-[11px] font-bold tracking-[0.08em] text-warn">OTRA PESTAÑA · </strong>
                La app está abierta en otra pestaña y los cambios de aquí ya no se guardan.{' '}
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="font-bold text-volt underline underline-offset-2"
                >
                  Recargar
                </button>
              </span>
            ) : (
              <span>
                <strong className="font-mono text-[11px] font-bold tracking-[0.08em] text-warn">SIN RESPALDO · </strong>
                No se pudo guardar la sesión (almacenamiento lleno o modo privado). Guarda el archivo ahora: si
                recargas, perderás las páginas.
              </span>
            )}
            <button
              type="button"
              onClick={() => setPersistDismissed(true)}
              aria-label="Cerrar aviso"
              className="-m-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-night-300"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}

        {orphanPending.length > 0 && (stage === 'capture' || stage === 'export') && (
          <div
            role="status"
            className="toast-in pointer-events-auto rounded-2xl border border-volt/50 bg-night-900/95 px-3.5 py-2.5 text-sm text-night-100 backdrop-blur"
          >
            <p>
              Tienes {orphanPending.length === 1 ? '1 foto' : `${orphanPending.length} fotos`} sin editar de la vez
              anterior.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={discardOrphans}
                className="min-h-[40px] rounded-xl border border-night-600 px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-night-300"
              >
                DESCARTAR
              </button>
              <button
                type="button"
                onClick={() => void resumeOrphans()}
                className="min-h-[40px] rounded-xl bg-volt px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-night-950"
              >
                CONTINUAR
              </button>
            </div>
          </div>
        )}

        {showNotice && (
          <div
            role="status"
            className="toast-in pointer-events-auto flex items-center justify-between gap-3 rounded-2xl border border-night-700 bg-night-900/95 px-3.5 py-2 text-sm text-night-100 backdrop-blur"
          >
            <span className="flex items-center gap-2">
              <IconCheck className="h-4 w-4 shrink-0 text-volt" />
              {notice.text}
            </span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Cerrar aviso"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-night-400"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {stage === 'loading' && (
        <div className="flex flex-1 items-center justify-center" aria-busy="true">
          <span className="spinner" aria-label="Cargando" />
        </div>
      )}

      {stage === 'capture' && (
        <CaptureView
          onCapture={handleCapture}
          busy={loading}
          suspended={importing !== null}
          onCancel={pages.length > 0 ? () => setStage('export') : undefined}
          scanMode={scanMode}
          onScanModeChange={changeScanMode}
          pageCount={pages.length}
          lastPage={pages[pages.length - 1]}
          onImportPdf={handleImportPdf}
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
          filename={filename}
          onFilenameChange={changeFilename}
          format={format}
          onFormatChange={changeFormat}
          onAddPage={handleAddPage}
          onImportPdf={handleImportPdf}
          onRemovePage={handleRemovePage}
          onMovePage={handleMovePage}
          onReorderPage={handleReorderPage}
          onRotatePage={handleRotatePage}
          onRestart={handleRestart}
        />
      )}

      {importing && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-night-950/90 backdrop-blur-sm"
        >
          <span className="spinner" aria-hidden />
          <span className="font-mono text-xs font-bold tracking-[0.12em] text-night-100">
            LEYENDO PDF{importing.total > 0 ? ` · ${importing.done}/${importing.total}` : ''}
          </span>
          <button
            type="button"
            onClick={() => importAbortRef.current?.abort()}
            className="mt-2 min-h-[44px] rounded-xl border border-night-600 px-5 font-mono text-xs font-bold tracking-[0.1em] text-night-200"
          >
            CANCELAR
          </button>
        </div>
      )}

      {removed.length > 0 && stage === 'export' && (
        <div
          role="status"
          className="toast-in fixed inset-x-3 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-night-700 bg-night-900 px-4 py-2 text-sm text-night-100 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 13rem)' }}
        >
          <span className="font-mono text-xs font-bold tracking-[0.08em]">
            {removed.length === 1 ? 'PÁGINA ELIMINADA' : `${removed.length} PÁGINAS ELIMINADAS`}
          </span>
          <button
            type="button"
            onClick={handleUndoRemove}
            className="min-h-[44px] rounded-lg px-3 font-display text-lg font-extrabold uppercase tracking-[0.1em] text-volt"
          >
            Deshacer
          </button>
        </div>
      )}
    </div>
  );
}
