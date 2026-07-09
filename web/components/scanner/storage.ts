/**
 * Persistencia de paginas escaneadas en IndexedDB. Las paginas sobreviven
 * refresh y cierre del browser — al volver a /scanner se restauran.
 *
 * Estrategia replace-all: cada save borra el store y escribe todas las
 * paginas con su indice como key. Con <100 paginas de ~500KB es mas que
 * suficiente y elimina toda la clase de bugs de sincronizacion
 * incremental (paginas huerfanas, orden desfasado).
 *
 * Guardamos Blobs JPEG (no dataURLs): IndexedDB almacena Blobs nativos
 * sin el overhead ~33% de base64.
 */

const DB_NAME = 'scanner-db';
const DB_VERSION = 1;
const STORE = 'pages';

interface StoredPage {
  id: number;
  blob: Blob;
}

export function isStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open fallo'));
    req.onblocked = () => reject(new Error('indexedDB bloqueado por otra pestana'));
  });
}

/** Ejecuta `fn` dentro de una transaccion y espera a que complete. */
function runTx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaccion fallo'));
    tx.onabort = () => reject(tx.error ?? new Error('transaccion abortada'));
    fn(tx.objectStore(STORE));
  });
}

export async function savePages(blobs: Blob[]): Promise<void> {
  if (!isStorageAvailable()) return;
  const db = await openDb();
  try {
    await runTx(db, 'readwrite', (store) => {
      store.clear();
      blobs.forEach((blob, i) => {
        const page: StoredPage = { id: i, blob };
        store.put(page);
      });
    });
  } finally {
    db.close();
  }
}

export async function loadPages(): Promise<Blob[]> {
  if (!isStorageAvailable()) return [];
  const db = await openDb();
  try {
    const rows = await new Promise<StoredPage[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredPage[]);
      req.onerror = () => reject(req.error ?? new Error('getAll fallo'));
    });
    return rows.sort((a, b) => a.id - b.id).map((r) => r.blob);
  } finally {
    db.close();
  }
}

export async function clearPages(): Promise<void> {
  if (!isStorageAvailable()) return;
  const db = await openDb();
  try {
    await runTx(db, 'readwrite', (store) => {
      store.clear();
    });
  } finally {
    db.close();
  }
}
