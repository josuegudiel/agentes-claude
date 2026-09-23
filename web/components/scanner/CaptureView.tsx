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
import {
  IconBolt,
  IconCamera,
  IconCheck,
  IconChevronLeft,
  IconFrame,
  IconImages,
  IconRefresh,
} from './icons';
import type { Quad } from './perspective';

interface Props {
  /** Recibe 1..N archivos: 1 en captura normal, N en modo rafaga o al
   * seleccionar varios archivos en el picker. */
  onCapture: (files: File[]) => void;
  onCancel?: (() => void) | undefined;
  /** true mientras el padre decodifica las fotos recibidas. */
  busy?: boolean;
}

/**
 * Vista de captura, dispuesta como la app de camara del telefono: visor a
 * pantalla completa, y abajo — al alcance del pulgar — galeria | disparador
 * | listo. Intenta abrir la camara trasera via getUserMedia; si falla
 * (desktop sin webcam, permiso denegado, etc.) cae a un input file con
 * `capture="environment"` que en movil abre la camara nativa.
 */
export function CaptureView({ onCapture, onCancel, busy = false }: Props): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Token de cancelacion compartido entre el effect (mount/unmount) y el
  // boton de reintento. Cada nueva invocacion a startCamera invalida el
  // token anterior — asi cubrimos:
  //   - StrictMode dev: el primer mount queda cancelado por el segundo.
  //   - Retry: la llamada previa queda cancelada por la nueva.
  //   - Unmount: el cleanup invalida el token activo.
  const cancellationRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [mode, setMode] = useState<'starting' | 'live' | 'fallback'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const startCamera = useCallback(async (): Promise<void> => {
    cancellationRef.current.cancelled = true;
    const cancellation = { cancelled: false };
    cancellationRef.current = cancellation;

    setErrorMsg(null);
    setMode('starting');

    // Detener el stream previo AHORA: si este intento falla, el anterior
    // no debe quedar vivo con la luz encendida mientras se muestra el
    // fallback.
    const prevStream = streamRef.current;
    if (prevStream) {
      for (const track of prevStream.getTracks()) track.stop();
      streamRef.current = null;
    }

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

      streamRef.current = stream;

      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      if (!cancellation.cancelled) setMode('live');
    } catch (err) {
      if (cancellation.cancelled) return;
      setErrorMsg(friendlyCameraError(err));
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

  // Cinturon de seguridad: si el stream existe pero el <video> aun no lo
  // tiene atado (p.ej. remount), re-atarlo al entrar en modo live.
  useEffect(() => {
    if (mode !== 'live') return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      void v.play().catch(() => {});
    }
  }, [mode]);

  // Al volver de otra app / bloquear el telefono, iOS termina o congela el
  // track de la camara: el visor quedaba en negro o congelado. Al volver a
  // estar visible se reanuda y, si el track murio, se reabre la camara.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.hidden || mode !== 'live') return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') {
        void startCamera();
      } else {
        void videoRef.current?.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [mode, startCamera]);

  // Modo rafaga: las capturas se acumulan y se editan todas juntas al
  // final — el flujo multi-pagina de CamScanner.
  const [batchMode, setBatchMode] = useState(false);
  const [shots, setShots] = useState<File[]>([]);
  const [flash, setFlash] = useState(0);

  const handleShutter = useCallback(() => {
    if (busy) return;
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    // Feedback inmediato de que la foto se tomo (en ambos modos).
    setFlash((f) => f + 1);
    c.toBlob(
      (blob) => {
        c.width = 0;
        c.height = 0;
        if (!blob) return;
        const file = new File([blob], `captura-${Date.now()}.jpg`, { type: 'image/jpeg' });
        if (batchMode) {
          setShots((prev) => [...prev, file]);
        } else {
          onCapture([file]);
        }
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture, batchMode, busy]);

  const handleBatchDone = useCallback(() => {
    if (shots.length === 0) return;
    const files = shots;
    setShots([]);
    onCapture(files);
  }, [shots, onCapture]);

  const handleCancel = useCallback(() => {
    if (!onCancel) return;
    if (
      shots.length > 0 &&
      !window.confirm(`Tienes ${shots.length} ${shots.length === 1 ? 'foto' : 'fotos'} sin editar. ¿Descartarlas?`)
    ) {
      return;
    }
    onCancel();
  }, [onCancel, shots.length]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length === 0) return;
      // Si habia fotos de rafaga sin editar, van junto con las de la
      // galeria (antes se perdian en silencio).
      onCapture([...shots, ...files]);
      setShots([]);
    },
    [onCapture, shots],
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
    if (mode !== 'live' || !autoMode || busy) {
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
        // Modo estricto para la camara en vivo: sin bordes sintetizados
        // y area minima 15% — un documento que vas a escanear llena el
        // encuadre.
        quad = detectDocumentQuad(ctx.getImageData(0, 0, dw, dh), {
          allowImageBorders: false,
          minArea: 0.15,
        });
      } catch {
        quad = null;
      }

      if (quad) {
        failsRef.current = 0;
        setLowContrast(false);
        historyRef.current = [...historyRef.current.slice(-(STABLE_TICKS_NEEDED - 1)), quad];

        // Overlay alineado al recorte object-cover del video.
        const box = viewfinderRef.current;
        const bw = box?.clientWidth ?? 0;
        const bh = box?.clientHeight ?? 0;
        setLiveQuad(quad.map((p) => mapCoverPoint(p, v.videoWidth, v.videoHeight, bw, bh)) as Quad);
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

    return () => {
      clearInterval(id);
      detCanvas.width = 0;
      detCanvas.height = 0;
    };
  }, [mode, autoMode, busy]);

  const hint = busy
    ? null
    : autoMode && lowContrast
      ? 'Poco contraste: usa mas luz o un fondo mas oscuro que el papel.'
      : autoMode
        ? locking
          ? 'Manten firme...'
          : 'Encuadra el documento: se captura solo'
        : 'Encuadra el documento y toca el boton';

  return (
    <div className="stage-in flex min-h-0 flex-1 flex-col gap-3">
      {/* Visor: ocupa todo el alto disponible */}
      <div
        ref={viewfinderRef}
        className="relative min-h-[220px] flex-1 overflow-hidden rounded-lg border-2 border-cocoa-900 bg-cocoa-900 shadow-paper"
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
          className={`absolute inset-0 h-full w-full object-cover ${mode === 'live' ? 'visible' : 'invisible'}`}
        />

        {mode === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-cocoa-900 text-kraft-300">
            <IconCamera className="h-8 w-8 animate-pulse text-kraft-200" />
            <span className="text-sm">Abriendo la camara...</span>
          </div>
        )}

        {mode === 'fallback' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-kraft-100 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-cocoa-900 bg-paper shadow-paper-sm">
              <IconCamera className="h-8 w-8 text-cocoa-500" />
            </div>
            <div className="max-w-xs text-sm leading-relaxed text-cocoa-700">
              <p className="font-semibold">No pudimos abrir la camara aqui.</p>
              {errorMsg && <p className="mt-1 text-xs text-cocoa-500">{errorMsg}</p>}
            </div>
            <label className="btn-scan flex min-h-[52px] cursor-pointer items-center gap-2 rounded-lg px-6 py-3 font-display text-base font-semibold">
              <IconCamera className="h-5 w-5" />
              Tomar foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={handleFile}
              />
            </label>
            <button
              type="button"
              onClick={() => void startCamera()}
              className="flex min-h-[44px] items-center gap-1.5 px-3 text-sm text-cocoa-700 underline underline-offset-4"
            >
              <IconRefresh className="h-4 w-4" />
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
            {!liveQuad && <span className="scan-line" aria-hidden />}

            {liveQuad && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                <polygon
                  points={liveQuad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                  fill={locking ? 'rgba(199, 62, 29, 0.22)' : 'rgba(199, 62, 29, 0.12)'}
                  stroke="#C73E1D"
                  strokeWidth={locking ? 3 : 2}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}

            {/* Interruptores arriba a la derecha, lejos del pulgar que dispara */}
            <div className="absolute right-2.5 top-2.5 flex gap-1.5">
              <TogglePill
                active={autoMode}
                onClick={() => setAutoMode((a) => !a)}
                icon={<IconFrame className="h-4 w-4" />}
                label="Auto"
                title="Captura automatica al detectar el documento"
              />
              <TogglePill
                active={batchMode}
                onClick={() => setBatchMode((b) => !b)}
                icon={<IconBolt className="h-4 w-4" />}
                label="Rafaga"
                title="Varias paginas seguidas: se editan al final"
              />
            </div>

            {hint && (
              <p
                aria-live="polite"
                className={`pointer-events-none absolute inset-x-3 bottom-3 mx-auto w-fit max-w-full rounded-full px-3.5 py-1.5 text-center text-xs font-semibold leading-snug ${
                  autoMode && lowContrast
                    ? 'border-2 border-note-300 bg-note-100 text-note-700'
                    : 'bg-black/55 text-white'
                }`}
              >
                {hint}
              </p>
            )}
          </>
        )}

        {flash > 0 && (
          <div key={flash} aria-hidden className="shot-flash pointer-events-none absolute inset-0 bg-white" />
        )}

        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-cocoa-900/70 text-paper">
            <span className="spinner" aria-hidden />
            <span className="text-sm font-semibold" role="status">
              Preparando foto...
            </span>
          </div>
        )}

      </div>

      {/* Barra inferior tipo camara: galeria | disparador | listo */}
      <div className="safe-bottom grid shrink-0 grid-cols-3 items-center px-1">
        <div className="flex justify-start">
          <label
            className={`flex min-h-[56px] min-w-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-cocoa-700 ${
              busy ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-cocoa-900 bg-paper shadow-paper-ink-sm">
              <IconImages className="h-5 w-5" />
            </span>
            Galeria
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={handleFile}
              disabled={busy}
            />
          </label>
        </div>

        <div className="flex justify-center">
          {mode === 'live' ? (
            <button
              type="button"
              onClick={handleShutter}
              disabled={busy}
              className="shutter shrink-0 disabled:opacity-60"
              aria-label={batchMode ? `Capturar pagina ${shots.length + 1}` : 'Capturar'}
            >
              <span className="shutter-inner block" />
            </button>
          ) : (
            <span className="h-[76px]" aria-hidden />
          )}
        </div>

        <div className="flex justify-end">
          {batchMode && shots.length > 0 ? (
            <button
              type="button"
              onClick={handleBatchDone}
              disabled={busy}
              className="btn-scan relative flex min-h-[52px] items-center gap-1.5 rounded-lg px-3.5 font-display text-base font-semibold"
            >
              <IconCheck className="h-4 w-4" />
              Listo
              <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-paper bg-cocoa-900 px-1 text-xs font-bold text-paper">
                {shots.length}
              </span>
            </button>
          ) : onCancel ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              className="flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-cocoa-700"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-cocoa-900 bg-paper shadow-paper-ink-sm">
                <IconChevronLeft className="h-5 w-5" />
              </span>
              Mis paginas
            </button>
          ) : batchMode && mode === 'live' ? (
            <span className="max-w-[88px] text-right text-[11px] leading-tight text-cocoa-500">
              Toma todas las paginas y luego toca Listo
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TogglePill({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`flex h-10 items-center gap-1.5 rounded-full border-2 px-3 text-sm font-semibold transition-colors ${
        active
          ? 'border-paper bg-stamp-600 text-paper'
          : 'border-white/40 bg-black/55 text-white/85'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** Traduce los errores de getUserMedia a algo que el usuario pueda resolver. */
function friendlyCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'El permiso de camara esta bloqueado. Activalo en los ajustes del navegador, o toma la foto con el boton de abajo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No encontramos una camara en este dispositivo.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Otra app esta usando la camara. Cierrala y reintenta.';
    default:
      return err instanceof Error && err.message ? err.message : 'Error desconocido.';
  }
}
