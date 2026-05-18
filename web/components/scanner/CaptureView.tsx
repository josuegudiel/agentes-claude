'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  onCapture: (file: File) => void;
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
  const [mode, setMode] = useState<'starting' | 'live' | 'fallback' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    setMode('starting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMode('fallback');
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
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      setMode('live');
    } catch (err) {
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
      const s = streamRef.current;
      if (s) {
        for (const track of s.getTracks()) track.stop();
        streamRef.current = null;
      }
    };
  }, [startCamera]);

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
        onCapture(file);
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onCapture(file);
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
              onClick={() => void startCamera()}
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
          <button
            type="button"
            onClick={handleShutter}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-lg hover:bg-emerald-400"
            aria-label="Capturar"
          >
            <span className="inline-block h-3 w-3 rounded-full bg-emerald-950" />
            Capturar
          </button>
        )}

        <label className="cursor-pointer rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-sm hover:bg-ink-700">
          Subir archivo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
        </label>
      </div>
    </div>
  );
}
