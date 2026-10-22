// Lists the takes Encore keeps in this browser ("Tus intentos guardados"). Only reads; it changes nothing.
// Open the app (http://localhost:5173), press F12 or Ctrl+Shift+I, go to "Console", paste this whole file and press Enter.
(async () => {
  // A database that does not exist yet is not created here: the app must create it with its own structure.
  const db = await new Promise(resolve => { const request = indexedDB.open('encore-takes-v1'); request.onupgradeneeded = () => request.transaction.abort(); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null); });
  if (!db) { console.log('Este navegador todavía no tiene datos de Encore.'); return; }
  if (!db.objectStoreNames.contains('takes')) { db.close(); console.log('Este navegador todavía no tiene intentos guardados.'); return; }
  const takes = await new Promise(resolve => { const request = db.transaction('takes').objectStore('takes').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve([]); });
  db.close();
  const levels = { relaxed: 'Relajada', normal: 'Normal', strict: 'Estricta' };
  console.table(takes.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(take => {
    const document = JSON.parse(take.document);
    return { fecha: new Date(take.createdAt).toLocaleString('es-EC'), 'canción': take.song, exigencia: levels[take.difficulty] || take.difficulty, puntos: take.score, letra: document.lyrics ? `${Math.round(document.lyrics.score * 100)} %` : '—', ensayo: take.phrase === undefined ? '' : `frase ${take.phrase + 1}` };
  }));
})();
