import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Rotation } from '../pages';
import { clearPages, isStorageAvailable, loadPages, savePages, type PersistedPage } from '../storage';

/**
 * Tests de la persistencia en IndexedDB usando fake-indexeddb (implementa
 * la spec completa en memoria). El import 'fake-indexeddb/auto' instala
 * `indexedDB` como global antes de que storage.ts lo use.
 */

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'text/plain' });
}

function pg(text: string, rotation: Rotation = 0): PersistedPage {
  return { blob: blobOf(text), rotation };
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
    await savePages([pg('pagina-1'), pg('pagina-2'), pg('pagina-3')]);
    const loaded = await loadPages();
    expect(loaded).toHaveLength(3);
    expect(await textOf(loaded[0]!.blob)).toBe('pagina-1');
    expect(await textOf(loaded[1]!.blob)).toBe('pagina-2');
    expect(await textOf(loaded[2]!.blob)).toBe('pagina-3');
  });

  it('save es replace-all: un save con menos paginas no deja huerfanas', async () => {
    await savePages([pg('a'), pg('b'), pg('c')]);
    await savePages([pg('solo-esta')]);
    const loaded = await loadPages();
    expect(loaded).toHaveLength(1);
    expect(await textOf(loaded[0]!.blob)).toBe('solo-esta');
  });

  it('save con [] limpia el store', async () => {
    await savePages([pg('x')]);
    await savePages([]);
    expect(await loadPages()).toHaveLength(0);
  });

  it('clearPages vacia el store', async () => {
    await savePages([pg('x'), pg('y')]);
    await clearPages();
    expect(await loadPages()).toHaveLength(0);
  });

  it('loadPages sobre store vacio devuelve []', async () => {
    expect(await loadPages()).toEqual([]);
  });

  it('reordenamiento persiste: guardar en otro orden se refleja al cargar', async () => {
    await savePages([pg('1'), pg('2')]);
    // Simula mover la pagina 2 al frente.
    await savePages([pg('2'), pg('1')]);
    const loaded = await loadPages();
    expect(await textOf(loaded[0]!.blob)).toBe('2');
    expect(await textOf(loaded[1]!.blob)).toBe('1');
  });

  it('conserva el giro de cada pagina', async () => {
    await savePages([pg('a', 90), pg('b', 0), pg('c', 270)]);
    const loaded = await loadPages();
    expect(loaded.map((p) => p.rotation)).toEqual([90, 0, 270]);
  });

  it('sesiones guardadas antes del giro (o con giro invalido) cargan sin girar', async () => {
    await savePages([pg('vieja')]);
    // Simula un registro antiguo sin campo rotation y uno corrupto.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('scanner-db', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      tx.objectStore('pages').put({ id: 0, blob: blobOf('vieja') });
      tx.objectStore('pages').put({ id: 1, blob: blobOf('rara'), rotation: 45 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const loaded = await loadPages();
    expect(loaded.map((p) => p.rotation)).toEqual([0, 0]);
    expect(await textOf(loaded[0]!.blob)).toBe('vieja');
  });
});
