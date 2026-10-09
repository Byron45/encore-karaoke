"""Melody reference from isolated vocals. Never fills truly unvoiced regions."""
import importlib.metadata
import numpy as np
from scipy.ndimage import median_filter
from melody_frames import frames

VERSION = 'encore-melody-2'

def build_map(data):
    step, duration = float(data['step']), float(data['duration'])
    neural, periodicity = np.asarray(data['neural']), np.asarray(data['periodicity'])
    pyin, probability, rms = np.asarray(data['pyin']), np.asarray(data['probability']), np.asarray(data['rms'])
    gate = max(.003, float(np.percentile(rms, 95)) * .05)
    midi = 69 + 12 * np.log2(np.maximum(neural, 1e-9) / 440)
    disagreement = np.abs(12 * np.log2(np.maximum(neural, 1e-9) / pyin))
    conflict = np.isfinite(pyin) & (probability >= .65) & (disagreement > .8)
    # Quiet residual instruments must not pass just because the neural model
    # finds periodicity. A quieter voice needs agreement from both estimators.
    quiet_supported = (rms >= max(.002, gate * .25)) & (probability >= .4) & (disagreement < .5)
    eligible = np.isfinite(midi) & (midi >= 35.5) & (midi <= 83.49) & ((rms >= gate) | quiet_supported) & ~conflict
    valid = eligible & (periodicity >= .65)
    # Recover only short dips supported by the same pitch on both sides and
    # a non-silent, still periodic signal. No interpolation across real rests.
    recovered = 0
    i = 0
    while i < len(valid):
        if valid[i]: i += 1; continue
        end = i + 1
        while end < len(valid) and not valid[end]: end += 1
        if i > 0 and end < len(valid) and end - i <= 3 and eligible[i:end].all() and (periodicity[i:end] >= .4).all() and abs(midi[i - 1] - midi[end]) < .6 and np.max(np.abs(midi[i:end] - midi[i - 1])) < .8:
            valid[i:end] = True; recovered += end - i
        i = end
    notes, discarded = [], 0.
    def emit(a, b, smoothed, run_start):
        nonlocal discarded
        start, end = max(0, a * step - step / 2), min(duration, b * step - step / 2)
        pitches = smoothed[a - run_start:b - run_start]
        clarity = float(np.mean(periodicity[a:b]))
        if end - start < .08 - 1e-6 or clarity < .65:
            discarded += end - start; return
        note = int(np.clip(np.rint(np.median(pitches)), 36, 83))
        # 40 ms control points preserve recorded tuning, vibrato and slides.
        indices = list(range(a, b, 2))
        if indices[-1] != b - 1: indices.append(b - 1)
        curve = [[round(max(0, k * step - start), 4), round(float((smoothed[k - run_start] - note) * 100), 2)] for k in indices]
        curve.insert(0, [0., curve[0][1]]) if curve[0][0] > 0 else None
        curve.append([round(end - start, 4), curve[-1][1]])
        if any(abs(p[1]) > 200 for p in curve):
            discarded += end - start; return
        notes.append(dict(start=round(start, 4), duration=round(end - start, 4), midi=note, confidence=round(clarity, 4), pitchCurve=curve))
    i = 0
    while i < len(valid):
        if not valid[i]: i += 1; continue
        end = i + 1
        while end < len(valid) and valid[end]: end += 1
        smoothed = median_filter(midi[i:end], size=3, mode='nearest')
        begin, anchor, candidate = i, float(np.rint(smoothed[0])), None
        for k in range(i + 1, end):
            pitch = float(smoothed[k - i])
            if abs(pitch - anchor) > .75:
                if candidate is None: candidate = k
                if k - candidate >= 2:
                    emit(begin, candidate, smoothed, i)
                    begin, anchor, candidate = candidate, float(np.rint(np.median(smoothed[candidate - i:k - i + 1]))), None
            else:
                candidate = None
        emit(begin, end, smoothed, i); i = end
    overflow = len(notes) > 2000
    if overflow: notes = []
    return dict(notes=notes, method='CREPE full + pYIN cross-check + continuous pitch', version=VERSION,
                analyzedSeconds=round(duration, 3), detectedSeconds=round(sum(n['duration'] for n in notes), 3),
                confidenceThreshold=.65, minNoteSeconds=.08,
                diagnostics=dict(algorithmVersion=VERSION, crepeVersion=importlib.metadata.version('torchcrepe'),
                                 energyGate=round(gate, 6), conflictSeconds=round(float(np.sum(conflict & (rms >= gate)) * step), 3),
                                 recoveredDipSeconds=round(recovered * step, 3), discardedShortSeconds=round(discarded, 3),
                                 model='CREPE-full', stepSeconds=step),
                warning='Demasiadas notas: no se aplica un mapa incompleto por truncamiento.' if overflow else
                        'Sin melodía suficientemente clara; conserva las pistas y prueba canto libre.' if not notes else
                        'Referencia automática con afinación continua. Revisa coros y posibles errores de octava. Los tramos sin referencia no se puntúan.')

def analyze_voice(path, progress=None):
    return build_map(frames(path, progress))
