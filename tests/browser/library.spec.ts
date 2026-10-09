import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

function wav() {
  const rate = 16000, count = rate * 4, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 261.625565 * i / rate) * 4000), 44 + i * 2);
  return bytes;
}
const audio = wav();
const map = { schemaVersion: 1, audio: { sha256: createHash('sha256').update(audio).digest('hex'), duration: 4 }, notes: [{ start: 0, duration: 0.8, midi: 60, word: 'Hola', phrase: 0 }, { start: 1, duration: 1, midi: 60, word: 'voz', phrase: 1 }] };
const audioFile = { name: 'mi-prueba.wav', mimeType: 'audio/wav', buffer: audio };
const mapFile = (value: unknown) => ({ name: 'mapa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });

test('import, validate, persist and sing a real file with a two-phrase map', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), dest = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565; oscillator.connect(dest); oscillator.start();
      return dest.stream;
    };
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(audioFile);
  await expect(page.getByRole('button', { name: 'Guardar y cantar' })).toBeDisabled();
  await page.getByLabel('Archivo del mapa').setInputFiles(mapFile({ ...map, audio: { ...map.audio, sha256: 'wrong' } }));
  await expect(page.getByRole('alert')).toContainText('otro archivo');
  await page.getByLabel('Archivo del mapa').setInputFiles(mapFile(map));
  await expect(page.getByText('Mapa válido', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.locator('.song-row').click(); await expect(page.getByLabel('Palabra 1', { exact: true })).toHaveValue('Hola');
  await page.screenshot({ path: 'artifacts/etapa-2-biblioteca.png', fullPage: true });
  await page.getByRole('button', { name: 'Guardar y cantar' }).click();
  await expect(page.locator('.track-heading h2')).toHaveText('mi-prueba');
  await expect(page.getByRole('combobox', { name: 'Registro de práctica' })).toBeDisabled();
  await expect(page.locator('.reference-note')).toContainText('Do4');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 13000 });
  await expect(page.locator('.phrase-results>div')).toHaveCount(2);
  const score = Number((await page.locator('.score-number').innerText()).split('/')[0].replace(/\D/g, ''));
  expect(score).toBeGreaterThan(7000);
  expect(errors).toEqual([]);
});

test('editor prevents invalid notes and allows marking, shifting, removing and exporting', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(audioFile);
  await expect(page.locator('.song-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
  await page.getByLabel('Palabra 1', { exact: true }).fill('Prueba');
  await page.getByLabel('Duración 1', { exact: true }).fill('5');
  await expect(page.getByLabel('Errores del mapa')).toContainText('después del audio');
  await expect(page.getByRole('button', { name: 'Guardar y cantar' })).toBeDisabled();
  await page.getByLabel('Duración 1', { exact: true }).fill('1');
  await page.getByLabel('Desplazar todas las notas (s)').fill('0.5');
  await page.getByRole('button', { name: 'Aplicar desfase' }).click();
  await expect(page.getByLabel('Inicio 1', { exact: true })).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Marcar inicio 1', exact: true }).click();
  await expect(page.getByLabel('Inicio 1', { exact: true })).toHaveValue('0');
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar mapa' }).click();
  expect((await downloading).suggestedFilename()).toContain('mapa.json');
  await page.getByRole('button', { name: 'Eliminar nota 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardar y cantar' })).toBeDisabled();
});

test('MusicBrainz mismatch needs explicit confirmation and is saved with the song', async ({ page }) => {
  await page.route('**/api/musicbrainz/recordings?**', route => route.fulfill({ json: { recordings: [{ id: '12345678-1234-1234-1234-123456789abc', title: 'Una versión', artist: 'Artista de prueba', duration: 180, album: 'Álbum', date: '2000', disambiguation: 'Live' }] } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(audioFile);
  await page.getByText('Identificar en MusicBrainz', { exact: true }).click();
  await page.getByRole('button', { name: 'Buscar versiones' }).click();
  await page.getByRole('radio').check();
  await expect(page.locator('.confirm-recording')).toContainText('otra edición');
  await expect(page.getByRole('button', { name: 'Asociar esta versión' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'He comprobado' }).check();
  await page.getByRole('button', { name: 'Asociar esta versión' }).click();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.associated-recording')).toContainText('Una versión');
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.locator('.song-row').click(); await page.locator('.musicbrainz-search summary').click();
  await expect(page.locator('.associated-recording')).toContainText('Una versión');
});

test('invalid audio fails clearly, example is editable, duplicate file is deduplicated and mobile fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles({ name: 'bad.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
  await expect(page.getByRole('alert')).toContainText('no pudo decodificar');
  await page.getByRole('button', { name: 'Añadir ejemplo editable' }).click();
  await expect(page.getByText('Mapa válido', { exact: true })).toBeVisible();
  await expect(page.locator('.note-table tbody tr')).toHaveCount(24);
  await page.getByRole('button', { name: 'Añadir ejemplo editable' }).click();
  await expect(page.locator('.song-row')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/etapa-2-mobile.png', fullPage: true });
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar canción', exact: true }).click();
  await expect(page.locator('.song-row')).toHaveCount(0);
});

test('reselecting current song retains dirty warning and reimport explicitly resets draft', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(audioFile);
  await expect(page.locator('.song-editor')).toBeVisible();
  await page.getByLabel('Título', { exact: true }).fill('Borrador sin guardar');
  await page.locator('.song-row').click();
  let dialogs = 0;
  const dismiss = async (dialog: import('@playwright/test').Dialog) => { dialogs++; await dialog.dismiss(); };
  page.on('dialog', dismiss);
  await page.getByRole('button', { name: 'Escenario', exact: true }).click();
  expect(dialogs).toBe(1);
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Borrador sin guardar');
  page.off('dialog', dismiss); page.on('dialog', dialog => dialog.accept());
  await page.getByLabel('Archivo de audio').setInputFiles(audioFile);
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('mi-prueba');
});

test('pending save locks editing, library selection and navigation until persistence completes', async ({ page }) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      configurable: true, get: descriptor.get,
      set(callback) { const transaction = this; descriptor.set!.call(this, function (event: Event) {
        if ((window as any).delaySave && transaction.mode === 'readwrite') setTimeout(() => callback.call(transaction, event), 2000);
        else callback.call(transaction, event);
      }); },
    });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(audioFile);
  await expect(page.locator('.song-editor')).toBeVisible();
  await page.locator('.musicbrainz-search summary').click();
  await page.getByLabel('Título', { exact: true }).fill('Guardado pendiente');
  await page.evaluate(() => { (window as any).delaySave = true; });
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Buscar versiones', exact: true })).toBeDisabled();
  await expect(page.locator('.song-row')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cargar audio', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Escenario', exact: true }).click();
  await expect(page.locator('.song-editor')).toBeVisible();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible();
  await expect(page.getByLabel('Título', { exact: true })).toBeEnabled();
});

test('the stage follows edits saved in the library, leaves a deleted song, and a result survives the microphone test', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), dest = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565; oscillator.connect(dest); oscillator.start();
      return dest.stream;
    };
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(audioFile);
  await page.getByLabel('Archivo del mapa').setInputFiles(mapFile(map));
  await page.getByRole('button', { name: 'Guardar y cantar' }).click();
  await expect(page.locator('.reference-note')).toContainText('Do4');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 13000 });
  const score = await page.locator('.score-number').innerText();
  await page.getByRole('button', { name: 'Probar micrófono', exact: true }).click();
  await expect(page.locator('.input-diagnostic')).toContainText('Do4');
  await expect(page.locator('.result-panel')).toBeVisible();
  await expect(page.locator('.score-number')).toHaveText(score);
  await page.getByRole('button', { name: 'Detener prueba', exact: true }).click();
  await expect(page.locator('.result-panel')).toBeVisible();

  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.locator('.song-row').click();
  await page.getByLabel('Nota 1', { exact: true }).selectOption({ label: 'Sol4' });
  await page.getByLabel('Título', { exact: true }).fill('Con otra nota');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible();
  await page.getByRole('button', { name: 'Escenario', exact: true }).click();
  await expect(page.locator('.track-heading h2')).toHaveText('Con otra nota');
  await expect(page.locator('.reference-note')).toContainText('Sol4');

  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.locator('.song-row').click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar canción', exact: true }).click();
  await expect(page.locator('.song-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Escenario', exact: true }).click();
  await expect(page.locator('.track-heading h2')).toHaveText('Un nuevo comienzo');
});
