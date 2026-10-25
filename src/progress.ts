import type { Note } from './song.ts';

// Semitone bins of the voice histogram: MIDI 36 (Do2) to 84 (Do6).
export const LOW_MIDI = 36, HIGH_MIDI = 84;
// A comfortable range needs this much voice in tune with the notes, over at least this many takes.
const MIN_RANGE_SECONDS = 60, MIN_RANGE_TAKES = 2;

/** What a take adds to the singer's progress; small enough to keep long after its full result is gone. */
export interface TakeSummary {
  createdAt: string; songId: string; song: string; difficulty: string; score: number; transpose: number; phrase?: number;
  lyrics?: number;
  // Accuracy of each phrase (0 to 100) and how many phrases the map had, to compare takes on the same map only.
  phrases: number[]; phraseCount: number;
  // Seconds of voice per semitone, MIDI LOW_MIDI..HIGH_MIDI, counted only while a note of the map was sounding (in tune or not).
  voice: number[];
}

const numbers = (text: unknown) => typeof text === 'string' && text ? text.split(',').map(Number) : [];

/** The summary of a downloaded-result document (the one "Descargar resultado" gives and the history keeps). */
export function summarizeTake(document: Record<string, any>, meta: { createdAt: string; songId: string; song: string }): TakeSummary {
  const voice = new Array(HIGH_MIDI - LOW_MIDI + 1).fill(0);
  const trace = document.capture?.trace, chart = numbers(document.reference?.chart?.replaceAll?.(':', ','));
  const notes: [number, number][] = [];
  for (let i = 0; i + 3 < chart.length; i += 4) notes.push([chart[i] / 1000, (chart[i] + chart[i + 1]) / 1000]);
  if (trace && notes.length) {
    const times = numbers(trace.times), pitch = numbers(trace.pitch), level = numbers(trace.level);
    const gate = Number(document.levelGate) || .008, offset = (document.capture.offsetMs || 0) / 1000;
    const step = times.length > 1 ? Math.min(.1, (times.at(-1)! - times[0]) / (times.length - 1) / 1000) : .02;
    let at = 0;
    for (let i = 0; i < times.length; i++) {
      const time = times[i] / 1000 - offset;
      while (at < notes.length && notes[at][1] <= time) at++;
      if (at >= notes.length || time < notes[at][0] || !pitch[i] || level[i] / 10000 < gate) continue;
      const midi = Math.round(pitch[i] / 100);
      if (midi >= LOW_MIDI && midi <= HIGH_MIDI) voice[midi - LOW_MIDI] += step;
    }
  }
  const phrases = Array.isArray(document.phrases) ? document.phrases.map(Number) : [];
  return {
    ...meta, difficulty: String(document.difficulty || ''), score: Number(document.score) || 0, transpose: Number(document.transpose) || 0,
    ...(Number.isInteger(document.phrase) ? { phrase: document.phrase } : {}),
    ...(document.lyrics ? { lyrics: Number(document.lyrics.score) } : {}),
    phrases, phraseCount: phrases.length, voice: voice.map(seconds => Math.round(seconds * 100) / 100),
  };
}

/** The MIDI value below which a share of a semitone histogram lies, interpolated inside the bin. */
function percentile(histogram: number[], share: number, base: number) {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    if (seen + histogram[i] >= share * total && histogram[i] > 0) return base + i - .5 + (share * total - seen) / histogram[i];
    seen += histogram[i];
  }
  return base + histogram.length - 1;
}

export interface Range { low: number; high: number; middle: number; seconds: number }

/** The singer's comfortable range: where 80 % of their singing during the notes falls, over the most recent takes. */
export function voiceRange(takes: TakeSummary[], recent = 20): Range | null {
  const used = [...takes].filter(take => take.voice?.some(seconds => seconds > 0)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, recent);
  const histogram = new Array(HIGH_MIDI - LOW_MIDI + 1).fill(0);
  for (const take of used) take.voice.forEach((seconds, i) => { histogram[i] += seconds; });
  const seconds = histogram.reduce((sum, value) => sum + value, 0);
  if (used.length < MIN_RANGE_TAKES || seconds < MIN_RANGE_SECONDS) return null;
  return { low: percentile(histogram, .1, LOW_MIDI), high: percentile(histogram, .9, LOW_MIDI), middle: percentile(histogram, .5, LOW_MIDI), seconds };
}

/** Where 80 % of a song's sung time lies, from its map. */
export function songRange(notes: Pick<Note, 'midi' | 'duration'>[]): Range | null {
  const histogram = new Array(HIGH_MIDI - LOW_MIDI + 1).fill(0);
  for (const note of notes) { const bin = Math.round(note.midi) - LOW_MIDI; if (bin >= 0 && bin < histogram.length) histogram[bin] += note.duration; }
  const seconds = histogram.reduce((sum, value) => sum + value, 0);
  if (seconds < 5) return null;
  return { low: percentile(histogram, .1, LOW_MIDI), high: percentile(histogram, .9, LOW_MIDI), middle: percentile(histogram, .5, LOW_MIDI), seconds };
}

export interface KeySuggestion {
  // Semitones to move the song (the key selector) and octaves the singer would sing away from the recording.
  steps: number; octave: number;
  // Semitones the song still goes above or below the singer's comfortable range with that suggestion, and in its own key.
  above: number; below: number; originalOverflow: number;
}

/**
 * The key that keeps most of the song inside the singer's comfortable range. Singing an octave away is allowed (Relajada
 * and Normal score any octave), and moving the key costs a little, so the original key wins when it already fits.
 */
export function suggestKey(voice: Range, song: Range, maxSteps = 5): KeySuggestion {
  const overflow = (shift: number) => ({ above: Math.max(0, song.high + shift - voice.high), below: Math.max(0, voice.low - (song.low + shift)) });
  let best: KeySuggestion | null = null, bestCost = Infinity;
  for (let octave = -1; octave <= 1; octave++) for (let steps = -maxSteps; steps <= maxSteps; steps++) {
    const { above, below } = overflow(steps + 12 * octave);
    const cost = above + below + .15 * Math.abs(steps) + (octave ? .5 : 0);
    if (cost < bestCost - 1e-9) { bestCost = cost; best = { steps, octave, above, below, originalOverflow: 0 }; }
  }
  const original = Math.min(...[-1, 0, 1].map(octave => { const { above, below } = overflow(12 * octave); return above + below; }));
  return { ...best!, originalOverflow: original };
}

/** The phrases of a song sung worst lately (whole-song takes on the same map), weakest first. */
export function weakPhrases(takes: TakeSummary[], songId: string, phraseCount: number, recent = 5, limit = 3, below = 70) {
  const used = takes.filter(take => take.songId === songId && take.phrase === undefined && take.phraseCount === phraseCount)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, recent);
  if (!used.length) return [];
  return Array.from({ length: phraseCount }, (_, phrase) => ({ phrase, accuracy: Math.round(used.reduce((sum, take) => sum + (take.phrases[phrase] ?? 0), 0) / used.length), takes: used.length }))
    .filter(item => item.accuracy < below).sort((a, b) => a.accuracy - b.accuracy).slice(0, limit);
}

export interface SongProgress {
  songId: string; song: string; takes: TakeSummary[];
  // Whole-song takes only, oldest first; practice takes of a phrase are listed but not charted.
  full: TakeSummary[]; last: TakeSummary; best: Record<string, number>;
}

/** Takes grouped by song, the most recently sung first. */
export function songsProgress(takes: TakeSummary[]): SongProgress[] {
  const groups = new Map<string, TakeSummary[]>();
  for (const take of takes) groups.set(take.songId, [...(groups.get(take.songId) || []), take]);
  return [...groups.entries()].map(([songId, list]) => {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), full = sorted.filter(take => take.phrase === undefined);
    const best: Record<string, number> = {};
    for (const take of full) { const key = take.difficulty + (take.lyrics !== undefined ? '+letra' : ''); best[key] = Math.max(best[key] ?? 0, take.score); }
    return { songId, song: sorted.at(-1)!.song, takes: sorted, full, last: sorted.at(-1)!, best };
  }).sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt));
}
