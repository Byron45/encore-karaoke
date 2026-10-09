import { frequencyOf, song } from './song';
import { loadAudio } from './library-store';

export async function createExampleSong() {
  const rate = 16000, count = rate * song.duration;
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  for (const note of song.notes) for (let i = Math.round(note.start * rate); i < Math.round((note.start + note.duration) * rate); i++) {
    const local = i / rate - note.start;
    const envelope = Math.max(0, Math.min(1, local / 0.02, (note.duration - local) / 0.05));
    view.setInt16(44 + i * 2, Math.round(0.2 * envelope * Math.sin(2 * Math.PI * frequencyOf(note.midi) * local) * 32767), true);
  }
  const record = await loadAudio(new File([bytes], 'encore-ejemplo-original.wav', { type: 'audio/wav' }));
  return { ...record, title: song.title, artist: song.artist, bpm: song.bpm, notes: song.notes.map(note => ({ ...note })) };
}
