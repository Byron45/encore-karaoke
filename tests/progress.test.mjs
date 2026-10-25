import test from 'node:test';
import assert from 'node:assert/strict';
import { LOW_MIDI, songRange, songsProgress, suggestKey, summarizeTake, voiceRange, weakPhrases } from '../src/progress.ts';

const bins = entries => { const voice = new Array(49).fill(0); for (const [midi, seconds] of Object.entries(entries)) voice[Number(midi) - LOW_MIDI] = seconds; return voice; };
const take = (overrides = {}) => ({ createdAt: '2026-10-20T10:00:00Z', songId: 'a', song: 'A', difficulty: 'relaxed', score: 5000, transpose: 0, phrases: [80, 40, 90], phraseCount: 3, voice: bins({}), ...overrides });

test('a take summary counts the voice only during the notes, above the silence gate, compensating the capture delay', () => {
  // Readings every 20 ms for 5 s: Do4 for two seconds, a gap, then Mi4; the take was captured 100 ms late.
  const times = [], pitch = [], level = [];
  for (let ms = 0; ms < 5000; ms += 20) { const t = ms - 100; times.push(ms); pitch.push(t < 2000 ? 6000 : t >= 3000 ? 6400 : 6700); level.push(t >= 4000 && t < 4500 ? 50 : 1000); }
  const document = { difficulty: 'normal', score: 6200, transpose: -2, levelGate: .01, phrases: [70, 55], capture: { offsetMs: 100, trace: { times: times.join(','), pitch: pitch.join(','), level: level.join(',') } }, reference: { chart: '0:2000:60:0,3000:2000:64:1' } };
  const summary = summarizeTake(document, { createdAt: 'x', songId: 's', song: 'S' });
  assert.equal(summary.score, 6200); assert.equal(summary.transpose, -2); assert.deepEqual(summary.phrases, [70, 55]); assert.equal(summary.phraseCount, 2);
  const at = midi => summary.voice[midi - LOW_MIDI];
  assert.ok(Math.abs(at(60) - 2) < .05, `Do4 ${at(60)}`);
  // Mi4 sounded 1.9 s inside its note (the first 100 ms fall after the take ended) and half a second was too quiet to count.
  assert.ok(Math.abs(at(64) - 1.4) < .05, `Mi4 ${at(64)}`);
  assert.equal(at(67), 0, 'the gap between notes is not counted');
  assert.equal(summarizeTake({ phrases: [] }, { createdAt: 'x', songId: 's', song: 'S' }).voice.every(v => v === 0), true);
});

test('the comfortable range is where most of the singing falls, once there is enough of it', () => {
  assert.equal(voiceRange([take({ voice: bins({ 52: 100 }) })]), null, 'one take is not enough');
  assert.equal(voiceRange([take({ voice: bins({ 52: 10 }) }), take({ voice: bins({ 55: 10 }) })]), null, 'twenty seconds are not enough');
  const range = voiceRange([take({ voice: bins({ 50: 5, 52: 40, 55: 40, 59: 40, 64: 30, 70: 5 }) }), take({ createdAt: '2026-10-21T10:00:00Z', voice: bins({ 52: 20, 60: 20 }) })]);
  assert.ok(range.low > 51 && range.low < 53, `low ${range.low}`); assert.ok(range.high > 63 && range.high < 65, `high ${range.high}`);
  assert.ok(range.middle > 54 && range.middle < 60);
});

test('the key suggestion keeps the song in the singer\'s range, prefers the original key and allows another octave', () => {
  const voice = { low: 52, high: 64, middle: 57, seconds: 400 };
  // A low song (Do#3–Sol#3) goes up three semitones.
  assert.deepEqual(suggestKey(voice, { low: 49, high: 56, middle: 52, seconds: 90 }), { steps: 3, octave: 0, above: 0, below: 0, originalOverflow: 3 });
  // A song that already fits stays in its key.
  assert.deepEqual(suggestKey(voice, { low: 54, high: 62, middle: 58, seconds: 90 }), { steps: 0, octave: 0, above: 0, below: 0, originalOverflow: 0 });
  // A song an octave above the singer is sung an octave lower, in its own key.
  const high = suggestKey(voice, { low: 65, high: 75, middle: 70, seconds: 90 });
  assert.equal(high.octave, -1); assert.equal(high.steps, 0); assert.equal(high.above + high.below, 0);
  // A song wider than the voice gets the shift that leaves the least outside.
  const wide = suggestKey(voice, { low: 47, high: 66, middle: 56, seconds: 90 });
  assert.ok(wide.above + wide.below <= 7.01 && Math.abs(wide.steps) <= 5);
  assert.equal(songRange([{ midi: 60, duration: 2 }]), null, 'too little map to judge');
  const range = songRange([{ midi: 55, duration: 4 }, { midi: 60, duration: 4 }, { midi: 64, duration: 2 }]);
  assert.ok(range.low >= 54.5 && range.low < 55.5 && range.high > 63 && range.high <= 64.5);
});

test('weak phrases come from recent whole-song takes on the same map, weakest first', () => {
  const takes = [
    take({ createdAt: '2026-10-20T10:00:00Z', phrases: [80, 30, 90] }), take({ createdAt: '2026-10-21T10:00:00Z', phrases: [60, 50, 95] }),
    take({ createdAt: '2026-10-22T10:00:00Z', phrase: 1, phrases: [100] }), take({ createdAt: '2026-10-22T11:00:00Z', phrases: [0, 0, 0, 0], phraseCount: 4 }),
    take({ songId: 'b', phrases: [0, 0, 0] }),
  ];
  assert.deepEqual(weakPhrases(takes, 'a', 3), [{ phrase: 1, accuracy: 40, takes: 2 }]);
  assert.deepEqual(weakPhrases(takes, 'a', 3, 5, 3, 75).map(item => item.phrase), [1, 0]);
  assert.deepEqual(weakPhrases(takes, 'missing', 3), []);
});

test('progress groups takes by song, most recent first, with the best mark per level and lyrics', () => {
  const songs = songsProgress([
    take({ createdAt: '2026-10-20T10:00:00Z', score: 4000 }), take({ createdAt: '2026-10-22T10:00:00Z', score: 6000 }), take({ createdAt: '2026-10-23T10:00:00Z', score: 9000, phrase: 0 }),
    take({ createdAt: '2026-10-21T10:00:00Z', score: 7000, lyrics: .9 }), take({ songId: 'b', song: 'B', createdAt: '2026-10-24T10:00:00Z', score: 3000, difficulty: 'normal' }),
  ]);
  assert.deepEqual(songs.map(song => song.songId), ['b', 'a']);
  const a = songs[1];
  assert.equal(a.takes.length, 4); assert.deepEqual(a.full.map(item => item.score), [4000, 7000, 6000]);
  assert.deepEqual(a.best, { relaxed: 6000, 'relaxed+letra': 7000 });
});
