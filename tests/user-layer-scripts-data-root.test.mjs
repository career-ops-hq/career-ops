// User Layer paths in batch-tailor.mjs, cv-templates.mjs and openrouter-runner.mjs
// must follow the data root (getCareerOpsRoot(): CAREER_OPS_ROOT /
// CAREER_OPS_DATA_DIR > .career-ops-data marker > repo root), while System
// Layer paths (batch/, templates/) stay on the code checkout.
//
// Each script used to resolve reports/, config/profile.yml or
// data/model-blacklist.json off its own __dirname, so with an external data
// root it silently read the code checkout instead: batch-tailor handed the
// worker no report, cv-templates ignored the user's chosen template, and
// openrouter-runner could not find a report it had just written.
//
// Every case runs the real CLI as a child process from a disposable code root
// holding only the script's import closure, so reading the wrong root cannot be
// masked by the repository's own user-layer files. Each code root also carries a
// decoy user-layer file that a __dirname-relative lookup would pick up instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// The node_modules that actually serves the repo's packages. A worktree has
// none of its own and resolves from an ancestor checkout, so it is located by
// resolution rather than assumed to be ROOT/node_modules.
const NODE_MODULES = (() => {
  const pkg = createRequire(join(ROOT, 'package.json')).resolve('js-yaml/package.json');
  return pkg.slice(0, pkg.lastIndexOf(`${sep}node_modules${sep}`) + `${sep}node_modules`.length);
})();
const MODES = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'marker'];
// Anything that could point a child at the developer's real files, or change
// the code path under test, is cleared before the per-case env is applied.
const CLEARED_ENV = [
  'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_PROFILE',
  'CAREER_OPS_BATCH_STATE', 'CAREER_OPS_MODEL', 'OPENROUTER_API_KEY',
];

/** Relative-import closure of `entry` (static and literal dynamic imports). */
function importClosure(entry) {
  const seen = new Set();
  const stack = [resolve(ROOT, entry)];
  const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|^import\s*['"](\.[^'"]+)['"]/gm;
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf-8').matchAll(IMPORT_RE)) {
      const target = resolve(dirname(file), m[1] || m[2] || m[3]);
      if (existsSync(target)) stack.push(target);
    }
  }
  return [...seen].map((f) => relative(ROOT, f).split(sep).join('/'));
}

/**
 * Build {code, data} roots under one temp dir. The code root gets `entry`'s
 * import closure (plus a node_modules junction when the closure needs npm
 * packages); the data root starts empty.
 */
function fixture(t, entry, { nodeModules = false, assets = [] } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-ul-root-')));
  const code = join(dir, 'code');
  const data = join(dir, 'data-root');
  mkdirSync(code);
  mkdirSync(data);
  for (const file of [...importClosure(entry), ...assets]) {
    mkdirSync(dirname(join(code, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(code, file));
  }
  const link = join(code, 'node_modules');
  if (nodeModules) symlinkSync(NODE_MODULES, link, 'junction');
  t.after(() => {
    // Drop the junction first so cleanup can never reach into the real node_modules.
    if (nodeModules) {
      try { unlinkSync(link); } catch { try { rmdirSync(link); } catch { /* already gone */ } }
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { dir, code, data };
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Child env selecting the data root via `mode`; the marker lives in the code root. */
function envFor(mode, { code, data }, extra = {}) {
  const env = { ...process.env };
  for (const key of CLEARED_ENV) delete env[key];
  if (mode === 'marker') writeFileSync(join(code, '.career-ops-data'), data);
  else env[mode] = data;
  return { ...env, ...extra };
}

function run(f, script, args, env, input) {
  const result = spawnSync(process.execPath, [join(f.code, script), ...args], {
    cwd: f.dir, // neither root, so a cwd-relative path cannot pass by accident
    env,
    input,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  assert.equal(result.error, undefined, `${script} failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `${script} was killed by ${result.signal}`);
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// ── batch-tailor.mjs ─────────────────────────────────────────────────────────

for (const mode of MODES) {
  test(`batch-tailor.mjs reads reports/ from the data root (${mode})`, (t) => {
    const f = fixture(t, 'batch-tailor.mjs');
    // batch/ is System Layer: the default state file stays on the code root.
    write(join(f.code, 'batch', 'batch-state.tsv'),
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + '1\thttps://example.com/job\tcompleted\t-\t-\t007\t4.5\t-\t0\n');
    const report = join(f.data, 'reports', '007-fabrikam-2026-01-01.md');
    write(report, '# Fabrikam\n');
    write(join(f.code, 'reports', '007-decoy-2026-01-01.md'), '# decoy\n');

    // An empty PATH keeps the worker spawn from reaching a real `claude`: it
    // fails with ENOENT, which the script logs and survives. Windows keys the
    // variable as `Path`, so every casing is replaced.
    const env = envFor(mode, f);
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
    env.PATH = join(f.dir, 'empty-bin');

    const result = run(f, 'batch-tailor.mjs', ['--min-score', '4.0'], env);
    assert.equal(result.status, 0, result.output);
    assert.ok(result.output.includes(`Report: ${report}`),
      `expected the data-root report to be handed to the worker:\n${result.output}`);
    assert.doesNotMatch(result.output, /decoy/, `batch-tailor read reports/ from the code root:\n${result.output}`);
  });
}

// ── cv-templates.mjs ─────────────────────────────────────────────────────────

const CV_TEMPLATE = '<h1>{{NAME}}</h1>{{EXPERIENCE}}{{EDUCATION}}\n';

function cvTemplatesFixture(t) {
  const f = fixture(t, 'cv-templates.mjs', { nodeModules: true });
  // templates/ is System Layer and must still come from the code root.
  for (const name of ['cv-template.html', 'cv-template.fancy.html', 'cv-template.plain.html', 'cv-template.bold.html']) {
    write(join(f.code, 'templates', name), CV_TEMPLATE);
  }
  write(join(f.code, 'config', 'profile.yml'), 'cv:\n  template: plain\n'); // decoy
  write(join(f.data, 'config', 'profile.yml'), 'cv:\n  template: fancy\n');
  return f;
}

for (const mode of MODES) {
  test(`cv-templates.mjs reads config/profile.yml from the data root (${mode})`, (t) => {
    const f = cvTemplatesFixture(t);
    const result = run(f, 'cv-templates.mjs', ['resolve', 'cv'], envFor(mode, f));
    assert.equal(result.status, 0, result.output);
    assert.equal(result.stdout.trim(), join(f.code, 'templates', 'cv-template.fancy.html'),
      'expected the data-root profile default, resolved against the code-root templates/');
  });
}

test('cv-templates.mjs: CAREER_OPS_PROFILE still overrides the data-root profile', (t) => {
  const f = cvTemplatesFixture(t);
  const override = join(f.dir, 'override-profile.yml');
  write(override, 'cv:\n  template: bold\n');
  const result = run(f, 'cv-templates.mjs', ['resolve', 'cv'],
    envFor('CAREER_OPS_ROOT', f, { CAREER_OPS_PROFILE: override }));
  assert.equal(result.status, 0, result.output);
  assert.equal(result.stdout.trim(), join(f.code, 'templates', 'cv-template.bold.html'));
});

// ── openrouter-runner.mjs ────────────────────────────────────────────────────

for (const mode of MODES) {
  test(`openrouter-runner.mjs reads reports/ and the model blacklist from the data root (${mode})`, (t) => {
    // tracker-parse.mjs reads its alias table at import time.
    const f = fixture(t, 'openrouter-runner.mjs', { nodeModules: true, assets: ['tracker-aliases.json'] });
    write(join(f.data, 'data', 'model-blacklist.json'), JSON.stringify(['a/one:free', 'b/two:free']));
    write(join(f.code, 'data', 'model-blacklist.json'),
      JSON.stringify(['d/1:free', 'd/2:free', 'd/3:free', 'd/4:free', 'd/5:free'])); // decoy
    // Scored below the 4.0 gate, so `apply` stops at the confirmation prompt
    // (answered "no") before any network call. A pinned model skips the
    // free-model fetch that would otherwise run first.
    write(join(f.data, 'reports', '009-fabrikam-2026-01-01.md'), '# Fabrikam\n\n**Score:** 2.0/5\n');

    const result = run(f, 'openrouter-runner.mjs', ['apply', '9'],
      envFor(mode, f, { CAREER_OPS_MODEL: 'test/pinned:free' }), 'no\n');
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /Report not found/, `apply looked for reports/ off the code root:\n${result.output}`);
    assert.match(result.output, /scored 2\.0\/5/, result.output);
    assert.match(result.output, /Aborted\./, result.output);
    assert.match(result.output, /Loaded 2 pre-blacklisted model\(s\)/,
      `model-blacklist.json was not read from the data root:\n${result.output}`);
  });
}

// cmdEvaluate reserves its report number only AFTER a live OpenRouter call (the
// API URL is hardcoded), so the child-process cases above cannot reach the
// reserve/release call sites offline. Pin their arguments at the source level
// instead: the allocator's own tests call it directly and would stay green if
// either call site drifted back to the code root.
test('openrouter-runner.mjs reserves and releases report numbers under DATA_ROOT', () => {
  const src = readFileSync(join(ROOT, 'openrouter-runner.mjs'), 'utf-8');
  const reserve = src.match(/reserveReportNumbers\(\s*1\s*,\s*\{([^}]*)\}/);
  assert.ok(reserve, 'reserveReportNumbers(1, { ... }) call not found');
  assert.match(reserve[1], /rootDir:\s*DATA_ROOT\b/, `reserve rootDir is not DATA_ROOT: ${reserve[1]}`);
  assert.match(reserve[1], /reportsDir:\s*path\.join\(\s*DATA_ROOT\s*,\s*'reports'\s*\)/,
    `reserve reportsDir is not under DATA_ROOT: ${reserve[1]}`);
  const release = src.match(/releaseReportNumbers\([^,]+,\s*\{([^}]*)\}/);
  assert.ok(release, 'releaseReportNumbers(..., { ... }) call not found');
  assert.match(release[1], /reportsDir:\s*path\.join\(\s*DATA_ROOT\s*,\s*'reports'\s*\)/,
    `release reportsDir is not under DATA_ROOT: ${release[1]}`);
  assert.doesNotMatch(src, /path\.join\(\s*__dirname\s*,\s*'(?:reports|data)'/,
    'openrouter-runner.mjs still joins a user-layer directory onto __dirname');
});
