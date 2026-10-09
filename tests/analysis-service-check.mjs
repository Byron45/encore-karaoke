// Explicit model/API integration test, using self-contained synthetic vocals.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, readdir } from 'node:fs/promises';
import { validPitchCurve } from '../src/pitch-reference.ts';
const rate = 44100, duration = 8, data = Buffer.alloc(44 + rate * duration * 4);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
const notes = [[1, 2, 57], [2.3, 3.3, 60], [4, 5, 62], [5.3, 6.5, 60]];
for (let i = 0; i < rate * duration; i++) {
  const t = i / rate, note = notes.find(([a, b]) => t >= a && t < b);
  if (!note) continue;
  const [a, b, midi] = note, u = t - a, phase = 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * u;
  const value = Math.round(32767 * .18 * Math.min(1, u / .04) * Math.min(1, (b - t) / .08) * (Math.sin(phase) + .5 * Math.sin(2 * phase)));
  data.writeInt16LE(value, 44 + i * 4); data.writeInt16LE(value, 46 + i * 4);
}
const base = 'http://127.0.0.1:5173/api/preparation';
const status = await (await fetch(base + '/status')).json(); assert.equal(status.ready, true); assert.equal(status.active, null, 'Do not interrupt an existing job');
const hash = createHash('sha256').update(data).digest('hex'), id = randomUUID(), headers = { 'X-Encore-Token': status.token };
try {
  const response = await fetch(base + '/analysis', { method: 'POST', headers: { ...headers, 'X-Encore-Job-Id': id, 'X-Audio-Sha256': hash }, body: data });
  assert.equal(response.status, 202);
  const deadline = Date.now() + 120000;
  let job;
  do {
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await (await fetch(`${base}/jobs/${id}`, { headers })).json();
    assert.notEqual(job.state, 'failed', job.error); assert.ok(Date.now() < deadline);
  } while (job.state !== 'complete');
  const result = await (await fetch(`${base}/jobs/${id}/analysis.json`, { headers })).json();
  assert.equal(result.sourceSha256, hash); assert.equal(result.analysis.version, 'encore-melody-2');
  assert.deepEqual(result.analysis.notes.map(n => n.midi), [57, 60, 62, 60]);
  for (const n of result.analysis.notes) assert.equal(validPitchCurve(n.pitchCurve, n.duration), true);
  assert.deepEqual(await readdir(`.local/audio/jobs/${id}/result`), ['analysis.json']);
  await writeFile('artifacts/analysis-service-check.json', JSON.stringify({ passed: true, at: new Date().toISOString(), hash, notes: result.analysis.notes.length, detectedSeconds: result.analysis.detectedSeconds, noSeparationRerun: true, curvesValidated: true }, null, 2));
  console.log('Analysis API passed: same vocal hash, four correct notes, continuous curves, no stem separation.');
} finally { await fetch(`${base}/jobs/${id}`, { method: 'DELETE', headers }); }
