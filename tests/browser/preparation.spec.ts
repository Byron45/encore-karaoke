import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

function wav(frequency: number) {
  const rate = 44100, count = rate * 4, b = Buffer.alloc(44 + count * 4);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++) for (let c = 0; c < 2; c++) b.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + i * 4 + c * 2);
  return b;
}
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const original = wav(220), stems = { vocals: wav(261.625565), instrumental: wav(440), reduced: wav(330) };
const manifest = {
  schemaVersion: 1, originalSha256: hash(original), duration: 4, sampleRate: 44100, samples: 176400,
  separator: { package: 'test fixture', version: '1', model: 'synthetic' }, alignment: [{ position: .5, lagSeconds: 0, correlation: 1 }], sharedGain: 1, reducedVocalGain: .25,
  stems: Object.fromEntries(Object.entries(stems).map(([name, data]) => [name, { file: name + '.wav', sha256: hash(data), bytes: data.length, sampleRate: 44100, samples: 176400, channels: 2, duration: 4, offsetSamples: 0 }])),
  analysis: { method: 'synthetic test', version: '1', analyzedSeconds: 4, detectedSeconds: 2.5, warning: 'Prueba sintética.', notes: [{ start: .3, duration: 1.2, midi: 60, confidence: .95, pitchCurve: [[0, 0], [1.2, 0]] }, { start: 2, duration: 1.3, midi: 60, confidence: .95, pitchCurve: [[0, 0], [1.3, 0]] }] },
};
async function mock(page: Page, mode = 'complete') {
  const calls: string[] = []; let id = '', analyzing = false;
  await page.route('**/api/preparation/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    calls.push(request.method() + ' ' + path);
    if (path.endsWith('/status')) return route.fulfill({ json: { ready: mode !== 'missing', token: 'test', active: null, error: 'Falta instalar el motor local.' } });
    if (request.method() === 'DELETE') return route.fulfill({ json: { cancelled: true } });
    if (request.method() === 'POST') id = request.headers()['x-encore-job-id'];
    if (path.endsWith('/analysis')) {
      analyzing = true;
      expect(request.headers()['x-audio-sha256']).toBe(hash(stems.vocals));
      expect(hash(request.postDataBuffer()!)).toBe(hash(stems.vocals));
    }
    if (path.endsWith('/analysis.json')) return route.fulfill({ json: { schemaVersion: 1, sourceSha256: mode === 'badanalysis' ? 'wrong' : hash(stems.vocals), analysis: { ...manifest.analysis, version: 'encore-melody-2', detectedSeconds: 2.8, notes: [...manifest.analysis.notes, { start: 3.5, duration: .3, midi: 62, confidence: .9, pitchCurve: [[0, -20], [.3, 20]] }] } } });
    if (path.endsWith('.wav')) {
      const name = path.split('/').at(-1)!.replace('.wav', '') as keyof typeof stems;
      return route.fulfill({ contentType: 'audio/wav', body: mode === 'corrupt' ? Buffer.from('bad wav') : stems[name] });
    }
    if (path.endsWith('/manifest.json')) return route.fulfill({ json: manifest });
    return route.fulfill({ json: { id, state: mode === 'running' || mode === 'cancelanalysis' && analyzing ? 'running' : 'complete', stage: 'Procesando fixture', progress: 35, originalSha256: hash(original) } });
  });
  return calls;
}
async function openSong(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles({ name: 'preparacion.wav', mimeType: 'audio/wav', buffer: original });
  await page.getByLabel('Letra completa', { exact: true }).fill('Una línea de prueba');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible();
}
async function generate(page: Page) {
  await page.getByRole('button', { name: 'Separar voz y generar mapa', exact: true }).click();
  await expect(page.getByText('2 notas propuestas', { exact: true })).toBeVisible();
}

test('pending preparation is protected, accepted explicitly, persisted and played in three modes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565; oscillator.connect(destination); oscillator.start();
      destination.stream.getTracks()[0].addEventListener('ended', () => void context.close()); return destination.stream;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) {
        const data = this.buffer.getChannelData(0); let crossings = 0;
        for (let i = 1; i < data.length; i++) if (data[i - 1] <= 0 && data[i] > 0) crossings++;
        (window as any).playedFrequency = crossings / this.buffer.duration;
      }
      return start.apply(this, args);
    };
  });
  await mock(page); await openSong(page); await generate(page);
  await expect(page.getByRole('button', { name: 'Guardar y cantar sin puntuación', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeDisabled();
  const dialog = page.waitForEvent('dialog'); const navigation = page.getByRole('button', { name: 'Escenario', exact: true }).click();
  await (await dialog).dismiss(); await navigation; await expect(page.locator('.song-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar pistas y mapa automático' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
  await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
  await expect(page.locator('.note-table tbody tr')).toHaveCount(2);
  await expect(page.getByLabel('Palabra 1', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click(); await page.locator('.song-row').click();
  await expect(page.getByText('PISTAS PREPARADAS', { exact: true })).toBeVisible();
  await expect(page.locator('.note-table tbody tr')).toHaveCount(2);
  await page.screenshot({ path: 'artifacts/etapa-2c-preparacion.png', fullPage: true });
  await page.getByRole('button', { name: 'Guardar y cantar', exact: true }).click();
  // This server has no audio engine for key changes: the selector says so instead of failing later.
  await expect(page.getByLabel('Tono de la canción', { exact: true })).toBeDisabled();
  await expect(page.getByText(/Cambiar el tono necesita el motor local/)).toBeVisible();
  for (const [value, frequency, gain] of [['original', 220, 1], ['reduced', 330, .25], ['instrumental', 440, 0]] as const) {
    await page.getByLabel('Acompañamiento', { exact: true }).selectOption(value);
    if (value !== 'original') await expect(page.getByRole('switch', { name: 'Escuchar melodía guía' })).not.toBeChecked();
    await page.getByRole('button', { name: /Empezar a cantar|Volver a cantar/ }).click();
    await expect(page.locator('.result-panel')).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => (window as any).playedFrequency)).toBeCloseTo(frequency, 0);
    const score = Number((await page.locator('.score-number').innerText()).split('/')[0].replace(/\D/g, ''));
    expect(score).toBeGreaterThan(7000);
    // The isolated voice is a clean tone on the notes: it sets the scale of this song.
    await expect(page.getByText(/10\.000 puntos son la voz original de esta grabación/)).toBeVisible();
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar resultado', exact: true }).click();
    const stream = await (await downloading).createReadStream(), chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const result = JSON.parse(Buffer.concat(chunks).toString());
    expect(result.accompaniment).toBe(value); expect(result.vocalGain).toBe(gain); expect(result.experimentalMap).toBe(true);
    expect(result.recording).toMatchObject({ difficulty: result.difficulty, usable: true, score: 10000 });
    expect(result.ceiling).toBe(result.recording.ceiling); expect(result.ceiling).toBeGreaterThan(.9);
  }
  expect(errors).toEqual([]);
});

test('cancel keeps the original and locks editing only during processing', async ({ page }) => {
  const calls = await mock(page, 'running'); await openSong(page);
  await page.getByRole('button', { name: 'Separar voz y generar mapa' }).click();
  await expect(page.getByText('Procesando fixture', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Título', { exact: true })).toBeDisabled();
  await expect(page.locator('.song-row')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancelar preparación' }).click();
  await expect(page.getByRole('alert')).toContainText('Preparación cancelada');
  await expect(page.getByLabel('Título', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Letra completa', { exact: true })).toHaveValue('Una línea de prueba');
  await expect(page.locator('.note-table tbody tr')).toHaveCount(0);
  expect(calls.some(c => c.startsWith('DELETE '))).toBe(true);
});

test('corrupt stems fail without altering the song', async ({ page }) => {
  await mock(page, 'corrupt'); await openSong(page);
  await page.getByRole('button', { name: 'Separar voz y generar mapa' }).click();
  await expect(page.getByRole('alert')).toContainText('incompleta');
  await expect(page.getByRole('button', { name: 'Usar solo las pistas' })).toHaveCount(0);
  await expect(page.getByLabel('Letra completa', { exact: true })).toHaveValue('Una línea de prueba');
});

test('pistas-only keeps an existing map and preparation fits mobile', async ({ page }) => {
  await mock(page); await openSong(page);
  const map = { schemaVersion: 1, audio: { sha256: hash(original), duration: 4 }, notes: [{ start: .2, duration: 1, midi: 57, word: 'Conservar', phrase: 0 }] };
  await page.getByLabel('Archivo del mapa').setInputFiles({ name: 'map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) });
  await generate(page); await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/etapa-2c-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Usar solo las pistas' }).click();
  await expect(page.getByLabel('Palabra 1', { exact: true })).toHaveValue('Conservar');
  await expect(page.locator('.note-table tbody tr')).toHaveCount(1);
});

test('missing runtime leaves manual preparation available', async ({ page }) => {
  await mock(page, 'missing'); await openSong(page);
  await expect(page.getByText('Falta instalar el motor local.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Separar voz y generar mapa' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Guardar y cantar sin puntuación', exact: true })).toBeEnabled();
});

test('reanalysis reuses vocals, protects old notes until acceptance and persists continuous map v3', async ({ page }) => {
  const calls = await mock(page); await openSong(page); await generate(page);
  await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
  await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await page.getByRole('button', { name: 'Mejorar mapa desde la voz', exact: true }).click();
  await expect(page.getByText('3 notas propuestas', { exact: true })).toBeVisible();
  await expect(page.locator('.note-table tbody tr')).toHaveCount(2);
  await expect(page.getByText('Antes: 2 notas', { exact: false })).toBeVisible();
  expect(calls.filter(c => c === 'POST /api/preparation/jobs')).toHaveLength(1);
  expect(calls.filter(c => c === 'POST /api/preparation/analysis')).toHaveLength(1);
  await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click(); await page.locator('.song-row').click();
  await expect(page.locator('.note-table tbody tr')).toHaveCount(3);
  await page.getByLabel('Duración 3', { exact: true }).fill('');
  await page.getByLabel('Duración 3', { exact: true }).fill('0');
  await page.getByLabel('Duración 3', { exact: true }).fill('0.4');
  await expect(page.getByText('Mapa válido', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar mapa', exact: true }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.schemaVersion).toBe(3); expect(exported.notes[2].pitchCurve[0]).toEqual([0, -20]); expect(exported.notes[2].pitchCurve[1][0]).toBeCloseTo(.4); expect(exported.notes[2].pitchCurve[1][1]).toBe(20);
});

test('reanalysis from the wrong vocal file preserves saved reference and stems', async ({ page }) => {
  await mock(page, 'badanalysis'); await openSong(page); await generate(page);
  await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
  await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
  await page.getByRole('button', { name: 'Mejorar mapa desde la voz', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('otra pista vocal');
  await expect(page.locator('.note-table tbody tr')).toHaveCount(2);
  await expect(page.getByText('PISTAS PREPARADAS', { exact: true })).toBeVisible();
});

test('cancelling reanalysis retains the accepted map and separated tracks', async ({ page }) => {
  await mock(page, 'cancelanalysis'); await openSong(page); await generate(page);
  await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
  await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
  await page.getByRole('button', { name: 'Mejorar mapa desde la voz', exact: true }).click();
  await expect(page.getByText('Procesando fixture', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar y cantar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancelar preparación', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Preparación cancelada');
  await expect(page.locator('.note-table tbody tr')).toHaveCount(2);
  await expect(page.getByText('PISTAS PREPARADAS', { exact: true })).toBeVisible();
});

test('a lower key moves the accompaniment and the notes together, reuses the track and can be cancelled', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const down = 2 ** (-2 / 12);
  await page.addInitScript(frequency => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
      oscillator.frequency.value = frequency; oscillator.connect(destination); oscillator.start();
      destination.stream.getTracks()[0].addEventListener('ended', () => void context.close()); return destination.stream;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer) {
        const data = this.buffer.getChannelData(0); let crossings = 0;
        for (let i = 1; i < data.length; i++) if (data[i - 1] <= 0 && data[i] > 0) crossings++;
        (window as any).playedFrequency = crossings / this.buffer.duration;
      }
      return start.apply(this, args);
    };
  }, 261.625565 * down);
  await mock(page);
  const moves: Record<string, string>[] = []; let release = () => {};
  await page.route('**/api/preparation/transpose', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { available: true, token: 'test' } });
    const headers = route.request().headers(); moves.push(headers);
    if (headers['x-semitones'] === '3') { await new Promise<void>(resolve => { release = resolve; }); return route.fulfill({ contentType: 'audio/wav', body: wav(440) }).catch(() => {}); }
    return route.fulfill({ contentType: 'audio/wav', body: wav(440 * down) });
  });
  await openSong(page); await generate(page);
  await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
  await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
  await page.getByRole('button', { name: 'Guardar y cantar', exact: true }).click();
  await page.getByLabel('Acompañamiento', { exact: true }).selectOption('instrumental');
  const key = page.getByLabel('Tono de la canción', { exact: true });
  await expect(key).toBeEnabled(); await key.selectOption('-2');
  await expect(page.getByText(/Inicio de la guía: .*233 Hz/)).toBeVisible();

  for (const take of [1, 2]) {
    await page.getByRole('button', { name: /Empezar a cantar|Volver a cantar/ }).click();
    await expect(page.locator('.result-panel')).toBeVisible({ timeout: 15000 });
    // The track that played is the moved one, and a voice two semitones down meets the moved notes.
    expect(await page.evaluate(() => (window as any).playedFrequency)).toBeCloseTo(440 * down, 0);
    expect(Number((await page.locator('.score-number').innerText()).split('/')[0].replace(/\D/g, ''))).toBeGreaterThan(7000);
    await expect(page.getByText(/−2 semitonos · más grave · Compensación/)).toBeVisible();
    // Singing again in the same key does not send the track again.
    expect(moves).toHaveLength(1);
  }
  expect(moves[0]).toMatchObject({ 'x-semitones': '-2', 'x-samples': '176400', 'x-audio-sha256': hash(stems.instrumental), 'x-encore-token': 'test' });
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar resultado', exact: true }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).transpose).toBe(-2);

  // A key change still on its way can be stopped: the stage goes back to rest and nothing plays.
  await key.selectOption('3');
  await page.evaluate(() => { (window as any).playedFrequency = null; });
  await page.getByRole('button', { name: /Empezar a cantar|Volver a cantar/ }).click();
  await expect(page.getByRole('button', { name: 'Cambiando el tono…' })).toBeDisabled();
  await expect(page.getByText(/Cambiando el tono de la canción en esta computadora \(\+3 semitonos/)).toBeVisible();
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Empezar a cantar', exact: true })).toBeEnabled();
  await expect(page.getByText(/Cambiando el tono de la canción/)).toHaveCount(0);
  release(); await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).playedFrequency)).toBeNull();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
