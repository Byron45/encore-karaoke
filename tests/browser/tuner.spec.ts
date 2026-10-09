import { test, expect } from '@playwright/test';

test('live tuner shows signed cents and Hz, rejects silence and follows capture offset', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), gain = context.createGain(), dest = context.createMediaStreamDestination();
      oscillator.frequency.value = 261.625565 * 2 ** (.5 / 12); gain.gain.value = .15;
      oscillator.connect(gain).connect(dest); oscillator.start();
      (window as any).tunerMic = { oscillator, gain, context }; return dest.stream;
    };
  });
  await page.goto('/'); await page.getByRole('slider', { name: 'Compensar retraso' }).fill('300');
  // Half a semitone only counts as off pitch under the tuner-like rule.
  await page.getByRole('combobox', { name: 'Exigencia de afinación' }).selectOption('strict');
  await page.getByRole('button', { name: 'Empezar a cantar', exact: true }).click();
  const meter = page.getByRole('meter', { name: 'Desviación de afinación' });
  await expect(meter).toBeVisible({ timeout: 7000 });
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(45);
  await expect(page.getByLabel('Afinador en vivo')).toContainText('Hz');
  await expect(page.locator('.stage-feedback')).toContainText('Baja un poco el tono');
  await page.screenshot({ path: 'artifacts/etapa-2d-afinador.png' });
  await page.evaluate(() => { (window as any).tunerMic.gain.gain.value = 0; });
  await expect(page.getByLabel('Afinador en vivo')).toContainText('Esperando tono claro');
  await expect(meter).toHaveCount(0);
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
  await page.evaluate(() => { (window as any).tunerMic.oscillator.stop(); return (window as any).tunerMic.context.close(); });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
