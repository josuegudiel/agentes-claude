'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBolt, IconCamera, IconChevronLeft, IconRefresh, IconUpload } from './icons';

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

  // Cinturon de seguridad: si por cualquier carrera el stream existe pero
  // el <video> aun no lo tiene atado (p.ej. remount), re-atalo al entrar
  // en modo live. El bug clasico aqui es montar el <video> condicionado a
  // mode==='live' — el ref es null cuando llega el stream y la pantalla
  // queda negra. Por eso el <video> se monta SIEMPRE (invisible fuera de
  // live) y ademas sincronizamos aca.
  useEffect(() => {
    if (mode !== 'live') return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      void v.play().catch(() => {});
    }
  }, [mode]);

  const handleRetry = useCallback((): void => {
    void startCamera();
  }, [startCamera]);

  // Modo rafaga: las capturas se acumulan y se editan todas juntas al
  // final — el flujo multi-pagina de CamScanner.
  const [batchMode, setBatchMode] = useState(false);
  const [shots, setShots] = useState<File[]>([]);
  const [flash, setFlash] = useState(0);

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
          // Feedback visual breve de que la captura entro (key remonta el
          // overlay para reiniciar la animacion CSS).
          setFlash((f) => f + 1);
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
    <div className="stage-in flex flex-col gap-3">
      {/* Visor */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-stone-200 bg-stone-900 sm:aspect-[4/3]">
        {/* El <video> vive SIEMPRE en el DOM (solo cambia la visibilidad):
            asi videoRef.current existe cuando getUserMedia resuelve y el
            stream se ata de inmediato. Montarlo condicionado a live dejaba
            el ref en null -> video sin srcObject -> pantalla negra. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${mode === 'live' ? 'visible' : 'invisible'}`}
        />

        {mode === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-stone-900 text-stone-400">
            <IconCamera className="h-8 w-8 animate-pulse text-stone-300" />
            <span className="text-sm">Iniciando camara...</span>
          </div>
        )}

        {mode === 'fallback' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-stone-50 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-stone-200 bg-white">
              <IconCamera className="h-8 w-8 text-stone-400" />
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-stone-600">
              No pudimos abrir la camara
              {errorMsg ? (
                <span className="block text-xs text-stone-400">{errorMsg}</span>
              ) : (
                '.'
              )}
            </p>
            <label className="btn-scan flex min-h-[48px] cursor-pointer items-center gap-2 rounded-full px-6 py-3 text-sm font-bold">
              <IconUpload className="h-4 w-4" />
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
              className="flex items-center gap-1.5 text-xs text-stone-500 underline underline-offset-4"
            >
              <IconRefresh className="h-3.5 w-3.5" />
              Reintentar camara
            </button>
          </div>
        )}

        {/* Overlays del visor en vivo */}
        {mode === 'live' && (
          <>
            <div className="viewfinder-vignette" aria-hidden />
            <span className="viewfinder-corner tl" aria-hidden />
            <span className="viewfinder-corner tr" aria-hidden />
            <span className="viewfinder-corner br" aria-hidden />
            <span className="viewfinder-corner bl" aria-hidden />
            <span className="scan-line" aria-hidden />
            <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-[11px] font-semibold tracking-wide text-white/75">
              Encuadra el documento
            </p>
          </>
        )}

        {/* Flash de confirmacion en modo rafaga */}
        {flash > 0 && (
          <div key={flash} aria-hidden className="shot-flash pointer-events-none absolute inset-0 bg-white" />
        )}

        {/* Contador de capturas acumuladas en rafaga */}
        {batchMode && shots.length > 0 && (
          <div className="absolute right-3 top-3 flex h-8 min-w-8 items-center justify-center rounded-full bg-leaf-500 px-2 text-sm font-bold text-white">
            {shots.length}
          </div>
        )}

        {/* Volver a export si ya hay paginas */}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="absolute left-3 top-3 flex h-9 items-center gap-1 rounded-full bg-black/50 px-3 text-xs font-medium text-white backdrop-blur-sm"
          >
            <IconChevronLeft className="h-4 w-4" />
            Mis paginas
          </button>
        )}
      </div>

      {/* Controles: rafaga | shutter | subir — como una app de camara */}
      <div className="flex items-center justify-between gap-2 px-1">
        {mode === 'live' ? (
          <button
            type="button"
            onClick={() => setBatchMode((b) => !b)}
            aria-pressed={batchMode}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-2xl px-3 py-1.5 text-[11px] font-medium transition-colors ${
              batchMode
                ? 'text-leaf-700'
                : 'text-stone-500'
            }`}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all ${
                batchMode
                  ? 'border-leaf-500 bg-leaf-50'
                  : 'border-stone-200 bg-white'
              }`}
            >
              <IconBolt className="h-4 w-4" />
            </span>
            Rafaga {batchMode ? 'ON' : 'OFF'}
          </button>
        ) : (
          <span className="w-[68px]" aria-hidden />
        )}

        {mode === 'live' ? (
          <button
            type="button"
            onClick={handleShutter}
            className="shutter shrink-0"
            aria-label="Capturar"
          >
            <span className="shutter-inner block" />
          </button>
        ) : (
          <span aria-hidden />
        )}

        <label className="flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-2xl px-3 py-1.5 text-[11px] font-semibold text-stone-500">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white">
            <IconUpload className="h-4 w-4" />
          </span>
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

      {/* CTA de fin de rafaga */}
      {batchMode && shots.length > 0 && (
        <button
          type="button"
          onClick={handleBatchDone}
          className="btn-scan flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold"
        >
          Editar {shots.length} {shots.length === 1 ? 'captura' : 'capturas'}
        </button>
      )}
    </div>
  );
}
