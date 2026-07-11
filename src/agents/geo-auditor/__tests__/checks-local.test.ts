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

  it('robots meta con "none" en un valor (max-image-preview:none) NO es noindex', () => {
    const page =
      '<html><head><title>Pagina indexable de prueba</title>' +
      '<meta name="robots" content="max-snippet:-1, max-image-preview:none, max-video-preview:-1">' +
      '</head><body><h1>Hola</h1></body></html>';
    expect(onpageMap(page).get('onpage.noindex')?.status).toBe('pass');
  });

  it('directiva "none" como token exacto SI es noindex', () => {
    const page =
      '<html><head><title>Pagina de prueba</title><meta name="robots" content="none"></head><body></body></html>';
    expect(onpageMap(page).get('onpage.noindex')?.status).toBe('fail');
  });

  it('noindex detectado con separadores no-coma: espacio y punto y coma', () => {
    const espacio =
      '<html><head><title>Pagina x</title><meta name="robots" content="noindex nofollow"></head><body></body></html>';
    expect(onpageMap(espacio).get('onpage.noindex')?.status).toBe('fail');
    const puntoComa =
      '<html><head><title>Pagina x</title><meta name="robots" content="noindex;nofollow"></head><body></body></html>';
    expect(onpageMap(puntoComa).get('onpage.noindex')?.status).toBe('fail');
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

  it('city_in_title no da falso positivo con substring ("Leon" en "Napoleon")', () => {
    const checks = geoMapCity(
      '<html><head><title>Gimnasio Napoleon Fitness</title></head><body><h1>Napoleon</h1></body></html>',
      'Leon',
    );
    expect(checks.get('geo.city_in_title')?.status).toBe('fail');
  });

  it('city_in_title tolera acentos (city "León" vs title "Leon")', () => {
    const checks = geoMapCity(
      '<html><head><title>Muebleria en Leon Centro</title></head><body></body></html>',
      'León',
    );
    expect(checks.get('geo.city_in_title')?.status).toBe('pass');
  });

  it('NAP: numero de 7 digitos ("1500000 clientes") no cuenta como telefono', () => {
    const page =
      '<html><body><p>Servimos a mas de 1500000 clientes cada año con dedicacion total y calidad.</p></body></html>';
    const checks = geoMapCity(page, 'Quetzaltenango');
    expect(checks.get('geo.nap')?.detail).toContain('telefono NO visible');
  });

  it('NAP: telefono LatAm de 8 digitos sin separador ("77611234") SI cuenta', () => {
    const page =
      '<html><body><p>Llamanos hoy mismo al 77611234 para agendar tu cita sin compromiso.</p></body></html>';
    const checks = geoMapCity(page, 'Quetzaltenango');
    expect(checks.get('geo.nap')?.detail).toContain('telefono visible');
  });

  it('NAP: "comida local" no cuenta como direccion, pero "local 5" si', () => {
    const noAddr = geoMapCity(
      '<html><body><p>Ofrecemos comida local y de temporada en tu zona preferida siempre.</p></body></html>',
      'Xela',
    );
    expect(noAddr.get('geo.nap')?.detail).toContain('direccion NO aparente');
    const withAddr = geoMapCity(
      '<html><body><p>Nos ubicamos en el local 5 del centro comercial, te esperamos.</p></body></html>',
      'Xela',
    );
    expect(withAddr.get('geo.nap')?.detail).toContain('direccion aparente');
  });

  it('enlaces protocol-relative: instagram social detectado, cdn no cuenta como interno', () => {
    const page =
      '<html><body>' +
      '<a href="//www.instagram.com/marca">IG</a>' +
      '<a href="//cdn.tercero.com/x.js">cdn</a>' +
      '<a href="https://blog.tallerlopez.gt/post">blog</a>' +
      '</body></html>';
    const site = parseSiteHtml(page, { baseHost: 'tallerlopez.gt' });
    expect(site.links.socialHosts).toContain('instagram.com');
    // El subdominio propio cuenta como interno; el cdn de terceros no.
    expect(site.links.internalCount).toBe(1);
  });
});

function geoMapCity(html: string, city: string) {
  const results = runGeoChecks({
    site: parseSiteHtml(html, { baseHost: 'tallerlopez.gt' }),
    robotsTxt: { status: 'missing' },
    llmsTxt: 'missing',
    businessName: 'Taller Lopez',
    city,
  });
  return new Map(results.map((r) => [r.id, r]));
}
