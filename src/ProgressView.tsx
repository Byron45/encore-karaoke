import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Mic2, TrendingUp } from 'lucide-react';
import { DIFFICULTIES } from './scoring';
import type { Difficulty } from './scoring';
import { noteName } from './song';
import { songsProgress, voiceRange, weakPhrases } from './progress';
import type { SongProgress, TakeSummary } from './progress';

const label = (difficulty: string) => DIFFICULTIES[difficulty as Difficulty]?.label || difficulty;
const day = (iso: string) => new Date(iso).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
const when = (iso: string) => new Date(iso).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
const points = (value: number) => value.toLocaleString('es-EC');

/** Points of the whole-song takes of one song at one level, in the order they were sung. One series: no legend. */
function ScoreChart({ takes }: { takes: TakeSummary[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null), frame = useRef<HTMLElement>(null);
  // Drawn at the width it is shown, so its text keeps its size on a phone.
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = frame.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const height = 200, left = 44, right = 56, top = 14, bottom = 26;
  const x = (i: number) => takes.length === 1 ? left + (width - left - right) / 2 : left + i * (width - left - right) / (takes.length - 1);
  const y = (score: number) => top + (1 - score / 10000) * (height - top - bottom);
  const best = takes.reduce((at, take, i) => take.score > takes[at].score ? i : at, 0), last = takes.length - 1;
  const move = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect(), at = (event.clientX - rect.left) / rect.width * width;
    let nearest = 0; takes.forEach((_, i) => { if (Math.abs(x(i) - at) < Math.abs(x(nearest) - at)) nearest = i; });
    setHover(nearest);
  };
  const shown = hover === null ? null : takes[hover];
  return <figure className="score-chart" ref={frame}>
    <svg ref={box} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Puntos de ${takes.length} intentos, del ${day(takes[0].createdAt)} al ${day(takes[last].createdAt)}: de ${points(takes[0].score)} a ${points(takes[last].score)}.`} onPointerMove={move} onPointerLeave={() => setHover(null)}>
      {[0, 2500, 5000, 7500, 10000].map(tick => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="grid"/><text x={left - 8} y={y(tick) + 4} textAnchor="end">{tick ? `${tick / 1000}K` : '0'}</text></g>)}
      {takes.length > 1 ? <polyline points={takes.map((take, i) => `${x(i)},${y(take.score)}`).join(' ')} className="series"/> : null}
      {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={top} y2={height - bottom} className="crosshair"/> : null}
      {takes.map((take, i) => <circle key={take.createdAt} cx={x(i)} cy={y(take.score)} r={hover === i ? 6 : 4.5} className="dot"/>)}
      <text x={x(last) + 10} y={y(takes[last].score) + 4} className="value">{points(takes[last].score)}</text>
      {best !== last ? <text x={x(best)} y={y(takes[best].score) - 10} textAnchor="middle" className="value">{points(takes[best].score)}</text> : null}
      <text x={x(0)} y={height - 6} textAnchor={takes.length === 1 ? 'middle' : 'start'}>{day(takes[0].createdAt)}</text>
      {takes.length > 1 ? <text x={x(last)} y={height - 6} textAnchor="end">{day(takes[last].createdAt)}</text> : null}
    </svg>
    {shown ? <div className="chart-tooltip" style={{ left: `${x(hover!) / width * 100}%` }} role="status">
      <strong>{points(shown.score)}</strong><span>{when(shown.createdAt)}</span>
      <span>{shown.transpose ? `${shown.transpose > 0 ? '+' : '−'}${Math.abs(shown.transpose)} semitonos` : 'Tono original'}{shown.lyrics !== undefined ? ` · letra ${Math.round(shown.lyrics * 100)} %` : ''}</span>
    </div> : null}
  </figure>;
}

function SongDetail({ song, takes, phrases, onSing }: { song: SongProgress; takes: TakeSummary[]; phrases: string[] | null; onSing: (songId: string) => void }) {
  const levels = [...new Set(song.full.map(take => take.difficulty))];
  const [level, setLevel] = useState(() => levels.sort((a, b) => song.full.filter(t => t.difficulty === b).length - song.full.filter(t => t.difficulty === a).length)[0] || '');
  const charted = song.full.filter(take => take.difficulty === level);
  const weak = phrases ? weakPhrases(takes, song.songId, phrases.length) : [];
  return <section className="progress-detail" aria-label={`Progreso en ${song.song}`}>
    <div className="progress-detail-heading"><div><span className="eyebrow">CANCIÓN</span><h2>{song.song}</h2></div><button className="secondary-button" onClick={() => onSing(song.songId)}><Mic2 size={16}/> Cantarla</button></div>
    {charted.length ? <>
      <div className="progress-controls">{levels.length > 1 ? <label>Exigencia <select value={level} onChange={event => setLevel(event.target.value)}>{levels.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label> : <span>Exigencia {label(level)}</span>}<span>{charted.length} {charted.length === 1 ? 'intento completo' : 'intentos completos'}</span></div>
      <ScoreChart takes={charted}/>
    </> : <p className="settings-hint">Todavía no hay intentos completos de esta canción; los ensayos de frases aparecen en la tabla.</p>}
    {weak.length ? <div className="weak-phrases"><strong>Las frases que más te cuestan</strong><p>Media de tus últimos {weak[0].takes} intentos completos.</p><ul>{weak.map(item => <li key={item.phrase}><span>{String(item.phrase + 1).padStart(2, '0')}</span><q>{phrases![item.phrase] || `Frase ${item.phrase + 1}`}</q><b>{item.accuracy} %</b></li>)}</ul><button className="text-button" onClick={() => onSing(song.songId)}>Ensayarlas en el escenario <ArrowRight size={14}/></button></div> : null}
    <table className="takes-table"><caption>Todos los intentos de {song.song}</caption><thead><tr><th scope="col">Fecha</th><th scope="col">Exigencia</th><th scope="col">Tono</th><th scope="col">Letra</th><th scope="col">Puntos</th></tr></thead>
      <tbody>{[...song.takes].reverse().map(take => <tr key={take.createdAt}><td>{when(take.createdAt)}{take.phrase !== undefined ? ` · ensayo de la frase ${take.phrase + 1}` : ''}</td><td>{label(take.difficulty)}</td><td>{take.transpose ? `${take.transpose > 0 ? '+' : '−'}${Math.abs(take.transpose)}` : 'Original'}</td><td>{take.lyrics !== undefined ? `${Math.round(take.lyrics * 100)} %` : '—'}</td><td>{points(take.score)}</td></tr>)}</tbody></table>
  </section>;
}

/**
 * The singer's progress from the takes this browser keeps: how much they sang, their comfortable range, each song's
 * marks over time and the phrases that need practice. phrasesOf gives a song's phrase texts when it is in the library.
 */
export function Progress({ takes, phrasesOf, onSing }: { takes: TakeSummary[]; phrasesOf: (songId: string) => Promise<string[] | null>; onSing: (songId: string) => void }) {
  const songs = useMemo(() => songsProgress(takes), [takes]), range = useMemo(() => voiceRange(takes), [takes]);
  const [selected, setSelected] = useState<string | null>(null);
  const [phrases, setPhrases] = useState<string[] | null>(null);
  const current = songs.find(song => song.songId === selected) || songs[0];
  useEffect(() => {
    if (!current) return;
    let alive = true; setPhrases(null);
    void phrasesOf(current.songId).then(list => { if (alive) setPhrases(list); });
    return () => { alive = false; };
  }, [current?.songId, phrasesOf]);
  const minutes = Math.round(takes.reduce((sum, take) => sum + take.voice.reduce((a, b) => a + b, 0), 0) / 60);
  return <>
    <div className="page-heading"><div><div className="eyebrow">TU AVANCE</div><h1>Tu progreso<span>.</span></h1><p>Cada intento con micrófono queda en este navegador. Aquí ves cómo va cada canción y dónde está tu voz.</p></div></div>
    {!takes.length ? <div className="notice"><TrendingUp size={17}/><span>Todavía no hay intentos guardados. Canta una canción con el micrófono y vuelve aquí.</span></div> : <>
      <div className="stat-tiles">
        <div><span>Intentos</span><strong>{points(takes.length)}</strong></div>
        <div><span>Canciones</span><strong>{songs.length}</strong></div>
        <div><span>Minutos cantando sobre las notas</span><strong>{minutes}</strong></div>
        <div><span>Tu rango cómodo</span><strong>{range ? `${noteName(range.low)} – ${noteName(range.high)}` : '—'}</strong><small>{range ? 'Donde cae el 80 % de tu canto' : 'Canta un poco más para medirlo'}</small></div>
      </div>
      <div className="progress-layout">
        <nav className="progress-songs" aria-label="Canciones cantadas">{songs.map(song => {
          const first = song.full[0], last = song.full.at(-1), change = first && last && song.full.length > 1 ? last.score - first.score : null;
          return <button key={song.songId} className={song === current ? 'selected' : ''} aria-current={song === current} onClick={() => setSelected(song.songId)}>
            <strong>{song.song}</strong><span>{song.takes.length} {song.takes.length === 1 ? 'intento' : 'intentos'} · último {day(song.last.createdAt)}</span>
            <span>{last ? `Último ${points(last.score)}` : 'Solo ensayos'}{change !== null ? ` · ${change >= 0 ? '+' : '−'}${points(Math.abs(change))} desde el primero` : ''}</span>
          </button>;
        })}</nav>
        {current ? <SongDetail key={current.songId} song={current} takes={takes} phrases={phrases} onSing={onSing}/> : null}
      </div>
    </>}
  </>;
}
