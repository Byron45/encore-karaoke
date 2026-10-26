import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectPitch } from '../public/audio/dsp.js';
import { findFfmpeg, preparationPlugin, pruneTransposed, pruneWords, supportsRubberband, transposeArgs } from '../server/preparation.mjs';

const RATE = 44100;
/** Stereo PCM16 WAV with a voice-like 220 Hz tone in two bursts, so pitch and position can both be checked. */
function burstsWav(seconds = 2) {
  const count = RATE * seconds, bytes = Buffer.alloc(44 + count * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 4, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++) {
    const t = i / RATE, on = t >= .3 && t < .9 || t >= 1.2 && t < 1.8;
    const value = on ? .3 * Math.sin(2 * Math.PI * 220 * t) + .12 * Math.sin(2 * Math.PI * 440 * t) : 0;
    bytes.writeInt16LE(Math.round(value * 32767), 44 + i * 4); bytes.writeInt16LE(Math.round(value * .8 * 32767), 46 + i * 4);
  }
  return bytes;
}
function pcm(bytes) {
  let at = 12, format, data;
  while (at + 8 <= bytes.length) { const id = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4); if (id === 'fmt ') format = { channels: bytes.readUInt16LE(at + 10), rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) }; if (id === 'data') { data = bytes.subarray(at + 8, at + 8 + size); break; } at += 8 + size + (size & 1); }
  const frames = data.length / (2 * format.channels), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { let sum = 0; for (let c = 0; c < format.channels; c++) sum += data.readInt16LE((i * format.channels + c) * 2); mono[i] = sum / format.channels / 32768; }
  return { ...format, frames, mono };
}
const pitchAt = (mono, seconds) => { const start = Math.round(seconds * RATE), compact = new Float32Array(1024); for (let i = 0; i < 1024; i++) compact[i] = (mono[start + 2 * i] + mono[start + 2 * i + 1]) / 2; return detectPitch(compact, RATE / 2).frequency; };

test('the transposition keeps the tempo and ends at exactly the length it was given', () => {
  const args = transposeArgs('in.wav', 'out.wav', 2, 88200), chain = args[args.indexOf('-af') + 1];
  assert.match(chain, /^aresample=44100,rubberband=pitch=1\.12246205:pitchq=quality:channels=together,apad,atrim=end_sample=88200$/);
  assert.match(transposeArgs('in.wav', 'out.wav', -3, 1).at(-6) || '', /pitch=0\.8408964/);
  assert.deepEqual(args.slice(-5), ['-ac', '2', '-c:a', 'pcm_s16le', 'out.wav']);
});

test('the key change is offered only with an FFmpeg built with Rubber Band', { skip: !findFfmpeg() && 'el motor local de audio no está instalado' }, async () => {
  assert.equal(await supportsRubberband(findFfmpeg()), true);
  assert.equal(await supportsRubberband(path.join(tmpdir(), 'no-existe', 'ffmpeg.exe')), false);
});

test('the transposition cache drops the least recently used files and abandoned uploads', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'encore-transposed-'));
  try {
    const name = (i, n) => `${String(i).repeat(64).slice(0, 64)}_+${n}_88200.wav`;
    const files = [[name(1, 1), 3, 5], [name(2, 2), 3, 4], [name(3, 3), 3, 3], [name(4, 1), 3, 1]]; // name, size, hours ago
    for (const [file, size, hours] of files) { await writeFile(path.join(folder, file), Buffer.alloc(size)); const when = new Date(Date.now() - hours * 3600000); await utimes(path.join(folder, file), when, when); }
    await writeFile(path.join(folder, 'old.input'), 'x'); const old = new Date(Date.now() - 2 * 3600000); await utimes(path.join(folder, 'old.input'), old, old);
    await writeFile(path.join(folder, 'new.input'), 'x'); await writeFile(path.join(folder, 'notes.txt'), 'kept');
    // A cap of 8 bytes keeps at most 6: the two most recently used survive.
    assert.equal(await pruneTransposed(8, folder), 6);
    assert.deepEqual((await readdir(folder)).sort(), [name(3, 3), name(4, 1), 'new.input', 'notes.txt'].sort());
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('the local server moves a song by semitones, exactly and only from this app', { skip: !findFfmpeg() && 'el motor local de audio no está instalado' }, async () => {
  let middleware;
  preparationPlugin().configureServer({ middlewares: { use: fn => { middleware = fn; } } });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/preparation`, audio = burstsWav(), sha = createHash('sha256').update(audio).digest('hex');
  const created = [];
  try {
    const status = await (await fetch(`${base}/transpose`)).json();
    assert.equal(status.available, true); assert.match(status.token, /^[a-f0-9]{64}$/);
    assert.equal((await fetch(`${base}/transpose`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const send = (headers, body = audio) => fetch(`${base}/transpose`, { method: 'POST', headers: { 'X-Encore-Token': status.token, 'X-Audio-Sha256': sha, 'X-Semitones': '2', 'X-Samples': String(RATE * 2), ...headers }, body });
    // Refused: no token, another site, a step too large, a wrong length or audio that is not what it claims.
    assert.equal((await send({ 'X-Encore-Token': 'otro' })).status, 403);
    assert.equal((await send({ Origin: 'https://untrusted.example' })).status, 403);
    for (const [header, value] of [['X-Semitones', '7'], ['X-Semitones', '0'], ['X-Semitones', '1.5'], ['X-Samples', '10'], ['X-Audio-Sha256', 'zz']]) assert.equal((await send({ [header]: value })).status, 400, `${header}: ${value}`);
    assert.equal((await send({ 'X-Audio-Sha256': 'a'.repeat(64) })).status, 400);

    const started = Date.now(), first = await send({});
    assert.equal(first.status, 200); assert.equal(first.headers.get('content-type'), 'audio/wav');
    const shifted = Buffer.from(await first.arrayBuffer()), firstMs = Date.now() - started;
    created.push(`${sha}_+2_${RATE * 2}.wav`);
    const out = pcm(shifted);
    assert.equal(out.frames, RATE * 2); assert.equal(out.rate, RATE); assert.equal(out.channels, 2); assert.equal(out.bits, 16);
    const expected = 220 * 2 ** (2 / 12);
    for (const at of [.5, 1.5]) assert.ok(Math.abs(1200 * Math.log2(pitchAt(out.mono, at) / expected)) < 5, `pitch at ${at} s`);
    // The bursts stay where they were: silence before the first, sound inside it.
    assert.ok(Math.abs(out.mono[Math.round(.2 * RATE)]) < .01); assert.ok(Math.max(...out.mono.subarray(Math.round(.4 * RATE), Math.round(.42 * RATE)).map(Math.abs)) > .1);

    // The same request again comes from the cache: same bytes, without the work.
    const again = Date.now(), second = Buffer.from(await (await send({})).arrayBuffer());
    assert.ok(second.equals(shifted)); assert.ok(Date.now() - again < Math.max(firstMs, 400), `cache ${Date.now() - again} ms vs ${firstMs} ms`);
    const down = pcm(Buffer.from(await (await send({ 'X-Semitones': '-3' })).arrayBuffer())); created.push(`${sha}_-3_${RATE * 2}.wav`);
    assert.ok(Math.abs(1200 * Math.log2(pitchAt(down.mono, .5) / (220 * 2 ** (-3 / 12)))) < 5); assert.equal(down.frames, RATE * 2);
  } finally {
    server.close();
    for (const name of created) await rm(path.join(process.cwd(), '.local/audio/transposed', name), { force: true });
  }
});

test('sung words are recognised only for this app, with a matching file, a valid language and a bounded size', async () => {
  let middleware;
  preparationPlugin().configureServer({ middlewares: { use: fn => { middleware = fn; } } });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/preparation/words`, audio = burstsWav(1), sha = createHash('sha256').update(audio).digest('hex');
  try {
    const status = await (await fetch(base)).json();
    assert.equal(typeof status.available, 'boolean'); assert.match(status.token, /^[a-f0-9]{64}$/);
    assert.equal((await fetch(base, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const send = headers => fetch(base, { method: 'POST', headers: { 'X-Encore-Token': status.token, 'X-Audio-Sha256': sha, ...headers }, body: audio });
    assert.equal((await send({ 'X-Encore-Token': 'otro' })).status, 403);
    if (!status.available) return;
    for (const [header, value] of [['X-Audio-Sha256', 'zz'], ['X-Language', 'español'], ['X-Language', 'ES']]) assert.equal((await send({ [header]: value })).status, 400, `${header}: ${value}`);
    assert.equal((await send({ 'X-Audio-Sha256': 'a'.repeat(64) })).status, 400);
  } finally { server.close(); }
});

test('recognitions of isolated voices are kept up to a count, newest first; abandoned takes are removed', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'encore-words-'));
  try {
    const name = (i, language = 'es') => `${String(i).repeat(64).slice(0, 64)}_${language}.json`;
    for (const [file, hours] of [[name(1), 5], [name(2), 3], [name(3, 'auto'), 1], ['old.wav', 2], ['new.wav', 0], ['notes.txt', 9]]) {
      await writeFile(path.join(folder, file), 'x'); const when = new Date(Date.now() - hours * 3600000); await utimes(path.join(folder, file), when, when);
    }
    assert.equal(await pruneWords(2, folder), 2);
    assert.deepEqual((await readdir(folder)).sort(), [name(2), name(3, 'auto'), 'new.wav', 'notes.txt'].sort());
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('meaning vectors come only for this app, within limits, normalised, from a model that stays loaded', async () => {
  let middleware;
  const plugin = preparationPlugin();
  let close = () => {};
  plugin.configureServer({ middlewares: { use: fn => { middleware = fn; } }, httpServer: { once: (_, fn) => { close = fn; } } });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/preparation/meaning`;
  try {
    const status = await (await fetch(base)).json();
    assert.equal(typeof status.available, 'boolean'); assert.match(status.token, /^[a-f0-9]{64}$/);
    assert.equal((await fetch(base, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const send = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Encore-Token': status.token, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    assert.equal((await send({ kind: 'query', texts: ['hola'] }, { 'X-Encore-Token': 'otro' })).status, 403);
    if (!status.available) return;
    for (const body of ['no es json', { kind: 'otro', texts: ['x'] }, { kind: 'query', texts: [] }, { kind: 'query', texts: [''] }, { kind: 'query', texts: Array(65).fill('x') }, { kind: 'passage', texts: ['x'.repeat(8001)] }]) assert.equal((await send(body)).status, 400, JSON.stringify(body).slice(0, 60));
    const first = Date.now(), answer = await (await send({ kind: 'passage', texts: ['Destapa el champagne y brindemos por nuestro amor', 'Los soldados avanzan en la batalla, la guerra no termina'] })).json();
    assert.equal(answer.vectors.length, 2); assert.equal(answer.vectors[0].length, 384); assert.match(answer.model, /e5/);
    assert.ok(Math.abs(Math.hypot(...answer.vectors[0]) - 1) < .01, 'normalised');
    // Once loaded, a query is answered in a moment, and it lands nearer the text it is about.
    const again = Date.now(), query = (await (await send({ kind: 'query', texts: ['una canción de guerra'] })).json()).vectors[0];
    assert.ok(Date.now() - again < Math.max(2000, (Date.now() - first) / 2), `${Date.now() - again} ms`);
    const dot = vector => vector.reduce((sum, value, i) => sum + value * query[i], 0);
    assert.ok(dot(answer.vectors[1]) > dot(answer.vectors[0]));
  } finally { close(); server.close(); }
});
