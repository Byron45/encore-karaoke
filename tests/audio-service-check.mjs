// Explicit integration check: requires npm run dev and npm run audio:setup.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { validateManifest, verifyStem } from '../src/preparation.ts';
const base = 'http://127.0.0.1:5173/api/preparation';
const bytes = await readFile(new URL('../artifacts/audio-check/original.wav', import.meta.url));
const sha = createHash('sha256').update(bytes).digest('hex');
const status = await (await fetch(base + '/status')).json();
assert.equal(status.ready, true); assert.equal(status.active, null, 'Do not interrupt an existing user job');
const headers = { 'X-Encore-Token': status.token };
assert.equal((await fetch(base + '/status', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
assert.equal((await fetch(base + '/jobs', { method: 'POST', body: bytes })).status, 403);
const post = async id => fetch(base + '/jobs', { method: 'POST', headers: { ...headers, 'X-Encore-Job-Id': id, 'X-Audio-Sha256': sha }, body: bytes });
const ids = [];
const pause = () => new Promise(resolve => setTimeout(resolve, 500));
const leftovers = id => existsSync(new URL(`../.local/audio/jobs/${id}`, import.meta.url));
try {
  const cancelled = randomUUID(); ids.push(cancelled);
  assert.equal((await post(cancelled)).status, 202);
  assert.equal((await post(randomUUID())).status, 409);
  assert.equal((await fetch(`${base}/jobs/${cancelled}`, { method: 'DELETE', headers })).status, 200);
  const deadline = Date.now() + 15000;
  while ((await (await fetch(base + '/status')).json()).active) { assert.ok(Date.now() < deadline, 'Cancellation must release worker'); await pause(); }
  // The killed worker can hold its files for a moment; the folder must still go away.
  while (leftovers(cancelled)) { assert.ok(Date.now() < deadline, 'A cancelled job must not leave temporary files'); await pause(); }
  const id = randomUUID(); ids.push(id); assert.equal((await post(id)).status, 202);
  const until = Date.now() + 180000;
  let job;
  do {
    await pause(); job = await (await fetch(`${base}/jobs/${id}`, { headers })).json();
    assert.notEqual(job.state, 'failed', job.error); assert.ok(Date.now() < until, 'Preparation deadline');
  } while (job.state !== 'complete');
  const manifest = await (await fetch(`${base}/jobs/${id}/manifest.json`, { headers })).json();
  validateManifest(manifest, sha, 8);
  // Two passes: the instrumental from the model trained for it, the voice from the one trained for voices.
  assert.deepEqual(manifest.separator.models, { instrumental: 'UVR-MDX-NET-Inst_HQ_3.onnx', vocals: 'Kim_Vocal_2.onnx' });
  assert.equal(manifest.alignment.length, 3);
  for (const name of ['vocals', 'instrumental', 'reduced']) {
    const response = await fetch(`${base}/jobs/${id}/${name}.wav`, { headers }); assert.equal(response.status, 200);
    await verifyStem(await response.blob(), manifest.stems[name]);
  }
  assert.equal((await fetch(`${base}/jobs/${id}`, { method: 'DELETE', headers })).status, 200);
  assert.equal(leftovers(id), false, 'A discarded result must not leave temporary files');
  await writeFile(new URL('../artifacts/audio-service-check.json', import.meta.url), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), originGuard: true, tokenGuard: true, concurrentGuard: true, cancellation: true, temporaryFilesRemoved: true, completed: true, stemsVerified: 3, duration: manifest.duration, alignment: manifest.alignment }, null, 2));
  console.log('Local API passed: origin/token guards, concurrency, cancellation, actual model, three verified stems.');
} finally {
  for (const id of ids) await fetch(`${base}/jobs/${id}`, { method: 'DELETE', headers });
}
