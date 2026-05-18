'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  canvasToBase64Jpeg,
  downloadBlob,
  exportPages,
  type ExportFormat,
} from './export';
import type { ScanIdentifyResult } from './types';

interface Page {
  canvas: HTMLCanvasElement;
  thumb: string;
}

interface Props {
  pages: Page[];
  onAddPage: () => void;
  onRemovePage: (index: number) => void;
  onRestart: () => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'PDF', hint: 'Una o varias paginas en un solo archivo' },
  { id: 'jpg', label: 'JPG', hint: 'Imagen comprimida, ideal para compartir' },
  { id: 'png', label: 'PNG', hint: 'Imagen sin perdida' },
];

export function ExportView({ pages, onAddPage, onRemovePage, onRestart }: Props): React.ReactElement {
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [filename, setFilename] = useState<string>('escaneo');
  const [identifying, setIdentifying] = useState(false);
  const [classification, setClassification] = useState<ScanIdentifyResult | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Auto-identificar la primera pagina cuando aparece. Solo lo intentamos
  // una vez por sesion para no quemar tokens si el usuario re-edita.
  const [identifiedFor, setIdentifiedFor] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (pages.length === 0) return;
    const first = pages[0]!.canvas;
    if (identifiedFor === first) return;

    let cancelled = false;
    setIdentifying(true);
    setIdError(null);

    (async () => {
      try {
        const { base64, mimeType } = canvasToBase64Jpeg(first);
        const res = await fetch('/api/scan/identify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mimeType }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { classification: ScanIdentifyResult };
        if (cancelled) return;
        setClassification(data.classification);
        // Solo auto-renombramos si el usuario no toco el campo.
        setFilename((current) =>
          current === 'escaneo' ? data.classification.suggestedFilename : current,
        );
      } catch (err) {
        if (!cancelled) setIdError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setIdentifying(false);
          setIdentifiedFor(first);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pages, identifiedFor]);

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
    <div className="flex flex-col gap-5">
      {/* Paginas */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-200">
            Paginas ({pages.length})
          </h2>
          <button
            type="button"
            onClick={onAddPage}
            className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs hover:bg-ink-700"
          >
            + Agregar pagina
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {pages.map((p, i) => (
            <div
              key={i}
              className="relative h-32 w-24 overflow-hidden rounded-md border border-ink-700 bg-ink-950"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumb}
                alt={`Pagina ${i + 1}`}
                className="h-full w-full object-cover"
              />
              <div className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {i + 1}
              </div>
              {pages.length > 1 && (
                <button
                  type="button"
                  aria-label={`Eliminar pagina ${i + 1}`}
                  onClick={() => onRemovePage(i)}
                  className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white hover:bg-rose-600"
                >
                  X
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Identificacion */}
      <div className="rounded-md border border-ink-800 bg-ink-900 p-3 text-sm">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Identificacion automatica
        </div>
        {identifying && <p className="text-ink-300">Analizando con Claude...</p>}
        {idError && (
          <p className="text-rose-300">No se pudo identificar: {idError}</p>
        )}
        {classification && !identifying && (
          <div className="space-y-1 text-ink-200">
            <p>
              <span className="text-ink-400">Tipo:</span>{' '}
              <code className="text-emerald-300">{classification.documentType}</code>
              <span className="ml-2 text-ink-500">
                ({Math.round(classification.confidence * 100)}%)
              </span>
            </p>
            {classification.title && (
              <p>
                <span className="text-ink-400">Titulo:</span> {classification.title}
              </p>
            )}
            <p className="text-ink-300">{classification.summary}</p>
          </div>
        )}
      </div>

      {/* Formato y nombre */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-400">
            Formato
          </label>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFormat(f.id)}
                title={f.hint}
                className={`rounded-md border px-3 py-2 text-sm ${
                  format === f.id
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                    : 'border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {format !== 'pdf' && pages.length > 1 && (
            <p className="mt-2 text-xs text-amber-300">
              {format.toUpperCase()} solo exporta una imagen. Usa PDF para
              guardar todas las paginas juntas.
            </p>
          )}
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-ink-400">
            Nombre del archivo
          </label>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Solo a-z, A-Z, 0-9, _ y -. Lo demas se sustituye por _.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800"
        >
          Empezar de nuevo
        </button>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting || pages.length === 0}
          className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? 'Exportando...' : `Descargar ${format.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}
