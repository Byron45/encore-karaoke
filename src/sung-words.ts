import type { LyricCue } from './lyrics.ts';
import { checkLyrics, lyricWords, missedWords } from './lyrics-check.ts';
import type { LineCheck, SungWord } from './lyrics-check.ts';
import type { Reading } from './scoring.ts';

// Share of the score the lyrics can take away: a take with no lyric word right keeps 80 % of its points.
export const LYRICS_WEIGHT = .2;
export const WORDS_RATE = 16000;

/** What the lyrics check adds to a result. */
export interface LyricsSummary {
  // Lyric words heard as written, out of those judged (0 to 1), and the counts.
  score: number; judged: number; matched: number;
  // Lyric words left out because the recogniser does not hear them in the recording's own voice either.
  ignored: number;
  weight: number; pitchScore: number;
  device: string | null; model: string | null;
  lines: Pick<LineCheck, 'line' | 'start' | 'text' | 'expected' | 'matched' | 'differences'>[];
}
interface Recognition { words: SungWord[]; device?: string; model?: string }

async function answer(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'El servidor local no respondió.');
  return data;
}

/** Whether this computer's server can recognise sung words (the audio engine with Whisper). */
export async function canRecogniseWords(signal?: AbortSignal): Promise<{ available: boolean; device: string | null }> {
  try { const data = await answer(await fetch('/api/preparation/words', { signal })); return { available: data.available === true, device: data.device || null }; } catch { return { available: false, device: null }; }
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

/** Words heard in an audio file, times in seconds from its start. keep: the server keeps the answer (a song's isolated voice). */
export async function recogniseWords(audio: Blob, language: string, keep: boolean, signal?: AbortSignal): Promise<Recognition> {
  const { token } = await answer(await fetch('/api/preparation/words', { signal }));
  const response = await fetch('/api/preparation/words', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Encore-Token': token, 'X-Audio-Sha256': await sha256(audio), ...(language ? { 'X-Language': language } : {}), ...(keep ? { 'X-Keep': '1' } : {}) }, body: audio, signal });
  return await answer(response) as Recognition;
}

// The isolated voice of each song is recognised once per session (and once ever on the server).
const recordings = new WeakMap<Blob, Promise<Recognition>>();
export function recordingWords(vocals: Blob, language: string) {
  let words = recordings.get(vocals);
  if (!words) { words = recogniseWords(vocals, language, true); words.catch(() => recordings.delete(vocals)); recordings.set(vocals, words); }
  return words;
}

/** 16-bit mono WAV. */
export function wav(samples: Float32Array, rate: number) {
  const bytes = new DataView(new ArrayBuffer(44 + samples.length * 2)), text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); bytes.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt '); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
  bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); text(36, 'data'); bytes.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) bytes.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Blob([bytes.buffer], { type: 'audio/wav' });
}

/** 'es' or 'en' when the lyrics clearly are, so the recogniser does not guess from singing; '' lets it detect the language. */
export function lyricsLanguage(cues: LyricCue[]) {
  const words = cues.flatMap(cue => lyricWords(cue.text));
  const count = (list: string[]) => words.filter(word => list.includes(word)).length;
  const spanish = count(['que', 'de', 'la', 'el', 'y', 'en', 'no', 'me', 'tu', 'mi', 'te', 'lo', 'por', 'con', 'una', 'es', 'se', 'yo', 'para', 'como']);
  const english = count(['the', 'you', 'and', 'i', 'to', 'my', 'it', 'in', 'of', 'me', 'your', 'is', 'that', 'on', 'be', 'love', 'all', 'for', 'we', 'this']);
  return spanish >= 5 && spanish > 2 * english ? 'es' : english >= 5 && english > 2 * spanish ? 'en' : '';
}

/** Words heard while the microphone caught a voice: what the recogniser writes over silence or music is dropped. */
export function voicedWords(words: SungWord[], readings: Reading[], gate: number) {
  return words.filter(word => readings.some(reading => reading.time >= word.start - .06 && reading.time <= word.end + .06 && reading.rms >= gate));
}

/**
 * The lyrics part of a take. heard: the singer's words in song time, already compensated for the capture delay.
 * reference: the recording's own words; lyric words it misses are not held against the singer.
 */
export function lyricsSummary(cues: LyricCue[], heard: SungWord[], from: number, to: number, pitchScore: number, reference: Recognition | null, singer: Recognition): LyricsSummary {
  const ignore = reference ? missedWords(checkLyrics(cues, reference.words, from, to)) : new Set<string>();
  const check = checkLyrics(cues, heard, from, to, ignore);
  return {
    score: check.score, judged: check.expected, matched: check.matched, ignored: ignore.size, weight: LYRICS_WEIGHT, pitchScore,
    device: singer.device || null, model: singer.model || null,
    lines: check.lines.map(({ line, start, text, expected, matched, differences }) => ({ line, start, text, expected, matched, differences })),
  };
}

/** The take's points once the lyrics count: all of them with every word right, down to 80 % with none. */
export const withLyrics = (pitchScore: number, lyrics: number) => Math.round(pitchScore * (1 - LYRICS_WEIGHT * (1 - Math.max(0, Math.min(1, lyrics)))));
