import { midiOf } from './song.ts';
import type { Note } from './song.ts';
import { evaluationWindow, referenceMidiAt, reliablePitch } from './pitch-reference.ts';

export const SCORING_VERSION = 'encore-intonation-2';

export function pitchQuality(frequency: number | null, targetMidi: number, confidence = 1): number {
  if (!reliablePitch(frequency, confidence, .1) || !Number.isFinite(targetMidi)) return 0;
  const cents = Math.abs((midiOf(frequency!) - targetMidi) * 100);
  // Full credit within 35 cents; a whole semitone or octave wrong earns zero.
  return Math.max(0, Math.min(1, (100 - cents) / 65));
}

export class ScoreTracker {
  chart: Note[];
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
  constructor(chart: Note[]) {
    this.chart = chart;
    this.earned = chart.map(() => 0);
    this.voiced = chart.map(() => 0);
    this.analyzed = chart.map(() => 0);
    this.signal = chart.map(() => 0);
    this.lowerOctave = chart.map(() => 0);
    this.upperOctave = chart.map(() => 0);
    this.windows = chart.map(evaluationWindow);
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
    const reliable = reliablePitch(frequency, confidence, rms);
    this.chart.forEach((note, index) => {
      const window = this.windows[index];
      const left = Math.max(start, window.start), right = Math.min(time, window.end);
      const overlap = Math.max(0, right - left);
      if (!overlap) return;
      this.analyzed[index] += overlap;
      if (Number.isFinite(rms) && rms >= 0.008) this.signal[index] += overlap;
      if (reliable) {
        this.voiced[index] += overlap;
        // Integrate the same continuous reference used by the visual tuner.
        const parts = Math.ceil(overlap / .01);
        for (let part = 0; part < parts; part++) {
          const weight = overlap / parts, at = left + weight * (part + .5);
          const target = referenceMidiAt(note, at), difference = midiOf(frequency!) - target;
          this.earned[index] += weight * pitchQuality(frequency, target, confidence);
          this.absoluteCents += weight * Math.abs(difference * 100);
          this.noteAbsoluteCents[index] += weight * Math.abs(difference * 100);
          this.noteSignedCents[index] += weight * difference * 100;
          this.signedCents += weight * difference * 100;
          if (Math.abs(difference + 12) <= 1) this.lowerOctave[index] += weight;
          if (Math.abs(difference - 12) <= 1) this.upperOctave[index] += weight;
        }
      }
    });
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
      scoringVersion: SCORING_VERSION,
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

export function performanceFeedback(summary: ReturnType<ScoreTracker['summary']>, transpose = 0, canTranspose = true, experimentalMap = false) {
  if (summary.analyzedCoverage < 50) return { title: 'Faltaron datos del micrófono.', detail: 'El análisis no recibió suficientes muestras. Prueba la entrada elegida antes de repetir; este resultado no permite valorar tu canto.' };
  if (summary.signalCoverage < 5) return { title: 'La señal llegó muy baja o en silencio.', detail: 'Selecciona tu micrófono y pulsa Probar micrófono. Comprueba que la barra responde, revisa el volumen de entrada y acércate un poco.' };
  if (summary.coverage < 10) return { title: 'Llegó sonido, pero faltó un tono claro.', detail: 'Prueba el micrófono sin música y sostén una vocal. Usa auriculares y comprueba que el dispositivo elegido capta tu voz.' };
  if (summary.coverage < 60) return { title: 'Se detectó tono en parte de la referencia.', detail: `Hubo tono evaluable en el ${summary.coverage}% del tiempo de referencia y la afinación durante ese tiempo fue del ${summary.intonation ?? 0}%. La puntuación combina ambas medidas. Si cantaste todo el tramo, revisa el nivel del micrófono y la sincronización.${experimentalMap ? ' Comprueba también las notas del mapa automático: este resultado no permite atribuir la diferencia solo a tu canto.' : ''}` };
  if (!canTranspose && (summary.lowerOctaveCoverage > 20 && summary.lowerOctaveCoverage >= summary.coverage * 0.5 || summary.upperOctaveCoverage > 20 && summary.upperOctaveCoverage >= summary.coverage * 0.5)) return { title: 'Tu tono estuvo en otra octava del mapa.', detail: 'Comprueba en la biblioteca que las notas representan la voz que quieres cantar. Este archivo conserva su altura original; todavía no se transpone el acompañamiento.' };
  if (summary.lowerOctaveCoverage > 20 && summary.lowerOctaveCoverage >= summary.coverage * 0.5) return { title: 'Tu tono estuvo una octava más grave.', detail: transpose > -12 ? `Se detectaron notas parecidas a la melodía, una octava por debajo. Prueba el registro ${transpose === 12 ? 'Original' : 'Grave'}: bajará la guía y las notas que evaluamos.` : 'La voz quedó por debajo del registro Grave, que es el mínimo de este ejercicio. Comprueba el micrófono y prueba a seguir la guía en una altura cómoda; todavía no hay un registro inferior.' };
  if (summary.upperOctaveCoverage > 20 && summary.upperOctaveCoverage >= summary.coverage * 0.5) return { title: 'Tu tono estuvo una octava más agudo.', detail: transpose < 12 ? `Se detectaron notas parecidas a la melodía, una octava por encima. Prueba el registro ${transpose === -12 ? 'Original' : 'Agudo'}: subirá la guía y las notas que evaluamos.` : 'La voz quedó por encima del registro Agudo, que es el máximo de este ejercicio. Comprueba el micrófono y prueba a seguir la guía; todavía no hay un registro superior.' };
  if (summary.intonation !== null && summary.intonation < 50) return { title: 'El tono detectado tuvo poca coincidencia con la referencia.', detail: `La afinación durante el tono evaluable fue del ${summary.intonation}%. Compara tu tono con el afinador y revisa la sincronización.${experimentalMap ? ' Revisa la voz aislada y el mapa automático antes de concluir que la diferencia procede de tu canto.' : ''}` };
  return { title: 'Cada intento cuenta.', detail: 'Esta evaluación combina afinación y tiempo cantado. Las palabras aún no se califican.' };
}

export function phraseFeedback(phrase: ReturnType<ScoreTracker['summary']>['phraseDiagnostics'][number]) {
  if (!phrase.evaluatedSeconds) return 'Tramo aún no evaluado';
  if (phrase.analyzedCoverage < 50) return 'Faltaron muestras de análisis';
  if (phrase.signalCoverage < 5) return 'Señal baja o silencio en la referencia';
  if (phrase.coverage < 10) return 'Sonido recibido, poco tono fiable';
  if (phrase.accuracy === 0) return `Puntuación combinada inferior al 0,5 % · Afinación ${phrase.intonation}% · Cobertura ${phrase.coverage}%`;
  return `Afinación ${phrase.intonation}% · Cobertura ${phrase.coverage}%`;
}
