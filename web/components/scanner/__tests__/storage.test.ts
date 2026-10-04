import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rotation } from '../pages';
import {
  SessionConflictError,
  clearSession,
  deleteLegacyDb,
  isStorageAvailable,
  loadLegacyPages,
  loadSession,
  saveSession,
  type SaveInput,
} from '../storage';

/**
 * Tests de la persistencia en IndexedDB usando fake-indexeddb (implementa
 * la spec completa en memoria). El import 'fake-indexeddb/auto' instala
 * `indexedDB` como global antes de que storage.ts lo use.
 */

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'text/plain' });
}

function page(uid: string, rotation: Rotation = 0, text = uid): SaveInput['pages'][number] {
  return { uid, rotation, width: 30, height: 40, thumb: `data:${uid}`, blob: blobOf(text) };
}

function input(pages: SaveInput['pages'], extra: Partial<SaveInput> = {}): SaveInput {
  return { pages, pending: [], filename: 'f', format: 'pdf', ...extra };
}

let rev = 0;
async function save(i: SaveInput): Promise<number> {
  rev = await saveSession(i, rev);
  return rev;
}

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function blobKeys(): Promise<string[]> {
  const db = await openRaw('scannerfree');
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]).sort());
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  await clearSession();
  // Deja la revision guardada en un valor conocido.
  const loaded = await loadSession();
  rev = loaded?.session.rev ?? 0;
});

describe('storage', () => {
  it('isStorageAvailable true con fake-indexeddb instalado', () => {
    expect(isStorageAvailable()).toBe(true);
  });

  it('guarda y carga orden, giro, metadatos, nombre y formato', async () => {
    await save(input([page('a', 90), page('b'), page('c', 270)], { filename: 'Boletín', format: 'jpg' }));
    const loaded = await loadSession();
    expect(loaded).not.toBeNull();
    const s = loaded!.session;
    expect(s.pages.map((p) => p.uid)).toEqual(['a', 'b', 'c']);
    expect(s.pages.map((p) => p.rotation)).toEqual([90, 0, 270]);
    expect(s.pages[0]).toMatchObject({ width: 30, height: 40, thumb: 'data:a' });
    expect(s.filename).toBe('Boletín');
    expect(s.format).toBe('jpg');
    expect(await loaded!.blobs.get('b')!.text()).toBe('b');
  });

  it('reordenar o girar no reescribe los JPEG (cada blob se escribe una vez)', async () => {
    await save(input([page('a', 0, 'original-a'), page('b')]));
    // Mismo uid con otro contenido: NO debe sobrescribirse (el JPEG es inmutable).
    await save(input([page('b'), page('a', 180, 'otro-contenido')]));
    const loaded = await loadSession();
    expect(loaded!.session.pages.map((p) => p.uid)).toEqual(['b', 'a']);
    expect(loaded!.session.pages[1]!.rotation).toBe(180);
    expect(await loaded!.blobs.get('a')!.text()).toBe('original-a');
  });

  it('borra (registro por registro) los blobs que ya nadie usa, nunca con clear()', async () => {
    const clearSpy = vi.spyOn(IDBObjectStore.prototype, 'clear');
    await save(input([page('a'), page('b'), page('c')]));
    await save(input([page('b')]));
    expect(await blobKeys()).toEqual(['b']);
    await save(input([]));
    expect(await blobKeys()).toEqual([]);
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('conserva los blobs de paginas en la pila de deshacer (keep)', async () => {
    await save(input([page('a'), page('b')]));
    await save(input([page('a')], { keep: ['b'] }));
    expect(await blobKeys()).toEqual(['a', 'b']);
  });

  it('guarda las fotos pendientes de editar', async () => {
    await save(input([page('a')], { pending: [{ uid: 'p1', blob: blobOf('foto') }] }));
    const loaded = await loadSession();
    expect(loaded!.session.pending).toEqual(['p1']);
    expect(await loaded!.blobs.get('p1')!.text()).toBe('foto');
  });

  it('otra pestana con revision vieja no pisa la sesion (SessionConflictError)', async () => {
    const r1 = await save(input([page('a'), page('b'), page('c')]));
    // "Pestana B" leyo r1; "pestana A" guarda despues.
    await saveSession(input([page('a'), page('b'), page('c'), page('d')]), r1);
    await expect(saveSession(input([page('a')]), r1)).rejects.toBeInstanceOf(SessionConflictError);
    const loaded = await loadSession();
    expect(loaded!.session.pages.map((p) => p.uid)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sin sesion guardada, loadSession devuelve null', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('migra la base anterior (scanner-db) y luego la borra', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('scanner-db', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('pages', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      tx.objectStore('pages').put({ id: 1, blob: blobOf('segunda'), rotation: 90 });
      tx.objectStore('pages').put({ id: 0, blob: blobOf('primera') });
      tx.objectStore('pages').put({ id: 2, blob: blobOf('rara'), rotation: 45 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const legacy = await loadLegacyPages();
    expect(await Promise.all(legacy.map((p) => p.blob.text()))).toEqual(['primera', 'segunda', 'rara']);
    expect(legacy.map((p) => p.rotation)).toEqual([0, 90, 0]);
    await deleteLegacyDb();
    expect(await loadLegacyPages()).toEqual([]);
  });

  it('loadLegacyPages no crea la base vieja si no existia', async () => {
    await deleteLegacyDb();
    expect(await loadLegacyPages()).toEqual([]);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain('scanner-db');
  });
});
