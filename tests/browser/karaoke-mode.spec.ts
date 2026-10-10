import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';

function wav(seconds: number, amplitude = 1500) {
  const rate = 16000, count = rate * seconds, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 98 * i / rate) * amplitude), 44 + i * 2);
  return bytes;
}
async function importSong(page: Page, seconds: number, notes: { start: number; duration: number; midi: number; word: string; phrase: number }[], options: { lrc?: string; silent?: boolean } = {}) {
  const audio = wav(seconds, options.silent ? 0 : 1500), automatic = notes.some(note => 'source' in note);
  await page.goto('/'); await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByLabel('Archivo de audio').setInputFiles({ name: 'modo.wav', mimeType: 'audio/wav', buffer: audio });
  await page.getByLabel('Archivo del mapa').setInputFiles({ name: 'mapa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: automatic ? 2 : 1, audio: { sha256: createHash('sha256').update(audio).digest('hex'), duration: seconds }, notes })) });
  if (options.lrc) { await page.getByLabel('Formato de letra').selectOption('lrc'); await page.getByLabel('Letra completa', { exact: true }).fill(options.lrc); }
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

test('an automatic map with timed lyrics scores only the sung lines, and what the headphones leak earns nothing', async ({ page }) => {
  const heard = (start: number, duration: number, midi: number, phrase: number) => ({ start, duration, midi, phrase, word: '', source: 'automatic', confidence: .9, phraseLabel: `Sección vocal ${phrase + 1}` });
  // The separated vocal track kept a played introduction and a break; the lyrics say where the voice really is.
  const notes = [heard(.5, 1, 67, 0), heard(1.7, .8, 65, 0), heard(3.6, 1, 60, 1), heard(4.8, 1, 62, 1), heard(6.5, .8, 69, 2), heard(8.1, 1, 64, 3), heard(9.3, 1, 65, 3)];
  // The singer skips the last note; the guide still sounds it and leaks faintly into the microphone.
  await studio(page, { notes: notes.filter((note, i) => [2, 3, 5].includes(i)), bleed: .05 });
  await importSong(page, 12, notes, { lrc: '[00:03.50]Primera línea\n[00:06.20]\n[00:08.00]Segunda línea\n[00:10.60]', silent: true });
  await expect(page.locator('.track-heading')).toContainText('4 notas');
  await expect(page.locator('.track-heading')).toContainText('3 fuera de la letra, sin evaluar');
  await expect(page.locator('.reference-note')).toContainText('Do4');
  await page.getByRole('button', { name: 'Empezar a cantar' }).click();
  await expect(page.locator('.result-panel')).toBeVisible({ timeout: 22000 });
  await expect(page.locator('.phrase-results>div')).toHaveCount(2);
  await expect(page.locator('.phrase-results>div').nth(0)).toContainText('Primera línea');
  await expect(page.locator('.phrase-results>div').nth(1)).toContainText('Segunda línea');
  await expect(page.getByText('captando la música', { exact: false })).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar resultado' }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.reference.noteCount).toBe(4); expect(result.reference.omittedNotes).toBe(3);
  expect(result.reference.chart.split(',')).toHaveLength(4);
  expect(result.capture.speakerBleed).toBe(false);
  expect(result.levelGate).toBeGreaterThanOrEqual(.008);
  expect(result.phrases[0]).toBeGreaterThan(85);
  // Half of the second line was sung. The leaked guide is in the trace, and it did not score.
  expect(result.phrases[1]).toBeGreaterThan(35); expect(result.phrases[1]).toBeLessThan(62);
  const times = result.capture.trace.times.split(',').map(Number), pitch = result.capture.trace.pitch.split(',').map(Number);
  expect(pitch.filter((value: number, i: number) => times[i] > 9450 && times[i] < 10250 && Math.round(value / 100) === 65).length).toBeGreaterThan(10);
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

  // The take can be reviewed phrase by phrase: the voice drawn over the notes it was scored against.
  await expect(page.locator('.phrase-review')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver trazo' }).first().click();
  const review = page.locator('.phrase-review');
  await expect(review.locator('rect')).toHaveCount(1);
  expect(await review.locator('circle').count()).toBeGreaterThan(30);
  expect(await review.locator('circle[fill="#c4f26b"]').count()).toBeGreaterThan(30);
  await expect(review).toContainText('de las lecturas en la nota');
  await page.getByRole('button', { name: 'Ver trazo' }).click();
  await expect(page.locator('.phrase-review')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ocultar trazo' }).click();
  await expect(page.locator('.phrase-review')).toHaveCount(0);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar resultado' }).click();
  const stream = await (await downloading).createReadStream(), chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString());
  expect(result.capture.readings).toBeUndefined();
  const pitch = result.capture.trace.pitch.split(',').map(Number);
  expect(result.capture.trace.times.split(',')).toHaveLength(pitch.length);
  // Do4 and Mi4 were sung, and nothing else.
  expect(new Set(pitch.filter((value: number) => value).map((value: number) => Math.round(value / 100)))).toEqual(new Set([60, 64]));
});
