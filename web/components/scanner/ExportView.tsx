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
  { id: 'pdf', label: 'PDF', hint: 'Todas las páginas en un solo archivo' },
  { id: 'jpg', label: 'JPG', hint: 'Una imagen por página · se guarda en Fotos' },
  { id: 'png', label: 'PNG', hint: 'Una imagen por página · sin compresión' },
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
      ? `PDF${n > 1 ? ` · ${n} pág` : ''}`
      : n > 1
        ? `${n} ${format.toUpperCase()}`
        : format.toUpperCase();

  // Datos tecnicos reales (fila "meta"): tamano de la 1a pagina, dpi del
  // PDF y peso estimado (las paginas ya son JPEG: PDF y JPG pesan ~eso).
  const first = pages[0];
  const totalBytes = pages.reduce((a, p) => a + p.blob.size, 0);
  const sizeLabel =
    format === 'png' ? 'SIN PÉRDIDA' : `≈ ${totalBytes >= 1e6 ? (totalBytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(totalBytes / 1e3)) + ' KB'}`;

  const viewIndex = viewing === null ? -1 : pages.findIndex((p) => p.id === viewing);
  const viewPage = viewIndex >= 0 ? pages[viewIndex]! : null;

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
      <div className="safe-x min-h-0 flex-1 overflow-y-auto pb-3">
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setViewing(p.id)}
              aria-label={`Página ${i + 1} de ${n}. Ver`}
              className="press relative aspect-[3/4] overflow-hidden rounded-xl border border-night-700 bg-night-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt="" className="h-full w-full object-cover" />
              <span className="absolute left-1.5 top-1.5 rounded-md bg-night-950 px-1.5 py-0.5 font-mono text-[11px] font-bold text-volt">
                {String(i + 1).padStart(2, '0')}
              </span>
            </button>
          ))}

          <button
            type="button"
            onClick={onAddPage}
            aria-label="Agregar página"
            className="press flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-night-600 text-night-400 active:border-volt active:text-volt"
          >
            <IconPlus className="h-6 w-6" />
            <span className="font-display text-[13px] font-bold uppercase tracking-[0.12em]">Añadir</span>
          </button>
        </div>

        <div className="mt-2.5 flex items-center justify-between">
          <p className="font-mono text-[10px] tracking-[0.08em] text-night-500">TOCA UNA PÁGINA PARA VERLA</p>
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
            className="mt-0.5 block w-full bg-transparent text-lg font-semibold text-night-100 outline-none"
          />
          <span className="block truncate font-mono text-[10px] tracking-[0.04em] text-night-500">
            → {sanitizeFilename(filename)}
          </span>
        </label>
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
                onClick={() => setFormat(f.id)}
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
          <span>{format === 'pdf' ? 'A4 · 300 DPI' : format === 'jpg' ? 'JPEG · 92%' : 'PNG'}</span>
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
            onClick={() => void handleSave()}
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
        <p className="mt-1 min-h-[1rem] text-center font-mono text-[11px] font-bold tracking-[0.06em] text-volt" role="status">
          {status.kind === 'done' ? status.msg.toUpperCase() : ''}
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

      <div className="flex min-h-0 flex-1 items-center justify-center px-4" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url ?? page.thumb}
          alt={`Página ${index + 1}`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-md object-contain shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
        />
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2.5 px-4 pt-3.5">
        <ViewerAction
          onClick={() => onMove(-1)}
          disabled={index === 0}
          icon={<IconChevronLeft className="h-5 w-5" />}
          label="ANTES"
          ariaLabel="Mover antes"
        />
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
      className={`press flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl border font-mono text-[11px] font-bold tracking-[0.08em] disabled:opacity-25 ${
        danger ? 'border-danger/70 text-danger' : 'border-night-600 text-night-100'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
