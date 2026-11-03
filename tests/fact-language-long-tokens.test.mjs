import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pass, fail } from './helpers.mjs';

for (const suffix of ['', '.']) {
  const label = `fact verification finishes for a long non-address token${suffix ? ' ending in a period' : ''}`;
  try {
    const code = `
      import assert from 'node:assert/strict';
      import { verifyFacts } from './verify-cv-facts.mjs';
      const result = verifyFacts('- Built it using K' + 'x'.repeat(200000) + ${JSON.stringify(suffix)}, { sourcePaths: [], configPath: '/nonexistent-local-fixture' });
      assert.equal(result.verdict, 'block');
      assert.ok(result.unsupportedFacts.some(claim => claim.kind === 'tool'));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    pass(label);
  } catch (error) { fail(`${label}: ${error.message}`); }
}
