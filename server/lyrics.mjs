export function createLyricsService({ fetcher = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const cache = new Map(), pending = new Map();
  let tail = Promise.resolve(), lastStart = -Infinity;
  return async function query({ id, title, artist = '' }) {
    const url = new URL('https://lrclib.net/api/search');
    if (id !== undefined && id !== null) {
      if (!/^[1-9]\d{0,11}$/.test(String(id))) throw Object.assign(new Error('Registro LRCLIB no válido.'), { status: 400 });
      url.pathname = `/api/get/${id}`;
    } else {
      if (typeof title !== 'string' || title.trim().length < 2 || title.length > 160 || typeof artist !== 'string' || artist.length > 160) throw Object.assign(new Error('Escribe título y artista de hasta 160 caracteres (título mínimo 2).'), { status: 400 });
      url.searchParams.set('track_name', title.trim());
      if (artist.trim()) url.searchParams.set('artist_name', artist.trim());
    }
    const key = url.href, hit = cache.get(key);
    if (hit && now() - hit.time < 900000) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 8) throw Object.assign(new Error('Hay búsquedas en espera. Intenta de nuevo en unos segundos.'), { status: 429 });
    const job = tail.then(async () => {
      const wait = 1000 - (now() - lastStart); if (wait > 0) await sleep(wait);
      lastStart = now();
      let response;
      try { response = await fetcher(url, { headers: { 'User-Agent': 'EncoreKaraoke/0.2.1 (personal local prototype)', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); }
      catch { throw new Error('No se pudo conectar con LRCLIB. Puedes pegar la letra completa mientras tanto.'); }
      if (response.status === 404) return [];
      if (!response.ok) throw new Error('LRCLIB no está disponible ahora. Prueba más tarde o pega la letra.');
      const data = await response.json();
      const items = Array.isArray(data) ? data : [data];
      const value = items.filter(item => item && Number.isSafeInteger(item.id) && item.id > 0 && typeof item.trackName === 'string' && Number.isFinite(item.duration) && item.duration > 0)
        .slice(0, 30).map(item => ({ id: item.id, title: item.trackName.slice(0, 300), artist: String(item.artistName || '').slice(0, 300), album: String(item.albumName || '').slice(0, 300), duration: item.duration, instrumental: item.instrumental === true,
          plain: typeof item.plainLyrics === 'string' && item.plainLyrics.length <= 50000 ? item.plainLyrics : '', synced: typeof item.syncedLyrics === 'string' && item.syncedLyrics.length <= 50000 ? item.syncedLyrics : '' }));
      if (items.length && !value.length) throw new Error('LRCLIB devolvió datos que no pudimos leer.');
      cache.set(key, { time: now(), value }); if (cache.size > 40) cache.delete(cache.keys().next().value);
      return value;
    });
    tail = job.catch(() => {}); pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  };
}

export function lyricsPlugin() {
  const query = createLyricsService();
  const middleware = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/api/lyrics') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(JSON.stringify({ error: 'Método no permitido.' })); return; }
    try { res.end(JSON.stringify({ results: await query({ id: url.searchParams.get('id'), title: url.searchParams.get('title'), artist: url.searchParams.get('artist') || '' }) })); }
    catch (error) { res.statusCode = error.status || 502; res.end(JSON.stringify({ error: error.message || 'No se pudo obtener la letra.' })); }
  };
  return { name: 'encore-lyrics', configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
