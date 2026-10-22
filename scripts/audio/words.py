"""Words sung in a recording, with their times, from a local Whisper model. Never edits its input.

python words.py --input voice.wav [--language es] [--cache MODEL_DIRECTORY]
python words.py --check

Prints one JSON line. The model never sees the lyrics: knowing them, it would tend to hear them whatever was sung.
"""
import argparse
import json
from pathlib import Path
import sys
import time

RATE = 16000

def model_name(device):
    # large-v3-turbo on an NVIDIA GPU (seconds per song); on the CPU the small model keeps a song to about a minute.
    return 'turbo' if device == 'cuda' else 'small'

def load(path):
    """Any WAV as 16 kHz mono float32, the input Whisper expects."""
    import numpy as np
    import soundfile as sf
    samples, rate = sf.read(path, dtype='float32', always_2d=True)
    mono = samples.mean(axis=1)
    if rate != RATE:
        import librosa
        mono = librosa.resample(mono, orig_sr=rate, target_sr=RATE)
    return np.ascontiguousarray(mono, dtype=np.float32)

def transcribe(path, cache, language=None):
    import torch
    import whisper
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    name = model_name(device)
    started = time.monotonic()
    model = whisper.load_model(name, device=device, download_root=str(cache / 'whisper'))
    loaded = time.monotonic()
    audio = load(path)
    # No prompt and no conditioning on earlier text, so one misheard line does not steer the next. Whisper's option to
    # skip long silences is left off: on isolated voices it dropped whole sung verses (37 s of one test song). Words it
    # invents over silence are discarded by the app, which knows where the microphone heard a voice.
    result = model.transcribe(audio, language=language, word_timestamps=True, condition_on_previous_text=False,
                              fp16=device == 'cuda', verbose=None)
    words = [dict(word=w['word'].strip(), start=round(float(w['start']), 3), end=round(float(w['end']), 3), probability=round(float(w.get('probability', 0)), 3))
             for segment in result.get('segments', []) for w in segment.get('words', []) if w['word'].strip()]
    return dict(device=device, model=name, language=result.get('language'), seconds=round(len(audio) / RATE, 3),
                loadSeconds=round(loaded - started, 2), elapsedSeconds=round(time.monotonic() - loaded, 2), words=words)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--language')
    parser.add_argument('--cache', type=Path, default=Path('.local/audio/models'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        import torch
        import whisper  # noqa: F401
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(json.dumps(dict(ready=True, device=device, model=model_name(device))))
        return
    if not args.input: parser.error('--input es obligatorio')
    try:
        print(json.dumps(transcribe(args.input.resolve(), args.cache.resolve(), args.language or None), ensure_ascii=False))
    except Exception as error:
        print(json.dumps(dict(error=str(error)[:500]), ensure_ascii=False)); sys.exit(1)

if __name__ == '__main__': main()
