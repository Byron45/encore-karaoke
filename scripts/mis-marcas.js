// Lists your best marks in Encore. Only reads; it changes nothing.
// Open the app (http://localhost:5173), press F12 or Ctrl+Shift+I, go to "Console", paste this whole file and press Enter.
(async () => {
  const marks = JSON.parse(localStorage.getItem('encore.best.v1') || '{}');
  // A database that does not exist yet is not created here: the app must create it with its own structure.
  const db = await new Promise(resolve => { const request = indexedDB.open('encore-library-v1'); request.onupgradeneeded = () => request.transaction.abort(); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null); });
  if (!db) { console.log('Este navegador todavía no tiene datos de Encore.'); return; }
  const titles = {};
  await new Promise(resolve => {
    const cursor = db.transaction('songs').objectStore('songs').openCursor();
    cursor.onsuccess = () => { const item = cursor.result; if (!item) return resolve(); titles[item.value.id] = item.value.title; item.continue(); };
    cursor.onerror = () => resolve();
  });
  db.close();
  const levels = { relaxed: 'Relajada', normal: 'Normal', strict: 'Estricta' };
  console.table(Object.entries(marks).map(([key, points]) => {
    const [version, song, level] = key.split('|');
    const [base, lyrics] = level.split('+');
    return { 'canción': song === 'ejercicio' ? 'Ejercicio incluido' : titles[song] || song, exigencia: (levels[base] || base) + (lyrics ? ' con letra' : ''), puntos: points, escala: version };
  }).sort((a, b) => b.escala.localeCompare(a.escala) || a['canción'].localeCompare(b['canción'])));
})();
