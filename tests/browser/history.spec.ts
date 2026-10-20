import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

function wav() {
  const rate = 16000, count = rate * 4, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 261.625565 * i / rate) * 4000), 44 + i * 2);
  return bytes;
}
const audio = wav();
const map = { schemaVersion: 1, audio: { sha256: createHash('sha256').update(audio).digest('hex'), duration: 4 }, notes: [{ start: .3, duration: 1, midi: 60, word: 'Hola', phrase: 0 }, { start: 2, duration: 1, midi: 60, word: 'voz', phrase: 1 }] };
async function read(download: Promise<import('@playwright/test').Download>) {
  const stream = await (await download).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

test('every take with the microphone is kept in the browser to download later, and can be deleted', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565; oscillator.connect(destination); oscillator.start();
      return destination.stream;
    };
  });
  await page.goto('/');
  // Nothing sung yet: no history to show.
  await expect(page.locator('.take-history')).toHaveCount(0);
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles({ name: 'historial.wav', mimeType: 'audio/wav', buffer: audio });
  await page.getByLabel('Archivo del mapa').setInputFiles({ name: 'mapa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) });
  await page.getByRole('button', { name: 'Guardar y cantar' }).click();

  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 15000 });
  const shown = await page.locator('.score-number').innerText(), score = Number(shown.split('/')[0].replace(/\D/g, ''));
  await page.getByRole('button', { name: 'Ensayar la frase 2' }).click();
  await expect(page.getByText('ENSAYO DE LA FRASE 2', { exact: true })).toBeVisible({ timeout: 15000 });

  // Both takes stay after a reload, newest first, without having been downloaded.
  await page.reload();
  const history = page.locator('.take-history');
  await expect(history.locator('summary')).toContainText('Tus intentos guardados 2');
  await history.locator('summary').click();
  const rows = history.locator('li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('ensayo de la frase 2');
  await expect(rows.nth(1)).toContainText('historial'); await expect(rows.nth(1).locator('b')).toHaveText(score.toLocaleString('es-EC'));

  // The kept document is the one "Descargar resultado" gives: score, trace and the chart as sung.
  const downloading = page.waitForEvent('download');
  await rows.nth(1).getByRole('button', { name: 'Descargar el intento de historial' }).click();
  const kept = await read(downloading);
  expect(kept.score).toBe(score); expect(kept.mode).toBe('microphone'); expect(kept.phrase).toBeUndefined();
  expect(kept.capture.trace.times.split(',').length).toBeGreaterThan(50);
  expect(kept.reference.chart).toBe('300:1000:60:0,2000:1000:60:1');

  // One take, then all of them, can be deleted.
  await rows.nth(0).getByRole('button', { name: 'Borrar el intento de historial' }).click();
  await expect(rows).toHaveCount(1);
  page.once('dialog', dialog => void dialog.accept());
  await history.getByRole('button', { name: 'Borrar todos los intentos' }).click();
  await expect(history).toHaveCount(0);
  await page.reload(); await expect(page.locator('.take-history')).toHaveCount(0);
  expect(errors).toEqual([]);
});
