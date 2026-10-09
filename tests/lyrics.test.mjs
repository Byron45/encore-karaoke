import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLyrics, cueAt, lrclibId, exportLyrics } from '../src/lyrics.ts';
import { playable } from '../src/library-model.ts';
import { ScoreTracker } from '../src/scoring.ts';
import { createLyricsService } from '../server/lyrics.mjs';

test('whole plain lyrics remain text without fabricated timestamps or notes', () => {
  const lyrics = { raw: 'Una frase\nOtra frase', format: 'plain', offset: 0 };
  assert.deepEqual(compileLyrics(lyrics, 10), { text: lyrics.raw, cues: [] });
  const song = playable({ notes: [], lyrics, duration: 10 });
  assert.deepEqual(song.notes, []); assert.deepEqual(song.phrases, []);
  const summary = new ScoreTracker([]).summary(10);
  assert.equal(summary.score, 0);
  for (const value of Object.values(summary)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
});
test('LRC handles repeated timestamps, fractions, metadata, offset and instrumental empty cues', () => {
  const lyrics = { raw: '[ar:Prueba]\n[00:01.5][00:04.050]Voz\n[00:03.000]\n[offset:+500]', format: 'lrc', offset: 0.25 };
  const { cues } = compileLyrics(lyrics, 6);
  assert.deepEqual(cues, [{ start: 1.25, text: 'Voz' }, { start: 2.75, text: '' }, { start: 3.8, text: 'Voz' }]);
  assert.equal(cueAt(cues, 0), -1); assert.equal(cueAt(cues, 3), 1); assert.equal(cueAt(cues, 4), 2);
});
test('LRC rejects malformed, oversized or out-of-track timing and unsupported word timestamps', () => {
  for (const raw of ['[00:65]Malo', '[01:00]Fuera', '[00:01]A\nSin tiempo', '[offset:bad]\n[00:01]A', '[00:01]<00:01.1>Palabra', '[offset:2]\n[offset:3]\n[00:01]A', '[ar:Sin letra]', 'x'.repeat(50001)]) assert.throws(() => compileLyrics({ raw, format: 'lrc', offset: 0 }, 10));
  assert.throws(() => compileLyrics({ raw: '[00:01]A', format: 'lrc', offset: NaN }, 10));
  assert.deepEqual(compileLyrics({ raw: '[00:01]Uno\n[00:01]Dos', format: 'lrc', offset: 0 }, 10).cues, [{ start: 1, text: 'Uno\nDos' }]);
});
test('LRCLIB links accept track IDs only and never arbitrary upstream URLs', () => {
  assert.equal(lrclibId('https://lrclib.net/tracks/34541541'), '34541541');
  assert.equal(lrclibId('34541541'), '34541541');
  for (const value of ['https://lrclib.net.evil/tracks/123', 'https://user@lrclib.net/tracks/123', 'https://lrclib.net/api/get/123', 'https://localhost/tracks/123', '-3']) assert.throws(() => lrclibId(value));
});
test('exported LRC preserves effective offset and advancing retains only the line active at zero', () => {
  const doc = { raw: '[offset:100]\n[00:01]Uno\n[00:02]Dos\n[00:04]Tres', format: 'lrc', offset: -3 };
  const parsed = compileLyrics(doc, 10);
  assert.deepEqual(parsed.cues, [{ start: 0, text: 'Dos' }, { start: 0.8999999999999999, text: 'Tres' }]);
  const imported = compileLyrics({ raw: exportLyrics(doc, 10), format: 'lrc', offset: 0 }, 10);
  assert.equal(imported.cues.length, parsed.cues.length);
  for (let i = 0; i < parsed.cues.length; i++) { assert.equal(imported.cues[i].text, parsed.cues[i].text); assert.ok(Math.abs(imported.cues[i].start - parsed.cues[i].start) < 0.001); }
  const delayed = { raw: '[00:01.25]Una línea', format: 'lrc', offset: 3 };
  assert.equal(compileLyrics({ raw: exportLyrics(delayed, 10), format: 'lrc', offset: 0 }, 10).cues[0].start, 4.25);
  assert.equal(compileLyrics({ raw: 'Solo texto', format: 'plain', offset: NaN }, 10).text, 'Solo texto');
});
test('lyrics service normalizes results and caches and deduplicates calls without uploading audio', async () => {
  const calls = []; let clock = 0;
  const service = createLyricsService({ now: () => clock, sleep: async ms => { clock += ms; }, fetcher: async (url, options) => {
    calls.push({ url, options, time: clock }); return { ok: true, json: async () => ({ id: 123, trackName: 'Ejemplo', artistName: 'Autor', albumName: 'Álbum', duration: 10, syncedLyrics: '[00:01]Hola', plainLyrics: 'Hola' }) };
  } });
  const [a, b] = await Promise.all([service({ id: '123' }), service({ id: '123' })]);
  assert.deepEqual(a, b); assert.equal(calls.length, 1); assert.equal(a[0].synced, '[00:01]Hola');
  await service({ id: '123' }); assert.equal(calls.length, 1);
  await service({ title: 'Otro', artist: 'Autor' }); assert.equal(calls.length, 2); assert.ok(calls[1].time - calls[0].time >= 1000);
  assert.equal(calls[0].url.hostname, 'lrclib.net'); assert.equal(calls[0].options.body, undefined);
});
test('lyrics service rejects invalid queries, recovers after upstream error and handles missing lyrics', async () => {
  let attempt = 0;
  const service = createLyricsService({ sleep: async () => {}, fetcher: async () => ++attempt === 1 ? { ok: false, status: 503 } : { ok: false, status: 404 } });
  await assert.rejects(service({ id: '../../foo' }), /no válido/);
  await assert.rejects(service({ title: 'x' }), /título mínimo/);
  await assert.rejects(service({ id: '1' }), /no está disponible/);
  assert.deepEqual(await service({ id: '1' }), []);
});
