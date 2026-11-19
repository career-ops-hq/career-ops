import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { parseJob, runWorker } from '../worker.mjs';
import { candidate, modelServer, engineRevision } from './fixtures.mjs';

test('worker rejects caller-selected paths, commands, providers and operations', () => {
  const valid = { operation: 'evaluate', jobId: randomUUID(), postingText: 'Synthetic posting' };
  assert.equal(parseJob(valid), valid);
  for (const fields of [{ workspace: '/other-tenant' }, { command: 'bash' }, { provider: 'https://attacker.invalid' }, { operation: 'submit' }]) {
    assert.throws(() => parseJob({ ...valid, ...fields }), { code: 'invalid_job' });
  }
});

test('JSON worker runs the real evaluator using supervisor-owned workspace and configuration', async t => {
  const root = await candidate(t), mock = await modelServer(t);
  const job = { operation: 'evaluate', jobId: randomUUID(), postingText: 'Example Employer needs a Python engineer.' };
  const output = [];
  const code = await runWorker({ input: Readable.from([JSON.stringify(job)]), write: line => output.push(line), env: {
    HOSTED_WORKSPACE_ROOT: root, HOSTED_ENGINE_REVISION: engineRevision,
    HOSTED_MODEL_BASE_URL: mock.provider.baseUrl, HOSTED_MODEL: mock.provider.model,
    HOSTED_ALLOW_LOCAL_PROVIDER: '1',
  } });
  assert.equal(code, 0);
  assert.equal(output.length, 1);
  const result = JSON.parse(output[0]);
  assert.equal(result.ok, true);
  assert.equal(result.result.company, 'Example Employer');
  assert.equal(mock.requests.length, 1);
});

test('worker limits input and returns sanitized failure envelopes', async () => {
  for (const [data, expected] of [['{bad', 'invalid_job'], ['x'.repeat(256001), 'input_limit']]) {
    const output = [];
    const code = await runWorker({ input: Readable.from([data]), env: {}, write: line => output.push(line) });
    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(output[0]), { ok: false, error: expected });
  }
});
