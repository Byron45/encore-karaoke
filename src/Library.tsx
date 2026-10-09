import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Check, FileAudio, Music2, Plus, Save, Search, Trash2, Upload } from 'lucide-react';
import type { Note } from './song';
import { noteName } from './song';
import { MAX_MAP_BYTES, exportMap, importMap, validateNotes } from './library-model';
import type { LibrarySong, RecordingMetadata } from './library-model';
import { listSongs, loadAudio, removeSong, saveSong } from './library-store';
import { createExampleSong } from './library-example';
import { PreparationPanel } from './PreparationPanel';
import { LyricsEditor } from './LyricsEditor';
import { compileLyrics } from './lyrics';

function saveFile(value: Blob, name: string) {
  const url = URL.createObjectURL(value), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
const seconds = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;

export function Library({ onChoose, onOriginal, onDirtyChange, onBusyChange }: { onChoose: (record: LibrarySong) => void; onOriginal: () => void; onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void }) {
  const [records, setRecords] = useState<LibrarySong[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const blocked = busy || saving;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(blocked); return () => onBusyChange(false); }, [blocked, onBusyChange]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    listSongs().then(items => { if (alive) setRecords(items); }).catch(error => { if (alive) setError(errorText(error)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const current = records.find(record => record.id === selected);
  function canLeave() { return !dirty || window.confirm('Hay cambios sin guardar. ¿Quieres descartarlos?'); }
  async function add(file?: File) {
    if (!canLeave()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const record = file ? await loadAudio(file) : await createExampleSong();
      const existing = records.find(item => item.audioHash === record.audioHash);
      if (existing) { setSelected(existing.id); setEditorEpoch(value => value + 1); setDirty(false); setNotice('Este audio ya estaba en tu biblioteca. Abrimos su ficha guardada.'); return; }
      await saveSong(record); setRecords(items => [...items, record]); setSelected(record.id); setDirty(false);
      setNotice(file ? 'Audio guardado. Prepara sus palabras y notas para poder cantar con puntuación.' : 'Ejemplo original listo: puedes editar sus notas o llevarlo al escenario.');
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  async function destroy(record: LibrarySong) {
    if (!window.confirm(`¿Eliminar «${record.title}» y su audio de este navegador?`)) return;
    setError(''); setBusy(true);
    try { await removeSong(record.id); setRecords(items => items.filter(item => item.id !== record.id)); setSelected(null); setDirty(false); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <section className="library-page">
    <div className="page-heading"><div><span className="eyebrow">ETAPA 02 · TU BIBLIOTECA</span><h1>Canciones a tu manera<span>.</span></h1><p>Guarda tu audio, trae la letra completa y empieza a cantar.</p></div><button className="primary-button" disabled={blocked || loading} onClick={() => input.current?.click()}><Upload size={17}/> Cargar audio</button><input ref={input} aria-label="Archivo de audio" type="file" hidden accept=".mp3,.wav,.ogg,.m4a,.flac,.webm" onChange={event => { const file = event.target.files?.[0]; if (file) void add(file); }}/></div>
    <div className="library-intro"><FileAudio size={21}/><p>Los archivos se guardan en este navegador, hasta 30 MB y 10 minutos por canción. Usa audio que tengas permiso de utilizar. MusicBrainz identifica la canción y LRCLIB puede aportar la letra con tiempos.</p></div>
    {error ? <div className="notice error" role="alert">{error}</div> : null}
    {notice ? <div className="notice" role="status">{notice}</div> : null}
    {loading || busy ? <p className="library-status" role="status">{loading ? 'Abriendo biblioteca…' : 'Preparando y guardando el audio…'}</p> : null}
    <div className="library-layout">
      <aside className="library-list"><div className="card-heading"><span>TUS CANCIONES</span><span>{records.length}</span></div>
        {records.map(record => <button disabled={blocked} key={record.id} className={`song-row ${selected === record.id ? 'selected' : ''}`} onClick={() => { if (selected === record.id) return; if (canLeave()) { setSelected(record.id); setDirty(false); setNotice(''); } }}><Music2 size={19}/><span><strong>{record.title}</strong><small>{record.artist || 'Artista sin indicar'} · {seconds(record.duration)}</small><em>{record.notes.length ? `${record.notes.length} notas · listo para cantar` : record.lyrics?.raw.trim() ? 'Letra lista · canto sin puntuación' : 'Faltan letras y notas'}</em></span></button>)}
        {!records.length && !loading ? <p className="library-empty">Tu biblioteca está vacía. Carga un archivo o empieza con nuestro ejemplo editable.</p> : null}
        <button className="text-button" disabled={blocked || loading} onClick={() => void add()}><Plus size={15}/> Añadir ejemplo editable</button>
        <button className="text-button" disabled={blocked} onClick={() => { if (canLeave()) onOriginal(); }}><ArrowLeft size={15}/> Volver al ejercicio original</button>
      </aside>
      {current ? <SongEditor key={`${current.id}-${editorEpoch}`} onSavingChange={setSaving} record={current} onDirty={setDirty} onSave={async record => { await saveSong(record); setRecords(items => items.map(item => item.id === record.id ? record : item)); setDirty(false); }} onChoose={onChoose} onDelete={() => void destroy(current)}/> : <div className="library-welcome"><Music2 size={44}/><h2>De tu archivo al escenario.</h2><ol><li>Carga y escucha tu audio.</li><li>Identifica el título y la versión.</li><li>Busca o pega la letra completa.</li><li>Guarda y empieza a cantar.</li></ol><p>Puedes cantar sin puntuación con tu letra y audio. Prepara voz, instrumental y un mapa automático desde la ficha de tu canción.</p></div>}
    </div>
  </section>;
}

function SongEditor({ record, onSave, onChoose, onDelete, onDirty, onSavingChange }: { record: LibrarySong; onSave: (value: LibrarySong) => Promise<void>; onChoose: (value: LibrarySong) => void; onDelete: () => void; onDirty: (value: boolean) => void; onSavingChange: (value: boolean) => void }) {
  const [draft, setDraft] = useState(record);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pendingCandidate, setPendingCandidate] = useState(false);
  const [visibleNotes, setVisibleNotes] = useState(80);
  const [time, setTime] = useState(0);
  const [shift, setShift] = useState(0);
  const player = useRef<HTMLAudioElement>(null);
  const mapInput = useRef<HTMLInputElement>(null);
  const errors = validateNotes(draft.notes, draft.duration);
  const ready = errors.length === 0;
  const freeSinging = draft.notes.length === 0 && !!draft.lyrics?.raw.trim();
  useEffect(() => {
    const objectUrl = URL.createObjectURL(record.audio); setUrl(objectUrl);
    const audio = player.current;
    return () => { audio?.pause(); URL.revokeObjectURL(objectUrl); };
  }, [record.id, record.audio]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (draft !== record || pendingCandidate || processing) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [draft, record, pendingCandidate, processing]);
  useEffect(() => { onDirty(draft !== record || pendingCandidate); }, [draft, record, pendingCandidate, onDirty]);
  function change(update: Partial<LibrarySong>) { setDraft(value => ({ ...value, ...update })); setSaved(''); onDirty(true); }
  function updateNote(index: number, update: Partial<Note>) {
    change({ notes: draft.notes.map((note, i) => {
      if (i !== index) return note;
      const pitchCurve = note.pitchCurve && update.duration !== undefined && Number.isFinite(update.duration) && update.duration >= .08
        ? note.pitchCurve.map(([t, cents]) => [t * update.duration! / note.pitchCurve!.at(-1)![0], cents] as [number, number]) : note.pitchCurve;
      return { ...note, ...update, ...(pitchCurve ? { pitchCurve } : {}) };
    }) });
  }
  function addNote() {
    if (draft.notes.length >= 2000) return;
    const last = draft.notes.at(-1), start = last ? Number((last.start + last.duration).toFixed(3)) : 0;
    change({ notes: [...draft.notes, { start, duration: 0.8, midi: last?.midi || 60, phrase: last?.phrase || 0, word: '' }] });
  }
  async function persist(andSing = false) {
    setError('');
    if (pendingCandidate) { setError('Acepta o descarta la preparación pendiente antes de guardar.'); return; }
    if (!draft.title.trim()) { setError('Escribe un título para la canción.'); return; }
    if (draft.bpm !== null && (!Number.isFinite(draft.bpm) || draft.bpm < 30 || draft.bpm > 300)) { setError('El tempo debe estar entre 30 y 300 BPM, o quedar vacío.'); return; }
    if ((draft.notes.length || andSing && !freeSinging) && !ready) { setError(errors.slice(0, 3).join(' ')); return; }
    try { if (draft.lyrics?.raw.trim()) compileLyrics(draft.lyrics, draft.duration); }
    catch (error) { setError(errorText(error)); return; }
    setSaving(true); onSavingChange(true);
    try {
      const value = { ...draft, lyrics: draft.lyrics?.raw.trim() ? draft.lyrics : undefined, title: draft.title.trim(), artist: draft.artist.trim(), notes: draft.notes.map(note => ({ ...note, word: note.word.trim() })), updatedAt: new Date().toISOString() };
      await onSave(value); setDraft(value); setSaved('Cambios guardados en este navegador.');
      if (andSing) { player.current?.pause(); onChoose(value); }
    } catch (error) { setError(errorText(error)); }
    finally { setSaving(false); onSavingChange(false); }
  }
  async function readMap(file: File) {
    try { if (file.size > MAX_MAP_BYTES) throw new Error('El mapa supera 12 MB.'); change({ notes: importMap(await file.text(), draft), automaticMap: undefined }); setError(''); setSaved('Mapa importado. Guarda los cambios para conservarlo.'); }
    catch (error) { setError(errorText(error)); }
    finally { if (mapInput.current) mapInput.current.value = ''; }
  }
  return <article className="song-editor">
    <div className="editor-heading"><div><span className="eyebrow">PREPARAR CANCIÓN</span><h2>{draft.title}</h2></div><button className="icon-button" disabled={saving || processing} aria-label="Eliminar canción" title="Eliminar canción" onClick={onDelete}><Trash2 size={18}/></button></div>
    <PreparationPanel record={draft} saving={saving} onPending={setPendingCandidate} onBusy={value => { setProcessing(value); onSavingChange(value); }} onChange={change}/>
    <fieldset disabled={saving || processing} className="editor-content"><fieldset disabled={saving || processing} className="editor-fields"><label>Título<input maxLength={160} value={draft.title} onChange={event => change({ title: event.target.value, recording: undefined })}/></label><label>Artista<input maxLength={160} value={draft.artist} onChange={event => change({ artist: event.target.value, recording: undefined })}/></label><label>Tempo (opcional)<input type="number" min="30" max="300" value={draft.bpm ?? ''} placeholder="BPM" onChange={event => change({ bpm: event.target.value === '' ? null : Number(event.target.value) })}/></label></fieldset>
    <div className="audio-preview"><span>{draft.audioName} · {seconds(draft.duration)}</span><audio ref={player} src={url || undefined} controls preload="metadata" onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onError={() => setError('No se pudo reproducir este audio. Prueba otra codificación.')} aria-label="Escuchar audio importado"/><p>Escucha la pista y pausa donde empiece una palabra. Tiempo actual: <strong>{time.toFixed(2)} s</strong></p></div>
    <MusicBrainzSearch record={draft} onAssociate={recording => change({ recording, title: recording.title, artist: recording.artist })}/>
    <LyricsEditor value={draft.lyrics} title={draft.title} artist={draft.artist} duration={draft.duration} time={time} onChange={lyrics => change({ lyrics })}/>
    <div className="map-heading"><div><h3>Mapa de notas · opcional para canto libre</h3><p>Estas notas sirven para evaluar afinación. La letra completa de arriba se muestra de forma independiente. El editor manual queda disponible para corregir o preparar un mapa.</p></div><span className={`map-state ${ready ? 'ready' : ''}`}>{ready ? 'Mapa válido' : 'Por preparar'}</span></div>
    <div className="map-toolbar"><button className="secondary-button" disabled={saving || processing || draft.notes.length >= 2000} onClick={addNote}><Plus size={15}/> Añadir nota</button><button className="secondary-button" disabled={saving || processing} onClick={() => mapInput.current?.click()}><Upload size={15}/> Importar mapa</button><button className="secondary-button" disabled={!ready} onClick={() => saveFile(new Blob([JSON.stringify(exportMap(draft), null, 2)], { type: 'application/json' }), `${draft.title}-mapa.json`)}><ArrowDownToLine size={15}/> Exportar mapa</button><button className="text-button" onClick={() => saveFile(draft.audio, draft.audioName)}>Descargar audio</button><input ref={mapInput} aria-label="Archivo del mapa" hidden type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void readMap(file); }}/></div>
    {!draft.notes.length ? <div className="empty-map"><p>Este audio todavía no tiene un mapa. Añade la primera nota o importa un mapa Encore preparado para este mismo archivo.</p><p>El audio y el mapa se vinculan por su contenido para evitar puntuar una versión distinta por accidente.</p></div> : <div className="note-table-scroll"><table className="note-table"><thead><tr><th>Palabra</th><th>Frase</th><th>Inicio (s)</th><th>Duración (s)</th><th>Nota</th><th>Acciones</th></tr></thead><tbody>{draft.notes.slice(0, visibleNotes).map((note, i) => <tr key={i}><td><input aria-label={`Palabra ${i + 1}`} maxLength={100} value={note.word} placeholder={note.source === 'automatic' ? 'Nota automática' : 'Palabra'} disabled={saving || processing} onChange={event => updateNote(i, { word: event.target.value })}/></td><td><input aria-label={`Frase ${i + 1}`} type="number" min="1" max="2000" value={Number.isFinite(note.phrase) ? note.phrase + 1 : ''} disabled={saving || processing} onChange={event => updateNote(i, { phrase: event.target.value === '' ? NaN : Number(event.target.value) - 1 })}/></td><td><input aria-label={`Inicio ${i + 1}`} type="number" min="0" step="0.01" value={Number.isFinite(note.start) ? note.start : ''} disabled={saving || processing} onChange={event => updateNote(i, { start: event.target.value === '' ? NaN : Number(event.target.value) })}/></td><td><input aria-label={`Duración ${i + 1}`} type="number" min="0.08" step="0.01" value={Number.isFinite(note.duration) ? note.duration : ''} disabled={saving || processing} onChange={event => updateNote(i, { duration: event.target.value === '' ? NaN : Number(event.target.value) })}/></td><td><select aria-label={`Nota ${i + 1}`} value={note.midi} disabled={saving || processing} onChange={event => updateNote(i, { midi: Number(event.target.value) })}>{Array.from({ length: 48 }, (_, index) => index + 36).map(midi => <option key={midi} value={midi}>{noteName(midi)}</option>)}</select></td><td><div className="note-actions"><button className="text-button" disabled={saving || processing} title="Usar posición del reproductor" aria-label={`Marcar inicio ${i + 1}`} onClick={() => updateNote(i, { start: Number((player.current?.currentTime || 0).toFixed(2)) })}>Marcar</button><button className="icon-button" disabled={saving || processing} aria-label={`Eliminar nota ${i + 1}`} onClick={() => change({ notes: draft.notes.filter((_, index) => index !== i) })}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table></div>}
    {draft.notes.length > visibleNotes ? <button className="text-button" onClick={() => setVisibleNotes(value => value + 80)}>Mostrar más notas ({visibleNotes} de {draft.notes.length})</button> : null}
    {draft.notes.some(n => n.source === 'automatic') ? <p className="notice">Mapa experimental generado desde la voz. Los campos de palabra pueden quedar vacíos: la letra completa es independiente.</p> : null}
    {draft.notes.length ? <div className="map-shift"><label>Desplazar todas las notas (s)<input type="number" step="0.1" value={Number.isFinite(shift) ? shift : ''} onChange={event => setShift(event.target.value === '' ? NaN : Number(event.target.value))}/></label><button className="secondary-button" disabled={saving || processing || !Number.isFinite(shift)} onClick={() => { change({ notes: draft.notes.map(note => ({ ...note, start: Number((note.start + shift).toFixed(3)) })) }); setShift(0); }}>Aplicar desfase</button></div> : null}
    {draft.notes.length && !ready ? <ul className="validation-errors" aria-label="Errores del mapa">{errors.slice(0, 5).map((error, i) => <li key={i}>{error}</li>)}</ul> : null}
    {error ? <div className="notice error" role="alert">{error}</div> : null}{saved ? <p className="save-status" role="status"><Check size={15}/>{saved}</p> : null}
    {freeSinging ? <p className="notice">Puedes cantar con la letra y tu audio original. Esta sesión no tendrá puntuación porque aún no hay un mapa de notas.</p> : null}
    {pendingCandidate ? <p className="notice">Acepta o descarta las pistas del borrador para poder guardar y cantar.</p> : null}
    <div className="editor-save"><button className="secondary-button" disabled={saving || processing || pendingCandidate} onClick={() => void persist()}><Save size={16}/> Guardar cambios</button><button className="primary-button" disabled={saving || processing || pendingCandidate || !ready && !freeSinging} onClick={() => void persist(true)}><Music2 size={16}/>{freeSinging ? 'Guardar y cantar sin puntuación' : 'Guardar y cantar'}</button></div>
  </fieldset></article>;
}

function MusicBrainzSearch({ record, onAssociate }: { record: LibrarySong; onAssociate: (recording: RecordingMetadata) => void }) {
  const [title, setTitle] = useState(record.title);
  const [artist, setArtist] = useState(record.artist);
  const [results, setResults] = useState<RecordingMetadata[] | null>(null);
  const [selected, setSelected] = useState<RecordingMetadata | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function search(event: React.FormEvent) {
    event.preventDefault(); abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setResults(null); setSelected(null); setConfirmed(false);
    try {
      const response = await fetch(`/api/musicbrainz/recordings?${new URLSearchParams({ title: title.trim(), artist: artist.trim() })}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar MusicBrainz.');
      if (!Array.isArray(data.recordings)) throw new Error('El servicio de catálogo no está disponible en esta vista.');
      setResults(data.recordings);
    } catch (error) { if (!controller.signal.aborted) setError(errorText(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <details className="musicbrainz-search"><summary><Search size={16}/> Identificar en MusicBrainz {record.recording ? <span>· asociado</span> : null}</summary><p>Solo se envían el título y el artista que escribas. La asociación es opcional; no subimos tu audio.</p>
    {record.recording ? <p className="associated-recording">Asociado: <a href={`https://musicbrainz.org/recording/${record.recording.id}`} target="_blank" rel="noreferrer">{record.recording.title} · {record.recording.artist}</a></p> : null}
    <form onSubmit={event => void search(event)}><label>Título a buscar<input required minLength={2} maxLength={120} value={title} onChange={event => setTitle(event.target.value)}/></label><label>Artista a buscar<input maxLength={120} value={artist} onChange={event => setArtist(event.target.value)}/></label><button className="secondary-button" disabled={busy}><Search size={15}/>{busy ? 'Buscando…' : 'Buscar versiones'}</button></form>
    {error ? <p className="mic-warning" role="alert">{error}</p> : null}
    {results?.length === 0 ? <p role="status">No encontramos versiones con esos datos. Prueba otro título o continúa con tus datos.</p> : null}
    <div className="recording-results">{results?.map(item => <label key={item.id}><input type="radio" name="recording" checked={selected?.id === item.id} onChange={() => { setSelected(item); setConfirmed(false); }}/><span><strong>{item.title} · {item.artist}</strong><small>{item.album || 'Álbum no indicado'} · {item.date || 'Fecha no indicada'} · {item.duration ? seconds(item.duration) : 'Duración no indicada'}{item.disambiguation ? ` · ${item.disambiguation}` : ''}</small></span></label>)}</div>
    {selected ? <div className="confirm-recording"><p>{selected.duration === null ? 'MusicBrainz no indica la duración: comprueba la versión por sus otros datos.' : Math.abs(selected.duration - record.duration) > 2 ? `Atención: esta versión dura ${seconds(selected.duration)} y tu archivo ${seconds(record.duration)}. Puede ser otra edición o un recorte.` : 'La duración es cercana a la de tu archivo. Comprueba también la versión y el artista.'}</p><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> He comprobado que corresponde a mi audio.</label><button className="secondary-button" disabled={!confirmed} onClick={() => { onAssociate(selected); setSelected(null); setResults(null); }}>Asociar esta versión</button></div> : null}
  </details>;
}
