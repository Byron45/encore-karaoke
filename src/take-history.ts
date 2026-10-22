// Every scored take with the microphone, kept in this browser so a result is not lost when it was not downloaded.
// A database of its own: the song library is never opened or migrated for it.
const dbName = 'encore-takes-v1';
export const MAX_TAKES = 60;

/** One take as listed, with the document "Descargar resultado" would have produced at the time. */
export interface StoredTake {
  id: string; createdAt: string; songId: string; song: string;
  difficulty: string; score: number; transpose: number; phrase?: number;
  // The downloaded result as JSON text: its pitch trace, never any audio.
  document: string;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('No se pudo abrir el historial de intentos de este navegador.'));
    request.onblocked = () => reject(new Error('Otra pestaña está bloqueando el historial. Ciérrala y vuelve a intentar.'));
  });
}
async function run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('takes', mode), request = operation(tx.objectStore('takes'));
    tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
    tx.onabort = () => { db.close(); reject(new Error(tx.error?.name === 'QuotaExceededError' ? 'No hay espacio en el navegador para guardar este intento.' : 'No se pudo leer o guardar el historial de intentos.')); };
    tx.onerror = () => { /* onabort handles transaction failure. */ };
  });
}

/** Newest first. */
export async function listTakes(): Promise<StoredTake[]> {
  const takes = (await run('readonly', store => store.getAll()) as StoredTake[] | undefined) || [];
  return takes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keeps the take and drops the oldest beyond MAX_TAKES. */
export async function saveTake(take: Omit<StoredTake, 'id'>) {
  const id = `${take.createdAt}-${crypto.randomUUID()}`;
  await run('readwrite', store => {
    store.put({ ...take, id });
    const keys = store.index('createdAt').getAllKeys();
    keys.onsuccess = () => { const stale = (keys.result as IDBValidKey[]).slice(0, Math.max(0, keys.result.length - MAX_TAKES)); for (const key of stale) store.delete(key); };
  });
  return id;
}

/** Replaces a kept take, for instance once its lyrics have been checked. Does nothing if it was deleted meanwhile. */
export async function updateTake(id: string, take: Omit<StoredTake, 'id'>) {
  await run('readwrite', store => {
    const existing = store.get(id);
    existing.onsuccess = () => { if (existing.result) store.put({ ...take, id }); };
  });
}

export async function deleteTake(id: string) { await run('readwrite', store => store.delete(id)); }
export async function clearTakes() { await run('readwrite', store => store.clear()); }
