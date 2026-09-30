'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  downloadAll,
  exportFiles,
  sanitizeFilename,
  saveFiles,
  shareFiles,
  type ExportFormat,
} from './export';
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconRefresh,
  IconShare,
  IconTrash,
  IconX,
} from './icons';
import type { ScanPage } from './pages';

interface Props {
  pages: ScanPage[];
  onAddPage: () => void;
  onRemovePage: (id: number) => void;
  onMovePage: (id: number, delta: -1 | 1) => void;
  onRestart: () => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Todas las paginas en un archivo' },
  { id: 'jpg', label: 'JPG', hint: 'Una imagen por pagina · va a Fotos' },
  { id: 'png', label: 'PNG', hint: 'Una imagen por pagina · sin compresion' },
];

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; files: File[] } // hace falta un toque nuevo para compartir
  | { kind: 'done'; msg: string }
  | { kind: 'error'; msg: string };

export function ExportView({
  pages,
  onAddPage,
  onRemovePage,
  onMovePage,
  onRestart,
}: Props): React.ReactElement {
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [filename, setFilename] = useState<string>('escaneo');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [viewing, setViewing] = useState<number | null>(null); // id de pagina

  // Cambiar paginas/formato/nombre invalida archivos ya preparados.
  useEffect(() => {
    setStatus((s) => (s.kind === 'working' ? s : { kind: 'idle' }));
  }, [pages, format, filename]);

  // Mensaje de exito efimero.
  useEffect(() => {
    if (status.kind !== 'done') return;
    const t = setTimeout(() => setStatus({ kind: 'idle' }), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const busyRef = useRef(false);
  const handleSave = useCallback(async () => {
    if (pages.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setStatus({ kind: 'working' });
    try {
      const files = await exportFiles(pages, format, filename);
      const r = await saveFiles(files);
      if (r === 'needs-gesture') setStatus({ kind: 'ready', files });
      else if (r === 'shared') setStatus({ kind: 'done', msg: 'Listo.' });
      else if (r === 'downloaded')
        setStatus({ kind: 'done', msg: files.length > 1 ? `${files.length} archivos descargados.` : 'Archivo descargado.' });
      else setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({
        kind: 'error',
        msg: `No se pudo generar el archivo. ${err instanceof Error ? err.message : ''}`.trim(),
      });
    } finally {
      busyRef.current = false;
    }
  }, [pages, format, filename]);

  // Segundo toque (Safari): los archivos ya estan listos, share() se llama
  // de inmediato dentro del gesto.
  const handleShareReady = useCallback(async (files: File[]) => {
    const r = await shareFiles(files);
    if (r === 'shared') setStatus({ kind: 'done', msg: 'Listo.' });
    else if (r === 'cancelled') setStatus({ kind: 'ready', files });
    else {
      await downloadAll(files);
      setStatus({ kind: 'done', msg: 'Archivo descargado.' });
    }
  }, []);

  const n = pages.length;
  const what =
    format === 'pdf'
      ? `PDF${n > 1 ? ` · ${n} pags` : ''}`
      : n > 1
        ? `${n} imagenes ${format.toUpperCase()}`
        : format.toUpperCase();

  const viewIndex = viewing === null ? -1 : pages.findIndex((p) => p.id === viewing);
  const viewPage = viewIndex >= 0 ? pages[viewIndex]! : null;

  return (
    <div className="stage-in flex min-h-0 flex-1 flex-col">
      {/* Contenido desplazable */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <h2 className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-cocoa-500">
            Paginas ({n})
          </h2>
          <button
            type="button"
            onClick={onRestart}
            className="flex min-h-[40px] items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-cocoa-500 underline-offset-4 active:underline"
          >
            <IconRefresh className="h-4 w-4" />
            Empezar de nuevo
          </button>
        </div>

        <p className="mb-2 px-1 text-xs text-cocoa-500">Toca una pagina para verla, moverla o quitarla.</p>

        <div className="grid grid-cols-3 gap-3 pt-1 sm:grid-cols-4">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setViewing(p.id)}
              aria-label={`Pagina ${i + 1} de ${n}. Ver`}
              className="relative aspect-[3/4] overflow-hidden rounded-md border-2 border-cocoa-900 bg-paper shadow-paper transition-transform active:scale-[0.97]"
              style={{ transform: `rotate(${i % 2 === 0 ? -1 : 0.9}deg)` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt="" className="h-full w-full object-cover" />
              <span className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-paper bg-cocoa-900 px-1 font-display text-xs font-bold text-paper">
                {i + 1}
              </span>
            </button>
          ))}

          <button
            type="button"
            onClick={onAddPage}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-cocoa-900/50 bg-paper/40 text-cocoa-700 transition-colors active:border-stamp-600 active:text-stamp-600"
          >
            <IconPlus className="h-7 w-7" />
            <span className="text-sm font-semibold">Agregar</span>
          </button>
        </div>

        <div className="mt-5">
          <label
            htmlFor="scan-filename"
            className="mb-1.5 block px-1 font-display text-xs font-semibold uppercase tracking-[0.18em] text-cocoa-500"
          >
            Nombre del archivo
          </label>
          {/* text-base (16px): con menos, iOS hace zoom al enfocar el campo. */}
          <input
            id="scan-filename"
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
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
            className="w-full rounded-lg border-2 border-cocoa-900/30 bg-paper px-4 py-3 text-base text-cocoa-900 shadow-paper-sm outline-none transition-colors focus:border-cocoa-900"
          />
          <p className="mt-1.5 px-1 text-xs text-cocoa-400">
            Se guardara como <span className="font-semibold text-cocoa-700">{sanitizeFilename(filename)}</span>
          </p>
        </div>
      </div>

      {/* Barra de accion fija al pie */}
      <div className="safe-bottom shrink-0 border-t-2 border-cocoa-900 pt-3">
        <div className="grid grid-cols-3 gap-1 rounded-lg border-2 border-cocoa-900 bg-kraft-300 p-1" role="radiogroup" aria-label="Formato">
          {FORMATS.map((f) => {
            const selected = format === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setFormat(f.id)}
                className={`min-h-[40px] rounded-md font-display text-base font-bold transition-colors ${
                  selected ? 'bg-paper text-stamp-700 shadow-paper-ink-sm' : 'text-cocoa-700'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-center text-xs text-cocoa-500">
          {FORMATS.find((f) => f.id === format)!.hint}
        </p>

        {status.kind === 'error' && (
          <p role="alert" className="mt-2 rounded-md border-2 border-stamp-600 bg-stamp-50 px-3 py-2 text-xs text-stamp-700">
            {status.msg}
          </p>
        )}

        {status.kind === 'ready' ? (
          <button
            type="button"
            onClick={() => void handleShareReady(status.files)}
            className="btn-scan mt-2 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-lg px-5 font-display text-lg font-semibold"
          >
            <IconShare className="h-5 w-5" />
            Archivo listo · toca para guardar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={status.kind === 'working' || n === 0}
            className="btn-scan mt-2 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-lg px-5 font-display text-lg font-semibold"
          >
            {status.kind === 'working' ? (
              <>
                <span className="spinner spinner-sm" aria-hidden />
                Preparando...
              </>
            ) : (
              <>
                <IconShare className="h-5 w-5" />
                Guardar {what}
              </>
            )}
          </button>
        )}
        <p className="mt-1 min-h-[1rem] text-center text-xs font-semibold text-cocoa-700" role="status">
          {status.kind === 'done' ? status.msg : ''}
        </p>
      </div>

      {viewPage && (
        <PageViewer
          page={viewPage}
          index={viewIndex}
          total={n}
          onClose={() => setViewing(null)}
          onMove={(d) => onMovePage(viewPage.id, d)}
          onRemove={() => {
            setViewing(null);
            onRemovePage(viewPage.id);
          }}
        />
      )}
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
  onRemove,
}: {
  page: ScanPage;
  index: number;
  total: number;
  onClose: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(page.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [page.blob]);

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal a <body>: la vista padre tiene una animacion con transform, que
  // convierte a los hijos `fixed` en relativos a ella (el visor quedaba
  // recortado debajo de las pestanas en vez de cubrir la pantalla).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pagina ${index + 1} de ${total}`}
      className="fixed inset-0 z-50 flex flex-col bg-cocoa-900/95"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 text-paper">
        <span className="font-display text-lg font-semibold">
          Pagina {index + 1} de {total}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-paper/60"
        >
          <IconX className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url ?? page.thumb}
          alt={`Pagina ${index + 1}`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-sm border-2 border-paper object-contain shadow-paper-ink"
        />
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 px-4 pt-3 text-paper">
        <ViewerAction
          onClick={() => onMove(-1)}
          disabled={index === 0}
          icon={<IconChevronLeft className="h-5 w-5" />}
          label="Antes"
        />
        <ViewerAction onClick={onRemove} icon={<IconTrash className="h-5 w-5" />} label="Quitar" danger />
        <ViewerAction
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          icon={<IconChevronRight className="h-5 w-5" />}
          label="Despues"
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
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg border-2 text-sm font-semibold disabled:opacity-30 ${
        danger ? 'border-stamp-600 bg-stamp-600 text-paper' : 'border-paper/50 text-paper'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
