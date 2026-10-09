import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticNotes, validateManifest, verifyStem } from '../src/preparation.ts';
import { exportMap, importMap, validateNotes, phrasesOf, MAX_MAP_BYTES } from '../src/library-model.ts';
import { validLocalRequest, terminateProcess } from '../server/preparation.mjs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function wav() {
  const count = 44100, data = Buffer.alloc(44 + count * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(44100, 24); data.writeUInt32LE(176400, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(count * 4, 40); return data;
}
test('automatic notes have no fabricated words, follow LRC phrase boundaries and round-trip', () => {
  const segments = [{ start: 1, duration: .5, midi: 60, confidence: .9 }, { start: 2, duration: .5, midi: 62, confidence: .95 }, { start: 4, duration: .5, midi: 64, confidence: .9 }];
  const lyrics = { raw: '[00:00]Una línea\n[00:03]Otra línea', format: 'lrc', offset: 0 };
  const notes = automaticNotes(segments, lyrics, 8);
  assert.deepEqual(notes.map(n => n.word), ['', '', '']); assert.deepEqual(notes.map(n => n.phrase), [0, 0, 1]);
  assert.deepEqual(phrasesOf(notes), ['Una línea', 'Otra línea']); assert.deepEqual(validateNotes(notes, 8), []);
  const record = { notes, duration: 8, audioHash: '123' };
  const exported = exportMap(record); assert.equal(exported.schemaVersion, 2);
  assert.deepEqual(importMap(JSON.stringify(exported), record), notes);
});
test('largest automatic map exports and imports within the shared UTF-8 budget', () => {
  const notes = Array.from({ length: 2000 }, (_, i) => ({ start: i * .2, duration: .15, midi: 60, confidence: .9, word: '', phrase: 0, phraseLabel: 'ñ'.repeat(1000), source: 'automatic' }));
  const record = { notes, duration: 400, audioHash: 'abc' };
  assert.deepEqual(validateNotes(notes, 400), []);
  const content = JSON.stringify(exportMap(record), null, 2);
  assert.ok(Buffer.byteLength(content) < MAX_MAP_BYTES); assert.equal(importMap(content, record).length, 2000);
  assert.throws(() => importMap('a'.repeat(MAX_MAP_BYTES + 1), record), /12 MB/);
});
test('stem verification checks hash, sample count, and PCM metadata without decoding full audio', async () => {
  const bytes = wav(), descriptor = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, samples: 44100, sampleRate: 44100 };
  await verifyStem(new Blob([bytes]), descriptor);
  await assert.rejects(verifyStem(new Blob([bytes]), { ...descriptor, sha256: '0'.repeat(64) }), /contenido/);
  await assert.rejects(verifyStem(new Blob([bytes]), { ...descriptor, samples: 44200 }), /muestras/);
});
test('manifest rejects another original, shifted audio and uncertain or overlapping notes', () => {
  const hash = 'a'.repeat(64), stem = { sha256: hash, bytes: 176444, sampleRate: 44100, samples: 44100, channels: 2, duration: 1, offsetSamples: 0 };
  const m = { schemaVersion: 1, originalSha256: hash, duration: 1, sampleRate: 44100, samples: 44100, alignment: [{ lagSeconds: 0, correlation: .99 }], reducedVocalGain: .25, sharedGain: .95, stems: Object.fromEntries(['vocals', 'instrumental', 'reduced'].map(name => [name, { ...stem, file: name + '.wav' }])), separator: { model: 'model', version: '1' }, analysis: { notes: [], method: 'pYIN', warning: '', detectedSeconds: 0, analyzedSeconds: 1 } };
  validateManifest(m, hash, 1);
  assert.throws(() => validateManifest(m, 'b'.repeat(64), 1), /otro archivo/);
  assert.throws(() => validateManifest({ ...m, alignment: [{ lagSeconds: .2, correlation: 1 }] }, hash, 1), /alineación/);
  assert.throws(() => validateManifest({ ...m, analysis: { ...m.analysis, notes: [{ start: 0, duration: .5, midi: 60, confidence: .4 }] } }, hash, 1), /notas/);
});
test('preparation API accepts only same-origin local browser requests', () => {
  assert.equal(validLocalRequest({ headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } }), true);
  for (const headers of [{ host: 'localhost:5173', origin: 'https://evil.example' }, { host: 'evil.example' }, { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' }, { host: '127.0.0.1.evil:5173' }]) assert.equal(validLocalRequest({ headers }), false);
});
test('cancelling a worker terminates its child process tree on Windows', { skip: process.platform !== 'win32', timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['-e', "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000);"], { windowsHide: true });
  const [data] = await once(child.stdout, 'data'); const grandchild = Number(data.toString().trim());
  const closed = once(child, 'close'); terminateProcess(child); await closed;
  assert.throws(() => process.kill(grandchild, 0));
});
