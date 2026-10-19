"""Local, one-shot preparation. Never edits the supplied source audio.

python prepare.py --input song.mp3 --output NEW_DIRECTORY --cache MODEL_DIRECTORY
Produces three WAV variants and a manifest containing a reviewable vocal pitch map.
"""
import argparse
import hashlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

# Two passes: each model keeps the stem it was trained for. Inst_HQ_3 leaves bass and brass in the voice it subtracts;
# Kim_Vocal_2 isolates the voice itself, which is what the map and the reduced-voice mix are made from.
INSTRUMENTAL_MODEL = 'UVR-MDX-NET-Inst_HQ_3.onnx'
VOCAL_MODEL = 'Kim_Vocal_2.onnx'
MODEL = f'{INSTRUMENTAL_MODEL} + {VOCAL_MODEL}'
RATE = 44100

def emit(stage, progress, **extra):
    print('ENCORE:' + json.dumps(dict(stage=stage, progress=progress, **extra), ensure_ascii=True), flush=True)

def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def ffmpeg_binary(cache):
    import imageio_ffmpeg
    target = cache / 'bin' / ('ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(), target)
    os.environ['PATH'] = str(target.parent) + os.pathsep + os.environ.get('PATH', '')
    return str(target)

def segment_pitch(frequencies, probabilities, rms, step, duration):
    """Median over voiced regions, pitch hysteresis, no bridging silence/uncertainty."""
    import numpy as np
    from scipy.ndimage import median_filter
    midi = np.full(len(frequencies), np.nan)
    valid = np.isfinite(frequencies) & (probabilities >= 0.65) & (rms >= 0.008)
    midi[valid] = 69 + 12 * np.log2(frequencies[valid] / 440)
    valid &= (midi >= 36) & (midi <= 83)
    # Smooth only contiguous valid regions; never carry a pitch across a rest.
    start = 0
    while start < len(midi):
        if not valid[start]: start += 1; continue
        end = start + 1
        while end < len(midi) and valid[end]: end += 1
        midi[start:end] = median_filter(midi[start:end], size=5, mode='nearest')
        start = end
    notes = []
    active, begin, values = None, 0, []
    def finish(end):
        if active is None: return
        a, b = max(0, begin * step - step / 2), min(duration, end * step - step / 2)
        if b - a >= 0.12:
            notes.append(dict(start=round(a, 4), duration=round(b - a, 4), midi=int(active), confidence=round(float(np.mean(values)), 4)))
    for i in range(len(midi)):
        pitch = int(np.rint(midi[i])) if valid[i] else None
        # Up to 60 cents around the existing pitch suppresses vibrato fragmentation.
        if active is not None and valid[i] and abs(midi[i] - active) <= 0.60: pitch = active
        if pitch != active:
            finish(i); active, begin, values = pitch, i, []
        if active is not None: values.append(probabilities[i])
    finish(len(midi))
    return notes

def analyze_voice_legacy(path, progress=True):
    import librosa
    import numpy as np
    import soundfile as sf
    samples, rate = sf.read(path, dtype='float32', always_2d=True)
    mono = librosa.resample(samples.mean(axis=1), orig_sr=rate, target_sr=16000)
    duration = len(mono) / 16000
    frequencies, confidence, rms = [], [], []
    # Chunked pYIN bounds memory, with overlap so chunk borders aren't artificial rests.
    hop, frame, chunk = 320, 1024, 16000 * 20
    for begin in range(0, len(mono), chunk):
        end = min(len(mono), begin + chunk)
        left, right = max(0, begin - 16000), min(len(mono), end + 16000)
        window = mono[left:right]
        f0, _, prob = librosa.pyin(window, sr=16000, fmin=65.4, fmax=987.8, frame_length=frame, hop_length=hop, fill_na=np.nan)
        energy = librosa.feature.rms(y=window, frame_length=frame, hop_length=hop)[0]
        first = (begin - left) // hop
        count = int(np.ceil((end - begin) / hop))
        frequencies.extend(f0[first:first + count]); confidence.extend(prob[first:first + count]); rms.extend(energy[first:first + count])
        if progress: emit('Analizando la melodía vocal', round(65 + 25 * end / len(mono)))
    notes = segment_pitch(np.asarray(frequencies), np.asarray(confidence), np.asarray(rms), hop / 16000, duration)
    overflow = len(notes) > 2000
    if overflow: notes = []
    seconds = sum(n['duration'] for n in notes)
    return dict(notes=notes, method='pYIN + median/hysteresis', version=importlib.metadata.version('librosa'),
                analyzedSeconds=round(duration, 3), detectedSeconds=round(seconds, 3),
                confidenceThreshold=0.65, minNoteSeconds=0.12,
                warning='Demasiadas notas detectadas. No se generó un mapa; revisa la voz separada.' if overflow else
                        'No se detectaron notas suficientemente estables. Puedes usar las pistas sin puntuación.' if not notes else
                        'Mapa experimental: revisa octavas, coros y tiempos antes de puntuar. Los huecos sin notas no se evalúan.')

def analyze_voice(path, progress=True):
    from melody import analyze_voice as analyze
    return analyze(path, (lambda x: emit('Contrastando detectores y siguiendo la melodía vocal', round(65 + 30 * x))) if progress else None)

def analyze_only(source, output):
    import soundfile as sf
    source, output = source.resolve(), output.resolve()
    if not source.is_file() or not 0 < source.stat().st_size <= 128 * 1024 * 1024:
        raise ValueError('La pista vocal debe ocupar hasta 128 MB.')
    info = sf.info(source)
    if info.format != 'WAV' or info.subtype != 'PCM_16' or info.samplerate != RATE or info.channels != 2 or not 1 <= info.duration <= 600:
        raise ValueError('Usa la voz WAV de una preparación de Encore, sin modificar su formato.')
    output.mkdir(parents=True, exist_ok=False)
    emit('Analizando de nuevo la voz; las pistas se conservan', 5)
    result = dict(schemaVersion=1, sourceSha256=sha(source), analysis=analyze_voice(source))
    (output / 'analysis.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    emit('Mapa mejorado listo para revisar', 100)

def alignment_check(original, reconstructed):
    """Measure lag in start/middle/end signal windows, not just file duration."""
    import numpy as np
    from scipy.signal import correlate, correlation_lags
    a, b = original.mean(axis=1)[::16], reconstructed.mean(axis=1)[::16]
    length = min(len(a), len(b)); window = min(length, int(RATE / 16 * 4))
    results = []
    for fraction in [0.05, 0.5, 0.9]:
        start = max(0, min(length - window, int(length * fraction) - window // 2))
        x, y = a[start:start + window], b[start:start + window]
        norm = float(np.linalg.norm(x) * np.linalg.norm(y))
        if norm < 1e-6: continue
        corr = correlate(x, y, mode='full', method='fft') / norm
        lags = correlation_lags(len(x), len(y))
        within = abs(lags) <= int(RATE / 16 * 0.25)
        peak = int(np.argmax(corr[within])); lag = float(lags[within][peak] * 16 / RATE)
        results.append(dict(position=fraction, lagSeconds=round(lag, 5), correlation=round(float(corr[within][peak]), 4)))
    if not results or any(abs(item['lagSeconds']) > 0.025 or item['correlation'] < 0.7 for item in results):
        raise ValueError('No pudimos comprobar la alineación de las pistas. Se conserva el original; no se importa el resultado.')
    return results

def prepare(source, output, cache):
    started = time.monotonic()
    import numpy as np
    import soundfile as sf
    source, output, cache = source.resolve(), output.resolve(), cache.resolve()
    if not source.is_file() or not 0 < source.stat().st_size <= 30 * 1024 * 1024: raise ValueError('El original debe ser un archivo de hasta 30 MB.')
    # Refuse reuse: a failed or cancelled job can never look like a completed bundle.
    output.mkdir(parents=True, exist_ok=False)
    cache.mkdir(parents=True, exist_ok=True)
    binary = ffmpeg_binary(cache)
    emit('Preparando audio original', 5)
    canonical = output / 'decoded.wav'
    subprocess.run([binary, '-nostdin', '-v', 'error', '-i', str(source), '-t', '601', '-vn', '-ar', str(RATE), '-ac', '2', '-c:a', 'pcm_f32le', str(canonical)], check=True, capture_output=True, timeout=120)
    original, rate = sf.read(canonical, dtype='float32', always_2d=True)
    duration, count = len(original) / rate, len(original)
    if duration < 1 or duration > 600: raise ValueError('Usa un audio de entre 1 segundo y 10 minutos.')
    if not np.isfinite(original).all() or np.max(np.abs(original)) < 1e-5: raise ValueError('El audio está vacío o no contiene señal utilizable.')
    from audio_separator.separator import Separator
    separator = Separator(model_file_dir=str(cache), output_dir=str(output), output_format='WAV', use_soundfile=True,
                          normalization_threshold=1.0, amplification_threshold=0.0, log_level=logging.WARNING)
    emit('Cargando el modelo del instrumental (primera vez: descarga)', 10)
    separator.load_model(model_filename=INSTRUMENTAL_MODEL)
    emit('Separando el instrumental', 15)
    separator.separate(str(canonical), custom_output_names={'Vocals': 'raw_rest_vocals', 'Instrumental': 'raw_instrumental'})
    emit('Cargando el modelo de la voz (primera vez: descarga)', 38)
    separator.load_model(model_filename=VOCAL_MODEL)
    emit('Aislando la voz', 42)
    separator.separate(str(canonical), custom_output_names={'Vocals': 'raw_vocals', 'Instrumental': 'raw_rest_instrumental'})
    stems, adjustments = {}, {}
    for name in ['vocals', 'instrumental', 'rest_vocals', 'rest_instrumental']:
        data, sr = sf.read(output / f'raw_{name}.wav', dtype='float32', always_2d=True)
        if sr != rate or data.shape[1] != 2 or not np.isfinite(data).all(): raise ValueError('Formato de pista inesperado.')
        delta = len(data) - count
        if abs(delta) > rate * 0.05: raise ValueError('La duración de las pistas no coincide con el original.')
        data = data[:count] if delta >= 0 else np.pad(data, ((0, -delta), (0, 0)))
        stems[name] = data
        if not name.startswith('rest_'): adjustments[name] = dict(tailTrimSamples=max(delta, 0), tailPadSamples=max(-delta, 0), offsetSamples=0)
    # Each pass must rebuild the original on its own (so neither model shifted its stem), and so must the pair kept.
    alignment_check(original, stems.pop('rest_vocals') + stems['instrumental'])
    alignment_check(original, stems['vocals'] + stems.pop('rest_instrumental'))
    checks = alignment_check(original, stems['vocals'] + stems['instrumental'])
    # Same gain for both stems. Reduced voice contains exactly one instrumental.
    peak = max(float(np.max(np.abs(stems['vocals']))), float(np.max(np.abs(stems['instrumental']))), float(np.max(np.abs(stems['instrumental'] + 0.25 * stems['vocals']))))
    gain = min(1.0, 0.95 / max(peak, 1e-8))
    descriptors = {}
    for name in ['vocals', 'instrumental', 'reduced']:
        data = stems[name] if name != 'reduced' else stems['instrumental'] + 0.25 * stems['vocals']
        path = output / f'{name}.wav'
        sf.write(path, data * gain, rate, subtype='PCM_16')
        descriptors[name] = dict(file=path.name, sha256=sha(path), bytes=path.stat().st_size, sampleRate=rate, samples=count, channels=2, duration=duration, offsetSamples=0)
    emit('Pistas listas; preparando notas', 65)
    analysis = analyze_voice(output / 'vocals.wav')
    manifest = dict(schemaVersion=1, originalSha256=sha(source), duration=duration, sampleRate=rate, samples=count,
                    separator=dict(package='audio-separator', version=importlib.metadata.version('audio-separator'), model=MODEL, models=dict(instrumental=INSTRUMENTAL_MODEL, vocals=VOCAL_MODEL)),
                    alignment=checks, adjustments=adjustments, sharedGain=gain, reducedVocalGain=0.25,
                    stems=descriptors, analysis=analysis, elapsedSeconds=round(time.monotonic() - started, 2))
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    # Only intermediates created in this fresh output folder are removed.
    for name in ['decoded.wav', 'raw_vocals.wav', 'raw_instrumental.wav', 'raw_rest_vocals.wav', 'raw_rest_instrumental.wav']:
        (output / name).unlink(missing_ok=True)
    emit('Preparación completada', 100)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--cache', type=Path, default=Path('.local/audio/models'))
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--analyze-only', action='store_true')
    args = parser.parse_args()
    if args.check:
        import librosa, soundfile, onnxruntime, torch, torchcrepe
        from audio_separator.separator import Separator
        print(json.dumps(dict(ready=True, separator=importlib.metadata.version('audio-separator'), librosa=librosa.__version__, providers=onnxruntime.get_available_providers(), model=MODEL)))
        return
    if not args.input or not args.output: parser.error('--input y --output son obligatorios')
    try:
        if args.analyze_only: analyze_only(args.input, args.output)
        else: prepare(args.input, args.output, args.cache)
    except Exception as error:
        emit('Error', 0, error=str(error)[:500]); raise

if __name__ == '__main__': main()
