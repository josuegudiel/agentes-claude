import type { CheckResult } from '../schema.js';
import type { ParsedSite } from '../html.js';

/**
 * Checks de SEO tecnico on-page. Funciones puras: snapshot -> resultados.
 * Cada check explica la evidencia en `detail` para que el reporte (y el LLM)
 * hablen de hechos observados, no de generalidades.
 */

export interface OnpageInput {
  site: ParsedSite;
  finalUrl: string;
  sitemap: 'ok' | 'missing' | 'error';
}

export function runOnpageChecks(input: OnpageInput): CheckResult[] {
  const { site, finalUrl, sitemap } = input;
  return [
    httpsCheck(finalUrl),
    noindexCheck(site),
    titleCheck(site),
    metaDescriptionCheck(site),
    h1Check(site),
    headingStructureCheck(site),
    viewportCheck(site),
    canonicalCheck(site),
    ogCheck(site),
    imgAltCheck(site),
    textRatioCheck(site),
    internalLinksCheck(site),
    langCheck(site),
    faviconCheck(site),
    sitemapCheck(sitemap),
  ];
}

function noindexCheck(site: ParsedSite): CheckResult {
  const robots = site.robotsMeta?.toLowerCase() ?? '';
  // Tokenizar por coma, punto y coma o espacios (los tres separadores que se
  // ven en la practica: "noindex,nofollow", "noindex; nofollow",
  // "noindex nofollow"). Se comparan tokens EXACTOS: "max-image-preview:none"
  // (indexable) NO cuenta, porque 'none' ahi es sub-token, no directiva.
  const directives = robots.split(/[,;\s]+/).filter(Boolean);
  const blocked = directives.some((d) => d === 'noindex' || d === 'none');
  return {
    id: 'onpage.noindex',
    category: 'onpage',
    status: blocked ? 'fail' : 'pass',
    weight: 4,
    title: 'Pagina indexable (sin noindex)',
    detail: blocked
      ? `La pagina tiene <meta name="robots" content="${site.robotsMeta}">: le pide a Google y a los motores de IA que NO la muestren. El negocio es invisible a proposito.`
      : site.robotsMeta
        ? `Meta robots presente ("${site.robotsMeta}") sin bloquear la indexacion.`
        : 'Sin meta robots restrictivo: la pagina es indexable.',
    recommendation: blocked
      ? 'Quitar el noindex de la pagina principal de inmediato — suele quedar activado por error al salir de "modo borrador" del constructor web.'
      : undefined,
  };
}

function viewportCheck(site: ParsedSite): CheckResult {
  return {
    id: 'onpage.viewport',
    category: 'onpage',
    status: site.hasViewport ? 'pass' : 'fail',
    weight: 3,
    title: 'Adaptado a moviles (meta viewport)',
    detail: site.hasViewport
      ? 'Meta viewport presente: la pagina se adapta a pantallas moviles.'
      : 'Sin meta viewport: en el celular la pagina se ve como escritorio en miniatura. La mayoria de busquedas locales son desde el celular.',
    recommendation: site.hasViewport
      ? undefined
      : 'Agregar <meta name="viewport" content="width=device-width, initial-scale=1"> y revisar el diseno responsive.',
  };
}

function internalLinksCheck(site: ParsedSite): CheckResult {
  const n = site.links.internalCount;
  let status: CheckResult['status'];
  if (n >= 5) status = 'pass';
  else if (n >= 1) status = 'warn';
  else status = 'fail';
  return {
    id: 'onpage.internal_links',
    category: 'onpage',
    status,
    weight: 1,
    title: 'Enlaces internos',
    detail:
      n > 0
        ? `${n} enlaces internos en la pagina.`
        : 'La pagina no enlaza a ninguna otra seccion del sitio (pagina huerfana o single-page sin anclas).',
    recommendation:
      status === 'pass'
        ? undefined
        : 'Enlazar las secciones clave (servicios, contacto, precios) desde la pagina principal para que crawlers y visitantes las descubran.',
  };
}

function langCheck(site: ParsedSite): CheckResult {
  return {
    id: 'onpage.lang',
    category: 'onpage',
    status: site.htmlLang ? 'pass' : 'warn',
    weight: 1,
    title: 'Idioma declarado (<html lang>)',
    detail: site.htmlLang
      ? `Idioma declarado: "${site.htmlLang}".`
      : 'El <html> no declara idioma; ayuda a buscadores y lectores de pantalla a clasificar el contenido.',
    recommendation: site.htmlLang
      ? undefined
      : 'Agregar lang="es" (o el idioma del sitio) a la etiqueta <html>.',
  };
}

function faviconCheck(site: ParsedSite): CheckResult {
  return {
    id: 'onpage.favicon',
    category: 'onpage',
    status: site.hasFavicon ? 'pass' : 'warn',
    weight: 1,
    title: 'Favicon',
    detail: site.hasFavicon
      ? 'Favicon declarado.'
      : 'Sin favicon: la pestana y los resultados de busqueda muestran un icono generico (resta confianza).',
    recommendation: site.hasFavicon
      ? undefined
      : 'Agregar un favicon con el logo del negocio (<link rel="icon" ...>).',
  };
}

function httpsCheck(finalUrl: string): CheckResult {
  const isHttps = finalUrl.startsWith('https://');
  return {
    id: 'onpage.https',
    category: 'onpage',
    status: isHttps ? 'pass' : 'fail',
    weight: 3,
    title: 'Sitio servido por HTTPS',
    detail: isHttps
      ? `El sitio carga seguro en ${finalUrl}.`
      : `El sitio carga sin cifrado (${finalUrl}). Google y los navegadores lo penalizan.`,
    recommendation: isHttps
      ? undefined
      : 'Instalar un certificado SSL (gratis con Let’s Encrypt) y redirigir todo el trafico a https://.',
  };
}

function titleCheck(site: ParsedSite): CheckResult {
  const title = site.title;
  let status: CheckResult['status'];
  let detail: string;
  if (!title) {
    status = 'fail';
    detail = 'La pagina no tiene etiqueta <title>.';
  } else if (title.length < 10 || title.length > 70) {
    status = 'warn';
    detail = `Title de ${title.length} caracteres: "${title}". Lo recomendado es 10-70.`;
  } else {
    status = 'pass';
    detail = `Title presente (${title.length} caracteres): "${title}".`;
  }
  return {
    id: 'onpage.title',
    category: 'onpage',
    status,
    weight: 3,
    title: 'Etiqueta <title> descriptiva',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Escribir un title de 10-70 caracteres con el nombre del negocio, el servicio y la ciudad.',
  };
}

function metaDescriptionCheck(site: ParsedSite): CheckResult {
  const desc = site.metaDescription;
  let status: CheckResult['status'];
  let detail: string;
  if (!desc) {
    status = 'fail';
    detail = 'No hay meta description. Google y los motores de IA improvisan el resumen.';
  } else if (desc.length < 50 || desc.length > 170) {
    status = 'warn';
    detail = `Meta description de ${desc.length} caracteres. Lo recomendado es 50-170.`;
  } else {
    status = 'pass';
    detail = `Meta description presente (${desc.length} caracteres).`;
  }
  return {
    id: 'onpage.meta_description',
    category: 'onpage',
    status,
    weight: 3,
    title: 'Meta description',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Redactar una meta description de 50-170 caracteres que resuma el servicio y la zona de cobertura.',
  };
}

function h1Check(site: ParsedSite): CheckResult {
  const h1s = site.headings.filter((h) => h.level === 1);
  let status: CheckResult['status'];
  let detail: string;
  if (h1s.length === 1) {
    status = 'pass';
    detail = `Un unico H1: "${h1s[0]?.text}".`;
  } else if (h1s.length === 0) {
    status = 'fail';
    detail = 'La pagina no tiene H1. Es la senal mas basica de tema principal.';
  } else {
    status = 'warn';
    detail = `Hay ${h1s.length} H1 en la pagina; deberia haber exactamente uno.`;
  }
  return {
    id: 'onpage.h1',
    category: 'onpage',
    status,
    weight: 3,
    title: 'Encabezado H1 unico',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Usar exactamente un H1 que diga que hace el negocio y donde (ej. "Taller mecanico en Quetzaltenango").',
  };
}

function headingStructureCheck(site: ParsedSite): CheckResult {
  const h2s = site.headings.filter((h) => h.level === 2);
  let status: CheckResult['status'];
  let detail: string;
  if (site.headings.length === 0) {
    status = 'fail';
    detail = 'La pagina no usa encabezados (H1-H6); el contenido es un bloque plano.';
  } else if (h2s.length === 0) {
    status = 'warn';
    detail = `Hay ${site.headings.length} encabezados pero ningun H2 que seccione el contenido.`;
  } else {
    status = 'pass';
    detail = `Estructura con ${h2s.length} H2 que seccionan el contenido.`;
  }
  return {
    id: 'onpage.heading_structure',
    category: 'onpage',
    status,
    weight: 2,
    title: 'Jerarquia de encabezados',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Seccionar el contenido con H2 descriptivos (servicios, precios, zona, preguntas frecuentes).',
  };
}

function canonicalCheck(site: ParsedSite): CheckResult {
  const has = Boolean(site.canonical);
  return {
    id: 'onpage.canonical',
    category: 'onpage',
    status: has ? 'pass' : 'warn',
    weight: 2,
    title: 'URL canonica declarada',
    detail: has
      ? `Canonical presente: ${site.canonical}.`
      : 'No hay <link rel="canonical">; riesgo de contenido duplicado ante variantes de URL.',
    recommendation: has
      ? undefined
      : 'Agregar <link rel="canonical"> apuntando a la URL principal de cada pagina.',
  };
}

function ogCheck(site: ParsedSite): CheckResult {
  const wanted = ['og:title', 'og:description', 'og:image'];
  const present = wanted.filter((k) => site.ogTags[k]);
  let status: CheckResult['status'];
  if (present.length >= 2) status = 'pass';
  else if (present.length === 1) status = 'warn';
  else status = 'fail';
  return {
    id: 'onpage.og',
    category: 'onpage',
    status,
    weight: 2,
    title: 'Open Graph para compartir',
    detail:
      present.length > 0
        ? `Tags presentes: ${present.join(', ')}.`
        : 'Sin tags Open Graph: el sitio se ve roto al compartirse en WhatsApp/Facebook.',
    recommendation:
      status === 'pass'
        ? undefined
        : 'Agregar og:title, og:description y og:image para controlar como se ve el negocio al compartir el link.',
  };
}

function imgAltCheck(site: ParsedSite): CheckResult {
  if (site.imgCount === 0) {
    return {
      id: 'onpage.img_alt',
      category: 'onpage',
      status: 'na',
      weight: 2,
      title: 'Texto alternativo en imagenes',
      detail: 'La pagina no tiene imagenes; check no aplicable.',
    };
  }
  const ratio = site.imgsWithoutAlt / site.imgCount;
  let status: CheckResult['status'];
  if (site.imgsWithoutAlt === 0) status = 'pass';
  else if (ratio <= 0.3) status = 'warn';
  else status = 'fail';
  return {
    id: 'onpage.img_alt',
    category: 'onpage',
    status,
    weight: 2,
    title: 'Texto alternativo en imagenes',
    detail: `${site.imgsWithoutAlt} de ${site.imgCount} imagenes sin atributo alt.`,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Describir cada imagen en su atributo alt (producto, local, equipo) — tambien lo leen los motores de IA.',
  };
}

function textRatioCheck(site: ParsedSite): CheckResult {
  const textLen = site.visibleText.length;
  const ratio = site.htmlBytes > 0 ? textLen / site.htmlBytes : 0;
  let status: CheckResult['status'];
  let detail: string;
  if (textLen < 200) {
    status = 'fail';
    detail = `Solo ${textLen} caracteres de texto visible sin ejecutar JavaScript. Los crawlers de IA (GPTBot, PerplexityBot) no renderizan JS y ven una pagina casi vacia.`;
  } else if (textLen < 600 || ratio < 0.03) {
    status = 'warn';
    detail = `${textLen} caracteres de texto visible (ratio texto/HTML ${(ratio * 100).toFixed(1)}%). Poco contenido indexable sin JS.`;
  } else {
    status = 'pass';
    detail = `${textLen} caracteres de texto visible sin JS (ratio ${(ratio * 100).toFixed(1)}%).`;
  }
  return {
    id: 'onpage.text_ratio',
    category: 'onpage',
    status,
    weight: 2,
    title: 'Contenido visible sin JavaScript',
    detail,
    recommendation:
      status === 'pass'
        ? undefined
        : 'Servir el contenido principal en el HTML inicial (SSR o sitio estatico) para que los crawlers de IA puedan leerlo.',
  };
}

function sitemapCheck(sitemap: OnpageInput['sitemap']): CheckResult {
  if (sitemap === 'error') {
    return {
      id: 'onpage.sitemap',
      category: 'onpage',
      status: 'na',
      weight: 2,
      title: 'Sitemap XML',
      detail: 'No se pudo verificar /sitemap.xml (error de red).',
    };
  }
  const ok = sitemap === 'ok';
  return {
    id: 'onpage.sitemap',
    category: 'onpage',
    status: ok ? 'pass' : 'warn',
    weight: 2,
    title: 'Sitemap XML',
    detail: ok ? 'Existe /sitemap.xml.' : 'No se encontro /sitemap.xml.',
    recommendation: ok
      ? undefined
      : 'Publicar un sitemap.xml y enviarlo en Google Search Console para acelerar la indexacion.',
  };
}
