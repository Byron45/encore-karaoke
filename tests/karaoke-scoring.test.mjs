import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScoreTracker, DIFFICULTIES, VOICE_CEILING, encodeTrace, estimateOffset, performanceFeedback, pitchQuality } from '../src/scoring.ts';
import { resultDocument } from '../src/result.ts';
import { hearsCountIn, levelGate, LevelStats, LOUD_LEVEL_GATE, noiseFloor, reportedLatency } from '../src/capture.ts';
import { phrasesOf, playable, sungNotes, validateNotes } from '../src/library-model.ts';
import { LEVEL_GATE, MIN_LEVEL_GATE, tuningReading } from '../src/pitch-reference.ts';
import { frequencyOf, song } from '../src/song.ts';
import { sweepStaleJobs } from '../server/preparation.mjs';
import { MIN_RECORDING_SHARE, recordingReference } from '../src/voice-reference.ts';
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
// The rules are checked on the theoretical maximum; the scale a singer sees has its own test.
const score = (...args) => sing(...args).summary.rawScore;
const written = note => note.midi;

test('the sung difficulties are scaled to what a real voice can reach; strict stays on the theoretical maximum', () => {
  // A voice with pitch 80 % of the time, in tune: every fifth reading is a consonant.
  const voiced = difficulty => { const tracker = new ScoreTracker(song.notes, difficulty); let i = 0; for (let time = 0; time < 32; time += HOP) { const note = noteAt(song.notes, time), sung = note && i++ % 5; tracker.sample(time, HOP, sung ? frequencyOf(note.midi) : null, 1, sung ? .1 : 0); } return tracker.summary(32); };
  for (const difficulty of ['relaxed', 'normal']) {
    const summary = voiced(difficulty);
    assert.equal(summary.ceiling, VOICE_CEILING); assert.ok(summary.rawScore > 7700 && summary.rawScore < 8100, `raw ${summary.rawScore}`);
    assert.ok(Math.abs(summary.score - summary.rawScore / VOICE_CEILING) <= 1, `${summary.score} from ${summary.rawScore}`);
    assert.equal(summary.intonation, 100); assert.ok(summary.coverage >= 78 && summary.coverage <= 81, 'what was measured is not scaled');
    assert.ok(summary.phrases.every(value => value >= 90 && value <= 96), `phrases ${summary.phrases}`);
  }
  const strict = voiced('strict');
  assert.equal(strict.ceiling, 1); assert.equal(strict.score, strict.rawScore);
  // Nothing goes past the top, and nothing sung wrong is lifted off the bottom.
  assert.equal(sing(song.notes, 'normal', written).summary.score, 10000);
  assert.equal(sing(song.notes, 'relaxed', note => note.midi + 6).summary.score, 0);
  assert.equal(sing(song.notes, 'normal', () => null).summary.score, 0);
});

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
  assert.equal(new ScoreTracker(song.notes).summary(0).scoringVersion, 'encore-intonation-5');
  assert.deepEqual(DIFFICULTIES.strict, { label: 'Estricta', full: 35, zero: 100, foldOctaves: false, nominal: false, timing: 0, ceiling: 1 });
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
  // Strict has no timing allowance, so every delay costs and the estimate is exact.
  for (const latency of [.08, .12, .2]) {
    const { summary, readings } = sing(quick, 'strict', written, { latency });
    const estimate = estimateOffset(quick, readings, 0, 'strict');
    assert.ok(estimate, `${latency} s must be noticed`);
    assert.ok(Math.abs(estimate.offsetMs - latency * 1000) <= 20, `${latency}: ${estimate.offsetMs}`);
    assert.ok(estimate.score > 9000 && estimate.score > summary.score + 1500);
    // With that delay already applied there is nothing left to propose.
    assert.equal(estimateOffset(quick, readings, estimate.offsetMs, 'strict'), null);
  }
  // The sung difficulties forgive a short delay themselves; one past their allowance is still found, and found exactly,
  // because the fit is judged before the scale flattens the top.
  for (const difficulty of ['normal', 'relaxed']) {
    const late = sing(quick, difficulty, written, { latency: .25 }), estimate = estimateOffset(quick, late.readings, 0, difficulty);
    assert.ok(estimate, `${difficulty} must notice 250 ms`);
    assert.ok(Math.abs(estimate.offsetMs - 250) <= 20, `${difficulty}: ${estimate.offsetMs}`);
    assert.ok(estimate.score > late.summary.score + 1500, `${difficulty}: ${late.summary.score} → ${estimate.score}`);
    assert.equal(estimateOffset(quick, late.readings, estimate.offsetMs, difficulty), null);
  }
  assert.equal(estimateOffset(quick, sing(quick, 'normal', written).readings, 0, 'normal'), null);
  assert.equal(estimateOffset(quick, sing(quick, 'normal', note => note.midi + 6).readings, 0, 'normal'), null);
  assert.equal(estimateOffset(quick, sing(quick, 'normal', () => null).readings, 0, 'normal'), null);
});

test('the silence gate follows the singer: default at a normal level, lower only for a clear quiet voice', () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
  // Resting level, singer's level -> gate.
  close(levelGate(.0043, .099), .01188);          // a headset: just above its own leak
  close(levelGate(.003, .04), LEVEL_GATE);
  close(levelGate(.002, .3), LOUD_LEVEL_GATE);    // a loud voice never pushes it past this
  close(levelGate(.0005, .02), .005);             // a quiet microphone
  close(levelGate(.0001, .003), MIN_LEVEL_GATE);
  close(levelGate(0, .0042), MIN_LEVEL_GATE);
  // Nothing stands out from the resting level: a held tone, an empty room, or only what the headphones leak.
  for (const [idle, voice] of [[.1, .1], [.0033, .0065], [0, 0], [.004, .012]]) close(levelGate(idle, voice), LEVEL_GATE);
  // With the speakers heard in the count-in it is never lowered.
  close(levelGate(.0005, .02, true), LEVEL_GATE); close(levelGate(.0043, .099, true), .01188);

  const stats = new LevelStats();
  for (let i = 0; i < 1000; i++) stats.add(i < 450 ? .004 : i < 500 ? .012 : .08);
  assert.ok(Math.abs(stats.idle - .004) < .0004); assert.ok(Math.abs(stats.voice - .08) < .008); assert.equal(stats.count, 1000);
  stats.add(NaN); assert.equal(stats.count, 1000);
  const silent = new LevelStats(); for (let i = 0; i < 100; i++) silent.add(i < 60 ? 0 : .1);
  assert.equal(silent.idle, 0); assert.ok(silent.voice > .09);
  assert.equal(new LevelStats().voice, 0);

  const soft = { rms: .004 };
  assert.equal(score(song.notes, 'normal', written, soft), 0);
  assert.ok(score(song.notes, 'normal', written, { ...soft, gate: levelGate(0, .004) }) > 9800);
  // Sound without a pitch earns nothing whatever the gate.
  const tracker = new ScoreTracker(song.notes, 'relaxed', MIN_LEVEL_GATE);
  for (let time = 0; time < 32; time += HOP) tracker.sample(time, HOP, null, 0, .05);
  assert.equal(tracker.summary(32).score, 0); assert.equal(tracker.summary(32).signalCoverage, 100); assert.equal(tracker.summary(32).coverage, 0);
  assert.equal(noiseFloor([{ time: 0, rms: .1 }]), null);
});

test('what headphones leak into their microphone scores nothing, in the introduction or between phrases', () => {
  // A song with a played introduction, a sung verse, an instrumental break and another verse. The guide sounds the map's own notes.
  const chart = [[2, 6], [12, 30], [34, 40], [44, 62]].flatMap(([from, to], phrase) => Array.from({ length: Math.floor((to - from) / .5) }, (_, i) => ({ start: from + i * .5, duration: .4, midi: 60 + [0, 2, 4, 5, 7][i % 5], phrase, word: 'la' })));
  const sung = time => time >= 12 && time < 30 || time >= 44 && time < 62;
  const levels = new LevelStats(), readings = [];
  let seed = 4; const random = () => { seed = seed * 1664525 + 1013904223 >>> 0; return seed / 2 ** 32; };
  for (let time = 0; time < 64; time += HOP) {
    const note = noteAt(chart, time), voice = note && sung(time);
    // The leak carries the guide at the level of a quiet room; the singer is twenty times louder.
    const rms = voice ? .05 + .08 * random() : .0035 + (note ? .004 * random() : .001 * random());
    readings.push({ time, span: HOP, frequency: note ? frequencyOf(note.midi) : null, confidence: 1, rms }); levels.add(rms);
  }
  const play = gate => { const tracker = new ScoreTracker(chart, 'normal', gate); for (const r of readings) tracker.sample(r.time, r.span, r.frequency, r.confidence, r.rms); return tracker.summary(64); };
  const gate = levelGate(levels.idle, levels.voice);
  assert.ok(gate > .009 && gate <= LOUD_LEVEL_GATE, `gate ${gate}`);
  const fair = play(gate), fooled = play(.0054);
  // The earlier gate, tied to the noise of the room, let the song score itself where nobody sang.
  assert.ok(fooled.phrases[0] > 30 && fooled.phrases[2] > 30, `fooled ${fooled.phrases}`);
  assert.deepEqual([fair.phrases[0], fair.phrases[2]], [0, 0]);
  assert.ok(fair.phrases[1] > 95 && fair.phrases[3] > 95, `sung ${fair.phrases}`);
  assert.equal(fair.phraseDiagnostics[0].signalCoverage, 0); assert.equal(fair.phraseDiagnostics[0].intonation, null);
  // Nobody singing at all: the leak alone does not stand out from the resting level, so the default gate holds.
  const empty = new LevelStats(); for (const r of readings) empty.add(Math.min(r.rms, .0075));
  assert.equal(levelGate(empty.idle, empty.voice), LEVEL_GATE);
});

const lrc = raw => ({ raw, format: 'lrc', offset: 0 });
const automatic = (start, duration = .3, midi = 60) => ({ start, duration, midi, word: '', phrase: 0, source: 'automatic', confidence: .9, phraseLabel: 'Sección vocal 1' });

test('with line-timed lyrics an automatic map keeps only the notes inside a sung line', () => {
  const lyrics = lrc('[00:10.00]Primera línea\n[00:20.00]Segunda línea\n[00:30.00]\n[00:45.00]Tercera línea\n[00:55.00]');
  const notes = [1, 4, 8.5, 9.4, 10.2, 15, 21, 29.5, 31, 38, 43.5, 44.6, 46, 54, 56, 58].map(start => automatic(start));
  const kept = sungNotes(notes, lyrics, 60);
  // Out: the introduction (1, 4, 8.5), the break (31, 38, 43.5) and what follows the last line (56, 58). In: a second of lead-in (9.4, 44.6).
  assert.deepEqual(kept.map(note => note.start), [9.4, 10.2, 15, 21, 29.5, 44.6, 46, 54]);
  assert.deepEqual(kept.map(note => note.phrase), [0, 0, 0, 1, 1, 2, 2, 2]);
  assert.deepEqual(phrasesOf(kept), ['Primera línea', 'Segunda línea', 'Tercera línea']);
  assert.deepEqual(validateNotes(kept, 60), []);
  assert.equal(notes[0].phraseLabel, 'Sección vocal 1', 'the saved map is not modified');

  // The lyric offset moves the lines, and the notes follow them.
  assert.deepEqual(sungNotes(notes, { ...lyrics, offset: -6 }, 60).map(note => note.start).slice(0, 3), [4, 8.5, 9.4]);
  // Untouched: no lyrics, plain lyrics, a map written by hand, or lyrics that fit none of the notes.
  const manual = notes.map(note => ({ ...note, source: undefined, word: 'la' }));
  assert.equal(sungNotes(notes, undefined, 60), notes);
  assert.equal(sungNotes(notes, { raw: 'Sin tiempos', format: 'plain', offset: 0 }, 60), notes);
  assert.equal(sungNotes(manual, lyrics, 60), manual);
  assert.equal(sungNotes([automatic(1), automatic(4)], lyrics, 60).length, 2);

  const record = { id: 'x', title: 'Canción', artist: '', duration: 60, bpm: null, notes, lyrics, audioHash: 'h', audioName: 'a.mp3', updatedAt: '' };
  const song = playable(record);
  assert.equal(song.notes.length, 8); assert.equal(song.omittedNotes, 8); assert.equal(song.phrases.length, 3); assert.equal(record.notes.length, 16);
  const document = resultDocument(new ScoreTracker(song.notes, 'normal').summary(60), 'microphone', { accompaniment: 'original', vocalGain: 1, transpose: 0, offsetMs: 0, microphone: null }, song);
  assert.equal(document.reference.omittedNotes, 8); assert.equal(document.reference.noteCount, 8);
  assert.equal(document.reference.chart.split(',')[0], '9400:300:60:0'); assert.equal(document.reference.chart.split(',').length, 8);
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
  assert.match(performanceFeedback({ ...fine, capture: { speakerBleed: true } }).title, /Gran interpretación/);
});

test('the result says how the take went and, when the voice leans one way, which way', () => {
  // Every third note a tone and a half away, the rest in tune but leaning by `cents`.
  const take = (cents, wrong = 0) => sing(song.notes, 'normal', note => note.midi + (wrong && song.notes.indexOf(note) % wrong === 0 ? 3 : cents / 100)).summary;
  assert.equal(performanceFeedback(take(0)).title, '¡Gran interpretación!');
  assert.doesNotMatch(performanceFeedback(take(0)).detail, /cents/);
  // One note in three wrong, then one in two: the headline follows the score a singer sees.
  assert.equal(performanceFeedback(take(0, 3)).title, 'Muy bien cantada.');
  assert.equal(performanceFeedback(take(0, 2)).title, 'Buen intento.');
  const halfHearted = { ...take(0), score: 4500, intonation: 55, coverage: 70 };
  assert.equal(performanceFeedback(halfHearted).title, 'Cada intento cuenta.');
  // A steady lean is named, with the direction to move in.
  const flat = performanceFeedback(take(-70)), sharp = performanceFeedback(take(80));
  assert.match(flat.detail, /70 cents más grave/); assert.match(flat.detail, /subir un poco/); assert.match(flat.detail, /oído libre/);
  assert.match(sharp.detail, /80 cents más agudo/); assert.match(sharp.detail, /bajar un poco/);
  // Low and leaning: that is the headline.
  const low = performanceFeedback(take(-120), 0, true, true);
  assert.equal(low.title, 'Cantaste por debajo de la nota.'); assert.match(low.detail, /120 cents más grave/); assert.match(low.detail, /Ver trazo/); assert.match(low.detail, /mapa es automático/);
  assert.equal(performanceFeedback(take(125)).title, 'Cantaste por encima de la nota.');
  // Too far to be a lean, or errors both ways: no direction is claimed.
  assert.equal(performanceFeedback(take(300)).title, 'El tono detectado tuvo poca coincidencia con la referencia.');
  const mixed = sing(song.notes, 'normal', note => note.midi + (song.notes.indexOf(note) % 2 ? .9 : -.9)).summary;
  assert.doesNotMatch(performanceFeedback(mixed).detail, /más grave|más agudo/);
});

test("the recording's own voice sets the scale of a prepared song; a voice read poorly leaves the general one", () => {
  // An isolated voice in tune that has pitch in a given share of every note, and near silence between notes.
  const isolated = share => { const list = []; let i = 0; for (let time = 0; time < 32; time += HOP) { const note = noteAt(song.notes, time), voiced = note && i++ % 20 < share * 20; list.push({ time, span: HOP, frequency: voiced ? frequencyOf(note.midi) : null, confidence: 1, rms: voiced ? .1 : .0005 }); } return list; };
  const clean = recordingReference(song.notes, isolated(.95), 'normal');
  assert.ok(clean.usable); assert.ok(clean.ceiling > .9 && clean.ceiling < .97, `ceiling ${clean.ceiling}`); assert.equal(clean.score, 10000);
  assert.equal(clean.rawScore, Math.round(clean.ceiling * 10000));
  // A take on that scale: the recording is the top, and the same credit is worth less than on the general scale.
  const take = difficulty => { const tracker = new ScoreTracker(song.notes, difficulty, LEVEL_GATE, clean.ceiling); for (const reading of isolated(.8)) tracker.sample(reading.time, reading.span, reading.frequency, 1, reading.rms); return tracker.summary(32); };
  const scaled = take('normal');
  assert.equal(scaled.ceiling, clean.ceiling); assert.ok(Math.abs(scaled.score - scaled.rawScore / clean.ceiling) <= 1);
  assert.ok(scaled.score < Math.round(scaled.rawScore / VOICE_CEILING), `${scaled.score} on the recording's scale`);
  // The offset suggestion is worded on the same scale as the take.
  const late = isolated(.8).map(reading => ({ ...reading, time: reading.time + .15 }));
  const suggestion = estimateOffset(song.notes, late, 0, 'normal', LEVEL_GATE, clean.ceiling);
  assert.ok(Math.abs(suggestion.offsetMs - 150) <= 20, `offset ${suggestion.offsetMs}`); assert.ok(Math.abs(suggestion.score - scaled.score) <= 150, `${suggestion.score} vs ${scaled.score}`);
  // Bass or instruments left in the voice by the separation: the recording is not a fair top, the general scale stays.
  const poor = recordingReference(song.notes, isolated(MIN_RECORDING_SHARE - .1), 'relaxed');
  assert.equal(poor.usable, false); assert.equal(poor.ceiling, VOICE_CEILING); assert.ok(poor.score < 10000);
  // Estricta keeps its tuner scale and only reports what the recording earns.
  const strict = recordingReference(song.notes, isolated(.95), 'strict');
  assert.equal(strict.ceiling, 1); assert.equal(strict.score, strict.rawScore);
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
