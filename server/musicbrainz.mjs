const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function createMusicBrainzService({ fetcher = fetch, now = Date.now, sleep = defaultSleep, interval = 1100 } = {}) {
  const cache = new Map(), pending = new Map();
  let tail = Promise.resolve(), lastStarted = -Infinity;
  const escape = value => value.replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
  return async function search(title, artist = '') {
    title = typeof title === 'string' ? title.trim() : '';
    artist = typeof artist === 'string' ? artist.trim() : '';
    if (title.length < 2 || title.length > 120 || artist.length > 120) throw Object.assign(new Error('Escribe un título de 2 a 120 caracteres y un artista de hasta 120.'), { status: 400 });
    const key = JSON.stringify([title.toLowerCase(), artist.toLowerCase()]);
    const hit = cache.get(key);
    if (hit && now() - hit.time < 15 * 60 * 1000) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 12) throw Object.assign(new Error('Hay varias búsquedas en espera. Intenta de nuevo en unos segundos.'), { status: 429 });
    const job = tail.then(async () => {
      const wait = interval - (now() - lastStarted);
      if (wait > 0) await sleep(wait);
      lastStarted = now();
      const query = `recording:"${escape(title)}"${artist ? ` AND artist:"${escape(artist)}"` : ''}`;
      const url = new URL('https://musicbrainz.org/ws/2/recording/');
      url.search = new URLSearchParams({ query, fmt: 'json', limit: '8' }).toString();
      let response;
      try { response = await fetcher(url, { headers: { 'User-Agent': 'EncoreKaraoke/0.2.0 (personal non-commercial local prototype)', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); }
      catch { throw Object.assign(new Error('MusicBrainz no respondió a tiempo o no hay conexión. Puedes seguir editando tu canción.'), { status: 502 }); }
      if (!response.ok) throw Object.assign(new Error(response.status === 429 || response.status === 503 ? 'MusicBrainz está ocupado. Espera un momento antes de buscar de nuevo.' : 'No se pudo consultar MusicBrainz. Puedes seguir editando sin asociar metadatos.'), { status: 502 });
      const body = await response.json();
      const value = (Array.isArray(body.recordings) ? body.recordings : []).filter(item => /^[a-f0-9-]{36}$/i.test(item.id)).map(item => ({
        id: item.id, title: String(item.title || ''), artist: (item['artist-credit'] || []).map(credit => `${credit.name || credit.artist?.name || ''}${credit.joinphrase || ''}`).join(''),
        duration: Number.isFinite(item.length) && item.length > 0 ? item.length / 1000 : null,
        album: String(item.releases?.[0]?.title || ''), date: String(item['first-release-date'] || ''), disambiguation: String(item.disambiguation || ''),
      }));
      cache.set(key, { time: now(), value });
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      return value;
    });
    tail = job.catch(() => {});
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  };
}
export function musicBrainzPlugin() {
  const search = createMusicBrainzService();
  const middleware = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/api/musicbrainz/recordings') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(JSON.stringify({ error: 'Método no permitido.' })); return; }
    try { res.end(JSON.stringify({ recordings: await search(url.searchParams.get('title'), url.searchParams.get('artist') || '') })); }
    catch (error) { res.statusCode = error.status || 502; if (res.statusCode === 429) res.setHeader('Retry-After', '2'); res.end(JSON.stringify({ error: error.message || 'No se pudo consultar el catálogo.' })); }
  };
  return { name: 'encore-musicbrainz', configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
