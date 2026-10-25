import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

// Twelve seconds; three one-note phrases low in the voice: Do#3, Mi3 and Sol#3.
function wav() {
  const rate = 16000, count = rate * 12, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 138.59 * i / rate) * 4000), 44 + i * 2);
  return bytes;
}
const audio = wav();
const map = { schemaVersion: 1, audio: { sha256: createHash('sha256').update(audio).digest('hex'), duration: 12 }, notes: [{ start: .5, duration: 3, midi: 49, word: 'Primera', phrase: 0 }, { start: 4, duration: 3, midi: 52, word: 'Segunda', phrase: 1 }, { start: 8, duration: 3, midi: 56, word: 'Tercera', phrase: 2 }] };

test('progress shows each song over time, the comfortable range, a key that suits it and the phrases to practise', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 164.81; oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
  });
  await page.route('**/api/preparation/transpose', route => route.fulfill({ json: { available: true, token: 'test' } }));
  await page.route('**/api/preparation/words', route => route.fulfill({ json: { available: false, device: null, token: 'test' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Tu progreso', exact: true }).click();
  await expect(page.getByText('Todavía no hay intentos guardados.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles({ name: 'grave.wav', mimeType: 'audio/wav', buffer: audio });
  await page.getByLabel('Archivo del mapa').setInputFiles({ name: 'mapa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) });
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible();

  // Five earlier takes of this song, kept as summaries only (older than the full results the history keeps): the singer
  // sings between Mi3 and Mi4, and the second phrase is always the hard one.
  await page.evaluate(async () => {
    const { listSongs } = await import('/src/library-store.ts');
    const { saveTake } = await import('/src/take-history.ts');
    const id = (await listSongs())[0].id;
    const voice = new Array(49).fill(0); voice[52 - 36] = 30; voice[55 - 36] = 30; voice[59 - 36] = 30; voice[64 - 36] = 25;
    for (const [day, score] of [[1, 3800], [2, 4600], [3, 4400], [4, 5600], [5, 6300]]) {
      const createdAt = `2026-10-0${day}T20:00:00.000Z`, meta = { createdAt, songId: id, song: 'grave' };
      await saveTake({ ...meta, difficulty: 'relaxed', score, transpose: 0, document: '', summary: { ...meta, difficulty: 'relaxed', score, transpose: 0, phrases: [90, 20 + day * 5, 85], phraseCount: 3, voice } });
    }
  });

  await page.getByRole('button', { name: 'Tu progreso', exact: true }).click();
  const tiles = page.locator('.stat-tiles');
  await expect(tiles).toContainText('Intentos5'); await expect(tiles).toContainText('Canciones1');
  await expect(tiles).toContainText(/Tu rango cómodoMi3 – (Mi|Re♯)4/);
  await expect(page.locator('.progress-songs button')).toContainText('+2.500 desde el primero');
  await expect(page.locator('.score-chart circle')).toHaveCount(5);
  // Hovering the chart reads the take under the pointer.
  const chart = page.locator('.score-chart svg'), box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2);
  await expect(page.locator('.chart-tooltip')).toContainText('6.300');
  await expect(page.locator('.takes-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.weak-phrases')).toContainText('Segunda'); await expect(page.locator('.weak-phrases')).toContainText('35 %');
  // The full history only lists takes that can still be downloaded.
  await expect(page.locator('.take-history')).toHaveCount(0);

  // On the stage: the song sits below the voice, so the suggestion is three semitones up.
  await page.getByRole('button', { name: 'Cantarla' }).click();
  await expect(page.locator('.track-heading h2')).toHaveText('grave');
  await expect(page.locator('.key-advice')).toContainText('+3 semitonos');
  await page.getByRole('button', { name: 'Usar +3' }).click();
  await expect(page.getByLabel('Tono de la canción', { exact: true })).toHaveValue('3');
  await page.getByLabel('Tono de la canción', { exact: true }).selectOption('0');

  // The hardest phrase can be practised from the stage.
  const card = page.locator('.practice-card');
  await expect(card).toContainText('Frase 2 · 35 %'); await expect(card).toContainText('Segunda');
  await card.getByRole('button', { name: 'Ensayar la frase 2' }).click();
  await expect(page.getByText('ENSAYO DE LA FRASE 2', { exact: true })).toBeVisible({ timeout: 20000 });

  // That take joins the progress, with the voice it measured.
  await page.getByRole('button', { name: 'Tu progreso', exact: true }).click();
  await expect(tiles).toContainText('Intentos6');
  await expect(page.locator('.takes-table tbody tr').first()).toContainText('ensayo de la frase 2');
  expect(errors).toEqual([]);
});
