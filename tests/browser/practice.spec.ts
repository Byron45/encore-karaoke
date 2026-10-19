import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

// Eight seconds of Do4 with two one-note phrases: Do4 at 0.5 s and Mi4 at 5 s.
function wav() {
  const rate = 16000, count = rate * 8, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 261.625565 * i / rate) * 4000), 44 + i * 2);
  return bytes;
}
const audio = wav();
const map = { schemaVersion: 1, audio: { sha256: createHash('sha256').update(audio).digest('hex'), duration: 8 }, notes: [{ start: .5, duration: 1, midi: 60, word: 'Uno', phrase: 0 }, { start: 5, duration: 1, midi: 64, word: 'dos', phrase: 1 }] };

test('one phrase can be practised on its own from the result, without setting a mark', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // The singer holds Mi4: right for the second phrase, a major third away from the first.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 329.627557; oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && this.buffer.duration > 7) (window as any).playedFrom = args[1] ?? 0;
      return start.apply(this, args);
    };
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles({ name: 'ensayo.wav', mimeType: 'audio/wav', buffer: audio });
  await page.getByLabel('Archivo del mapa').setInputFiles({ name: 'mapa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) });
  await page.getByRole('button', { name: 'Guardar y cantar' }).click();

  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => (window as any).playedFrom)).toBe(0);
  const rows = page.locator('.phrase-results>div');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('strong')).toHaveText('0%');
  const full = Number((await page.locator('.score-number').innerText()).split('/')[0].replace(/\D/g, ''));
  expect(full).toBeGreaterThan(3000); expect(full).toBeLessThan(8000);
  await expect(page.getByText(/Primera marca en esta canción/)).toBeVisible();

  // Practising the second phrase plays from two seconds before it and scores only its note.
  const started = Date.now();
  await page.getByRole('button', { name: 'Ensayar la frase 2' }).click();
  await expect(page.getByText(/Ensayando la frase 2: «dos»/)).toBeVisible();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => (window as any).playedFrom)).toBe(3);
  expect(Date.now() - started).toBeLessThan(9500);
  await expect(page.getByText('ENSAYO DE LA FRASE 2', { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('dos'); await expect(rows.first().locator('strong')).toHaveText('100%');
  expect(Number((await page.locator('.score-number').innerText()).split('/')[0].replace(/\D/g, ''))).toBeGreaterThan(9000);
  await expect(page.getByText(/Los ensayos no cuentan como marca/)).toBeVisible();
  await expect(page.locator('.score-card .personal-best')).toContainText(full.toLocaleString('es-EC'));

  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar resultado', exact: true }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.phrase).toBe(1); expect(result.reference.chart).toBe('5000:1000:64:1');
  expect(result.capture.trace.times.split(',').map(Number)[0]).toBeGreaterThanOrEqual(3000);

  // Back to the whole song from the same result.
  await expect(page.getByRole('button', { name: 'Repetir esta frase' })).toBeVisible();
  await page.getByRole('button', { name: 'Cantar la canción completa' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 20000 });
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).playedFrom)).toBe(0);
  expect(errors).toEqual([]);
});
