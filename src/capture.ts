import { LEVEL_GATE, MIN_LEVEL_GATE } from './pitch-reference.ts';

// Measurements taken from the microphone during the three-second count-in, before any note is evaluated.
export interface LevelReading { time: number; rms: number }

/** Level the quietest fifth of the count-in stays under, so the clicks and a stray word do not raise it. */
export function noiseFloor(readings: LevelReading[]): number | null {
  const levels = readings.map(reading => reading.rms).filter(Number.isFinite).sort((a, b) => a - b);
  return levels.length < 20 ? null : levels[Math.floor(levels.length * .2)];
}

/** A quiet input lowers the silence gate so soft singing still counts. It never rises above the default, and stays there while the speakers leak in. */
export function levelGate(floor: number | null, speakerBleed: boolean): number {
  return floor === null || speakerBleed ? LEVEL_GATE : Math.max(MIN_LEVEL_GATE, Math.min(LEVEL_GATE, floor * 2.5));
}

/** True when the microphone hears the six count-in clicks: their echo lands at the same phase of every half second, well above the room. */
export function hearsCountIn(readings: LevelReading[], origin: number): boolean {
  const periods = Array.from({ length: 6 }, () => new Array<number>(10).fill(0));
  for (const reading of readings) {
    const at = reading.time - (origin - 3 + .03);
    if (!(at >= 0 && at < 3) || !Number.isFinite(reading.rms)) continue;
    const levels = periods[Math.floor(at / .5)], bin = Math.min(9, Math.floor(at % .5 / .05));
    levels[bin] = Math.max(levels[bin], reading.rms);
  }
  for (let bin = 0; bin < 10; bin++) {
    const heard = periods.filter(levels => {
      const rest = levels.filter((_, i) => Math.abs(i - bin) > 1 && Math.abs(i - bin) < 9).sort((a, b) => a - b);
      return levels[bin] >= .004 && levels[bin] >= 3 * rest[rest.length >> 1];
    });
    if (heard.length >= 4) return true;
  }
  return false;
}

/** Delay the device itself declares between scheduling a sound and hearing it, plus the input's, in milliseconds. */
export function reportedLatency(context: { baseLatency?: number; outputLatency?: number }, inputLatency = 0): number | null {
  const seconds = (context.baseLatency || 0) + (context.outputLatency || 0) + inputLatency;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}
