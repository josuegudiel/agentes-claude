import type { CheckResult, TavilySearchResult } from '../schema.js';

/**
 * Checks de presencia online a partir de resultados de busqueda (Tavily).
 * Importante: la busqueda web es una observacion indirecta — cuando no se
 * encuentra algo usamos 'warn' ("no pudimos confirmar"), no 'fail', salvo
 * en menciones donde cero resultados externos si es una senal dura.
 */

export interface PresenceInput {
  businessName: string;
  city: string;
  /** Hostname del sitio propio (para excluirlo de "menciones de terceros"). */
  ownHost: string;
  results: TavilySearchResult[];
}

const REVIEW_HOSTS = [
  'yelp.',
  'tripadvisor.',
  'facebook.com',
  'trustpilot.',
  'foursquare.',
  'opentable.',
  'booking.com',
  'g2.com',
  'capterra.',
];

const GBP_HINTS = [
  'google.com/maps',
  'maps.google.',
  'g.co/kgs',
  'business.site',
  'maps.app.goo.gl',
];

const BEST_OF_PATTERN = /\b(best|mejores|top\s?\d+|los \d+ mejores|guia|guía)\b/i;

export function runPresenceChecks(input: PresenceInput): CheckResult[] {
  const external = input.results.filter((r) => !hostOf(r.url).includes(input.ownHost));
  const nameLower = input.businessName.toLowerCase();
  const mentioning = external.filter(
    (r) => r.title.toLowerCase().includes(nameLower) || r.content.toLowerCase().includes(nameLower),
  );

  return [
    gbpCheck(input, external),
    mentionsCheck(input, mentioning),
    reviewsCheck(mentioning),
    bestOfCheck(input, external),
  ];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function gbpCheck(input: PresenceInput, external: TavilySearchResult[]): CheckResult {
  const gbp = external.find((r) => GBP_HINTS.some((h) => r.url.toLowerCase().includes(h)));
  return {
    id: 'presence.gbp',
    category: 'presence',
    status: gbp ? 'pass' : 'warn',
    weight: 4,
    title: 'Perfil de Google Business / Maps',
    detail: gbp
      ? `Se encontro presencia en Google Maps: ${gbp.url}`
      : `No pudimos confirmar un perfil de Google Business para "${input.businessName}" en ${input.city} desde la busqueda web.`,
    recommendation: gbp
      ? undefined
      : 'Crear/reclamar el Google Business Profile con categoria correcta, fotos, horarios y telefono: es la fuente #1 que usan Gemini y Google para negocios locales.',
  };
}

function mentionsCheck(input: PresenceInput, mentioning: TavilySearchResult[]): CheckResult {
  let status: CheckResult['status'];
  if (mentioning.length >= 3) status = 'pass';
  else if (mentioning.length >= 1) status = 'warn';
  else status = 'fail';
  return {
    id: 'presence.mentions',
    category: 'presence',
    status,
    weight: 3,
    title: 'Menciones del negocio en sitios de terceros',
    detail:
      mentioning.length > 0
        ? `${mentioning.length} mencion(es) externas encontradas (ej. ${hostOf(mentioning[0]?.url ?? '')}).`
        : `La busqueda "${input.businessName} ${input.city}" no devolvio menciones en sitios de terceros. Los motores de IA recomiendan negocios que la web corrobora.`,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Conseguir menciones: directorios locales, prensa local, colaboraciones y videos en YouTube — las menciones de marca pesan mas que los backlinks para visibilidad en IA.',
  };
}

function reviewsCheck(mentioning: TavilySearchResult[]): CheckResult {
  const reviewHits = mentioning.filter((r) => REVIEW_HOSTS.some((h) => hostOf(r.url).includes(h)));
  return {
    id: 'presence.reviews',
    category: 'presence',
    status: reviewHits.length > 0 ? 'pass' : 'warn',
    weight: 3,
    title: 'Presencia en plataformas de reseñas',
    detail:
      reviewHits.length > 0
        ? `Aparece en plataformas de reseñas: ${reviewHits.map((r) => hostOf(r.url)).join(', ')}.`
        : 'No se encontro presencia en plataformas de reseñas (Yelp, TripAdvisor, Facebook, Foursquare).',
    recommendation:
      reviewHits.length > 0
        ? undefined
        : 'Registrar el negocio en plataformas de reseñas relevantes y pedir reseñas con texto descriptivo: los LLMs resumen lo que dicen los clientes.',
  };
}

function bestOfCheck(input: PresenceInput, external: TavilySearchResult[]): CheckResult {
  const cityLower = input.city.toLowerCase();
  const nameLower = input.businessName.toLowerCase();
  const lists = external.filter(
    (r) =>
      BEST_OF_PATTERN.test(r.title) &&
      (r.title.toLowerCase().includes(cityLower) || r.content.toLowerCase().includes(cityLower)) &&
      (r.title.toLowerCase().includes(nameLower) || r.content.toLowerCase().includes(nameLower)),
  );
  return {
    id: 'presence.bestof',
    category: 'presence',
    status: lists.length > 0 ? 'pass' : 'warn',
    weight: 2,
    title: 'Aparicion en listas "mejores de la ciudad"',
    detail:
      lists.length > 0
        ? `Aparece en listas tipo "best of": ${lists[0]?.title}.`
        : `No se encontro al negocio en listas "mejores de ${input.city}". Los motores de IA sintetizan sus recomendaciones desde esos listados.`,
    recommendation:
      lists.length > 0
        ? undefined
        : 'Buscar inclusion en articulos "los mejores [rubro] de [ciudad]" de blogs y medios locales (PR local / colaboraciones).',
  };
}
