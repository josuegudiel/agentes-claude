/**
 * Persistencia de la sesion en IndexedDB (sobrevive recargas, cierres y el
 * descarte de pestanas en segundo plano de iOS).
 *
 * Esquema (base "scannerfree", v1):
 *   - store "blobs":   { uid, blob }  — cada JPEG / foto se escribe UNA vez.
 *   - store "meta":    clave "session" -> StoredSession (registro chico:
 *                      orden, giro, tamano y miniatura de cada pagina, fotos
 *                      pendientes de editar, nombre y formato de archivo).
 *
 * Por que asi (antes se hacia clear() + reescribir todas las paginas en cada
 * cambio):
 *   - En WebKit (todo iOS), objectStore.clear() borra los registros pero NO
 *     los archivos de los Blobs: cada guardado dejaba una copia huerfana de
 *     cada pagina en disco hasta agotar la cuota. Aqui solo se usa delete()
 *     por registro, que si libera el archivo.
 *   - Girar o reordenar solo reescribe el registro chico, no los JPEG.
 *   - Restaurar no necesita decodificar las fotos (tamano y miniatura estan
 *     en el registro): es instantaneo y no falla por memoria.
 *   - `rev` evita que dos pestanas abiertas se pisen: un guardado con una
 *     revision vieja se rechaza ('conflict') en vez de borrar paginas.
 *
 * La base anterior ("scanner-db") se lee una vez para migrar y luego se
 * borra con deleteDatabase (que en WebKit SI libera los archivos huerfanos).
 */

import { isRotation, type Rotation } from './pages';

export { newUid } from './pages';

const DB_NAME = 'scannerfree';
const DB_VERSION = 1;
const BLOBS = 'blobs';
const META = 'meta';
const SESSION_KEY = 'session';

const LEGACY_DB = 'scanner-db';

export interface SessionPage {
  uid: string;
  rotation: Rotation;
  width: number;
  height: number;
  /** Miniatura (dataURL) sin girar. */
  thumb: string;
}

export interface StoredSession {
  rev: number;
  pages: SessionPage[];
  /** Fotos capturadas que aun no se editaron (uids en el store de blobs). */
  pending: string[];
  filename: string;
  format: string;
}

export interface LoadedSession {
  session: StoredSession;
  /** Blobs de paginas y pendientes, por uid (los que faltan no estan). */
  blobs: Map<string, Blob>;
}

/** Pagina de la base vieja (sin metadatos: hay que decodificarla). */
export interface LegacyPage {
  blob: Blob;
  rotation: Rotation;
}

export interface SaveInput {
  pages: (SessionPage & { blob: Blob })[];
  pending: { uid: string; blob: Blob }[];
  filename: string;
  format: string;
  /** uids que NO se deben borrar aunque no esten en la sesion (deshacer). */
  keep?: Iterable<string>;
}

export function isStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'uid' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Otra pestana con una version nueva de la app quiere actualizar.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open fallo'));
    req.onblocked = () => reject(new Error('indexedDB bloqueado por otra pestana'));
  });
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request fallo'));
  });
}

function isSessionPage(v: unknown): v is SessionPage {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.uid === 'string' &&
    isRotation(p.rotation) &&
    typeof p.width === 'number' &&
    typeof p.height === 'number' &&
    p.width > 0 &&
    p.height > 0 &&
    typeof p.thumb === 'string'
  );
}

function normalizeSession(raw: unknown): StoredSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    rev: typeof r.rev === 'number' && Number.isFinite(r.rev) ? r.rev : 0,
    pages: Array.isArray(r.pages) ? r.pages.filter(isSessionPage) : [],
    pending: Array.isArray(r.pending) ? r.pending.filter((u): u is string => typeof u === 'string') : [],
    filename: typeof r.filename === 'string' ? r.filename : '',
    format: typeof r.format === 'string' ? r.format : '',
  };
}

/**
 * Lee la sesion guardada. null si no hay ninguna. Las paginas cuyo blob
 * falta se reportan igual en `session.pages` (el caller decide); sus blobs
 * simplemente no estan en el Map.
 */
export async function loadSession(): Promise<LoadedSession | null> {
  if (!isStorageAvailable()) return null;
  const db = await openDb();
  try {
    const tx = db.transaction([META, BLOBS], 'readonly');
    const raw = await reqPromise(tx.objectStore(META).get(SESSION_KEY));
    const session = normalizeSession(raw);
    if (!session) return null;
    const blobs = new Map<string, Blob>();
    const want = [...session.pages.map((p) => p.uid), ...session.pending];
    const store = db.transaction(BLOBS, 'readonly').objectStore(BLOBS);
    await Promise.all(
      want.map(async (uid) => {
        const row = (await reqPromise(store.get(uid))) as { uid: string; blob: Blob } | undefined;
        if (row?.blob instanceof Blob) blobs.set(uid, row.blob);
      }),
    );
    return { session, blobs };
  } finally {
    db.close();
  }
}

/** Revision guardada actualmente (0 si no hay sesion). */
export async function currentRev(): Promise<number> {
  if (!isStorageAvailable()) return 0;
  const db = await openDb();
  try {
    const raw = await reqPromise(db.transaction(META, 'readonly').objectStore(META).get(SESSION_KEY));
    return normalizeSession(raw)?.rev ?? 0;
  } finally {
    db.close();
  }
}

export class SessionConflictError extends Error {
  override name = 'SessionConflictError';
}

/**
 * Guarda la sesion si la revision guardada sigue siendo `expectedRev` (la
 * que esta pestana leyo o escribio por ultima vez). Escribe solo los blobs
 * nuevos y borra (registro por registro) los que ya nadie usa. Devuelve la
 * nueva revision. Lanza SessionConflictError si otra pestana guardo antes.
 */
export async function saveSession(input: SaveInput, expectedRev: number): Promise<number> {
  if (!isStorageAvailable()) return expectedRev;
  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction([META, BLOBS], 'readwrite');
      const meta = tx.objectStore(META);
      const blobs = tx.objectStore(BLOBS);
      let newRev = expectedRev;
      let conflict = false;

      tx.oncomplete = () => resolve(newRev);
      tx.onabort = () =>
        reject(conflict ? new SessionConflictError('La sesion cambio en otra pestana') : (tx.error ?? new Error('transaccion abortada')));
      tx.onerror = () => {
        /* se resuelve en onabort */
      };

      const getReq = meta.get(SESSION_KEY);
      getReq.onsuccess = () => {
        const stored = normalizeSession(getReq.result);
        const storedRev = stored?.rev ?? 0;
        if (storedRev !== expectedRev) {
          conflict = true;
          tx.abort();
          return;
        }
        const keysReq = blobs.getAllKeys();
        keysReq.onsuccess = () => {
          const existing = new Set(keysReq.result as string[]);
          const needed = new Set<string>();
          for (const p of input.pages) {
            needed.add(p.uid);
            if (!existing.has(p.uid)) blobs.put({ uid: p.uid, blob: p.blob });
          }
          for (const p of input.pending) {
            needed.add(p.uid);
            if (!existing.has(p.uid)) blobs.put({ uid: p.uid, blob: p.blob });
          }
          const keep = new Set(input.keep ?? []);
          for (const uid of existing) {
            if (!needed.has(uid) && !keep.has(uid)) blobs.delete(uid);
          }
          newRev = storedRev + 1;
          const session: StoredSession = {
            rev: newRev,
            pages: input.pages.map(({ uid, rotation, width, height, thumb }) => ({ uid, rotation, width, height, thumb })),
            pending: input.pending.map((p) => p.uid),
            filename: input.filename,
            format: input.format,
          };
          meta.put(session, SESSION_KEY);
        };
      };
    });
  } finally {
    db.close();
  }
}

/** Borra toda la sesion (registro por registro: libera los archivos en WebKit). */
export async function clearSession(): Promise<void> {
  if (!isStorageAvailable()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META, BLOBS], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('transaccion abortada'));
      const blobs = tx.objectStore(BLOBS);
      const keysReq = blobs.getAllKeys();
      keysReq.onsuccess = () => {
        for (const k of keysReq.result) blobs.delete(k);
      };
      tx.objectStore(META).delete(SESSION_KEY);
    });
  } finally {
    db.close();
  }
}

/**
 * Paginas de la base anterior ("scanner-db"), si existe. No la crea si no
 * existe (aborta la creacion).
 */
export async function loadLegacyPages(): Promise<LegacyPage[]> {
  if (!isStorageAvailable()) return [];
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(LEGACY_DB);
    req.onupgradeneeded = (e) => {
      // oldVersion 0: no existia. Abortar para no crearla (onerror -> null).
      if (e.oldVersion === 0) req.transaction?.abort();
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  if (!db) return [];
  try {
    if (!db.objectStoreNames.contains('pages')) return [];
    const rows = (await reqPromise(db.transaction('pages', 'readonly').objectStore('pages').getAll())) as {
      id: number;
      blob: unknown;
      rotation?: unknown;
    }[];
    return rows
      .filter((r) => r.blob instanceof Blob)
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ blob: r.blob as Blob, rotation: isRotation(r.rotation) ? r.rotation : 0 }));
  } finally {
    db.close();
  }
}

/** Borra la base anterior (libera tambien los archivos huerfanos de WebKit). */
export function deleteLegacyDb(): Promise<void> {
  if (!isStorageAvailable()) return Promise.resolve();
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
