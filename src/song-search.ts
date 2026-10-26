import type { LibrarySong } from './library-model.ts';
import { compileLyrics } from './lyrics.ts';
import type { LyricCue } from './lyrics.ts';
import { lyricsLanguage } from './sung-words.ts';
import { normalizeWord } from './lyrics-check.ts';
import { songRange, suggestKey } from './progress.ts';
import type { Range } from './progress.ts';

export type Language = 'es' | 'en' | '';
// How a song sits in the singer's comfortable range: in its key, after moving it, or beyond what a key change fixes.
export type Fit = 'comfortable' | 'with-key' | 'demanding' | null;

/** What the finder knows about a song, from the library alone. */
export interface SongFacets {
  id: string; title: string; artist: string;
  language: Language; year: number | null; decade: number | null;
  range: Range | null; fit: Fit; steps: number; outside: number;
  lyrics: string;
}

function lyricsOf(record: Pick<LibrarySong, 'lyrics' | 'duration'>): { text: string; cues: LyricCue[] } {
  if (!record.lyrics?.raw.trim()) return { text: '', cues: [] };
  try { const { text, cues } = compileLyrics(record.lyrics, record.duration); return { text, cues: cues.length ? cues : text.split('\n').map((line, i) => ({ start: i, text: line })) }; }
  catch { return { text: record.lyrics.raw, cues: record.lyrics.raw.split('\n').map((line, i) => ({ start: i, text: line })) }; }
}

export function facetsOf(record: LibrarySong, voice: Range | null): SongFacets {
  const { text, cues } = lyricsOf(record), year = Number.parseInt(record.recording?.date?.slice(0, 4) || '', 10);
  const range = songRange(record.notes), key = voice && range ? suggestKey(voice, range) : null, outside = key ? key.above + key.below : 0;
  const fit: Fit = !key ? null : outside > 1 ? 'demanding' : key.steps === 0 && key.octave === 0 ? 'comfortable' : 'with-key';
  return {
    id: record.id, title: record.title, artist: record.artist, language: lyricsLanguage(cues) as Language,
    year: Number.isFinite(year) && year > 1800 ? year : null, decade: Number.isFinite(year) && year > 1800 ? Math.floor(year / 10) * 10 : null,
    range, fit, steps: key?.steps ?? 0, outside, lyrics: text,
  };
}

/** What the meaning model reads of a song: its title and its lyrics (the evaluation found this ranks best). */
export const meaningText = (facets: Pick<SongFacets, 'title' | 'lyrics'>) => `${facets.title}. ${facets.lyrics}`.slice(0, 8000);

export interface Filters { language: Language | 'all'; decade: number | 'none' | 'all'; fit: Exclude<Fit, null> | 'all' }
export const NO_FILTERS: Filters = { language: 'all', decade: 'all', fit: 'all' };

export function applyFilters(songs: SongFacets[], filters: Filters) {
  return songs.filter(song => (filters.language === 'all' || song.language === filters.language)
    && (filters.decade === 'all' || (filters.decade === 'none' ? song.decade === null : song.decade === filters.decade))
    && (filters.fit === 'all' || song.fit === filters.fit));
}

export interface Ranked { id: string; similarity: number; relevance: number }
/**
 * Songs ordered by how close their meaning is to a search. The model's similarities sit in a narrow band (about 0.75
 * to 0.87), so relevance is relative to the library: standard deviations above its average.
 */
export function rankByMeaning(query: number[], vectors: Map<string, number[]>): Ranked[] {
  const scored = [...vectors.entries()].map(([id, vector]) => ({ id, similarity: vector.reduce((sum, value, i) => sum + value * query[i], 0) }));
  const mean = scored.reduce((sum, item) => sum + item.similarity, 0) / (scored.length || 1);
  const spread = Math.sqrt(scored.reduce((sum, item) => sum + (item.similarity - mean) ** 2, 0) / (scored.length || 1)) || 1;
  return scored.map(item => ({ ...item, relevance: (item.similarity - mean) / spread })).sort((a, b) => b.similarity - a.similarity);
}

/** Without the meaning model: songs whose title, artist or lyrics contain the words searched, most matches first. */
export function rankByWords(query: string, songs: SongFacets[]): Ranked[] {
  const words = query.split(/\s+/).map(normalizeWord).filter(word => word.length > 2);
  return songs.map(song => {
    const haystack = `${song.title} ${song.artist} ${song.lyrics}`.split(/\s+/).map(normalizeWord);
    const hits = words.filter(word => haystack.some(item => item.startsWith(word))).length;
    return { id: song.id, similarity: words.length ? hits / words.length : 0, relevance: hits ? 1 : -1 };
  }).filter(item => item.similarity > 0).sort((a, b) => b.similarity - a.similarity);
}

// Text identity of what was embedded, so a song is embedded again only when its title or lyrics change.
export function textKey(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${text.length}-${(hash >>> 0).toString(16)}`;
}
