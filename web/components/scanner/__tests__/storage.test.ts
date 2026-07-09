import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPages, isStorageAvailable, loadPages, savePages } from '../storage';

/**
 * Tests de la persistencia en IndexedDB usando fake-indexeddb (implementa
 * la spec completa en memoria). El import 'fake-indexeddb/auto' instala
 * `indexedDB` como global antes de que storage.ts lo use.
 */

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'text/plain' });
}

async function textOf(blob: Blob): Promise<string> {
  return blob.text();
}

beforeEach(async () => {
  await clearPages();
});

describe('storage', () => {
  it('isStorageAvailable true con fake-indexeddb instalado', () => {
    expect(isStorageAvailable()).toBe(true);
  });

  it('savePages + loadPages preserva contenido y orden', async () => {
    await savePages([blobOf('pagina-1'), blobOf('pagina-2'), blobOf('pagina-3')]);
    const loaded = await loadPages();
    expect(loaded).toHaveLength(3);
    expect(await textOf(loaded[0]!)).toBe('pagina-1');
    expect(await textOf(loaded[1]!)).toBe('pagina-2');
    expect(await textOf(loaded[2]!)).toBe('pagina-3');
  });

  it('save es replace-all: un save con menos paginas no deja huerfanas', async () => {
    await savePages([blobOf('a'), blobOf('b'), blobOf('c')]);
    await savePages([blobOf('solo-esta')]);
    const loaded = await loadPages();
    expect(loaded).toHaveLength(1);
    expect(await textOf(loaded[0]!)).toBe('solo-esta');
  });

  it('save con [] limpia el store', async () => {
    await savePages([blobOf('x')]);
    await savePages([]);
    expect(await loadPages()).toHaveLength(0);
  });

  it('clearPages vacia el store', async () => {
    await savePages([blobOf('x'), blobOf('y')]);
    await clearPages();
    expect(await loadPages()).toHaveLength(0);
  });

  it('loadPages sobre store vacio devuelve []', async () => {
    expect(await loadPages()).toEqual([]);
  });

  it('reordenamiento persiste: guardar en otro orden se refleja al cargar', async () => {
    await savePages([blobOf('1'), blobOf('2')]);
    // Simula mover la pagina 2 al frente.
    await savePages([blobOf('2'), blobOf('1')]);
    const loaded = await loadPages();
    expect(await textOf(loaded[0]!)).toBe('2');
    expect(await textOf(loaded[1]!)).toBe('1');
  });
});
