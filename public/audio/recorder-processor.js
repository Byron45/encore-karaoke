// Passes the microphone's samples to the page in blocks, each with the context time of its first sample.
// Used only when the lyrics are checked; the page keeps them in memory and sends them to this computer's server.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(8192);
    this.filled = 0;
    this.start = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    if (this.filled === 0) this.start = currentTime;
    let from = 0;
    while (from < input.length) {
      const count = Math.min(input.length - from, this.block.length - this.filled);
      this.block.set(input.subarray(from, from + count), this.filled);
      this.filled += count; from += count;
      if (this.filled === this.block.length) {
        this.port.postMessage({ time: this.start, samples: this.block }, [this.block.buffer]);
        this.block = new Float32Array(8192); this.filled = 0;
        this.start = currentTime + from / sampleRate;
      }
    }
    return true;
  }
}
registerProcessor('encore-recorder', RecorderProcessor);
