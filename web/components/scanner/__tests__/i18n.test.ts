import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTS, translate } from '../i18n';
import { FILTERS } from '../filters';
import { SCAN_MODES } from '../modes';

const DIR = join(__dirname, '..');

describe('i18n', () => {
  it('español e inglés tienen exactamente las mismas claves', () => {
    expect(Object.keys(DICTS.en).sort()).toEqual(Object.keys(DICTS.es).sort());
  });

  it('toda clave usada en el código existe', () => {
    const used = new Set<string>();
    for (const f of readdirSync(DIR)) {
      if (!/\.(ts|tsx)$/.test(f) || f === 'i18n.tsx') continue;
      const src = readFileSync(join(DIR, f), 'utf8');
      for (const m of src.matchAll(/\bt(?:Ref\.current)?\('([a-z]+\.[A-Za-z0-9.]+)'/g)) used.add(m[1]!);
      for (const m of src.matchAll(/'((?:edit|exp|pdf|img|app|cap)\.[A-Za-z0-9.]+)'/g)) used.add(m[1]!);
    }
    for (const id of FILTERS.map((f) => f.id)) used.add(`filter.${id}`).add(`filterHint.${id}`);
    for (const m of SCAN_MODES) used.add(`mode.${m.id}`);
    for (const p of ['auto', 'carta', 'a4', 'oficio']) used.add(`paper.${p}`);
    for (let i = 0; i < 4; i++) used.add(`edit.corner${i}`);
    const missing = [...used].filter((k) => !(k in DICTS.es));
    expect(missing).toEqual([]);
  });

  it('variables y plurales', () => {
    expect(translate('es', 'cap.captureN', { n: 3 })).toBe('Capturar página 3');
    expect(translate('en', 'cap.captureN', { n: 3 })).toBe('Capture page 3');
    expect(translate('es', 'app.restored', { n: 1 })).toContain('1 página');
    expect(translate('en', 'app.restored', { n: 2 })).toContain('2 pages');
    expect(translate('en', 'no.existe')).toBe('no.existe');
  });
});
