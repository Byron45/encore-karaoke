import json
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/audio'))
from melody import build_map, analyze_voice
from melody_frames import precise_viterbi
import torch

def fixture(midi, probability=None, energy=None, pyin=None, pyin_probability=None):
    n = len(midi)
    return dict(neural=440 * 2 ** ((np.asarray(midi) - 69) / 12), periodicity=np.full(n, .95) if probability is None else probability,
                pyin=440 * 2 ** ((np.asarray(midi) - 69) / 12) if pyin is None else pyin,
                probability=np.full(n, .9) if pyin_probability is None else pyin_probability,
                rms=np.full(n, .1) if energy is None else energy, step=.02, duration=n * .02)

class MelodyTest(unittest.TestCase):
    def test_decoder_preserves_weighted_pitch_peak_without_double_sigmoid(self):
        activations = torch.zeros((1, 360, 8)); activations[:, 150, :] = .9; activations[:, 151, :] = .6
        _, frequencies = precise_viterbi(activations)
        cents = 1200 * torch.log2(frequencies / 10.)
        expected = 1997.3794084376191 + 20 * (150 * .9 + 151 * .6) / 1.5
        self.assertLess(float(torch.max(torch.abs(cents - expected))), .01)

    def test_vibrato_glide_gaps_conflicts_and_quiet_instrument_residue(self):
        midi = 60 + .35 * np.sin(np.arange(100) * .6)
        data = fixture(midi); result = build_map(data)
        self.assertEqual(len(result['notes']), 1)
        self.assertGreater(max(p[1] for p in result['notes'][0]['pitchCurve']), 20)
        self.assertLess(min(p[1] for p in result['notes'][0]['pitchCurve']), -20)
        # True silence stays empty, even with a confident neural pitch.
        data['rms'][35:65] = 0
        result = build_map(data)
        self.assertEqual(len(result['notes']), 2)
        self.assertFalse(any(n['start'] < 1.2 and n['start'] + n['duration'] > .8 for n in result['notes']))
        data = fixture(np.linspace(60, 67, 200)); result = build_map(data)
        self.assertGreater(len(result['notes']), 5); self.assertGreater(result['detectedSeconds'], 3.5)
        data = fixture(np.full(100, 60.)); data['pyin'] *= 2
        self.assertEqual(build_map(data)['notes'], [])
        data = fixture(np.full(100, 60.)); data['rms'][:30] = .003; data['probability'][:30] = .01
        self.assertGreaterEqual(build_map(data)['notes'][0]['start'], .59)

    def test_no_interpolation_over_silence_and_only_short_supported_dips(self):
        data = fixture(np.full(100, 60.)); data['periodicity'][30:32] = .5
        self.assertEqual(len(build_map(data)['notes']), 1)
        data['periodicity'][30:40] = .5
        self.assertEqual(len(build_map(data)['notes']), 2)
        data['periodicity'][:] = .2
        self.assertEqual(build_map(data)['notes'], [])

    def test_real_detectors_against_known_continuous_pitch_and_silence(self):
        sr = 16000; t = np.arange(sr * 10) / sr
        expected = np.full(len(t), np.nan); envelope = np.zeros(len(t))
        for start, end, midi, amp in [(1, 2.5, 57.2, .16), (3, 4.5, 60, .12), (5, 6.5, 64, .025), (7, 9, 62, .14)]:
            mask = (t >= start) & (t < end); u = t[mask] - start
            expected[mask] = midi + .3 * np.sin(2 * np.pi * 5 * u)
            envelope[mask] = amp * np.minimum(1, u / .04) * np.minimum(1, (end - t[mask]) / .05)
        frequency = 440 * 2 ** ((np.nan_to_num(expected, nan=60) - 69) / 12)
        phase = np.cumsum(2 * np.pi * frequency / sr)
        audio = envelope * (np.sin(phase) + .6 * np.sin(2 * phase) + .3 * np.sin(3 * phase))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'reference.wav'; sf.write(path, audio, sr)
            result = analyze_voice(path)
        errors, matched, voiced, false_seconds = [], 0, 0, 0.
        for time in np.arange(0, 10, .01):
            target = expected[min(len(expected) - 1, int(time * sr))]
            n = next((n for n in result['notes'] if n['start'] <= time < n['start'] + n['duration']), None)
            if np.isfinite(target):
                voiced += 1
                if n:
                    curve = np.asarray(n['pitchCurve']); prediction = n['midi'] + np.interp(time - n['start'], curve[:, 0], curve[:, 1]) / 100
                    errors.append(abs(prediction - target) * 100); matched += 1
            elif n: false_seconds += .01
        report = dict(matchedFraction=matched / voiced, medianCents=float(np.median(errors)), p95Cents=float(np.percentile(errors, 95)), falseSilenceSeconds=false_seconds, notes=len(result['notes']))
        Path('artifacts/melody-synthetic-evaluation.json').write_text(json.dumps(report, indent=2))
        self.assertGreater(report['matchedFraction'], .85)
        self.assertLess(report['medianCents'], 20)
        self.assertLess(report['p95Cents'], 50)
        self.assertLess(false_seconds, .12)

if __name__ == '__main__': unittest.main()
