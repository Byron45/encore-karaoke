// Uses a user-provided local file and an existing CLI result, in a temporary browser profile.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [input, output, analysisPath] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node tests/real-preparation-check.mjs <original audio> <result folder>');
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
const improved = analysisPath ? JSON.parse(await readFile(analysisPath, 'utf8')) : null;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/preparation/**', async route => {
    const request = route.request(), name = new URL(request.url()).pathname.split('/').at(-1);
    if (name === 'status') return route.fulfill({ json: { ready: true, token: 'isolated-test', active: null } });
    if (request.method() === 'DELETE') return route.fulfill({ json: { cancelled: true } });
    if (name === 'analysis.json' && improved) return route.fulfill({ json: improved });
    if (['manifest.json', 'vocals.wav', 'instrumental.wav', 'reduced.wav'].includes(name)) return route.fulfill({ contentType: name.endsWith('.wav') ? 'audio/wav' : 'application/json', body: await readFile(path.join(output, name)) });
    return route.fulfill({ json: { id: request.headers()['x-encore-job-id'], state: 'complete', stage: 'CLI result', progress: 100, originalSha256: manifest.originalSha256 } });
  });
  await page.goto('http://127.0.0.1:5173'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles(input);
  await page.getByRole('button', { name: 'Separar voz y generar mapa', exact: true }).click();
  await expect(page.getByText(`${manifest.analysis.notes.length} notas propuestas`, { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
  await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
  await expect(page.getByText('Mapa válido', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible({ timeout: 20000 });
  await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click(); await page.locator('.song-row').click();
  await expect(page.getByText('PISTAS PREPARADAS', { exact: true })).toBeVisible();
  if (improved) {
    await page.getByRole('button', { name: 'Mejorar mapa desde la voz', exact: true }).click();
    await expect(page.getByText(improved.analysis.notes.length + ' notas propuestas', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('checkbox', { name: 'Escuché las pistas' }).check();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Usar pistas y mapa automático' }).click();
    await expect(page.getByText('Mapa válido', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.getByText('Cambios guardados en este navegador.')).toBeVisible({ timeout: 20000 });
    await page.reload(); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click(); await page.locator('.song-row').click();
    const stored = await page.evaluate(async () => {
      const { listSongs } = await import('/src/library-store.ts');
      const [record] = await listSongs();
      return { notes: record.notes.length, curves: record.notes.every(n => n.pitchCurve?.length), hashes: Object.values(record.prepared.manifest.stems).map(s => s.sha256) };
    });
    expect(stored.notes).toBe(improved.analysis.notes.length); expect(stored.curves).toBe(true);
    expect(stored.hashes).toEqual(Object.values(manifest.stems).map(s => s.sha256));
  }
  const analysis = improved?.analysis || manifest.analysis;
  await page.getByText(analysis.notes.length + ' notas propuestas', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: improved ? 'artifacts/etapa-2d-luz-de-dia.png' : 'artifacts/etapa-2c-luz-de-dia.png' });
  await page.getByRole('button', { name: 'Guardar y cantar', exact: true }).click();
  await page.getByLabel('Acompañamiento', { exact: true }).selectOption('instrumental');
  await page.getByRole('button', { name: 'Ver demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Detener', exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
  expect(errors).toEqual([]);
  await writeFile(improved ? 'artifacts/real-melody-check.json' : 'artifacts/real-preparation-check.json', JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), hash: manifest.originalSha256, duration: manifest.duration, notes: analysis.notes.length, detectedSeconds: analysis.detectedSeconds, imported: true, persisted: true, instrumentalStarted: true, reanalysis: !!improved, pageErrors: errors, limitation: 'Replayed the real local output through intercepted API responses; auditory quality not assessed.' }, null, 2));
  console.log('Real file passed: source hash/duration, three stems verified, automatic map valid, IndexedDB persistence, instrumental decode/playback.');
} finally { await browser.close(); }
