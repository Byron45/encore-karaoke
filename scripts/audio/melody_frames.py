"""Two independent pitch estimators, bounded memory, reproducible local decoding."""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
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

HOP, CHUNK = 320, 20 * 16000
# Chunks are independent (each carries a second of context on both sides), so they are analysed in several processes.
# Four processes of four threads each halve the time on a 16-core CPU and, keeping four threads per chunk as before,
# give bit-identical results; more processes or fewer threads each were slower or not identical.
WORKERS, THREADS = 4, 4

def _threads(count):
    torch.set_num_threads(count)

def _chunk(window, first, count):
    """CREPE, pYIN and level of one chunk with its context, trimmed to the chunk itself."""
    with torch.inference_mode():
        pitch, periodicity = torchcrepe.predict(torch.from_numpy(window.copy())[None], 16000, HOP, 65.4, 987.8, 'full', decoder=precise_viterbi, return_periodicity=True, batch_size=128, device='cpu')
    pyin, _, probability = librosa.pyin(window, sr=16000, fmin=65.4, fmax=987.8, frame_length=1024, hop_length=HOP, fill_na=np.nan)
    energy = librosa.feature.rms(y=window, frame_length=1024, hop_length=HOP)[0]
    return [value[first:first + count] for value in [pitch[0].numpy(), periodicity[0].numpy(), pyin, probability, energy]]

def frames(path, callback=None, workers=WORKERS):
    torch.set_num_threads(THREADS)
    samples, rate = sf.read(path, dtype='float32', always_2d=True)
    mono = librosa.resample(samples.mean(axis=1), orig_sr=rate, target_sr=16000)
    duration = len(mono) / 16000
    jobs = []
    for begin in range(0, len(mono), CHUNK):
        end = min(len(mono), begin + CHUNK)
        left, right = max(0, begin - 16000), min(len(mono), end + 16000)
        jobs.append((mono[left:right], (begin - left) // HOP, int(np.ceil((end - begin) / HOP))))
    parts = [None] * len(jobs)
    if workers > 1 and len(jobs) > 1:
        with ProcessPoolExecutor(max_workers=min(workers, len(jobs)), initializer=_threads, initargs=(THREADS,)) as pool:
            pending = {pool.submit(_chunk, *job): index for index, job in enumerate(jobs)}
            for done, future in enumerate(as_completed(pending), 1):
                parts[pending[future]] = future.result()
                if callback: callback(done / len(jobs))
    else:
        for index, job in enumerate(jobs):
            parts[index] = _chunk(*job)
            if callback: callback((index + 1) / len(jobs))
    names = ['neural', 'periodicity', 'pyin', 'probability', 'rms']
    return {**{name: np.concatenate([part[i] for part in parts]) for i, name in enumerate(names)}, 'step': .02, 'duration': duration}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('input', type=Path); parser.add_argument('output', type=Path); args = parser.parse_args()
    start = time.monotonic()
    result = frames(args.input, lambda x: print(f'{x:.0%}', flush=True))
    args.output.parent.mkdir(parents=True, exist_ok=True); np.savez_compressed(args.output, **result)
    print(json.dumps({'elapsed': time.monotonic() - start, 'duration': result['duration'], 'neuralSeconds65': float(np.sum((result['periodicity'] >= .65) & (result['rms'] >= .008)) * .02), 'pyinSeconds65': float(np.sum((result['probability'] >= .65) & np.isfinite(result['pyin']) & (result['rms'] >= .008)) * .02)}))
