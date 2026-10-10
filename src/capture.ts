import { LEVEL_GATE, MIN_LEVEL_GATE } from './pitch-reference.ts';

// Measurements taken from the microphone during the three-second count-in, before any note is evaluated.
export interface LevelReading { time: number; rms: number }

/** Level the quietest fifth of the count-in stays under, so the clicks and a stray word do not raise it. */
export function noiseFloor(readings: LevelReading[]): number | null {
  const levels = readings.map(reading => reading.rms).filter(Number.isFinite).sort((a, b) => a - b);
  return levels.length < 20 ? null : levels[Math.floor(levels.length * .2)];
}

/** The input levels of a take, summarised as it goes: how loud the microphone rests and how loud the singer is. */
export class LevelStats {
  // Bin 0 holds digital silence; the rest are 24 per decade from 0.0001 to 1.
  private bins = new Uint32Array(97);
  count = 0;
  add(rms: number) {
    if (!Number.isFinite(rms)) return;
    this.bins[rms <= 1e-4 ? 0 : Math.min(96, 1 + Math.floor((Math.log10(rms) + 4) * 24))]++; this.count++;
  }
  quantile(q: number): number {
    let seen = 0;
    for (let bin = 0; bin < this.bins.length; bin++) { seen += this.bins[bin]; if (seen > q * this.count) return bin ? 10 ** ((bin - .5) / 24 - 4) : 0; }
    return 0;
  }
  /** The resting level sits under the quietest fifth of the take; the singer's is reached by its loudest sixth. */
  get idle() { return this.quantile(.2); }
  get voice() { return this.quantile(.85); }
}

// A loud singer raises the gate up to here, never further: soft passages of the same take must still count.
export const LOUD_LEVEL_GATE = .012;
/**
 * Where silence ends for a take. Headphones leak a faint copy of the music into their own microphone, at about the level
 * of a quiet room; a gate tied to the room lets it through and the song scores itself. So a singer at a normal level keeps
 * the default, slightly raised when loud, and only a voice that is itself quiet and stands clear of the resting level lowers it.
 */
export function levelGate(idle: number, voice: number, speakerBleed = false): number {
  if (!(voice > 0) || voice < 4 * idle) return LEVEL_GATE;
  if (voice >= 4 * LEVEL_GATE) return Math.min(LOUD_LEVEL_GATE, Math.max(LEVEL_GATE, voice * .12));
  return speakerBleed ? LEVEL_GATE : Math.max(MIN_LEVEL_GATE, voice * .25);
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
