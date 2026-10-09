import { test, expect } from '@playwright/test';

test('partial result explains coverage, exports the displayed feedback and fits mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // Controlled evaluation fixture: checks presentation/export, not microphone hardware.
  await page.evaluate(async () => {
    // Use Vite's loaded URL, including its HMR timestamp, to patch the same module instance as App.
    const audioPath = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/audio.ts')!.name;
    const songPath = '/src/song.ts', scorePath = '/src/scoring.ts';
    const { KaraokeEngine } = await import(audioPath);
    const { song, frequencyOf } = await import(songPath);
    const { ScoreTracker } = await import(scorePath);
    KaraokeEngine.prototype.start = async function (_mode: any, _guide: any, _offset: any, _frame: any, finish: any) {
      const tracker = new ScoreTracker(song.notes);
      for (let tick = 1; tick <= song.duration * 100; tick++) {
        const at = tick / 100;
        const note = song.notes.find((n: any) => at > n.start && at <= n.start + n.duration);
        const voiced = note && at - note.start < note.duration * .4;
        tracker.sample(at, .01, voiced ? frequencyOf(note.midi + .8375) : null);
      }
      finish(tracker.summary(song.duration));
    };
  });
  await page.getByRole('button', { name: 'Empezar a cantar', exact: true }).click();
  await expect(page.locator('.result-heading h2')).toHaveText('Se detectó tono en parte de la referencia.');
  await expect(page.locator('.result-panel')).not.toContainText('El cero');
  await expect(page.locator('.phrase-results small').first()).toContainText('Afinación 25%');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar resultado' }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.score).toBeGreaterThan(800); expect(result.score).toBeLessThan(1200);
  expect(result.feedback.title).toBe(await page.locator('.result-heading h2').innerText());
  expect(result.phraseDiagnostics).toHaveLength(4);
  await page.locator('.result-panel').screenshot({ path: 'artifacts/etapa-2e-cobertura-parcial.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.result-panel').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.result-panel').screenshot({ path: 'artifacts/etapa-2e-cobertura-movil.png' });
  expect(errors).toEqual([]);
});
