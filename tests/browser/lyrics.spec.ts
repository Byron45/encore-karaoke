import { test, expect } from '@playwright/test';

function wav() {
  const rate = 16000, count = rate * 4, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 261.625565 * i / rate) * 2000), 44 + i * 2);
  return { name: 'letra-prueba.wav', mimeType: 'audio/wav', buffer: bytes };
}
const lyrics = { id: 123, title: 'Prueba de letra', artist: 'Autor', album: 'Ejemplo', duration: 4, plain: 'Primera frase\nSegunda frase', synced: '[00:00.20]Primera frase\n[00:02.00]Segunda frase\n[00:03.80]', instrumental: false };
async function openSong(page: import('@playwright/test').Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(wav());
  await expect(page.locator('.song-editor')).toBeVisible();
}

test('LRCLIB link imports full synchronized lyrics, persists, and plays without a fabricated score', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new Error('Listening must not request microphone'); }; });
  await page.route('**/api/lyrics?id=123', route => route.fulfill({ json: { results: [lyrics] } }));
  await openSong(page);
  await page.getByLabel('Enlace o ID de LRCLIB').fill('https://lrclib.net/tracks/123');
  await page.getByRole('button', { name: 'Consultar enlace', exact: true }).click();
  await page.getByRole('radio').check();
  await expect(page.getByRole('button', { name: 'Usar letra sincronizada' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'He revisado' }).check();
  await page.getByRole('button', { name: 'Usar letra sincronizada' }).click();
  await expect(page.getByLabel('Letra completa', { exact: true })).toHaveValue(lyrics.synced);
  await expect(page.locator('.note-table tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click(); await page.locator('.song-row').click();
  await expect(page.getByLabel('Letra completa', { exact: true })).toHaveValue(lyrics.synced);
  await page.getByRole('button', { name: 'Guardar y cantar sin puntuación' }).click();
  await expect(page.getByRole('heading', { name: 'Sin puntuación', exact: true })).toBeVisible();
  await expect(page.locator('.reference-note')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).seenLines = [];
    const observer = new MutationObserver(() => { (window as any).seenLines.push(document.querySelector('.stage .synced-current')?.textContent); });
    observer.observe(document.querySelector('.stage')!, { subtree: true, childList: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Escuchar canción', exact: true }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 13000 });
  const seen = await page.evaluate(() => (window as any).seenLines);
  expect(seen).toContain('Primera frase'); expect(seen).toContain('Segunda frase');
  await expect(page.locator('.score-number')).toHaveCount(0);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar resultado', exact: true }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.scored).toBe(false); expect(result.score).toBeNull(); expect(result.simulated).toBe(false); expect(result.mode).toBe('listen'); expect(result.accuracy).toBeUndefined();
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/etapa-2b-canto-libre.png', fullPage: true });
});

test('duration mismatch and out-of-range LRC allow only an explicit choice, with plain text fallback', async ({ page }) => {
  await page.route('**/api/lyrics?**', route => route.fulfill({ json: { results: [{ ...lyrics, duration: 20, synced: '[00:15.00]Otra edición' }] } }));
  await openSong(page); await page.getByRole('button', { name: 'Buscar letra por título y artista', exact: true }).click();
  await page.getByRole('radio').check(); await expect(page.locator('.lyrics-choice')).toContainText('0:20 y tu audio 0:04');
  await expect(page.getByRole('button', { name: 'Usar letra sincronizada' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'He revisado' }).check(); await page.getByRole('button', { name: 'Usar letra sincronizada' }).click();
  await expect(page.getByRole('alert')).toContainText('fuera de este audio');
  await expect(page.getByLabel('Letra completa', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Usar solo el texto' }).click();
  await expect(page.getByLabel('Letra completa', { exact: true })).toHaveValue(lyrics.plain);
  await expect(page.getByLabel('Formato de letra')).toHaveValue('plain');
  await page.getByRole('button', { name: 'Guardar y cantar sin puntuación' }).click();
  await expect(page.getByLabel('Letra sin sincronizar')).toContainText('Primera frase');
});

test('API failure leaves manual whole lyrics usable, invalid LRC cannot save, mobile fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/lyrics?**', route => route.fulfill({ status: 502, json: { error: 'LRCLIB no está disponible ahora.' } }));
  await openSong(page); await page.getByRole('button', { name: 'Buscar letra por título y artista' }).click();
  await expect(page.getByRole('alert')).toContainText('LRCLIB no está disponible');
  await page.getByLabel('Formato de letra').selectOption('lrc');
  await page.getByLabel('Letra completa', { exact: true }).fill('[00:70]Tiempo incorrecto');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toHaveCount(0);
  await page.getByLabel('Letra completa', { exact: true }).fill('[00:00.50]Mi primera frase\n[00:02.00]Canto otra vez');
  await page.getByLabel('Ajustar letra (s)').fill('0.1');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar letra', exact: true }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain('[00:00.600]Mi primera frase');
  await page.screenshot({ path: 'artifacts/etapa-2b-letras-mobile.png', fullPage: true });
});

test('editing complete lyrics preserves an existing note map and pending changes warning', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir ejemplo editable' }).click();
  await expect(page.locator('.note-table tbody tr')).toHaveCount(24);
  await page.getByLabel('Letra completa', { exact: true }).fill('Texto completo independiente\nSegunda línea');
  await expect(page.getByLabel('Palabra 1', { exact: true })).toHaveValue('Hoy');
  let asked = false; page.on('dialog', dialog => { asked = true; return dialog.dismiss(); });
  await page.getByRole('button', { name: 'Escenario', exact: true }).click();
  expect(asked).toBe(true); await expect(page.getByLabel('Letra completa', { exact: true })).toHaveValue('Texto completo independiente\nSegunda línea');
  await page.getByRole('button', { name: 'Guardar y cantar', exact: true }).click();
  await expect(page.getByLabel('Letra sin sincronizar')).toContainText('Texto completo independiente');
  await expect(page.locator('.score-number')).toBeVisible();
});

test('microphone singing without a map finishes without zero-score or missing-analysis diagnosis', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), dest = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565; oscillator.connect(dest); oscillator.start();
      (window as any).freeMic = { context, oscillator, stream: dest.stream };
      return dest.stream;
    };
  });
  await openSong(page); await page.getByLabel('Letra completa', { exact: true }).fill('Una frase para cantar');
  await page.getByRole('button', { name: 'Guardar y cantar sin puntuación' }).click();
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.getByText('Tu voz: Do4', { exact: true })).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole('heading', { name: 'Cantaste a tu manera.' })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.result-diagnostics')).toHaveCount(0); await expect(page.locator('.score-number')).toHaveCount(0);
  await expect(page.getByText('Faltaron datos del micrófono.', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).freeMic.stream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => { (window as any).freeMic.oscillator.stop(); return (window as any).freeMic.context.close(); });
});
