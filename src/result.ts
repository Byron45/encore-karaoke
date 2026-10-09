import type { Summary, Mode } from './audio';
import type { PlayableSong } from './library-model';
import type { Accompaniment } from './preparation';
import type { ActiveMicrophone } from './microphone';
import { performanceFeedback } from './scoring.ts';

export interface SessionInfo {
  accompaniment: Accompaniment; vocalGain: number; transpose: number; offsetMs: number;
  microphone: ActiveMicrophone | null;
}

export function resultDocument(summary: Summary, mode: Mode, session: SessionInfo, song: PlayableSong) {
  const scored = song.notes.length > 0;
  const experimentalMap = song.notes.some(n => n.source === 'automatic');
  return {
    version: 4, song: song.title, mode: !scored && mode === 'demo' ? 'listen' : mode,
    simulated: scored && mode === 'demo', scored, createdAt: new Date().toISOString(), ...session,
    experimentalMap,
    ...(scored ? {
      ...summary,
      reference: {
        audioDuration: song.duration, noteCount: song.notes.length,
        curvedNoteCount: song.notes.filter(n => n.pitchCurve).length,
        automaticNoteCount: song.notes.filter(n => n.source === 'automatic').length,
        // Describes the played chart; the preparation may have been edited since generation.
        mappedSeconds: Math.round(song.notes.reduce((sum, n) => sum + n.duration, 0) * 1000) / 1000,
      },
      ...(mode === 'microphone' ? { feedback: performanceFeedback(summary, session.transpose, !song.audio, experimentalMap) } : {}),
    } : { score: null }),
  };
}
