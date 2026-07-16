'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTO_COOLDOWN_MS,
  isStableSequence,
  LOW_CONTRAST_TICKS,
  mapCoverPoint,
  STABLE_TICKS_NEEDED,
} from './auto-capture';
import { detectDocumentQuad } from './edge-detect';
import { IconBolt, IconCamera, IconChevronLeft, IconFrame, IconRefresh, IconUpload } from './icons';
import type { Quad } from './perspective';

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

  // --- Auto-captura ---------------------------------------------------------
  // Como CamScanner: cada ~380ms corre la deteccion de bordes sobre un
  // frame reducido del video. Con quad estable N ticks seguidos dispara
  // el shutter solo; con fallos sostenidos avisa que falta contraste.
  const [autoMode, setAutoMode] = useState(true);
  const [liveQuad, setLiveQuad] = useState<Quad | null>(null);
  const [locking, setLocking] = useState(false);
  const [lowContrast, setLowContrast] = useState(false);
  const historyRef = useRef<Quad[]>([]);
  const failsRef = useRef(0);
  const cooldownUntilRef = useRef(0);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  // Ref al shutter mas reciente: el interval no debe capturar un closure
  // viejo de batchMode.
  const shutterRef = useRef<() => void>(() => {});
  shutterRef.current = handleShutter;

  useEffect(() => {
    if (mode !== 'live' || !autoMode) {
      setLiveQuad(null);
      setLocking(false);
      setLowContrast(false);
      historyRef.current = [];
      failsRef.current = 0;
      return;
    }

    const detCanvas = document.createElement('canvas');
    const id = setInterval(() => {
      if (Date.now() < cooldownUntilRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.videoWidth === 0) return;

      const scale = Math.min(1, 256 / Math.max(v.videoWidth, v.videoHeight));
      const dw = Math.max(8, Math.round(v.videoWidth * scale));
      const dh = Math.max(8, Math.round(v.videoHeight * scale));
      detCanvas.width = dw;
      detCanvas.height = dh;
      const ctx = detCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, dw, dh);

      let quad: Quad | null = null;
      try {
        quad = detectDocumentQuad(ctx.getImageData(0, 0, dw, dh));
      } catch {
        quad = null;
      }

      if (quad) {
        failsRef.current = 0;
        setLowContrast(false);
        historyRef.current = [
          ...historyRef.current.slice(-(STABLE_TICKS_NEEDED - 1)),
          quad,
        ];

        // Overlay alineado al recorte object-cover del video.
        const box = viewfinderRef.current;
        const bw = box?.clientWidth ?? 0;
        const bh = box?.clientHeight ?? 0;
        setLiveQuad(
          quad.map((p) =>
            mapCoverPoint(p, v.videoWidth, v.videoHeight, bw, bh),
          ) as Quad,
        );
        setLocking(historyRef.current.length >= 2);

        if (isStableSequence(historyRef.current)) {
          historyRef.current = [];
          setLiveQuad(null);
          setLocking(false);
          cooldownUntilRef.current = Date.now() + AUTO_COOLDOWN_MS;
          shutterRef.current();
        }
      } else {
        historyRef.current = [];
        setLiveQuad(null);
        setLocking(false);
        failsRef.current++;
        if (failsRef.current >= LOW_CONTRAST_TICKS) setLowContrast(true);
      }
    }, 380);

    return () => clearInterval(id);
  }, [mode, autoMode]);

  return (
    <div className="stage-in flex flex-col gap-3">
      {/* Visor */}
      <div
        ref={viewfinderRef}
        className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border-2 border-cocoa-900 bg-cocoa-900 shadow-paper sm:aspect-[4/3]"
      >
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-cocoa-900 text-kraft-300">
            <IconCamera className="h-8 w-8 animate-pulse text-kraft-200" />
            <span className="text-sm">Iniciando camara...</span>
          </div>
        )}

        {mode === 'fallback' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-kraft-100 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-cocoa-900 bg-paper shadow-paper-sm">
              <IconCamera className="h-8 w-8 text-cocoa-500" />
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-cocoa-700">
              No pudimos abrir la camara
              {errorMsg ? (
                <span className="block text-xs text-cocoa-400">{errorMsg}</span>
              ) : (
                '.'
              )}
            </p>
            <label className="btn-scan flex min-h-[48px] cursor-pointer items-center gap-2 rounded-lg px-6 py-3 font-display text-base font-semibold">
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
              className="flex items-center gap-1.5 text-xs text-cocoa-500 underline underline-offset-4"
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
            <p className="pointer-events-none absolute inset-x-0 top-4 text-center font-display text-xs font-semibold tracking-wide text-white/80">
              {autoMode
                ? locking
                  ? 'Manten firme...'
                  : 'Encuadra el documento'
                : 'Encuadra el documento'}
            </p>

            {/* Quad detectado en vivo (solo modo auto) */}
            {liveQuad && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                <polygon
                  points={liveQuad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                  fill="rgba(199, 62, 29, 0.15)"
                  stroke="#C73E1D"
                  strokeWidth="0.9"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}

            {/* Alerta de contraste insuficiente para la auto-deteccion */}
            {autoMode && lowContrast && (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border-2 border-note-300 bg-note-100/95 px-3 py-2 text-center text-[11px] font-semibold leading-snug text-note-700">
                Poco contraste: no se detectan los bordes. Proba con mas luz
                o un fondo que contraste con el documento.
              </div>
            )}
          </>
        )}

        {/* Flash de confirmacion en modo rafaga */}
        {flash > 0 && (
          <div key={flash} aria-hidden className="shot-flash pointer-events-none absolute inset-0 bg-white" />
        )}

        {/* Contador de capturas acumuladas en rafaga */}
        {batchMode && shots.length > 0 && (
          <div className="absolute right-3 top-3 flex h-8 min-w-8 items-center justify-center rounded-full border-2 border-paper bg-stamp-600 px-2 font-display text-sm font-bold text-paper">
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
          <div className="flex items-center">
          <button
            type="button"
            onClick={() => setAutoMode((a) => !a)}
            aria-pressed={autoMode}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
              autoMode ? 'text-stamp-700' : 'text-cocoa-500'
            }`}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all ${
                autoMode
                  ? 'border-cocoa-900 bg-stamp-100 shadow-paper-ink-sm'
                  : 'border-cocoa-900/40 bg-paper'
              }`}
            >
              <IconFrame className="h-4 w-4" />
            </span>
            Auto {autoMode ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => setBatchMode((b) => !b)}
            aria-pressed={batchMode}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
              batchMode
                ? 'text-stamp-700'
                : 'text-cocoa-500'
            }`}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full border transition-all ${
                batchMode
                  ? 'border-cocoa-900 bg-stamp-100 shadow-paper-ink-sm'
                  : 'border-cocoa-900/40 bg-paper'
              }`}
            >
              <IconBolt className="h-4 w-4" />
            </span>
            Rafaga {batchMode ? 'ON' : 'OFF'}
          </button>
          </div>
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

        <label className="flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-cocoa-500">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-cocoa-900/40 bg-paper">
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
          className="btn-scan flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg px-5 py-3 font-display text-base font-semibold"
        >
          Editar {shots.length} {shots.length === 1 ? 'captura' : 'capturas'}
        </button>
      )}
    </div>
  );
}
