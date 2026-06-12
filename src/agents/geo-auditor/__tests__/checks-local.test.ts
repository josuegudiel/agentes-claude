import { describe, expect, it } from 'vitest';
import { parseSiteHtml } from '../html.js';
import { runOnpageChecks } from '../checks/onpage.js';
import { runGeoChecks } from '../checks/geo.js';

const LOCAL_READY_PAGE = `<html lang="es"><head>
  <title>Taller Lopez — Mecanica en Quetzaltenango</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index, follow">
  <link rel="icon" href="/favicon.ico">
</head><body>
  <h1>Taller Lopez Quetzaltenango</h1>
  <a href="/servicios">Servicios</a>
  <a href="/precios">Precios</a>
  <a href="/contacto">Contacto</a>
  <a href="/nosotros">Nosotros</a>
  <a href="https://www.tallerlopez.gt/blog">Blog</a>
  <a href="tel:+50277611234">7761-1234</a>
  <a href="https://wa.me/50277611234?text=Hola">WhatsApp</a>
  <a href="https://www.facebook.com/tallerlopez">Facebook</a>
  <a href="https://instagram.com/tallerlopez">Instagram</a>
</body></html>`;

const BARE_PAGE = `<html><head><title>Pagina sin nada util de negocio</title></head>
<body><p>Texto plano con telefono 7761-1234 sin enlaces de ningun tipo aqui.</p></body></html>`;

const NOINDEX_PAGE = `<html lang="es"><head>
  <title>Negocio en borrador</title>
  <meta name="robots" content="noindex, nofollow">
</head><body><h1>Hola</h1></body></html>`;

describe('parseSiteHtml — señales nuevas', () => {
  const site = parseSiteHtml(LOCAL_READY_PAGE, { baseHost: 'tallerlopez.gt' });

  it('extrae lang, viewport, robots meta y favicon', () => {
    expect(site.htmlLang).toBe('es');
    expect(site.hasViewport).toBe(true);
    expect(site.robotsMeta).toBe('index, follow');
    expect(site.hasFavicon).toBe(true);
  });

  it('clasifica enlaces: internos (relativos y mismo host con www), tel, whatsapp y sociales', () => {
    expect(site.links.internalCount).toBe(5); // 4 relativos + www.tallerlopez.gt
    expect(site.links.telLinks).toEqual(['tel:+50277611234']);
    expect(site.links.whatsappLinks).toHaveLength(1);
    expect([...site.links.socialHosts].sort()).toEqual(['facebook.com', 'instagram.com']);
  });

  it('pagina sin enlaces reporta cero señales', () => {
    const bare = parseSiteHtml(BARE_PAGE, { baseHost: 'x.gt' });
    expect(bare.links.internalCount).toBe(0);
    expect(bare.links.telLinks).toHaveLength(0);
    expect(bare.links.whatsappLinks).toHaveLength(0);
    expect(bare.links.socialHosts).toHaveLength(0);
    expect(bare.htmlLang).toBeNull();
    expect(bare.hasViewport).toBe(false);
    expect(bare.hasFavicon).toBe(false);
  });
});

function onpageMap(html: string): Map<string, ReturnType<typeof runOnpageChecks>[number]> {
  const results = runOnpageChecks({
    site: parseSiteHtml(html, { baseHost: 'tallerlopez.gt' }),
    finalUrl: 'https://tallerlopez.gt/',
    sitemap: 'ok',
  });
  return new Map(results.map((r) => [r.id, r]));
}

function geoMap(html: string): Map<string, ReturnType<typeof runGeoChecks>[number]> {
  const results = runGeoChecks({
    site: parseSiteHtml(html, { baseHost: 'tallerlopez.gt' }),
    robotsTxt: { status: 'missing' },
    llmsTxt: 'missing',
    businessName: 'Taller Lopez',
    city: 'Quetzaltenango',
  });
  return new Map(results.map((r) => [r.id, r]));
}

describe('checks on-page nuevos', () => {
  it('pagina local bien armada: noindex/viewport/lang/favicon/internal_links en pass', () => {
    const checks = onpageMap(LOCAL_READY_PAGE);
    expect(checks.get('onpage.noindex')?.status).toBe('pass');
    expect(checks.get('onpage.viewport')?.status).toBe('pass');
    expect(checks.get('onpage.lang')?.status).toBe('pass');
    expect(checks.get('onpage.favicon')?.status).toBe('pass');
    expect(checks.get('onpage.internal_links')?.status).toBe('pass');
  });

  it('noindex es fail critico y cita el contenido del meta', () => {
    const check = onpageMap(NOINDEX_PAGE).get('onpage.noindex');
    expect(check?.status).toBe('fail');
    expect(check?.weight).toBe(4);
    expect(check?.detail).toContain('noindex, nofollow');
  });

  it('sin viewport es fail; sin lang/favicon es warn; sin enlaces internos es fail', () => {
    const checks = onpageMap(BARE_PAGE);
    expect(checks.get('onpage.viewport')?.status).toBe('fail');
    expect(checks.get('onpage.lang')?.status).toBe('warn');
    expect(checks.get('onpage.favicon')?.status).toBe('warn');
    expect(checks.get('onpage.internal_links')?.status).toBe('fail');
  });
});

describe('checks geo locales nuevos', () => {
  it('pagina local bien armada: ciudad en title, tel, whatsapp y sociales en pass', () => {
    const checks = geoMap(LOCAL_READY_PAGE);
    expect(checks.get('geo.city_in_title')?.status).toBe('pass');
    expect(checks.get('geo.click_to_call')?.status).toBe('pass');
    expect(checks.get('geo.whatsapp')?.status).toBe('pass');
    expect(checks.get('geo.social_links')?.status).toBe('pass');
  });

  it('ciudad solo en H1 es warn; ausente es fail', () => {
    const onlyH1 = geoMap(
      '<html><head><title>Taller Lopez</title></head><body><h1>Taller en Quetzaltenango</h1></body></html>',
    );
    expect(onlyH1.get('geo.city_in_title')?.status).toBe('warn');
    const absent = geoMap(BARE_PAGE);
    expect(absent.get('geo.city_in_title')?.status).toBe('fail');
  });

  it('sin tel:/whatsapp/sociales es warn (telefono como texto no cuenta)', () => {
    const checks = geoMap(BARE_PAGE);
    expect(checks.get('geo.click_to_call')?.status).toBe('warn');
    expect(checks.get('geo.whatsapp')?.status).toBe('warn');
    expect(checks.get('geo.social_links')?.status).toBe('warn');
  });
});
