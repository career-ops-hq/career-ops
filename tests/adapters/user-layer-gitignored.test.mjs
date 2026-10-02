/** Protect candidate input bytes, business facts, evidence, and secrets from staging. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../helpers.mjs';
for (const path of ['inputs/cv.md', 'inputs/profile.yml', 'inputs/documents/cv.pdf',
  'inputs/stories/sessions/interview.md', 'inputs/writing-samples/article.md',
  'data/opportunities.db', 'data/artifacts/report.md', '.env', '.venv/bin/python']) {
  const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: ROOT });
  assert.equal(result.status, 0, `${path} must remain private`);
}
