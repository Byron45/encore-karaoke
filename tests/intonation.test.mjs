import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { detectPitch } from '../public/audio/dsp.js';
import { ScoreTracker, pitchQuality } from '../src/scoring.ts';
import { referenceMidiAt, tuningReading, evaluationWindow, validPitchCurve } from '../src/pitch-reference.ts';
import { frequencyOf } from '../src/song.ts';
import { exportMap, importMap, validateNotes } from '../src/library-model.ts';
const note = { start: 0, duration: 1, midi: 60, phrase: 0, word: '', source: 'automatic', confidence: .9, phraseLabel: 'Vocal', pitchCurve: [[0, -40], [.5, 40], [1, -40]] };

test('continuous curve, tuner and score use the same reference including recorded tuning', () => {
  assert.equal(referenceMidiAt(note, .5), 60.4);
  const reading = tuningReading(note, .5, frequencyOf(60.9), 1, .1);
  assert.ok(Math.abs(reading.cents - 50) < 1e-8);
  assert.equal(tuningReading(note, .5, 440, .2, .1).cents, null);
  assert.equal(tuningReading(note, .01, 440, 1, .1).cents, null);
  for (const cents of [0, -10, 25, -50, 100, -100, 1200]) {
    const tracker = new ScoreTracker([note]);
    for (let t = .005; t <= 1.0001; t += .005) tracker.sample(t, .005, frequencyOf(referenceMidiAt(note, t - .0025) + cents / 100));
    const result = tracker.summary(1);
    assert.ok(Math.abs(result.meanAbsoluteCents - Math.abs(cents)) <= 1);
    assert.ok(Math.abs(result.meanSignedCents - cents) <= 1);
    assert.ok(Math.abs(result.score / 10000 - pitchQuality(frequencyOf(60 + cents / 100), 60)) < .002);
    assert.equal(result.referenceSeconds, .96);
  }
});

test('low level, absent and invalid pitch never earns points; coverage is independent of intonation', () => {
  for (const args of [[440, 1, 0], [440, NaN, .1], [440, Infinity, .1], [Infinity, 1, .1], [440, 1, NaN], [null, 1, .1]]) {
    const tracker = new ScoreTracker([{ ...note, midi: 69, pitchCurve: undefined }]);
    for (let t = .01; t <= 1; t += .01) tracker.sample(t, .01, ...args);
    assert.equal(tracker.summary(1).score, 0); assert.equal(tracker.summary(1).intonation, null);
  }
  const tracker = new ScoreTracker([{ ...note, pitchCurve: undefined }]);
  for (let t = .01; t <= 1; t += .01) tracker.sample(t, .01, t < .5 ? frequencyOf(60) : null);
  const result = tracker.summary(1);
  assert.equal(result.intonation, 100); assert.ok(result.coverage >= 48 && result.coverage <= 51);
  assert.ok(result.score >= 4800 && result.score <= 5100);
});

test('automatic note guards remove time from both numerator and denominator, keeping 80 ms minimum', () => {
  for (const duration of [.08, .1, .12, 1]) {
    const window = evaluationWindow({ ...note, duration });
    assert.ok(window.duration >= .08 - 1e-9);
    assert.ok(window.start >= 0 && window.start <= .02);
  }
  assert.equal(evaluationWindow({ ...note, source: undefined }).duration, 1);
});

test('version 3 exports continuous pitch without loss and rejects invalid or oversized curves', () => {
  const record = { notes: [note], duration: 1, audioHash: 'test' };
  const data = exportMap(record); assert.equal(data.schemaVersion, 3);
  assert.deepEqual(importMap(JSON.stringify(data), record), [note]);
  assert.deepEqual(validateNotes([note], 1), []);
  for (const curve of [[], [[0, 0]], [[0, 0], [.5, 0], [.5, 0], [1, 0]], [[0, 0], [1.5, 0]], [[0, 0], [1, 201]], [[0, NaN], [1, 0]]]) assert.equal(validPitchCurve(curve, 1), false);
});

const worklet = readFileSync(new URL('../public/audio/pitch-processor.js', import.meta.url), 'utf8').replace("import { detectPitch } from './dsp.js';", '');
function pcmPerformance(rate, duration, delay = 0, cents = 0, expressive = false) {
  const curve = expressive ? Array.from({ length: Math.round(duration / .02) + 1 }, (_, i) => [i * .02, 30 * Math.sin(2 * Math.PI * 5 * i * .02) + 40 * i * .02 / duration - 20]) : [[0, 0], [duration, 0]];
  const chart = Array.from({ length: 12 }, (_, i) => ({ ...note, start: .25 + i * duration, duration, midi: i % 2 ? 64 : 60, pitchCurve: curve }));
  const tracker = new ScoreTracker(chart); let Processor;
  const scope = { sampleRate: rate, currentTime: 0, Float32Array, detectPitch, AudioWorkletProcessor: class { port = { postMessage: d => tracker.sample(d.time, d.span, d.frequency, d.confidence, d.rms) }; }, registerProcessor: (_name, value) => { Processor = value; } };
  runInNewContext(worklet, scope); const processor = new Processor(); let phase = 0;
  const end = .25 + duration * 12 + .15;
  for (let frame = 0; frame < end * rate; frame += 128) {
    scope.currentTime = frame / rate;
    const samples = Float32Array.from({ length: 128 }, (_, i) => {
      const time = (frame + i) / rate - delay, active = chart.find(n => n.start <= time && time < n.start + n.duration);
      if (!active) return 0;
      phase += 2 * Math.PI * frequencyOf(referenceMidiAt(active, time) + cents / 100) / rate;
      return .15 * Math.sin(phase) + .04 * Math.sin(2 * phase);
    });
    processor.process([[samples]]);
  }
  return tracker.summary(end);
}
test('PCM through real worklet and score handles short transitions, rates, lateness and wrong notes', () => {
  for (const rate of [44100, 48000, 96000]) for (const duration of [.12, .25, 1]) {
    const result = pcmPerformance(rate, duration);
    assert.ok(result.score > 9500, `${rate}/${duration}: ${result.score}`);
    assert.ok(result.meanAbsoluteCents < 15);
  }
  const onTime = pcmPerformance(48000, .12), late = pcmPerformance(48000, .12, .08), wrong = pcmPerformance(48000, .25, 0, 100);
  assert.ok(late.score < onTime.score * .4); assert.ok(wrong.score < 500);
});

test('PCM vibrato and slides are compared with the continuous recording reference', () => {
  for (const rate of [44100, 48000]) {
    const result = pcmPerformance(rate, 1, 0, 0, true);
    assert.ok(result.score > 9300, `${rate}: ${result.score}`);
    assert.ok(result.meanAbsoluteCents < 25, `${rate}: ${result.meanAbsoluteCents}`);
  }
});
