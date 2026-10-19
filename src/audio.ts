import { frequencyOf, song } from './song';
import type { PlayableSong } from './library-model';
import { estimateOffset, ScoreTracker } from './scoring';
import type { Difficulty, Reading, Summary } from './scoring';
import { MicrophoneInput, microphoneError } from './microphone';
import type { ActiveMicrophone, InputReading } from './microphone';
import type { Accompaniment } from './preparation';
import { verifyStem } from './preparation';
import { LEVEL_GATE, referenceMidiAt } from './pitch-reference';
import { hearsCountIn, levelGate, LevelStats, noiseFloor, reportedLatency } from './capture';

export type Mode = 'demo' | 'microphone';
export type { Summary };
export interface Frame { time: number; captureTime: number; frequency: number | null; rms: number; confidence: number; summary: Summary; gate: number; speakerBleed: boolean }
export const emptyFrame = (): Frame => ({ time: -3, captureTime: -3, frequency: null, rms: 0, confidence: 0, summary: new ScoreTracker(song.notes).summary(0), gate: LEVEL_GATE, speakerBleed: false });

export class KaraokeEngine {
  private context: AudioContext | null = null;
  private input: MicrophoneInput | null = null;
  private animation = 0;
  private disposed = false;
  // Readings that arrive before the song clock exists belong to the count-in.
  private origin = Infinity;
  private warmup: InputReading[] = [];
  private readings: Reading[] = [];
  private calibrated = false;
  private offsetMs = 0;
  private automaticOffset = false;
  private reportedLatencyMs: number | null = null;
  private inputLatency = 0;
  private noiseFloor: number | null = null;
  private speakerBleed = false;
  private levels = new LevelStats();
  private chart;
  private tracker;
  private deviceId;
  private track: PlayableSong;
  private fileSource: AudioBufferSourceNode | null = null;
  private accompaniment: Accompaniment;
  // The accompaniment already moved to the chosen key on the local server.
  private override: Blob | null;
  // Share of the theoretical maximum worth 10,000: what the recording's own voice earns, when the song has it.
  private ceiling: number | undefined;
  private latest = { frequency: null as number | null, rms: 0, confidence: 0, time: -Infinity };
  private lastDemoTime = -3;
  private lastPaint = 0;
  constructor(options: { deviceId?: string; transpose?: number; song?: PlayableSong; accompaniment?: Accompaniment; difficulty?: Difficulty; audio?: Blob; ceiling?: number } = {}) {
    this.track = options.song || song;
    this.accompaniment = options.accompaniment || 'original';
    if (this.accompaniment !== 'original' && !this.track.prepared) throw new Error('Prepara las pistas en la biblioteca antes de elegir este acompañamiento.');
    this.override = options.audio || null;
    if (this.track.audio && options.transpose && !this.override) throw new Error('Cambia el tono de la pista antes de cantarla en otro tono.');
    this.chart = this.track.notes.map(note => ({ ...note, midi: note.midi + (options.transpose || 0) }));
    this.ceiling = options.ceiling;
    this.tracker = new ScoreTracker(this.chart, options.difficulty || 'relaxed', undefined, this.ceiling);
    this.deviceId = options.deviceId || '';
  }

  /** Runs once as the count-in ends: settles the delay and the speaker check for this take. */
  private calibrate() {
    this.calibrated = true;
    this.reportedLatencyMs = reportedLatency(this.context!, this.inputLatency);
    if (this.automaticOffset) this.offsetMs = Math.max(0, Math.min(300, Math.round((this.reportedLatencyMs || 0) / 10) * 10));
    this.noiseFloor = noiseFloor(this.warmup);
    this.speakerBleed = hearsCountIn(this.warmup, this.origin);
    this.warmup = [];
  }

  /** The silence gate this take's own levels call for; the default until there is enough of it to judge. */
  private gate(enough: number) {
    return this.levels.count >= enough ? levelGate(this.levels.idle, this.levels.voice, this.speakerBleed) : LEVEL_GATE;
  }

  /** The live score follows a gate that is still settling. The result replays every reading with the final one, so the first seconds are judged like the rest. */
  private conclude(): Summary {
    const tracker = new ScoreTracker(this.chart, this.tracker.difficulty, this.gate(47), this.ceiling);
    for (const reading of this.readings) tracker.sample(reading.time - this.offsetMs / 1000, reading.span, reading.frequency, reading.confidence, reading.rms);
    return tracker.summary(this.track.duration);
  }

  /** A null offset uses the delay the device reports instead of a value the singer chose. */
  async start(mode: Mode, guide: boolean, offsetMs: number | null, onFrame: (frame: Frame) => void, onFinish: (summary: Summary) => void, onError: (message: string) => void, onDevice: (device: ActiveMicrophone) => void = () => {}) {
    this.automaticOffset = offsetMs === null; this.offsetMs = offsetMs ?? 0;
    try {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      await this.context.resume();
      if (this.disposed) return;
      let decoded: AudioBuffer | null = null;
      if (this.track.audio) {
        const variant = this.override || (this.accompaniment === 'original' ? this.track.audio : this.track.prepared![this.accompaniment]);
        if (!this.override && this.accompaniment !== 'original') await verifyStem(variant, this.track.prepared!.manifest.stems[this.accompaniment]);
        if (this.disposed) return;
        decoded = await this.context.decodeAudioData(await variant.arrayBuffer());
        if (this.disposed) return;
        if (Math.abs(decoded.duration - this.track.duration) > 0.05) throw new Error('La duración del audio cambió. Revisa su mapa en la biblioteca.');
      }
      if (mode === 'microphone') {
        this.input = new MicrophoneInput(this.context);
        const ready = await this.input.open(this.deviceId, (data: InputReading) => {
          if (this.disposed) return;
          if (!this.calibrated) { if (data.time < this.origin - .1) this.warmup.push(data); else this.calibrate(); }
          const time = data.time - this.origin;
          this.latest = data;
          if (time > -1) this.readings.push({ time, span: data.span, frequency: data.frequency, confidence: data.confidence, rms: data.rms });
          if (time >= 0) { this.levels.add(data.rms); if (this.levels.count % 47 === 0) this.tracker.gate = this.gate(470); }
          this.tracker.sample(time - this.offsetMs / 1000, data.span, data.frequency, data.confidence, data.rms);
        }, device => { this.inputLatency = device.latency || 0; onDevice(device); }, message => { this.stop(); onError(message); });
        if (!ready || this.disposed) return;
      }
      this.origin = this.context.currentTime + 3;
      if (decoded) {
        this.fileSource = this.context.createBufferSource();
        this.fileSource.buffer = decoded;
        const gain = this.context.createGain(); gain.gain.value = 0.65;
        this.fileSource.connect(gain).connect(this.context.destination);
        this.fileSource.start(this.origin);
      }
      this.scheduleMusic(guide || mode === 'demo');
      const render = () => {
        if (!this.context || this.disposed) return;
        const time = this.context.currentTime - this.origin;
        if (mode === 'demo') {
          const target = this.chart.find(note => time >= note.start && time < note.start + note.duration);
          const frequency = target ? frequencyOf(referenceMidiAt(target, time) + Math.sin(time * 5) * 0.12) : null;
          this.latest = { frequency, rms: frequency ? 0.12 : 0, confidence: 1, time: this.context.currentTime };
          this.tracker.sample(time, time - this.lastDemoTime, frequency, 1, frequency ? 0.12 : 0);
          this.lastDemoTime = time;
        }
        if (time >= this.track.duration + (mode === 'microphone' ? this.offsetMs / 1000 + 0.1 : 0)) {
          const result: Summary = mode === 'microphone' ? this.conclude() : this.tracker.summary(this.track.duration);
          if (mode === 'microphone') result.capture = {
            offsetMs: this.offsetMs, automaticOffset: this.automaticOffset, reportedLatencyMs: this.reportedLatencyMs, noiseFloor: this.noiseFloor, speakerBleed: this.speakerBleed,
            restingLevel: this.levels.idle, voiceLevel: this.levels.voice,
            // Leaked music follows the track, not the singer, so it says nothing about the delay.
            suggestion: this.chart.length && !this.speakerBleed ? estimateOffset(this.chart, this.readings, this.offsetMs, this.tracker.difficulty, result.levelGate, this.ceiling) : null,
            readings: this.readings.filter(reading => reading.time >= 0),
          };
          this.stop();
          onFinish(result);
          return;
        }
        if (performance.now() - this.lastPaint > 32) {
          this.lastPaint = performance.now();
          const fresh = this.context.currentTime - this.latest.time < 0.2;
          const captureTime = this.latest.time - this.origin - (mode === 'microphone' ? this.offsetMs / 1000 : 0);
          onFrame({ time, captureTime, frequency: fresh ? this.latest.frequency : null, rms: fresh ? this.latest.rms : 0, confidence: fresh ? this.latest.confidence : 0, summary: this.tracker.summary(Math.max(0, time)), gate: this.tracker.gate, speakerBleed: this.speakerBleed });
        }
        this.animation = requestAnimationFrame(render);
      };
      render();
    } catch (error) {
      if (this.disposed) return;
      this.stop();
      onError(microphoneError(error));
    }
  }

  private tone(frequency: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine', curve?: [number, number][]) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    if (curve) for (const [time, cents] of curve) oscillator.frequency.linearRampToValueAtTime(frequency * 2 ** (cents / 1200), start + time);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.setValueAtTime(volume, start + Math.max(0.02, duration - 0.06));
    gain.gain.linearRampToValueAtTime(0, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  private scheduleMusic(guide: boolean) {
    for (let beat = -3; beat < (this.track.audio ? 0 : this.track.duration); beat += 0.5) {
      // Over a recording the count-in is as loud as the music, so hearing it in the microphone reveals the speakers.
      this.tone(beat < 0 ? 720 : 1200, this.origin + beat + 0.03, 0.05, beat < 0 ? this.track.audio ? 0.12 : 0.045 : 0.012);
    }
    for (let bar = 0; bar < (this.track.audio ? 0 : 8); bar++) {
      const chord = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]][bar % 4];
      chord.forEach(midi => this.tone(frequencyOf(midi), this.origin + bar * 4, 3.8, 0.024));
    }
    if (guide) this.chart.forEach(note => this.tone(frequencyOf(note.midi), this.origin + note.start, note.duration, 0.065, 'triangle', note.pitchCurve));
  }

  stop() {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.input?.stop();
    if (this.fileSource) { try { this.fileSource.stop(); } catch { /* It may have ended already. */ } this.fileSource.disconnect(); this.fileSource = null; }
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}
