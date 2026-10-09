import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { detectPitch } from '../public/audio/dsp.js';
import { ScoreTracker, pitchQuality } from '../src/scoring.ts';
import { frequencyOf, song, noteAt } from '../src/song.ts';

function signal(frequency, rate = 16000, size = 1024, harmonic = false) {
  return Float32Array.from({ length: size }, (_, i) => 0.2 * Math.sin(2 * Math.PI * frequency * i / rate) + (harmonic ? 0.12 * Math.sin(4 * Math.PI * frequency * i / rate) : 0));
}

test('detects known vocal-range tones at 16, 44.1 and 48 kHz within 15 cents', () => {
  for (const rate of [16000, 44100, 48000]) for (const frequency of [82.41, 130.81, 220, 261.63, 440, 659.25, 880]) {
    const detected = detectPitch(signal(frequency, rate, rate === 16000 ? 1024 : 2048), rate);
    assert.ok(detected.frequency, `${rate} Hz / ${frequency} Hz is detected`);
    assert.ok(Math.abs(1200 * Math.log2(detected.frequency / frequency)) < 15, `${rate} Hz / ${frequency} Hz is accurate`);
  }
});

test('worklet decimation retains fundamental with harmonics', () => {
  for (const rate of [44100, 48000]) for (const frequency of [82.41, 130.81, 261.63, 440, 880]) {
    const raw = signal(frequency, rate, 2048, true);
    const stride = Math.floor(rate / 16000);
    const compact = Float32Array.from({ length: Math.floor(raw.length / stride) }, (_, i) => {
      let sum = 0;
      for (let j = 0; j < stride; j++) sum += raw[i * stride + j] / stride;
      return sum;
    });
    const detected = detectPitch(compact, rate / stride);
    assert.ok(detected.frequency);
    assert.ok(Math.abs(1200 * Math.log2(detected.frequency / frequency)) < 15);
  }
});

test('actual worklet processes 128-sample blocks at 44.1, 48 and 96 kHz', () => {
  const source = readFileSync(new URL('../public/audio/pitch-processor.js', import.meta.url), 'utf8').replace("import { detectPitch } from './dsp.js';", '');
  for (const rate of [44100, 48000, 96000]) for (const frequency of [65.41, 130.81, 261.63, 880]) {
    const messages = [];
    let Processor;
    const sandbox = { sampleRate: rate, currentTime: 0, Float32Array, detectPitch, AudioWorkletProcessor: class { port = { postMessage: data => messages.push(data) }; }, registerProcessor: (_name, impl) => { Processor = impl; } };
    runInNewContext(source, sandbox);
    const processor = new Processor();
    for (let frame = 0; frame < rate * 0.15; frame += 128) {
      sandbox.currentTime = frame / rate;
      processor.process([[Float32Array.from({ length: 128 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * frequency * (frame + i) / rate))]]);
    }
    assert.ok(messages.length >= 3);
    const last = messages.at(-1);
    assert.ok(last.frequency, `${rate} Hz device must detect ${frequency} Hz`);
    assert.ok(Math.abs(1200 * Math.log2(last.frequency / frequency)) < 15);
    assert.ok(last.span >= 0.021 && last.span < 0.025);
    assert.ok(last.time < sandbox.currentTime);
  }
});

test('silence, DC offset, low level and seeded noise have no confident pitch', () => {
  for (const data of [new Float32Array(1024), new Float32Array(1024).fill(0.4), signal(220).map(x => x / 100)]) assert.equal(detectPitch(data, 16000).frequency, null);
  let seed = 123;
  const noise = Float32Array.from({ length: 1024 }, () => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed / 2 ** 32 - 0.5) * 0.5; });
  assert.equal(detectPitch(noise, 16000).frequency, null);
});

test('detector completes a batch within a generous real-time CPU budget', () => {
  const data = signal(261.63);
  const begin = performance.now();
  for (let i = 0; i < 200; i++) detectPitch(data, 16000);
  const averageMs = (performance.now() - begin) / 200;
  assert.ok(averageMs < 20, `average ${averageMs.toFixed(3)} ms should fit inside a frame budget`);
});

test('correct, detuned, octave and uncertain pitches receive distinct credit', () => {
  assert.equal(pitchQuality(440, 69), 1);
  assert.ok(pitchQuality(frequencyOf(69.8), 69) > 0);
  assert.ok(pitchQuality(frequencyOf(69.8), 69) < 0.7);
  assert.equal(pitchQuality(880, 69), 0);
  assert.equal(pitchQuality(null, 69), 0);
  assert.equal(pitchQuality(440, 69, 0.4), 0);
});

function performanceRun(pitch, step = 0.01) {
  const tracker = new ScoreTracker(song.notes);
  for (let time = step; time <= song.duration + step / 2; time += step) {
    const target = noteAt(time - step / 2);
    tracker.sample(time, step, target ? pitch(target) : null);
  }
  return tracker.summary(song.duration);
}

test('full correct performance scores near 10000; silence and octave errors score zero', () => {
  assert.ok(performanceRun(note => frequencyOf(note.midi)).score >= 9990);
  assert.equal(performanceRun(() => null).score, 0);
  assert.equal(performanceRun(note => frequencyOf(note.midi + 12)).score, 0);
});

test('score uses duration, not frame count', () => {
  const slow = performanceRun(note => frequencyOf(note.midi), 0.02);
  const fast = performanceRun(note => frequencyOf(note.midi), 0.005);
  assert.ok(Math.abs(slow.score - fast.score) < 75);
});

test('no score in rests, countdown or beyond song; duplicate frames cannot inflate score', () => {
  const tracker = new ScoreTracker([{ start: 2, duration: 1, midi: 69, phrase: 0, word: 'voz' }]);
  tracker.sample(-1, 0.05, 440);
  tracker.sample(1, 0.05, 440);
  assert.equal(tracker.summary(4).score, 0);
  tracker.sample(2.5, 0.05, 440);
  const first = tracker.summary(4).score;
  tracker.sample(2.5, 0.05, 440);
  tracker.sample(2.3, 0.05, 440);
  tracker.sample(4, 0.05, 440);
  assert.equal(tracker.summary(4).score, first);
});

test('missing frames never gain the missing duration; coverage and combo require sustained singing', () => {
  const tracker = new ScoreTracker(song.notes);
  tracker.sample(0.8, 0.8, frequencyOf(60));
  const result = tracker.summary(song.duration);
  assert.ok(result.score < 100);
  assert.equal(result.bestCombo, 0);
  assert.ok(result.coverage < 1);
});
