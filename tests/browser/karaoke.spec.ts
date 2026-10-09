import { test, expect } from '@playwright/test';

test('demo completes with an explicitly simulated result and export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new Error('Demo must not request a microphone'); };
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Este es tu escenario.' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/etapa-1-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Ver demo', exact: true }).click();
  await expect(page.getByText('Demostración con voz simulada.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empezar a cantar' })).toBeDisabled();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 42000 });
  await expect(page.getByRole('heading', { name: 'Ahora te toca a ti.' })).toBeFocused();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar resultado' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('encore-demo-resultado.json');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.simulated).toBe(true);
  expect(data.score).toBeGreaterThan(9000);
  expect(data.score).toBeLessThanOrEqual(10000);
  expect(errors).toEqual([]);
});

test('stop and restart resets score and countdown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver demo', exact: true }).click();
  await expect(page.locator('.word-active')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Detener' }).click();
  await expect(page.locator('.score-number')).toContainText('0');
  await expect(page.getByRole('button', { name: 'Empezar a cantar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Ver demo', exact: true }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  await page.getByRole('button', { name: 'Detener' }).click();
});

test('microphone permission rejection produces useful recovery', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied in test', 'NotAllowedError'); }; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.getByRole('alert')).toContainText('Habilita el permiso');
  await expect(page.getByRole('button', { name: 'Ver demo', exact: true })).toBeEnabled();
});

test('cancel pending permission stops a late microphone stream', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      (window as any).resolveMic = () => {
        const context = new AudioContext();
        const dest = context.createMediaStreamDestination();
        (window as any).micTest = { context, stream: dest.stream };
        resolve(dest.stream);
      };
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.getByRole('button', { name: 'Preparando…' })).toBeVisible();
  await page.getByRole('button', { name: 'Detener' }).click();
  await page.evaluate(() => (window as any).resolveMic());
  await expect.poll(() => page.evaluate(() => (window as any).micTest.stream.getTracks()[0].readyState)).toBe('ended');
  await page.evaluate(() => (window as any).micTest.context.close());
});

test('real AudioWorklet processes a synthetic 440 Hz stream and releases microphone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const dest = context.createMediaStreamDestination();
      oscillator.frequency.value = 440; gain.gain.value = 0.2;
      oscillator.connect(gain).connect(dest); oscillator.start();
      (window as any).micTest = { context, oscillator, stream: dest.stream };
      return dest.stream;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.getByText('Tu voz: La4', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Baja un poco el tono', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.score-number')).toHaveText('0 / 10.000');
  await page.getByRole('button', { name: 'Detener' }).click();
  expect(await page.evaluate(() => (window as any).micTest.stream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => { (window as any).micTest.oscillator.stop(); return (window as any).micTest.context.close(); });
  expect(errors).toEqual([]);
});

test('mobile layout and roadmap are usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/etapa-1-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Empezar a cantar' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Empezar a cantar' })).toBeVisible();
  await page.getByRole('button', { name: 'Nuestro proyecto', exact: true }).click();
  await expect(page.locator('.roadmap-row')).toHaveCount(6);
  await expect(page.getByText('MusicBrainz tiene un lugar aquí.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('300 ms compensation compares voice feedback with captured note, not next lyric', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator();
      const dest = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565;
      oscillator.connect(dest); oscillator.start();
      (window as any).micTest = { context, oscillator };
      return dest.stream;
    };
  });
  await page.goto('/');
  await page.getByRole('slider').fill('300');
  // Observe complete React commits instead of polling across a 150 ms note transition.
  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.stage')!;
    (window as any).offsetSamples = [];
    const observer = new MutationObserver(() => {
      (window as any).offsetSamples.push({
        playback: Number(stage.dataset.playbackTime),
        capture: Number(stage.dataset.captureTime),
        word: stage.querySelector('.word-active')?.textContent?.trim(),
        feedback: stage.querySelector('.stage-feedback')?.textContent,
      });
    });
    observer.observe(stage, { attributes: true, attributeFilter: ['data-playback-time', 'data-capture-time'] });
    (window as any).offsetObserver = observer;
  });
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect.poll(() => page.evaluate(() => Number(document.querySelector<HTMLElement>('.stage')?.dataset.playbackTime)), { timeout: 10000 }).toBeGreaterThan(2);
  const samples = await page.evaluate(() => (window as any).offsetSamples) as { playback: number; capture: number; word: string; feedback: string }[];
  const transition = samples.filter(sample => sample.playback >= 1 && sample.capture >= 0.6 && sample.capture < 0.85);
  expect(transition.length).toBeGreaterThan(0);
  for (const sample of transition) {
    expect(sample.word).toBe('mi');
    expect(sample.feedback).toContain('¡En la nota!');
  }
  const nextNote = samples.filter(sample => sample.capture >= 1.1 && sample.capture < 1.7);
  expect(nextNote.length).toBeGreaterThan(0);
  for (const sample of nextNote) expect(sample.feedback).toContain('Sube un poco el tono');
  await page.getByRole('button', { name: 'Detener' }).click();
  await page.evaluate(() => { (window as any).offsetObserver.disconnect(); (window as any).micTest.oscillator.stop(); return (window as any).micTest.context.close(); });
});
