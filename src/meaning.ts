import { meaningText, textKey } from './song-search';
import type { SongFacets } from './song-search';

// Meaning vectors of the library's songs, kept in a database of their own so each song is embedded once.
const dbName = 'encore-search-v1';
interface Stored { id: string; key: string; model: string; vector: number[] }

async function answer(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'El servidor local no respondió.');
  return data;
}

/** Whether this computer's server has the meaning model. */
export async function canSearchMeaning(signal?: AbortSignal) {
  try { return (await answer(await fetch('/api/preparation/meaning', { signal }))).available === true; } catch { return false; }
}

async function embed(kind: 'query' | 'passage', texts: string[], signal?: AbortSignal): Promise<{ model: string; vectors: number[][] }> {
  const { token } = await answer(await fetch('/api/preparation/meaning', { signal }));
  return answer(await fetch('/api/preparation/meaning', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Encore-Token': token }, body: JSON.stringify({ kind, texts }), signal }));
}

export async function queryVector(text: string, signal?: AbortSignal) {
  return (await embed('query', [text.slice(0, 500)], signal)).vectors[0];
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('meaning', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('No se pudo abrir el índice de búsqueda del navegador.'));
  });
}
async function stored(): Promise<Stored[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('meaning').objectStore('meaning').getAll();
    request.onsuccess = () => { db.close(); resolve(request.result as Stored[]); };
    request.onerror = () => { db.close(); reject(new Error('No se pudo leer el índice de búsqueda.')); };
  });
}
async function store(items: Stored[]) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('meaning', 'readwrite');
    for (const item of items) tx.objectStore('meaning').put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(new Error('No se pudo guardar el índice de búsqueda.')); };
  });
}

/** The vector of every song, embedding only the songs that are new or changed since the last search. */
export async function songVectors(songs: SongFacets[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void) {
  const known = new Map((await stored().catch(() => [])).map(item => [item.id, item]));
  const result = new Map<string, number[]>(), missing: { song: SongFacets; key: string }[] = [];
  for (const song of songs) {
    const key = textKey(meaningText(song)), item = known.get(song.id);
    if (item && item.key === key) result.set(song.id, item.vector); else missing.push({ song, key });
  }
  for (let i = 0; i < missing.length; i += 16) {
    onProgress?.(i, missing.length);
    const batch = missing.slice(i, i + 16), { model, vectors } = await embed('passage', batch.map(({ song }) => meaningText(song)), signal);
    const items = batch.map(({ song, key }, k) => ({ id: song.id, key, model, vector: vectors[k] }));
    await store(items).catch(() => {});
    for (const item of items) result.set(item.id, item.vector);
  }
  return result;
}
