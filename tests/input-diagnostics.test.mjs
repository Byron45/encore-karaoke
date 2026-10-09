import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoreTracker, performanceFeedback } from '../src/scoring.ts';
import { frequencyOf, notesInRegister, song } from '../src/song.ts';

function run({ transpose = 0, voiceOffset = 0, silence = false, noise = false } = {}) {
  const chart = notesInRegister(transpose);
  const tracker = new ScoreTracker(chart);
  for (let time = 0.01; time <= song.duration; time += 0.01) {
    const note = chart.find(note => time - 0.005 >= note.start && time - 0.005 < note.start + note.duration);
    const frequency = note && !silence && !noise ? frequencyOf(note.midi + voiceOffset) : null;
    tracker.sample(time, 0.01, frequency, 1, noise ? 0.12 : frequency ? 0.12 : 0);
  }
  return tracker.summary(song.duration);
}

test('zero caused by silence, noise, octave and wrong notes gives different diagnoses', () => {
  assert.match(performanceFeedback(run({ silence: true })).title, /silencio/);
  assert.match(performanceFeedback(run({ noise: true })).title, /faltó un tono claro/);
  const low = run({ voiceOffset: -12 });
  assert.equal(low.score, 0); assert.ok(low.coverage > 99);
  assert.match(performanceFeedback(low).detail, /registro Grave/);
  const wrong = run({ voiceOffset: 3 });
  assert.equal(wrong.score, 0); assert.match(performanceFeedback(wrong).title, /poca coincidencia/);
});

test('missing processor samples are not presented as bad singing', () => {
  assert.match(performanceFeedback(new ScoreTracker(song.notes).summary(song.duration)).title, /Faltaron datos/);
});

test('correct performances in all three registers earn full credit', () => {
  for (const transpose of [-12, 0, 12]) {
    const result = run({ transpose });
    assert.ok(result.score >= 9990);
    assert.ok(result.signalCoverage >= 99);
    assert.ok(result.analyzedCoverage >= 99);
  }
});

test('octave advice is relative to the register of the performed session', () => {
  assert.match(performanceFeedback(run({ transpose: -12, voiceOffset: 12 }), -12).detail, /registro Original/);
  assert.match(performanceFeedback(run({ transpose: 12, voiceOffset: -12 }), 12).detail, /registro Original/);
  assert.match(performanceFeedback(run({ transpose: -12, voiceOffset: -12 }), -12).detail, /mínimo/);
  assert.match(performanceFeedback(run({ transpose: 12, voiceOffset: 12 }), 12).detail, /máximo/);
});
