import type { LibrarySong } from './library-model';

const dbName = 'encore-library-v1';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('songs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('No se pudo abrir la biblioteca local. Comprueba que el navegador permite almacenar datos.'));
    request.onblocked = () => reject(new Error('Otra pestaña está bloqueando la biblioteca. Ciérrala y vuelve a intentar.'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('songs', mode);
    const request = operation(tx.objectStore('songs'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(new Error(tx.error?.name === 'QuotaExceededError' ? 'No hay espacio suficiente en el navegador. Libera espacio antes de guardar este audio.' : 'No se pudo guardar o leer la biblioteca local.')); };
    tx.onerror = () => { /* onabort handles transaction failure. */ };
  });
}
export const listSongs = () => transaction('readonly', store => store.getAll()) as Promise<LibrarySong[]>;
export async function saveSong(record: LibrarySong) { await transaction('readwrite', store => store.put(record)); }
export async function removeSong(id: string) { await transaction('readwrite', store => store.delete(id)); }

export async function loadAudio(file: File): Promise<LibrarySong> {
  if (!/\.(mp3|wav|ogg|m4a|flac|webm)$/i.test(file.name)) throw new Error('Selecciona un archivo MP3, WAV, OGG, M4A, FLAC o WebM de audio.');
  if (!file.size || file.size > 30 * 1024 * 1024) throw new Error('El audio debe ocupar entre 1 byte y 30 MB.');
  const bytes = await file.arrayBuffer();
  const context = new AudioContext();
  let duration: number;
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    duration = decoded.duration;
    if (!Number.isFinite(duration) || duration < 1 || duration > 600) throw new Error('Usa un audio de entre 1 segundo y 10 minutos.');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Usa un audio')) throw error;
    throw new Error('El navegador no pudo decodificar este audio. Prueba una copia válida en MP3 o WAV.');
  } finally { await context.close(); }
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { id: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, ''), artist: '', duration, bpm: null, notes: [],
    audio: file, audioName: file.name, audioHash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), updatedAt: new Date().toISOString() };
}
