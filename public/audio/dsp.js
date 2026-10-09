/** YIN fundamental estimator. AudioWorklet and deterministic tests use this same code. */
export function detectPitch(samples, sampleRate, gate = 0.008) {
  let energy = 0;
  let mean = 0;
  for (const value of samples) mean += value;
  mean /= samples.length;
  for (const value of samples) energy += (value - mean) ** 2;
  const rms = Math.sqrt(energy / samples.length);
  if (rms < gate) return { frequency: null, confidence: 0, rms };
  const half = Math.floor(samples.length / 2);
  const maxLag = Math.min(half - 1, Math.ceil(sampleRate / 65));
  const minLag = Math.max(2, Math.floor(sampleRate / 1000));
  const difference = new Float32Array(maxLag + 1);
  let running = 0;
  difference[0] = 1;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < half; i++) sum += (samples[i] - samples[i + lag]) ** 2;
    running += sum;
    difference[lag] = running === 0 ? 1 : sum * lag / running;
  }
  let lag = minLag;
  for (; lag < maxLag; lag++) {
    if (difference[lag] < 0.15) {
      while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++;
      break;
    }
  }
  if (lag === maxLag) return { frequency: null, confidence: 0, rms };
  const left = difference[lag - 1], center = difference[lag], right = difference[lag + 1];
  const divisor = left - 2 * center + right;
  const refined = lag + (divisor ? 0.5 * (left - right) / divisor : 0);
  const frequency = sampleRate / refined;
  return { frequency: frequency >= 65 && frequency <= 1000 ? frequency : null, confidence: 1 - center, rms };
}
