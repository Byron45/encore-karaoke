// Reads a song's isolated voice (PCM16 WAV) the way pitch-processor.js reads the microphone, off the main thread.
// The app scores these readings with the same rules as the singer to show what the recording itself obtains.
import { detectPitch } from './dsp.js';

function pcm(buffer) {
  const view = new DataView(buffer), word = at => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (view.byteLength < 44 || word(0) !== 'RIFF' || word(8) !== 'WAVE') throw new Error('La voz aislada no es un WAV válido.');
  let format = null;
  for (let at = 12; at + 8 <= view.byteLength;) {
    const id = word(at), size = view.getUint32(at + 4, true);
    if (id === 'fmt ') format = { channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
    if (id === 'data') {
      if (!format || format.bits !== 16) throw new Error('La voz aislada no es PCM de 16 bits.');
      const frames = Math.floor(Math.min(size, view.byteLength - at - 8) / (2 * format.channels)), mono = new Float32Array(frames);
      for (let i = 0, offset = at + 8; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < format.channels; c++, offset += 2) sum += view.getInt16(offset, true);
        mono[i] = sum / format.channels / 32768;
      }
      return { rate: format.rate, mono };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('La voz aislada no contiene audio.');
}

self.onmessage = ({ data: { id, wav } }) => {
  try {
    const { rate, mono } = pcm(wav);
    const size = Math.max(2048, Math.ceil(rate * 0.043 / 128) * 128), hop = Math.ceil(rate * 0.021 / 128) * 128, stride = Math.max(1, Math.floor(rate / 16000));
    const count = Math.max(0, Math.floor((mono.length - size) / hop) + 1);
    const time = new Float32Array(count), frequency = new Float32Array(count), confidence = new Float32Array(count), rms = new Float32Array(count);
    const compact = new Float32Array(Math.floor(size / stride));
    for (let k = 0; k < count; k++) {
      const end = size + k * hop;
      compact.fill(0);
      for (let i = 0; i < compact.length; i++) for (let j = 0; j < stride; j++) compact[i] += mono[end - size + i * stride + j] / stride;
      const reading = detectPitch(compact, rate / stride, 0.0015);
      time[k] = end / rate - size / (2 * rate); frequency[k] = reading.frequency || 0; confidence[k] = reading.confidence; rms[k] = reading.rms;
    }
    self.postMessage({ id, span: hop / rate, time, frequency, confidence, rms }, [time.buffer, frequency.buffer, confidence.buffer, rms.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
