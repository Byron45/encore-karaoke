import { detectPitch } from './dsp.js';
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Keep at least 43 ms of audio even on 96 kHz devices.
    this.buffer = new Float32Array(Math.max(2048, Math.ceil(sampleRate * 0.043 / 128) * 128));
    this.hopSize = Math.ceil(sampleRate * 0.021 / 128) * 128;
    this.filled = 0;
    this.hop = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    this.buffer.copyWithin(0, input.length);
    this.buffer.set(input, this.buffer.length - input.length);
    this.filled += input.length;
    this.hop += input.length;
    if (this.filled >= this.buffer.length && this.hop >= this.hopSize) {
      this.hop = 0;
      const stride = Math.max(1, Math.floor(sampleRate / 16000));
      const compact = new Float32Array(Math.floor(this.buffer.length / stride));
      // Average samples before decimation to reduce high-frequency aliasing.
      for (let i = 0; i < compact.length; i++) {
        for (let j = 0; j < stride; j++) compact[i] += this.buffer[i * stride + j] / stride;
      }
      const result = detectPitch(compact, sampleRate / stride);
      this.port.postMessage({ ...result, time: currentTime + input.length / sampleRate - this.buffer.length / (2 * sampleRate), span: this.hopSize / sampleRate });
    }
    return true;
  }
}
registerProcessor('encore-pitch', PitchProcessor);
