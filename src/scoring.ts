import { midiOf } from './song.ts';
import type { Note } from './song.ts';
import { evaluationWindow, LEVEL_GATE, pitchError, referenceMidiAt, reliablePitch } from './pitch-reference.ts';

export const SCORING_VERSION = 'encore-intonation-3';

export type Difficulty = 'relaxed' | 'normal' | 'strict';
// Cents of full and of zero credit. Strict is the tuner-like rule of encore-intonation-2: exact octave, following the recorded curve.
export const DIFFICULTIES: Record<Difficulty, { label: string; full: number; zero: number; foldOctaves: boolean; nominal: boolean }> = {
  relaxed: { label: 'Relajada', full: 100, zero: 200, foldOctaves: true, nominal: true },
  normal: { label: 'Normal', full: 50, zero: 150, foldOctaves: true, nominal: true },
  strict: { label: 'Estricta', full: 35, zero: 100, foldOctaves: false, nominal: false },
};
const credit = (cents: number, difficulty: Difficulty) => Math.max(0, Math.min(1, (DIFFICULTIES[difficulty].zero - cents) / (DIFFICULTIES[difficulty].zero - DIFFICULTIES[difficulty].full)));

export function pitchQuality(frequency: number | null, targetMidi: number, confidence = 1, difficulty: Difficulty = 'strict'): number {
  if (!reliablePitch(frequency, confidence, .1) || !Number.isFinite(targetMidi)) return 0;
  let cents = (midiOf(frequency!) - targetMidi) * 100;
  if (DIFFICULTIES[difficulty].foldOctaves) cents -= 1200 * Math.round(cents / 1200);
  return credit(Math.abs(cents), difficulty);
}

export interface Reading { time: number; span: number; frequency: number | null; confidence: number; rms: number }
/** What the capture chain measured around a microphone performance. */
export interface CaptureReport {
  offsetMs: number; automaticOffset: boolean; reportedLatencyMs: number | null;
  noiseFloor: number | null; speakerBleed: boolean;
  suggestion: { offsetMs: number; score: number } | null;
}
export type Summary = ReturnType<ScoreTracker['summary']> & { capture?: CaptureReport };

export class ScoreTracker {
  chart: Note[];
  difficulty: Difficulty;
  gate: number;
  earned: number[];
  voiced: number[];
  analyzed: number[];
  signal: number[];
  lowerOctave: number[];
  upperOctave: number[];
  windows: ReturnType<typeof evaluationWindow>[];
  phraseGroups: { phrase: number; indices: number[] }[];
  noteAbsoluteCents: number[];
  noteSignedCents: number[];
  absoluteCents = 0;
  signedCents = 0;
  lastEnd = -Infinity;
  private cursor = 0;
  private ordered: boolean;
  constructor(chart: Note[], difficulty: Difficulty = 'strict', gate = LEVEL_GATE) {
    this.chart = chart;
    this.difficulty = difficulty;
    this.gate = gate;
    this.earned = chart.map(() => 0);
    this.voiced = chart.map(() => 0);
    this.analyzed = chart.map(() => 0);
    this.signal = chart.map(() => 0);
    this.lowerOctave = chart.map(() => 0);
    this.upperOctave = chart.map(() => 0);
    this.windows = chart.map(evaluationWindow);
    this.ordered = this.windows.every((window, i) => i === 0 || window.start >= this.windows[i - 1].end - 1e-9);
    this.noteAbsoluteCents = chart.map(() => 0);
    this.noteSignedCents = chart.map(() => 0);
    const groups = new Map<number, number[]>();
    chart.forEach((note, i) => { const indices = groups.get(note.phrase) || []; indices.push(i); groups.set(note.phrase, indices); });
    this.phraseGroups = [...groups].map(([phrase, indices]) => ({ phrase, indices }));
  }
  sample(time: number, span: number, frequency: number | null, confidence = 1, rms = frequency ? 0.1 : 0) {
    if (!Number.isFinite(time) || !Number.isFinite(span) || span <= 0) return;
    // Cap gaps and reject duplicate/out-of-order windows. Silence/missing frames never earn points.
    const start = Math.max(time - Math.min(span, 0.08), this.lastEnd);
    if (time <= start) return;
    this.lastEnd = time;
    const reliable = reliablePitch(frequency, confidence, rms, this.gate);
    const rules = DIFFICULTIES[this.difficulty], midi = reliable ? midiOf(frequency!) : 0;
    // An ordered chart never revisits the notes behind a window that only moves forward.
    if (this.ordered) while (this.cursor < this.windows.length && this.windows[this.cursor].end <= start) this.cursor++;
    for (let index = this.ordered ? this.cursor : 0; index < this.chart.length; index++) {
      const note = this.chart[index], window = this.windows[index];
      if (this.ordered && window.start >= time) break;
      const left = Math.max(start, window.start), right = Math.min(time, window.end);
      const overlap = Math.max(0, right - left);
      if (!overlap) continue;
      this.analyzed[index] += overlap;
      if (Number.isFinite(rms) && rms >= this.gate) this.signal[index] += overlap;
      if (reliable) {
        this.voiced[index] += overlap;
        // Integrate the same continuous reference used by the visual tuner.
        const parts = Math.ceil(overlap / .01);
        for (let part = 0; part < parts; part++) {
          const weight = overlap / parts, at = left + weight * (part + .5);
          const octave = midi - referenceMidiAt(note, at), difference = pitchError(note, at, midi, rules.foldOctaves, rules.nominal);
          this.earned[index] += weight * credit(Math.abs(difference * 100), this.difficulty);
          this.absoluteCents += weight * Math.abs(difference * 100);
          this.noteAbsoluteCents[index] += weight * Math.abs(difference * 100);
          this.noteSignedCents[index] += weight * difference * 100;
          this.signedCents += weight * difference * 100;
          if (Math.abs(octave + 12) <= 1) this.lowerOctave[index] += weight;
          if (Math.abs(octave - 12) <= 1) this.upperOctave[index] += weight;
        }
      }
    }
  }
  summary(time: number) {
    const available = this.windows.reduce((sum, window) => sum + Math.max(0, Math.min(window.duration, time - window.start)), 0);
    const total = this.windows.reduce((sum, window) => sum + window.duration, 0);
    const earned = this.earned.reduce((sum, value) => sum + value, 0);
    const voiced = this.voiced.reduce((sum, value) => sum + value, 0);
    const phraseDiagnostics = this.phraseGroups.map(({ phrase, indices }) => {
      const sum = (values: number[]) => indices.reduce((value, i) => value + values[i], 0);
      const reference = indices.reduce((value, i) => value + this.windows[i].duration, 0);
      const elapsed = indices.reduce((value, i) => value + Math.max(0, Math.min(this.windows[i].duration, time - this.windows[i].start)), 0);
      const sung = sum(this.voiced), credit = sum(this.earned);
      const percent = (value: number, denominator: number) => denominator ? Math.round(Math.min(1, value / denominator) * 100) : 0;
      return {
        phrase, start: this.chart[indices[0]].start, end: this.windows[indices.at(-1)!].end,
        referenceSeconds: Math.round(reference * 1000) / 1000,
        evaluatedSeconds: Math.round(elapsed * 1000) / 1000,
        sungSeconds: Math.round(sung * 1000) / 1000,
        analyzedSeconds: Math.round(sum(this.analyzed) * 1000) / 1000,
        signalSeconds: Math.round(sum(this.signal) * 1000) / 1000,
        accuracy: percent(credit, reference), coverage: percent(sung, elapsed),
        analyzedCoverage: percent(sum(this.analyzed), elapsed), signalCoverage: percent(sum(this.signal), elapsed),
        intonation: sung ? percent(credit, sung) : null,
        meanAbsoluteCents: sung ? Math.round(sum(this.noteAbsoluteCents) / sung) : null,
        meanSignedCents: sung ? Math.round(sum(this.noteSignedCents) / sung) || 0 : null,
      };
    });
    let combo = 0, bestCombo = 0;
    this.chart.forEach((_note, i) => {
      if (this.windows[i].end > time) return;
      combo = this.earned[i] / this.windows[i].duration >= 0.65 ? combo + 1 : 0;
      bestCombo = Math.max(bestCombo, combo);
    });
    return {
      scoringVersion: SCORING_VERSION, difficulty: this.difficulty, levelGate: this.gate,
      referenceSeconds: Math.round(total * 1000) / 1000,
      excludedBoundarySeconds: Math.round((this.chart.reduce((sum, n) => sum + n.duration, 0) - total) * 1000) / 1000,
      sungSeconds: Math.round(voiced * 1000) / 1000,
      intonation: voiced ? Math.round(Math.min(1, earned / voiced) * 100) : null,
      meanAbsoluteCents: voiced ? Math.round(this.absoluteCents / voiced) : null,
      meanSignedCents: voiced ? Math.round(this.signedCents / voiced) || 0 : null,
      score: total ? Math.round(Math.min(1, earned / total) * 10000) : 0,
      accuracy: available ? Math.round(Math.min(1, earned / available) * 100) : 0,
      coverage: available ? Math.round(Math.min(1, this.voiced.reduce((a, b) => a + b, 0) / available) * 100) : 0,
      analyzedCoverage: available ? Math.round(Math.min(1, this.analyzed.reduce((a, b) => a + b, 0) / available) * 100) : 0,
      signalCoverage: available ? Math.round(Math.min(1, this.signal.reduce((a, b) => a + b, 0) / available) * 100) : 0,
      lowerOctaveCoverage: available ? Math.round(Math.min(1, this.lowerOctave.reduce((a, b) => a + b, 0) / available) * 100) : 0,
      upperOctaveCoverage: available ? Math.round(Math.min(1, this.upperOctave.reduce((a, b) => a + b, 0) / available) * 100) : 0,
      combo, bestCombo,
      phrases: phraseDiagnostics.map(phrase => phrase.accuracy),
      phraseDiagnostics,
    };
  }
}

/** Re-scores a finished performance at other capture delays and proposes one only when it clearly explains the singing better. Reading times are uncompensated song time. */
export function estimateOffset(chart: Note[], readings: Reading[], appliedMs: number, difficulty: Difficulty, gate = LEVEL_GATE) {
  const scoreAt = (ms: number) => {
    const tracker = new ScoreTracker(chart, difficulty, gate);
    for (const reading of readings) tracker.sample(reading.time - ms / 1000, reading.span, reading.frequency, reading.confidence, reading.rms);
    return tracker.summary(Infinity).score;
  };
  const current = scoreAt(appliedMs);
  let best = { offsetMs: appliedMs, score: current };
  for (let ms = 0; ms <= 300; ms += 10) { const score = scoreAt(ms); if (score > best.score) best = { offsetMs: ms, score }; }
  // A chance alignment of wrong notes moves a low score a little; a real delay recovers a large share of it.
  return Math.abs(best.offsetMs - appliedMs) >= 30 && best.score >= 1500 && best.score - current >= Math.max(500, current * .1) ? best : null;
}

export function performanceFeedback(summary: Summary, transpose = 0, canTranspose = true, experimentalMap = false) {
  // Folded difficulties credit any octave, so singing in another one is not something to correct.
  const anyOctave = DIFFICULTIES[summary.difficulty]?.foldOctaves;
  if (summary.analyzedCoverage < 50) return { title: 'Faltaron datos del micrófono.', detail: 'El análisis no recibió suficientes muestras. Prueba la entrada elegida antes de repetir; este resultado no permite valorar tu canto.' };
  if (summary.signalCoverage < 5) return { title: 'La señal llegó muy baja o en silencio.', detail: 'Selecciona tu micrófono y pulsa Probar micrófono. Comprueba que la barra responde, revisa el volumen de entrada y acércate un poco.' };
  if (summary.capture?.speakerBleed && (summary.coverage < 60 || (summary.intonation ?? 0) < 50)) return { title: 'El micrófono captó la música de los altavoces.', detail: 'Durante la cuenta atrás el micrófono oyó los clics de la pista: la música se mezcló con tu voz y el detector no pudo seguirla. Ponte auriculares y repite; este resultado no permite valorar tu canto.' };
  if (summary.coverage < 10) return { title: 'Llegó sonido, pero faltó un tono claro.', detail: 'Prueba el micrófono sin música y sostén una vocal. Usa auriculares y comprueba que el dispositivo elegido capta tu voz.' };
  if (summary.coverage < 60) return { title: 'Se detectó tono en parte de la referencia.', detail: `Hubo tono evaluable en el ${summary.coverage}% del tiempo de referencia y la afinación durante ese tiempo fue del ${summary.intonation ?? 0}%. La puntuación combina ambas medidas. Si cantaste todo el tramo, revisa el nivel del micrófono y la sincronización.${experimentalMap ? ' Comprueba también las notas del mapa automático: este resultado no permite atribuir la diferencia solo a tu canto.' : ''}` };
  const lower = !anyOctave && summary.lowerOctaveCoverage > 20 && summary.lowerOctaveCoverage >= summary.coverage * 0.5, upper = !anyOctave && summary.upperOctaveCoverage > 20 && summary.upperOctaveCoverage >= summary.coverage * 0.5;
  if (!canTranspose && (lower || upper)) return { title: 'Tu tono estuvo en otra octava del mapa.', detail: 'Elige la exigencia Normal o Relajada para cantar en la octava que te resulte cómoda, o comprueba en la biblioteca que las notas representan la voz que quieres cantar.' };
  if (lower) return { title: 'Tu tono estuvo una octava más grave.', detail: transpose > -12 ? `Se detectaron notas parecidas a la melodía, una octava por debajo. Prueba el registro ${transpose === 12 ? 'Original' : 'Grave'}: bajará la guía y las notas que evaluamos.` : 'La voz quedó por debajo del registro Grave, que es el mínimo de este ejercicio. Comprueba el micrófono y prueba a seguir la guía en una altura cómoda; todavía no hay un registro inferior.' };
  if (upper) return { title: 'Tu tono estuvo una octava más agudo.', detail: transpose < 12 ? `Se detectaron notas parecidas a la melodía, una octava por encima. Prueba el registro ${transpose === -12 ? 'Original' : 'Agudo'}: subirá la guía y las notas que evaluamos.` : 'La voz quedó por encima del registro Agudo, que es el máximo de este ejercicio. Comprueba el micrófono y prueba a seguir la guía; todavía no hay un registro superior.' };
  if (summary.intonation !== null && summary.intonation < 50) return { title: 'El tono detectado tuvo poca coincidencia con la referencia.', detail: `La afinación durante el tono evaluable fue del ${summary.intonation}%. Compara tu tono con el afinador y revisa la sincronización.${experimentalMap ? ' Revisa la voz aislada y el mapa automático antes de concluir que la diferencia procede de tu canto.' : ''}` };
  return { title: 'Cada intento cuenta.', detail: 'Esta evaluación combina afinación y tiempo cantado. Las palabras aún no se califican.' };
}

export function phraseFeedback(phrase: Summary['phraseDiagnostics'][number]) {
  if (!phrase.evaluatedSeconds) return 'Tramo aún no evaluado';
  if (phrase.analyzedCoverage < 50) return 'Faltaron muestras de análisis';
  if (phrase.signalCoverage < 5) return 'Señal baja o silencio en la referencia';
  if (phrase.coverage < 10) return 'Sonido recibido, poco tono fiable';
  if (phrase.accuracy === 0) return `Puntuación combinada inferior al 0,5 % · Afinación ${phrase.intonation}% · Cobertura ${phrase.coverage}%`;
  return `Afinación ${phrase.intonation}% · Cobertura ${phrase.coverage}%`;
}
