import type { CheckResult } from '../schema.js';
import type { ParsedSite } from '../html.js';
import { containsWord } from './text-match.js';

/**
 * Checks de preparacion GEO (Generative Engine Optimization): que tan listo
 * esta el sitio para ser leido y citado por AI Overviews, ChatGPT, Perplexity.
 */

export interface GeoInput {
  site: ParsedSite;
  robotsTxt: { status: 'ok'; content: string } | { status: 'missing' } | { status: 'error' };
  llmsTxt: 'ok' | 'missing' | 'error';
  businessName: string;
  city: string;
}

/** Crawlers cuyo bloqueo borra al negocio de los motores de IA. */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'PerplexityBot',
  'ClaudeBot',
  'Google-Extended',
] as const;

/** Subtipos frecuentes de LocalBusiness en sitios de negocios locales. */
const LOCAL_BUSINESS_TYPES = new Set(
  [
    'localbusiness',
    'restaurant',
    'store',
    'dentist',
    'physician',
    'medicalclinic',
    'autorepair',
    'hairsalon',
    'beautysalon',
    'lawfirm',
    'realestateagent',
    'lodgingbusiness',
    'hotel',
    'cafeorcoffeeshop',
    'bakery',
    'barorpub',
    'gym',
    'exercisegym',
    'veterinarycare',
    'professionalservice',
    'homeandconstructionbusiness',
    'plumber',
    'electrician',
  ].map((t) => t),
);

export function runGeoChecks(input: GeoInput): CheckResult[] {
  return [
    jsonLdLocalCheck(input.site),
    robotsAiCrawlersCheck(input.robotsTxt),
    qaStructureCheck(input.site),
    directAnswerCheck(input.site, input.businessName),
    citableDataCheck(input.site),
    napCheck(input.site, input.city),
    cityInTitleCheck(input.site, input.city),
    clickToCallCheck(input.site),
    whatsappCheck(input.site),
    socialLinksCheck(input.site),
    llmsTxtCheck(input.llmsTxt),
  ];
}

function cityInTitleCheck(site: ParsedSite, city: string): CheckResult {
  // Match por palabra completa e ignorando acentos: "Leon" no coincide con
  // "Napoleon", y "León" coincide con un title que escriba "Leon".
  const inTitle = site.title ? containsWord(site.title, city) : false;
  const h1 = site.headings.find((h) => h.level === 1)?.text ?? '';
  const inH1 = containsWord(h1, city);

  let status: CheckResult['status'];
  if (inTitle) status = 'pass';
  else if (inH1) status = 'warn';
  else status = 'fail';
  return {
    id: 'geo.city_in_title',
    category: 'geo',
    status,
    weight: 3,
    title: 'Ciudad en el title / H1',
    detail: inTitle
      ? `El title menciona "${city}": la senal local mas directa para "cerca de mi" y busquedas con IA.`
      : inH1
        ? `"${city}" aparece en el H1 pero no en el title.`
        : `Ni el title ni el H1 mencionan "${city}". Para un negocio local, la ciudad en el title es la senal de relevancia geografica mas barata que existe.`,
    recommendation:
      status === 'pass'
        ? undefined
        : `Incluir la ciudad en el title (ej. "Servicio X en ${city}") y reforzarla en el H1.`,
  };
}

function clickToCallCheck(site: ParsedSite): CheckResult {
  const n = site.links.telLinks.length;
  return {
    id: 'geo.click_to_call',
    category: 'geo',
    status: n > 0 ? 'pass' : 'warn',
    weight: 2,
    title: 'Telefono con un toque (tel:)',
    detail:
      n > 0
        ? `${n} enlace(s) tel: — el cliente puede llamar con un toque desde el celular.`
        : 'El telefono (si existe) es solo texto: en el celular, cada paso extra para llamar pierde leads.',
    recommendation:
      n > 0
        ? undefined
        : 'Convertir el numero en enlace clicable: <a href="tel:+502...">. Es la conversion mas directa de una busqueda local.',
  };
}

function whatsappCheck(site: ParsedSite): CheckResult {
  const n = site.links.whatsappLinks.length;
  return {
    id: 'geo.whatsapp',
    category: 'geo',
    status: n > 0 ? 'pass' : 'warn',
    weight: 2,
    title: 'Boton de WhatsApp',
    detail:
      n > 0
        ? `Enlace directo a WhatsApp presente (${n}).`
        : 'No hay enlace a WhatsApp (wa.me). En Latinoamerica es el canal #1 por el que un lead local escribe.',
    recommendation:
      n > 0
        ? undefined
        : 'Agregar un boton wa.me/<numero> con mensaje predefinido (ej. "Hola, vi su sitio web...").',
  };
}

function socialLinksCheck(site: ParsedSite): CheckResult {
  const hosts = site.links.socialHosts;
  return {
    id: 'geo.social_links',
    category: 'geo',
    status: hosts.length > 0 ? 'pass' : 'warn',
    weight: 1,
    title: 'Perfiles sociales enlazados',
    detail:
      hosts.length > 0
        ? `Enlaza a: ${hosts.join(', ')}. Los motores de IA corroboran la existencia del negocio con estas senales.`
        : 'No enlaza ningun perfil social; los motores de IA usan esas senales para corroborar que el negocio existe y esta activo.',
    recommendation:
      hosts.length > 0
        ? undefined
        : 'Enlazar los perfiles activos del negocio (Facebook/Instagram) desde el sitio, y viceversa.',
  };
}

function jsonLdLocalCheck(site: ParsedSite): CheckResult {
  const types = site.jsonLd.flatMap((b) => b.types.map((t) => t.toLowerCase()));
  const hasLocal = types.some((t) => LOCAL_BUSINESS_TYPES.has(t));
  const hasOrg = types.includes('organization');
  const brokenNote =
    site.jsonLdErrors > 0
      ? ` Ademas hay ${site.jsonLdErrors} bloque(s) JSON-LD con JSON invalido.`
      : '';

  let status: CheckResult['status'];
  let detail: string;
  if (hasLocal) {
    status = site.jsonLdErrors > 0 ? 'warn' : 'pass';
    detail = `Datos estructurados de negocio local presentes (${uniq(types).join(', ')}).${brokenNote}`;
  } else if (hasOrg) {
    status = 'warn';
    detail = `Solo hay schema Organization; falta LocalBusiness con direccion, telefono y horarios.${brokenNote}`;
  } else {
    status = 'fail';
    detail =
      site.jsonLd.length > 0
        ? `Hay JSON-LD (${uniq(types).join(', ') || 'sin @type'}) pero ninguno describe el negocio local.${brokenNote}`
        : `No hay datos estructurados JSON-LD. Google y los motores de IA no tienen ficha del negocio.${brokenNote}`;
  }
  return {
    id: 'geo.jsonld_local',
    category: 'geo',
    status,
    weight: 4,
    title: 'Schema LocalBusiness (JSON-LD)',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Agregar JSON-LD tipo LocalBusiness (o su subtipo, ej. Restaurant) con nombre, direccion, telefono, horarios y geo.',
  };
}

interface RobotsGroup {
  agents: string[];
  disallows: string[];
  allows: string[];
}

/** Parser minimo de robots.txt: grupos User-agent -> Disallow/Allow. */
export function parseRobotsGroups(content: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const match = /^([a-zA-Z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]?.toLowerCase();
    const value = (match[2] ?? '').trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], disallows: [], allows: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      if (key === 'disallow' && current) current.disallows.push(value);
      else if (key === 'allow' && current) current.allows.push(value);
      lastWasAgent = false;
    }
  }
  return groups;
}

/**
 * true si el agente esta efectivamente bloqueado del sitio entero.
 * Considera la directiva Allow: un `Allow: /` (o `/*`) junto a `Disallow: /`
 * habilita el acceso — ignorarlo produce falsos positivos de bloqueo.
 */
export function isAgentBlocked(groups: RobotsGroup[], agent: string): boolean {
  const lower = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(lower));
  // robots.txt: el grupo mas especifico gana; solo cae al wildcard si no hay grupo propio.
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  return applicable.some((g) => {
    const disallowRoot = g.disallows.some((d) => d === '/' || d === '/*');
    if (!disallowRoot) return false;
    // Un Allow raiz revierte el Disallow raiz -> no esta bloqueado.
    const allowRoot = g.allows.some((a) => a === '/' || a === '/*');
    return !allowRoot;
  });
}

function robotsAiCrawlersCheck(robots: GeoInput['robotsTxt']): CheckResult {
  if (robots.status === 'error') {
    return {
      id: 'geo.robots_ai_crawlers',
      category: 'geo',
      status: 'na',
      weight: 4,
      title: 'Crawlers de IA permitidos en robots.txt',
      detail: 'No se pudo leer /robots.txt (error de red).',
    };
  }
  if (robots.status === 'missing') {
    return {
      id: 'geo.robots_ai_crawlers',
      category: 'geo',
      status: 'pass',
      weight: 4,
      title: 'Crawlers de IA permitidos en robots.txt',
      detail: 'No hay robots.txt: por defecto ningun crawler de IA esta bloqueado.',
    };
  }

  const groups = parseRobotsGroups(robots.content);
  const blocked = AI_CRAWLERS.filter((agent) => isAgentBlocked(groups, agent));
  if (blocked.length === 0) {
    return {
      id: 'geo.robots_ai_crawlers',
      category: 'geo',
      status: 'pass',
      weight: 4,
      title: 'Crawlers de IA permitidos en robots.txt',
      detail: `robots.txt presente y ninguno de los crawlers clave (${AI_CRAWLERS.join(', ')}) esta bloqueado.`,
    };
  }
  return {
    id: 'geo.robots_ai_crawlers',
    category: 'geo',
    status: 'fail',
    weight: 4,
    title: 'Crawlers de IA permitidos en robots.txt',
    detail: `robots.txt bloquea a: ${blocked.join(', ')}. El negocio queda invisible para esos motores de IA.`,
    recommendation:
      'Permitir los bots de busqueda de IA (en especial OAI-SearchBot y PerplexityBot) en robots.txt; bloquearlos elimina al negocio de ChatGPT/Perplexity.',
  };
}

const QUESTION_PATTERN =
  /\?|^(que|qué|como|cómo|cuanto|cuánto|cuando|cuándo|donde|dónde|por que|por qué|cual|cuál|quien|quién|what|how|when|where|why|which|who)\b/i;

function qaStructureCheck(site: ParsedSite): CheckResult {
  const hasFaqSchema = site.jsonLd.some((b) => b.types.some((t) => t.toLowerCase() === 'faqpage'));
  const questionHeadings = site.headings.filter(
    (h) => h.level >= 2 && QUESTION_PATTERN.test(h.text.trim()),
  );

  let status: CheckResult['status'];
  let detail: string;
  if (hasFaqSchema || questionHeadings.length >= 2) {
    status = 'pass';
    detail = hasFaqSchema
      ? 'Hay schema FAQPage: contenido pregunta-respuesta listo para ser citado.'
      : `${questionHeadings.length} encabezados en forma de pregunta (ej. "${questionHeadings[0]?.text}").`;
  } else if (questionHeadings.length === 1) {
    status = 'warn';
    detail = `Solo un encabezado en forma de pregunta ("${questionHeadings[0]?.text}").`;
  } else {
    status = 'fail';
    detail =
      'No hay seccion de preguntas frecuentes ni encabezados en forma de pregunta. Los motores de IA citan fragmentos que responden preguntas concretas.';
  }
  return {
    id: 'geo.qa_structure',
    category: 'geo',
    status,
    weight: 3,
    title: 'Estructura pregunta-respuesta (FAQ)',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Agregar una seccion de preguntas frecuentes con H2/H3 en forma de pregunta y respuesta directa debajo, mas schema FAQPage.',
  };
}

function directAnswerCheck(site: ParsedSite, businessName: string): CheckResult {
  const intro = site.visibleText.slice(0, 500);
  const mentionsName = intro.toLowerCase().includes(businessName.toLowerCase());
  if (intro.length < 100) {
    return {
      id: 'geo.direct_answer',
      category: 'geo',
      status: 'fail',
      weight: 2,
      title: 'Respuesta directa al inicio',
      detail:
        'El inicio de la pagina casi no tiene texto: un motor de IA no encuentra que extraer.',
      recommendation:
        'Abrir la pagina con 2-3 frases que digan que es el negocio, que ofrece y donde — el fragmento que un motor de IA citaria.',
    };
  }
  return {
    id: 'geo.direct_answer',
    category: 'geo',
    status: mentionsName ? 'pass' : 'warn',
    weight: 2,
    title: 'Respuesta directa al inicio',
    detail: mentionsName
      ? `El inicio de la pagina presenta al negocio ("${intro.slice(0, 120)}...").`
      : `El nombre del negocio ("${businessName}") no aparece en los primeros 500 caracteres de texto.`,
    recommendation: mentionsName
      ? undefined
      : 'Mencionar el nombre del negocio y su propuesta en el primer parrafo visible.',
  };
}

function citableDataCheck(site: ParsedSite): CheckResult {
  const text = site.visibleText;
  const numericTokens =
    text.match(
      /\d+(?:[.,]\d+)?\s*(?:%|anos|años|clientes|resenas|reseñas|estrellas|sucursales|horas?)/gi,
    ) ?? [];
  const plainNumbers = text.match(/\b\d{2,4}\b/g) ?? [];
  const signal = numericTokens.length * 2 + Math.min(plainNumbers.length, 10);

  let status: CheckResult['status'];
  let detail: string;
  if (signal >= 8) {
    status = 'pass';
    detail = `El contenido incluye datos concretos (${numericTokens.length} cifras con unidad, ej. "${numericTokens[0] ?? plainNumbers[0]}").`;
  } else if (signal >= 2) {
    status = 'warn';
    detail = 'Hay pocos datos o cifras concretas en el contenido.';
  } else {
    status = 'fail';
    detail =
      'El contenido no tiene cifras ni datos citables (años de experiencia, clientes, precios).';
  }
  return {
    id: 'geo.citable_data',
    category: 'geo',
    status,
    weight: 2,
    title: 'Datos y cifras citables',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Incluir cifras verificables (años de experiencia, clientes atendidos, calificacion promedio): los estudios muestran ~+40% de visibilidad en motores generativos.',
  };
}

// Telefono: exige separador/parentesis/prefijo internacional entre bloques,
// para no matchear una corrida de digitos como "1500000 clientes".
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/;
// Direccion: palabras fuertes por si solas, o palabras debiles seguidas de un
// numero (asi "comida local" no cuenta como direccion, pero "local 5" si).
const ADDRESS_STRONG = /\b(calle|avenida|av\.|boulevard|blvd|carretera|colonia|edificio|street)\b/i;
const ADDRESS_WEAK_WITH_NUM = /\b(zona|local|suite|no\.?)\s*\d|#\s?\d/i;

function napCheck(site: ParsedSite, city: string): CheckResult {
  const text = site.visibleText;
  // El telefono cuenta si hay un enlace tel: (senal dura) o un patron con formato.
  const hasPhone = site.links.telLinks.length > 0 || PHONE_PATTERN.test(text);
  const hasCity = containsWord(text, city);
  const hasAddress = ADDRESS_STRONG.test(text) || ADDRESS_WEAK_WITH_NUM.test(text);
  const present = [hasPhone, hasCity, hasAddress].filter(Boolean).length;

  let status: CheckResult['status'];
  if (present === 3) status = 'pass';
  else if (present >= 1) status = 'warn';
  else status = 'fail';

  const parts = [
    `telefono ${hasPhone ? 'visible' : 'NO visible'}`,
    `ciudad ${hasCity ? 'mencionada' : 'NO mencionada'}`,
    `direccion ${hasAddress ? 'aparente' : 'NO aparente'}`,
  ];
  return {
    id: 'geo.nap',
    category: 'geo',
    status,
    weight: 3,
    title: 'NAP visible (nombre, direccion, telefono)',
    detail: `En el texto de la pagina: ${parts.join(', ')}.`,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Mostrar nombre, direccion completa y telefono como texto (no imagen) en la pagina, identicos a los del perfil de Google.',
  };
}

function llmsTxtCheck(llmsTxt: GeoInput['llmsTxt']): CheckResult {
  // Informativo: tenerlo suma un punto menor; no tenerlo NUNCA penaliza
  // (Google lo descarto y los crawlers grandes no lo solicitan).
  if (llmsTxt === 'ok') {
    return {
      id: 'geo.llms_txt',
      category: 'geo',
      status: 'pass',
      weight: 1,
      title: 'llms.txt (informativo)',
      detail: 'Existe /llms.txt. Es opcional: los crawlers principales aun no lo usan.',
    };
  }
  return {
    id: 'geo.llms_txt',
    category: 'geo',
    status: 'na',
    weight: 1,
    title: 'llms.txt (informativo)',
    detail:
      llmsTxt === 'missing'
        ? 'No hay /llms.txt. No penaliza: Google lo descarto y los crawlers de IA no lo solicitan.'
        : 'No se pudo verificar /llms.txt.',
  };
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}
