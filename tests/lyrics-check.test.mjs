import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLyrics, lyricWords, missedWords, normalizeWord, similarity, soundOf } from '../src/lyrics-check.ts';

// Heard words spread evenly over [start, end).
const sung = (text, start, end) => { const words = text.split(' '), step = (end - start) / words.length; return words.map((word, i) => ({ word, start: start + i * step, end: start + (i + 1) * step - .05 })); };
const cues = [{ start: 10, text: 'Te amo más que una estrella, mi cielo' }, { start: 14, text: '' }, { start: 20, text: 'y no me (no me) olvides jamás' }, { start: 24, text: 'Ñandú, hermosa voz' }];

test('words are compared as they sound, so the recogniser\'s spelling does not count', () => {
  assert.equal(normalizeWord('¡Estrella,'), 'estrella'); assert.equal(normalizeWord('Más'), 'mas'); assert.equal(normalizeWord('año'), 'año');
  assert.deepEqual(lyricWords('y no me (no me) olvides [x2] jamás'), ['y', 'no', 'me', 'olvides', 'jamas']);
  for (const [a, b] of [['vez', 'bes'], ['hermosa', 'ermosa'], ['cielo', 'sielo'], ['llorar', 'yorar'], ['quiero', 'kiero'], ['guerra', 'gerra']]) assert.equal(similarity(a, b), 1, `${a} / ${b}`);
  assert.notEqual(soundOf('año'), soundOf('ano'));
  assert.ok(similarity('mas', 'como') < .5); assert.ok(similarity('estrellas', 'estrella') >= .75);
});

test('the lyrics sung as written match every word, wherever in their line they fall', () => {
  const heard = [...sung('te amo más que una estrella mi cielo', 10.2, 13.5), ...sung('y no me olvides jamás', 20.5, 23), ...sung('ñandú hermosa voz', 24.1, 26)];
  const result = checkLyrics(cues, heard, 0, 30);
  assert.equal(result.expected, 16); assert.equal(result.matched, 16); assert.equal(result.score, 1);
  assert.ok(result.lines.every(line => !line.differences.length));
  assert.deepEqual(result.lines.map(line => line.line), [0, 2, 3], 'the empty cue is a rest, not a line');
});

test('a changed phrase is reported as what was sung instead of what the lyrics say, and lowers only its line', () => {
  const heard = [...sung('te amo como una estrella mi cielo', 10.2, 13.5), ...sung('y no me olvides jamás', 20.5, 23), ...sung('ñandú hermosa voz', 24.1, 26)];
  const result = checkLyrics(cues, heard, 0, 30), [first, second] = result.lines;
  assert.equal(first.matched, 6); assert.equal(first.expected, 8);
  assert.deepEqual(first.differences, [{ expected: 'mas que', sung: 'como' }]);
  assert.equal(second.matched, 5); assert.equal(result.score, 14 / 16);
});

test('silence counts as missing words, extra words do not lower a line, and only the lines of the take are judged', () => {
  const heard = [...sung('oh oh te amo más que una estrella mi cielo oh', 9.5, 13.9), ...sung('y no me olvides jamás', 20.5, 23)];
  const result = checkLyrics(cues, heard, 0, 30);
  assert.equal(result.lines[0].matched, 8); assert.deepEqual(result.lines[0].differences, []);
  assert.deepEqual(result.lines[2].differences, [{ expected: 'ñandu hermosa voz', sung: '' }]);
  // A practice of the second line only judges that line, even if earlier words were heard.
  const practice = checkLyrics(cues, heard, 18, 24);
  assert.deepEqual(practice.lines.map(line => line.line), [2]); assert.equal(practice.score, 1);
});

test('words written together or apart by the recogniser still match', () => {
  const lines = [{ start: 0, text: 'Nunca supe bien por qué' }, { start: 4, text: 'Que hay gente que nunca va a entender porqué' }, { start: 9, text: '' }];
  const result = checkLyrics(lines, [...sung('nunca supe bien porque', .2, 3.5), ...sung('que hay gente que nunca va a entender por que', 4.1, 8.5)], 0, 10);
  assert.equal(result.score, 1, JSON.stringify(result.lines.map(line => line.differences)));
});

test('words the recogniser misses in the recording itself are left out of the singer\'s check', () => {
  const lines = [{ start: 0, text: 'que distintos tú y yo' }, { start: 4, text: 'como hemos cambiado' }, { start: 8, text: '' }];
  // In the original voice "como hemos" is buried under the chorus and not heard.
  const recording = checkLyrics(lines, [...sung('que distintos tú y yo', .2, 3.5), ...sung('cambiado', 6, 7)], 0, 8);
  const ignore = missedWords(recording);
  assert.deepEqual([...ignore].sort(), ['1:0', '1:1']);
  // The singer is judged on the other six words: a wrong one there still counts, the buried ones do not.
  const singer = checkLyrics(lines, [...sung('que distintos tú y él', .2, 3.5), ...sung('cambiado', 6, 7)], 0, 8, ignore);
  assert.equal(singer.expected, 6); assert.equal(singer.matched, 5);
  assert.deepEqual(singer.lines[0].differences, [{ expected: 'yo', sung: 'el' }]); assert.deepEqual(singer.lines[1].differences, []);
  assert.deepEqual(singer.lines[0].missed, [4]);
});

test('a word heard far from its line does not count for it', () => {
  // The right words, but sung during the next line's time: they cannot fill the first line.
  const result = checkLyrics([{ start: 10, text: 'luz de día' }, { start: 13, text: 'otra frase distinta' }, { start: 30, text: '' }], sung('luz de día', 20, 22), 0, 30);
  assert.equal(result.lines[0].matched, 0); assert.equal(result.score, 0);
});
