import { useState } from 'react';
import type { LyricsSummary } from './sung-words';

const SHOWN = 8;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** What the lyrics check found: the share of words sung as written and, line by line, what was sung instead. */
export function LyricsReview({ lyrics }: { lyrics: LyricsSummary }) {
  const [all, setAll] = useState(false);
  const wrong = lyrics.lines.filter(line => line.differences.length), shown = all ? wrong : wrong.slice(0, SHOWN);
  const percent = Math.round(lyrics.score * 100), lost = lyrics.pitchScore - Math.round(lyrics.pitchScore * (1 - lyrics.weight * (1 - lyrics.score)));
  return <section className="lyrics-review" aria-label="Evaluación de la letra">
    <div className="lyrics-review-heading"><strong>Letra: {percent} %</strong><span>EXPERIMENTAL</span></div>
    <p>Reconocimos como en la letra {lyrics.matched} de {lyrics.judged} palabras. {lost > 0 ? `Resta ${lost.toLocaleString('es-EC')} puntos a los ${lyrics.pitchScore.toLocaleString('es-EC')} de la melodía (hasta un ${Math.round(lyrics.weight * 100)} % con ninguna palabra bien).` : 'No resta puntos.'}{lyrics.ignored ? ` No cuentan ${lyrics.ignored} palabras que el reconocedor tampoco distingue en la voz original de la grabación.` : ''}</p>
    {wrong.length ? <ul>{shown.map(line => <li key={line.line}>
      <span>{clock(line.start)}</span>
      <div><q>{line.text}</q>{line.differences.map((difference, i) => <small key={i}>{difference.sung ? <>Dice «{difference.expected}», se oyó «{difference.sung}»</> : <>No se oyó «{difference.expected}»</>}</small>)}</div>
    </li>)}</ul> : <p>Todas las líneas evaluadas se oyeron como en la letra.</p>}
    {wrong.length > SHOWN ? <button className="text-button" onClick={() => setAll(value => !value)}>{all ? 'Mostrar menos' : `Ver las ${wrong.length} líneas con diferencias`}</button> : null}
    <p className="lyrics-review-note">El reconocimiento de voz con canto se equivoca a veces: una palabra bien cantada puede oírse distinta, sobre todo en vocales largas o con la música muy alta en los auriculares.</p>
  </section>;
}
