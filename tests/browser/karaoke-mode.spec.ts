import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';

function wav(seconds: number) {
  const rate = 16000, count = rate * seconds, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 98 * i / rate) * 1500), 44 + i * 2);
  return bytes;
}
async function importSong(page: Page, seconds: number, notes: { start: number; duration: number; midi: number; word: string; phrase: number }[]) {
  const audio = wav(seconds);
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles({ name: 'modo.wav', mimeType: 'audio/wav', buffer: audio });
  await page.getByLabel('Archivo del mapa').setInputFiles({ name: 'mapa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, audio: { sha256: createHash('sha256').update(audio).digest('hex'), duration: seconds }, notes })) });
  await page.getByRole('button', { name: 'Guardar y cantar' }).click();
  await expect(page.locator('.track-heading h2')).toHaveText('modo');
}
const points = async (page: Page) => Number((await page.locator('.score-number').innerText()).split('/')[0].replace(/\D/g, ''));

/** A microphone built inside the app's own audio context, so the test can sing on the song clock and loop the speakers back. */
async function studio(page: Page, options: { notes?: { start: number; duration: number; midi: number }[]; lateMs?: number; bleed?: number }) {
  await page.addInitScript(options => {
    const Native = window.AudioContext, contexts: AudioContext[] = [];
    (window as any).AudioContext = class extends Native { constructor(...args: any[]) { super(...args); contexts.push(this); } };
    const connect = AudioNode.prototype.connect as any, start = OscillatorNode.prototype.start;
    let app: AudioContext | null = null, mic: MediaStreamAudioDestinationNode | null = null, loop: GainNode | null = null, origin: number | null = null;
    (AudioNode.prototype as any).connect = function (target: any, ...rest: any[]) {
      const result = connect.call(this, target, ...rest);
      if (loop && app && target === app.destination) connect.call(this, loop);
      return result;
    };
    OscillatorNode.prototype.start = function (when?: number) {
      // The first count-in click is scheduled 2.97 s before the song starts.
      if (app && this.context === app && origin === null && Math.abs(this.frequency.value - 720) < 1) {
        origin = when! + 2.97;
        if (options.notes) {
          const voice = app.createOscillator(), gain = app.createGain(); gain.gain.setValueAtTime(0, app.currentTime);
          for (const note of options.notes) {
            const at = origin + note.start + (options.lateMs || 0) / 1000;
            voice.frequency.setValueAtTime(440 * 2 ** ((note.midi - 69) / 12), at);
            gain.gain.setValueAtTime(.15, at); gain.gain.setValueAtTime(0, at + note.duration);
          }
          connect.call(voice, gain); connect.call(gain, mic); start.call(voice);
        }
      }
      return start.call(this, when);
    };
    navigator.mediaDevices.getUserMedia = async () => {
      app = contexts.at(-1)!; origin = null; mic = app.createMediaStreamDestination();
      if (options.bleed) { loop = app.createGain(); loop.gain.value = options.bleed; connect.call(loop, mic); }
      return mic.stream;
    };
  }, options);
}

test('any octave counts under Normal; Estricta keeps the octave and says how to change it', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const oscillator = context.createOscillator(), gain = context.createGain(), dest = context.createMediaStreamDestination();
      oscillator.frequency.value = 130.8127826; gain.gain.value = .15; // Do3, an octave under the map
      oscillator.connect(gain).connect(dest); oscillator.start();
      return dest.stream;
    };
  });
  await importSong(page, 4, [{ start: .3, duration: 1.2, midi: 60, word: 'Hola', phrase: 0 }, { start: 2, duration: 1.5, midi: 60, word: 'voz', phrase: 1 }]);
  await expect(page.getByRole('combobox', { name: 'Exigencia de afinación' })).toHaveValue('normal');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 13000 });
  expect(await points(page)).toBeGreaterThan(8500);
  await expect(page.locator('.result-heading h2')).not.toContainText('octava');
  await expect(page.locator('.result-diagnostics')).toContainText('Exigencia: Normal');
  await page.getByRole('combobox', { name: 'Exigencia de afinación' }).selectOption('strict');
  await page.getByRole('button', { name: 'Volver a cantar' }).click();
  await expect(page.locator('.result-diagnostics')).toContainText('Exigencia: Estricta', { timeout: 13000 });
  expect(await points(page)).toBe(0);
  await expect(page.locator('.result-heading h2')).toHaveText('Tu tono estuvo en otra octava del mapa.');
  await expect(page.locator('.result-panel')).toContainText('Normal o Relajada');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Exigencia de afinación' })).toHaveValue('strict');
});

test('a late voice gets a delay proposal that is applied and remembered for that microphone', async ({ page }) => {
  const notes = Array.from({ length: 10 }, (_, i) => ({ start: .5 + i * .5, duration: .3, midi: 60 + [0, 4, 7, 4, 2][i % 5], word: 'la', phrase: Math.floor(i / 5) }));
  await studio(page, { notes, lateMs: 160 });
  await importSong(page, 6, notes);
  await expect(page.locator('.offset-control label')).toContainText('Automático');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 15000 });
  const late = await points(page);
  await expect(page.locator('.result-diagnostics')).toContainText('(automática)');
  const proposal = page.getByRole('button', { name: /^Usar \d+ ms$/ });
  await expect(proposal).toBeVisible();
  const delay = Number((await proposal.innerText()).replace(/\D/g, ''));
  expect(delay).toBeGreaterThanOrEqual(140); expect(delay).toBeLessThanOrEqual(220);
  await proposal.click();
  await expect(page.getByRole('button', { name: 'Ajuste guardado' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Compensar retraso' })).toHaveValue(String(delay));
  await page.getByRole('button', { name: 'Volver a cantar' }).click();
  await expect(page.locator('.result-diagnostics')).toContainText(`Compensación: ${delay} ms ·`, { timeout: 15000 });
  expect(await points(page)).toBeGreaterThan(Math.max(8500, late + 1500));
  await expect(proposal).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('slider', { name: 'Compensar retraso' })).toHaveValue(String(delay));
  await page.getByRole('button', { name: 'Volver a automático' }).click();
  await expect(page.locator('.offset-control label')).toContainText('Automático');
});

test('speakers leaking into the microphone are announced while singing and named in the result', async ({ page }) => {
  await studio(page, { bleed: 1 });
  await importSong(page, 4, [{ start: .3, duration: 1.2, midi: 72, word: 'Hola', phrase: 0 }, { start: 2, duration: 1.5, midi: 76, word: 'voz', phrase: 1 }]);
  // Only the recording leaks: the guide would hand the right notes to the microphone.
  await page.getByText('Escuchar melodía guía').click();
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.getByText('Tu micrófono está captando la música de los altavoces.', { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 13000 });
  await expect(page.locator('.result-heading h2')).toHaveText('El micrófono captó la música de los altavoces.');
  await expect(page.getByRole('button', { name: /^Usar \d+ ms$/ })).toHaveCount(0);
});

test('with headphones nothing is announced and the count-in stays out of the score', async ({ page }) => {
  const notes = [{ start: .3, duration: 1.2, midi: 60, word: 'Hola', phrase: 0 }, { start: 2, duration: 1.5, midi: 64, word: 'voz', phrase: 1 }];
  await studio(page, { notes });
  await importSong(page, 4, notes);
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 13000 });
  await expect(page.getByText('captando la música', { exact: false })).toHaveCount(0);
  await expect(page.locator('.result-heading h2')).toHaveText('Cada intento cuenta.');
  expect(await points(page)).toBeGreaterThan(8500);
});
