export interface LyricsSource { id: number; title: string; artist: string; album: string; duration: number }
export interface LyricsDocument { raw: string; format: 'plain' | 'lrc'; offset: number; source?: LyricsSource }
export interface LyricCue { start: number; text: string }
export interface LyricsResult extends LyricsSource { plain: string; synced: string; instrumental: boolean }

export function lrclibId(input: string): string {
  const text = input.trim();
  if (/^[1-9]\d{0,11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const match = url.pathname.match(/^\/tracks\/([1-9]\d{0,11})\/?$/);
    if (url.protocol === 'https:' && url.hostname === 'lrclib.net' && !url.port && !url.username && !url.password && match) return match[1];
  } catch { /* Return the same useful error for malformed or foreign URLs. */ }
  throw new Error('Pega un enlace https://lrclib.net/tracks/… o el número del registro.');
}

export function compileLyrics(doc: LyricsDocument, duration: number): { text: string; cues: LyricCue[] } {
  if (typeof doc.raw !== 'string' || doc.raw.length > 50000) throw new Error('La letra admite hasta 50.000 caracteres.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('La duración de la canción no es válida.');
  if (doc.format === 'plain') return { text: doc.raw.trim(), cues: [] };
  if (!Number.isFinite(doc.offset) || Math.abs(doc.offset) > 120) throw new Error('El ajuste de letra debe estar entre −120 y 120 segundos.');
  if (doc.format !== 'lrc') throw new Error('Formato de letra desconocido.');
  const lines = doc.raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const offsets = lines.filter(line => /^\[offset:/i.test(line.trim()));
  if (offsets.length > 1) throw new Error('El LRC tiene más de un ajuste offset.');
  let headerOffset = 0;
  if (offsets.length) {
    const match = offsets[0].trim().match(/^\[offset:([+-]?\d+)\]$/i);
    if (!match) throw new Error('El offset del LRC no es válido.');
    headerOffset = Number(match[1]) / 1000;
    if (Math.abs(headerOffset) > 120) throw new Error('El offset del LRC supera 120 segundos.');
  }
  const cues: LyricCue[] = [];
  for (const [index, raw] of lines.entries()) {
    let line = raw.trim();
    if (!line || /^\[(ar|ti|al|by|re|ve|length|offset|au|tool|bpm):[^\]]*\]$/i.test(line)) continue;
    const starts: number[] = [];
    while (line.startsWith('[')) {
      const match = line.match(/^\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/);
      if (!match) throw new Error(`Línea ${index + 1}: marca de tiempo no válida. Usa [mm:ss.xx].`);
      const timestamp = Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number(`0.${match[3]}`) : 0);
      // LRC positive offset advances lyrics; our positive adjustment delays them.
      const start = timestamp - headerOffset + doc.offset;
      if (start > duration + 0.05) throw new Error(`Línea ${index + 1}: termina fuera de este audio. Revisa la versión o el ajuste de letra.`);
      starts.push(Math.min(start, duration)); line = line.slice(match[0].length);
    }
    if (!starts.length) throw new Error(`Línea ${index + 1}: falta su tiempo. Si solo tienes texto, elige Letra sin tiempos.`);
    if (/<\d+:\d+/.test(line)) throw new Error('Este LRC contiene tiempos por palabra. Usa una versión LRC por líneas.');
    for (const start of starts) cues.push({ start, text: line.trim() });
    if (cues.length > 1000) throw new Error('El LRC admite hasta 1.000 líneas sincronizadas.');
  }
  if (!cues.some(cue => cue.text)) throw new Error('El LRC no contiene líneas de letra con tiempo.');
  cues.sort((a, b) => a.start - b.start);
  const merged: LyricCue[] = [];
  for (const cue of cues) {
    const previous = merged.at(-1);
    if (previous?.start === cue.start) {
      if (cue.text && previous.text !== cue.text) previous.text = [previous.text, cue.text].filter(Boolean).join('\n');
    } else merged.push({ ...cue });
  }
  const visible = merged.filter(cue => cue.start >= 0);
  const preceding = merged.filter(cue => cue.start < 0).at(-1);
  // Keep only the line still active at the start, not every past line.
  if (preceding && visible[0]?.start !== 0) visible.unshift({ ...preceding, start: 0 });
  return { text: merged.filter(cue => cue.text).map(cue => cue.text).join('\n'), cues: visible };
}

export function exportLyrics(doc: LyricsDocument, duration: number): string {
  const parsed = compileLyrics(doc, duration);
  if (doc.format === 'plain') return doc.raw;
  return parsed.cues.flatMap(cue => {
    const milliseconds = Math.round(cue.start * 1000);
    const minutes = Math.floor(milliseconds / 60000).toString().padStart(2, '0');
    const seconds = ((milliseconds % 60000) / 1000).toFixed(3).padStart(6, '0');
    return cue.text.split('\n').map(line => `[${minutes}:${seconds}]${line}`);
  }).join('\n');
}

export function cueAt(cues: LyricCue[], time: number): number {
  let result = -1;
  for (let i = 0; i < cues.length && cues[i].start <= time; i++) result = i;
  return result;
}
