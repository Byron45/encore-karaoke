import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).parents[1] / 'scripts/audio/prepare.py')
prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)

class AnalysisTest(unittest.TestCase):
    def test_known_notes_have_correct_pitch_timing_and_rests(self):
        sr = 16000; t = np.arange(sr * 8) / sr; audio = np.zeros_like(t)
        reference = [(1, 2, 220, 57), (2.3, 3.3, 261.6256, 60), (4, 5, 293.6648, 62), (5.3, 6.5, 261.6256, 60)]
        for a, b, f, _ in reference:
            mask = (t >= a) & (t < b); u = t[mask] - a
            audio[mask] = np.minimum(1, u / .04) * np.minimum(1, (b - t[mask]) / .08) * sum(.12 / h * np.sin(2 * np.pi * f * h * u) for h in range(1, 9))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'voice.wav'; sf.write(path, audio, sr)
            result = prepare.analyze_voice(path, progress=False)
        self.assertEqual(len(result['notes']), 4)
        for note, (a, b, _, midi) in zip(result['notes'], reference):
            self.assertEqual(note['midi'], midi)
            self.assertLess(abs(note['start'] - a), .06)
            self.assertLess(abs(note['start'] + note['duration'] - b), .08)

    def test_silence_noise_and_vibrato_segmentation(self):
        n = 150; f = np.full(n, 220.) * 2 ** ((.25 * np.sin(np.arange(n) * .5)) / 12)
        prob = np.full(n, .9); rms = np.full(n, .1)
        prob[50:80] = .1; rms[110:] = 0
        notes = prepare.segment_pitch(f, prob, rms, .02, 3)
        self.assertEqual([n['midi'] for n in notes], [57, 57]); self.assertLessEqual(notes[0]['start'] + notes[0]['duration'], 1)
        self.assertGreaterEqual(notes[1]['start'], 1.5); self.assertEqual(prepare.segment_pitch(f, prob * 0, rms, .02, 3), [])

    def test_alignment_checks_detect_equal_length_shift(self):
        rng = np.random.default_rng(3); audio = rng.normal(0, .1, (44100 * 3, 2))
        checks = prepare.alignment_check(audio, audio * .8)
        self.assertTrue(all(c['lagSeconds'] == 0 for c in checks))
        with self.assertRaises(ValueError): prepare.alignment_check(audio, np.roll(audio, 4410, axis=0))

if __name__ == '__main__': unittest.main()
