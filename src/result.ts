import type { Summary, Mode } from './audio';
import type { PlayableSong } from './library-model';
import type { Accompaniment } from './preparation';
import type { ActiveMicrophone } from './microphone';
import type { RecordingReference } from './voice-reference';
import { encodeTrace, performanceFeedback } from './scoring.ts';

export interface SessionInfo {
  accompaniment: Accompaniment; vocalGain: number; transpose: number; offsetMs: number;
  microphone: ActiveMicrophone | null;
  // What the song's isolated voice earned under the same rules, when the song has one: it sets the scale.
  recording?: RecordingReference | null;
}

export function resultDocument(summary: Summary, mode: Mode, session: SessionInfo, song: PlayableSong) {
  const scored = song.notes.length > 0;
  const experimentalMap = song.notes.some(n => n.source === 'automatic');
  // The readings travel as compact text: one object per reading would make a four-minute song several megabytes.
  const { readings, ...capture } = summary.capture || { readings: undefined };
  return {
    version: 4, song: song.title, mode: !scored && mode === 'demo' ? 'listen' : mode,
    simulated: scored && mode === 'demo', scored, createdAt: new Date().toISOString(), ...session,
    experimentalMap,
    ...(scored ? {
      ...summary,
      ...(summary.capture ? { capture: { ...capture, ...(readings ? { trace: encodeTrace(readings) } : {}) } } : {}),
      reference: {
        audioDuration: song.duration, noteCount: song.notes.length,
        curvedNoteCount: song.notes.filter(n => n.pitchCurve).length,
        automaticNoteCount: song.notes.filter(n => n.source === 'automatic').length,
        // Describes the played chart; the preparation may have been edited since generation.
        mappedSeconds: Math.round(song.notes.reduce((sum, n) => sum + n.duration, 0) * 1000) / 1000,
        omittedNotes: song.omittedNotes || 0,
        // The chart as played, in the key it was sung, so a result can be studied on its own: start and duration in milliseconds, MIDI note and phrase.
        chart: song.notes.map(n => `${Math.round(n.start * 1000)}:${Math.round(n.duration * 1000)}:${n.midi + session.transpose}:${n.phrase}`).join(','),
      },
      ...(mode === 'microphone' ? { feedback: performanceFeedback(summary, session.transpose, !song.audio, experimentalMap) } : {}),
    } : { score: null }),
  };
}
