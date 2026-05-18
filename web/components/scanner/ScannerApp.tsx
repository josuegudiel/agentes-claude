'use client';

import { useCallback, useState } from 'react';
import { CaptureView } from './CaptureView';
import { EditView } from './EditView';
import { ExportView } from './ExportView';
import { loadImageFromFile } from './pipeline';

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
 */
export function ScannerApp(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('capture');
  const [pendingImage, setPendingImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);

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

  const handleRestart = useCallback(() => {
    setPages([]);
    setPendingImage(null);
    setLoadError(null);
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
          onRestart={handleRestart}
        />
      )}
    </div>
  );
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
