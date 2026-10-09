import { DIFFICULTIES } from './scoring';
import type { Difficulty } from './scoring';

const difficultyKey = 'encore.difficulty.v1', offsetKey = 'encore.offset.v1';

export function savedDifficulty(): Difficulty {
  try { const value = localStorage.getItem(difficultyKey); return value && value in DIFFICULTIES ? value as Difficulty : 'normal'; } catch { return 'normal'; }
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
