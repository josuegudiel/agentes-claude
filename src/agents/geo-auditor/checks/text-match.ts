/**
 * Utilidades de coincidencia de texto para los checks. Centralizadas para no
 * repetir el bug de "substring naive": comparar ciudades/nombres con includes()
 * da falsos positivos ("Leon" en "Napoleon") y falsos negativos por acentos
 * ("León" vs "Leon").
 */

/** Minúsculas + sin acentos, para comparar de forma tolerante. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * true si `needle` aparece en `haystack` como palabra/frase completa,
 * ignorando acentos y mayúsculas. "Leon" NO coincide con "Napoleon".
 */
export function containsWord(haystack: string, needle: string): boolean {
  const h = normalizeText(haystack);
  const n = normalizeText(needle).trim();
  if (!n) return false;
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(n)}(?:$|[^\\p{L}\\p{N}])`, 'u');
  return re.test(h);
}

/** Normaliza un host: minúsculas y sin el prefijo www. */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** true si `host` es el mismo dominio registrable que `base` o un subdominio suyo. */
export function isSameSite(host: string, base: string): boolean {
  const h = normalizeHost(host);
  const b = normalizeHost(base);
  return h === b || h.endsWith(`.${b}`);
}
