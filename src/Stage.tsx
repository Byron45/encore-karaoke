import { Mic2, Radio, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { frequencyOf, noteName, song as originalSong } from './song';
import type { PlayableSong } from './library-model';
import type { Frame, Mode } from './audio';
import { LyricsView } from './LyricsView';
import { tuningReading } from './pitch-reference';
import { DIFFICULTIES } from './scoring';
import type { Difficulty } from './scoring';

export function Stage({ frame, running, mode, transpose = 0, song = originalSong, difficulty = 'normal' }: { frame: Frame; running: boolean; mode: Mode; transpose?: number; song?: PlayableSong; difficulty?: Difficulty }) {
  const rules = DIFFICULTIES[difficulty];
  const notes = useMemo(() => song.notes.map(note => ({ ...note, midi: note.midi + transpose })), [song.notes, transpose]);
  const noteAt = (time: number) => notes.find(note => time >= note.start && time < note.start + note.duration);
  const chart = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setCompact(entries[0].contentRect.width < 540));
    if (chart.current) observer.observe(chart.current);
    return () => observer.disconnect();
  }, []);
  const width = compact ? 480 : 860;
  const playhead = compact ? 115 : 180;
  const time = running ? frame.time : 0;
  const target = noteAt(time);
  const evaluatedTarget = noteAt(frame.captureTime);
  const tuning = tuningReading(evaluatedTarget, frame.captureTime, running ? frame.frequency : null, frame.confidence, frame.rms, frame.gate, rules.foldOctaves, rules.nominal);
  const currentMidi = tuning.detectedMidi;
  // When any octave counts, draw the voice in the octave of the note it is matching.
  const drawnMidi = currentMidi !== null && rules.foldOctaves && tuning.targetMidi !== null ? currentMidi - 12 * Math.round((currentMidi - tuning.targetMidi) / 12) : currentMidi;
  const currentPhrase = [...notes].reverse().find(note => note.start <= Math.max(0, time))?.phrase || 0;
  const minMidi = notes.length ? Math.min(...notes.map(note => note.midi)) - 1 : 48;
  const maxMidi = notes.length ? Math.max(...notes.map(note => note.midi)) + 1 : 72;
  const y = (midi: number) => 226 - (midi - minMidi) * (200 / Math.max(10, maxMidi - minMidi));
  const axisNotes = [...new Set(notes.map(note => note.midi))].sort((a, b) => a - b).filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 7)) === 0);
  const cents = tuning.cents === null ? null : Math.round(tuning.cents);
  const voiceX = Math.max(62, playhead + (frame.captureTime - Math.max(0, time)) * 90);
  const feedback = !notes.length ? 'Canta a tu ritmo · sin puntuación' : !running ? 'Tu próxima nota empieza aquí' : time < 0 ? 'Prepárate para cantar' : !evaluatedTarget ? song.notes.some(n => n.source === 'automatic') ? 'Sin referencia en este tramo' : 'Respira…' : !tuning.evaluable ? 'Transición de nota' : cents === null ? 'Canta la nota iluminada' : Math.abs(cents) <= rules.full ? '¡En la nota!' : cents > 0 ? 'Baja un poco el tono' : 'Sube un poco el tono';
  return <section className="stage" aria-label="Escenario de canto" data-playback-time={time} data-capture-time={frame.captureTime}>
    <div className="stage-top"><span><Radio size={15} /> ESCENARIO</span><span>{running ? mode === 'demo' ? notes.length ? 'VOZ SIMULADA' : 'ESCUCHANDO CANCIÓN' : 'MICRÓFONO EN VIVO' : 'LISTO CUANDO TÚ ESTÉS'}</span></div>
    <div className="track-heading"><div><span className="eyebrow">{song.audio ? 'TU BIBLIOTECA' : 'PRÁCTICA ORIGINAL'} · {Math.round(song.duration)} SEGUNDOS</span><h2>{song.title}</h2><p>{song.artist || 'Artista sin indicar'}{song.bpm ? <><span>·</span>{song.bpm} BPM</> : null}<span>·</span>{song.notes.length} notas{song.notes.some(n => n.source === 'automatic') ? ' · mapa experimental' : ''}</p></div><div className="difficulty"><span /><span /><span className="dim" /><span className="dim" /> Práctica</div></div>
    <div className="pitch-area" ref={chart}>
      <div className="pitch-legend"><span><i className="lime-dot" />{notes.length ? 'Melodía guía' : 'Canto libre'}</span><span><i className="purple-dot" /> Tu voz{mode === 'demo' && running && notes.length ? ' simulada' : ''}</span></div>
      {notes.length ? <svg viewBox={`0 0 ${width} 265`} role="img" aria-label="Las barras indican la altura y duración de las notas. La línea vertical marca el momento de cantar.">
        <defs><linearGradient id="noteGradient"><stop stopColor="#a6d64c"/><stop offset="1" stopColor="#d4f790"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="5"/></filter><clipPath id="chartClip"><rect x="61" y="10" width={width - 70} height="235"/></clipPath></defs>
        {axisNotes.map(midi => <g key={midi}><line x1="61" x2={width - 10} y1={y(midi)} y2={y(midi)} stroke="#ffffff0d"/><text x="9" y={y(midi) + 4} fill="#92949d" fontSize="13">{noteName(midi)}</text></g>)}
        <g clipPath="url(#chartClip)">
          {notes.map((note, index) => {
            const x = playhead + (note.start - Math.max(0, time)) * 90;
            if (x > width + 10 || x + note.duration * 90 < 50) return null;
            const active = running && target === note;
            return <g key={index} opacity={note.start + note.duration < time ? 0.25 : 1}><rect x={x} y={y(note.midi) - 8} width={note.duration * 90 - 5} height="16" rx="8" fill={active ? '#dcff9f' : 'url(#noteGradient)'}/>{active ? <rect x={x} y={y(note.midi) - 8} width={note.duration * 90 - 5} height="16" rx="8" fill="#c4f26b" filter="url(#glow)" opacity="0.5"/> : null}{note.pitchCurve ? <polyline className="reference-curve" points={note.pitchCurve.map(([t, cents]) => `${x + t * 90},${y(note.midi + cents / 100)}`).join(' ')} fill="none" stroke="#f1ffe0" strokeWidth="2"/> : null}<text x={x + 3} y={y(note.midi) + 29} fill="#b3b5b9" fontSize="12">{note.word}</text></g>;
          })}
          <line x1={playhead} x2={playhead} y1="15" y2="236" stroke="#d1f995" strokeDasharray="3 5" opacity="0.6"/>
          {running && drawnMidi !== null ? <><circle cx={voiceX} cy={Math.min(230, Math.max(18, y(drawnMidi)))} r="14" fill="#bc9bff" filter="url(#glow)"/><circle cx={voiceX} cy={Math.min(230, Math.max(18, y(drawnMidi)))} r="7" fill="#d8c2ff" stroke="#fff" strokeWidth="2"/></> : null}
        </g><text x={playhead - 19} y="258" fill="#c4f26b" fontSize="11">AHORA</text>
      </svg> : <div className="free-stage-hint"><Mic2 size={28}/><p>Tu canción y tu letra.<br/>Canta sin preocuparte por los puntos.</p></div>}
      {running && time < 0 ? <div className="countdown" aria-live="polite">{Math.ceil(-time)}</div> : null}
    </div>
    <div className="tuner" aria-label="Afinador en vivo">
      <div className="tuner-readings"><span>Referencia<strong>{tuning.targetMidi !== null && running ? `${noteName(tuning.targetMidi)} · ${frequencyOf(tuning.targetMidi).toFixed(1)} Hz` : 'Sin referencia'}</strong></span><span>Tu tono<strong>{currentMidi !== null ? `${noteName(currentMidi)} · ${frame.frequency!.toFixed(1)} Hz` : 'Esperando tono claro'}</strong></span><span>Diferencia<strong className={cents !== null && Math.abs(cents) <= rules.full ? 'tuner-in-tune' : ''}>{cents === null ? '—' : `${cents > 0 ? '+' : ''}${cents} cents`}</strong></span></div>
      <div className="tuner-track" role={cents === null ? undefined : 'meter'} aria-label="Desviación de afinación" aria-valuemin={cents === null ? undefined : -100} aria-valuemax={cents === null ? undefined : 100} aria-valuenow={cents === null ? undefined : Math.max(-100, Math.min(100, cents))} aria-valuetext={cents === null ? undefined : `${cents} cents`}><i/>{cents !== null ? <b style={{ left: `${50 + Math.max(-100, Math.min(100, cents)) / 2}%` }}/> : null}</div>
      <div className="tuner-labels"><span>Más grave</span><span>100 cents = 1 semitono</span><span>Más agudo</span></div>
    </div>
    {song.lyrics ? <LyricsView lyrics={song.lyrics} duration={song.duration} time={time}/> : <div className="lyric-display" aria-label="Letra de la canción">
      <p className="phrase-marker">FRASE {currentPhrase + 1} DE {song.phrases.length}</p>
      <p className="current-lyric">{notes.some(n => n.source === 'automatic') ? song.phrases[currentPhrase] : notes.filter(note => note.phrase === currentPhrase).map(note => <span key={note.start} className={running && target === note ? 'word-active' : running && time >= note.start + note.duration ? 'word-past' : ''}>{note.word} </span>)}</p>
      <p className="next-lyric">{song.phrases[currentPhrase + 1] || 'Deja que tu voz llegue hasta el final'}</p>
    </div>}
    <div className="stage-feedback"><span>{cents !== null && Math.abs(cents) <= rules.full ? <Sparkles size={16}/> : <Mic2 size={16}/>} {feedback}</span><span>{running && currentMidi !== null ? `Tu voz: ${noteName(currentMidi)}` : notes.length ? 'Sigue las barras con tu voz' : 'Con la voz de tu archivo original'}</span></div>
  </section>;
}
