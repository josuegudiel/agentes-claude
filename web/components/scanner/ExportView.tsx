'use client';

import { useCallback, useState } from 'react';
import {
  downloadBlob,
  exportPages,
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
      downloadBlob(blob, outName);
    } finally {
      setExporting(false);
    }
  }, [pages, filename, format]);

  return (
    <div className="stage-in flex flex-col gap-4">
      {/* Paginas */}
      <div>
        <h2 className="mb-2 px-1 font-display text-[11px] font-semibold uppercase tracking-widest text-carbon-500">
          Paginas ({pages.length})
        </h2>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {pages.map((p, i) => (
            <div
              key={i}
              className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-carbon-900 shadow-card ring-1 ring-carbon-700/70"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumb}
                alt={`Pagina ${i + 1}`}
                className="h-full w-full object-cover"
              />
              <div className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 font-display text-[11px] font-bold text-white backdrop-blur-sm">
                {i + 1}
              </div>
              {pages.length > 1 && (
                <button
                  type="button"
                  aria-label={`Eliminar pagina ${i + 1}`}
                  onClick={() => onRemovePage(i)}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-colors active:bg-rose-600"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              )}
              {pages.length > 1 && (
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/80 to-transparent px-1 pb-1 pt-4">
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
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-carbon-600/70 text-carbon-400 transition-colors active:border-scan-500/60 active:text-scan-300"
          >
            <IconPlus className="h-6 w-6" />
            <span className="text-[11px] font-medium">Agregar</span>
          </button>
        </div>
      </div>

      {/* Formato */}
      <div>
        <h2 className="mb-2 px-1 font-display text-[11px] font-semibold uppercase tracking-widest text-carbon-500">
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
                className={`scan-card flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-2.5 transition-transform active:scale-95 ${
                  selected ? 'chip-selected' : ''
                }`}
              >
                <span
                  className={`font-display text-sm font-bold ${
                    selected ? 'text-scan-300' : 'text-carbon-300'
                  }`}
                >
                  {f.label}
                </span>
                <span className="text-[9.5px] leading-tight text-carbon-500">
                  {f.id === 'pdf' ? 'multi-pagina' : f.id === 'jpg' ? 'comprimido' : 'sin perdida'}
                </span>
              </button>
            );
          })}
        </div>
        {format !== 'pdf' && pages.length > 1 && (
          <p className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            {format.toUpperCase()} solo exporta una imagen. Usa PDF para
            guardar todas las paginas juntas.
          </p>
        )}
      </div>

      {/* Nombre */}
      <div>
        <label
          htmlFor="scan-filename"
          className="mb-2 block px-1 font-display text-[11px] font-semibold uppercase tracking-widest text-carbon-500"
        >
          Nombre del archivo
        </label>
        <input
          id="scan-filename"
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          autoComplete="off"
          className="w-full rounded-2xl border border-carbon-700/70 bg-carbon-900 px-4 py-3 text-sm text-paper outline-none transition-colors focus:border-scan-500/70 focus:shadow-glow-sm"
        />
        <p className="mt-1.5 px-1 text-[10px] text-carbon-500">
          Solo a-z, A-Z, 0-9, _ y -. Lo demas se sustituye por _.
        </p>
      </div>

      {/* CTA */}
      <div className="safe-bottom flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onRestart}
          className="btn-ghost flex min-h-[52px] items-center justify-center gap-1.5 rounded-2xl px-4 text-sm font-medium text-carbon-300"
        >
          <IconRefresh className="h-4 w-4" />
          Empezar de nuevo
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting || pages.length === 0}
          className="btn-scan flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl px-5 font-display text-sm font-semibold"
        >
          <IconDownload className="h-4 w-4" />
          {exporting ? 'Exportando...' : `Descargar ${format.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}
