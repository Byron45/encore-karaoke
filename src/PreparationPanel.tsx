import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Download, Square, WandSparkles } from 'lucide-react';
import type { LibrarySong } from './library-model';
import { validateNotes } from './library-model';
import { automaticNotes, validateManifest, verifyStem } from './preparation';
import type { PreparedAudio, PreparationManifest } from './preparation';
import { noteName } from './song';

interface Job { id: string; state: string; stage: string; progress: number; error?: string; originalSha256: string }
interface Runtime { ready: boolean; token: string; error?: string; active: Job | null }
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelado', 'AbortError')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});
async function json(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'El motor local no respondió.'); return data; }
function save(blob: Blob, name: string) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function Preview({ blob, label }: { blob: Blob; label: string }) {
  const [url, setUrl] = useState(''); const player = useRef<HTMLAudioElement>(null);
  useEffect(() => { const next = URL.createObjectURL(blob), audio = player.current; setUrl(next); return () => { audio?.pause(); URL.revokeObjectURL(next); }; }, [blob]);
  return <label className="stem-preview">{label}<audio ref={player} controls preload="none" src={url || undefined} aria-label={label}/></label>;
}

export function PreparationPanel({ record, saving, onBusy, onPending, onChange }: { record: LibrarySong; saving: boolean; onBusy: (busy: boolean) => void; onPending: (pending: boolean) => void; onChange: (value: Partial<LibrarySong>) => void }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null), [error, setError] = useState('');
  const [job, setJob] = useState<Job | null>(null), [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<PreparedAudio | null>(null), [reviewed, setReviewed] = useState(false);
  const task = useRef<{ controller: AbortController; id: string; token: string } | null>(null);
  const mounted = useRef(true);
  const applied = record.prepared, preview = candidate || applied;
  useEffect(() => { onPending(!!candidate); }, [candidate, onPending]);
  const notes = useMemo(() => {
    try { return preview ? automaticNotes(preview.manifest.analysis.notes, record.lyrics, record.duration) : []; }
    catch { return []; }
  }, [preview, record.lyrics, record.duration]);
  const mapErrors = notes.length ? validateNotes(notes, record.duration) : [];
  const available = preview && notes.length > 0 && !mapErrors.length;
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    fetch('/api/preparation/status', { signal: controller.signal }).then(json).then(data => { if (mounted.current) setRuntime(data); }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => { mounted.current = false; controller.abort(); const pending = task.current; pending?.controller.abort(); if (pending) void fetch(`/api/preparation/jobs/${pending.id}`, { method: 'DELETE', headers: { 'X-Encore-Token': pending.token }, keepalive: true }).catch(() => {}); };
  }, [record.id]);
  async function refresh() {
    setError('');
    try { const data = await json(await fetch('/api/preparation/status')); setRuntime(data); return data as Runtime; }
    catch (error) { setError((error as Error).message); return null; }
  }
  async function cancel() {
    const pending = task.current; if (!pending) return;
    pending.controller.abort(); setJob(value => value ? { ...value, stage: 'Cancelando…' } : null);
    try { await json(await fetch(`/api/preparation/jobs/${pending.id}`, { method: 'DELETE', headers: { 'X-Encore-Token': pending.token } })); }
    catch { /* It may have been cancelled during upload before the server registered it. */ }
  }
  async function prepare(analysisOnly = false) {
    if (busy || saving) return;
    setBusy(true); onBusy(true); setError(''); setReviewed(false);
    const controller = new AbortController(); const id = crypto.randomUUID(); let token = runtime?.token || '';
    task.current = { controller, id, token };
    try {
      const status = await json(await fetch('/api/preparation/status', { signal: controller.signal })) as Runtime;
      setRuntime(status); token = status.token; task.current.token = token;
      if (!status.ready) throw new Error(status.error || 'El motor local no está instalado.');
      if (status.active) throw new Error('Ya hay un trabajo activo. Puedes detenerlo desde el aviso del motor.');
      setJob({ id, state: 'uploading', stage: 'Enviando el audio al motor de esta computadora', progress: 0, originalSha256: record.audioHash });
      if (analysisOnly && !applied) throw new Error('Primero prepara las pistas de esta canción.');
      if (analysisOnly) await verifyStem(applied!.vocals, applied!.manifest.stems.vocals);
      const source = analysisOnly ? applied!.vocals : record.audio;
      const hash = analysisOnly ? applied!.manifest.stems.vocals.sha256 : record.audioHash;
      let current = await json(await fetch(analysisOnly ? '/api/preparation/analysis' : '/api/preparation/jobs', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Sha256': hash, 'X-Encore-Token': token, 'X-Encore-Job-Id': id }, body: source, signal: controller.signal })) as Job;
      while (current.state !== 'complete') {
        if (current.state === 'failed' || current.state === 'cancelled') throw new Error(current.error || 'Preparación cancelada.');
        setJob(current); await wait(controller.signal);
        current = await json(await fetch(`/api/preparation/jobs/${id}`, { headers: { 'X-Encore-Token': token }, signal: controller.signal }));
      }
      setJob({ ...current, stage: 'Verificando y recuperando las pistas', progress: 100 });
      if (analysisOnly) {
        const result = await json(await fetch(`/api/preparation/jobs/${id}/analysis.json`, { headers: { 'X-Encore-Token': token }, signal: controller.signal }));
        if (result.schemaVersion !== 1 || result.sourceSha256 !== hash) throw new Error('Este análisis pertenece a otra pista vocal.');
        const manifest = { ...applied!.manifest, analysis: result.analysis };
        validateManifest(manifest, record.audioHash, record.duration);
        if (!controller.signal.aborted && mounted.current) { setCandidate({ ...applied!, manifest }); setJob({ ...current, stage: 'Mapa mejorado listo para revisar', progress: 100 }); }
        return;
      }
      const manifest = await json(await fetch(`/api/preparation/jobs/${id}/manifest.json`, { headers: { 'X-Encore-Token': token }, signal: controller.signal })) as PreparationManifest;
      validateManifest(manifest, record.audioHash, record.duration);
      const estimate = await navigator.storage?.estimate?.();
      const total = Object.values(manifest.stems).reduce((sum, stem) => sum + stem.bytes, 0);
      if (estimate?.quota && estimate.usage !== undefined && estimate.quota - estimate.usage < total * 1.1) throw new Error('No hay espacio suficiente para las pistas. Libera espacio antes de volver a preparar.');
      const result = { manifest } as PreparedAudio;
      for (const name of ['vocals', 'instrumental', 'reduced'] as const) {
        const response = await fetch(`/api/preparation/jobs/${id}/${name}.wav`, { headers: { 'X-Encore-Token': token }, signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo recuperar una de las pistas.');
        const blob = await response.blob(); await verifyStem(blob, manifest.stems[name]);
        if (controller.signal.aborted) throw new DOMException('Cancelado', 'AbortError');
        result[name] = blob;
      }
      if (!controller.signal.aborted && mounted.current) { setCandidate(result); setJob({ ...current, stage: 'Listo para escuchar y revisar', progress: 100 }); }
    } catch (error) {
      if (mounted.current) setError(controller.signal.aborted ? 'Preparación cancelada. Tu canción y el mapa anterior se conservan.' : (error as Error).message);
    } finally {
      await fetch(`/api/preparation/jobs/${id}`, { method: 'DELETE', headers: { 'X-Encore-Token': token } }).catch(() => {});
      if (mounted.current) { setBusy(false); onBusy(false); }
      task.current = null;
    }
  }
  function accept(withNotes: boolean) {
    if (!preview) return;
    if (withNotes && record.notes.length && !window.confirm('¿Reemplazar el mapa actual por estas notas automáticas? La letra y el audio original se conservan.')) return;
    const update: Partial<LibrarySong> = { prepared: preview };
    if (withNotes) {
      update.notes = notes;
      update.automaticMap = { method: preview.manifest.analysis.method, sourceHash: preview.manifest.stems.vocals.sha256, reviewedAt: new Date().toISOString(), experimental: true, detectedSeconds: preview.manifest.analysis.detectedSeconds };
    }
    onChange(update); setCandidate(null); setReviewed(false); setError('');
  }
  return <section className="preparation-panel" aria-label="Preparación automática">
    <div className="map-heading"><div><h3><WandSparkles size={20}/> Prepara tu karaoke automáticamente</h3><p>Separamos la voz y la pista, y proponemos las notas de la melodía. La letra se mantiene tal como la elegiste.</p></div></div>
    <p className="lyrics-hint">Procesamiento en esta computadora. Puede tardar varios minutos. El primer uso descarga un modelo de unos 67 MB; tu canción no se envía a un servicio externo.</p>
    {!runtime ? <p role="status">Comprobando motor local…</p> : !runtime.ready ? <div className="notice">{runtime.error}<button className="text-button" disabled={busy || saving} onClick={() => void refresh()}>Volver a comprobar</button></div> : null}
    {runtime?.active && !busy ? <div className="notice"><p>Hay un trabajo anterior en curso: {runtime.active.stage}.</p><button className="secondary-button" disabled={saving} onClick={async () => { try { await json(await fetch(`/api/preparation/jobs/${runtime.active!.id}`, { method: 'DELETE', headers: { 'X-Encore-Token': runtime.token } })); await refresh(); } catch (error) { setError((error as Error).message); } }}>Detener trabajo anterior</button><button className="text-button" onClick={() => void refresh()}>Actualizar estado</button></div> : null}
    <div className="map-toolbar">{busy ? <button className="secondary-button" onClick={() => void cancel()}><Square size={15}/> Cancelar preparación</button> : <><button className="primary-button" disabled={saving || !runtime?.ready || !!runtime.active} onClick={() => void prepare()}><AudioLines size={17}/>{preview ? 'Volver a preparar audio' : 'Separar voz y generar mapa'}</button>{applied ? <button className="secondary-button" disabled={saving || !runtime?.ready || !!runtime.active || !!candidate} onClick={() => void prepare(true)}><WandSparkles size={17}/> Mejorar mapa desde la voz</button> : null}</>}</div>
    {applied ? <p className="lyrics-hint">Mejorar mapa reutiliza tu voz aislada y conserva las pistas. Contrasta dos detectores y sigue las variaciones de afinación; puede tardar más que el análisis anterior.</p> : null}
    {job && busy ? <div role="status" className="preparation-progress"><progress max="100" value={job.progress}/><p>{job.stage}</p><small>Puedes cancelar. El mapa guardado no cambia mientras se procesa.</small></div> : null}
    {error ? <div className="notice error" role="alert">{error}</div> : null}
    {preview && !busy ? <div className="preparation-result"><span className="eyebrow">{candidate ? 'BORRADOR · AÚN SIN GUARDAR' : 'PISTAS PREPARADAS'}</span><div className="stem-previews"><Preview blob={preview.instrumental} label="Escuchar solo instrumental"/><Preview blob={preview.reduced} label="Escuchar con voz al 25 %"/><Preview blob={preview.vocals} label="Escuchar voz aislada para revisar notas"/></div>
      <div className="map-toolbar">{(['instrumental', 'vocals', 'reduced'] as const).map(name => <button key={name} className="text-button" disabled={saving} onClick={() => save(preview[name], `${record.title}-${name}.wav`)}><Download size={14}/>{name === 'vocals' ? 'Descargar voz' : name === 'reduced' ? 'Descargar voz reducida' : 'Descargar pista'}</button>)}<button className="text-button" disabled={saving} onClick={() => save(new Blob([JSON.stringify(preview.manifest, null, 2)], { type: 'application/json' }), `${record.title}-preparacion.json`)}>Descargar informe</button></div>
      <p><strong>{notes.length} notas propuestas</strong> · {preview.manifest.analysis.detectedSeconds.toFixed(1)} s con notas estables de {Math.round(record.duration)} s de audio.</p>{candidate && applied ? <p className="notice">Antes: {applied.manifest.analysis.notes.length} notas y {applied.manifest.analysis.detectedSeconds.toFixed(1)} s. Ahora: {notes.length} notas y {preview.manifest.analysis.detectedSeconds.toFixed(1)} s. Más cobertura no garantiza que todas las notas sean correctas.</p> : null}<p className="lyrics-hint">El mapa puede ser parcial: solo se puntúan las notas detectadas, no toda la interpretación. {preview.manifest.analysis.warning} La sincronización sigue siendo por líneas; no estamos reconociendo cada palabra cantada.</p>
      {notes.length ? <details><summary>Revisar primeras notas del borrador</summary><div className="draft-notes">{notes.slice(0, 60).map((n, i) => <span key={i}>{n.start.toFixed(2)} s · {noteName(n.midi)} · {n.duration.toFixed(2)} s · Confianza {Math.round(n.confidence! * 100)} %</span>)}</div>{notes.length > 60 ? <p>Se muestran 60 de {notes.length}. Tras aceptar puedes revisar todas en el editor.</p> : null}</details> : null}
      {mapErrors.length ? <p role="alert">{mapErrors[0]}</p> : null}
      <label className="review-map"><input type="checkbox" disabled={saving || !available} checked={reviewed} onChange={event => setReviewed(event.target.checked)}/> Escuché las pistas y quiero probar este mapa experimental.</label>
      <div className="map-toolbar"><button className="primary-button" disabled={saving || !reviewed || !available} onClick={() => accept(true)}>Usar pistas y mapa automático</button>{candidate ? <><button className="secondary-button" disabled={saving} onClick={() => accept(false)}>Usar solo las pistas</button><button className="text-button" disabled={saving} onClick={() => { setCandidate(null); setReviewed(false); }}>Descartar borrador</button></> : null}</div><p className="lyrics-hint">Después pulsa Guardar cambios para conservarlo en la biblioteca. La evaluación de mapas automáticos sigue siendo experimental.</p>
    </div> : null}
  </section>;
}
