import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

// Eight seconds of Do4; two lyric lines with one note each.
function wav() {
  const rate = 16000, count = rate * 8, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 261.625565 * i / rate) * 4000), 44 + i * 2);
  return bytes;
}
const audio = wav(), hash = createHash('sha256').update(audio).digest('hex');
const lyrics = '[00:00.30]Te amo más que una estrella\n[00:04.60]mi cielo\n[00:07.50]';
const segments = [{ start: .5, duration: 2.5, midi: 60, confidence: .95, pitchCurve: [[0, 0], [2.5, 0]] }, { start: 5, duration: 1.5, midi: 60, confidence: .95, pitchCurve: [[0, 0], [1.5, 0]] }];

test('the lyrics check records the take, shows what was sung instead and takes its share of the points', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565; oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
  });
  const posts: { headers: Record<string, string>; body: Buffer }[] = []; let failing = false, hanging = false;
  await page.route('**/api/preparation/words', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { available: true, device: 'cuda', token: 'test' } });
    posts.push({ headers: request.headers(), body: request.postDataBuffer()! });
    if (hanging) return; // never answers
    if (failing) return route.fulfill({ status: 503, json: { error: 'El reconocedor no está disponible.' } });
    // The recording starts about a second before song time zero: words are timed from the start of the file.
    const at = (word: string, start: number, end: number) => ({ word, start: start + 1, end: end + 1, probability: .9 });
    return route.fulfill({ json: { device: 'cuda', model: 'turbo', language: 'es', words: [at('Te', .5, .8), at('amo', .8, 1.2), at('como', 1.3, 1.7), at('una', 1.8, 2), at('estrella,', 2, 2.6), at('mi', 5, 5.4), at('cielo.', 5.4, 6.2)] } });
  });
  await page.goto('/');
  await page.evaluate(async ({ lyrics, segments, hash, bytes }) => {
    const { automaticNotes } = await import('/src/preparation.ts');
    const { saveSong } = await import('/src/library-store.ts');
    const doc = { raw: lyrics, format: 'lrc' as const, offset: 0 };
    await saveSong({ id: crypto.randomUUID(), title: 'Letra de prueba', artist: '', duration: 8, bpm: null, notes: automaticNotes(segments, doc, 8), audio: new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), audioName: 'letra.wav', audioHash: hash, updatedAt: new Date().toISOString(), lyrics: doc } as never);
  }, { lyrics, segments, hash, bytes: [...audio] });
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.locator('.song-row').first().click();
  await page.getByRole('button', { name: 'Guardar y cantar', exact: true }).click();

  const toggle = page.getByRole('switch', { name: /Evaluar la letra/ });
  await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.lyrics-review')).toBeVisible({ timeout: 20000 });

  // What was sent: this take's voice as a 16 kHz mono WAV covering the song, identified by its hash.
  expect(posts).toHaveLength(1);
  const sent = posts[0].body;
  expect(sent.toString('ascii', 0, 4)).toBe('RIFF'); expect(sent.readUInt16LE(22)).toBe(1); expect(sent.readUInt32LE(24)).toBe(16000);
  expect(sent.readUInt32LE(40) / 2 / 16000).toBeGreaterThan(8.5); expect(sent.readUInt32LE(40) / 2 / 16000).toBeLessThan(11);
  expect(posts[0].headers['x-audio-sha256']).toBe(createHash('sha256').update(sent).digest('hex'));
  expect(posts[0].headers['x-keep']).toBeUndefined();

  // Six of eight words as written: the changed words are named, and the lyrics take 5 % of the points (a quarter of 20 %).
  const review = page.locator('.lyrics-review');
  await expect(review.getByText('Letra: 75 %')).toBeVisible();
  await expect(review.getByText('Dice «mas que», se oyó «como»')).toBeVisible();
  await expect(page.locator('.score-card')).toContainText('Letra75%');
  const download = async () => {
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar resultado', exact: true }).click();
    const stream = await (await downloading).createReadStream(), chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  const result = await download();
  expect(result.lyrics).toMatchObject({ judged: 8, matched: 6, score: .75, weight: .2, device: 'cuda', model: 'turbo' });
  expect(result.score).toBe(Math.round(result.lyrics.pitchScore * .95));
  expect(result.lyrics.lines[0].differences).toEqual([{ expected: 'mas que', sung: 'como' }]);
  // Takes with the lyrics checked keep marks of their own, and the choice is remembered.
  const marks = await page.evaluate(() => [Object.keys(JSON.parse(localStorage.getItem('encore.best.v1') || '{}')), localStorage.getItem('encore.lyrics-check.v1')]);
  expect(marks[0].some((key: string) => key.endsWith('|relaxed+letra'))).toBe(true); expect(marks[1]).toBe('on');
  // The kept take was replaced by the one with the lyrics.
  const history = page.locator('.take-history');
  await expect(history.locator('summary')).toHaveText(/Tus intentos guardados\s*1/);
  await history.locator('summary').click();
  await expect(history.locator('li b').first()).toHaveText(result.score.toLocaleString('es-EC'));

  // When the recogniser fails, the take keeps the points of its notes and says why.
  failing = true;
  await page.getByRole('button', { name: 'Volver a cantar' }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo evaluar la letra: El reconocedor no está disponible.', { timeout: 20000 });
  await expect(page.locator('.lyrics-review')).toHaveCount(0);
  const plain = await download();
  expect(plain.lyrics).toBeUndefined();
  await expect(history.locator('summary')).toHaveText(/Tus intentos guardados\s*2/);

  // A recognition that does not answer does not hold the take: it is kept as soon as the song ends.
  hanging = true;
  await page.getByRole('button', { name: 'Volver a cantar' }).click();
  await expect(page.getByText(/Analizando la letra/)).toBeVisible({ timeout: 20000 });
  await expect(history.locator('summary')).toHaveText(/Tus intentos guardados\s*3/);
  expect(errors).toEqual([]);
});
