'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTO_COOLDOWN_MS,
  isStableSequence,
  LOW_CONTRAST_TICKS,
  mapCoverPoint,
  shouldRearm,
  STABLE_TICKS_NEEDED,
} from './auto-capture';
import { detectDocumentQuad } from './edge-detect';
import { IconCamera, IconFileAdd, IconImages, IconLayers, IconRefresh, IconScanFrame, IconTorch } from './icons';
import { SCAN_MODES, type ScanModeId } from './modes';
import { PageThumb } from './PageThumb';
import type { ScanPage } from './pages';
import type { Quad } from './perspective';

interface Props {
  /** Recibe 1..N archivos: 1 en captura normal, N en modo rafaga o al
   * seleccionar varios archivos en el picker. */
  onCapture: (files: Blob[]) => void;
  /** Ir a "Mis paginas" (solo si ya hay paginas). */
  onCancel?: (() => void) | undefined;
  /** true mientras el padre decodifica las fotos recibidas. */
  busy?: boolean;
  /** true mientras otra tarea ocupa la pantalla (p.ej. leer un PDF): sin auto-captura. */
  suspended?: boolean;
  scanMode: ScanModeId;
  onScanModeChange: (m: ScanModeId) => void;
  pageCount: number;
  /** Ultima pagina guardada (su miniatura va en la pila de la izquierda). */
  lastPage?: ScanPage | undefined;
  /** "PDF": añadir las hojas de un PDF ya exportado. */
  onImportPdf: (file: File) => void;
}

/**
 * Vista de captura "Obturador": el visor a sangre es el protagonista. Arriba
 * los interruptores (AUTO, RAFAGA, LUZ), abajo del visor el HUD de estado y
 * la resolucion real; debajo los modos de escaneo y los controles de camara
 * al alcance del pulgar: pila de paginas | disparador | galeria/listo.
 *
 * Intenta abrir la camara trasera via getUserMedia; si falla (desktop sin
 * webcam, permiso denegado, etc.) cae a un input file con
 * `capture="environment"` que en movil abre la camara nativa.
 */
export function CaptureView({
  onCapture,
  onCancel,
  busy: busyProp = false,
  suspended = false,
  scanMode,
  onScanModeChange,
  pageCount,
  lastPage,
  onImportPdf,
}: Props): React.ReactElement {
  const busy = busyProp || suspended;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // play() rechazado (p.ej. iPhone en modo ahorro de energia): hace falta
  // un toque del usuario para arrancar el video.
  const [needsTap, setNeedsTap] = useState(false);
  // Token de cancelacion compartido entre el effect (mount/unmount) y el
  // boton de reintento. Cada nueva invocacion a startCamera invalida el
  // token anterior — asi cubrimos:
  //   - StrictMode dev: el primer mount queda cancelado por el segundo.
  //   - Retry: la llamada previa queda cancelada por la nueva.
  //   - Unmount: el cleanup invalida el token activo.
  const cancellationRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [mode, setMode] = useState<'starting' | 'live' | 'fallback'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Resolucion real del stream (dato del HUD) y soporte de linterna.
  const [res, setRes] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const torchOnRef = useRef(false);
  torchOnRef.current = torchOn;

  const startRef = useRef<() => Promise<void>>(async () => {});
  const startCamera = useCallback(async (): Promise<void> => {
    cancellationRef.current.cancelled = true;
    const cancellation = { cancelled: false };
    cancellationRef.current = cancellation;

    setErrorMsg(null);
    setMode('starting');
    setTorchSupported(false);
    setTorchOn(false);

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
          // Lo mas alto que de el dispositivo (4:3, como la camara de
          // fotos). El navegador elige el modo soportado mas cercano: en
          // iPhone, donde no hay takePhoto(), este cuadro ES la captura.
          width: { ideal: 3840 },
          height: { ideal: 2880 },
        },
        audio: false,
      });

      if (cancellation.cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;

      const v = videoRef.current;
      let played = true;
      if (v) {
        v.srcObject = stream;
        played = await v.play().then(
          () => true,
          () => false,
        );
      }
      if (cancellation.cancelled) return;
      setNeedsTap(!played);
      // Si la camara se corta (otra app la toma, el sistema la libera),
      // reabrirla en vez de dejar el visor congelado.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (!cancellation.cancelled && !document.hidden) void startRef.current();
      });
      // Linterna: solo si el navegador/dispositivo la expone (Chrome
      // Android). En iPhone no existe via web: el boton no aparece.
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchSupported(caps.torch === true);
      setMode('live');
    } catch (err) {
      if (cancellation.cancelled) return;
      setErrorMsg(friendlyCameraError(err));
      setMode('fallback');
    }
  }, []);

  startRef.current = startCamera;

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

  // Resolucion real del video para el HUD (llega con loadedmetadata).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = (): void => {
      if (v.videoWidth) setRes(`${v.videoWidth}×${v.videoHeight}`);
    };
    update();
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
    };
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

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchOn]);

  // Modo rafaga: las capturas se acumulan y se editan todas juntas al
  // final — el flujo multi-pagina de CamScanner.
  const [batchMode, setBatchMode] = useState(false);
  const [shots, setShots] = useState<File[]>([]);
  // Copia sincronica de `shots`: las capturas terminan de forma asincrona
  // y deben ver la lista actual, no la de cuando se tomo la foto.
  const shotsRef = useRef<File[]>([]);
  const updateShots = useCallback((next: File[]) => {
    shotsRef.current = next;
    setShots(next);
  }, []);
  const [flash, setFlash] = useState(0);

  // Una captura a la vez (takePhoto puede tardar ~1 s). `inflightRef`
  // permite esperar a la foto en curso antes de pasar al editor.
  const shootingRef = useRef(false);
  const [shooting, setShooting] = useState(false);
  const inflightRef = useRef<Promise<void> | null>(null);
  const batchModeRef = useRef(batchMode);
  batchModeRef.current = batchMode;
  // Auto-captura: se desarma tras cada foto (ver shouldRearm).
  const armedRef = useRef(pageCount === 0);
  const rearmRefQuad = useRef<Quad | null>(null);

  const handleShutter = useCallback(
    (fromAuto = false, quadAtShot: Quad | null = null) => {
      if (busy || shootingRef.current) return;
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      if (v.paused) void v.play().catch(() => {});
      if (v.readyState < 2) return;
      shootingRef.current = true;
      setShooting(true);
      // Cualquier foto (manual o automatica) desarma la auto-captura hasta
      // que cambie la escena.
      armedRef.current = false;
      rearmRefQuad.current = quadAtShot;
      if (!fromAuto) cooldownUntilRef.current = Date.now() + AUTO_COOLDOWN_MS;

      const deliver = (blob: Blob | null): void => {
        shootingRef.current = false;
        if (!mountedRef.current) return; // la vista ya se cerro
        setShooting(false);
        if (!blob) return;
        // El destello marca el momento en que la foto realmente se tomo.
        setFlash((f) => f + 1);
        try {
          navigator.vibrate?.(20);
        } catch {
          /* sin vibracion */
        }
        const file = new File([blob], `captura-${Date.now()}.jpg`, { type: 'image/jpeg' });
        if (batchModeRef.current) {
          updateShots([...shotsRef.current, file]);
        } else {
          // Si quedaron fotos de rafaga (se apago RAFAGA a mitad), van juntas.
          const pending = shotsRef.current;
          updateShots([]);
          onCapture([...pending, file]);
        }
      };

      // Cuadro del video como respaldo (y unica via en Safari). Se toma YA,
      // antes de esperar a takePhoto: es el instante que el usuario eligio.
      const frameBlob = (): Promise<Blob | null> =>
        new Promise((resolve) => {
          const c = document.createElement('canvas');
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(
            (b) => {
              c.width = 0;
              c.height = 0;
              resolve(b);
            },
            'image/jpeg',
            0.95,
          );
        });

      const job = (async () => {
        const frame = frameBlob();
        const still = await takeStill(streamRef.current, torchOnRef.current);
        deliver(still ?? (await frame));
      })();
      inflightRef.current = job;
      void job.finally(() => {
        if (inflightRef.current === job) inflightRef.current = null;
      });
    },
    [onCapture, busy, updateShots],
  );

  const handleBatchDone = useCallback(async () => {
    // Esperar a la foto que se esta tomando: si no, se perdia la ultima.
    if (inflightRef.current) await inflightRef.current;
    const files = shotsRef.current;
    if (files.length === 0 || !mountedRef.current) return;
    updateShots([]);
    onCapture(files);
  }, [onCapture, updateShots]);

  const handleCancel = useCallback(async () => {
    if (!onCancel) return;
    if (inflightRef.current) await inflightRef.current;
    if (!mountedRef.current) return;
    const n = shotsRef.current.length;
    if (n > 0 && !window.confirm(`Tienes ${n} ${n === 1 ? 'foto' : 'fotos'} sin editar. ¿Descartarlas?`)) {
      return;
    }
    onCancel();
  }, [onCancel]);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length === 0) return;
      // Si habia fotos de rafaga sin editar, van junto con las de la
      // galeria (antes se perdian en silencio).
      const pending = shotsRef.current;
      updateShots([]);
      onCapture([...pending, ...files]);
    },
    [onCapture, updateShots],
  );

  // Miniatura de la ultima foto de la rafaga (pila de la izquierda).
  const lastShotUrl = useMemo(
    () => (shots.length ? URL.createObjectURL(shots[shots.length - 1]!) : null),
    [shots],
  );
  useEffect(() => {
    return () => {
      if (lastShotUrl) URL.revokeObjectURL(lastShotUrl);
    };
  }, [lastShotUrl]);

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
  // Ref al shutter mas reciente: el bucle no debe capturar un closure viejo.
  const shutterRef = useRef(handleShutter);
  shutterRef.current = handleShutter;
  // El documento sigue a la vista pero la auto-captura espera otra hoja.
  const [waitingNext, setWaitingNext] = useState(false);

  useEffect(() => {
    if (mode !== 'live' || !autoMode || busy) {
      setLiveQuad(null);
      setLocking(false);
      setLowContrast(false);
      setWaitingNext(false);
      historyRef.current = [];
      failsRef.current = 0;
      return;
    }

    const detCanvas = document.createElement('canvas');
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = (): void => {
      const started = performance.now();
      detect();
      if (stopped) return;
      // En telefonos lentos la deteccion puede tardar: el siguiente ciclo
      // espera al menos el doble de lo que tardo este (nunca en cadena).
      const took = performance.now() - started;
      timer = setTimeout(tick, Math.max(380, took * 2));
    };

    const detect = (): void => {
      if (Date.now() < cooldownUntilRef.current) return;
      if (document.hidden || shootingRef.current) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.videoWidth === 0 || v.paused) return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted) return;

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

      // Tras una foto (o al volver a la camara con paginas ya escaneadas)
      // no se dispara otra vez sobre la misma hoja: hay que cambiarla o
      // mover el telefono.
      if (!armedRef.current) {
        if (shouldRearm(rearmRefQuad.current, quad)) {
          armedRef.current = true;
          rearmRefQuad.current = null;
        } else if (quad && !rearmRefQuad.current) {
          rearmRefQuad.current = quad;
        }
      }
      setWaitingNext(!armedRef.current && quad !== null);

      if (quad) {
        failsRef.current = 0;
        setLowContrast(false);
        // Overlay alineado al recorte object-cover del video.
        const box = viewfinderRef.current;
        const bw = box?.clientWidth ?? 0;
        const bh = box?.clientHeight ?? 0;
        setLiveQuad(quad.map((p) => mapCoverPoint(p, v.videoWidth, v.videoHeight, bw, bh)) as Quad);
        if (!armedRef.current) {
          historyRef.current = [];
          setLocking(false);
          return;
        }
        historyRef.current = [...historyRef.current.slice(-(STABLE_TICKS_NEEDED - 1)), quad];
        setLocking(historyRef.current.length >= 2);

        if (isStableSequence(historyRef.current)) {
          historyRef.current = [];
          setLiveQuad(null);
          setLocking(false);
          cooldownUntilRef.current = Date.now() + AUTO_COOLDOWN_MS;
          shutterRef.current(true, quad);
        }
      } else {
        historyRef.current = [];
        setLiveQuad(null);
        setLocking(false);
        failsRef.current++;
        if (failsRef.current >= LOW_CONTRAST_TICKS) setLowContrast(true);
      }
    };

    timer = setTimeout(tick, 380);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      detCanvas.width = 0;
      detCanvas.height = 0;
    };
  }, [mode, autoMode, busy]);

  // Estado del HUD (abajo a la izquierda del visor).
  const hud: { text: string; tone: 'volt' | 'warn' | 'idle' } | null = busy
    ? null
    : shooting
      ? { text: 'CAPTURANDO · NO TE MUEVAS', tone: 'volt' }
      : !autoMode
        ? { text: 'MANUAL · TOCA EL OBTURADOR', tone: 'idle' }
        : lowContrast
          ? { text: 'POCO CONTRASTE · MÁS LUZ', tone: 'warn' }
          : waitingNext
            ? { text: 'LISTO · PON LA SIGUIENTE HOJA', tone: 'idle' }
            : locking
              ? { text: 'BLOQUEADO · NO TE MUEVAS', tone: 'volt' }
              : liveQuad
                ? { text: 'DOCUMENTO DETECTADO', tone: 'volt' }
                : { text: 'BUSCANDO BORDES', tone: 'idle' };

  const stackPage = lastShotUrl ? undefined : lastPage;
  const stackCount = shots.length > 0 ? shots.length : pageCount;

  return (
    <div className="stage-in relative flex min-h-0 flex-1 flex-col bg-night-950">
      {/* Visor a sangre */}
      {/* En horizontal (poca altura) el visor cede espacio para que el
          obturador siga a la vista. */}
      <div ref={viewfinderRef} className="relative min-h-[260px] flex-1 overflow-hidden bg-black short:min-h-0">
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

        {mode === 'live' && needsTap && (
          // El sistema no dejo reproducir el video solo (p.ej. iPhone en
          // modo ahorro de energia): un toque lo arranca.
          <button
            type="button"
            onClick={() => {
              void videoRef.current?.play().then(
                () => setNeedsTap(false),
                () => {},
              );
            }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 text-night-100"
          >
            <IconCamera className="h-8 w-8" />
            <span className="font-mono text-xs font-bold tracking-[0.12em]">TOCA PARA ACTIVAR LA CÁMARA</span>
          </button>
        )}

        {mode === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-night-950 text-night-400">
            <IconCamera className="h-8 w-8 animate-pulse" />
            <span className="font-mono text-xs tracking-[0.14em]">ABRIENDO CÁMARA</span>
          </div>
        )}

        {mode === 'fallback' && (
          <div className="safe-top absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-night-950 px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-night-700 bg-night-850 text-night-300">
              <IconCamera className="h-8 w-8" />
            </div>
            <div className="max-w-xs">
              <p className="font-display text-2xl font-bold uppercase tracking-wide text-night-100">Sin cámara</p>
              <p className="mt-1.5 text-sm leading-relaxed text-night-400">
                {errorMsg ?? 'No pudimos abrir la cámara en este navegador.'}
              </p>
            </div>
            <label className="press flex min-h-[52px] cursor-pointer items-center gap-2 rounded-2xl bg-volt px-7 font-display text-lg font-extrabold uppercase tracking-[0.1em] text-night-950">
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
              className="flex min-h-[44px] items-center gap-2 px-3 font-mono text-xs tracking-[0.12em] text-night-300"
            >
              <IconRefresh className="h-4 w-4" />
              REINTENTAR CÁMARA
            </button>
          </div>
        )}

        {/* Overlays del visor en vivo */}
        {mode === 'live' && (
          <>
            <div className="viewfinder-vignette" aria-hidden />
            {!liveQuad && (
              <>
                <span className="frame-mark tl" aria-hidden />
                <span className="frame-mark tr" aria-hidden />
                <span className="frame-mark bl" aria-hidden />
                <span className="frame-mark br" aria-hidden />
              </>
            )}

            {liveQuad && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
              >
                <polygon
                  points={liveQuad.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                  fill={locking ? 'rgba(212, 255, 58, 0.16)' : 'rgba(212, 255, 58, 0.08)'}
                  stroke="#D4FF3A"
                  strokeWidth={locking ? 3 : 2}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
            {/* Esquinas cuadradas del documento detectado (en px reales,
                no dentro del SVG estirado, para que no se deformen). */}
            {liveQuad &&
              liveQuad.map((p, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 border-[3px] border-volt bg-night-950"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                />
              ))}

            {/* Interruptores */}
            <div className="top-safe absolute inset-x-3.5 flex items-center gap-2">
              <Chip
                active={autoMode}
                onClick={() => setAutoMode((a) => !a)}
                label="AUTO"
                title="Captura automática al detectar el documento"
              />
              <Chip
                active={batchMode}
                onClick={() => setBatchMode((b) => !b)}
                label={batchMode && shots.length > 0 ? `RÁFAGA ${shots.length}` : 'RÁFAGA'}
                icon={<IconLayers className="h-3.5 w-3.5" />}
                title="Varias páginas seguidas: se editan al final"
              />
              {torchSupported && (
                <span className="ml-auto">
                  <Chip
                    active={torchOn}
                    onClick={() => void toggleTorch()}
                    label={torchOn ? 'LUZ ON' : 'LUZ'}
                    icon={<IconTorch className="h-3.5 w-3.5" />}
                    title="Linterna"
                  />
                </span>
              )}
            </div>

            {/* HUD */}
            {hud && (
              <div className="pointer-events-none absolute inset-x-3.5 bottom-3.5 flex items-end justify-between gap-2">
                <span
                  aria-live="polite"
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11px] font-bold tracking-[0.08em] ${
                    hud.tone === 'volt'
                      ? 'bg-volt text-night-950'
                      : hud.tone === 'warn'
                        ? 'bg-warn text-night-950'
                        : 'bg-black/60 text-night-100'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full bg-current ${hud.tone === 'idle' ? 'hud-blink' : ''}`} />
                  {hud.text}
                </span>
                {res && <span className="font-mono text-[11px] tracking-[0.06em] text-night-100/85">{res}</span>}
              </div>
            )}
          </>
        )}

        {flash > 0 && (
          <div key={flash} aria-hidden className="shot-flash pointer-events-none absolute inset-0 bg-white" />
        )}

        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-night-950/75 text-volt">
            <span className="spinner" aria-hidden />
            <span className="font-mono text-xs font-bold tracking-[0.14em] text-night-100" role="status">
              PREPARANDO FOTO
            </span>
          </div>
        )}
      </div>

      {/* Modos de escaneo */}
      <div
        role="radiogroup"
        aria-label="Modo de escaneo"
        className="no-scrollbar flex shrink-0 justify-center gap-6 overflow-x-auto px-4 pb-1 pt-3.5 short:hidden"
      >
        {SCAN_MODES.map((m) => {
          const on = m.id === scanMode;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onScanModeChange(m.id)}
              className={`min-h-[36px] shrink-0 font-display text-[15px] font-bold uppercase tracking-[0.14em] transition-colors ${
                on ? 'text-volt' : 'text-night-400'
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Controles de camara: pila | obturador | galeria/listo */}
      <div className="safe-bottom grid shrink-0 grid-cols-3 items-center px-7 pt-2">
        <div className="flex justify-start">
          {stackCount > 0 && (shots.length > 0 || onCancel) ? (
            <button
              type="button"
              onClick={() => void (shots.length > 0 ? handleBatchDone() : handleCancel())}
              disabled={busy}
              aria-label={shots.length > 0 ? `Editar ${shots.length} capturas` : `Mis páginas (${pageCount})`}
              className="press relative h-14 w-14 rounded-xl border-2 border-night-100 bg-night-850"
            >
              {lastShotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lastShotUrl} alt="" className="h-full w-full rounded-[10px] object-cover" />
              ) : (
                stackPage && (
                  <PageThumb src={stackPage.thumb} rotation={stackPage.rotation} aspect={1} className="rounded-[10px]" />
                )
              )}
              <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-lg bg-volt px-1.5 font-mono text-xs font-bold text-night-950">
                {stackCount}
              </span>
            </button>
          ) : (
            <label
              aria-label="Añadir un PDF"
              className={`press flex h-14 w-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border border-night-600 text-night-100 ${
                busy || shooting ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              <IconFileAdd className="h-5 w-5" />
              <span className="font-mono text-[9px] font-bold tracking-[0.08em]">PDF</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) onImportPdf(f);
                }}
              />
            </label>
          )}
        </div>

        <div className="flex justify-center">
          {mode === 'live' ? (
            <button
              type="button"
              onClick={() => handleShutter()}
              disabled={busy || shooting}
              className="shutter shrink-0"
              aria-label={batchMode ? `Capturar página ${shots.length + 1}` : 'Capturar'}
            >
              <span className="shutter-inner block" />
            </button>
          ) : (
            <span className="h-20 w-20" aria-hidden />
          )}
        </div>

        <div className="flex justify-end">
          {shots.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleBatchDone()}
              disabled={busy}
              className="press flex h-14 items-center rounded-xl bg-volt px-4 font-display text-lg font-extrabold uppercase tracking-[0.1em] text-night-950"
            >
              Listo
            </button>
          ) : (
            <label
              aria-label="Galería"
              className={`press flex h-14 w-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border border-night-600 text-night-100 ${
                busy || shooting ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              <IconImages className="h-5 w-5" />
              <span className="font-mono text-[9px] font-bold tracking-[0.08em]">GALERÍA</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={handleFile}
                disabled={busy || shooting}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  icon,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  title: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`press flex h-9 items-center gap-1.5 rounded-lg border px-3 font-mono text-xs font-bold tracking-[0.08em] ${
        active
          ? 'border-volt bg-volt text-night-950'
          : 'border-white/20 bg-black/55 text-night-100'
      }`}
    >
      {icon ?? <IconScanFrame className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

/**
 * Foto fija a resolucion COMPLETA del sensor via ImageCapture.takePhoto()
 * (Chrome/Android y Edge): la procesa la camara del telefono (enfoque,
 * HDR, reduccion de ruido) y tiene varias veces los pixeles del video.
 * Es la diferencia de nitidez mas grande entre un escaner web y uno
 * nativo. Safari no la implementa: devuelve null y se usa el cuadro del
 * video. Tope de 4 s por si el driver de la camara se cuelga.
 */
/** Lado mayor de la foto pedida a takePhoto (igual al tope del pipeline). */
const STILL_MAX_SIDE = 4032;

type ImageCaptureLike = {
  takePhoto: (settings?: { imageWidth?: number; imageHeight?: number }) => Promise<Blob>;
  getPhotoCapabilities?: () => Promise<{ imageWidth?: { min: number; max: number; step?: number } }>;
};
const photoWidthCache = new WeakMap<MediaStreamTrack, number | null>();

/**
 * Foto de alta calidad via ImageCapture (Chrome Android). Se pide un ancho
 * acotado: sin pedir nada, algunos telefonos devuelven 48-108 MP (segundos
 * de espera, cientos de MB al decodificar y "imagen demasiado grande").
 */
async function takeStill(stream: MediaStream | null, torchOn: boolean): Promise<Blob | null> {
  const track = stream?.getVideoTracks()[0];
  const IC = (globalThis as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (!track || track.readyState !== 'live' || typeof IC !== 'function') return null;
  try {
    const ic = new IC(track);
    let width = photoWidthCache.get(track);
    if (width === undefined) {
      width = null;
      try {
        const caps = await ic.getPhotoCapabilities?.();
        const w = caps?.imageWidth;
        if (w && w.max > 0) width = Math.max(w.min || 0, Math.min(w.max, STILL_MAX_SIDE));
      } catch {
        /* sin capacidades: foto por defecto */
      }
      photoWidthCache.set(track, width);
    }
    const photo = await Promise.race([
      ic.takePhoto(width ? { imageWidth: width } : undefined),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    // Algunos Chrome apagan la linterna al tomar la foto: re-encenderla.
    if (torchOn && track.readyState === 'live') {
      void track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => {});
    }
    return photo instanceof Blob && photo.size > 0 ? photo : null;
  } catch {
    return null;
  }
}

/** Traduce los errores de getUserMedia a algo que el usuario pueda resolver. */
function friendlyCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'El permiso de cámara está bloqueado. Actívalo en los ajustes del navegador, o toma la foto con el botón de abajo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No encontramos una cámara en este dispositivo.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Otra app está usando la cámara. Ciérrala y reintenta.';
    default:
      return err instanceof Error && err.message ? err.message : 'Error desconocido.';
  }
}
