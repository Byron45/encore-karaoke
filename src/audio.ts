import { frequencyOf, song } from './song';
import type { PlayableSong } from './library-model';
import { ScoreTracker } from './scoring';
import { MicrophoneInput, microphoneError } from './microphone';
import type { ActiveMicrophone, InputReading } from './microphone';
import type { Accompaniment } from './preparation';
import { verifyStem } from './preparation';
import { referenceMidiAt } from './pitch-reference';

export type Mode = 'demo' | 'microphone';
export type Summary = ReturnType<ScoreTracker['summary']>;
export interface Frame { time: number; captureTime: number; frequency: number | null; rms: number; confidence: number; summary: Summary }
export const emptyFrame = (): Frame => ({ time: -3, captureTime: -3, frequency: null, rms: 0, confidence: 0, summary: new ScoreTracker(song.notes).summary(0) });

export class KaraokeEngine {
  private context: AudioContext | null = null;
  private input: MicrophoneInput | null = null;
  private animation = 0;
  private disposed = false;
  private origin = 0;
  private chart;
  private tracker;
  private deviceId;
  private track: PlayableSong;
  private fileSource: AudioBufferSourceNode | null = null;
  private accompaniment: Accompaniment;
  private latest = { frequency: null as number | null, rms: 0, confidence: 0, time: -Infinity };
  private lastDemoTime = -3;
  private lastPaint = 0;
  constructor(options: { deviceId?: string; transpose?: number; song?: PlayableSong; accompaniment?: Accompaniment } = {}) {
    this.track = options.song || song;
    this.accompaniment = options.accompaniment || 'original';
    if (this.accompaniment !== 'original' && !this.track.prepared) throw new Error('Prepara las pistas en la biblioteca antes de elegir este acompañamiento.');
    if (this.track.audio && options.transpose) throw new Error('Los archivos importados se cantan en su registro original en esta etapa.');
    this.chart = this.track.notes.map(note => ({ ...note, midi: note.midi + (options.transpose || 0) }));
    this.tracker = new ScoreTracker(this.chart);
    this.deviceId = options.deviceId || '';
  }

  async start(mode: Mode, guide: boolean, offsetMs: number, onFrame: (frame: Frame) => void, onFinish: (summary: Summary) => void, onError: (message: string) => void, onDevice: (device: ActiveMicrophone) => void = () => {}) {
    try {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      await this.context.resume();
      if (this.disposed) return;
      let decoded: AudioBuffer | null = null;
      if (this.track.audio) {
        const variant = this.accompaniment === 'original' ? this.track.audio : this.track.prepared![this.accompaniment];
        if (this.accompaniment !== 'original') await verifyStem(variant, this.track.prepared!.manifest.stems[this.accompaniment]);
        if (this.disposed) return;
        decoded = await this.context.decodeAudioData(await variant.arrayBuffer());
        if (this.disposed) return;
        if (Math.abs(decoded.duration - this.track.duration) > 0.05) throw new Error('La duración del audio cambió. Revisa su mapa en la biblioteca.');
      }
      if (mode === 'microphone') {
        this.input = new MicrophoneInput(this.context);
        const ready = await this.input.open(this.deviceId, (data: InputReading) => {
          if (this.disposed) return;
          const time = data.time - this.origin - offsetMs / 1000;
          this.latest = data;
          this.tracker.sample(time, data.span, data.frequency, data.confidence, data.rms);
        }, onDevice, message => { this.stop(); onError(message); });
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
        if (time >= this.track.duration + (mode === 'microphone' ? offsetMs / 1000 + 0.1 : 0)) {
          const result = this.tracker.summary(this.track.duration);
          this.stop();
          onFinish(result);
          return;
        }
        if (performance.now() - this.lastPaint > 32) {
          this.lastPaint = performance.now();
          const fresh = this.context.currentTime - this.latest.time < 0.2;
          const captureTime = this.latest.time - this.origin - (mode === 'microphone' ? offsetMs / 1000 : 0);
          onFrame({ time, captureTime, frequency: fresh ? this.latest.frequency : null, rms: fresh ? this.latest.rms : 0, confidence: fresh ? this.latest.confidence : 0, summary: this.tracker.summary(Math.max(0, time)) });
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
      this.tone(beat < 0 ? 720 : 1200, this.origin + beat + 0.03, 0.05, beat < 0 ? 0.045 : 0.012);
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
