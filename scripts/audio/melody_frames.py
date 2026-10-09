"""Two independent pitch estimators, bounded memory, reproducible local decoding."""
import argparse
import json
import time
from pathlib import Path
import librosa
import numpy as np
import soundfile as sf
import torch
import torchcrepe

def precise_viterbi(activations):
    """Viterbi path plus local weighted cents, without random pitch dithering."""
    bins, _ = torchcrepe.decode.viterbi(activations)
    grid = torch.arange(activations.shape[1], device=activations.device)[None, :, None]
    # CREPE already returns sigmoid activations. Applying sigmoid again would
    # flatten the local peak and pull the reference toward a quantized bin.
    weights = torch.where(torch.isfinite(activations), activations, 0).clamp(0, 1) * ((grid - bins[:, None, :]).abs() <= 4)
    cents = ((grid * 20 + 1997.3794084376191) * weights).sum(dim=1) / weights.sum(dim=1).clamp_min(1e-9)
    return bins, torchcrepe.convert.cents_to_frequency(cents)

def frames(path, callback=None):
    torch.set_num_threads(4)
    samples, rate = sf.read(path, dtype='float32', always_2d=True)
    mono = librosa.resample(samples.mean(axis=1), orig_sr=rate, target_sr=16000)
    duration = len(mono) / 16000
    out = {name: [] for name in ['neural', 'periodicity', 'pyin', 'probability', 'rms']}
    hop, chunk = 320, 20 * 16000
    for begin in range(0, len(mono), chunk):
        end = min(len(mono), begin + chunk)
        left, right = max(0, begin - 16000), min(len(mono), end + 16000)
        window = mono[left:right]
        first, count = (begin - left) // hop, int(np.ceil((end - begin) / hop))
        with torch.inference_mode():
            pitch, periodicity = torchcrepe.predict(torch.from_numpy(window.copy())[None], 16000, hop, 65.4, 987.8, 'full', decoder=precise_viterbi, return_periodicity=True, batch_size=128, device='cpu')
        pyin, _, probability = librosa.pyin(window, sr=16000, fmin=65.4, fmax=987.8, frame_length=1024, hop_length=hop, fill_na=np.nan)
        energy = librosa.feature.rms(y=window, frame_length=1024, hop_length=hop)[0]
        values = [pitch[0].numpy(), periodicity[0].numpy(), pyin, probability, energy]
        for name, value in zip(out, values): out[name].extend(value[first:first + count])
        if callback: callback(end / len(mono))
    return {**{name: np.asarray(value) for name, value in out.items()}, 'step': .02, 'duration': duration}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('input', type=Path); parser.add_argument('output', type=Path); args = parser.parse_args()
    start = time.monotonic()
    result = frames(args.input, lambda x: print(f'{x:.0%}', flush=True))
    args.output.parent.mkdir(parents=True, exist_ok=True); np.savez_compressed(args.output, **result)
    print(json.dumps({'elapsed': time.monotonic() - start, 'duration': result['duration'], 'neuralSeconds65': float(np.sum((result['periodicity'] >= .65) & (result['rms'] >= .008)) * .02), 'pyinSeconds65': float(np.sum((result['probability'] >= .65) & np.isfinite(result['pyin']) & (result['rms'] >= .008)) * .02)}))
