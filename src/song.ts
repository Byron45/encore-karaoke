export interface Note { start: number; duration: number; midi: number; word: string; phrase: number; source?: 'automatic'; confidence?: number; phraseLabel?: string; pitchCurve?: [number, number][] }
// Original exercise composed for this prototype. Not sourced from a music service.
const words = [
  ['Hoy', 'mi', 'voz', 'va', 'a', 'despertar'],
  ['Sigo', 'la', 'luz', 'sin', 'mirar', 'atrás'],
  ['Una', 'nota', 'más', 'me', 'hace', 'volar'],
  ['Este', 'es', 'mi', 'momento', 'de', 'cantar'],
];
const pitches = [[60, 62, 64, 64, 62, 60], [60, 64, 67, 67, 65, 64], [62, 64, 65, 67, 65, 64], [64, 62, 60, 62, 59, 60]];
export const notes: Note[] = words.flatMap((line, phrase) => line.map((word, i) => ({
  start: phrase * 8 + i, duration: i === 5 ? 2 : 0.85, midi: pitches[phrase][i], word, phrase,
})));
export const phrases = words.map(line => line.join(' '));
export const song = { title: 'Un nuevo comienzo', artist: 'Encore Studio', duration: 32, bpm: 120, notes, phrases };
export const noteAt = (time: number) => notes.find(note => time >= note.start && time < note.start + note.duration);
export const notesInRegister = (semitones: number) => notes.map(note => ({ ...note, midi: note.midi + semitones }));
export const frequencyOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const midiOf = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);
export function noteName(midi: number) {
  const rounded = Math.round(midi);
  return `${['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'][((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}
