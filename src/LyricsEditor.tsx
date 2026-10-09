import { useEffect, useRef, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { compileLyrics, exportLyrics, lrclibId } from './lyrics';
import type { LyricsDocument, LyricsResult } from './lyrics';
import { LyricsView } from './LyricsView';

const durationText = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export function LyricsEditor({ value, title, artist, duration, time, onChange }: { value?: LyricsDocument; title: string; artist: string; duration: number; time: number; onChange: (value: LyricsDocument | undefined) => void }) {
  const [link, setLink] = useState('');
  const [results, setResults] = useState<LyricsResult[] | null>(null);
  const [selected, setSelected] = useState<LyricsResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const doc = value || { raw: '', format: 'plain' as const, offset: 0 };
  async function search(byLink: boolean) {
    setError('');
    let params: URLSearchParams;
    try { params = new URLSearchParams(byLink ? { id: lrclibId(link) } : { title: title.trim(), artist: artist.trim() }); }
    catch (error) { setError((error as Error).message); return; }
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy(true); setResults(null); setSelected(null); setConfirmed(false);
    try {
      const response = await fetch(`/api/lyrics?${params}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.results)) throw new Error(data.error || 'No se pudo leer el servicio de letras.');
      setResults(data.results.sort((a: LyricsResult, b: LyricsResult) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration)));
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'No se pudo obtener la letra.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function useResult(synced: boolean) {
    if (!selected) return;
    try {
      const next: LyricsDocument = { raw: synced ? selected.synced : selected.plain, format: synced ? 'lrc' : 'plain', offset: 0, source: { id: selected.id, title: selected.title, artist: selected.artist, album: selected.album, duration: selected.duration } };
      compileLyrics(next, duration);
      if (value?.raw.trim() && !window.confirm('¿Reemplazar la letra actual por esta versión? El mapa de notas se conserva.')) return;
      onChange(next); setError(''); setSelected(null); setResults(null);
    } catch (error) { setError((error as Error).message + ' Puedes usar solo el texto y buscar otra sincronización.'); }
  }
  function download() {
    let content;
    try { content = exportLyrics(doc, duration); setError(''); }
    catch (error) { setError((error as Error).message); return; }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${title || 'letra'}.${doc.format === 'lrc' ? 'lrc' : 'txt'}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="lyrics-editor" aria-label="Preparar letra completa">
    <div className="map-heading"><div><h3>Tu letra, de una sola vez.</h3><p>Búscala en LRCLIB o pega el texto completo. No necesitas crear una fila por palabra.</p></div></div>
    <div className="lyrics-search"><button type="button" className="secondary-button" disabled={busy || title.trim().length < 2} onClick={() => void search(false)}><Search size={15}/>{busy ? 'Buscando letra…' : 'Buscar letra por título y artista'}</button><label>Enlace o ID de LRCLIB<input value={link} maxLength={250} placeholder="https://lrclib.net/tracks/…" onChange={event => setLink(event.target.value)}/></label><button type="button" className="secondary-button" disabled={busy || !link.trim()} onClick={() => void search(true)}>Consultar enlace</button></div>
    <p className="lyrics-hint">Solo se consulta el título/artista o el registro indicado; tu audio se queda en el dispositivo. Las letras pueden corresponder a otra edición.</p>
    {results?.length === 0 ? <p role="status">No encontramos esa letra. Puedes pegarla completa aquí.</p> : null}
    <div className="recording-results">{results?.map(item => <label key={item.id}><input type="radio" name="lyrics-result" checked={selected?.id === item.id} onChange={() => { setSelected(item); setConfirmed(false); setError(''); }}/><span><strong>{item.title} · {item.artist}</strong><small>{item.album || 'Álbum sin indicar'} · {durationText(item.duration)} · {item.synced ? 'Con tiempos por línea' : item.plain ? 'Solo texto' : item.instrumental ? 'Instrumental' : 'Sin letra'}{Math.abs(item.duration - duration) > 2 ? ' · Duración diferente' : ''}</small></span></label>)}</div>
    {selected ? <div className="lyrics-choice"><p>{Math.abs(selected.duration - duration) > 2 ? `Atención: LRCLIB indica ${durationText(selected.duration)} y tu audio ${durationText(duration)}. Puede ser otra versión; no ajustamos los tiempos automáticamente.` : 'La duración es cercana. Comprueba el título, artista y versión.'}</p><a href={`https://lrclib.net/tracks/${selected.id}`} target="_blank" rel="noreferrer">Ver registro en LRCLIB</a><details><summary>Vista previa de la letra encontrada</summary><pre>{selected.synced || selected.plain || 'El registro no contiene letra.'}</pre></details><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> He revisado la versión y comprobaré los tiempos con mi audio.</label><div className="map-toolbar"><button type="button" className="primary-button" disabled={!confirmed || !selected.synced} onClick={() => useResult(true)}>Usar letra sincronizada</button><button type="button" className="secondary-button" disabled={!selected.plain} onClick={() => useResult(false)}>Usar solo el texto</button></div></div> : null}
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <div className="lyrics-options"><label>Formato de letra<select value={doc.format} onChange={event => onChange({ ...doc, format: event.target.value as LyricsDocument['format'], offset: event.target.value === 'plain' ? 0 : doc.offset })}><option value="plain">Letra sin tiempos</option><option value="lrc">LRC · líneas con tiempos</option></select></label>{doc.format === 'lrc' ? <label>Ajustar letra (s)<input type="number" min="-120" max="120" step="0.1" value={Number.isFinite(doc.offset) ? doc.offset : ''} onChange={event => onChange({ ...doc, offset: event.target.value === '' ? NaN : Number(event.target.value) })}/></label> : null}<button type="button" className="text-button" disabled={!doc.raw.trim()} onClick={download}><Download size={15}/> Descargar letra</button></div>
    <label className="lyrics-input">Letra completa<textarea aria-label="Letra completa" rows={8} maxLength={50000} value={doc.raw} placeholder={doc.format === 'lrc' ? '[00:12.00] Primera línea\n[00:16.50] Segunda línea' : 'Pega aquí toda la letra, con una línea por frase.'} onChange={event => onChange({ ...doc, raw: event.target.value })}/></label>
    {doc.source ? <p className="lyrics-hint">Origen: <a href={`https://lrclib.net/tracks/${doc.source.id}`} target="_blank" rel="noreferrer">LRCLIB · {doc.source.title}</a>. Guarda los cambios para conservar esta letra.</p> : null}
    {doc.format === 'lrc' ? <p className="lyrics-hint">Un ajuste positivo retrasa la letra; uno negativo la adelanta. Este ajuste no mueve las notas del mapa. Escucha el audio de arriba para comprobarlo.</p> : null}
    {doc.raw.trim() ? <LyricsView lyrics={doc} duration={duration} time={time}/> : null}
  </section>;
}
