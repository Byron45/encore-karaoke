import { summarizeTake } from './progress';
import type { TakeSummary } from './progress';

// Every scored take with the microphone, kept in this browser so a result is not lost when it was not downloaded.
// A database of its own: the song library is never opened or migrated for it.
const dbName = 'encore-takes-v1';
// Full results kept to download again. Older takes keep only their summary, for the progress view, up to MAX_SUMMARIES.
export const MAX_TAKES = 60, MAX_SUMMARIES = 2000;

/** One take as listed, with the document "Descargar resultado" would have produced at the time. */
export interface StoredTake {
  id: string; createdAt: string; songId: string; song: string;
  difficulty: string; score: number; transpose: number; phrase?: number;
  // The downloaded result as JSON text: its pitch trace, never any audio. Empty once the take is only a summary.
  document: string;
  // What the progress view needs; takes saved before it existed get it from their document when read.
  summary?: TakeSummary;
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

const all = async () => ((await run('readonly', store => store.getAll()) as StoredTake[] | undefined) || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Takes that can still be downloaded, newest first. */
export async function listTakes(): Promise<StoredTake[]> {
  return (await all()).filter(take => take.document);
}

/** The summary of every take kept, full or summary only, newest first. */
export async function listSummaries(): Promise<TakeSummary[]> {
  return (await all()).flatMap(take => {
    if (take.summary) return [take.summary];
    try { return [summarizeTake(JSON.parse(take.document), take)]; } catch { return []; }
  });
}

/** Keeps the take; beyond MAX_TAKES the oldest keep only their summary, and beyond MAX_SUMMARIES they go. */
export async function saveTake(take: Omit<StoredTake, 'id'>) {
  const id = `${take.createdAt}-${crypto.randomUUID()}`;
  await run('readwrite', store => {
    store.put({ ...take, id });
    const cursor = store.index('createdAt').openCursor(null, 'prev');
    let seen = 0;
    cursor.onsuccess = () => {
      const item = cursor.result; if (!item) return;
      const stored = item.value as StoredTake;
      seen++;
      if (seen > MAX_SUMMARIES) item.delete();
      else if (seen > MAX_TAKES && stored.document) {
        let summary = stored.summary;
        try { summary ??= summarizeTake(JSON.parse(stored.document), stored); } catch { /* A take that cannot be read keeps no summary. */ }
        item.update({ ...stored, document: '', ...(summary ? { summary } : {}) });
      }
      item.continue();
    };
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
/** Every take, full and summary only: the progress view starts again from nothing. */
export async function clearTakes() { await run('readwrite', store => store.clear()); }
