import { DIFFICULTIES, SCORING_VERSION } from './scoring';
import type { Difficulty } from './scoring';

const difficultyKey = 'encore.difficulty.v1', offsetKey = 'encore.offset.v1', bestKey = 'encore.best.v1';

// Singing for fun starts on the forgiving level; the tighter ones are a choice.
export const DEFAULT_DIFFICULTY: Difficulty = 'relaxed';
export function savedDifficulty(): Difficulty {
  try { const value = localStorage.getItem(difficultyKey); return value && value in DIFFICULTIES ? value as Difficulty : DEFAULT_DIFFICULTY; } catch { return DEFAULT_DIFFICULTY; }
}
export function storeDifficulty(value: Difficulty) {
  try { localStorage.setItem(difficultyKey, value); } catch { /* The choice still applies to this visit. */ }
}

// One delay per input: a headset and the laptop microphone rarely share it.
function offsets(): Record<string, unknown> {
  try { const value = JSON.parse(localStorage.getItem(offsetKey) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
/** The delay the singer settled on for this microphone, or null to follow what the device reports. */
export function savedOffset(deviceId: string): number | null {
  const value = offsets()[deviceId || 'default'];
  return typeof value === 'number' && value >= 0 && value <= 300 ? value : null;
}
export function storeOffset(deviceId: string, value: number | null) {
  try {
    const all = offsets();
    if (value === null) delete all[deviceId || 'default']; else all[deviceId || 'default'] = value;
    localStorage.setItem(offsetKey, JSON.stringify(all));
  } catch { /* The choice still applies to this visit. */ }
}

// A singer's best score per song and level of demand. Marks from another scoring version are not comparable and stay behind.
function bests(): Record<string, unknown> {
  try { const value = JSON.parse(localStorage.getItem(bestKey) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
const markOf = (song: string, difficulty: Difficulty) => `${SCORING_VERSION}|${song}|${difficulty}`;
export function bestScore(song: string, difficulty: Difficulty): number | null {
  const value = bests()[markOf(song, difficulty)];
  return typeof value === 'number' && value >= 0 && value <= 10000 ? value : null;
}
export function storeBest(song: string, difficulty: Difficulty, score: number) {
  try { localStorage.setItem(bestKey, JSON.stringify({ ...bests(), [markOf(song, difficulty)]: score })); } catch { /* The mark is only shown for this take. */ }
}
