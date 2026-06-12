import { describe, expect, it } from 'vitest';
import { appendEntry, deltaFor, normalizeKey, type AuditHistoryEntry } from '../auditor-history';

function entry(partial: Partial<AuditHistoryEntry>): AuditHistoryEntry {
  return {
    ts: 1,
    url: 'negocio.gt',
    businessName: 'Negocio',
    city: 'Xela',
    scores: { onpage: 50, geo: 50, presence: null, overall: 50 },
    ...partial,
  };
}

describe('normalizeKey', () => {
  it('quita www, protocolo y slash final', () => {
    expect(normalizeKey('https://www.Negocio.GT/')).toBe('negocio.gt');
    expect(normalizeKey('https://negocio.gt/servicios/')).toBe('negocio.gt/servicios');
  });

  it('tolera strings que no son URL', () => {
    expect(normalizeKey('no-es-url')).toBe('no-es-url');
  });
});

describe('appendEntry', () => {
  it('devuelve la entrada anterior del mismo sitio', () => {
    const first = entry({ ts: 1, scores: { onpage: 10, geo: 10, presence: null, overall: 10 } });
    const { list } = appendEntry([], first);
    const second = entry({ ts: 2, scores: { onpage: 60, geo: 60, presence: null, overall: 60 } });
    const result = appendEntry(list, second);
    expect(result.previous?.ts).toBe(1);
    expect(result.list).toHaveLength(2);
  });

  it('no cruza sitios distintos', () => {
    const { list } = appendEntry([], entry({ ts: 1, url: 'otro.gt' }));
    const result = appendEntry(list, entry({ ts: 2, url: 'negocio.gt' }));
    expect(result.previous).toBeNull();
  });

  it('respeta el tope de 30 entradas', () => {
    let list: AuditHistoryEntry[] = [];
    for (let i = 0; i < 35; i++) {
      list = appendEntry(list, entry({ ts: i })).list;
    }
    expect(list).toHaveLength(30);
    expect(list[0]?.ts).toBe(5);
  });
});

describe('deltaFor', () => {
  it('calcula el delta vs la auditoria anterior del mismo sitio', () => {
    const a = entry({ ts: 1, scores: { onpage: 10, geo: 10, presence: null, overall: 19 } });
    const b = entry({ ts: 2, scores: { onpage: 70, geo: 70, presence: null, overall: 64 } });
    const list = [a, b];
    expect(deltaFor(list, b)).toBe(45);
    expect(deltaFor(list, a)).toBeNull(); // la primera no tiene contra que comparar
  });
});
