import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pass, fail } from './helpers.mjs';

const cli = fileURLToPath(new URL('../agent-inbox.mjs', import.meta.url));

for (const variable of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) {
  for (const action of ['add', 'list', 'resolve']) {
    const label = `${action} uses ${variable} instead of the caller's unrelated inbox`;
    const fixture = mkdtempSync(join(tmpdir(), 'inbox-root-'));
    try {
      const root = join(fixture, 'workspace');
      const cwd = join(fixture, 'elsewhere');
      for (const dir of [root, cwd]) mkdirSync(join(dir, 'data'), { recursive: true });
      const selected = join(root, 'data/agent-inbox.md');
      const decoy = join(cwd, 'data/agent-inbox.md');
      const original = '# Agent Inbox\n\n- [ ] 2026-01-01 12:00 — selected request\n';
      const unrelated = '# Agent Inbox\n\n- [ ] 2026-01-01 12:00 — unrelated request\n';
      writeFileSync(selected, original);
      writeFileSync(decoy, unrelated);
      const args = action === 'add' ? ['add', 'new request']
        : action === 'resolve' ? ['resolve', '1', '--result', 'reviewed'] : ['list'];
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd, encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', CAREER_OPS_INBOX: '', [variable]: root },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      if (action === 'add') assert.match(readFileSync(selected, 'utf8'), /new request/);
      if (action === 'list') {
        assert.match(result.stdout, /selected request/);
        assert.doesNotMatch(result.stdout, /unrelated request/);
      }
      if (action === 'resolve') assert.match(readFileSync(selected, 'utf8'), /- \[x\].*selected request → result: reviewed/);
      assert.equal(readFileSync(decoy, 'utf8'), unrelated);
      pass(label);
    } catch (error) { fail(`${label}: ${error.message}`); }
    finally { rmSync(fixture, { recursive: true, force: true }); }
  }
}

{
  const label = 'first add protects the selected workspace inbox without changing the caller gitignore';
  const fixture = mkdtempSync(join(tmpdir(), 'inbox-root-ignore-'));
  try {
    const root = join(fixture, 'workspace');
    const cwd = join(fixture, 'elsewhere');
    for (const dir of [root, cwd]) {
      mkdirSync(dir);
      writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    }
    const result = spawnSync(process.execPath, [cli, 'add', 'private request'], {
      cwd, encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_INBOX: '' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^data\/agent-inbox\.md$/m);
    assert.equal(readFileSync(join(cwd, '.gitignore'), 'utf8'), 'node_modules\n');
    assert.ok(existsSync(join(root, 'data/agent-inbox.md')));
    assert.ok(!existsSync(join(cwd, 'data/agent-inbox.md')));
    pass(label);
  } catch (error) { fail(`${label}: ${error.message}`); }
  finally { rmSync(fixture, { recursive: true, force: true }); }
}
