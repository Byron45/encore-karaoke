import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, facetsOf, meaningText, NO_FILTERS, rankByMeaning, rankByWords, textKey } from '../src/song-search.ts';

const record = (overrides = {}) => ({
  id: 'a', title: 'Canción', artist: 'Grupo', duration: 60, bpm: null, audioName: 'a.mp3', audioHash: 'x', updatedAt: '', audio: null,
  notes: [{ start: 1, duration: 3, midi: 49, word: '', phrase: 0 }, { start: 5, duration: 3, midi: 52, word: '', phrase: 0 }, { start: 9, duration: 3, midi: 56, word: '', phrase: 1 }],
  lyrics: { raw: '[00:01.00]Que te quiero y no me olvides\n[00:05.00]Por la noche de la luna y el mar\n[00:09.00]Yo te espero en la estación con una flor', format: 'lrc', offset: 0 },
  recording: { id: 'r', title: 'Canción', artist: 'Grupo', duration: 60, album: '', date: '1994-05-02', disambiguation: '' },
  ...overrides,
});
const voice = { low: 52, high: 64, middle: 57, seconds: 300 };

test('a song\'s facets come from the library: lyrics language, decade and how it suits the voice', () => {
  const song = facetsOf(record(), voice);
  assert.equal(song.language, 'es'); assert.equal(song.year, 1994); assert.equal(song.decade, 1990);
  assert.equal(song.fit, 'with-key'); assert.ok([3, 4].includes(song.steps), `steps ${song.steps}`);
  assert.match(song.lyrics, /Que te quiero/); assert.ok(!song.lyrics.includes('[00:'), 'timestamps are not meaning');
  assert.equal(meaningText(song).startsWith('Canción. Que te quiero'), true);
  // In the voice's range, in its own key; far above it even after moving the key; unknown without a range or a map.
  assert.equal(facetsOf(record({ notes: [{ start: 1, duration: 6, midi: 55, word: '', phrase: 0 }, { start: 8, duration: 6, midi: 62, word: '', phrase: 1 }] }), voice).fit, 'comfortable');
  assert.equal(facetsOf(record({ notes: [{ start: 1, duration: 6, midi: 50, word: '', phrase: 0 }, { start: 8, duration: 6, midi: 72, word: '', phrase: 1 }] }), voice).fit, 'demanding');
  assert.equal(facetsOf(record(), null).fit, null); assert.equal(facetsOf(record({ notes: [] }), voice).fit, null);
  const plain = facetsOf(record({ lyrics: { raw: 'I love you baby and you know it\nAll the night we dance in the rain\nYou and me and the city lights', format: 'plain', offset: 0 }, recording: undefined }), voice);
  assert.equal(plain.language, 'en'); assert.equal(plain.decade, null);
});

test('filters narrow by language, decade (or no year) and fit, and keep the order they are given', () => {
  const songs = [facetsOf(record({ id: 'a' }), voice), facetsOf(record({ id: 'b', recording: undefined }), voice), facetsOf(record({ id: 'c', recording: { ...record().recording, date: '2003' }, notes: [{ start: 1, duration: 6, midi: 55, word: '', phrase: 0 }, { start: 8, duration: 6, midi: 62, word: '', phrase: 1 }] }), voice)];
  const ids = filters => applyFilters(songs, { ...NO_FILTERS, ...filters }).map(song => song.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c']);
  assert.deepEqual(ids({ decade: 1990 }), ['a']); assert.deepEqual(ids({ decade: 'none' }), ['b']); assert.deepEqual(ids({ decade: 2000 }), ['c']);
  assert.deepEqual(ids({ fit: 'comfortable' }), ['c']); assert.deepEqual(ids({ fit: 'with-key', decade: 1990 }), ['a']);
  assert.deepEqual(ids({ language: 'en' }), []);
});

test('meaning ranks by similarity and says how far above the library\'s average each song is', () => {
  const vectors = new Map([['sad', [.9, .1, .0]], ['party', [.1, .9, .1]], ['epic', [.2, .3, .9]]]);
  const ranked = rankByMeaning([1, 0, 0], vectors);
  assert.deepEqual(ranked.map(item => item.id), ['sad', 'epic', 'party']);
  assert.ok(ranked[0].relevance > 1 && ranked[2].relevance < 0);
  assert.deepEqual(rankByMeaning([1, 0, 0], new Map()), []);
});

test('without the model, words in the title, artist or lyrics are matched, ignoring accents', () => {
  const songs = [facetsOf(record({ id: 'a', title: 'Luz de día' }), voice), facetsOf(record({ id: 'b', title: 'Otra', lyrics: undefined }), voice)];
  assert.deepEqual(rankByWords('DIA', songs).map(item => item.id), ['a']);
  assert.deepEqual(rankByWords('estación luna', songs).map(item => item.id), ['a']);
  assert.deepEqual(rankByWords('trompeta', songs), []);
  assert.notEqual(textKey('a'), textKey('b')); assert.equal(textKey('canción'), textKey('canción'));
});
