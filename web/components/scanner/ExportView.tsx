'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  downloadAll,
  exportFiles,
  isExportQuality,
  prefersShare,
  sanitizeFilename,
  saveFiles,
  shareFiles,
  type ExportFormat,
  type ExportQuality,
} from './export';
import { PAPERS, pageLayout, type PaperSize } from './pdf-writer';
import {
  IconCamera,
  IconDownload,
  IconChevronLeft,
  IconChevronRight,
  IconFileAdd,
  IconRefresh,
  IconRotate,
  IconShare,
  IconTrash,
  IconX,
} from './icons';
import { PageThumb } from './PageThumb';
import { rotatedSize, type ScanPage } from './pages';
import { useDragReorder } from './reorder';

interface Props {
  pages: ScanPage[];
  filename: string;
  onFilenameChange: (v: string) => void;
  format: ExportFormat;
  onFormatChange: (f: ExportFormat) => void;
  onAddPage: () => void;
  onImportPdf: (file: File) => void;
  onRemovePage: (id: number) => void;
  onMovePage: (id: number, delta: -1 | 1) => void;
  onReorderPage: (id: number, toIndex: number) => void;
  onRotatePage: (id: number) => void;
  onRestart: () => void;
}

/** Proporcion de las miniaturas de la grilla (ancho/alto). */
const TILE_ASPECT = 3 / 4;

const IS_IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Todas las páginas en un solo archivo' },
  {
    id: 'jpg',
    label: 'JPG',
    hint: IS_IOS ? 'Una imagen por página · se guarda en Fotos' : 'Una imagen por página',
  },
  { id: 'png', label: 'PNG', hint: 'Una imagen por página · sin compresión' },
];

const PAPER_OPTIONS: { id: PaperSize; label: string }[] = [
  { id: 'auto', label: 'Ajustar' },
  { id: 'carta', label: 'Carta' },
  { id: 'a4', label: 'A4' },
  { id: 'oficio', label: 'Oficio' },
];

function isPaperSize(v: unknown): v is PaperSize {
  return v === 'auto' || v === 'carta' || v === 'a4' || v === 'oficio';
}

/** Preferencia guardada en localStorage (o el valor por defecto). */
function usePref<T extends string>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (valid(v)) setValue(v);
    } catch {
      /* sin almacenamiento */
    }
  }, [key, valid]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* ignorar */
      }
    },
    [key],
  );
  return [value, set];
}

function formatBytes(b: number): string {
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; files: File[] } // hace falta un toque nuevo para compartir
  | { kind: 'done'; msg: string }
  | { kind: 'error'; msg: string };

export function ExportView({
  pages,
  filename,
  onFilenameChange,
  format,
  onFormatChange,
  onAddPage,
  onImportPdf,
  onRemovePage,
  onMovePage,
  onReorderPage,
  onRotatePage,
  onRestart,
}: Props): React.ReactElement {
  const [paper, setPaper] = usePref<PaperSize>('scanner.paper', 'auto', isPaperSize);
  const [quality, setQuality] = usePref<ExportQuality>('scanner.quality', 'max', isExportQuality);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [viewing, setViewing] = useState<number | null>(null); // id de pagina
  const working = status.kind === 'working';

  // Cada cambio de paginas/opciones invalida los archivos ya preparados.
  // `gen` sube con cada cambio: un resultado que llega tarde (de antes del
  // cambio) se descarta en vez de compartir una version vieja.
  const genRef = useRef(0);
  useEffect(() => {
    genRef.current++;
    setStatus((s) => (s.kind === 'working' ? s : { kind: 'idle' }));
  }, [pages, format, filename, paper, quality]);

  // Si la vista se cierra a mitad de una exportacion, no abrir el menu de
  // compartir encima de otra pantalla.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mensaje de exito efimero.
  useEffect(() => {
    if (status.kind !== 'done') return;
    const t = setTimeout(() => setStatus({ kind: 'idle' }), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const doneMsg = (r: 'shared' | 'downloaded', count: number): string =>
    r === 'shared' ? 'Listo.' : count > 1 ? `${count} archivos descargados.` : 'Archivo descargado.';

  const busyRef = useRef(false);
  const run = useCallback(
    async (mode: 'save' | 'download') => {
      if (pages.length === 0 || busyRef.current) return;
      busyRef.current = true;
      const gen = genRef.current;
      setStatus({ kind: 'working' });
      try {
        const files = await exportFiles(pages, format, filename, { paper, quality });
        if (!mountedRef.current) return;
        if (gen !== genRef.current) {
          // Algo cambio mientras se preparaba (no deberia: la pantalla queda
          // bloqueada), por si acaso no se entrega un archivo viejo.
          setStatus({ kind: 'idle' });
          return;
        }
        if (mode === 'download') {
          await downloadAll(files);
          setStatus({ kind: 'done', msg: doneMsg('downloaded', files.length) });
          return;
        }
        const r = await saveFiles(files);
        if (!mountedRef.current) return;
        if (r === 'needs-gesture') setStatus({ kind: 'ready', files });
        else if (r === 'shared' || r === 'downloaded') setStatus({ kind: 'done', msg: doneMsg(r, files.length) });
        else setStatus({ kind: 'idle' });
      } catch (err) {
        if (mountedRef.current) {
          setStatus({
            kind: 'error',
            msg: `No se pudo generar el archivo. ${err instanceof Error ? err.message : ''}`.trim(),
          });
        }
      } finally {
        busyRef.current = false;
      }
    },
    [pages, format, filename, paper, quality],
  );

  // Segundo toque (Safari): los archivos ya estan listos, share() se llama
  // de inmediato dentro del gesto.
  const sharingRef = useRef(false);
  const handleShareReady = useCallback(async (files: File[]) => {
    if (sharingRef.current) return;
    sharingRef.current = true;
    try {
      const r = await shareFiles(files);
      if (r === 'shared') setStatus({ kind: 'done', msg: 'Listo.' });
      else if (r === 'cancelled') setStatus({ kind: 'ready', files });
      else {
        await downloadAll(files);
        setStatus({ kind: 'done', msg: doneMsg('downloaded', files.length) });
      }
    } finally {
      sharingRef.current = false;
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (status.kind === 'ready') {
      void downloadAll(status.files).then(() =>
        setStatus({ kind: 'done', msg: doneMsg('downloaded', status.files.length) }),
      );
      return;
    }
    void run('download');
  }, [status, run]);

  const n = pages.length;
  const what =
    format === 'pdf'
      ? `PDF${n > 1 ? ` · ${n} pág` : ''}`
      : n > 1
        ? `${n} ${format.toUpperCase()}`
        : format.toUpperCase();

  // Datos tecnicos reales (fila "meta"): tamano de la 1a pagina, papel y
  // dpi del PDF, y peso estimado (las paginas ya son JPEG).
  const firstPage = pages[0];
  const first = firstPage ? rotatedSize(firstPage.width, firstPage.height, firstPage.rotation) : null;
  const totalBytes = pages.reduce((a, p) => a + p.blob.size, 0);
  const small = quality === 'small';
  const estBytes = small
    ? pages.reduce((a, p) => {
        const k = Math.min(1, 1754 / Math.max(p.width, p.height));
        // Reducir el lado a k y bajar la calidad de 0.92 a 0.72 (~ /2).
        return a + p.blob.size * k * k * 0.5;
      }, 0)
    : totalBytes;
  const sizeLabel = format === 'png' ? 'SIN PÉRDIDA' : `≈ ${formatBytes(estBytes)}`;
  const firstDpi =
    firstPage && format === 'pdf'
      ? pageLayout(
          small ? Math.round(firstPage.width * Math.min(1, 1754 / Math.max(firstPage.width, firstPage.height))) : firstPage.width,
          small ? Math.round(firstPage.height * Math.min(1, 1754 / Math.max(firstPage.width, firstPage.height))) : firstPage.height,
          firstPage.rotation,
          paper,
        ).dpi
      : null;
  const paperLabel = paper === 'auto' ? 'AJUSTADO' : PAPERS[paper].label.toUpperCase();
  const middleMeta =
    format === 'pdf'
      ? `${paperLabel}${firstDpi ? ` · ${firstDpi} DPI` : ''}`
      : format === 'jpg'
        ? small
          ? 'JPEG · LIGERA'
          : 'JPEG · 92%'
        : 'PNG';
  const showDownload = prefersShare();

  const viewIndex = viewing === null ? -1 : pages.findIndex((p) => p.id === viewing);
  const viewPage = viewIndex >= 0 ? pages[viewIndex]! : null;

  // Ordenar arrastrando (mantener presionada una hoja).
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useDragReorder({ ids: pages.map((p) => p.id), scrollRef, onDrop: onReorderPage });
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ghostPage = drag.ghost ? byId.get(drag.ghost.id) : undefined;

  return (
    <div className="stage-in safe-top flex min-h-0 flex-1 flex-col">
      {/* Cabecera */}
      <div className="safe-x flex shrink-0 items-baseline justify-between pb-3">
        <h2 className="font-display text-[28px] font-extrabold uppercase leading-none tracking-[0.02em]">Exportar</h2>
        <span className="font-mono text-xs tracking-[0.06em] text-night-400">
          03/03 · {n} PÁG
        </span>
      </div>

      {/* Contenido desplazable */}
      <div
        ref={scrollRef}
        // Mientras se prepara el archivo no se puede cambiar nada: lo que se
        // comparte es exactamente lo que se ve.
        inert={working}
        aria-busy={working}
        className={`safe-x min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 transition-opacity ${working ? 'opacity-60' : ''}`}
      >
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {drag.order.map((id, i) => {
            const p = byId.get(id);
            if (!p) return null;
            const dragging = drag.draggingId === id;
            return (
              <div
                key={id}
                data-reorder-index={i}
                className={`no-callout relative aspect-[3/4] rounded-xl ${
                  dragging ? 'border-[1.5px] border-dashed border-volt bg-volt/5' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!drag.swallowClick()) setViewing(id);
                  }}
                  onTouchStart={(e) => {
                    if (!working) drag.startTouch(id, e);
                  }}
                  onPointerDown={(e) => {
                    if (!working) drag.startMouse(id, e);
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  aria-label={`Página ${i + 1} de ${n}. Ver`}
                  className={`press absolute inset-0 overflow-hidden rounded-xl border border-night-700 bg-night-800 ${
                    dragging ? 'invisible' : ''
                  }`}
                >
                  <PageThumb src={p.thumb} rotation={p.rotation} aspect={TILE_ASPECT} />
                  <span className="absolute left-1.5 top-1.5 rounded-md bg-night-950 px-1.5 py-0.5 font-mono text-[11px] font-bold text-volt">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </button>
                {!dragging && (
                  <button
                    type="button"
                    onClick={() => onRotatePage(id)}
                    aria-label={`Girar página ${i + 1}`}
                    className="press absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border border-night-600 bg-night-950/90 text-night-100 active:border-volt active:text-volt"
                  >
                    <IconRotate className="h-[18px] w-[18px]" />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={onAddPage}
            aria-label="Escanear otra página"
            className="press flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-night-600 text-night-400 active:border-volt active:text-volt"
          >
            <IconCamera className="h-6 w-6" />
            <span className="font-display text-[13px] font-bold uppercase tracking-[0.12em]">Escanear</span>
          </button>

          <label
            aria-label="Añadir un PDF"
            className="press flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-night-600 text-night-400 focus-within:border-volt active:border-volt active:text-volt"
          >
            <IconFileAdd className="h-6 w-6" />
            <span className="font-display text-[13px] font-bold uppercase tracking-[0.12em]">Añadir PDF</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onImportPdf(f);
              }}
            />
          </label>
        </div>

        <p className="mt-2.5 font-mono text-[10px] leading-relaxed tracking-[0.06em] text-night-500">
          {n > 1 ? 'MANTÉN PRESIONADA UNA HOJA PARA MOVERLA' : 'TOCA UNA PÁGINA PARA VERLA'}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRestart}
            className="flex min-h-[40px] items-center gap-1.5 font-mono text-[11px] font-bold tracking-[0.08em] text-night-400 active:text-danger"
          >
            <IconRefresh className="h-3.5 w-3.5" />
            EMPEZAR DE NUEVO
          </button>
        </div>

        <label
          htmlFor="scan-filename"
          className="mt-2 block rounded-2xl border border-night-700 bg-night-850 px-4 pb-2.5 pt-3 focus-within:border-volt"
        >
          <span className="font-mono text-[11px] tracking-[0.08em] text-night-400">NOMBRE DEL ARCHIVO</span>
          {/* text-lg (18px): con menos de 16px, iOS hace zoom al enfocar. */}
          <input
            id="scan-filename"
            type="text"
            value={filename}
            onChange={(e) => onFilenameChange(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={120}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="mt-0.5 block w-full bg-transparent text-lg font-semibold text-night-100 outline-none"
          />
          <span className="block truncate font-mono text-[10px] tracking-[0.04em] text-night-500">
            → {sanitizeFilename(filename)}
          </span>
        </label>

        {/* Opciones del archivo */}
        <div className="mt-2.5 rounded-2xl border border-night-700 bg-night-850 px-4 py-3">
          {format === 'pdf' && (
            <>
              <p id="paper-label" className="font-mono text-[11px] tracking-[0.08em] text-night-400">
                TAMAÑO DE HOJA
              </p>
              <Segmented
                labelledBy="paper-label"
                options={PAPER_OPTIONS}
                value={paper}
                onChange={setPaper}
              />
              <p className="mt-1 font-mono text-[10px] leading-relaxed tracking-[0.04em] text-night-500">
                {paper === 'auto'
                  ? 'LA HOJA TOMA LA FORMA DEL DOCUMENTO, SIN BORDES'
                  : `${PAPERS[paper].label.toUpperCase()} EXACTA PARA IMPRIMIR · DOCUMENTO CENTRADO`}
              </p>
            </>
          )}
          <p id="quality-label" className={`font-mono text-[11px] tracking-[0.08em] text-night-400 ${format === 'pdf' ? 'mt-3' : ''}`}>
            CALIDAD
          </p>
          <Segmented
            labelledBy="quality-label"
            options={[
              { id: 'max', label: 'Máxima' },
              { id: 'small', label: 'Ligera' },
            ]}
            value={quality}
            onChange={setQuality}
          />
          <p className="mt-1 font-mono text-[10px] leading-relaxed tracking-[0.04em] text-night-500">
            {quality === 'max'
              ? 'LA MEJOR NITIDEZ (300 DPI) · ARCHIVO MÁS PESADO'
              : 'PESA MUCHO MENOS · IDEAL PARA WHATSAPP Y CORREO'}
          </p>
        </div>
      </div>

      {/* Barra de accion fija al pie */}
      <div className="safe-x safe-bottom shrink-0 border-t border-night-800 pt-3">
        <div
          className="grid grid-cols-3 gap-1 rounded-2xl border border-night-700 bg-night-850 p-1"
          role="radiogroup"
          aria-label="Formato"
        >
          {FORMATS.map((f) => {
            const selected = format === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onFormatChange(f.id)}
                disabled={working}
                className={`min-h-[42px] rounded-xl font-display text-lg font-extrabold tracking-[0.12em] transition-colors ${
                  selected ? 'bg-night-100 text-night-950' : 'text-night-400'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between gap-2 px-1 font-mono text-[10.5px] tracking-[0.04em] text-night-400">
          <span>{first ? `${first.width}×${first.height} PX` : '—'}</span>
          <span>{middleMeta}</span>
          <span>{n > 0 ? sizeLabel : '—'}</span>
        </div>
        <p className="mt-1 text-center font-mono text-[10px] tracking-[0.04em] text-night-500">
          {FORMATS.find((f) => f.id === format)!.hint.toUpperCase()}
        </p>

        {status.kind === 'error' && (
          <p role="alert" className="mt-2 rounded-xl border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger">
            {status.msg}
          </p>
        )}

        {status.kind === 'ready' ? (
          <button
            type="button"
            onClick={() => void handleShareReady(status.files)}
            className="press mt-2.5 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-volt px-5 font-display text-xl font-extrabold uppercase tracking-[0.08em] text-night-950"
          >
            <IconShare className="h-5 w-5" />
            Listo · toca para guardar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run('save')}
            disabled={status.kind === 'working' || n === 0}
            className="press mt-2.5 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-volt px-5 font-display text-xl font-extrabold uppercase tracking-[0.1em] text-night-950 disabled:opacity-50"
          >
            {status.kind === 'working' ? (
              <>
                <span className="spinner spinner-sm" aria-hidden />
                Preparando
              </>
            ) : (
              <>
                <IconShare className="h-5 w-5" />
                Guardar {what}
              </>
            )}
          </button>
        )}
        <div className="mt-0.5 flex min-h-[40px] items-center justify-center">
          {status.kind === 'done' ? (
            <p className="text-center font-mono text-[11px] font-bold tracking-[0.06em] text-volt" role="status">
              {status.msg.toUpperCase()}
            </p>
          ) : showDownload && n > 0 ? (
            // En el telefono "Guardar" abre el menu de compartir; si ahi no
            // aparece donde guardarlo, esto lo descarga directo.
            <button
              type="button"
              onClick={handleDownload}
              disabled={working}
              className="flex min-h-[40px] items-center gap-1.5 px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-night-400 active:text-volt disabled:opacity-40"
            >
              <IconDownload className="h-3.5 w-3.5" />
              DESCARGAR AL DISPOSITIVO
            </button>
          ) : (
            <span role="status" />
          )}
        </div>
      </div>

      {/* Hoja que sigue al dedo mientras se arrastra */}
      {drag.ghost && ghostPage && (
        <div
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-50 overflow-hidden rounded-xl border-2 border-volt bg-night-800 shadow-[0_18px_40px_rgba(0,0,0,0.65)]"
          style={{
            width: drag.ghost.width,
            height: drag.ghost.height,
            transform: `translate(${drag.ghost.x}px, ${drag.ghost.y}px) scale(1.06)`,
          }}
        >
          <PageThumb src={ghostPage.thumb} rotation={ghostPage.rotation} aspect={TILE_ASPECT} />
        </div>
      )}

      {viewPage && (
        <PageViewer
          page={viewPage}
          index={viewIndex}
          total={n}
          onClose={() => setViewing(null)}
          onMove={(d) => onMovePage(viewPage.id, d)}
          onRotate={() => onRotatePage(viewPage.id)}
          onRemove={() => {
            setViewing(null);
            onRemovePage(viewPage.id);
          }}
        />
      )}
    </div>
  );
}

/** Control segmentado (radiogroup) compacto para opciones. */
function Segmented<T extends string>({
  labelledBy,
  options,
  value,
  onChange,
}: {
  labelledBy: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="mt-1.5 grid gap-1 rounded-xl border border-night-700 bg-night-900 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`min-h-[40px] rounded-lg px-1 font-display text-[15px] font-bold uppercase tracking-[0.06em] transition-colors ${
              on ? 'bg-night-100 text-night-950' : 'text-night-400'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Visor a pantalla completa de una pagina con sus acciones. */
function PageViewer({
  page,
  index,
  total,
  onClose,
  onMove,
  onRotate,
  onRemove,
}: {
  page: ScanPage;
  index: number;
  total: number;
  onClose: () => void;
  onMove: (delta: -1 | 1) => void;
  onRotate: () => void;
  onRemove: () => void;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(page.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [page.blob]);

  // La foto se dibuja SIN girar y se rota con CSS: se calcula el tamano
  // para que, ya girada, quepa entera en el area disponible.
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = (): void => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const turned = rotatedSize(page.width, page.height, page.rotation);
  const k = box ? Math.min(box.w / turned.width, box.h / turned.height) : 0;
  const fit = box && k > 0 ? { w: page.width * k, h: page.height * k } : null;
  // Angulo acumulado: la animacion siempre gira en sentido horario.
  const angleRef = useRef({ rotation: page.rotation, angle: page.rotation as number });
  if (angleRef.current.rotation !== page.rotation) {
    const delta = (page.rotation - angleRef.current.rotation + 360) % 360;
    angleRef.current = { rotation: page.rotation, angle: angleRef.current.angle + delta };
  }
  const angle = angleRef.current.angle;

  // Foco al abrir (una sola vez: girar/mover re-renderiza y antes el foco
  // saltaba a "Cerrar", y un segundo Enter cerraba el visor). Al cerrar,
  // el foco vuelve a donde estaba.
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  // Portal a <body>: el visor cubre toda la pantalla aunque algun ancestro
  // tenga transform/animacion (que volveria relativos a los `fixed`).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Página ${index + 1} de ${total}`}
      className="fixed inset-0 z-50 flex flex-col bg-night-950/[0.97]"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-4 pb-3">
        <span className="font-display text-2xl font-extrabold uppercase tracking-[0.04em]">
          Página <span className="font-mono text-lg text-volt">{String(index + 1).padStart(2, '0')}</span>
          <span className="font-mono text-lg text-night-500">/{String(total).padStart(2, '0')}</span>
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="press flex h-11 w-11 items-center justify-center rounded-full border border-night-600"
        >
          <IconX className="h-5 w-5" />
        </button>
      </div>

      <div ref={boxRef} className="relative min-h-0 flex-1 mx-4" onClick={onClose}>
        {fit && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url ?? page.thumb}
            alt={`Página ${index + 1}`}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-1/2 top-1/2 max-w-none rounded-md shadow-[0_20px_50px_rgba(0,0,0,0.6)] transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{
              width: fit.w,
              height: fit.h,
              transform: `translate(-50%, -50%) rotate(${angle}deg)`,
            }}
          />
        )}
      </div>

      <div className="grid shrink-0 grid-cols-4 gap-2 px-4 pt-3.5">
        <ViewerAction
          onClick={() => onMove(-1)}
          disabled={index === 0}
          icon={<IconChevronLeft className="h-5 w-5" />}
          label="ANTES"
          ariaLabel="Mover antes"
        />
        <ViewerAction onClick={onRotate} icon={<IconRotate className="h-5 w-5" />} label="GIRAR" ariaLabel="Girar" />
        <ViewerAction onClick={onRemove} icon={<IconTrash className="h-5 w-5" />} label="QUITAR" ariaLabel="Quitar" danger />
        <ViewerAction
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          icon={<IconChevronRight className="h-5 w-5" />}
          label="DESPUÉS"
          ariaLabel="Mover después"
        />
      </div>
    </div>,
    document.body,
  );
}

function ViewerAction({
  onClick,
  disabled,
  icon,
  label,
  ariaLabel,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  ariaLabel: string;
  danger?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`press flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl border font-mono text-[10.5px] font-bold tracking-[0.06em] disabled:opacity-25 ${
        danger ? 'border-danger/70 text-danger' : 'border-night-600 text-night-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
