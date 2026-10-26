import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { LibrarySong } from './library-model';
import type { Range } from './progress';
import { applyFilters, facetsOf, NO_FILTERS, rankByMeaning, rankByWords } from './song-search';
import type { Filters, Ranked, SongFacets } from './song-search';
import { canSearchMeaning, queryVector, songVectors } from './meaning';

const languages: Record<string, string> = { es: 'Español', en: 'Inglés' };
export function fitLabel(song: SongFacets) {
  return song.fit === 'comfortable' ? 'Cómoda en su tono' : song.fit === 'with-key' ? `Cómoda con ${song.steps > 0 ? '+' : '−'}${Math.abs(song.steps)}` : song.fit === 'demanding' ? 'Exigente para tu voz' : '';
}
export const relevanceLabel = (relevance: number) => relevance >= 1 ? 'Muy relacionada' : relevance >= .3 ? 'Relacionada' : '';

// Moods searched with a description rather than the bare word: over the user's thirteen songs, descriptions put the
// expected song first for 5 of 6 moods (MRR 0.92); the bare words did much worse. Written without naming any song.
export const MOODS: { label: string; search: string }[] = [
  { label: 'Desamor', search: 'una canción triste sobre el final de una relación: la soledad, el corazón roto y extrañar a quien se fue' },
  { label: 'Romántica', search: 'una canción de amor romántico para dedicar a la pareja, cariño, besos y promesas de amor eterno' },
  { label: 'Fiesta', search: 'una canción alegre para la fiesta: bailar, saltar, divertirse con amigos y celebrar' },
  { label: 'Nostalgia', search: 'una canción nostálgica sobre recuerdos del pasado, lo que cambió y el tiempo que no vuelve' },
  { label: 'Épica', search: 'una canción épica sobre batallas, héroes, leyendas, magia y destino' },
  { label: 'Divertida', search: 'una canción divertida que hace reír, con una historia chistosa y absurda' },
];

/**
 * Search the library by theme or mood (the local meaning model, or plain words without it) and narrow it by language,
 * decade and how the song suits the singer's voice. Returns the controls and the songs to list, in order.
 */
export function useSongFinder(records: LibrarySong[], voice: Range | null) {
  const facets = useMemo(() => records.map(record => facetsOf(record, voice)), [records, voice]);
  const [query, setQuery] = useState(''), [searched, setSearched] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [status, setStatus] = useState(''), [meaning, setMeaning] = useState<boolean | null>(null);
  // How the results on screen were found, and the mood button behind them, if any.
  const [mode, setMode] = useState<'meaning' | 'words'>('words'), [mood, setMood] = useState('');
  const job = useRef<AbortController | null>(null), availability = useRef<Promise<boolean> | null>(null);
  useEffect(() => { availability.current ??= canSearchMeaning(); void availability.current.then(setMeaning); }, []);
  useEffect(() => () => job.current?.abort(), []);

  async function search(text: string, label = '') {
    job.current?.abort();
    const words = text.trim(); setSearched(label || words); setMood(label);
    if (!words) { setRanked(null); setStatus(''); return; }
    const controller = new AbortController(); job.current = controller;
    // A search typed before the server answered waits for it, instead of falling back to words by mistake.
    setStatus('Buscando…');
    const ready = meaning ?? await (availability.current ??= canSearchMeaning());
    if (job.current !== controller) return;
    if (!ready) { setMode('words'); setRanked(rankByWords(words, facets)); setStatus('Búsqueda por palabras del título, el artista o la letra: el motor local no tiene el modelo de significado.'); return; }
    try {
      setStatus('Buscando por significado…');
      const [vectors, vector] = await Promise.all([songVectors(facets.filter(song => song.lyrics || song.title), controller.signal, (done, total) => setStatus(`Leyendo tus canciones… ${done} de ${total}`)), queryVector(words, controller.signal)]);
      if (job.current !== controller) return;
      setMode('meaning'); setRanked(rankByMeaning(vector, vectors)); setStatus('');
    } catch (failure) {
      if (controller.signal.aborted) return;
      setMode('words'); setRanked(rankByWords(words, facets)); setStatus(`No se pudo buscar por significado (${(failure as Error).message}); se muestran coincidencias de palabras.`);
    }
  }

  const relevance = new Map((ranked || []).map(item => [item.id, item.relevance]));
  const allowed = new Set(applyFilters(facets, filters).map(song => song.id));
  const order = ranked ? ranked.map(item => item.id) : facets.map(song => song.id);
  const visible = order.filter(id => allowed.has(id)).map(id => records.find(record => record.id === id)!).filter(Boolean);
  const byId = new Map(facets.map(song => [song.id, song]));
  const decades = [...new Set(facets.map(song => song.decade).filter((decade): decade is number => decade !== null))].sort();
  const filtered = filters !== NO_FILTERS || !!searched;
  const clear = () => { setFilters(NO_FILTERS); setQuery(''); void search(''); };

  const controls = <div className="song-finder">
    <form role="search" onSubmit={event => { event.preventDefault(); void search(query); }}>
      <label htmlFor="song-finder">Buscar por tema o ánimo</label>
      <div><input id="song-finder" type="search" value={query} placeholder="desamor, fiesta, nostalgia…" onChange={event => { setQuery(event.target.value); if (!event.target.value && !mood) void search(''); }}/><button className="icon-button" aria-label="Buscar"><Search size={16}/></button></div>
    </form>
    <div className="mood-buttons" role="group" aria-label="Buscar por ánimo">{MOODS.map(item => <button key={item.label} type="button" className={mood === item.label ? 'selected' : ''} aria-pressed={mood === item.label} onClick={() => { setQuery(''); void search(item.search, item.label); }}>{item.label}</button>)}</div>
    <div className="finder-filters">
      <label>Idioma<select value={filters.language} onChange={event => setFilters({ ...filters, language: event.target.value as Filters['language'] })}><option value="all">Todos</option><option value="es">Español</option><option value="en">Inglés</option><option value="">Sin letra o mixto</option></select></label>
      <label>Década<select value={String(filters.decade)} onChange={event => setFilters({ ...filters, decade: event.target.value === 'all' || event.target.value === 'none' ? event.target.value : Number(event.target.value) })}><option value="all">Todas</option>{decades.map(decade => <option key={decade} value={decade}>{decade}s</option>)}<option value="none">Sin año</option></select></label>
      <label>Para tu voz<select value={filters.fit} disabled={!voice} onChange={event => setFilters({ ...filters, fit: event.target.value as Filters['fit'] })}><option value="all">{voice ? 'Todas' : 'Sin rango todavía'}</option><option value="comfortable">Cómodas en su tono</option><option value="with-key">Cómodas cambiando el tono</option><option value="demanding">Exigentes</option></select></label>
    </div>
    {status ? <p className="finder-status" role="status">{status}</p> : searched && ranked ? <p className="finder-status" role="status">{mode === 'meaning' ? `${mood ? `Ánimo «${mood}»: ordenadas` : 'Ordenadas'} por parecido con «${mood ? mood.toLowerCase() : searched}». Es experimental: lee la letra, no la música.` : `Canciones con «${searched}» en el título, el artista o la letra.`}</p> : null}
    {filtered && !visible.length && !status.startsWith('Buscando') && !status.startsWith('Leyendo') && !status.startsWith('Buscando…') ? <p className="library-empty">Ninguna canción coincide{searched ? ` con «${searched}»` : ''} y estos filtros. <button className="text-button" onClick={clear}><X size={14}/> Quitar búsqueda y filtros</button></p> : null}
  </div>;

  /** The line of tags under a song in the list. */
  const tags = (id: string) => {
    const song = byId.get(id); if (!song) return '';
    const related = relevance.has(id) && mode === 'meaning' ? relevanceLabel(relevance.get(id)!) : '';
    return [related, languages[song.language], song.decade ? `${song.decade}s` : '', fitLabel(song)].filter(Boolean).join(' · ');
  };
  return { controls, visible, tags, filtered };
}
