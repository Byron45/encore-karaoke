import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function mockInputs(page: Page, followChart = false) {
  await page.addInitScript(({ followChart }) => {
    const state = { devices: [{ id: 'laptop', label: 'Micrófono de laptop' }, { id: 'usb', label: 'Micrófono USB' }, { id: 'headset', label: 'Micrófono de audífonos' }], streams: [] as MediaStream[], contexts: [] as AudioContext[], requests: [] as string[], followChart };
    (window as any).inputs = state;
    navigator.mediaDevices.enumerateDevices = async () => state.devices.map(device => ({ kind: 'audioinput', deviceId: device.id, groupId: device.id, label: device.label, toJSON: () => ({}) })) as MediaDeviceInfo[];
    navigator.mediaDevices.getUserMedia = async constraints => {
      const audio = constraints?.audio as MediaTrackConstraints;
      const id = (audio.deviceId as ConstrainDOMStringParameters)?.exact as string || 'laptop';
      state.requests.push(id);
      const device = state.devices.find(device => device.id === id);
      if (!device) throw new DOMException('Missing selected device', 'OverconstrainedError');
      const context = new AudioContext(); await context.resume(); state.contexts.push(context);
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = 261.625565;
      gain.gain.value = id === 'laptop' ? 0 : 0.15;
      oscillator.connect(gain).connect(destination); oscillator.start();
      if (state.followChart) {
        const words = [[60, 62, 64, 64, 62, 60], [60, 64, 67, 67, 65, 64], [62, 64, 65, 67, 65, 64], [64, 62, 60, 62, 59, 60]];
        const origin = context.currentTime + 3.1;
        gain.gain.setValueAtTime(0, context.currentTime);
        words.forEach((phrase, p) => phrase.forEach((midi, i) => {
          const start = origin + p * 8 + i;
          oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), start);
          gain.gain.setValueAtTime(0.15, start);
          gain.gain.setValueAtTime(0, start + (i === 5 ? 2 : 0.85));
        }));
      }
      const track = destination.stream.getAudioTracks()[0];
      Object.defineProperty(track, 'label', { value: device.label });
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId: id });
      state.streams.push(destination.stream);
      return destination.stream;
    };
  }, { followChart });
}

test('select USB, test pitch without score, change microphone and persist selection', async ({ page }) => {
  await mockInputs(page); await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Micrófono', exact: true })).toContainText('Micrófono USB');
  await page.getByRole('combobox', { name: 'Micrófono', exact: true }).selectOption('usb');
  await page.getByRole('button', { name: 'Probar micrófono', exact: true }).click();
  await expect(page.locator('.active-device')).toContainText('Micrófono USB');
  await expect(page.locator('.input-diagnostic')).toContainText('Do4');
  await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', /[1-9][0-9]?|100/);
  await expect(page.locator('.score-number')).toHaveText('0 / 10.000');
  expect(await page.evaluate(() => (window as any).inputs.requests)).toEqual(['usb']);
  await page.getByRole('combobox', { name: 'Micrófono', exact: true }).selectOption('headset');
  expect(await page.evaluate(() => (window as any).inputs.streams[0].getAudioTracks()[0].readyState)).toBe('ended');
  await expect(page.getByRole('button', { name: 'Probar micrófono', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Micrófono', exact: true })).toHaveValue('headset');
});

test('silent laptop is diagnosed in preflight and stop releases it', async ({ page }) => {
  await mockInputs(page); await page.goto('/');
  await page.getByRole('combobox', { name: 'Micrófono', exact: true }).selectOption('laptop');
  await page.getByRole('button', { name: 'Probar micrófono', exact: true }).click();
  await expect(page.locator('.input-diagnostic')).toContainText('Señal baja o silencio');
  await expect(page.locator('.active-device')).toContainText('Micrófono de laptop');
  await page.getByRole('button', { name: 'Detener prueba', exact: true }).click();
  expect(await page.evaluate(() => (window as any).inputs.streams[0].getAudioTracks()[0].readyState)).toBe('ended');
});

test('removed selected device is not silently replaced by laptop', async ({ page }) => {
  await mockInputs(page); await page.goto('/');
  await page.getByRole('combobox', { name: 'Micrófono', exact: true }).selectOption('usb');
  await page.evaluate(() => { (window as any).inputs.devices = (window as any).inputs.devices.filter((d: any) => d.id !== 'usb'); navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  await expect(page.locator('.mic-warning')).toContainText('no aparece');
  await page.getByRole('button', { name: 'Probar micrófono', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('micrófono elegido no está disponible');
  expect(await page.evaluate(() => (window as any).inputs.requests)).toEqual(['usb']);
});

test('preflight to song reopens the selected input and correct live notes earn points', async ({ page }) => {
  await mockInputs(page); await page.goto('/');
  await page.getByRole('combobox', { name: 'Micrófono', exact: true }).selectOption('usb');
  await page.getByRole('button', { name: 'Probar micrófono', exact: true }).click();
  await expect(page.locator('.input-diagnostic')).toContainText('Do4');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.word-active')).toHaveText('Hoy ', { timeout: 9000 });
  await expect.poll(async () => Number((await page.locator('.score-number').innerText()).split('/')[0].replace(/\D/g, ''))).toBeGreaterThan(20);
  expect(await page.evaluate(() => (window as any).inputs.requests)).toEqual(['usb', 'usb']);
  expect(await page.evaluate(() => (window as any).inputs.streams[0].getAudioTracks()[0].readyState)).toBe('ended');
  await expect(page.getByRole('combobox', { name: 'Micrófono', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
});

test('full synthetic singing through the microphone pipeline gives nonzero per-phrase results', async ({ page }) => {
  await mockInputs(page, true); await page.goto('/');
  await page.getByRole('combobox', { name: 'Micrófono', exact: true }).selectOption('usb');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 42000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar resultado' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.simulated).toBe(false); // The app used microphone mode; test input is synthetic.
  expect(result.microphone.label).toBe('Micrófono USB');
  expect(result.score).toBeGreaterThan(7500);
  expect(result.phrases.every((accuracy: number) => accuracy > 60)).toBe(true);
  expect(result.analyzedCoverage).toBeGreaterThan(95);
  expect(result.coverage).toBeGreaterThan(80);
  expect(result.version).toBe(3);
  expect(result.phraseDiagnostics).toHaveLength(result.phrases.length);
  expect(result.phraseDiagnostics.every((phrase: any) => phrase.analyzedSeconds > 0 && phrase.sungSeconds > 0 && phrase.intonation > 60)).toBe(true);
  expect(await page.locator('.result-heading h2').innerText()).toBe(result.feedback.title);
  await expect(page.locator('.phrase-results small').first()).toContainText('Cobertura');
  await expect(page.getByText('El promedio firmado puede compensar', { exact: false })).toBeVisible();
  await page.locator('.result-panel').screenshot({ path: 'artifacts/etapa-2e-diagnostico.png' });
  expect(await page.evaluate(() => (window as any).inputs.streams.every((s: MediaStream) => s.getAudioTracks()[0].readyState === 'ended'))).toBe(true);
});

test('grave register shifts the guide frequency and expected note together', async ({ page }) => {
  await mockInputs(page);
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    (window as any).guideFrequencies = [];
    AudioContext.prototype.createOscillator = function () {
      const oscillator = original.call(this);
      const start = oscillator.start.bind(oscillator);
      oscillator.start = when => { if (oscillator.type === 'triangle') (window as any).guideFrequencies.push(oscillator.frequency.value); start(when); };
      return oscillator;
    };
  });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Registro de práctica' }).selectOption('-12');
  await expect(page.locator('.reference-note')).toContainText('Do3');
  await page.getByRole('button', { name: 'Ver demo', exact: true }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  expect(await page.evaluate(() => (window as any).guideFrequencies[0])).toBeCloseTo(130.81, 1);
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
});
