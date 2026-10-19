import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, createReadStream, createWriteStream, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv-audio', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const script = path.join(root, 'scripts/audio/prepare.py');
const jobRoot = path.join(root, '.local/audio/jobs');
const artifactNames = new Set(['manifest.json', 'analysis.json', 'vocals.wav', 'instrumental.wav', 'reduced.wav']);
const MAX_BYTES = 30 * 1024 * 1024;
const transposedRoot = path.join(root, '.local/audio/transposed');
const TRANSPOSE_BYTES = 128 * 1024 * 1024, TRANSPOSE_CACHE_BYTES = 2 * 1024 ** 3, RATE = 44100;

/** The FFmpeg the audio engine installed: the copy prepare.py keeps beside the models, or the one inside the Python environment. */
export function findFfmpeg(base = root) {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', copy = path.join(base, '.local/audio/models/bin', name);
  if (existsSync(copy)) return copy;
  const lib = path.join(base, '.venv-audio', process.platform === 'win32' ? 'Lib' : 'lib');
  const packages = process.platform === 'win32' ? [path.join(lib, 'site-packages')] : (existsSync(lib) ? readdirSync(lib).map(entry => path.join(lib, entry, 'site-packages')) : []);
  for (const folder of packages.map(entry => path.join(entry, 'imageio_ffmpeg', 'binaries'))) {
    const binary = existsSync(folder) && readdirSync(folder).find(entry => entry.startsWith('ffmpeg'));
    if (binary) return path.join(folder, binary);
  }
  return null;
}
const filters = new Map();
/** Whether this FFmpeg was built with Rubber Band. The Windows build the engine installs is; others may not be. Asked once per binary. */
export function supportsRubberband(ffmpeg) {
  if (!filters.has(ffmpeg)) filters.set(ffmpeg, new Promise(resolve => {
    let output = ''; const child = spawn(ffmpeg, ['-hide_banner', '-filters'], { windowsHide: true });
    const timeout = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', bytes => { output += bytes; });
    child.on('error', () => { clearTimeout(timeout); filters.delete(ffmpeg); resolve(false); });
    child.on('close', () => { clearTimeout(timeout); resolve(/rubberband/.test(output)); });
  }));
  return filters.get(ffmpeg);
}
/** FFmpeg arguments that move the pitch by whole semitones with Rubber Band, keep the tempo, and end at exactly the input's length. */
export function transposeArgs(input, output, semitones, samples) {
  // Rubber Band can end a few milliseconds short; padding and then cutting at the input's sample count keeps lyrics and notes in place.
  const chain = `aresample=${RATE},rubberband=pitch=${(2 ** (semitones / 12)).toFixed(8)}:pitchq=quality:channels=together,apad,atrim=end_sample=${samples}`;
  return ['-nostdin', '-v', 'error', '-y', '-i', input, '-af', chain, '-ac', '2', '-c:a', 'pcm_s16le', output];
}
/** Drops the least recently used transpositions once the cache passes its size, and inputs abandoned by a crash. */
export async function pruneTransposed(limit = TRANSPOSE_CACHE_BYTES, directory = transposedRoot) {
  const entries = [];
  for (const name of await readdir(directory).catch(() => [])) {
    const file = path.join(directory, name), info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    if (name.endsWith('.input') && Date.now() - info.mtimeMs > 3600000) await rm(file, { force: true }).catch(() => {});
    else if (/^[a-f0-9]{64}_[+-]\d_\d+\.wav$/.test(name)) entries.push({ file, size: info.size, used: info.mtimeMs });
  }
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of entries.sort((a, b) => a.used - b.used)) {
    if (total <= limit * .75) break;
    await rm(entry.file, { force: true }).then(() => { total -= entry.size; }).catch(() => {});
  }
  return total;
}
export function terminateProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // Kill only this worker's process tree, including its FFmpeg child.
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else child.kill();
}
export function validLocalRequest(req) {
  const host = req.headers.host || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return !req.headers.origin || req.headers.origin === `http://${host}` || req.headers.origin === `https://${host}`;
}
async function clearDirectory(directory) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== jobRoot || !/^[a-f0-9-]{36}$/.test(path.basename(resolved))) throw new Error('Directorio de trabajo no válido.');
  // A worker that was just killed can keep its files locked for a moment on Windows.
  await rm(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
}
const discard = job => clearDirectory(job.dir).catch(error => console.warn(`[encore] No se pudo borrar el trabajo ${job.id}: ${error.message}`));
/** Removes job folders left behind by a crash or an earlier failed cleanup. Recent ones may belong to another running server. */
export async function sweepStaleJobs(maxAgeMs = 2 * 3600000, directory = jobRoot) {
  const removed = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const target = path.join(directory, entry.name), info = await stat(target).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < maxAgeMs) continue;
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).then(() => removed.push(entry.name)).catch(() => {});
  }
  return removed;
}

export function preparationPlugin() {
  const token = randomBytes(32).toString('hex'), jobs = new Map();
  let active = null, readiness = null;
  const publicJob = job => ({ id: job.id, state: job.state, stage: job.stage, progress: job.progress, error: job.error, originalSha256: job.hash });
  function checkRuntime() {
    if (readiness) return readiness;
    if (!existsSync(python)) return Promise.resolve({ ready: false, error: 'Falta instalar el motor local. Ejecuta npm run audio:setup en la carpeta del proyecto.' });
    readiness = new Promise(resolve => {
      const child = spawn(python, [script, '--check'], { cwd: root, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
      let output = '';
      child.stdout.on('data', data => { output = (output + data).slice(-8000); });
      const timeout = setTimeout(() => child.kill(), 90000);
      child.on('error', () => { clearTimeout(timeout); readiness = null; resolve({ ready: false, error: 'No se pudo iniciar el motor Python.' }); });
      child.on('close', code => {
        clearTimeout(timeout);
        try { if (code !== 0) throw new Error(); resolve(JSON.parse(output.trim().split('\n').at(-1))); }
        catch { readiness = null; resolve({ ready: false, error: 'El motor local no está listo. Ejecuta npm run audio:setup para revisar sus dependencias.' }); }
      });
    });
    return readiness;
  }
  function start(job) {
    job.state = 'running'; job.stage = 'Iniciando preparación local';
    const child = spawn(python, [script, '--input', path.join(job.dir, 'original.audio'), '--output', path.join(job.dir, 'result'), '--cache', path.join(root, '.local/audio/models'), ...(job.analysisOnly ? ['--analyze-only'] : [])], { cwd: root, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', NUMBA_CACHE_DIR: path.join(root, '.local/audio/numba'), OMP_NUM_THREADS: '4' } });
    job.child = child;
    let pending = '', tail = '';
    child.stdout.on('data', bytes => {
      pending += bytes.toString(); const lines = pending.split('\n'); pending = lines.pop().slice(-10000);
      for (const line of lines) if (line.startsWith('ENCORE:') && job.state === 'running') {
        try { const data = JSON.parse(line.slice(7)); job.stage = String(data.stage).slice(0, 200); job.progress = Math.min(99, Math.max(0, Number(data.progress) || 0)); if (data.error) job.error = String(data.error); } catch { /* Log text isn't a status message. */ }
      }
    });
    child.stderr.on('data', bytes => { tail = (tail + bytes).slice(-12000); });
    const timeout = setTimeout(() => { job.state = 'failed'; job.error = 'La preparación superó 45 minutos. Puedes reintentar con un fragmento más corto.'; terminateProcess(child); }, 45 * 60000);
    child.on('error', error => { job.error = error.message; });
    child.on('close', async code => {
      clearTimeout(timeout); job.child = null;
      try {
        if (job.state === 'cancelled') return;
        if (code !== 0 || job.state === 'failed') throw new Error(job.error || 'El separador no pudo completar la canción. El original y la biblioteca se conservan.');
        const manifest = JSON.parse(await readFile(path.join(job.dir, job.analysisOnly ? 'result/analysis.json' : 'result/manifest.json'), 'utf8'));
        if ((job.analysisOnly ? manifest.sourceSha256 : manifest.originalSha256) !== job.hash) throw new Error('El resultado no corresponde al archivo original.');
        job.state = 'complete'; job.progress = 100; job.stage = 'Pistas y borrador disponibles'; job.error = undefined;
      } catch (error) { job.state = 'failed'; job.error = error.message; }
      finally {
        if (job.state === 'cancelled') { jobs.delete(job.id); if (active === job.id) active = null; await discard(job); return; }
        if (tail) await writeFile(path.join(job.dir, 'engine.log'), tail).catch(() => {});
        if (active === job.id) active = null;
      }
    });
  }
  const cleanup = setInterval(() => {
    for (const job of jobs.values()) if (!job.child && active !== job.id && Date.now() - job.created > 2 * 3600000) { jobs.delete(job.id); void discard(job); }
  }, 60000); cleanup.unref();
  void sweepStaleJobs();
  void pruneTransposed();

  // One transposition at a time: each one keeps a CPU core busy for a few seconds per minute of audio.
  let transposing = Promise.resolve(), transposer = null;
  async function transpose(req, res, json) {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return json({ error: 'El cambio de tono necesita el motor local de audio. Ejecuta npm run audio:setup en la carpeta del proyecto.' }, 503);
    if (!await supportsRubberband(ffmpeg)) return json({ error: 'El FFmpeg de este equipo no incluye Rubber Band, que es lo que cambia el tono.' }, 503);
    const hash = req.headers['x-audio-sha256'], semitones = Number(req.headers['x-semitones']), samples = Number(req.headers['x-samples']), length = Number(req.headers['content-length']);
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'Falta la identificación del audio.' }, 400);
    if (!Number.isInteger(semitones) || !semitones || Math.abs(semitones) > 6) return json({ error: 'El tono se puede mover de −6 a +6 semitonos.' }, 400);
    if (!Number.isInteger(samples) || samples < RATE || samples > RATE * 601) return json({ error: 'La duración indicada no es válida.' }, 400);
    if (!Number.isFinite(length) || length <= 0 || length > TRANSPOSE_BYTES) return json({ error: 'El audio debe ocupar hasta 128 MB.' }, 413);
    await mkdir(transposedRoot, { recursive: true });
    const cached = path.join(transposedRoot, `${hash}_${semitones > 0 ? '+' : '-'}${Math.abs(semitones)}_${samples}.wav`);
    if (existsSync(cached)) { req.resume(); await new Promise(resolve => { req.on('end', resolve); req.on('error', resolve); }); }
    else {
      const id = randomUUID(), input = path.join(transposedRoot, `${id}.input`), output = path.join(transposedRoot, `${id}.wav`);
      try {
        const digest = createHash('sha256'), file = createWriteStream(input); let received = 0;
        for await (const chunk of req) { received += chunk.length; if (received > TRANSPOSE_BYTES) throw new Error('Archivo demasiado grande.'); digest.update(chunk); if (!file.write(chunk)) await new Promise(resolve => file.once('drain', resolve)); }
        await new Promise((resolve, reject) => { file.on('error', reject); file.end(resolve); });
        if (digest.digest('hex') !== hash) return json({ error: 'El audio recibido no coincide con el indicado.' }, 400);
        const task = transposing.catch(() => {}).then(() => new Promise((resolve, reject) => {
          if (res.destroyed) return reject(new Error('Petición cancelada.'));
          const child = spawn(ffmpeg, transposeArgs(input, output, semitones, samples), { windowsHide: true }); let tail = '';
          transposer = child;
          const abandon = () => terminateProcess(child); res.once('close', abandon);
          child.stderr.on('data', bytes => { tail = (tail + bytes).slice(-2000); });
          child.on('error', reject);
          child.on('close', code => { res.off('close', abandon); transposer = null; code === 0 ? resolve() : reject(new Error(`No se pudo cambiar el tono. ${tail.trim().split('\n').at(-1) || ''}`.trim())); });
        }));
        transposing = task;
        await task;
        await rename(output, cached);
      } finally { await rm(input, { force: true }).catch(() => {}); await rm(output, { force: true }).catch(() => {}); }
      void pruneTransposed();
    }
    if (res.destroyed) return;
    const info = await stat(cached), now = new Date();
    await utimes(cached, now, now).catch(() => {});
    res.statusCode = 200; res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Length', info.size);
    const stream = createReadStream(cached); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }

  const middleware = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/preparation/')) return next();
    const json = (data, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)); };
    if (!validLocalRequest(req)) return json({ error: 'La preparación solo se permite desde esta aplicación local.' }, 403);
    try {
      if (url.pathname === '/api/preparation/status' && req.method === 'GET') return json({ ...await checkRuntime(), token, active: active ? publicJob(jobs.get(active)) : null });
      // Moving a key needs only FFmpeg, not the Python check the status waits for.
      if (url.pathname === '/api/preparation/transpose' && req.method === 'GET') { const ffmpeg = findFfmpeg(); return json({ available: !!ffmpeg && await supportsRubberband(ffmpeg), token }); }
      if (req.headers['x-encore-token'] !== token) return json({ error: 'La sesión del motor cambió. Actualiza su estado y vuelve a intentar.' }, 403);
      if (url.pathname === '/api/preparation/transpose' && req.method === 'POST') return await transpose(req, res, json);
      if (['/api/preparation/jobs', '/api/preparation/analysis'].includes(url.pathname) && req.method === 'POST') {
        const analysisOnly = url.pathname === '/api/preparation/analysis';
        const limit = analysisOnly ? 128 * 1024 * 1024 : MAX_BYTES;
        if (active) return json({ error: 'Ya hay una canción preparándose. Espera o cancela ese trabajo.' }, 409);
        if (!(await checkRuntime()).ready) return json({ error: 'El motor local no está instalado.' }, 503);
        const length = Number(req.headers['content-length']);
        if (!Number.isFinite(length) || length <= 0 || length > limit) return json({ error: analysisOnly ? 'La pista vocal debe ocupar hasta 128 MB.' : 'El original debe ocupar hasta 30 MB.' }, 413);
        const hash = req.headers['x-audio-sha256'];
        if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'Falta la identificación del audio.' }, 400);
        if (active) return json({ error: 'Ya hay una canción preparándose.' }, 409);
        const id = req.headers['x-encore-job-id'] || randomUUID();
        if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) || jobs.has(id)) return json({ error: 'Identificador de trabajo inválido.' }, 400);
        const dir = path.join(jobRoot, id);
        const job = { id, dir, hash, analysisOnly, state: 'uploading', stage: 'Recibiendo audio local', progress: 0, created: Date.now(), child: null };
        active = id; jobs.set(id, job);
        try {
          const chunks = []; let received = 0;
          for await (const chunk of req) { received += chunk.length; if (received > limit) throw new Error('Archivo demasiado grande.'); chunks.push(chunk); }
          const bytes = Buffer.concat(chunks);
          if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('El audio recibido no coincide con el original.');
          if (res.destroyed || job.state === 'cancelled') throw new Error('Subida cancelada.');
          await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'original.audio'), bytes);
          if (res.destroyed || job.state === 'cancelled') throw new Error('Subida cancelada.');
          start(job); return json(publicJob(job), 202);
        } catch (error) { jobs.delete(id); if (active === id) active = null; await clearDirectory(dir); throw error; }
      }
      const match = url.pathname.match(/^\/api\/preparation\/jobs\/([a-f0-9-]{36})(?:\/(manifest\.json|analysis\.json|vocals\.wav|instrumental\.wav|reduced\.wav))?$/);
      if (!match || !jobs.has(match[1])) return json({ error: 'Este trabajo ya no está disponible. Vuelve a prepararlo si reiniciaste el servidor.' }, 404);
      const job = jobs.get(match[1]);
      if (req.method === 'DELETE' && !match[2]) {
        job.state = 'cancelled';
        if (job.child) { terminateProcess(job.child); return json({ cancelled: true }); }
        jobs.delete(job.id); if (active === job.id) active = null; await clearDirectory(job.dir); return json({ cancelled: true });
      }
      if (req.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);
      if (!match[2]) return json(publicJob(job));
      if (job.state !== 'complete' || !artifactNames.has(match[2])) return json({ error: 'El resultado todavía no está completo.' }, 409);
      const file = path.join(job.dir, 'result', match[2]), info = await stat(file);
      res.setHeader('Content-Type', match[2].endsWith('.json') ? 'application/json' : 'audio/wav');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Length', info.size);
      const stream = createReadStream(file); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch (error) { if (!res.headersSent && !res.destroyed) json({ error: error.message || 'No se pudo preparar la canción.' }, 500); }
  };
  const configure = server => { server.middlewares.use(middleware); server.httpServer?.once('close', () => { clearInterval(cleanup); terminateProcess(transposer); for (const job of jobs.values()) { job.state = 'cancelled'; terminateProcess(job.child); } }); };
  return { name: 'encore-preparation', configureServer: configure, configurePreviewServer: configure };
}
