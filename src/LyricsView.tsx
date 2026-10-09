import { useMemo } from 'react';
import { compileLyrics, cueAt } from './lyrics';
import type { LyricsDocument } from './lyrics';

export function LyricsView({ lyrics, duration, time }: { lyrics: LyricsDocument; duration: number; time: number }) {
  const parsed = useMemo(() => {
    try { return { ...compileLyrics(lyrics, duration), error: '' }; }
    catch (error) { return { text: '', cues: [], error: error instanceof Error ? error.message : 'Letra no válida.' }; }
  }, [lyrics, duration]);
  if (parsed.error) return <p className="mic-warning" role="alert">{parsed.error}</p>;
  if (!parsed.cues.length) return <section className="plain-lyrics" aria-label="Letra sin sincronizar"><span className="eyebrow">LETRA SIN TIEMPOS · DESPLÁZALA A TU RITMO</span><div tabIndex={0}>{parsed.text}</div></section>;
  const index = cueAt(parsed.cues, time), cue = parsed.cues[index];
  const next = parsed.cues.slice(index + 1).find(item => item.text);
  return <section className="synced-lyrics" aria-label="Letra sincronizada por líneas">
    <span className="eyebrow">{index < 0 ? 'PREPÁRATE' : `LÍNEA ${index + 1} DE ${parsed.cues.length}`} · SINCRONIZACIÓN POR LÍNEAS</span>
    <p className="synced-current">{cue?.text || (index < 0 ? 'La voz entra en unos momentos…' : 'Interludio instrumental')}</p>
    <p className="synced-next">{next?.text || 'Disfruta hasta el final'}</p>
  </section>;
}
