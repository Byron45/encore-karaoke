import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, AudioLines, Check, ChevronRight, CircleHelp, FlaskConical, Headphones, ListMusic, Mic2, Play, SlidersHorizontal, Square, Trophy, X } from 'lucide-react';
import { emptyFrame, KaraokeEngine } from './audio';
import type { Frame, Mode, Summary } from './audio';
import { Stage } from './Stage';
import { song as originalSong } from './song';
import { Library } from './Library';
import { playable } from './library-model';
import type { LibrarySong, PlayableSong } from './library-model';
import { DIFFICULTIES, performanceFeedback, phraseFeedback } from './scoring';
import type { Difficulty } from './scoring';
import { bestScore, savedDifficulty, savedLyricsCheck, savedOffset, storeBest, storeDifficulty, storeLyricsCheck, storeOffset } from './preferences';
import { canRecogniseWords, lyricsLanguage, lyricsSummary, recogniseWords, recordingWords, voicedWords, withLyrics } from './sung-words';
import { LyricsReview } from './LyricsReview';
import { compileLyrics } from './lyrics';
import { lyricWords } from './lyrics-check';
import { resultDocument } from './result';
import type { SessionInfo } from './result';
import { MicrophoneMonitor } from './microphone';
import type { ActiveMicrophone, InputReading } from './microphone';
import { useMicrophones } from './useMicrophones';
import { MicrophonePanel } from './MicrophonePanel';
import { PhraseReview } from './PhraseReview';
import { TakeHistory } from './TakeHistory';
import { saveTake, updateTake } from './take-history';
import { canTranspose, KEY_STEPS, keyLabel, transposedAudio } from './transpose';
import { recordingReference, voiceReadings } from './voice-reference';
import type { RecordingReference } from './voice-reference';

import type { Accompaniment } from './preparation';

type View = 'stage' | 'roadmap' | 'library';
type Status = 'idle' | 'starting' | 'running' | 'finished';
const stages = [
  { title: 'El primer escenario', description: 'Micrófono, melodía original, letras y puntuación local.', check: 'Notas conocidas, silencio, ruido, octavas y flujo en navegador.' },
  { title: 'Tu biblioteca', description: 'Carga de audio, mapa musical y búsqueda de metadatos con MusicBrainz.', check: 'Archivo y versión correctos; validación del mapa; errores y límites de la API.' },
  { title: 'Una experiencia a tu medida', description: 'Ensayo por frases, ajuste de tonalidad e historial personal.', check: 'Progreso guardado, transposición coherente y calibración en dispositivos reales.' },
  { title: 'Encuentra tu canción', description: 'Búsqueda por mood, idioma, década y dificultad.', check: 'Consultas de referencia y relevancia de resultados; respuestas sin coincidencias.' },
  { title: 'Cantar en compañía', description: 'Salas por turnos, cola compartida y duelos.', check: 'Sincronización, reconexión y puntuaciones comparables entre participantes.' },
  { title: 'Más allá de las notas', description: 'Evaluación experimental de palabras cantadas por frase.', check: 'Letras correctas e incorrectas, acentos y ruido; incertidumbre visible.' },
];

/** What 10,000 points stand for in this result: the recording's own voice, the general scale or the tuner. */
function scaleNote(summary: Summary, recording: RecordingReference | null | undefined, previousSeparator: boolean) {
  const points = (value: number) => value.toLocaleString('es-EC');
  if (recording?.difficulty === summary.difficulty) {
    if (DIFFICULTIES[summary.difficulty].ceiling === 1) return `La voz original de esta grabación, medida con este mismo sistema, obtiene ${points(recording.score)} puntos en Estricta.`;
    if (recording.usable) return `10.000 puntos son la voz original de esta grabación, medida con este mismo sistema y esta exigencia: llega al ${Math.round(recording.rawScore / 100)} % del máximo teórico. Sobre ese máximo, este intento suma ${points(summary.rawScore)}.`;
    return `La voz aislada de esta canción se lee peor de lo habitual: llega al ${Math.round(recording.rawScore / 100)} % del máximo teórico, seguramente por instrumentos u otras voces que quedaron en ella. La escala no baja por eso: 10.000 es el 75 % del máximo y la grabación obtiene ${points(recording.score)}. Sobre el máximo teórico, este intento suma ${points(summary.rawScore)}.${previousSeparator ? ' Estas pistas son del separador anterior: vuelve a separarlas en la biblioteca para medir una voz más limpia.' : ''}`;
  }
  return summary.ceiling < 1 ? `La escala está ajustada a una voz real, que no tiene tono en consonantes ni respiraciones: 10.000 es lo que suele alcanzar la voz original de una grabación. Sobre el máximo teórico este intento suma ${points(summary.rawScore)}.` : null;
}

function downloadResult(summary: Summary, mode: Mode, session: SessionInfo, song: PlayableSong) {
  const blob = new Blob([JSON.stringify(resultDocument(summary, mode, session, song), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `encore-${mode}-resultado.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [view, setView] = useState<View>('stage');
  const [song, setSong] = useState<PlayableSong>(originalSong);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [mode, setMode] = useState<Mode>('microphone');
  const [frame, setFrame] = useState<Frame>(emptyFrame);
  const [result, setResult] = useState<Summary | null>(null);
  const [guide, setGuide] = useState(true);
  const [accompaniment, setAccompaniment] = useState<Accompaniment>('original');
  const microphones = useMicrophones();
  // null follows the delay the device reports; a number is the singer's own setting for this microphone.
  const [offset, setOffset] = useState<number | null>(() => savedOffset(microphones.deviceId));
  const [difficulty, setDifficulty] = useState<Difficulty>(savedDifficulty);
  const [review, setReview] = useState<number | null>(null);
  // The phrase the current or last take practised on its own; null for the whole song.
  const [practice, setPractice] = useState<number | null>(null);
  // The mark this take had to beat; undefined until a scored take with the microphone ends.
  const [previousBest, setPreviousBest] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [transpose, setTranspose] = useState(0);
  // Whether the local server can move an audio file's key: unknown until a song with audio reaches the stage.
  const [keyAvailable, setKeyAvailable] = useState<boolean | null>(null);
  const [keyChanging, setKeyChanging] = useState(false);
  // What has to be ready before a take starts: the track in another key and the measure of the original voice.
  const preparing = useRef<AbortController | null>(null);
  // Checking the lyrics: the singer's choice, whether this server recognises sung words, and the check of the last take.
  const [lyricsCheck, setLyricsCheck] = useState(savedLyricsCheck);
  const [wordsAvailable, setWordsAvailable] = useState<boolean | null>(null);
  const [lyricsState, setLyricsState] = useState<{ status: 'idle' | 'analyzing' | 'failed'; error?: string }>({ status: 'idle' });
  const lyricsJob = useRef<AbortController | null>(null);
  const [probeState, setProbeState] = useState<'idle' | 'starting' | 'listening'>('idle');
  const [probeReading, setProbeReading] = useState<Pick<InputReading, 'rms' | 'frequency'>>({ rms: 0, frequency: null });
  const [activeMicrophone, setActiveMicrophone] = useState<ActiveMicrophone | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({ accompaniment: 'original', vocalGain: 1, transpose: 0, offsetMs: 0, microphone: null });
  // The same session as a ref, so the take can be stored the moment it ends with what the result shows.
  const session = useRef(sessionInfo);
  const [historyVersion, setHistoryVersion] = useState(0);
  const monitor = useRef<MicrophoneMonitor | null>(null);
  const engine = useRef<KaraokeEngine | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const busy = status === 'running' || status === 'starting';
  const summary = result || frame.summary;
  const scored = song.notes.length > 0;
  const songKey = song.id || 'ejercicio';
  // Read again when a take ends: it may have just set the mark.
  const cues = useMemo(() => { try { return song.lyrics?.format === 'lrc' ? compileLyrics(song.lyrics, song.duration).cues : []; } catch { return []; } }, [song.lyrics, song.duration]);
  const lyricsUsable = scored && wordsAvailable === true && cues.some(cue => lyricWords(cue.text).length > 0);
  const checkingLyrics = lyricsCheck && lyricsUsable;
  const best = useMemo(() => scored ? bestScore(songKey, difficulty, checkingLyrics) : null, [scored, songKey, difficulty, checkingLyrics, result]);
  const diagnosis = scored ? performanceFeedback(summary, sessionInfo.transpose, !song.audio, song.notes.some(n => n.source === 'automatic')) : { title: 'Cantaste a tu manera.', detail: 'Esta sesión fue libre, sin puntuación. La letra y el audio no contienen todavía una referencia de notas para evaluar afinación.' };

  useEffect(() => () => { engine.current?.stop(); monitor.current?.stop(); }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && (engine.current || monitor.current || preparing.current)) {
        cancelPreparing(); engine.current?.stop(); engine.current = null;
        monitor.current?.stop(); monitor.current = null;
        setProbeState('idle'); setProbeReading({ rms: 0, frequency: null }); setActiveMicrophone(null);
        setStatus('idle'); setFrame(emptyFrame()); setError('La práctica se detuvo al salir de la pestaña. Vuelve a empezar para mantener la sincronización.');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);
  useEffect(() => { if (result) resultHeading.current?.focus(); }, [result]);
  // The isolated voice is measured in the background as soon as the song reaches the stage, so a take does not wait for it.
  useEffect(() => { if (song.prepared?.vocals) voiceReadings(song.prepared.vocals).catch(() => {}); }, [song.prepared?.vocals]);
  useEffect(() => {
    if (!song.audio || keyAvailable !== null) return;
    const controller = new AbortController();
    void canTranspose(controller.signal).then(ready => { if (!controller.signal.aborted) setKeyAvailable(ready); });
    return () => controller.abort();
  }, [song.audio, keyAvailable]);

  useEffect(() => {
    if (!scored || !cues.length || wordsAvailable !== null) return;
    const controller = new AbortController();
    void canRecogniseWords(controller.signal).then(({ available }) => { if (!controller.signal.aborted) setWordsAvailable(available); });
    return () => controller.abort();
  }, [scored, cues, wordsAvailable]);

  function updateSession(next: SessionInfo | ((info: SessionInfo) => SessionInfo)) {
    session.current = typeof next === 'function' ? next(session.current) : next;
    setSessionInfo(session.current);
  }
  function cancelPreparing() {
    preparing.current?.abort(); preparing.current = null; setKeyChanging(false);
  }
  /** Leaves a lyrics check unfinished: the take is still kept, with the points of its notes. */
  function cancelLyrics() {
    lyricsJob.current?.abort(); lyricsJob.current = null; setLyricsState({ status: 'idle' });
  }
  function stop() {
    cancelPreparing(); cancelLyrics(); engine.current?.stop(); engine.current = null;
    setStatus('idle'); setFrame(emptyFrame()); setResult(null); setActiveMicrophone(null);
  }
  function stopProbe() {
    monitor.current?.stop(); monitor.current = null;
    setProbeState('idle'); setProbeReading({ rms: 0, frequency: null }); setActiveMicrophone(null);
  }
  function testMicrophone() {
    // A finished result stays on screen: its own advice sends the singer here.
    stopProbe(); setError(''); setProbeState('starting');
    const instance = new MicrophoneMonitor(); monitor.current = instance;
    void instance.start(microphones.deviceId, reading => {
      if (monitor.current === instance) setProbeReading(reading);
    }, device => {
      if (monitor.current !== instance) return;
      setActiveMicrophone(device); setProbeState('listening'); void microphones.refresh();
    }, message => {
      if (monitor.current !== instance) return;
      stopProbe(); setError(message); void microphones.refresh();
    });
  }
  function selectMicrophone(id: string) {
    stopProbe(); setError(''); microphones.selectDevice(id); setOffset(savedOffset(id));
  }
  function chooseOffset(value: number | null) {
    setOffset(value); storeOffset(microphones.deviceId, value);
  }
  function refreshSong(id: string, record: LibrarySong | null) {
    if (song.id !== id) return;
    // The stage holds its own copy: follow what was just saved, or leave a song that is gone or no longer singable.
    let next: PlayableSong = originalSong;
    try { if (record) next = playable(record); } catch { /* Falls back to the original exercise. */ }
    setSong(next); if (!next.prepared) setAccompaniment('original');
  }
  function navigate(next: View) {
    if (next === view) return;
    if (view === 'library' && libraryBusy) return;
    if (view === 'library' && libraryDirty && !window.confirm('Hay cambios sin guardar. ¿Quieres descartarlos?')) return;
    stop(); stopProbe(); setLibraryDirty(false); setView(next);
  }
  function selectSong(next: PlayableSong) {
    stop(); stopProbe(); setSong(next); setTranspose(0); setAccompaniment('original'); setLibraryDirty(false); setView('stage');
  }
  function start(nextMode: Mode, phrase?: number) {
    engine.current?.stop(); cancelPreparing(); cancelLyrics();
    stopProbe();
    setPractice(phrase ?? null);
    updateSession({ accompaniment, vocalGain: accompaniment === 'original' ? 1 : accompaniment === 'reduced' ? 0.25 : 0, transpose, offsetMs: offset ?? 0, microphone: null, ...(phrase === undefined ? {} : { phrase }) });
    setMode(nextMode); setResult(null); setReview(null); setPreviousBest(undefined); setError(''); setFrame(emptyFrame()); setStatus('starting');
    const controller = new AbortController(); preparing.current = controller;
    // The recording's voice sets the scale when the song has it; a voice that cannot be read leaves the general one.
    const reference = song.prepared?.vocals && song.notes.length ? voiceReadings(song.prepared.vocals).then(readings => recordingReference(song.notes, readings, difficulty), () => null) : Promise.resolve(null);
    // The recording's own words are recognised in the background, so the check after the take does not wait for them.
    if (nextMode === 'microphone' && checkingLyrics && song.prepared?.vocals) void recordingWords(song.prepared.vocals, lyricsLanguage(cues)).catch(() => {});
    // An audio file sings in another key only once the local server has moved the track.
    if (song.audio && transpose) setKeyChanging(true);
    const audio = song.audio && transpose ? transposedAudio(song, accompaniment, transpose, controller.signal) : Promise.resolve(undefined);
    Promise.all([audio, reference]).then(([moved, recording]) => {
      if (preparing.current !== controller) return;
      preparing.current = null; setKeyChanging(false); updateSession(info => ({ ...info, recording }));
      launch(nextMode, moved, recording, phrase, nextMode === 'microphone' && checkingLyrics);
    }, failure => {
      if (preparing.current !== controller) return;
      preparing.current = null; setKeyChanging(false); setStatus('idle'); setError((failure as Error).message);
    });
  }
  /** The lyrics part of a finished take: the singer's recorded voice recognised on this computer and compared with the lyrics. */
  async function checkTakeLyrics(instance: KaraokeEngine, final: Summary, phrase: number | undefined, signal: AbortSignal): Promise<Summary> {
    const recorded = await instance.voiceRecording();
    if (!recorded) throw new Error('No se grabó la voz de esta toma.');
    const language = lyricsLanguage(cues);
    const reference = song.prepared?.vocals ? recordingWords(song.prepared.vocals, language).catch(() => null) : Promise.resolve(null);
    const singer = await recogniseWords(recorded.audio, language, false, signal);
    // Song time as captured, only where the microphone heard a voice; then moved back by the capture delay like the notes.
    const delay = (final.capture?.offsetMs ?? 0) / 1000;
    const heard = voicedWords(singer.words.map(word => ({ ...word, start: word.start + recorded.start, end: word.end + recorded.start })), final.capture?.readings || [], final.levelGate)
      .map(word => ({ ...word, start: word.start - delay, end: word.end - delay }));
    const notes = phrase === undefined ? song.notes : song.notes.filter(note => note.phrase === phrase), last = notes.at(-1)!;
    const from = phrase === undefined ? 0 : Math.max(0, notes[0].start - 1.2), to = phrase === undefined ? song.duration : last.start + last.duration + 1;
    const lyrics = lyricsSummary(cues, heard, from, to, final.score, await reference, singer);
    return lyrics.judged ? { ...final, score: withLyrics(final.score, lyrics.score), lyrics } : final;
  }
  function launch(nextMode: Mode, audio: Blob | undefined, recording: RecordingReference | null, phrase?: number, recordVoice = false) {
    const instance = new KaraokeEngine({ deviceId: microphones.deviceId, transpose, song, accompaniment, difficulty, audio, ceiling: recording?.ceiling, phrase, recordVoice }); engine.current = instance;
    void instance.start(nextMode, guide, offset, next => {
      if (engine.current !== instance) return;
      setStatus('running'); setFrame(next);
    }, final => {
      if (engine.current !== instance) return;
      engine.current = null; setStatus('finished'); setResult(final); updateSession(info => ({ ...info, offsetMs: final.capture?.offsetMs ?? info.offsetMs }));
      // Kept in this browser the moment it ends, so a result that was not downloaded is never lost; the lyrics check,
      // when there is one, replaces it once it is done.
      const info = session.current, createdAt = new Date().toISOString();
      const entry = (take: Summary) => ({ createdAt, songId: songKey, song: song.title, difficulty: take.difficulty, score: take.score, transpose: info.transpose, ...(phrase === undefined ? {} : { phrase }), document: JSON.stringify(resultDocument(take, nextMode, info, song), null, 2) });
      const saved: Promise<string | null> = nextMode === 'microphone' && song.notes.length ? saveTake(entry(final)) : Promise.resolve(null);
      saved.then(() => setHistoryVersion(value => value + 1), failure => setError(`No se pudo guardar este intento en el historial del navegador: ${(failure as Error).message} Descarga el resultado para conservarlo.`));
      const mark = (take: Summary, shown = true) => {
        // A take that scored nothing, that the speakers leaked into or that practised one phrase sets no mark.
        if (nextMode !== 'microphone' || phrase !== undefined || !song.notes.length || take.score <= 0 || take.capture?.speakerBleed) return;
        const best = bestScore(songKey, take.difficulty, !!take.lyrics);
        if (shown) setPreviousBest(best);
        if (best === null || take.score > best) storeBest(songKey, take.difficulty, take.score, !!take.lyrics);
      };
      if (!recordVoice) return mark(final);
      const job = new AbortController(); lyricsJob.current = job; setLyricsState({ status: 'analyzing' });
      // A recognition that never answers must not hold the take: after five minutes it counts as failed.
      const timeout = setTimeout(() => job.abort(new Error('El análisis tardó más de 5 minutos.')), 5 * 60000);
      const stopped = new Promise<never>((_, reject) => job.signal.addEventListener('abort', () => reject(job.signal.reason instanceof Error ? job.signal.reason : new Error('Análisis cancelado.')), { once: true }));
      Promise.race([checkTakeLyrics(instance, final, phrase, job.signal), stopped]).then(take => {
        clearTimeout(timeout);
        const shown = lyricsJob.current === job;
        if (shown) { lyricsJob.current = null; setLyricsState({ status: 'idle' }); setResult(take); }
        if (take.lyrics) void saved.then(id => id ? updateTake(id, entry(take)) : undefined).then(() => setHistoryVersion(value => value + 1), () => {});
        mark(take, shown);
      }, failure => {
        clearTimeout(timeout);
        const shown = lyricsJob.current === job;
        if (shown) { lyricsJob.current = null; setLyricsState({ status: 'failed', error: (failure as Error).message }); }
        mark(final, shown);
      });
    }, message => {
      if (engine.current !== instance) return;
      engine.current = null; setStatus('idle'); setError(message); setActiveMicrophone(null); void microphones.refresh();
    }, device => {
      if (engine.current !== instance) return;
      setActiveMicrophone(device); updateSession(info => ({ ...info, microphone: device })); void microphones.refresh();
    });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('stage'); }} aria-label="Encore, ir al escenario"><span className="brand-icon"><AudioLines size={25}/></span>encore<span className="brand-period">.</span></a>
      <div className="workspace-label">TU ESPACIO</div>
      <nav aria-label="Navegación principal">
        <button className={view === 'stage' ? 'nav-item selected' : 'nav-item'} onClick={() => navigate('stage')}><Mic2 size={19}/> Escenario <ChevronRight size={15}/></button>
        <button aria-label="Biblioteca" title="Biblioteca" className={view === 'library' ? 'nav-item selected' : 'nav-item'} onClick={() => navigate('library')}><ListMusic size={19}/> Biblioteca</button>
        <button aria-label="Nuestro proyecto" title="Nuestro proyecto" className={view === 'roadmap' ? 'nav-item selected' : 'nav-item'} onClick={() => navigate('roadmap')}><FlaskConical size={19}/> Nuestro proyecto <span className="tiny-tag">6</span></button>
      </nav>
      <div className="sidebar-note"><span className="lab-icon"><FlaskConical size={19}/></span><strong>Todo empieza con tu voz.</strong><p>Estamos construyendo tu karaoke, una buena nota a la vez.</p><span className="version">ETAPA 02 <span>·</span> BIBLIOTECA</span></div>
      <button className="help-button" onClick={() => setHelp(value => !value)} aria-expanded={help}><CircleHelp size={18}/> Cómo funciona</button>
      <div className="profile"><div className="avatar">TÚ</div><div><strong>Tu estudio personal</strong><span>Práctica local</span></div><span className="local-mark" title="El audio se procesa en tu dispositivo"/></div>
    </aside>
    <main>
      <header className="topbar"><div><span className="breadcrumb">Tu espacio</span><ChevronRight size={14}/><span>{view === 'stage' ? 'Escenario' : view === 'library' ? 'Biblioteca' : 'Nuestro proyecto'}</span></div><span className="private-label"><span/> Audio en tu dispositivo</span></header>
      <div className="page-content">
        {help ? <div className="help-panel"><div><strong>Así se canta en Encore</strong><p>Conecta auriculares, escucha la melodía y canta las palabras siguiendo las barras. La altura indica la nota; el largo, cuánto sostenerla. La evaluación mide afinación y duración: todavía no reconoce las palabras. Tu voz no se graba ni se envía a un servidor.</p></div><button className="icon-button" aria-label="Cerrar ayuda" onClick={() => setHelp(false)}><X size={19}/></button></div> : null}
        {view === 'stage' ? <>
          <div className="page-heading"><div><div className="eyebrow">MENOS VERGÜENZA. MÁS VOLUMEN.</div><h1>Este es tu escenario<span>.</span></h1><p>Ponte los auriculares. Encuentra tu nota. Disfruta el momento.</p></div><div className="session-tag"><span/> Sesión libre</div></div>
          <div className="studio-grid">
            <div className="main-column">
              <Stage frame={frame} running={status === 'running'} mode={mode} transpose={transpose} song={song} difficulty={difficulty}/>
              <section className="transport" aria-label="Controles de reproducción">
                <div className="progress-row"><span>{formatTime(status === 'finished' ? song.duration : Math.max(0, frame.time))}</span><div className="progress-track" role="progressbar" aria-label="Progreso de la canción" aria-valuenow={Math.round(Math.max(0, Math.min(song.duration, status === 'finished' ? song.duration : frame.time)))} aria-valuemin={0} aria-valuemax={song.duration}><div style={{ width: `${(status === 'finished' ? 1 : Math.max(0, frame.time) / song.duration) * 100}%` }}/></div><span>{formatTime(song.duration)}</span></div>
                <div className="transport-actions"><div className="transport-note"><Headphones size={20}/><span>Mejor con auriculares<small>Evita que la música entre al micrófono</small></span></div><div className="play-actions">{busy ? <button className="secondary-button" onClick={stop}><Square size={16}/> Detener</button> : <button className="secondary-button" onClick={() => start('demo')}><Play size={16}/>{scored ? 'Ver demo' : 'Escuchar canción'}</button>}<button className="primary-button" onClick={() => start('microphone')} disabled={busy}><Mic2 size={18}/>{keyChanging ? 'Cambiando el tono…' : status === 'starting' ? 'Preparando…' : status === 'finished' ? 'Volver a cantar' : 'Empezar a cantar'}</button></div></div>
              </section>
              {error ? <div className="notice error" role="alert">{error}</div> : null}
              {keyChanging ? <div className="notice" role="status"><AudioLines size={17}/><span>Cambiando el tono de la canción en esta computadora ({keyLabel(transpose).toLowerCase()}). La primera vez con cada canción y tono tarda unos segundos; después es inmediato.</span></div> : null}
              {busy && mode === 'demo' && scored ? <div className="notice"><FlaskConical size={17}/><span>Demostración con voz simulada. Estos puntos no evalúan tu voz.</span></div> : null}
              {busy && practice !== null ? <div className="notice" role="status"><Mic2 size={17}/><span>Ensayando la frase {practice + 1}: «{song.phrases[practice]}». Suena desde un poco antes y solo cuentan sus notas.</span></div> : null}
              {busy && mode === 'microphone' && frame.speakerBleed ? <div className="notice" role="status"><Headphones size={17}/><span>Tu micrófono está captando la música de los altavoces. Ponte auriculares: sin ellos la puntuación no es fiable.</span></div> : null}
              {result ? <section className="result-panel"><div className="result-heading"><div><span className="eyebrow">{!scored ? 'SESIÓN SIN PUNTUACIÓN' : mode === 'demo' ? 'RESULTADO SIMULADO' : practice !== null ? `ENSAYO DE LA FRASE ${practice + 1}` : 'PRÁCTICA COMPLETADA'}</span><h2 ref={resultHeading} tabIndex={-1}>{!scored && mode === 'demo' ? 'Lista para cantar contigo.' : mode === 'demo' ? 'Ahora te toca a ti.' : diagnosis.title}</h2></div><Trophy size={30}/></div><p>{scored && mode === 'demo' ? 'La demo muestra una voz generada. Prueba con el micrófono para obtener tu resultado real.' : diagnosis.detail}</p>{mode === 'microphone' && practice !== null ? <><p className="personal-best">Frase {practice + 1}, «{song.phrases[practice]}»: {summary.score.toLocaleString('es-EC')} puntos. Los ensayos no cuentan como marca.</p><div className="practice-actions"><button className="text-button" onClick={() => start('microphone', practice)}><Mic2 size={16}/> Repetir esta frase</button><button className="text-button" onClick={() => start('microphone')}><Play size={16}/> Cantar la canción completa</button></div></> : null}{mode === 'microphone' && scored && previousBest !== undefined ? <p className="personal-best">{previousBest === null ? `Primera marca en esta canción con exigencia ${DIFFICULTIES[summary.difficulty].label}: ${summary.score.toLocaleString('es-EC')} puntos.` : summary.score > previousBest ? `¡Nueva marca personal! La anterior era ${previousBest.toLocaleString('es-EC')}.` : `Tu mejor marca en esta canción sigue siendo ${previousBest.toLocaleString('es-EC')}.`}</p> : null}{mode === 'microphone' && scored ? <div className="result-diagnostics"><p>Entrada utilizada: <strong>{sessionInfo.microphone?.label || 'Sin identificar'}</strong></p><p>{song.audio ? keyLabel(sessionInfo.transpose) : `Registro: ${sessionInfo.transpose < 0 ? 'Grave' : sessionInfo.transpose > 0 ? 'Agudo' : 'Original'}`} · Compensación: {sessionInfo.offsetMs} ms{summary.capture?.automaticOffset ? ' (automática)' : ''} · Exigencia: {DIFFICULTIES[summary.difficulty].label}</p><p>Señal suficiente: {summary.signalCoverage}% · Tono detectado: {summary.coverage}% · Análisis recibido: {summary.analyzedCoverage}%</p><p>Tiempo con tono evaluable: {summary.sungSeconds.toFixed(1)} s de {summary.referenceSeconds.toFixed(1)} s de referencia.</p><p>Desviación absoluta media: {summary.meanAbsoluteCents === null ? "sin tono evaluable" : `${summary.meanAbsoluteCents} cents`} · Promedio firmado: {summary.meanSignedCents === null ? "—" : `${summary.meanSignedCents > 0 ? "+" : ""}${summary.meanSignedCents} cents`}</p><p>El promedio firmado puede compensar errores graves y agudos; un valor cercano a cero no demuestra buena afinación. Estas medidas solo describen los tramos del mapa.</p>{scaleNote(summary, sessionInfo.recording, !song.prepared?.manifest.separator.models) ? <p>{scaleNote(summary, sessionInfo.recording, !song.prepared?.manifest.separator.models)}</p> : null}<p>El análisis recibido indica muestras procesadas, no voz identificada. Si usaste altavoces, repite con auriculares: la música puede mezclarse con tu voz en el micrófono.</p>{summary.excludedBoundarySeconds > 0 ? <p>Se excluyen hasta 20 ms en cada borde de nota automática para tolerar las transiciones ({summary.excludedBoundarySeconds.toFixed(1)} s en total).</p> : null}</div> : null}{mode === 'microphone' && result.capture?.suggestion ? <p className="notice" role="status"><span>Tu voz encaja mejor con <strong>{result.capture.suggestion.offsetMs} ms</strong> de compensación (se usaron {result.capture.offsetMs} ms): este intento habría sumado unos {result.capture.suggestion.score.toLocaleString('es-EC')} puntos.</span><button className="text-button" disabled={offset === result.capture.suggestion.offsetMs} onClick={() => chooseOffset(result.capture!.suggestion!.offsetMs)}>{offset === result.capture.suggestion.offsetMs ? 'Ajuste guardado' : `Usar ${result.capture.suggestion.offsetMs} ms`}</button></p> : null}{song.notes.some(n => n.source === 'automatic') ? <p className="notice">Puntuación sobre un mapa automático experimental: solo incluye los tramos detectados. Comprueba sus notas antes de comparar resultados.</p> : null}<p>Acompañamiento: {sessionInfo.accompaniment === 'original' ? 'Voz original' : sessionInfo.accompaniment === 'reduced' ? 'Voz al 25 %' : 'Solo instrumental'}</p><div className="phrase-results">{song.phrases.map((phrase, i) => { if (practice !== null && i !== practice) return null; const detail = summary.phraseDiagnostics[practice === null ? i : 0], percent = summary.phrases[practice === null ? i : 0], trace = mode === 'microphone' && detail ? result.capture?.readings : undefined; return <Fragment key={i}><div><span>{String(i + 1).padStart(2, '0')}</span><p>{phrase}{detail ? <small>{phraseFeedback(detail)} · {detail.sungSeconds.toFixed(1)} / {detail.referenceSeconds.toFixed(1)} s con tono</small> : null}</p>{trace ? <button className="text-button" aria-expanded={review === i} onClick={() => setReview(review === i ? null : i)}>{review === i ? 'Ocultar trazo' : 'Ver trazo'}</button> : null}{mode === 'microphone' && detail && practice === null ? <button className="text-button" aria-label={`Ensayar la frase ${i + 1}`} onClick={() => start('microphone', i)}>Ensayar</button> : null}<strong>{percent}%</strong></div>{trace && review === i ? <PhraseReview notes={song.notes.filter(note => note.phrase === detail.phrase).map(note => ({ ...note, midi: note.midi + sessionInfo.transpose }))} readings={trace} offsetMs={result.capture!.offsetMs} difficulty={summary.difficulty} gate={summary.levelGate} signedCents={detail.meanSignedCents}/> : null}</Fragment>; })}</div>{lyricsState.status === 'analyzing' ? <p className="notice" role="status">Analizando la letra en esta computadora… La puntuación puede cambiar en unos segundos.</p> : lyricsState.status === 'failed' ? <p className="notice error" role="alert">No se pudo evaluar la letra: {lyricsState.error} La puntuación es solo de la melodía.</p> : null}{result.lyrics ? <LyricsReview lyrics={result.lyrics}/> : null}<button className="text-button" onClick={() => downloadResult(summary, mode, sessionInfo, song)}><ArrowDownToLine size={16}/> Descargar resultado</button></section> : null}
              <section className="practice-tip"><div className="tip-number">01</div><div><strong>No necesitas una voz perfecta.</strong><p>Empieza suave. Sigue la melodía y sostén cada nota hasta el final de la barra.</p></div><AudioLines size={32}/></section>
              <TakeHistory version={historyVersion}/>
            </div>
            <aside className="right-column" aria-label="Resultados y configuración">
              {scored ? <section className="score-card"><div className="card-heading"><span>TU ACTUACIÓN</span><Trophy size={17}/></div><div className="score-number">{summary.score.toLocaleString('es-EC')}<span> / 10.000</span></div><p>{mode === 'demo' && (busy || result) ? 'Puntos de demostración' : 'Cada nota suma'}</p>{best !== null ? <p className="personal-best">Tu mejor marca: {best.toLocaleString('es-EC')} · {DIFFICULTIES[difficulty].label}</p> : null}<div className="score-divider"/><div className="metric"><span>Afinación + duración</span><strong>{summary.accuracy}%</strong></div><div className="metric-meter"><span style={{ width: `${summary.accuracy}%` }}/></div><div className="metric"><span>Afinación al cantar</span><strong>{summary.intonation === null ? "—" : `${summary.intonation}%`}</strong></div>{summary.lyrics ? <div className="metric"><span>Letra</span><strong>{Math.round(summary.lyrics.score * 100)}%</strong></div> : null}<div className="two-metrics"><div><strong>{summary.bestCombo}<small> notas</small></strong><span>Mejor racha</span></div><div><strong>{summary.coverage}<small>%</small></strong><span>Cobertura de notas</span></div></div></section> : <section className="score-card free-score"><span className="eyebrow">CANTO LIBRE</span><h2>Sin puntuación</h2><p>Sigue la letra y disfruta tu canción. Cuando tengamos un mapa de notas, podremos evaluar afinación y duración.</p><p>{song.lyrics?.format === 'lrc' ? 'La letra se sincroniza por líneas; todavía no se evalúan palabras.' : 'Esta letra no tiene tiempos: desplázala a tu ritmo. Todavía no se evalúan palabras.'}</p></section>}
              <section className="settings-card"><div className="card-heading"><span>PREPARA TU VOZ</span><SlidersHorizontal size={17}/></div>
                <MicrophonePanel devices={microphones.devices} deviceId={microphones.deviceId} onSelect={selectMicrophone} onRefresh={() => void microphones.refresh()} listError={microphones.listError} active={activeMicrophone} testing={probeState === 'listening'} connecting={probeState === 'starting'} singing={status === 'running' && mode === 'microphone'} locked={busy} reading={probeState !== 'idle' ? probeReading : busy && mode === 'microphone' ? frame : { rms: 0, frequency: null }} onTest={testMicrophone} onStop={stopProbe} transpose={transpose} firstMidi={song.notes[0]?.midi}/>
                {song.audio ? <div className="register-control"><label htmlFor="register">Tono de la canción</label><select id="register" value={transpose} disabled={busy || !keyAvailable} onChange={event => { setTranspose(Number(event.target.value)); setResult(null); setFrame(emptyFrame()); }}>{KEY_STEPS.map(steps => <option key={steps} value={steps}>{keyLabel(steps)}</option>)}</select><p>{keyAvailable ? 'Sube o baja la música y las notas a evaluar sin cambiar el ritmo. Si la canción te queda alta, bájala uno o dos semitonos.' : keyAvailable === false ? 'Cambiar el tono necesita el motor local de audio (npm run audio:setup). Con exigencia Normal o Relajada puedes cantar en la octava que te resulte cómoda.' : 'Comprobando si este equipo puede cambiar el tono…'}</p></div> : <div className="register-control"><label htmlFor="register">Registro de práctica</label><select id="register" value={transpose} disabled={busy} onChange={event => setTranspose(Number(event.target.value))}><option value={-12}>Grave · una octava abajo</option><option value={0}>Original</option><option value={12}>Agudo · una octava arriba</option></select><p>Cambia la altura de la guía y las notas a evaluar. Elige una altura cómoda para tu voz.</p></div>}
                {scored ? <div className="register-control"><label htmlFor="difficulty">Exigencia de afinación</label><select id="difficulty" value={difficulty} disabled={busy} onChange={event => { const value = event.target.value as Difficulty; setDifficulty(value); storeDifficulty(value); }}><option value="relaxed">Relajada · un semitono</option><option value="normal">Normal · medio semitono</option><option value="strict">Estricta · como un afinador</option></select><p>{DIFFICULTIES[difficulty].foldOctaves ? `Margen de ±${DIFFICULTIES[difficulty].full} cents. Cuenta la nota, no su altura: canta en la octava que te resulte cómoda.` : 'Margen de ±35 cents, en la octava exacta y siguiendo los matices de la referencia.'}</p></div> : null}
                {song.audio ? <div className="accompaniment-control"><label htmlFor="accompaniment">Acompañamiento</label><select id="accompaniment" value={accompaniment} disabled={busy} onChange={event => { setAccompaniment(event.target.value as Accompaniment); setResult(null); setFrame(emptyFrame()); if (event.target.value !== 'original') setGuide(false); }}><option value="original">Fácil · voz original</option><option value="reduced" disabled={!song.prepared}>Intermedio · voz al 25 %</option><option value="instrumental" disabled={!song.prepared}>Difícil · solo instrumental</option></select><p className="settings-hint">{song.prepared ? 'Las tres opciones conservan la letra y las mismas notas de referencia.' : 'Prepara las pistas desde la biblioteca para habilitar más opciones.'}</p></div> : null}
                {scored ? <label className="toggle-row"><span>Evaluar la letra<small>{!cues.length ? 'Necesita la letra con tiempos (LRC) de la biblioteca.' : wordsAvailable === null ? 'Comprobando el reconocimiento de voz…' : !wordsAvailable ? 'Necesita el reconocimiento de voz del motor local (npm run audio:setup).' : 'Experimental. Graba tu voz en este equipo, la compara con la letra y resta hasta un 20 %.'}</small></span><input type="checkbox" role="switch" checked={checkingLyrics} disabled={busy || !lyricsUsable} onChange={event => { setLyricsCheck(event.target.checked); storeLyricsCheck(event.target.checked); }}/></label> : null}<label className="toggle-row"><span>Escuchar melodía guía<small>Te ayuda a encontrar las notas</small></span><input type="checkbox" role="switch" checked={scored && guide} disabled={busy || !scored} onChange={event => setGuide(event.target.checked)}/></label><div className="offset-control"><label htmlFor="offset">Compensar retraso <span>{offset === null ? 'Automático' : `${offset} ms`}</span></label><input id="offset" type="range" min="0" max="300" step="10" value={offset ?? result?.capture?.offsetMs ?? 0} disabled={busy} onChange={event => chooseOffset(Number(event.target.value))}/><p>{offset === null ? 'Se usa el retraso que informa tu equipo. Al terminar una canción te proponemos otro valor si tu voz encaja mejor con él.' : <>Ajuste guardado para este micrófono. <button className="text-button" disabled={busy} onClick={() => chooseOffset(null)}>Volver a automático</button></>}</p></div></section>
              <div className="next-step"><div><Activity size={17}/><span>CONSTRUYENDO JUNTOS</span></div><strong>Tu biblioteca ya tiene escenario.</strong><p>Carga un audio y prepara sus letras y notas, o prueba el ejemplo editable.</p><button className="text-button" onClick={() => navigate('library')}>Abrir biblioteca <ArrowRight size={16}/></button></div>
            </aside>
          </div>
          <footer><span>Hecho para cantar a tu manera.</span><span>ENCORE LAB <span> / </span> V0.2</span></footer>
        </> : view === 'library' ? <Library onDirtyChange={setLibraryDirty} onBusyChange={setLibraryBusy} onStored={refreshSong} onChoose={record => selectSong(playable(record))} onOriginal={() => selectSong(originalSong)}/> : <>
          <div className="page-heading"><div><div className="eyebrow">PASO A PASO, CONTIGO</div><h1>De la primera nota<br/>a tu propio karaoke<span>.</span></h1><p>Cada etapa tiene una prueba técnica y una revisión contigo.</p></div></div>
          <div className="roadmap-intro"><FlaskConical size={23}/><div><strong>Ahora: probar tu biblioteca</strong><p>El micrófono ya pasó tu primera revisión. En esta etapa probamos tus archivos, las notas y la identificación de versiones.</p></div><button className="secondary-button" onClick={() => navigate('library')}>Ir a la biblioteca <ArrowRight size={16}/></button></div>
          <div className="roadmap">{stages.map((stage, i) => <section key={stage.title} className={i === 1 ? 'roadmap-row current' : 'roadmap-row'}><span className="roadmap-number">0{i + 1}</span><div><span className="eyebrow">{i === 0 ? 'PROBADA CONTIGO' : i === 1 ? 'EN REVISIÓN' : 'PRÓXIMAMENTE'}</span><h2>{stage.title}</h2><p>{stage.description}</p><div className="acceptance"><Check size={15}/><span>Evaluador: {stage.check}</span></div></div>{i === 1 ? <span className="roadmap-badge">Actual</span> : null}</section>)}</div>
          <section className="musicbrainz-note"><ListMusic size={24}/><div><h2>MusicBrainz tiene un lugar aquí.</h2><p>Ya puedes buscar artistas, grabaciones y versiones desde tu biblioteca. MusicBrainz aporta metadatos; tú cargas el audio y preparas las letras y notas.</p><a href="https://musicbrainz.org/doc/MusicBrainz_API" target="_blank" rel="noreferrer">Consultar documentación oficial <ArrowRight size={14}/></a></div></section>
        </>}
      </div>
    </main>
  </div>;
}

function formatTime(time: number) { return `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`; }
