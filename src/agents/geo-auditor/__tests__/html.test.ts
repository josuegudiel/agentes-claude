import { describe, expect, it } from 'vitest';
import { parseSiteHtml } from '../html.js';

const FULL_PAGE = `<!doctype html>
<html>
<head>
  <title>  Taller Lopez — Mecanica en Xela  </title>
  <meta name="description" content="Taller mecanico con 20 años de experiencia en Quetzaltenango.">
  <link rel="canonical" href="https://tallerlopez.gt/">
  <meta property="og:title" content="Taller Lopez">
  <meta property="og:image" content="https://tallerlopez.gt/img/local.jpg">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"AutoRepair","name":"Taller Lopez"}
  </script>
  <script type="application/ld+json">{ esto no es json valido</script>
  <style>body { color: red; }</style>
</head>
<body>
  <h1>Taller Lopez</h1>
  <h2>¿Cuanto cuesta un servicio?</h2>
  <p>Atendemos en zona 3 de Quetzaltenango. Llama al 7761-1234.</p>
  <img src="a.jpg" alt="Fachada del taller">
  <img src="b.jpg">
  <img src="c.jpg" alt="  ">
  <script>console.log('texto que no debe contarse');</script>
</body>
</html>`;

describe('parseSiteHtml', () => {
  const site = parseSiteHtml(FULL_PAGE);

  it('extrae title, meta description y canonical normalizados', () => {
    expect(site.title).toBe('Taller Lopez — Mecanica en Xela');
    expect(site.metaDescription).toContain('20 años');
    expect(site.canonical).toBe('https://tallerlopez.gt/');
  });

  it('extrae og tags en minusculas', () => {
    expect(site.ogTags['og:title']).toBe('Taller Lopez');
    expect(site.ogTags['og:image']).toContain('local.jpg');
    expect(site.ogTags['og:description']).toBeUndefined();
  });

  it('extrae headings con nivel', () => {
    expect(site.headings).toEqual([
      { level: 1, text: 'Taller Lopez' },
      { level: 2, text: '¿Cuanto cuesta un servicio?' },
    ]);
  });

  it('cuenta imagenes sin alt (alt vacio cuenta como faltante)', () => {
    expect(site.imgCount).toBe(3);
    expect(site.imgsWithoutAlt).toBe(2);
  });

  it('parsea JSON-LD valido y cuenta los bloques rotos', () => {
    expect(site.jsonLd).toHaveLength(1);
    expect(site.jsonLd[0]?.types).toEqual(['AutoRepair']);
    expect(site.jsonLdErrors).toBe(1);
  });

  it('extrae texto visible sin scripts ni estilos', () => {
    expect(site.visibleText).toContain('zona 3 de Quetzaltenango');
    expect(site.visibleText).not.toContain('console.log');
    expect(site.visibleText).not.toContain('color: red');
  });

  it('aplana @type dentro de @graph y arrays', () => {
    const graph = parseSiteHtml(`<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"X"},
        {"@type":["LocalBusiness","Restaurant"],"name":"Y"}
      ]}
    </script></head><body></body></html>`);
    expect(graph.jsonLd[0]?.types).toEqual(['Organization', 'LocalBusiness', 'Restaurant']);
  });

  it('tolera paginas vacias', () => {
    const empty = parseSiteHtml('<html><body></body></html>');
    expect(empty.title).toBeNull();
    expect(empty.metaDescription).toBeNull();
    expect(empty.headings).toEqual([]);
    expect(empty.visibleText).toBe('');
  });
});
