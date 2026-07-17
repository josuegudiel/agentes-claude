/**
 * Set de iconos original del auditor: SVG inline dibujados a mano,
 * stroke currentColor — el color lo decide el contexto.
 */

interface IconProps {
  className?: string;
}

function base(className?: string): {
  viewBox: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  className?: string;
  'aria-hidden': true;
} {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...(className ? { className } : {}),
    'aria-hidden': true,
  };
}

/** Radar de visibilidad: arcos + barrido + blip. */
export function IconRadar({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 12 L19 5" />
      <path d="M12 3a9 9 0 1 1-9 9" />
      <path d="M12 7a5 5 0 1 0 5 5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** SEO tecnico: brackets de codigo con slash. */
export function IconBrackets({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M8.5 7 L4 12 L8.5 17" />
      <path d="M15.5 7 L20 12 L15.5 17" />
      <path d="M13.5 5.5 L10.5 18.5" />
    </svg>
  );
}

/** Presencia online: torre emitiendo ondas. */
export function IconSignal({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 21 V11" />
      <circle cx="12" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M8.2 13.3a5.4 5.4 0 0 1 0-7.6" />
      <path d="M15.8 5.7a5.4 5.4 0 0 1 0 7.6" />
      <path d="M5.4 16.1a9.4 9.4 0 0 1 0-13.2" opacity="0.55" />
      <path d="M18.6 2.9a9.4 9.4 0 0 1 0 13.2" opacity="0.55" />
    </svg>
  );
}

/** Critico: rafaga de alerta (estrella de impacto con !). */
export function IconBurst({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 2.5 L13.8 6.4 L18 4.9 L16.8 9.2 L21.2 10.4 L17.6 13.2 L20 17 L15.6 16.6 L15.2 21 L12 17.9 L8.8 21 L8.4 16.6 L4 17 L6.4 13.2 L2.8 10.4 L7.2 9.2 L6 4.9 L10.2 6.4 Z" />
      <path d="M12 8.6 V12.4" strokeWidth="2" />
      <circle cx="12" cy="14.9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Importante: rombo con ojo (hay que mirarlo). */
export function IconRhombEye({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 2.8 L21.2 12 L12 21.2 L2.8 12 Z" />
      <path d="M8 12c1.2-1.7 2.5-2.5 4-2.5s2.8.8 4 2.5c-1.2 1.7-2.5 2.5-4 2.5S9.2 13.7 8 12Z" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Mejora: chispa ascendente. */
export function IconSpark({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 20 V8" />
      <path d="M7.5 12.5 L12 8 L16.5 12.5" />
      <path d="M5 4.5h.01M9 3h.01M19 5h.01M15 3.5h.01" strokeWidth="2.4" />
    </svg>
  );
}

/** Descarga de reporte: bandeja con flecha. */
export function IconDownload({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 4 V14" />
      <path d="M8 10.5 L12 14.5 L16 10.5" />
      <path d="M4.5 16.5 V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5" />
    </svg>
  );
}

/** Resumen: doble trazo de cita estilizado. */
export function IconQuote({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M5 16c0-4.5 1.8-8 5-10.5" />
      <circle cx="6.5" cy="16.5" r="2.2" />
      <path d="M13.5 16c0-4.5 1.8-8 5-10.5" />
      <circle cx="15" cy="16.5" r="2.2" />
    </svg>
  );
}

/** Escudo con check para los chips de confianza. */
export function IconShield({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 3 L19 5.6 V11c0 4.6-2.9 7.9-7 9.5C7.9 18.9 5 15.6 5 11V5.6 Z" />
      <path d="M9 11.5 L11.2 13.7 L15.2 9.2" />
    </svg>
  );
}

/** Capas de analisis para los chips. */
export function IconLayers({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M12 3.5 L21 8 L12 12.5 L3 8 Z" />
      <path d="M4.8 12.2 L12 15.8 L19.2 12.2" />
      <path d="M4.8 16 L12 19.6 L19.2 16" opacity="0.55" />
    </svg>
  );
}

/** Documento PDF para los chips. */
export function IconDoc({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 13h5M9.5 16.5h5M9.5 9.5h2" />
    </svg>
  );
}

/** Error: hexagono con exclamacion. */
export function IconHexAlert({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M8.2 3.5h7.6 L21 12 L15.8 20.5 H8.2 L3 12 Z" />
      <path d="M12 8 V13" strokeWidth="2" />
      <circle cx="12" cy="16.2" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Flecha CTA. */
export function IconArrow({ className }: IconProps): React.ReactElement {
  return (
    <svg {...base(className)}>
      <path d="M4 12 H19" />
      <path d="M13.5 6 L19.5 12 L13.5 18" />
    </svg>
  );
}
