import type { Note } from './song.ts';
import { midiOf } from './song.ts';

// Curve coordinates: seconds from note start, cents from its displayed MIDI note.
export function validPitchCurve(curve: unknown, duration: number): boolean {
  if (curve === undefined) return true;
  if (!Array.isArray(curve) || curve.length < 2 || curve.length > 30002) return false;
  let previous = -1;
  for (const point of curve) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || point[0] <= previous || point[0] < 0 || point[0] > duration + .001 || Math.abs(point[1]) > 200) return false;
    previous = point[0];
  }
  return curve[0][0] === 0 && Math.abs(curve.at(-1)[0] - duration) <= .001;
}
export function referenceMidiAt(note: Note, time: number): number {
  const curve = note.pitchCurve;
  if (!curve?.length) return note.midi;
  const local = Math.max(0, Math.min(note.duration, time - note.start));
  let low = 0, high = curve.length - 1;
  while (high - low > 1) { const mid = (low + high) >>> 1; if (curve[mid][0] <= local) low = mid; else high = mid; }
  const [a, b] = [curve[low], curve[high]];
  const fraction = Math.max(0, Math.min(1, (local - a[0]) / (b[0] - a[0] || 1)));
  return note.midi + (a[1] + (b[1] - a[1]) * fraction) / 100;
}
export function evaluationWindow(note: Note) {
  const guard = note.source === 'automatic' ? Math.max(0, Math.min(.02, (note.duration - .08) / 2)) : 0;
  return { start: note.start + guard, end: note.start + note.duration - guard, duration: note.duration - 2 * guard };
}
export function reliablePitch(frequency: number | null, confidence: number, rms: number) {
  return frequency !== null && Number.isFinite(frequency) && frequency > 0 && Number.isFinite(confidence) && confidence >= .8 && confidence <= 1 && Number.isFinite(rms) && rms >= .008;
}
export function tuningReading(note: Note | undefined, time: number, frequency: number | null, confidence: number, rms: number) {
  const detectedMidi = reliablePitch(frequency, confidence, rms) ? midiOf(frequency!) : null;
  const window = note ? evaluationWindow(note) : null;
  const targetMidi = note ? referenceMidiAt(note, time) : null;
  const evaluable = !!window && time >= window.start && time < window.end;
  return { detectedMidi, targetMidi, evaluable, cents: detectedMidi !== null && targetMidi !== null && evaluable ? (detectedMidi - targetMidi) * 100 : null };
}
