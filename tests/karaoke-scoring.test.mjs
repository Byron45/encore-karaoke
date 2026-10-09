import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScoreTracker, DIFFICULTIES, encodeTrace, estimateOffset, performanceFeedback, pitchQuality } from '../src/scoring.ts';
import { resultDocument } from '../src/result.ts';
import { hearsCountIn, levelGate, noiseFloor, reportedLatency } from '../src/capture.ts';
import { LEVEL_GATE, MIN_LEVEL_GATE, tuningReading } from '../src/pitch-reference.ts';
import { frequencyOf, song } from '../src/song.ts';
import { sweepStaleJobs } from '../server/preparation.mjs';
import { detectPitch } from '../public/audio/dsp.js';

const HOP = 0.0213;
const noteAt = (chart, time) => chart.find(note => time >= note.start && time < note.start + note.duration);
/** Feeds a singer through the tracker the way the worklet does. `latency` delays what arrives, as a real audio chain would. */
function sing(chart, difficulty, voice, { latency = 0, rms = .1, gate } = {}) {
  const tracker = new ScoreTracker(chart, difficulty, gate), end = chart.at(-1).start + chart.at(-1).duration + .5, readings = [];
  for (let time = -.5; time < end; time += HOP) {
    const note = noteAt(chart, time - latency), midi = note ? voice(note, time - latency) : null;
    const reading = { time, span: HOP, frequency: midi === null ? null : frequencyOf(midi), confidence: 1, rms: midi === null ? 0 : rms };
    readings.push(reading); tracker.sample(time, HOP, reading.frequency, 1, reading.rms);
  }
  return { summary: tracker.summary(end), readings };
}
const score = (...args) => sing(...args).summary.score;
const written = note => note.midi;

test('folded difficulties credit any octave; strict keeps the octave exact', () => {
  for (const octave of [-24, -12, 12]) {
    assert.equal(score(song.notes, 'strict', note => note.midi + octave), 0);
    for (const difficulty of ['normal', 'relaxed']) assert.ok(score(song.notes, difficulty, note => note.midi + octave) > 9800, `${difficulty} ${octave}`);
  }
  const low = sing(song.notes, 'normal', note => note.midi - 12).summary;
  assert.ok(low.meanAbsoluteCents <= 1, 'the reported error is against the octave being matched');
  assert.ok(low.lowerOctaveCoverage > 90, 'the octave actually sung is still recorded');
  assert.doesNotMatch(performanceFeedback(low).title, /octava/);
  assert.match(performanceFeedback(sing(song.notes, 'strict', note => note.midi - 12).summary).title, /octava más grave/);
  assert.match(performanceFeedback(sing(song.notes, 'strict', note => note.midi - 12).summary, 0, false).detail, /Normal o Relajada/);
});

test('each difficulty has its own tolerance and a wrong note earns nothing in any of them', () => {
  const at = cents => Object.fromEntries(Object.keys(DIFFICULTIES).map(difficulty => [difficulty, score(song.notes, difficulty, note => note.midi + cents / 100)]));
  const quarter = at(50), semitone = at(100), tritone = at(600);
  assert.ok(quarter.strict > 7400 && quarter.strict < 7800); assert.ok(quarter.normal > 9800); assert.ok(quarter.relaxed > 9800);
  assert.equal(semitone.strict, 0); assert.ok(semitone.normal > 4800 && semitone.normal < 5100); assert.ok(semitone.relaxed > 9800);
  assert.deepEqual(tritone, { relaxed: 0, normal: 0, strict: 0 });
  assert.equal(pitchQuality(220, 69, 1, 'normal'), 1); assert.equal(pitchQuality(220, 69, 1, 'strict'), 0); assert.equal(pitchQuality(220, 69), 0);
  assert.equal(pitchQuality(frequencyOf(69.5), 69, 1, 'normal'), 1); assert.equal(pitchQuality(frequencyOf(71), 69, 1, 'relaxed'), 0);
});

test('strict is the previous scoring rule and the default of the tracker', () => {
  const voice = (note, time) => note.midi + .6 * Math.sin(time * 3);
  assert.deepEqual(sing(song.notes, undefined, voice).summary, sing(song.notes, 'strict', voice).summary);
  assert.equal(new ScoreTracker(song.notes).summary(0).scoringVersion, 'encore-intonation-3');
  assert.deepEqual(DIFFICULTIES.strict, { label: 'Estricta', full: 35, zero: 100, foldOctaves: false, nominal: false, timing: 0 });
});

// Back-to-back short notes, the shape automatic maps take: nothing but timing separates one from the next.
const run = Array.from({ length: 60 }, (_, i) => ({ start: 1 + i * .2, duration: .2, midi: 60 + [0, 2, 4, 5, 7, 5, 4, 2][i % 8], phrase: Math.floor(i / 10), word: 'la' }));

test('a note sung a little early or late still counts in the folded difficulties, not in strict', () => {
  for (const latency of [-.1, .1]) {
    assert.ok(score(run, 'normal', written, { latency }) > 9300, `normal ${latency}`);
    assert.ok(score(run, 'relaxed', written, { latency }) > 9300, `relaxed ${latency}`);
    assert.ok(score(run, 'strict', written, { latency }) < 6000, `strict ${latency}`);
  }
  // Beyond the allowance the neighbouring notes no longer explain the voice.
  assert.ok(score(run, 'normal', written, { latency: .3 }) < 6000);
  // The allowance is for timing, not for other melodies or a held note.
  assert.ok(score(run, 'normal', note => note.midi + 6) < 1500);
  assert.ok(score(run, 'normal', () => 61) < 3500);
  assert.ok(score(run, 'normal', written) > 9800);
});

test('the detector keeps a voice in noise and still finds no pitch in the noise alone', () => {
  let seed = 3;
  const uniform = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return (((t ^ t >>> 14) >>> 0) + .5) / 4294967296; };
  const noise = () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
  // As the worklet hears a 48 kHz microphone: three samples averaged into one at 16 kHz.
  const heard = signal => Float32Array.from({ length: 1024 }, (_, i) => (signal(3 * i) + signal(3 * i + 1) + signal(3 * i + 2)) / 3);
  let found = 0, close = 0, clear = 0, phantom = 0;
  for (let frame = 0; frame < 60; frame++) {
    // A sung note barely above the room: every one of these readings fell under the earlier threshold of 0.15.
    const reading = detectPitch(heard(i => .1 * Math.SQRT2 * Math.sin(2 * Math.PI * 220 * (frame * 3072 + i) / 48000) + .09 * noise()), 16000);
    if (reading.frequency) { found++; if (Math.abs(1200 * Math.log2(reading.frequency / 220)) < 100) close++; if (reading.confidence > .85) clear++; }
    if (detectPitch(heard(() => .09 * noise()), 16000).frequency) phantom++;
  }
  // This rough, the reading wobbles within the semitone but never lands on another note or octave.
  assert.ok(found >= 57, `detected ${found} of 60`); assert.ok(close >= found - 2, `right note ${close} of ${found}`); assert.ok(clear <= 3, `clear ${clear}`); assert.equal(phantom, 0);
});

test('folded difficulties accept the written note of a curved reference; strict follows the curve', () => {
  const vibrato = Array.from({ length: 51 }, (_, i) => [i * .02, 80 * Math.sin(2 * Math.PI * 5 * i * .02)]);
  const chart = [0, 1.2, 2.4].map((start, phrase) => ({ start, duration: 1, midi: 60 + phrase * 2, phrase, word: '', source: 'automatic', confidence: .9, phraseLabel: 'Vocal', pitchCurve: vibrato }));
  const strict = score(chart, 'strict', written), normal = score(chart, 'normal', written);
  assert.ok(strict < 8000, `strict ${strict}`);
  assert.ok(normal > 9800, `normal ${normal}`);
  // Imitating the recorded vibrato still earns full credit.
  const reading = tuningReading(chart[0], .04, frequencyOf(60 + .8 * Math.sin(2 * Math.PI * 5 * .04)), 1, .1, LEVEL_GATE, true, true);
  assert.ok(Math.abs(reading.cents) < 1);
  assert.ok(Math.abs(tuningReading(chart[0], .04, frequencyOf(48), 1, .1, LEVEL_GATE, true, true).cents) < 1, 'the tuner folds like the score');
  assert.ok(Math.abs(tuningReading(chart[0], .04, frequencyOf(48), 1, .1).cents + 1276) < 2, 'and stays literal under the strict rule');
});

test('an unordered chart scores the same as the ordered one', () => {
  const voice = (note, time) => note.midi + .3 * Math.sin(time * 7);
  const ordered = sing(song.notes, 'normal', voice).summary;
  const tracker = new ScoreTracker([...song.notes].reverse(), 'normal');
  for (let time = -.5; time < 32.5; time += HOP) { const note = noteAt(song.notes, time); tracker.sample(time, HOP, note ? frequencyOf(voice(note, time)) : null, 1, note ? .1 : 0); }
  assert.equal(tracker.summary(32.5).score, ordered.score);
});

const quick = Array.from({ length: 40 }, (_, i) => ({ start: 1 + i * .45, duration: .22, midi: 60 + [0, 2, 4, 5, 7][i % 5], phrase: Math.floor(i / 8), word: 'la' }));

test('a delayed performance yields the delay that explains it, and nothing when there is no clear gain', () => {
  for (const latency of [.08, .12, .2]) {
    const { summary, readings } = sing(quick, 'normal', written, { latency });
    const estimate = estimateOffset(quick, readings, 0, 'normal');
    assert.ok(estimate, `${latency} s must be noticed`);
    assert.ok(Math.abs(estimate.offsetMs - latency * 1000) <= 20, `${latency}: ${estimate.offsetMs}`);
    assert.ok(estimate.score > 9000 && estimate.score > summary.score + 1500);
    // With that delay already applied there is nothing left to propose.
    assert.equal(estimateOffset(quick, readings, estimate.offsetMs, 'normal'), null);
  }
  assert.equal(estimateOffset(quick, sing(quick, 'normal', written).readings, 0, 'normal'), null);
  assert.equal(estimateOffset(quick, sing(quick, 'normal', note => note.midi + 6).readings, 0, 'normal'), null);
  assert.equal(estimateOffset(quick, sing(quick, 'normal', () => null).readings, 0, 'normal'), null);
});

test('a quiet microphone lowers the silence gate; noise and leaked music never do', () => {
  assert.equal(levelGate(null, false), LEVEL_GATE);
  assert.equal(levelGate(.0002, false), MIN_LEVEL_GATE);
  assert.equal(levelGate(.002, false), .005);
  assert.equal(levelGate(.02, false), LEVEL_GATE);
  assert.equal(levelGate(.0002, true), LEVEL_GATE);
  const soft = { rms: .004 };
  assert.equal(score(song.notes, 'normal', written, soft), 0);
  assert.ok(score(song.notes, 'normal', written, { ...soft, gate: levelGate(.0005, false) }) > 9800);
  // Sound without a pitch earns nothing whatever the gate.
  const tracker = new ScoreTracker(song.notes, 'relaxed', MIN_LEVEL_GATE);
  for (let time = 0; time < 32; time += HOP) tracker.sample(time, HOP, null, 0, .05);
  assert.equal(tracker.summary(32).score, 0); assert.equal(tracker.summary(32).signalCoverage, 100); assert.equal(tracker.summary(32).coverage, 0);
  assert.equal(noiseFloor([{ time: 0, rms: .1 }]), null);
});

function countIn(level, { echo = 0, latency = .09, floor = .0005, extra = () => 0 } = {}) {
  const origin = 10, readings = [];
  for (let time = origin - 2.95; time < origin - .1; time += HOP) {
    const phase = ((time - (origin - 2.97) - latency) % .5 + .5) % .5;
    readings.push({ time, rms: floor + level(time) + (phase < .07 ? echo : 0) + extra(time) });
  }
  return { origin, readings };
}

test('the count-in clicks reveal speakers leaking into the microphone', () => {
  let seed = 5; const random = () => { seed = seed * 1664525 + 1013904223 >>> 0; return seed / 2 ** 32; };
  for (const latency of [.02, .09, .18, .27]) { const { origin, readings } = countIn(() => 0, { echo: .02, latency }); assert.equal(hearsCountIn(readings, origin), true, `echo after ${latency} s`); }
  const cases = {
    silence: countIn(() => 0),
    'steady noise': countIn(() => .03),
    'one cough': countIn(time => time > 8.2 && time < 8.35 ? .2 : 0),
    'random speech': countIn(() => random() < .3 ? .05 * random() : 0),
    'faint echo': countIn(() => 0, { echo: .002 }),
    'echo buried in noise': countIn(() => .03, { echo: .02 }),
  };
  for (const [name, { origin, readings }] of Object.entries(cases)) assert.equal(hearsCountIn(readings, origin), false, name);
  const quiet = countIn(() => 0, { echo: .02 });
  assert.ok(noiseFloor(quiet.readings) < .001, 'the clicks do not raise the measured floor');
  assert.equal(reportedLatency({ baseLatency: .01, outputLatency: .045 }, .012), 67);
  assert.equal(reportedLatency({}), 0); assert.equal(reportedLatency({ outputLatency: Infinity }), null);
});

test('leaked music is named as the cause instead of blaming the singer', () => {
  const poor = sing(song.notes, 'strict', note => note.midi - 12).summary;
  assert.match(performanceFeedback({ ...poor, capture: { speakerBleed: true } }).title, /música de los altavoces/);
  const fine = sing(song.notes, 'normal', written).summary;
  assert.match(performanceFeedback({ ...fine, capture: { speakerBleed: true } }).title, /Cada intento cuenta/);
});

test('the downloaded result carries the pitch trace as compact text and never the readings or any audio', () => {
  const { summary, readings } = sing(song.notes, 'normal', written);
  const capture = { offsetMs: 60, automaticOffset: true, reportedLatencyMs: 62, noiseFloor: .002, speakerBleed: false, suggestion: null, readings: readings.filter(reading => reading.time >= 0) };
  const document = JSON.parse(JSON.stringify(resultDocument({ ...summary, capture }, 'microphone', { accompaniment: 'original', vocalGain: 1, transpose: 0, offsetMs: 60, microphone: null }, { ...song, bpm: 120 })));
  assert.equal(document.capture.readings, undefined); assert.equal(document.capture.offsetMs, 60);
  const times = document.capture.trace.times.split(',').map(Number), pitch = document.capture.trace.pitch.split(',').map(Number), level = document.capture.trace.level.split(',').map(Number);
  assert.equal(times.length, capture.readings.length); assert.equal(pitch.length, times.length); assert.equal(level.length, times.length);
  assert.ok(times.every((time, i) => i === 0 || time > times[i - 1]));
  // The first note of the exercise is Do4 from 0 s; the rest between phrases has no tone.
  const first = times.findIndex(time => time > 100 && time < 700), rest = times.findIndex(time => time > 7200 && time < 7800);
  assert.equal(pitch[first], 6000); assert.equal(level[first], 1000); assert.equal(pitch[rest], 0);
  assert.ok(JSON.stringify(document).length < 60000, 'a 32-second take stays small');
  assert.deepEqual(encodeTrace([]), { times: '', pitch: '', level: '' });
  const plain = resultDocument(summary, 'microphone', { accompaniment: 'original', vocalGain: 1, transpose: 0, offsetMs: 0, microphone: null }, { ...song, bpm: 120 });
  assert.equal(plain.capture, undefined);
});

test('stale preparation folders are swept; recent ones and foreign files are kept', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'encore-jobs-'));
  try {
    const old = '11111111-1111-4111-8111-111111111111', recent = '22222222-2222-4222-8222-222222222222';
    for (const name of [old, recent, 'notas']) { await mkdir(path.join(root, name, 'result'), { recursive: true }); await writeFile(path.join(root, name, 'original.audio'), 'x'); }
    const past = new Date(Date.now() - 3 * 3600000);
    await utimes(path.join(root, old), past, past); await utimes(path.join(root, 'notas'), past, past);
    assert.deepEqual(await sweepStaleJobs(2 * 3600000, root), [old]);
    assert.deepEqual((await readdir(root)).sort(), [recent, 'notas'].sort());
    assert.deepEqual(await sweepStaleJobs(2 * 3600000, path.join(root, 'missing')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
