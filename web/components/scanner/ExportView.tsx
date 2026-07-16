'use client';

import { useCallback, useState } from 'react';
import {
  exportPages,
  saveBlob,
  type ExportFormat,
} from './export';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconX,
} from './icons';

interface Page {
  canvas: HTMLCanvasElement;
  thumb: string;
}

interface Props {
  pages: Page[];
  onAddPage: () => void;
  onRemovePage: (index: number) => void;
  onMovePage: (index: number, delta: -1 | 1) => void;
  onRestart: () => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Una o varias paginas en un solo archivo' },
  { id: 'jpg', label: 'JPG', hint: 'Imagen comprimida, ideal para compartir' },
  { id: 'png', label: 'PNG', hint: 'Imagen sin perdida' },
];

export function ExportView({ pages, onAddPage, onRemovePage, onMovePage, onRestart }: Props): React.ReactElement {
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [filename, setFilename] = useState<string>('escaneo');
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (pages.length === 0) return;
    setExporting(true);
    try {
      const sanitized = filename.replace(/[^a-zA-Z0-9_-]/g, '_') || 'escaneo';
      const { blob, filename: outName } = await exportPages(
        pages.map((p) => ({ canvas: p.canvas, filename: sanitized })),
        format,
      );
      // En movil abre el share sheet nativo (en iPhone: "Guardar imagen"
      // -> fototeca); en desktop descarga.
      await saveBlob(blob, outName);
    } finally {
      setExporting(false);
    }
  }, [pages, filename, format]);

  return (
    <div className="stage-in flex flex-col gap-4">
      {/* Paginas */}
      <div>
        <h2 className="mb-2 px-1 font-display text-xs font-semibold uppercase tracking-[0.18em] text-cocoa-500">
          Paginas ({pages.length})
        </h2>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {pages.map((p, i) => (
            <div
              key={i}
              className="group relative aspect-[3/4] overflow-hidden rounded-md border-2 border-cocoa-900 bg-paper shadow-paper transition-transform"
              style={{ transform: `rotate(${i % 2 === 0 ? -1.2 : 1.1}deg)` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumb}
                alt={`Pagina ${i + 1}`}
                className="h-full w-full object-cover"
              />
              <div className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-paper bg-cocoa-900 font-display text-[11px] font-bold text-paper">
                {i + 1}
              </div>
              {pages.length > 1 && (
                <button
                  type="button"
                  aria-label={`Eliminar pagina ${i + 1}`}
                  onClick={() => onRemovePage(i)}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-paper bg-cocoa-900 text-paper transition-colors active:bg-stamp-600"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              )}
              {pages.length > 1 && (
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-cocoa-900/70 px-1 py-0.5">
                  <button
                    type="button"
                    aria-label={`Mover pagina ${i + 1} a la izquierda`}
                    onClick={() => onMovePage(i, -1)}
                    disabled={i === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-25"
                  >
                    <IconChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Mover pagina ${i + 1} a la derecha`}
                    onClick={() => onMovePage(i, 1)}
                    disabled={i === pages.length - 1}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-25"
                  >
                    <IconChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Tile para agregar otra pagina */}
          <button
            type="button"
            onClick={onAddPage}
            aria-label="Agregar pagina"
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-cocoa-900/50 text-cocoa-500 transition-colors active:border-stamp-600 active:text-stamp-600"
          >
            <IconPlus className="h-6 w-6" />
            <span className="text-[11px] font-semibold">Agregar</span>
          </button>
        </div>
      </div>

      {/* Formato */}
      <div>
        <h2 className="mb-2 px-1 font-display text-xs font-semibold uppercase tracking-[0.18em] text-cocoa-500">
          Formato
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {FORMATS.map((f) => {
            const selected = format === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                title={f.hint}
                aria-pressed={selected}
                className={`chip-stamp flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-cocoa-900/25 bg-paper px-2 py-2.5 shadow-paper-sm transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                  selected ? 'chip-selected' : ''
                }`}
              >
                <span
                  className={`font-display text-base font-bold ${
                    selected ? 'text-stamp-700' : 'text-cocoa-700'
                  }`}
                >
                  {f.label}
                </span>
                <span className="text-[9.5px] leading-tight text-cocoa-500">
                  {f.id === 'pdf' ? 'multi-pagina' : f.id === 'jpg' ? 'comprimido' : 'sin perdida'}
                </span>
              </button>
            );
          })}
        </div>
        {format !== 'pdf' && pages.length > 1 && (
          <p className="mt-2 rounded-md border-2 border-note-300 bg-note-100 px-3 py-2 text-[11px] leading-relaxed text-note-700 shadow-paper-sm">
            {format.toUpperCase()} solo exporta una imagen. Usa PDF para
            guardar todas las paginas juntas.
          </p>
        )}
      </div>

      {/* Nombre */}
      <div>
        <label
          htmlFor="scan-filename"
          className="mb-2 block px-1 font-display text-xs font-semibold uppercase tracking-[0.18em] text-cocoa-500"
        >
          Nombre del archivo
        </label>
        <input
          id="scan-filename"
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          autoComplete="off"
          className="w-full rounded-lg border-2 border-cocoa-900/30 bg-paper px-4 py-3 text-sm text-cocoa-900 shadow-paper-sm outline-none transition-colors focus:border-cocoa-900"
        />
        <p className="mt-1.5 px-1 text-[10px] text-cocoa-400">
          Solo a-z, A-Z, 0-9, _ y -. Lo demas se sustituye por _.
        </p>
      </div>

      {/* CTA */}
      <div className="safe-bottom flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onRestart}
          className="btn-ghost flex min-h-[52px] items-center justify-center gap-1.5 rounded-lg px-4 font-display text-base font-semibold text-cocoa-900"
        >
          <IconRefresh className="h-4 w-4" />
          Empezar de nuevo
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting || pages.length === 0}
          className="btn-scan flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-lg px-5 font-display text-base font-semibold"
        >
          <IconDownload className="h-4 w-4" />
          {exporting ? 'Exportando...' : `Descargar ${format.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}
