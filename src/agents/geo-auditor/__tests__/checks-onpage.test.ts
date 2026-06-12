import { describe, expect, it } from 'vitest';
import { parseSiteHtml } from '../html.js';
import { runOnpageChecks, type OnpageInput } from '../checks/onpage.js';

function run(
  html: string,
  overrides?: Partial<OnpageInput>,
): Map<string, ReturnType<typeof runOnpageChecks>[number]> {
  const results = runOnpageChecks({
    site: parseSiteHtml(html),
    finalUrl: 'https://negocio.gt/',
    sitemap: 'ok',
    ...overrides,
  });
  return new Map(results.map((r) => [r.id, r]));
}

const GOOD_PAGE = `<html><head>
  <title>Clinica Dental Sonrisa — Dentista en Antigua Guatemala</title>
  <meta name="description" content="Clinica dental en Antigua Guatemala con ortodoncia, limpieza e implantes. Agenda tu cita hoy mismo con nosotros.">
  <link rel="canonical" href="https://negocio.gt/">
  <meta property="og:title" content="Clinica Dental Sonrisa">
  <meta property="og:description" content="Dentista en Antigua">
</head><body>
  <h1>Clinica Dental Sonrisa</h1>
  <h2>Servicios</h2>
  <p>${'Atendemos pacientes con ortodoncia, limpieza dental e implantes en Antigua Guatemala. '.repeat(12)}</p>
  <img src="a.jpg" alt="Clinica">
</body></html>`;

describe('runOnpageChecks', () => {
  it('pagina bien armada: todo pass', () => {
    const checks = run(GOOD_PAGE);
    for (const id of [
      'onpage.https',
      'onpage.title',
      'onpage.meta_description',
      'onpage.h1',
      'onpage.heading_structure',
      'onpage.canonical',
      'onpage.og',
      'onpage.img_alt',
      'onpage.text_ratio',
      'onpage.sitemap',
    ]) {
      expect(checks.get(id)?.status, id).toBe('pass');
    }
  });

  it('http sin cifrar es fail', () => {
    const checks = run(GOOD_PAGE, { finalUrl: 'http://negocio.gt/' });
    expect(checks.get('onpage.https')?.status).toBe('fail');
  });

  it('title ausente es fail; title corto es warn', () => {
    expect(run('<html><body><p>hola</p></body></html>').get('onpage.title')?.status).toBe('fail');
    expect(
      run('<html><head><title>Inicio</title></head><body></body></html>').get('onpage.title')
        ?.status,
    ).toBe('warn');
  });

  it('meta description ausente es fail', () => {
    const checks = run(
      '<html><head><title>Negocio local de prueba</title></head><body></body></html>',
    );
    expect(checks.get('onpage.meta_description')?.status).toBe('fail');
  });

  it('sin H1 es fail; H1 duplicado es warn', () => {
    expect(run('<html><body><h2>Solo h2</h2></body></html>').get('onpage.h1')?.status).toBe('fail');
    expect(run('<html><body><h1>Uno</h1><h1>Dos</h1></body></html>').get('onpage.h1')?.status).toBe(
      'warn',
    );
  });

  it('imagenes sin alt: minoria warn, mayoria fail, sin imagenes na', () => {
    const minority = run('<html><body><img alt="a"><img alt="b"><img alt="c"><img></body></html>');
    expect(minority.get('onpage.img_alt')?.status).toBe('warn');
    const majority = run('<html><body><img><img><img alt="a"></body></html>');
    expect(majority.get('onpage.img_alt')?.status).toBe('fail');
    const none = run('<html><body><p>sin imagenes</p></body></html>');
    expect(none.get('onpage.img_alt')?.status).toBe('na');
  });

  it('pagina JS-only (casi sin texto) es fail en text_ratio', () => {
    const checks = run('<html><body><div id="root"></div><script>app()</script></body></html>');
    expect(checks.get('onpage.text_ratio')?.status).toBe('fail');
    expect(checks.get('onpage.text_ratio')?.detail).toContain('JavaScript');
  });

  it('sitemap missing es warn y error de red es na', () => {
    expect(run(GOOD_PAGE, { sitemap: 'missing' }).get('onpage.sitemap')?.status).toBe('warn');
    expect(run(GOOD_PAGE, { sitemap: 'error' }).get('onpage.sitemap')?.status).toBe('na');
  });
});
