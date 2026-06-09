import { describe, expect, it } from 'vitest';
import { categoryScore, computeScores, deriveFindings, severityFor } from '../scoring.js';
import type { CheckResult } from '../schema.js';

function check(partial: Partial<CheckResult> & Pick<CheckResult, 'id' | 'status'>): CheckResult {
  return {
    category: 'onpage',
    weight: 1,
    title: partial.id,
    detail: 'detalle',
    ...partial,
  };
}

describe('categoryScore', () => {
  it('pondera por peso: un fail pesado baja mas que uno liviano', () => {
    const heavy = categoryScore([
      check({ id: 'a', status: 'fail', weight: 4 }),
      check({ id: 'b', status: 'pass', weight: 1 }),
    ]);
    const light = categoryScore([
      check({ id: 'a', status: 'fail', weight: 1 }),
      check({ id: 'b', status: 'pass', weight: 4 }),
    ]);
    expect(heavy).toBe(20); // 1/5
    expect(light).toBe(80); // 4/5
  });

  it('warn vale medio credito', () => {
    expect(categoryScore([check({ id: 'a', status: 'warn', weight: 2 })])).toBe(50);
  });

  it('excluye na del denominador', () => {
    const score = categoryScore([
      check({ id: 'a', status: 'pass', weight: 3 }),
      check({ id: 'b', status: 'na', weight: 100 }),
    ]);
    expect(score).toBe(100);
  });

  it('devuelve null si todos son na', () => {
    expect(categoryScore([check({ id: 'a', status: 'na' })])).toBeNull();
  });
});

describe('computeScores', () => {
  const baseChecks: CheckResult[] = [
    check({ id: 'onpage.a', category: 'onpage', status: 'pass', weight: 1 }),
    check({ id: 'geo.a', category: 'geo', status: 'fail', weight: 1 }),
    check({ id: 'presence.a', category: 'presence', status: 'warn', weight: 1 }),
  ];

  it('global = 0.4*onpage + 0.4*geo + 0.2*presence', () => {
    const scores = computeScores(baseChecks, { presenceSkipped: false });
    expect(scores).toEqual({ onpage: 100, geo: 0, presence: 50, overall: 50 });
  });

  it('renormaliza a 0.5/0.5 cuando presence se omite', () => {
    const scores = computeScores(baseChecks, { presenceSkipped: true });
    expect(scores.presence).toBeNull();
    expect(scores.overall).toBe(50); // 0.5*100 + 0.5*0
  });
});

describe('severityFor / deriveFindings', () => {
  it('fail con peso >=3 es critical; fail liviano es important; warn es improvement', () => {
    expect(severityFor(check({ id: 'a', status: 'fail', weight: 3 }))).toBe('critical');
    expect(severityFor(check({ id: 'b', status: 'fail', weight: 2 }))).toBe('important');
    expect(severityFor(check({ id: 'c', status: 'warn', weight: 4 }))).toBe('improvement');
    expect(severityFor(check({ id: 'd', status: 'pass', weight: 4 }))).toBeNull();
    expect(severityFor(check({ id: 'e', status: 'na', weight: 4 }))).toBeNull();
  });

  it('ordena por severidad y, dentro de ella, por peso descendente', () => {
    const findings = deriveFindings([
      check({ id: 'warn.light', status: 'warn', weight: 1 }),
      check({ id: 'fail.light', status: 'fail', weight: 2 }),
      check({ id: 'fail.heavy', status: 'fail', weight: 4 }),
      check({ id: 'fail.heavier', status: 'fail', weight: 5 }),
      check({ id: 'ok', status: 'pass', weight: 5 }),
    ]);
    expect(findings.map((f) => f.checkId)).toEqual([
      'fail.heavier',
      'fail.heavy',
      'fail.light',
      'warn.light',
    ]);
  });

  it('usa la recomendacion del check o un fallback', () => {
    const [withRec, withoutRec] = deriveFindings([
      check({ id: 'a', status: 'fail', weight: 1, recommendation: 'Arreglalo asi' }),
      check({ id: 'b', status: 'fail', weight: 1 }),
    ]);
    expect(withRec?.recommendation).toBe('Arreglalo asi');
    expect(withoutRec?.recommendation).toContain('especialista');
  });
});
