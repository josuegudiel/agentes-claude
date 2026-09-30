import type { FilterId } from './filters';

/**
 * Modos de escaneo del visor (como los modos de la app de camara). Cada
 * uno solo define el filtro con el que abre el editor: se puede cambiar
 * despues en la tira de filtros.
 */
export type ScanModeId = 'doc' | 'receipt' | 'bw' | 'photo';

export interface ScanMode {
  id: ScanModeId;
  label: string;
  filter: FilterId;
}

export const SCAN_MODES: ScanMode[] = [
  { id: 'doc', label: 'Documento', filter: 'magic' },
  { id: 'receipt', label: 'Recibo', filter: 'receipt' },
  { id: 'bw', label: 'B&N', filter: 'bw' },
  { id: 'photo', label: 'Foto', filter: 'photo' },
];

export function filterForMode(id: ScanModeId): FilterId {
  return SCAN_MODES.find((m) => m.id === id)?.filter ?? 'magic';
}

export function isScanMode(v: unknown): v is ScanModeId {
  return SCAN_MODES.some((m) => m.id === v);
}
