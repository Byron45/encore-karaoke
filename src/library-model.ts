import type { Note } from './song.ts';
import { validPitchCurve } from './pitch-reference.ts';
import { compileLyrics } from './lyrics.ts';
import type { LyricsDocument } from './lyrics.ts';
import type { PreparedAudio, AutomaticMapInfo } from './preparation';
export const MAX_MAP_BYTES = 12 * 1024 * 1024;

export interface RecordingMetadata {
  id: string; title: string; artist: string; duration: number | null; album: string; date: string; disambiguation: string;
}
export interface LibrarySong {
  id: string; title: string; artist: string; duration: number; bpm: number | null;
  notes: Note[]; audio: Blob; audioName: string; audioHash: string;
  recording?: RecordingMetadata; updatedAt: string; lyrics?: LyricsDocument; prepared?: PreparedAudio; automaticMap?: AutomaticMapInfo;
}
export interface PlayableSong {
  title: string; artist: string; duration: number; bpm: number | null; notes: Note[]; phrases: string[];
  audio?: Blob; id?: string; lyrics?: LyricsDocument; prepared?: PreparedAudio; automaticMap?: AutomaticMapInfo;
}
export function phrasesOf(notes: Note[]): string[] {
  const result: string[] = [];
  for (const note of notes) {
    if (note.source === 'automatic') result[note.phrase] ||= note.phraseLabel || `Sección vocal ${note.phrase + 1}`;
    else result[note.phrase] = result[note.phrase] ? `${result[note.phrase]} ${note.word}` : note.word;
  }
  return result;
}
export function playable(record: LibrarySong): PlayableSong {
  const errors = validateNotes(record.notes, record.duration);
  if (record.lyrics) compileLyrics(record.lyrics, record.duration);
  if (errors.length && !(record.notes.length === 0 && record.lyrics?.raw.trim())) throw new Error(errors[0]);
  return { ...record, phrases: phrasesOf(record.notes) };
}
export function validateNotes(value: unknown, duration: number): string[] {
  if (!Array.isArray(value) || value.length === 0) return ['Añade al menos una nota con su palabra y tiempo para cantar con puntuación.'];
  if (value.length > 2000) return ['El mapa admite un máximo de 2.000 notas por canción.'];
  if (!Number.isFinite(duration) || duration <= 0) return ['La duración del audio no es válida.'];
  const errors: string[] = [];
  let curvePoints = 0;
  let previousEnd = 0, previousPhrase = 0;
  value.forEach((note, i) => {
    const prefix = `Nota ${i + 1}: `;
    if (!note || typeof note !== 'object') { errors.push(prefix + 'formato no válido.'); return; }
    if (!validPitchCurve(note.pitchCurve, note.duration)) errors.push(prefix + 'la curva de afinación no es válida.');
    curvePoints += Array.isArray(note.pitchCurve) ? note.pitchCurve.length : 0;
    if (typeof note.word !== 'string' || note.source !== 'automatic' && !note.word.trim() || note.word.length > 100) errors.push(prefix + 'escribe una palabra o sílaba de hasta 100 caracteres.');
    if (note.source === 'automatic' && (!Number.isFinite(note.confidence) || note.confidence < 0.65 || note.confidence > 1 || typeof note.phraseLabel !== 'string' || note.phraseLabel.length > 1000)) errors.push(prefix + 'la procedencia de esta nota automática no es válida.');
    if (!Number.isFinite(note.start) || note.start < 0 || !Number.isFinite(note.duration) || note.duration < 0.08) errors.push(prefix + 'el inicio debe ser positivo y la duración de al menos 0,08 s.');
    else {
      if (note.start < previousEnd - 0.001) errors.push(prefix + 'se solapa con la anterior o está fuera de orden.');
      if (note.start + note.duration > duration + 0.001) errors.push(prefix + 'termina después del audio.');
      previousEnd = note.start + note.duration;
    }
    if (!Number.isInteger(note.midi) || note.midi < 36 || note.midi > 83) errors.push(prefix + 'elige una nota entre Do2 y Si5.');
    if (!Number.isInteger(note.phrase) || note.phrase < 0 || note.phrase > 1999 || (i === 0 && note.phrase !== 0) || note.phrase < previousPhrase || note.phrase > previousPhrase + 1) errors.push(prefix + 'las frases deben empezar en 1 y seguir en orden, sin saltos.');
    previousPhrase = note.phrase;
  });
  if (curvePoints > 40000) errors.push('El mapa supera 40.000 puntos de afinación.');
  return errors;
}

export function exportMap(record: LibrarySong) {
  return { schemaVersion: record.notes.some(n => n.pitchCurve) ? 3 : record.notes.some(n => n.source === 'automatic') ? 2 : 1, title: record.title, artist: record.artist, bpm: record.bpm,
    audio: { sha256: record.audioHash, duration: record.duration, name: record.audioName },
    notes: record.notes.map(({ start, duration, midi, word, phrase, source, confidence, phraseLabel, pitchCurve }) => ({ start, duration, midi, word, phrase, source, confidence, phraseLabel, pitchCurve })),
  };
}
export function importMap(text: string, record: Pick<LibrarySong, 'audioHash' | 'duration'>): Note[] {
  if (new TextEncoder().encode(text).byteLength > MAX_MAP_BYTES) throw new Error('El mapa es demasiado grande (máximo 12 MB).');
  let map;
  try { map = JSON.parse(text); } catch { throw new Error('No se pudo leer el JSON. Comprueba el archivo del mapa.'); }
  if (!map || ![1, 2, 3].includes(map.schemaVersion) || map.schemaVersion === 2 && !map.notes?.some((n: Note) => n.source === 'automatic') || map.schemaVersion === 3 && !map.notes?.some((n: Note) => n.pitchCurve)) throw new Error('Este mapa no usa el formato Encore versión 1, 2 o 3 compatible.');
  if (map.audio?.sha256 !== record.audioHash) throw new Error('Este mapa pertenece a otro archivo de audio. Usa el mapa de esta misma versión.');
  if (!Number.isFinite(map.audio?.duration) || Math.abs(map.audio.duration - record.duration) > 0.05) throw new Error('La duración del mapa no coincide con este audio.');
  const errors = validateNotes(map.notes, record.duration);
  if (errors.length) throw new Error(errors.slice(0, 3).join(' '));
  return map.notes.map((n: Note) => ({ start: n.start, duration: n.duration, midi: n.midi, phrase: n.phrase, word: n.word.trim(), ...(n.pitchCurve ? { pitchCurve: n.pitchCurve } : {}), ...(n.source === 'automatic' ? { source: n.source, confidence: n.confidence, phraseLabel: n.phraseLabel } : {}) }));
}
