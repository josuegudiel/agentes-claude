import { describe, expect, it } from 'vitest';
import { parseSiteHtml } from '../html.js';
import { isAgentBlocked, parseRobotsGroups, runGeoChecks, type GeoInput } from '../checks/geo.js';

function run(
  html: string,
  overrides?: Partial<GeoInput>,
): Map<string, ReturnType<typeof runGeoChecks>[number]> {
  const results = runGeoChecks({
    site: parseSiteHtml(html),
    robotsTxt: { status: 'missing' },
    llmsTxt: 'missing',
    businessName: 'Taller Lopez',
    city: 'Quetzaltenango',
    ...overrides,
  });
  return new Map(results.map((r) => [r.id, r]));
}

const RICH_PAGE = `<html><head>
  <script type="application/ld+json">{"@type":"AutoRepair","name":"Taller Lopez"}</script>
  <script type="application/ld+json">{"@type":"FAQPage"}</script>
</head><body>
  <h1>Taller Lopez</h1>
  <p>Taller Lopez repara tu carro en zona 3 de Quetzaltenango desde 1995. Mas de 5000 clientes y 4.8 estrellas en 280 reseñas. Llama al 7761-1234.</p>
  <h2>¿Cuanto cuesta el servicio mayor?</h2>
  <p>Desde Q450 segun el modelo.</p>
  <h2>¿Donde estamos?</h2>
  <p>Avenida Las Americas 7-62, zona 3.</p>
</body></html>`;

describe('parseRobotsGroups / isAgentBlocked', () => {
  it('bloqueo directo de un bot', () => {
    const groups = parseRobotsGroups('User-agent: GPTBot\nDisallow: /');
    expect(isAgentBlocked(groups, 'GPTBot')).toBe(true);
    expect(isAgentBlocked(groups, 'PerplexityBot')).toBe(false);
  });

  it('wildcard bloquea a todos salvo que haya grupo especifico que permita', () => {
    const groups = parseRobotsGroups('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:');
    expect(isAgentBlocked(groups, 'PerplexityBot')).toBe(true);
    expect(isAgentBlocked(groups, 'GPTBot')).toBe(false);
  });

  it('agentes apilados comparten reglas del grupo', () => {
    const groups = parseRobotsGroups('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /');
    expect(isAgentBlocked(groups, 'ClaudeBot')).toBe(true);
    expect(isAgentBlocked(groups, 'GPTBot')).toBe(true);
  });

  it('Disallow vacio o de rutas parciales no cuenta como bloqueo total', () => {
    const groups = parseRobotsGroups('User-agent: GPTBot\nDisallow: /admin');
    expect(isAgentBlocked(groups, 'GPTBot')).toBe(false);
  });

  it('ignora comentarios y lineas invalidas', () => {
    const groups = parseRobotsGroups(
      '# bloqueo\nUser-agent: GPTBot # bot de openai\nDisallow: / # todo',
    );
    expect(isAgentBlocked(groups, 'GPTBot')).toBe(true);
  });
});

describe('runGeoChecks', () => {
  it('pagina rica: jsonld_local, qa_structure, direct_answer, citable_data y nap en pass', () => {
    const checks = run(RICH_PAGE);
    expect(checks.get('geo.jsonld_local')?.status).toBe('pass');
    expect(checks.get('geo.qa_structure')?.status).toBe('pass');
    expect(checks.get('geo.direct_answer')?.status).toBe('pass');
    expect(checks.get('geo.citable_data')?.status).toBe('pass');
    expect(checks.get('geo.nap')?.status).toBe('pass');
  });

  it('sin JSON-LD es fail; solo Organization es warn', () => {
    expect(
      run('<html><body><p>hola mundo negocio</p></body></html>').get('geo.jsonld_local')?.status,
    ).toBe('fail');
    const org = run(
      '<html><head><script type="application/ld+json">{"@type":"Organization"}</script></head><body></body></html>',
    );
    expect(org.get('geo.jsonld_local')?.status).toBe('warn');
  });

  it('robots.txt que bloquea un crawler de IA es fail y lo nombra', () => {
    const checks = run(RICH_PAGE, {
      robotsTxt: {
        status: 'ok',
        content: 'User-agent: GPTBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /',
      },
    });
    const result = checks.get('geo.robots_ai_crawlers');
    expect(result?.status).toBe('fail');
    expect(result?.detail).toContain('GPTBot');
    expect(result?.detail).toContain('PerplexityBot');
  });

  it('robots.txt ausente es pass (nada bloqueado) y error de red es na', () => {
    expect(
      run(RICH_PAGE, { robotsTxt: { status: 'missing' } }).get('geo.robots_ai_crawlers')?.status,
    ).toBe('pass');
    expect(
      run(RICH_PAGE, { robotsTxt: { status: 'error' } }).get('geo.robots_ai_crawlers')?.status,
    ).toBe('na');
  });

  it('robots.txt permisivo es pass', () => {
    const checks = run(RICH_PAGE, {
      robotsTxt: { status: 'ok', content: 'User-agent: *\nDisallow: /admin' },
    });
    expect(checks.get('geo.robots_ai_crawlers')?.status).toBe('pass');
  });

  it('sin FAQ ni preguntas es fail en qa_structure', () => {
    const checks = run(
      '<html><body><h1>Negocio</h1><h2>Servicios</h2><p>texto largo de relleno aqui</p></body></html>',
    );
    expect(checks.get('geo.qa_structure')?.status).toBe('fail');
  });

  it('nap incompleto es warn; sin nada es fail', () => {
    const partial = run(
      `<html><body><p>${'Servicio profesional en Quetzaltenango para toda tu familia. '.repeat(5)}</p></body></html>`,
    );
    expect(partial.get('geo.nap')?.status).toBe('warn');
    const nothing = run(
      `<html><body><p>${'Servicio profesional para toda tu familia con calidad garantizada. '.repeat(5)}</p></body></html>`,
    );
    expect(nothing.get('geo.nap')?.status).toBe('fail');
  });

  it('llms.txt presente es pass; ausente es na (nunca penaliza)', () => {
    expect(run(RICH_PAGE, { llmsTxt: 'ok' }).get('geo.llms_txt')?.status).toBe('pass');
    expect(run(RICH_PAGE, { llmsTxt: 'missing' }).get('geo.llms_txt')?.status).toBe('na');
  });
});
