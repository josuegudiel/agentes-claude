'use client';

import { useRef } from 'react';
import type { Rotation } from './pages';

/**
 * Miniatura que llena su caja (object-cover) mostrando la hoja con su giro.
 *
 * La miniatura guardada NO esta girada: el giro se aplica aqui con CSS,
 * asi girar es instantaneo (sin re-decodificar el JPEG) y se anima. Para
 * 90/270 la <img> se dimensiona con ancho y alto intercambiados (en % de
 * la caja) antes de rotarla, para que al girar vuelva a llenar la caja.
 *
 * El angulo mostrado se ACUMULA (0, 90, ..., 360, 450...) para que la
 * animacion siempre gire en sentido horario: de 270 a 0 no "desgira".
 */
export function PageThumb({
  src,
  rotation,
  aspect,
  className = '',
}: {
  src: string;
  rotation: Rotation;
  /** Ancho/alto de la caja (p.ej. 3/4). Se usa para intercambiar lados. */
  aspect: number;
  className?: string;
}): React.ReactElement {
  const shown = useRef({ rotation, angle: rotation as number });
  if (shown.current.rotation !== rotation) {
    const delta = (rotation - shown.current.rotation + 360) % 360;
    shown.current = { rotation, angle: shown.current.angle + delta };
  }
  const sideways = rotation === 90 || rotation === 270;
  return (
    <span className={`absolute inset-0 overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none object-cover transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          width: sideways ? `${100 / aspect}%` : '100%',
          height: sideways ? `${100 * aspect}%` : '100%',
          transform: `translate(-50%, -50%) rotate(${shown.current.angle}deg)`,
        }}
      />
    </span>
  );
}
