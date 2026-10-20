import type { Note } from './song';
import type { LyricsDocument } from './lyrics';
import { compileLyrics, cueAt } from './lyrics.ts';
import { validPitchCurve } from './pitch-reference.ts';

export type Accompaniment = 'original' | 'reduced' | 'instrumental';
export interface PitchSegment { start: number; duration: number; midi: number; confidence: number; pitchCurve?: [number, number][] }
export interface StemDescriptor { file: string; sha256: string; bytes: number; sampleRate: number; samples: number; channels: number; duration: number; offsetSamples: number }
export interface PreparationManifest {
  schemaVersion: number; originalSha256: string; duration: number; sampleRate: number; samples: number;
  // models: the two-pass separation since revision 2J; earlier preparations used a single model.
  separator: { package: string; version: string; model: string; models?: { instrumental: string; vocals: string } };
  stems: Record<'vocals' | 'instrumental' | 'reduced', StemDescriptor>;
  alignment: { position: number; lagSeconds: number; correlation: number }[];
  reducedVocalGain: number; sharedGain: number;
  analysis: { notes: PitchSegment[]; method: string; version: string; analyzedSeconds: number; detectedSeconds: number; warning: string; diagnostics?: { algorithmVersion: string; conflictSeconds: number; recoveredDipSeconds: number; discardedShortSeconds: number } };
}
export interface PreparedAudio { manifest: PreparationManifest; vocals: Blob; instrumental: Blob; reduced: Blob }
export interface AutomaticMapInfo { method: string; sourceHash: string; reviewedAt: string; experimental: true; detectedSeconds: number }
export async function hashBlob(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export function validateManifest(value: unknown, originalHash: string, duration: number): asserts value is PreparationManifest {
  const m = value as PreparationManifest;
  if (!m || m.schemaVersion !== 1 || m.originalSha256 !== originalHash || !/^[a-f0-9]{64}$/.test(originalHash)) throw new Error('La preparación pertenece a otro archivo de audio.');
  if (!Number.isFinite(m.duration) || Math.abs(m.duration - duration) > 0.05 || m.duration < 1 || m.duration > 600 || m.sampleRate !== 44100 || !Number.isInteger(m.samples) || Math.abs(m.samples / m.sampleRate - m.duration) > 0.001) throw new Error('La preparación no conserva la duración del original.');
  if (!Array.isArray(m.alignment) || !m.alignment.length || m.alignment.some(check => !Number.isFinite(check.lagSeconds) || Math.abs(check.lagSeconds) > 0.025 || !Number.isFinite(check.correlation) || check.correlation < 0.7)) throw new Error('No se verificó la alineación de las pistas.');
  if (m.reducedVocalGain !== 0.25 || !Number.isFinite(m.sharedGain) || m.sharedGain <= 0 || m.sharedGain > 1) throw new Error('La mezcla vocal no tiene niveles válidos.');
  for (const name of ['vocals', 'instrumental', 'reduced'] as const) {
    const stem = m.stems?.[name];
    if (!stem || stem.file !== `${name}.wav` || !/^[a-f0-9]{64}$/.test(stem.sha256) || stem.sampleRate !== m.sampleRate || stem.samples !== m.samples || stem.channels !== 2 || stem.offsetSamples !== 0 || Math.abs(stem.duration - m.duration) > 0.001 || !Number.isFinite(stem.duration) || !Number.isInteger(stem.bytes) || stem.bytes < 44 || stem.bytes > 128 * 1024 * 1024) throw new Error('Una pista tiene datos de duración o formato incompatibles.');
  }
  if (!m.separator || typeof m.separator.model !== 'string' || typeof m.separator.version !== 'string' || !m.analysis || typeof m.analysis.method !== 'string' || typeof m.analysis.warning !== 'string' || !Array.isArray(m.analysis.notes) || m.analysis.notes.length > 2000) throw new Error('El borrador del mapa tiene un formato incompatible.');
  if (!Number.isFinite(m.analysis.detectedSeconds) || m.analysis.detectedSeconds < 0 || m.analysis.detectedSeconds > m.duration || !Number.isFinite(m.analysis.analyzedSeconds) || Math.abs(m.analysis.analyzedSeconds - m.duration) > 0.05) throw new Error('El análisis no corresponde a la duración de esta canción.');
  let end = 0;
  let curvePoints = 0;
  for (const n of m.analysis.notes) {
    if (!validPitchCurve(n.pitchCurve, n.duration)) throw new Error('La curva de afinación contiene puntos inválidos.');
    curvePoints += n.pitchCurve?.length || 0;
    if (!Number.isFinite(n.start) || !Number.isFinite(n.duration) || n.start < end - 0.001 || n.duration < 0.08 || n.start + n.duration > duration + 0.05 || !Number.isInteger(n.midi) || n.midi < 36 || n.midi > 83 || !Number.isFinite(n.confidence) || n.confidence < 0.65 || n.confidence > 1) throw new Error('El mapa automático contiene notas fuera de los límites.');
    end = n.start + n.duration;
  }
  if (curvePoints > 40000 || Math.abs(m.analysis.notes.reduce((sum, n) => sum + n.duration, 0) - m.analysis.detectedSeconds) > .05) throw new Error('La duración evaluable o la curva del mapa no coincide con el informe.');
}
export async function verifyStem(blob: Blob, descriptor: StemDescriptor) {
  if (blob.size !== descriptor.bytes || await hashBlob(blob) !== descriptor.sha256) throw new Error('Una pista está incompleta o su contenido cambió. Repite la preparación.');
  // Check PCM WAV header/sample count without decoding three full tracks in memory.
  const view = new DataView(await blob.slice(0, 4096).arrayBuffer());
  const word = (at: number) => String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
  if (view.byteLength < 44 || word(0) !== 'RIFF' || word(8) !== 'WAVE') throw new Error('La pista no es un WAV válido.');
  let format = false, data = false;
  for (let at = 12; at + 8 <= view.byteLength;) {
    const size = view.getUint32(at + 4, true), name = word(at);
    if (name === 'fmt ' && size >= 16 && at + 24 <= view.byteLength) format = view.getUint16(at + 8, true) === 1 && view.getUint16(at + 10, true) === 2 && view.getUint32(at + 12, true) === descriptor.sampleRate && view.getUint16(at + 22, true) === 16;
    if (name === 'data') { data = size === descriptor.samples * 4 && at + 8 + size === blob.size; break; }
    at += 8 + size + size % 2;
  }
  if (!format || !data) throw new Error('La duración o muestras del WAV no coinciden con su manifiesto.');
}
export function automaticNotes(segments: PitchSegment[], lyrics: LyricsDocument | undefined, duration: number): Note[] {
  const cues = lyrics?.format === 'lrc' ? compileLyrics(lyrics, duration).cues : [];
  let phrase = -1, key = '', lastEnd = -Infinity, groupStart = 0;
  return segments.map(n => {
    const index = cueAt(cues, n.start + n.duration / 2), cue = cues[index];
    const nextKey = cue?.text ? `line-${index}` : 'vocal';
    if (phrase < 0 || nextKey !== key || !cue?.text && (n.start - lastEnd > 1 || n.start - groupStart >= 8)) { phrase++; key = nextKey; groupStart = n.start; }
    lastEnd = n.start + n.duration;
    return { ...n, duration: Math.min(n.duration, duration - n.start), phrase, word: '', source: 'automatic', phraseLabel: cue?.text.slice(0, 1000) || `Sección vocal ${phrase + 1}` };
  });
}
