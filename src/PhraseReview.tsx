import { midiOf, noteName } from './song';
import type { Note } from './song';
import { DIFFICULTIES } from './scoring';
import type { Difficulty, Reading } from './scoring';
import { pitchError, reliablePitch } from './pitch-reference';

const colors = { hit: '#c4f26b', near: '#f2c56b', miss: '#e9866d', idle: '#6f7480' };

/** One phrase after the take: its reference notes and where the voice actually went, coloured by the credit each reading earned. */
export function PhraseReview({ notes, readings, offsetMs, difficulty, gate, signedCents }: { notes: Note[]; readings: Reading[]; offsetMs: number; difficulty: Difficulty; gate: number; signedCents: number | null }) {
  const rules = DIFFICULTIES[difficulty], last = notes[notes.length - 1];
  const from = notes[0].start - .4, to = last.start + last.duration + .4;
  const low = Math.min(...notes.map(note => note.midi)) - 3, high = Math.max(...notes.map(note => note.midi)) + 3;
  const width = 640, height = 132;
  const x = (time: number) => (time - from) / (to - from) * width, y = (midi: number) => height - 10 - (Math.max(low, Math.min(high, midi)) - low) / (high - low) * (height - 20);
  const counts = { hit: 0, near: 0, miss: 0, idle: 0 };
  const dots = readings.flatMap((reading, index) => {
    const time = reading.time - offsetMs / 1000;
    if (time < from || time > to || !reliablePitch(reading.frequency, reading.confidence, reading.rms, gate)) return [];
    const midi = midiOf(reading.frequency!);
    // Same rule as the score: the note at this instant, or one next to it within the timing allowance.
    let inside = false, cents = Infinity, target = notes[0], nearest = Infinity;
    for (const note of notes) {
      const gap = time < note.start ? note.start - time : Math.max(0, time - note.start - note.duration);
      if (gap < nearest) { nearest = gap; if (!inside) target = note; }
      if (gap > rules.timing) continue;
      if (!gap) inside = true;
      const error = Math.abs(pitchError(note, Math.max(note.start, Math.min(note.start + note.duration, time)), midi, rules.foldOctaves, rules.nominal) * 100);
      if (error < cents) { cents = error; target = note; }
    }
    const kind = !inside ? 'idle' : cents <= rules.full ? 'hit' : cents < rules.zero ? 'near' : 'miss';
    counts[kind]++;
    // When any octave counts, the voice is drawn in the octave of the note it is closest to.
    const drawn = rules.foldOctaves ? midi - 12 * Math.round((midi - target.midi) / 12) : midi;
    return [<circle key={index} cx={x(time)} cy={y(drawn)} r="2.3" fill={colors[kind]}/>];
  });
  const scored = counts.hit + counts.near + counts.miss;
  const summary = scored ? `${Math.round(100 * counts.hit / scored)} % de las lecturas en la nota, ${Math.round(100 * counts.near / scored)} % cerca y ${Math.round(100 * counts.miss / scored)} % fuera.` : 'No hubo tono fiable durante las notas de esta frase.';
  return <figure className="phrase-review">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trazo de tu voz sobre las notas de la frase. ${summary}`}>
      <text x="4" y="12" fill="#92949d" fontSize="10">{noteName(high - 3)}</text><text x="4" y={height - 3} fill="#92949d" fontSize="10">{noteName(low + 3)}</text>
      {notes.map((note, index) => <rect key={index} x={x(note.start)} y={y(note.midi) - 5} width={Math.max(2, x(note.start + note.duration) - x(note.start))} height="10" rx="5" fill="#a6d64c" opacity=".3"/>)}
      {dots}
    </svg>
    <figcaption><span><i style={{ background: colors.hit }}/> En la nota</span><span><i style={{ background: colors.near }}/> Cerca</span><span><i style={{ background: colors.miss }}/> Fuera</span><span><i style={{ background: colors.idle }}/> Sin nota que evaluar</span><em>{summary}{signedCents !== null && Math.abs(signedCents) >= 30 ? ` De media cantaste ${Math.abs(signedCents)} cents más ${signedCents < 0 ? 'grave' : 'agudo'} que la referencia.` : ''}</em></figcaption>
  </figure>;
}
