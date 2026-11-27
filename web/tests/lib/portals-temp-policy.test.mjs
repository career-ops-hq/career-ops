import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as yaml from 'js-yaml';
import '../helpers/web-ts-alias-loader.mjs';

// /api/explore starts from DEFAULT_FILTERS, so a Discover with no chips is a real
// request. With a saved workplace_policy it must still write a scan config that
// carries the policy, not throw on an empty YAML document.
test('writeTempPortals keeps the saved workplace policy when every chip list is empty', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-portals-policy-'));
  const saved = { ...process.env };
  const policy = { mode: 'conditional', rules: [{ countries: ['Spain'] }] };
  let file;
  try {
    for (const key of Object.keys(process.env)) if (key.startsWith('CAREER_OPS_')) delete process.env[key];
    process.env.CAREER_OPS_ROOT = root;
    fs.writeFileSync(path.join(root, 'portals.yml'), yaml.dump({ location_filter: { workplace_policy: policy } }));
    const { writeTempPortals } = await import('../../src/lib/core/portals.ts');
    file = writeTempPortals({ positive: [], negative: [], allow: [], block: [], alwaysAllow: [], blockHard: [] });
    assert.deepEqual(yaml.load(fs.readFileSync(file, 'utf8')), { location_filter: { workplace_policy: policy } });
  } finally {
    process.env = saved;
    if (file) fs.rmSync(file, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
