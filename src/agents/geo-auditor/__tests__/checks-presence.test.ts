import { describe, expect, it } from 'vitest';
import { runPresenceChecks, type PresenceInput } from '../checks/presence.js';
import type { TavilySearchResult } from '../schema.js';

function result(partial: Partial<TavilySearchResult>): TavilySearchResult {
  return { title: 'Resultado', url: 'https://otro.com/x', content: '', ...partial };
}

function run(results: TavilySearchResult[], overrides?: Partial<PresenceInput>) {
  const checks = runPresenceChecks({
    businessName: 'Taller Lopez',
    city: 'Quetzaltenango',
    ownHost: 'tallerlopez.gt',
    results,
    ...overrides,
  });
  return new Map(checks.map((c) => [c.id, c]));
}

describe('runPresenceChecks', () => {
  it('negocio bien presente: todos pass', () => {
    const checks = run([
      result({ title: 'Taller Lopez', url: 'https://www.google.com/maps/place/taller-lopez' }),
      result({
        title: 'Taller Lopez - Yelp',
        url: 'https://www.yelp.com/biz/taller-lopez',
        content: 'Taller Lopez',
      }),
      result({
        title: 'Taller Lopez en Facebook',
        url: 'https://facebook.com/tallerlopez',
        content: 'Taller Lopez',
      }),
      result({
        title: 'Los 10 mejores talleres de Quetzaltenango',
        url: 'https://blogxela.com/mejores-talleres',
        content: 'Incluye a Taller Lopez entre los destacados',
      }),
    ]);
    expect(checks.get('presence.gbp')?.status).toBe('pass');
    expect(checks.get('presence.mentions')?.status).toBe('pass');
    expect(checks.get('presence.reviews')?.status).toBe('pass');
    expect(checks.get('presence.bestof')?.status).toBe('pass');
  });

  it('sin resultados externos: mentions fail, el resto warn (no confirmable)', () => {
    const checks = run([]);
    expect(checks.get('presence.gbp')?.status).toBe('warn');
    expect(checks.get('presence.mentions')?.status).toBe('fail');
    expect(checks.get('presence.reviews')?.status).toBe('warn');
    expect(checks.get('presence.bestof')?.status).toBe('warn');
  });

  it('excluye el dominio propio de las menciones de terceros', () => {
    const checks = run([
      result({
        title: 'Taller Lopez',
        url: 'https://tallerlopez.gt/nosotros',
        content: 'Taller Lopez',
      }),
      result({
        title: 'Taller Lopez recomendado',
        url: 'https://foro.gt/post',
        content: 'Taller Lopez es bueno',
      }),
    ]);
    expect(checks.get('presence.mentions')?.status).toBe('warn'); // solo 1 externa
  });

  it('lista "best of" requiere ciudad y nombre del negocio', () => {
    const checks = run([
      result({
        title: 'Los mejores talleres de Ciudad de Guatemala',
        url: 'https://blog.gt/mejores',
        content: 'No menciona al negocio buscado',
      }),
    ]);
    expect(checks.get('presence.bestof')?.status).toBe('warn');
  });
});
