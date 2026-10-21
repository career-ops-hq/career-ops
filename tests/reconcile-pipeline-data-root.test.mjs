import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, linkNodeModules } from './helpers.mjs';

const URL = 'https://example.test/one';
const ORIGINAL = `# Pipeline\n\n## Pending\n- [ ] ${URL} | Example | Engineer\n\n## Processed\n`;
const STATE = `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${URL}\tcompleted\t-\t-\t42\t4.2\t-\t0\n`;

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function fixture(t, mode = 'CAREER_OPS_ROOT') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'reconcile-roots-')));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const code = join(root, 'code'), data = join(root, 'user');
  mkdirSync(code); mkdirSync(data);
  // Copy the actual entry's relative import closure, so its code root differs
  // from both the data root and cwd. No installed CLI or network is involved.
  const stack = [join(ROOT, 'reconcile-pipeline.mjs')], seen = new Set();
  const imports = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|^import\s*['"](\.[^'"]+)['"]/gm;
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(imports)) {
      const target = resolve(dirname(file), m[1] || m[2] || m[3]);
      if (existsSync(target)) stack.push(target);
    }
  }
  for (const file of seen) {
    const target = join(code, relative(ROOT, file));
    mkdirSync(dirname(target), { recursive: true }); copyFileSync(file, target);
  }
  copyFileSync(join(ROOT, 'tracker-aliases.json'), join(code, 'tracker-aliases.json'));
  const depsReason = linkNodeModules(code, ROOT);
  if (depsReason) {
    t.skip(depsReason);
    return null;
  }
  const pipeline = join(data, 'data', 'pipeline.md'), state = join(code, 'batch', 'batch-state.tsv');
  write(pipeline, ORIGINAL); write(state, STATE);
  write(join(data, 'reports', '042-example.md'), '**Score:** 4.2/5\n**PDF:** not generated\n');
  const env = { ...process.env };
  delete env.CAREER_OPS_ROOT; delete env.CAREER_OPS_DATA_DIR;
  if (mode === 'marker') write(join(code, '.career-ops-data'), data);
  else env[mode] = data;
  const run = (...args) => spawnSync(process.execPath, [join(code, 'reconcile-pipeline.mjs'), ...args], {
    env, cwd: root, encoding: 'utf8', timeout: 15_000,
  });
  return { root, code, data, pipeline, state, run };
}

for (const mode of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'marker']) {
  test(`default code-root batch state reconciles the external data root (${mode})`, t => {
    const f = fixture(t, mode);
    if (!f) return;
    const dry = f.run('--dry-run');
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /1 processed entry moved/);
    assert.equal(readFileSync(f.pipeline, 'utf8'), ORIGINAL);
    const live = f.run();
    assert.equal(live.status, 0, live.stdout + live.stderr);
    const written = readFileSync(f.pipeline, 'utf8');
    assert.match(written, /\[42\]\(\.\.\/reports\/042-example\.md\)/);
    assert.match(written, /4\.2\/5 \| PDF ❌/);
    assert.doesNotMatch(written, /- \[ \]/);
    assert.equal(readFileSync(`${f.pipeline}.pre-reconcile.bak`, 'utf8'), ORIGINAL);
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(f.pipeline, 'utf8'), written);
  });
}

for (const stateRoot of ['code', 'data']) {
  test(`an explicit state file is allowed inside the ${stateRoot} root`, t => {
    const f = fixture(t);
    if (!f) return;
    const state = join(f[stateRoot], 'custom-state.tsv'); write(state, STATE);
    const r = f.run('--state', state, '--dry-run');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1 processed entry moved/);
  });
}

test('state and pipeline overrides cannot escape the trusted roots', t => {
  const f = fixture(t);
  if (!f) return;
  const outside = join(f.root, 'outside.tsv'); write(outside, STATE);
  for (const flag of ['--state', '--pipeline']) {
    const r = f.run(flag, outside, '--dry-run');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /path must stay inside/);
    assert.equal(readFileSync(f.pipeline, 'utf8'), ORIGINAL);
  }
});

test('an in-root state symlink cannot reach an outside file', {
  skip: process.platform === 'win32' && 'file symlinks require Developer Mode or elevation',
}, t => {
  const f = fixture(t);
  if (!f) return;
  const outside = join(f.root, 'outside.tsv'); write(outside, STATE);
  const link = join(f.code, 'escaped-state.tsv'); symlinkSync(outside, link);
  const r = f.run('--state', link, '--dry-run');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /path must stay inside/);
  assert.equal(readFileSync(f.pipeline, 'utf8'), ORIGINAL);
});
