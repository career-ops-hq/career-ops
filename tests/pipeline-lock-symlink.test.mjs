// Two writers that open pipeline.md through a symlink to the file must take
// the same lock. Separate lock directories let both write, and one offer is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquirePipelineLock, lockDirFor, withPipelineLock, LockTimeoutError } from '../pipeline-lock.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a symlink to the file shares the pipeline lock with the real path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-symlink-'));
  const real = join(root, 'pipeline.md');
  const link = join(root, 'alias.md');
  try {
    writeFileSync(real, '# Pipeline\n');
    symlinkSync(real, link);
    assert.equal(lockDirFor(link), lockDirFor(real));

    const held = await acquirePipelineLock(link, { timeoutMs: 200, retryMs: 20 });
    try {
      await assert.rejects(
        () => acquirePipelineLock(real, { timeoutMs: 200, retryMs: 20 }),
        (err) => err instanceof LockTimeoutError,
      );
    } finally {
      held.release();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two writers, one through a file symlink, both keep their offer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-symlink-append-'));
  const real = join(root, 'pipeline.md');
  const link = join(root, 'alias.md');
  try {
    writeFileSync(real, '# Pipeline\n');
    symlinkSync(real, link);
    const appendOffer = async (pipelinePath, offer) => {
      await withPipelineLock(pipelinePath, async () => {
        const cur = readFileSync(pipelinePath, 'utf8');
        await sleep(40);
        writeFileSync(pipelinePath, `${cur}${offer}\n`);
      });
    };
    const offers = Array.from({ length: 8 }, (_, i) => `pipeline-offer-${i}`);
    await Promise.all(offers.map((offer, i) => appendOffer(i % 2 === 0 ? real : link, offer)));
    const text = readFileSync(real, 'utf8');
    for (const offer of offers) assert.match(text, new RegExp(offer));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
