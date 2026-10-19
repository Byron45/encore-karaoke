import type { Note } from './song.ts';
import type { Difficulty, Reading } from './scoring.ts';
import { DIFFICULTIES, ScoreTracker, VOICE_CEILING } from './scoring.ts';
import { LevelStats, levelGate } from './capture.ts';

// Below this share of the theoretical maximum the isolated voice is read too poorly to stand for the recording:
// what is missing is the separation's doing (bass or instruments left in the voice), not the singer's.
export const MIN_RECORDING_SHARE = .75;

/** What the song's own isolated voice earns under one difficulty, and the scale a take is scored on because of it. */
export interface RecordingReference {
  difficulty: Difficulty;
  // The recording on the theoretical maximum and on the scale used for the take.
  rawScore: number; score: number;
  // Share of the theoretical maximum worth 10,000 for the take.
  ceiling: number;
  // Whether the recording set the scale; otherwise the general one is used.
  usable: boolean;
}

/** Scores the recording's voice like a singer: same chart, same rules, its own silence gate. Strict keeps its tuner scale. */
export function recordingReference(chart: Note[], readings: Reading[], difficulty: Difficulty): RecordingReference {
  const stats = new LevelStats();
  for (const reading of readings) stats.add(reading.rms);
  const tracker = new ScoreTracker(chart, difficulty, levelGate(stats.idle, stats.voice), 1);
  for (const reading of readings) tracker.sample(reading.time, reading.span, reading.frequency, reading.confidence, reading.rms);
  const share = tracker.summary(Infinity).rawScore / 10000, usable = share >= MIN_RECORDING_SHARE;
  const ceiling = DIFFICULTIES[difficulty].ceiling < 1 ? usable ? share : VOICE_CEILING : 1;
  return { difficulty, rawScore: Math.round(share * 10000), score: Math.round(Math.min(1, share / ceiling) * 10000), ceiling, usable };
}

type Pending = { resolve: (readings: Reading[]) => void; reject: (error: Error) => void };
const cache = new WeakMap<Blob, Promise<Reading[]>>(), pending = new Map<number, Pending>();
let worker: Worker | null = null, next = 0;

function startWorker() {
  const instance = new Worker('/audio/voice-reference.js', { type: 'module' });
  instance.onmessage = ({ data }) => {
    const job = pending.get(data.id); if (!job) return;
    pending.delete(data.id);
    if (data.error) return job.reject(new Error(data.error));
    const readings: Reading[] = Array.from(data.time as Float32Array, (time, i) => ({ time, span: data.span, frequency: data.frequency[i] || null, confidence: data.confidence[i], rms: data.rms[i] }));
    job.resolve(readings);
  };
  instance.onerror = event => {
    event.preventDefault();
    for (const job of pending.values()) job.reject(new Error('No se pudo analizar la voz original.'));
    pending.clear(); instance.terminate(); if (worker === instance) worker = null;
  };
  return instance;
}

/** Pitch readings of an isolated voice, read like the microphone. Each stem is analysed once per session. */
export function voiceReadings(vocals: Blob): Promise<Reading[]> {
  let readings = cache.get(vocals);
  if (!readings) {
    readings = vocals.arrayBuffer().then(wav => new Promise<Reading[]>((resolve, reject) => {
      worker ??= startWorker();
      const id = ++next; pending.set(id, { resolve, reject });
      worker.postMessage({ id, wav }, [wav]);
    }));
    readings.catch(() => cache.delete(vocals));
    cache.set(vocals, readings);
  }
  return readings;
}
