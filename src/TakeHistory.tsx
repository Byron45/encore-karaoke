import { useEffect, useState } from 'react';
import { ArrowDownToLine, History, Trash2 } from 'lucide-react';
import { DIFFICULTIES } from './scoring';
import type { Difficulty } from './scoring';
import { clearTakes, deleteTake, listTakes, MAX_TAKES } from './take-history';
import type { StoredTake } from './take-history';

function download(take: StoredTake) {
  const url = URL.createObjectURL(new Blob([take.document], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `encore-${take.song.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'intento'}-${take.createdAt.slice(0, 16).replace(/[T:]/g, '-')}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The takes kept in this browser, newest first, to download again or delete. `version` changes when a take is added. */
export function TakeHistory({ version }: { version: number }) {
  const [takes, setTakes] = useState<StoredTake[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    listTakes().then(items => { if (alive) { setTakes(items); setError(''); } }, failure => { if (alive) setError((failure as Error).message); });
    return () => { alive = false; };
  }, [version]);
  async function remove(id: string | null) {
    if (id === null && !window.confirm('¿Borrar todos los intentos guardados en este navegador? Tus canciones y mejores marcas se conservan.')) return;
    try { await (id === null ? clearTakes() : deleteTake(id)); setTakes(items => id === null ? [] : items.filter(take => take.id !== id)); } catch (failure) { setError((failure as Error).message); }
  }
  if (!takes.length && !error) return null;
  return <details className="take-history">
    <summary><History size={17}/> Tus intentos guardados <span>{takes.length}</span></summary>
    <p>Este navegador guarda tus últimos {MAX_TAKES} intentos con micrófono: la puntuación y el trazo de afinación, nunca el sonido. Descárgalos cuando quieras analizarlos.</p>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <ul>{takes.map(take => <li key={take.id}>
      <div><strong>{take.song}</strong><span>{new Date(take.createdAt).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })} · {DIFFICULTIES[take.difficulty as Difficulty]?.label || take.difficulty}{take.transpose ? ` · ${take.transpose > 0 ? '+' : '−'}${Math.abs(take.transpose)} st` : ''}{take.phrase !== undefined ? ` · ensayo de la frase ${take.phrase + 1}` : ''}</span></div>
      <b>{take.score.toLocaleString('es-EC')}</b>
      <button className="icon-button" aria-label={`Descargar el intento de ${take.song}`} title="Descargar" onClick={() => download(take)}><ArrowDownToLine size={16}/></button>
      <button className="icon-button" aria-label={`Borrar el intento de ${take.song}`} title="Borrar" onClick={() => void remove(take.id)}><Trash2 size={16}/></button>
    </li>)}</ul>
    {takes.length ? <button className="text-button" onClick={() => void remove(null)}>Borrar todos los intentos</button> : null}
  </details>;
}
