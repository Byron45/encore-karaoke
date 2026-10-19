import type { PlayableSong } from './library-model';
import type { Accompaniment } from './preparation';
import { hashBlob, verifyStem } from './preparation';

const RATE = 44100;
/** Steps the key selector offers. Rubber Band keeps a voice natural up to about five semitones either way. */
export const KEY_STEPS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

export const keyLabel = (steps: number) => steps === 0 ? 'Tono original' : `${steps > 0 ? '+' : '−'}${Math.abs(steps)} ${Math.abs(steps) === 1 ? 'semitono' : 'semitonos'} · ${steps > 0 ? 'más agudo' : 'más grave'}`;

async function answer(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'El servidor local no respondió.');
  return data;
}

/** Only the local server, with the audio engine installed, can move a song's key; a static copy of the app cannot. */
export async function canTranspose(signal?: AbortSignal) {
  try { return (await answer(await fetch('/api/preparation/transpose', { signal }))).available === true; } catch { return false; }
}

// The last track asked for, so singing again in the same key does not upload it again.
let last: { key: string; audio: Blob } | null = null;

/** The accompaniment the singer chose, moved by whole semitones on this computer. Same length and timing as the original. */
export async function transposedAudio(song: PlayableSong, accompaniment: Accompaniment, steps: number, signal?: AbortSignal) {
  const source = accompaniment === 'original' ? song.audio : song.prepared?.[accompaniment];
  if (!source) throw new Error('Esta canción no tiene audio al que cambiarle el tono.');
  const stem = accompaniment === 'original' ? null : song.prepared!.manifest.stems[accompaniment];
  if (stem) await verifyStem(source, stem);
  const hash = stem ? stem.sha256 : await hashBlob(source), samples = stem ? stem.samples : Math.round(song.duration * RATE);
  const key = `${hash}:${samples}:${steps}`;
  if (last?.key === key) return last.audio;
  const { token } = await answer(await fetch('/api/preparation/transpose', { signal }));
  const response = await fetch('/api/preparation/transpose', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Encore-Token': token, 'X-Audio-Sha256': hash, 'X-Semitones': String(steps), 'X-Samples': String(samples) }, body: source, signal });
  if (!response.ok) await answer(response);
  const audio = await response.blob();
  last = { key, audio };
  return audio;
}
