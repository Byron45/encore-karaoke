import test from 'node:test';
import assert from 'node:assert/strict';
import { ScoreTracker, performanceFeedback, phraseFeedback } from '../src/scoring.ts';
import { resultDocument } from '../src/result.ts';

const note = { start: 0, duration: 1, midi: 69, phrase: 0, word: 'voz' };
const track = { title: 'Prueba', artist: '', duration: 5, bpm: null, notes: [note], phrases: ['voz'] };
const session = { accompaniment: 'original', vocalGain: 1, transpose: 0, offsetMs: 0, microphone: null };

test('feedback distinguishes low coverage from accurate singing and handles the reported nonzero result', () => {
  const tracker = new ScoreTracker([note]);
  for (let i = 1; i <= 100; i++) tracker.sample(i / 100, .01, i <= 12 ? 440 : null);
  const summary = tracker.summary(1), feedback = performanceFeedback(summary);
  assert.equal(summary.intonation, 100); assert.equal(summary.coverage, 12);
  assert.match(feedback.title, /parte de la referencia/);
  assert.match(feedback.detail, /100%/); assert.doesNotMatch(feedback.detail, /El cero|desafina/);
  const reported = { ...summary, score: 1019, accuracy: 10, intonation: 25, coverage: 40, signalCoverage: 44, analyzedCoverage: 100, meanAbsoluteCents: 175, meanSignedCents: 11 };
  const actual = performanceFeedback(reported, 0, false, true);
  assert.match(actual.detail, /40%/); assert.match(actual.detail, /25%/);
  assert.match(actual.detail, /mapa automático/); assert.doesNotMatch(actual.detail, /El cero/);
  const partial = { ...summary.phraseDiagnostics[0], accuracy: 0, coverage: 10, intonation: 4 };
  assert.match(phraseFeedback(partial), /Puntuación combinada inferior al 0,5 % · Afinación 4% · Cobertura 10%/);
});

test('zero phrase scores retain separate missing samples, low signal, unreliable pitch and wrong pitch evidence', () => {
  const notes = Array.from({ length: 4 }, (_, phrase) => ({ ...note, start: phrase, phrase }));
  const tracker = new ScoreTracker(notes);
  // Phrase 0 receives no frames; 1 silence; 2 loud noise; 3 a reliable wrong semitone.
  for (let i = 101; i <= 400; i++) {
    const phrase = Math.floor((i - 1) / 100);
    tracker.sample(i / 100, .01, phrase === 3 ? 466.164 : null, phrase === 2 ? .2 : 1, phrase === 1 ? 0 : .1);
  }
  const summary = tracker.summary(4);
  assert.deepEqual(summary.phrases, [0, 0, 0, 0]);
  assert.match(phraseFeedback(summary.phraseDiagnostics[0]), /Faltaron muestras/);
  assert.match(phraseFeedback(summary.phraseDiagnostics[1]), /Señal baja/);
  assert.match(phraseFeedback(summary.phraseDiagnostics[2]), /poco tono fiable/);
  assert.match(phraseFeedback(summary.phraseDiagnostics[3]), /inferior al 0,5/);
  assert.equal(summary.phraseDiagnostics[1].intonation, null);
  assert.equal(summary.phraseDiagnostics[2].signalSeconds, 1);
  assert.equal(summary.phraseDiagnostics[3].intonation, 0);
  assert.equal(summary.phraseDiagnostics[3].meanAbsoluteCents, 100);
});

test('mixed causes and opposite pitch errors survive aggregation and JSON export without storing audio', () => {
  const tracker = new ScoreTracker([note]);
  for (let i = 1; i <= 100; i++) tracker.sample(i / 100, .01, i <= 25 ? 440 * 2 ** (-2 / 12) : i <= 50 ? 440 * 2 ** (2 / 12) : null, i > 75 ? .2 : 1, i > 50 && i <= 75 ? 0 : .1);
  const summary = tracker.summary(1), phrase = summary.phraseDiagnostics[0];
  assert.equal(phrase.sungSeconds, .5); assert.equal(phrase.signalSeconds, .75); assert.equal(phrase.analyzedSeconds, 1);
  assert.equal(phrase.meanSignedCents, 0); assert.equal(phrase.meanAbsoluteCents, 200);
  const document = JSON.parse(JSON.stringify(resultDocument(summary, 'microphone', session, track)));
  assert.equal(document.version, 4); assert.deepEqual(document.phraseDiagnostics, [phrase]);
  assert.equal(document.scoringVersion, 'encore-intonation-4'); assert.equal(document.difficulty, 'strict');
  assert.equal(document.rawScore, document.score); assert.equal(document.ceiling, 1);
  assert.deepEqual(document.feedback, performanceFeedback(summary));
  assert.equal(document.reference.audioDuration, 5); assert.equal(document.reference.mappedSeconds, 1);
  assert.equal(document.audio, undefined); assert.equal(document.recording, undefined);
  const future = new ScoreTracker([note]).summary(0).phraseDiagnostics[0];
  assert.match(phraseFeedback(future), /aún no evaluado/);
});

test('free listening and simulated demo exports do not assert a microphone diagnosis', () => {
  const summary = new ScoreTracker([note]).summary(1);
  const free = resultDocument(summary, 'demo', session, { ...track, notes: [], phrases: [] });
  assert.equal(free.mode, 'listen'); assert.equal(free.scored, false); assert.equal(free.score, null);
  assert.equal(free.phraseDiagnostics, undefined); assert.equal(free.feedback, undefined);
  const demo = resultDocument(summary, 'demo', session, track);
  assert.equal(demo.simulated, true); assert.equal(demo.feedback, undefined);
});
