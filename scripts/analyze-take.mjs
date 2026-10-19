// Studies a downloaded take ("Descargar resultado"): what the microphone captured, how each level of demand scores it
// and, given the song's prepared folder, how the singer compares with the original voice of the recording.
//
//   node scripts/analyze-take.mjs <resultado.json> [--prepared <carpeta con manifest.json y vocals.wav>] [--unsung 0-17,75-94]
//
// The prepared folder is what scripts/audio/prepare.py writes for the song's source audio. --unsung drops the notes of
// instrumental stretches (seconds) when the result predates reference.chart and the map has to come from that folder.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectPitch } from '../public/audio/dsp.js';
import { DIFFICULTIES, ScoreTracker } from '../src/scoring.ts';
import { LevelStats, levelGate } from '../src/capture.ts';
import { frequencyOf, midiOf } from '../src/song.ts';
import { recordingReference } from '../src/voice-reference.ts';

const numbers = text => text ? text.split(',').map(Number) : [];
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : NaN; };
const fold = cents => cents - 1200 * Math.round(cents / 1200);
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const noteName = midi => ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'][((Math.round(midi) % 12) + 12) % 12] + (Math.floor(Math.round(midi) / 12) - 1);
const share = (list, test) => list.length ? Math.round(100 * list.filter(test).length / list.length) : 0;

/** A PCM16 WAV as mono samples. */
export function readWav(file) {
  const bytes = readFileSync(file);
  let at = 12, format = null, data = null;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ') format = { channels: bytes.readUInt16LE(at + 10), rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    if (id === 'data') { data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size)); break; }
    at += 8 + size + (size & 1);
  }
  if (!format || !data || format.bits !== 16) throw new Error(`${file}: se esperaba un WAV PCM de 16 bits.`);
  const frames = Math.floor(data.length / (2 * format.channels)), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { let sum = 0; for (let c = 0; c < format.channels; c++) sum += data.readInt16LE((i * format.channels + c) * 2); mono[i] = sum / format.channels / 32768; }
  return { rate: format.rate, mono };
}

/** Pitch readings of recorded audio, framed the way public/audio/pitch-processor.js frames the live microphone. */
export function wavReadings({ rate, mono }) {
  const size = Math.max(2048, Math.ceil(rate * 0.043 / 128) * 128), hop = Math.ceil(rate * 0.021 / 128) * 128, stride = Math.max(1, Math.floor(rate / 16000)), readings = [];
  for (let end = size; end <= mono.length; end += hop) {
    const compact = new Float32Array(Math.floor(size / stride));
    for (let i = 0; i < compact.length; i++) for (let j = 0; j < stride; j++) compact[i] += mono[end - size + i * stride + j] / stride;
    readings.push({ ...detectPitch(compact, rate / stride, 0.0015), time: end / rate - size / (2 * rate), span: hop / rate });
  }
  return readings;
}

/** The readings of a take, in song time already compensated for the delay it was sung with. */
export function takeReadings(result) {
  const trace = result.capture?.trace;
  if (!trace) throw new Error('Este resultado no trae el trazo de afinación (es anterior a la revisión 2G).');
  const times = numbers(trace.times).map(ms => ms / 1000), pitch = numbers(trace.pitch), level = numbers(trace.level), offset = (result.capture.offsetMs || 0) / 1000;
  const span = median(times.slice(1).map((time, i) => time - times[i])) || 1024 / 48000;
  return times.map((time, i) => ({ time: time - offset, span, frequency: pitch[i] ? frequencyOf(pitch[i] / 100) : null, confidence: 1, rms: level[i] / 10000 }));
}

/** The chart the take was sung against: the one saved in the result, or the prepared map without its unsung stretches. */
export function chartOf(result, prepared, unsung = []) {
  // The saved chart carries the written notes, not their pitch curves: Estricta is only approximate from it.
  if (result.reference?.chart) return numbers(result.reference.chart.replaceAll(':', ',')).reduce((notes, value, i, all) => i % 4 ? notes : [...notes, { start: value / 1000, duration: all[i + 1] / 1000, midi: all[i + 2], phrase: all[i + 3], word: '', ...(result.experimentalMap ? { source: 'automatic' } : {}) }], []);
  if (!prepared) throw new Error('El resultado no incluye el mapa cantado: indica --prepared con la carpeta de la canción.');
  const instrumental = time => unsung.some(([from, to]) => time >= from && time < to);
  return JSON.parse(readFileSync(join(prepared, 'manifest.json'), 'utf8')).analysis.notes
    .filter(note => !instrumental(note.start + note.duration / 2))
    .map(note => ({ ...note, word: '', phrase: 0, source: 'automatic', phraseLabel: '' }));
}

/** The silence gate the take's own levels call for. */
export function gateOf(readings) { const stats = new LevelStats(); for (const reading of readings) stats.add(reading.rms); return { gate: levelGate(stats.idle, stats.voice), idle: stats.idle, voice: stats.voice }; }

export function score(chart, readings, difficulty, gate, shift = 0, ceiling = undefined) {
  const tracker = new ScoreTracker(chart, difficulty, gate, ceiling);
  for (const reading of readings) tracker.sample(reading.time - shift, reading.span, reading.frequency, reading.confidence, reading.rms);
  return tracker.summary(Infinity);
}

/** Cents between each voiced reading and the closest pitch a reference offers within the window around that instant. */
export function differences(voiced, reference, window) {
  const pairs = []; let from = 0;
  for (const reading of voiced) {
    while (from < reference.length && reference[from].end < reading.time - window) from++;
    let best = null;
    for (let i = from; i < reference.length && reference[i].start <= reading.time + window; i++) { const cents = fold((reading.midi - reference[i].midi) * 100); if (best === null || Math.abs(cents) < Math.abs(best)) best = cents; }
    if (best !== null) pairs.push({ time: reading.time, cents: best });
  }
  return pairs;
}

function describe(label, pairs) {
  if (!pairs.length) { console.log(`  ${label}: sin lecturas comparables`); return; }
  const buckets = {}; for (const pair of pairs) { const key = Math.round(pair.cents / 100); buckets[key] = (buckets[key] || 0) + 1; }
  console.log(`  ${label} (${pairs.length} lecturas)`);
  console.log(`    en la nota (±50 cents) ${share(pairs, p => Math.abs(p.cents) <= 50)} % · hasta un semitono ${share(pairs, p => Math.abs(p.cents) <= 100)} % · hasta dos ${share(pairs, p => Math.abs(p.cents) <= 200)} %`);
  console.log(`    por debajo de la nota ${share(pairs, p => p.cents < -50)} % · por encima ${share(pairs, p => p.cents > 50)} % · mediana ${Math.round(median(pairs.map(p => p.cents)))} cents`);
  console.log('    por semitonos: ' + Object.keys(buckets).map(Number).sort((a, b) => a - b).map(key => `${key > 0 ? '+' : ''}${key}: ${Math.round(100 * buckets[key] / pairs.length)} %`).join(' · '));
}

function report(file, options) {
  const result = JSON.parse(readFileSync(file, 'utf8'));
  const readings = takeReadings(result), chart = chartOf(result, options.prepared, options.unsung), { gate, idle, voice } = gateOf(readings);
  console.log(`«${result.song}» · ${result.createdAt} · ${result.microphone?.label || 'micrófono sin identificar'}`);
  console.log(`La app mostró ${result.score} puntos con exigencia ${result.difficulty} (${result.scoringVersion}) · cobertura ${result.coverage} % · afinación ${result.intonation} % · retraso ${result.capture.offsetMs} ms${result.capture.automaticOffset ? ' automático' : ''}`);
  console.log(`Mapa cantado: ${chart.length} notas, ${chart.reduce((sum, note) => sum + note.duration, 0).toFixed(1)} s${result.reference?.omittedNotes ? ` (${result.reference.omittedNotes} fuera de la letra)` : ''}`);
  console.log(`Nivel: reposo ${idle.toFixed(4)} · voz ${voice.toFixed(4)} · umbral de silencio ${gate.toFixed(4)} (la toma usó ${result.levelGate.toFixed(4)}) · altavoces ${result.capture.speakerBleed ? 'detectados' : 'no'}\n`);

  console.log('PUNTUACIÓN CON LAS REGLAS ACTUALES');
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const s = score(chart, readings, difficulty, gate);
    console.log(`  ${DIFFICULTIES[difficulty].label.padEnd(9)} ${String(s.score).padStart(5)} puntos${s.rawScore !== undefined && s.rawScore !== s.score ? ` (${s.rawScore} sin ajustar a una voz real)` : ''} · cobertura ${s.coverage} % · afinación ${s.intonation} % · desviación ${s.meanAbsoluteCents} cents (media ${s.meanSignedCents})`);
  }
  const control = [17.3, 31.7, -23.4, 53.9].map(shift => score(chart, readings, result.difficulty in DIFFICULTIES ? result.difficulty : 'normal', gate, shift).score);
  console.log(`  Control: la misma voz contra otra parte de la canción daría ${Math.round(control.reduce((a, b) => a + b, 0) / control.length)} puntos.`);

  const voiced = readings.filter(reading => reading.frequency && reading.rms >= gate).map(reading => ({ time: reading.time, midi: midiOf(reading.frequency) }));
  const notes = chart.map(note => ({ start: note.start, end: note.start + note.duration, midi: note.midi }));
  console.log('\nDÓNDE ESTUVO LA VOZ RESPECTO A LAS NOTAS');
  const against = differences(voiced, notes, .12);
  describe('Frente al mapa, con 120 ms de margen', against);
  console.log('    por tramos de 20 s (mediana · en la nota):');
  for (let from = 0; from < (result.reference?.audioDuration || 0); from += 20) { const here = against.filter(pair => pair.time >= from && pair.time < from + 20); if (here.length > 40) console.log(`      ${clock(from)}–${clock(from + 20)}  ${String(Math.round(median(here.map(pair => pair.cents)))).padStart(5)} cents · ${share(here, pair => Math.abs(pair.cents) <= 50)} %`); }

  if (!options.prepared || !existsSync(join(options.prepared, 'vocals.wav'))) { console.log('\nSin --prepared no se puede comparar con la voz original.'); return; }
  // Since encore-intonation-5 the saved chart is in the key the take was sung; the recording is always in its own key.
  const key = Number(String(result.scoringVersion).split('-').at(-1)) >= 5 && result.reference?.chart ? result.transpose || 0 : 0;
  const recordingChart = key ? chart.map(note => ({ ...note, midi: note.midi - key })) : chart;
  const original = wavReadings(readWav(join(options.prepared, 'vocals.wav'))), originalGate = gateOf(original).gate;
  const tones = original.filter(reading => reading.frequency && reading.rms >= originalGate).map(reading => ({ start: reading.time, end: reading.time, midi: midiOf(reading.frequency) + key }));
  console.log(`\nLA VOZ ORIGINAL AISLADA (${tones.length} lecturas con tono; ${share(tones, tone => tone.midi - key < 48)} % por debajo de Do3, donde suele colarse el bajo)`);
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const s = score(recordingChart, original, difficulty, originalGate), reference = recordingReference(recordingChart, original, difficulty), take = score(chart, readings, difficulty, gate, 0, reference.ceiling);
    const scale = DIFFICULTIES[difficulty].ceiling === 1 ? 'Estricta no cambia de escala' : reference.usable ? `en la escala de esta grabación la toma vale ${take.score}` : 'no sirve de referencia: la toma sigue en la escala general';
    console.log(`  ${DIFFICULTIES[difficulty].label.padEnd(9)} ${String(s.rawScore).padStart(5)} sobre el máximo teórico · cobertura ${s.coverage} % · afinación ${s.intonation} % · ${scale}`);
  }
  console.log('\nLA VOZ DE LA TOMA FRENTE A LA VOZ ORIGINAL, sin pasar por el mapa');
  describe('En el mismo instante, ±100 ms', differences(voiced, tones.filter(tone => tone.midi - key >= 48), .1));
  const chance = [13.7, 27.3, -19.1, 41.9].map(shift => share(differences(voiced.map(reading => ({ ...reading, time: reading.time + shift })), tones.filter(tone => tone.midi - key >= 48), .1), pair => Math.abs(pair.cents) <= 50));
  console.log(`    al azar (contra otra parte de la canción): ${Math.round(chance.reduce((a, b) => a + b, 0) / chance.length)} % en la nota`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args.splice(index, 2)[1]; };
  const prepared = option('--prepared'), unsung = (option('--unsung') || '').split(',').filter(Boolean).map(range => range.split('-').map(Number));
  if (!args[0]) { console.error('Uso: node scripts/analyze-take.mjs <resultado.json> [--prepared <carpeta>] [--unsung 0-17,75-94]'); process.exit(1); }
  try { report(args[0], { prepared, unsung }); } catch (error) { console.error(error.message); process.exit(1); }
}
