import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNotes, importMap, exportMap, playable } from '../src/library-model.ts';
import { createMusicBrainzService } from '../server/musicbrainz.mjs';
import { ScoreTracker, performanceFeedback } from '../src/scoring.ts';

const note = { start: 0, duration: 0.5, midi: 60, word: 'Hola', phrase: 0 };
const record = { title: 'Prueba', artist: 'Autor', audioHash: 'abc123', duration: 4, notes: [note, { ...note, start: 1, phrase: 1, word: 'voz' }], bpm: null };
test('maps validate timing, ranges, phrase order and prevent overlaps', () => {
  assert.deepEqual(validateNotes(record.notes, 4), []);
  for (const notes of [[], [{ ...note, midi: 90 }], [{ ...note, start: -1 }], [{ ...note, duration: Infinity }], [{ ...note, duration: 5 }], [{ ...note, phrase: 2 }], [{ ...note, word: '' }], [note, { ...note, start: 0.2 }]]) assert.ok(validateNotes(notes, 4).length);
});
test('map import is tied to exact audio hash and duration, rejects malformed and incompatible files', () => {
  const map = exportMap(record);
  assert.deepEqual(importMap(JSON.stringify(map), record), record.notes);
  assert.throws(() => importMap(JSON.stringify(map), { ...record, audioHash: 'other' }), /otro archivo/);
  assert.throws(() => importMap(JSON.stringify(map), { ...record, duration: 6 }), /duración/);
  assert.throws(() => importMap('{bad', record), /JSON/);
  assert.throws(() => importMap(JSON.stringify({ ...map, schemaVersion: 2 }), record), /versión 1/);
  assert.throws(() => importMap(JSON.stringify({ ...map, notes: [{ ...note, start: 6 }] }), record), /después del audio/);
});
test('arbitrary phrase counts reach both player and scoring', () => {
  const song = playable(record);
  assert.deepEqual(song.phrases, ['Hola', 'voz']);
  const tracker = new ScoreTracker(song.notes);
  assert.equal(tracker.summary(4).phrases.length, 2);
  assert.throws(() => playable({ ...record, notes: [] }));
});
test('imported audio octave diagnosis never recommends unavailable register changes', () => {
  const tracker = new ScoreTracker(record.notes);
  for (let time = 0.01; time < 4; time += 0.01) tracker.sample(time, 0.01, 130.8128, 1, 0.1);
  const feedback = performanceFeedback(tracker.summary(4), 0, false);
  assert.match(feedback.detail, /biblioteca/);
  assert.doesNotMatch(feedback.detail, /Prueba el registro/);
});
test('MusicBrainz serializes distinct searches, deduplicates and caches matching queries', async () => {
  let clock = 0; const starts = [], calls = [];
  const service = createMusicBrainzService({ now: () => clock, sleep: async ms => { clock += ms; }, fetcher: async (url, options) => {
    starts.push(clock); calls.push({ url, options });
    return { ok: true, json: async () => ({ recordings: [{ id: '12345678-1234-1234-1234-123456789abc', title: 'Song', 'artist-credit': [{ name: 'Artist' }], length: 4000 }] }) };
  } });
  const [a, b] = await Promise.all([service('First', 'Artist'), service('First', 'Artist'), service('Second')]);
  assert.deepEqual(a, b); assert.equal(calls.length, 2); assert.ok(starts[1] - starts[0] >= 1000);
  await service(' first ', 'artist'); assert.equal(calls.length, 2);
  assert.match(calls[0].options.headers['User-Agent'], /EncoreKaraoke/);
  assert.equal(a[0].duration, 4);
});
test('MusicBrainz rejects invalid input, escapes search syntax and recovers from failures', async () => {
  const queries = []; let attempt = 0;
  const service = createMusicBrainzService({ interval: 0, fetcher: async url => {
    queries.push(url.searchParams.get('query'));
    return ++attempt === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ recordings: [] }) };
  } });
  await assert.rejects(service('x'), /2 a 120/);
  await assert.rejects(service('Test'), /ocupado/);
  assert.deepEqual(await service('title" OR artist:*'), []);
  assert.match(queries[1], /title\\" OR artist\\:\\\*/);
});
