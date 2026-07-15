/**
 * Iconografia propia del scanner: trazos 1.8, esquinas redondeadas,
 * heredan color via currentColor. Inline para no sumar dependencias.
 */

interface IconProps {
  className?: string;
}

function base(props: IconProps): Record<string, unknown> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: props.className ?? 'h-5 w-5',
  };
}

export function IconCamera(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1l1.2-1.8A1.5 1.5 0 0 1 10 3.5h4a1.5 1.5 0 0 1 1.3.7L16.5 6h1A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.5" r="3.4" />
    </svg>
  );
}

export function IconUpload(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M12 15V4.5" />
      <path d="m7.5 8.5 4.5-4 4.5 4" />
      <path d="M4.5 15.5v2A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </svg>
  );
}

export function IconRotate(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M20 8.5A8 8 0 1 0 20.5 13" />
      <path d="M20.5 4.5v4h-4" />
    </svg>
  );
}

export function IconWand(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m5 19 9.5-9.5" />
      <path d="m13 5.5 1-2 1 2 2 1-2 1-1 2-1-2-2-1z" />
      <path d="m18.5 12.5.7-1.4.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7z" />
      <path d="m6.5 5 .6-1.2L7.7 5l1.2.6-1.2.6-.6 1.2-.6-1.2L5.3 5.6z" />
    </svg>
  );
}

export function IconFrame(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

export function IconExpand(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M9 4v16M4 9h16" opacity="0.45" />
    </svg>
  );
}

export function IconDownload(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M12 4.5V15" />
      <path d="m7.5 11 4.5 4 4.5-4" />
      <path d="M4.5 16.5v1A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-1" />
    </svg>
  );
}

export function IconBolt(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H13z" />
    </svg>
  );
}

export function IconPlus(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconX(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function IconChevronLeft(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m14 6-6 6 6 6" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  );
}

export function IconCheck(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconRefresh(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4.5 10a8 8 0 0 1 14-2.5M19.5 14a8 8 0 0 1-14 2.5" />
      <path d="M18.5 3.5v4h-4M5.5 20.5v-4h4" />
    </svg>
  );
}

export function IconDocScan(props: IconProps): React.ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M7 3.5h7l4 4v13h-11z" opacity="0.9" />
      <path d="M14 3.5v4h4" />
      <path d="M3.5 12h17" strokeWidth="2.2" className="text-stamp-600" stroke="currentColor" />
    </svg>
  );
}
