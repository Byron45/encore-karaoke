import { Fragment, useEffect, useRef, useState } from 'react';
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
import { savedDifficulty, savedOffset, storeDifficulty, storeOffset } from './preferences';
import { resultDocument } from './result';
import type { SessionInfo } from './result';
import { MicrophoneMonitor } from './microphone';
import type { ActiveMicrophone, InputReading } from './microphone';
import { useMicrophones } from './useMicrophones';
import { MicrophonePanel } from './MicrophonePanel';
import { PhraseReview } from './PhraseReview';

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
  const [error, setError] = useState('');
  const [help, setHelp] = useState(false);
  const [transpose, setTranspose] = useState(0);
  const [probeState, setProbeState] = useState<'idle' | 'starting' | 'listening'>('idle');
  const [probeReading, setProbeReading] = useState<Pick<InputReading, 'rms' | 'frequency'>>({ rms: 0, frequency: null });
  const [activeMicrophone, setActiveMicrophone] = useState<ActiveMicrophone | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({ accompaniment: 'original', vocalGain: 1, transpose: 0, offsetMs: 0, microphone: null });
  const monitor = useRef<MicrophoneMonitor | null>(null);
  const engine = useRef<KaraokeEngine | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const busy = status === 'running' || status === 'starting';
  const summary = result || frame.summary;
  const scored = song.notes.length > 0;
  const diagnosis = scored ? performanceFeedback(summary, sessionInfo.transpose, !song.audio, song.notes.some(n => n.source === 'automatic')) : { title: 'Cantaste a tu manera.', detail: 'Esta sesión fue libre, sin puntuación. La letra y el audio no contienen todavía una referencia de notas para evaluar afinación.' };

  useEffect(() => () => { engine.current?.stop(); monitor.current?.stop(); }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && (engine.current || monitor.current)) {
        engine.current?.stop(); engine.current = null;
        monitor.current?.stop(); monitor.current = null;
        setProbeState('idle'); setProbeReading({ rms: 0, frequency: null }); setActiveMicrophone(null);
        setStatus('idle'); setFrame(emptyFrame()); setError('La práctica se detuvo al salir de la pestaña. Vuelve a empezar para mantener la sincronización.');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);
  useEffect(() => { if (result) resultHeading.current?.focus(); }, [result]);

  function stop() {
    engine.current?.stop(); engine.current = null;
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
  function start(nextMode: Mode) {
    engine.current?.stop();
    stopProbe();
    setSessionInfo({ accompaniment, vocalGain: accompaniment === 'original' ? 1 : accompaniment === 'reduced' ? 0.25 : 0, transpose, offsetMs: offset ?? 0, microphone: null });
    setMode(nextMode); setResult(null); setReview(null); setError(''); setFrame(emptyFrame()); setStatus('starting');
    const instance = new KaraokeEngine({ deviceId: microphones.deviceId, transpose, song, accompaniment, difficulty }); engine.current = instance;
    void instance.start(nextMode, guide, offset, next => {
      if (engine.current !== instance) return;
      setStatus('running'); setFrame(next);
    }, final => {
      if (engine.current !== instance) return;
      engine.current = null; setStatus('finished'); setResult(final); setSessionInfo(info => ({ ...info, offsetMs: final.capture?.offsetMs ?? info.offsetMs }));
    }, message => {
      if (engine.current !== instance) return;
      engine.current = null; setStatus('idle'); setError(message); setActiveMicrophone(null); void microphones.refresh();
    }, device => {
      if (engine.current !== instance) return;
      setActiveMicrophone(device); setSessionInfo(info => ({ ...info, microphone: device })); void microphones.refresh();
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
                <div className="transport-actions"><div className="transport-note"><Headphones size={20}/><span>Mejor con auriculares<small>Evita que la música entre al micrófono</small></span></div><div className="play-actions">{busy ? <button className="secondary-button" onClick={stop}><Square size={16}/> Detener</button> : <button className="secondary-button" onClick={() => start('demo')}><Play size={16}/>{scored ? 'Ver demo' : 'Escuchar canción'}</button>}<button className="primary-button" onClick={() => start('microphone')} disabled={busy}><Mic2 size={18}/>{status === 'starting' ? 'Preparando…' : status === 'finished' ? 'Volver a cantar' : 'Empezar a cantar'}</button></div></div>
              </section>
              {error ? <div className="notice error" role="alert">{error}</div> : null}
              {busy && mode === 'demo' && scored ? <div className="notice"><FlaskConical size={17}/><span>Demostración con voz simulada. Estos puntos no evalúan tu voz.</span></div> : null}
              {busy && mode === 'microphone' && frame.speakerBleed ? <div className="notice" role="status"><Headphones size={17}/><span>Tu micrófono está captando la música de los altavoces. Ponte auriculares: sin ellos la puntuación no es fiable.</span></div> : null}
              {result ? <section className="result-panel"><div className="result-heading"><div><span className="eyebrow">{!scored ? 'SESIÓN SIN PUNTUACIÓN' : mode === 'demo' ? 'RESULTADO SIMULADO' : 'PRÁCTICA COMPLETADA'}</span><h2 ref={resultHeading} tabIndex={-1}>{!scored && mode === 'demo' ? 'Lista para cantar contigo.' : mode === 'demo' ? 'Ahora te toca a ti.' : diagnosis.title}</h2></div><Trophy size={30}/></div><p>{scored && mode === 'demo' ? 'La demo muestra una voz generada. Prueba con el micrófono para obtener tu resultado real.' : diagnosis.detail}</p>{mode === 'microphone' && scored ? <div className="result-diagnostics"><p>Entrada utilizada: <strong>{sessionInfo.microphone?.label || 'Sin identificar'}</strong></p><p>Registro: {sessionInfo.transpose < 0 ? 'Grave' : sessionInfo.transpose > 0 ? 'Agudo' : 'Original'} · Compensación: {sessionInfo.offsetMs} ms{summary.capture?.automaticOffset ? ' (automática)' : ''} · Exigencia: {DIFFICULTIES[summary.difficulty].label}</p><p>Señal suficiente: {summary.signalCoverage}% · Tono detectado: {summary.coverage}% · Análisis recibido: {summary.analyzedCoverage}%</p><p>Tiempo con tono evaluable: {summary.sungSeconds.toFixed(1)} s de {summary.referenceSeconds.toFixed(1)} s de referencia.</p><p>Desviación absoluta media: {summary.meanAbsoluteCents === null ? "sin tono evaluable" : `${summary.meanAbsoluteCents} cents`} · Promedio firmado: {summary.meanSignedCents === null ? "—" : `${summary.meanSignedCents > 0 ? "+" : ""}${summary.meanSignedCents} cents`}</p><p>El promedio firmado puede compensar errores graves y agudos; un valor cercano a cero no demuestra buena afinación. Estas medidas solo describen los tramos del mapa.</p><p>El análisis recibido indica muestras procesadas, no voz identificada. Si usaste altavoces, repite con auriculares: la música puede mezclarse con tu voz en el micrófono.</p>{summary.excludedBoundarySeconds > 0 ? <p>Se excluyen hasta 20 ms en cada borde de nota automática para tolerar las transiciones ({summary.excludedBoundarySeconds.toFixed(1)} s en total).</p> : null}</div> : null}{mode === 'microphone' && result.capture?.suggestion ? <p className="notice" role="status"><span>Tu voz encaja mejor con <strong>{result.capture.suggestion.offsetMs} ms</strong> de compensación (se usaron {result.capture.offsetMs} ms): este intento habría sumado unos {result.capture.suggestion.score.toLocaleString('es-EC')} puntos.</span><button className="text-button" disabled={offset === result.capture.suggestion.offsetMs} onClick={() => chooseOffset(result.capture!.suggestion!.offsetMs)}>{offset === result.capture.suggestion.offsetMs ? 'Ajuste guardado' : `Usar ${result.capture.suggestion.offsetMs} ms`}</button></p> : null}{song.notes.some(n => n.source === 'automatic') ? <p className="notice">Puntuación sobre un mapa automático experimental: solo incluye los tramos detectados. Comprueba sus notas antes de comparar resultados.</p> : null}<p>Acompañamiento: {sessionInfo.accompaniment === 'original' ? 'Voz original' : sessionInfo.accompaniment === 'reduced' ? 'Voz al 25 %' : 'Solo instrumental'}</p><div className="phrase-results">{song.phrases.map((phrase, i) => { const detail = summary.phraseDiagnostics[i], trace = mode === 'microphone' && detail ? result.capture?.readings : undefined; return <Fragment key={i}><div><span>{String(i + 1).padStart(2, '0')}</span><p>{phrase}{detail ? <small>{phraseFeedback(detail)} · {detail.sungSeconds.toFixed(1)} / {detail.referenceSeconds.toFixed(1)} s con tono</small> : null}</p>{trace ? <button className="text-button" aria-expanded={review === i} onClick={() => setReview(review === i ? null : i)}>{review === i ? 'Ocultar trazo' : 'Ver trazo'}</button> : null}<strong>{summary.phrases[i]}%</strong></div>{trace && review === i ? <PhraseReview notes={song.notes.filter(note => note.phrase === detail.phrase).map(note => ({ ...note, midi: note.midi + sessionInfo.transpose }))} readings={trace} offsetMs={result.capture!.offsetMs} difficulty={summary.difficulty} gate={summary.levelGate} signedCents={detail.meanSignedCents}/> : null}</Fragment>; })}</div><button className="text-button" onClick={() => downloadResult(summary, mode, sessionInfo, song)}><ArrowDownToLine size={16}/> Descargar resultado</button></section> : null}
              <section className="practice-tip"><div className="tip-number">01</div><div><strong>No necesitas una voz perfecta.</strong><p>Empieza suave. Sigue la melodía y sostén cada nota hasta el final de la barra.</p></div><AudioLines size={32}/></section>
            </div>
            <aside className="right-column" aria-label="Resultados y configuración">
              {scored ? <section className="score-card"><div className="card-heading"><span>TU ACTUACIÓN</span><Trophy size={17}/></div><div className="score-number">{summary.score.toLocaleString('es-EC')}<span> / 10.000</span></div><p>{mode === 'demo' && (busy || result) ? 'Puntos de demostración' : 'Cada nota suma'}</p><div className="score-divider"/><div className="metric"><span>Afinación + duración</span><strong>{summary.accuracy}%</strong></div><div className="metric-meter"><span style={{ width: `${summary.accuracy}%` }}/></div><div className="metric"><span>Afinación al cantar</span><strong>{summary.intonation === null ? "—" : `${summary.intonation}%`}</strong></div><div className="two-metrics"><div><strong>{summary.bestCombo}<small> notas</small></strong><span>Mejor racha</span></div><div><strong>{summary.coverage}<small>%</small></strong><span>Cobertura de notas</span></div></div></section> : <section className="score-card free-score"><span className="eyebrow">CANTO LIBRE</span><h2>Sin puntuación</h2><p>Sigue la letra y disfruta tu canción. Cuando tengamos un mapa de notas, podremos evaluar afinación y duración.</p><p>{song.lyrics?.format === 'lrc' ? 'La letra se sincroniza por líneas; todavía no se evalúan palabras.' : 'Esta letra no tiene tiempos: desplázala a tu ritmo. Todavía no se evalúan palabras.'}</p></section>}
              <section className="settings-card"><div className="card-heading"><span>PREPARA TU VOZ</span><SlidersHorizontal size={17}/></div>
                <MicrophonePanel devices={microphones.devices} deviceId={microphones.deviceId} onSelect={selectMicrophone} onRefresh={() => void microphones.refresh()} listError={microphones.listError} active={activeMicrophone} testing={probeState === 'listening'} connecting={probeState === 'starting'} singing={status === 'running' && mode === 'microphone'} locked={busy} reading={probeState !== 'idle' ? probeReading : busy && mode === 'microphone' ? frame : { rms: 0, frequency: null }} onTest={testMicrophone} onStop={stopProbe} transpose={transpose} firstMidi={song.notes[0]?.midi}/>
                <div className="register-control"><label htmlFor="register">Registro de práctica</label><select id="register" value={transpose} disabled={busy || !!song.audio} onChange={event => setTranspose(Number(event.target.value))}><option value={-12}>Grave · una octava abajo</option><option value={0}>Original</option><option value={12}>Agudo · una octava arriba</option></select><p>{song.audio ? 'El archivo se reproduce en su registro original. Con exigencia Normal o Relajada puedes cantarlo en la octava que te resulte cómoda.' : 'Cambia la altura de la guía y las notas a evaluar. Elige una altura cómoda para tu voz.'}</p></div>
                {scored ? <div className="register-control"><label htmlFor="difficulty">Exigencia de afinación</label><select id="difficulty" value={difficulty} disabled={busy} onChange={event => { const value = event.target.value as Difficulty; setDifficulty(value); storeDifficulty(value); }}><option value="relaxed">Relajada · un semitono</option><option value="normal">Normal · medio semitono</option><option value="strict">Estricta · como un afinador</option></select><p>{DIFFICULTIES[difficulty].foldOctaves ? `Margen de ±${DIFFICULTIES[difficulty].full} cents. Cuenta la nota, no su altura: canta en la octava que te resulte cómoda.` : 'Margen de ±35 cents, en la octava exacta y siguiendo los matices de la referencia.'}</p></div> : null}
                {song.audio ? <div className="accompaniment-control"><label htmlFor="accompaniment">Acompañamiento</label><select id="accompaniment" value={accompaniment} disabled={busy} onChange={event => { setAccompaniment(event.target.value as Accompaniment); setResult(null); setFrame(emptyFrame()); if (event.target.value !== 'original') setGuide(false); }}><option value="original">Fácil · voz original</option><option value="reduced" disabled={!song.prepared}>Intermedio · voz al 25 %</option><option value="instrumental" disabled={!song.prepared}>Difícil · solo instrumental</option></select><p className="settings-hint">{song.prepared ? 'Las tres opciones conservan la letra y las mismas notas de referencia.' : 'Prepara las pistas desde la biblioteca para habilitar más opciones.'}</p></div> : null}
                <label className="toggle-row"><span>Escuchar melodía guía<small>Te ayuda a encontrar las notas</small></span><input type="checkbox" role="switch" checked={scored && guide} disabled={busy || !scored} onChange={event => setGuide(event.target.checked)}/></label><div className="offset-control"><label htmlFor="offset">Compensar retraso <span>{offset === null ? 'Automático' : `${offset} ms`}</span></label><input id="offset" type="range" min="0" max="300" step="10" value={offset ?? result?.capture?.offsetMs ?? 0} disabled={busy} onChange={event => chooseOffset(Number(event.target.value))}/><p>{offset === null ? 'Se usa el retraso que informa tu equipo. Al terminar una canción te proponemos otro valor si tu voz encaja mejor con él.' : <>Ajuste guardado para este micrófono. <button className="text-button" disabled={busy} onClick={() => chooseOffset(null)}>Volver a automático</button></>}</p></div></section>
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
