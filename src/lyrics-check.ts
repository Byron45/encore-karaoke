import type { LyricCue } from './lyrics.ts';

/** A word the speech recogniser heard, in song seconds. */
export interface SungWord { word: string; start: number; end: number }
export interface LineCheck {
  line: number; start: number; end: number; text: string;
  expected: number; matched: number;
  // Lyric words sung as something else ('' when nothing was heard in their place).
  differences: { expected: string; sung: string }[];
  // Positions, in lyricWords(text), of the lyric words not heard as written.
  missed: number[];
}
export interface LyricsCheck { lines: LineCheck[]; expected: number; matched: number; score: number }

// A recognised word counts as the lyric word from this similarity of their spoken forms (0 to 1).
export const WORD_MATCH = .75;
// Seconds a word may fall before its line's timestamp or after the next line starts and still belong to it.
const EARLY = 2, LATE = 2;

/** Lower case, without accents, punctuation or apostrophes; ñ kept apart from n. */
export function normalizeWord(word: string) {
  return word.toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0001/g, 'ñ').replace(/[^\p{L}\p{N}]/gu, '');
}

/** The word as it sounds in Spanish, so spelling the recogniser gets wrong (b/v, s/z/c, silent h, ll/y) does not count. */
export function soundOf(word: string) {
  return normalizeWord(word)
    .replace(/ch/g, '\u0002').replace(/h/g, '').replace(/\u0002/g, 'ch')
    .replace(/qu(?=[ei])/g, 'k').replace(/c(?=[ei])/g, 's').replace(/c/g, 'k').replace(/z/g, 's').replace(/v/g, 'b').replace(/w/g, 'u')
    .replace(/ll/g, 'y').replace(/gu(?=[ei])/g, 'g').replace(/g(?=[ei])/g, 'j').replace(/x/g, 'ks').replace(/ñ/g, 'ny')
    .replace(/(.)\1+/g, '$1');
}

function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

export function similarity(a: string, b: string) {
  const x = soundOf(a), y = soundOf(b);
  if (!x || !y) return x === y ? 1 : 0;
  return 1 - distance(x, y) / Math.max(x.length, y.length);
}

/** The words of a lyric line; bracketed notes such as (coro) or [x2] are not sung text. */
export function lyricWords(text: string) {
  return text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s+/).map(normalizeWord).filter(Boolean);
}

/**
 * Lines of the lyrics a take covered, compared word by word with what was heard. The alignment keeps the order of the
 * words and lets a word match only around its own line; extra words (ad libs, repetitions) cost little and never lower
 * a line, missing or different lyric words do.
 */
/** Lyric words a check did not hear as written, as keys for checkLyrics' ignore: "cue:position". */
export function missedWords(check: LyricsCheck) {
  return new Set(check.lines.flatMap(line => line.missed.map(k => `${line.line}:${k}`)));
}

/** ignore: lyric words left out of the comparison ("cue:position"), such as those the recogniser misses in the recording itself. */
export function checkLyrics(cues: LyricCue[], heard: SungWord[], from: number, to: number, ignore: Set<string> = new Set()): LyricsCheck {
  const lines = cues.map((cue, i) => ({ line: i, start: cue.start, end: cues[i + 1]?.start ?? to, text: cue.text }))
    .filter(line => line.text.trim() && line.start >= from - .5 && line.start < to && lyricWords(line.text).length);
  const expected = lines.flatMap((line, l) => lyricWords(line.text).flatMap((word, k) => ignore.has(`${line.line}:${k}`) ? [] : [{ word, l, k, from: line.start - EARLY, to: line.end + LATE }]));
  const words = heard.filter(word => normalizeWord(word.word) && word.end >= from - EARLY && word.start <= to + LATE).sort((a, b) => a.start - b.start);
  const n = expected.length, m = words.length, MISS = 1, EXTRA = .4;
  // cost[i][j]: best alignment of the first i lyric words with the first j heard words.
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1)), step = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { cost[i][0] = i * MISS; step[i][0] = 1; }
  for (let j = 1; j <= m; j++) { cost[0][j] = j * EXTRA; step[0][j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let best = cost[i - 1][j] + MISS, how = 1;
    if (cost[i][j - 1] + EXTRA < best) { best = cost[i][j - 1] + EXTRA; how = 2; }
    const word = words[j - 1], target = expected[i - 1], middle = (word.start + word.end) / 2;
    if (middle >= target.from && middle <= target.to) {
      const pair = cost[i - 1][j - 1] + 1.2 * (1 - similarity(target.word, word.word));
      if (pair < best) { best = pair; how = 3; }
      // The same words written together or apart: "porque" and "por que", "adónde" and "a dónde".
      // Only when the joined form is the same word; an ad lib next to a word ("cielo oh") stays an extra word.
      const together = i > 1 && expected[i - 2].l === target.l ? similarity(expected[i - 2].word + target.word, word.word) : 0;
      if (together >= WORD_MATCH && cost[i - 2][j - 1] + 1.2 * (1 - together) + .05 < best) { best = cost[i - 2][j - 1] + 1.2 * (1 - together) + .05; how = 4; }
      const apart = j > 1 ? similarity(target.word, words[j - 2].word + word.word) : 0;
      if (apart >= WORD_MATCH && cost[i - 1][j - 2] + 1.2 * (1 - apart) + .05 < best) { best = cost[i - 1][j - 2] + 1.2 * (1 - apart) + .05; how = 5; }
    }
    cost[i][j] = best; step[i][j] = how;
  }
  // The alignment, in order: lyric words matched or not, and heard words with no lyric word of their own.
  const ops: { line: number; k?: number; expected?: string; sung?: string; ok: boolean }[] = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const how = step[i][j];
    if (how === 3) { const target = expected[i - 1], word = words[j - 1]; ops.unshift({ line: target.l, k: target.k, expected: target.word, sung: normalizeWord(word.word), ok: similarity(target.word, word.word) >= WORD_MATCH }); i--; j--; }
    else if (how === 4) {
      const [first, second] = [expected[i - 2], expected[i - 1]], sung = normalizeWord(words[j - 1].word), ok = similarity(first.word + second.word, sung) >= WORD_MATCH;
      ops.unshift({ line: first.l, k: first.k, expected: first.word, sung, ok }, { line: second.l, k: second.k, expected: second.word, ok }); i -= 2; j--;
    } else if (how === 5) {
      const target = expected[i - 1], sung = `${normalizeWord(words[j - 2].word)} ${normalizeWord(words[j - 1].word)}`;
      ops.unshift({ line: target.l, k: target.k, expected: target.word, sung, ok: similarity(target.word, sung.replace(' ', '')) >= WORD_MATCH }); i--; j -= 2;
    }
    else if (how === 1) { ops.unshift({ line: expected[i - 1].l, k: expected[i - 1].k, expected: expected[i - 1].word, ok: false }); i--; }
    else { ops.unshift({ line: i > 0 ? expected[i - 1].l : 0, sung: normalizeWord(words[j - 1].word), ok: true }); j--; }
  }
  const result: LineCheck[] = lines.map((line, l) => ({ ...line, expected: expected.filter(word => word.l === l).length, matched: 0, differences: [], missed: [] }));
  // Consecutive wrong or missing lyric words, with whatever was sung among them, read as one difference.
  let open: { line: number; expected: string[]; sung: string[] } | null = null;
  const close = () => { if (open?.expected.length) result[open.line].differences.push({ expected: open.expected.join(' '), sung: open.sung.join(' ') }); open = null; };
  for (const op of ops) {
    if (op.expected !== undefined && op.ok) { close(); result[op.line].matched++; continue; }
    if (op.expected === undefined) { if (open && open.line === op.line && op.sung) open.sung.push(op.sung); continue; }
    if (open && open.line !== op.line) close();
    result[op.line].missed.push(op.k!);
    open ??= { line: op.line, expected: [], sung: [] };
    open.expected.push(op.expected); if (op.sung) open.sung.push(op.sung);
  }
  close();
  const total = result.reduce((sum, line) => sum + line.expected, 0), matched = result.reduce((sum, line) => sum + line.matched, 0);
  return { lines: result, expected: total, matched, score: total ? matched / total : 0 };
}
