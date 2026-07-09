'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Recibe 1..N archivos: 1 en captura normal, N en modo rafaga o al
   * seleccionar varios archivos en el picker. */
  onCapture: (files: File[]) => void;
  onCancel?: (() => void) | undefined;
}

/**
 * Vista de captura. Intenta abrir la camara trasera del dispositivo via
 * getUserMedia; si falla (desktop sin webcam, permiso denegado, etc.) cae
 * a un input file con `capture="environment"` que en movil abre la camara
 * nativa y en desktop abre el file picker.
 */
export function CaptureView({ onCapture, onCancel }: Props): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Token de cancelacion compartido entre el effect (mount/unmount) y el
  // boton de reintento. Cada nueva invocacion a startCamera invalida el
  // token anterior — asi cubrimos:
  //   - StrictMode dev: el primer mount queda cancelado por el segundo.
  //   - Retry: la llamada previa queda cancelada por la nueva.
  //   - Unmount: el cleanup invalida el token activo.
  const cancellationRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [mode, setMode] = useState<'starting' | 'live' | 'fallback' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startCamera = useCallback(async (): Promise<void> => {
    // Cancela cualquier startCamera previo en vuelo. La nueva llamada
    // reclama el ref con su propio token.
    cancellationRef.current.cancelled = true;
    const cancellation = { cancelled: false };
    cancellationRef.current = cancellation;

    setErrorMsg(null);
    setMode('starting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      if (!cancellation.cancelled) setMode('fallback');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });

      if (cancellation.cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      // Si habia un stream previo todavia vivo, paralo antes de sustituirlo.
      const prev = streamRef.current;
      if (prev && prev !== stream) {
        for (const track of prev.getTracks()) track.stop();
      }
      streamRef.current = stream;

      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      if (!cancellation.cancelled) setMode('live');
    } catch (err) {
      if (cancellation.cancelled) return;
      // Permiso denegado, sin camara, o el browser no permite getUserMedia
      // fuera de HTTPS. En todos los casos preferimos caer al input file
      // antes que bloquear la app.
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setMode('fallback');
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => {
      cancellationRef.current.cancelled = true;
      const s = streamRef.current;
      if (s) {
        for (const track of s.getTracks()) track.stop();
        streamRef.current = null;
      }
    };
  }, [startCamera]);

  const handleRetry = useCallback((): void => {
    void startCamera();
  }, [startCamera]);

  // Modo rafaga: las capturas se acumulan y se editan todas juntas al
  // final — el flujo multi-pagina de CamScanner.
  const [batchMode, setBatchMode] = useState(false);
  const [shots, setShots] = useState<File[]>([]);
  const [flash, setFlash] = useState(false);

  const handleShutter = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        if (batchMode) {
          setShots((prev) => [...prev, file]);
          // Feedback visual breve de que la captura entro.
          setFlash(true);
          setTimeout(() => setFlash(false), 150);
        } else {
          onCapture([file]);
        }
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture, batchMode]);

  const handleBatchDone = useCallback(() => {
    if (shots.length === 0) return;
    const files = shots;
    setShots([]);
    onCapture(files);
  }, [shots, onCapture]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onCapture(files);
      e.target.value = '';
    },
    [onCapture],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-video">
        {mode === 'live' && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        )}
        {mode === 'starting' && (
          <div className="flex h-full items-center justify-center text-ink-400">
            Iniciando camara...
          </div>
        )}
        {mode === 'fallback' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-300">
            <p className="text-sm">
              No pudimos abrir la camara
              {errorMsg ? `: ${errorMsg}` : '.'}
            </p>
            <label className="cursor-pointer rounded-md border border-ink-700 bg-ink-800 px-4 py-2 text-sm hover:bg-ink-700">
              Elegir imagen del dispositivo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFile}
              />
            </label>
            <button
              type="button"
              onClick={handleRetry}
              className="text-xs text-ink-400 underline"
            >
              Reintentar camara
            </button>
          </div>
        )}

        {/* Guide overlay solo cuando estamos en live, para encuadrar mejor. */}
        {mode === 'live' && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-6 rounded-md border-2 border-white/40"
          />
        )}

        {/* Flash de confirmacion en modo rafaga. */}
        {flash && (
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-white/60" />
        )}

        {/* Contador de capturas acumuladas en rafaga. */}
        {batchMode && shots.length > 0 && (
          <div className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-bold text-emerald-950">
            {shots.length}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-300 hover:bg-ink-800"
          >
            Cancelar
          </button>
        )}

        {mode === 'live' && (
          <>
            <button
              type="button"
              onClick={() => setBatchMode((b) => !b)}
              className={`rounded-md border px-3 py-2 text-sm ${
                batchMode
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                  : 'border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700'
              }`}
              aria-pressed={batchMode}
            >
              Rafaga {batchMode ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={handleShutter}
              className="ml-auto inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-lg hover:bg-emerald-400"
              aria-label="Capturar"
            >
              <span className="inline-block h-3 w-3 rounded-full bg-emerald-950" />
              Capturar
            </button>
            {batchMode && shots.length > 0 && (
              <button
                type="button"
                onClick={handleBatchDone}
                className="rounded-md border border-emerald-500 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                Editar {shots.length} {shots.length === 1 ? 'captura' : 'capturas'}
              </button>
            )}
          </>
        )}

        <label className="cursor-pointer rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm hover:bg-ink-700">
          Subir archivos
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFile}
          />
        </label>
      </div>
    </div>
  );
}
