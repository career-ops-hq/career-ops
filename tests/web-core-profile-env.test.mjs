import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!fs.existsSync(path.join(checkout, 'web', 'src'))) {
  test('web core profile boundary', { skip: 'web/ not installed' }, () => {});
} else {
  await import('../web/tests/helpers/web-ts-alias-loader.mjs');
  const { GET } = await import('../web/src/app/api/followups/route.ts');
  const { runCoreCli } = await import('../web/src/lib/core-cli.ts');
  const profilePaths = await import('../web/src/lib/core/profile-path.mjs');

  async function fixture(override, fn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-core-profile-'));
    const name = `.profile-env-${path.basename(root)}`;
    const codeDir = path.join(checkout, name);
    const relative = path.join(name, 'candidate.yml');
    const keys = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_CODE_ROOT', 'CAREER_OPS_PROFILE'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    assert.equal(fs.existsSync(codeDir), false);
    try {
      for (const dir of [codeDir, path.join(root, name), path.join(root, 'config')]) fs.mkdirSync(dir, { recursive: true });
      const chosen = 'follow_ups:\n  enabled: false\nfollowup_cadence:\n  applied_first_days: 19\n';
      fs.writeFileSync(path.join(root, relative), chosen);
      fs.writeFileSync(path.join(root, 'config/profile.yml'), chosen);
      fs.writeFileSync(path.join(checkout, relative), 'follow_ups:\n  enabled: true\nfollowup_cadence:\n  applied_first_days: 3\n');
      process.env.CAREER_OPS_ROOT = root;
      delete process.env.CAREER_OPS_DATA_DIR;
      process.env.CAREER_OPS_CODE_ROOT = checkout;
      const value = override === 'absolute' ? path.join(root, relative) : override === 'relative' ? `  ${relative}  ` : override;
      if (value === undefined) delete process.env.CAREER_OPS_PROFILE;
      else process.env.CAREER_OPS_PROFILE = value;
      await fn(root, relative);
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      fs.rmSync(codeDir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  for (const override of ['relative', 'absolute', '', ' \t ', undefined]) {
    test(`follow-ups endpoint reads the web-selected profile (${JSON.stringify(override)})`, async () => {
      await fixture(override, async () => {
        const response = await GET(new Request('http://localhost/api/followups?full=1'));
        const body = await response.json();
        assert.equal(body.available, true);
        assert.equal(body.cadenceConfig.applied_first, 19);
        assert.equal(body.followupsEnabled, false);
      });
    });
  }

  test('core CLI mutations/readers get the same relative profile as the web', async () => {
    await fixture('relative', async () => {
      const result = await runCoreCli('followup-cadence', ['--json']);
      assert.equal(result.code, 0, result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.cadenceConfig.applied_first, 19);
      assert.equal(body.followupsEnabled, false);
    });
  });

  test('profile environment preserves caller overrides without mutating the inherited environment', () => {
    const env = { CAREER_OPS_PROFILE: '  profiles/person.yml ', CAREER_OPS_PORTALS: '/specific/portals.yml', CUSTOM_VALUE: 'kept' };
    const before = { ...env };
    assert.equal(typeof profilePaths.coreProfileEnv, 'function');
    const child = profilePaths.coreProfileEnv(path.resolve('/data'), env);
    assert.equal(child.CAREER_OPS_PROFILE, path.resolve('/data/profiles/person.yml'));
    assert.equal(child.CAREER_OPS_PORTALS, env.CAREER_OPS_PORTALS);
    assert.equal(child.CUSTOM_VALUE, 'kept');
    assert.deepEqual(env, before);
    assert.equal(profilePaths.getProfilePath(path.resolve('/data'), { explicitRoot: true, env }), path.resolve('/data/config/profile.yml'));
  });
}
