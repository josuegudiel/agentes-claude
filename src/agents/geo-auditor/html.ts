import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Parsing del HTML crudo a un snapshot estructurado y serializable.
 * Sin browser ni JS: lo que se extrae aqui es exactamente lo que ve un
 * crawler de IA que no renderiza JavaScript.
 */

export interface HeadingInfo {
  level: number;
  text: string;
}

export interface JsonLdBlock {
  /** Valores de @type encontrados (aplanados si @graph o array). */
  types: string[];
  raw: unknown;
}

export interface LinkSignals {
  /** Anchors que apuntan al mismo host o a rutas relativas. */
  internalCount: number;
  /** href tel: encontrados (click-to-call). */
  telLinks: string[];
  /** Links a WhatsApp (wa.me / api.whatsapp.com / whatsapp:). */
  whatsappLinks: string[];
  /** Hosts de redes sociales enlazados (facebook, instagram, ...). */
  socialHosts: string[];
}

export interface ParsedSite {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  ogTags: Record<string, string>;
  headings: HeadingInfo[];
  imgCount: number;
  imgsWithoutAlt: number;
  jsonLd: JsonLdBlock[];
  jsonLdErrors: number;
  /** Texto visible (sin scripts/estilos), espacios colapsados. */
  visibleText: string;
  htmlBytes: number;
  /** Atributo lang de <html> (ej. "es"), null si falta. */
  htmlLang: string | null;
  /** true si existe <meta name="viewport">. */
  hasViewport: boolean;
  /** Contenido de <meta name="robots">, null si no hay. */
  robotsMeta: string | null;
  /** true si hay <link rel*="icon">. */
  hasFavicon: boolean;
  links: LinkSignals;
}

const SOCIAL_HOSTS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
] as const;

export function parseSiteHtml(html: string, opts?: { baseHost?: string }): ParsedSite {
  const root = parse(html, {
    blockTextElements: { script: true, style: true, noscript: true, pre: true },
  });

  const title = textOrNull(root.querySelector('title'));
  const metaDescription = attrOrNull(root.querySelector('meta[name="description" i]'), 'content');
  const canonical = attrOrNull(root.querySelector('link[rel="canonical" i]'), 'href');

  const ogTags: Record<string, string> = {};
  for (const meta of root.querySelectorAll('meta[property]')) {
    const prop = meta.getAttribute('property');
    const content = meta.getAttribute('content');
    if (prop?.toLowerCase().startsWith('og:') && content) {
      ogTags[prop.toLowerCase()] = content;
    }
  }

  const headings: HeadingInfo[] = [];
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const level = Number(h.tagName.slice(1));
    const text = h.text.replace(/\s+/g, ' ').trim();
    if (text) headings.push({ level, text });
  }

  const imgs = root.querySelectorAll('img');
  const imgsWithoutAlt = imgs.filter((img) => !img.getAttribute('alt')?.trim()).length;

  const { jsonLd, jsonLdErrors } = extractJsonLd(root);

  const htmlLang = attrOrNull(root.querySelector('html'), 'lang');
  const hasViewport = root.querySelector('meta[name="viewport" i]') !== null;
  const robotsMeta = attrOrNull(root.querySelector('meta[name="robots" i]'), 'content');
  const hasFavicon =
    root.querySelector(
      'link[rel="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]',
    ) !== null;

  return {
    title,
    metaDescription,
    canonical,
    ogTags,
    headings,
    imgCount: imgs.length,
    imgsWithoutAlt,
    jsonLd,
    jsonLdErrors,
    visibleText: extractVisibleText(root),
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    htmlLang,
    hasViewport,
    robotsMeta,
    hasFavicon,
    links: extractLinkSignals(root, opts?.baseHost),
  };
}

function extractLinkSignals(root: HTMLElement, baseHost?: string): LinkSignals {
  const telLinks: string[] = [];
  const whatsappLinks: string[] = [];
  const socialFound = new Set<string>();
  let internalCount = 0;

  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')?.trim();
    if (!href) continue;
    const lower = href.toLowerCase();

    if (lower.startsWith('tel:')) {
      telLinks.push(href);
      continue;
    }
    if (
      lower.startsWith('whatsapp:') ||
      lower.includes('wa.me/') ||
      lower.includes('api.whatsapp.com')
    ) {
      whatsappLinks.push(href);
      continue;
    }

    if (lower.startsWith('#') || lower.startsWith('mailto:') || lower.startsWith('javascript:')) {
      continue;
    }

    // Protocol-relative (//host/...) es absoluto: normalizar con https antes
    // de clasificar, si no cae en el else y se cuenta mal como interno.
    const absolute = lower.startsWith('//')
      ? `https:${href}`
      : lower.startsWith('http://') || lower.startsWith('https://')
        ? href
        : null;

    if (absolute) {
      let host = '';
      try {
        host = new URL(absolute).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        continue;
      }
      const social = SOCIAL_HOSTS.find((s) => host === s || host.endsWith(`.${s}`));
      if (social) {
        socialFound.add(social);
      } else if (baseHost) {
        const base = baseHost.toLowerCase().replace(/^www\./, '');
        // Interno si es el mismo dominio o un subdominio propio (blog.mi-sitio).
        if (host === base || host.endsWith(`.${base}`)) internalCount++;
      }
    } else {
      // Rutas relativas (/contacto, servicios.html) cuentan como internas.
      internalCount++;
    }
  }

  return {
    internalCount,
    telLinks,
    whatsappLinks,
    socialHosts: [...socialFound],
  };
}

function textOrNull(el: HTMLElement | null): string | null {
  const text = el?.text.replace(/\s+/g, ' ').trim();
  return text ? text : null;
}

function attrOrNull(el: HTMLElement | null, attr: string): string | null {
  const value = el?.getAttribute(attr)?.trim();
  return value ? value : null;
}

function extractJsonLd(root: HTMLElement): { jsonLd: JsonLdBlock[]; jsonLdErrors: number } {
  const jsonLd: JsonLdBlock[] = [];
  let jsonLdErrors = 0;

  for (const script of root.querySelectorAll('script[type="application/ld+json" i]')) {
    try {
      const data: unknown = JSON.parse(script.text);
      jsonLd.push({ types: collectTypes(data), raw: data });
    } catch {
      jsonLdErrors++;
    }
  }
  return { jsonLd, jsonLdErrors };
}

/** Aplana @type a traves de arrays y @graph (forma comun en sitios reales). */
function collectTypes(data: unknown): string[] {
  const types: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') types.push(t);
    else if (Array.isArray(t)) t.forEach((v) => typeof v === 'string' && types.push(v));
    if (obj['@graph']) visit(obj['@graph']);
  };
  visit(data);
  return types;
}

function extractVisibleText(root: HTMLElement): string {
  // node-html-parser excluye los blockTextElements del .text del body? No:
  // los script/style siguen presentes como nodos; los removemos explicito.
  for (const el of root.querySelectorAll('script, style, noscript')) {
    el.remove();
  }
  const body = root.querySelector('body') ?? root;
  return body.text.replace(/\s+/g, ' ').trim();
}
