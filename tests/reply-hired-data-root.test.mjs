// tests/reply-hired-data-root.test.mjs — hired-share.mjs, reply-watch.mjs and
// paste-reply.mjs resolve the tracker and their user-layer files against the
// data root, the same way set-status.mjs and merge-tracker.mjs already do.
//
// Before this, all three missed getCareerOpsRoot():
//
//   hired-share.mjs   resolveWorkspaceRoot(resolveTrackerPath(process.cwd()))
//   reply-watch.mjs   resolveTrackerPath(__dirname), data/*.json under __dirname
//   paste-reply.mjs   data/reply-candidates.json under __dirname
//
// With the user layer outside the checkout (CAREER_OPS_ROOT,
// CAREER_OPS_DATA_DIR or a .career-ops-data marker) hired-share found no hires,
// and reply-watch/paste-reply read and wrote a candidates file the other side of
// the configured data root never saw.
//
// Every case runs the script from a COPIED code root, with the cwd, the code
// root, the data root and a decoy root all holding different trackers, so a
// resolution against the wrong one changes the answer. Copying also keeps the
// marker cases from writing .career-ops-data into the checkout.
//
// Run:  node --test tests/reply-hired-data-root.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS = ['hired-share.mjs', 'reply-watch.mjs', 'paste-reply.mjs'];
// Runtime assets an import scan cannot see.
const ASSETS = ['tracker-aliases.json', 'templates/states.yml'];

// The local import closure of the scripts under test, followed from their
// `./` and `../` specifiers so a new import is copied without editing a list.
function importClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!rel.endsWith('.mjs')) continue;
    const src = readFileSync(join(ROOT, rel), 'utf-8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
      const dep = relative(ROOT, join(ROOT, dirname(rel), m[1])).replace(/\\/g, '/');
      if (existsSync(join(ROOT, dep))) queue.push(dep);
    }
  }
  return [...seen];
}

const CLOSURE = [...importClosure(SCRIPTS), ...ASSETS];

function nearestNodeModules(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules'))) return join(dir, 'node_modules');
    if (dirname(dir) === dir) return null;
  }
}

const tracker = (role) => [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  `| 1 | 2026-01-05 | Acme | ${role} | 4.2/5 | Hired | ❌ | [1](../reports/001-acme.md) | n |`,
  '',
].join('\n');

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-reply-hired-root-')));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const f = { dir };
  for (const name of ['code', 'data', 'other', 'cwd']) {
    const root = join(dir, name);
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'applications.md'), tracker(`${name} role`));
    f[name] = root;
  }
  for (const file of CLOSURE) {
    mkdirSync(dirname(join(f.code, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(f.code, file));
  }
  // Bare-specifier imports (js-yaml, …) resolve through the checkout's modules:
  // the nearest node_modules at or above ROOT, as Node's own lookup would find
  // it (a git worktree nested in the main checkout has none of its own).
  const modules = nearestNodeModules(ROOT);
  if (modules) symlinkSync(modules, join(f.code, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return f;
}

function run(f, script, args, env = {}, input = '') {
  const r = spawnSync(process.execPath, [join(f.code, script), ...args], {
    cwd: f.cwd,
    input,
    encoding: 'utf-8',
    timeout: 30_000,
    // Every override blank unless the case sets it. CAREER_OPS_TRACKER outranks
    // the data root, so leaving a developer's export inherited would point these
    // writers at their real tracker.
    env: {
      ...process.env,
      CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_REPLY_CANDIDATES: '',
      ...env,
    },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  assert.equal(r.status, 0, `${script} ${args.join(' ')} exited ${r.status}:\n${r.stdout}${r.stderr}`);
  return r;
}

// Each way of configuring the data root, as { name, setup(f) → env }.
const CONFIGS = [
  { name: 'CAREER_OPS_ROOT (absolute)', setup: (f) => ({ CAREER_OPS_ROOT: f.data }) },
  { name: 'CAREER_OPS_ROOT (code-relative)', setup: (f) => ({ CAREER_OPS_ROOT: relative(f.code, f.data) }) },
  { name: 'CAREER_OPS_DATA_DIR', setup: (f) => ({ CAREER_OPS_DATA_DIR: f.data }) },
  {
    name: '.career-ops-data marker (absolute)',
    setup: (f) => { writeFileSync(join(f.code, '.career-ops-data'), `${f.data}\n`); return {}; },
  },
  {
    name: '.career-ops-data marker (relative)',
    setup: (f) => { writeFileSync(join(f.code, '.career-ops-data'), `${relative(f.code, f.data)}\n`); return {}; },
  },
  {
    name: 'CAREER_OPS_ROOT over the marker',
    setup: (f) => { writeFileSync(join(f.code, '.career-ops-data'), f.other); return { CAREER_OPS_ROOT: f.data }; },
  },
];

for (const config of CONFIGS) {
  test(`hired-share reads the data-root tracker and writes its state there — ${config.name}`, (t) => {
    const f = fixture(t);
    const env = config.setup(f);

    const status = JSON.parse(run(f, 'hired-share.mjs', ['--status'], env).stdout);
    assert.deepEqual(status.hires.map((h) => h.role), ['data role']);

    run(f, 'hired-share.mjs', ['--report', '1', '--mark', 'later'], env);
    const statePath = join(f.data, 'data', '.hired-share-state.json');
    assert.ok(existsSync(statePath), 'state file must land under the data root');
    assert.equal(JSON.parse(readFileSync(statePath, 'utf-8')).byReport['1'].status, 'later');
    for (const other of [f.code, f.cwd, f.other]) {
      assert.ok(!existsSync(join(other, 'data', '.hired-share-state.json')), `stray state file under ${other}`);
    }
  });

  test(`paste-reply and reply-watch share the data-root candidates file — ${config.name}`, (t) => {
    const f = fixture(t);
    const env = config.setup(f);
    const email = join(f.dir, 'email.txt');
    writeFileSync(email, 'Subject: Thanks for applying\nFrom: jobs@acme.example\n\nWe received your application.\n');

    run(f, 'paste-reply.mjs', ['--file', email], env);
    const candidatesPath = join(f.data, 'data', 'reply-candidates.json');
    assert.ok(existsSync(candidatesPath), 'paste-reply must write under the data root');
    assert.equal(JSON.parse(readFileSync(candidatesPath, 'utf-8')).length, 1);

    // reply-watch reads the same file. Answer "no" to any update prompt so the
    // run never writes the tracker.
    const watch = run(f, 'reply-watch.mjs', [], env, 'n\n');
    assert.match(watch.stdout, /Today: 1 application updates need review/);

    for (const other of [f.code, f.cwd, f.other]) {
      assert.ok(!existsSync(join(other, 'data', 'reply-candidates.json')), `stray candidates file under ${other}`);
      assert.equal(readFileSync(join(other, 'data', 'applications.md'), 'utf-8'), tracker(`${other === f.code ? 'code' : other === f.cwd ? 'cwd' : 'other'} role`));
    }
  });
}

test('with nothing configured, the code root is the default — not the cwd', (t) => {
  const f = fixture(t);
  const status = JSON.parse(run(f, 'hired-share.mjs', ['--status']).stdout);
  assert.deepEqual(status.hires.map((h) => h.role), ['code role']);

  run(f, 'reply-watch.mjs', [], {}, 'n\n');
  assert.ok(existsSync(join(f.code, 'data', 'reply-candidates.json')));
  assert.ok(!existsSync(join(f.cwd, 'data', 'reply-candidates.json')));
});

test('an explicit --root still overrides the configured data root for hired-share', (t) => {
  const f = fixture(t);
  const status = JSON.parse(run(f, 'hired-share.mjs', ['--status', '--root', f.other], { CAREER_OPS_ROOT: f.data }).stdout);
  assert.deepEqual(status.hires.map((h) => h.role), ['other role']);
});

test('hired-share --mark creates data/ on a legacy-layout data root', (t) => {
  // applications.md at the top level and no data/: the tracker still resolves,
  // so recording the answer must not fail on the missing state directory.
  const f = fixture(t);
  const legacy = join(f.dir, 'legacy');
  mkdirSync(legacy);
  writeFileSync(join(legacy, 'applications.md'), tracker('legacy role'));

  run(f, 'hired-share.mjs', ['--report', '1', '--mark', 'never'], { CAREER_OPS_ROOT: legacy });
  const statePath = join(legacy, 'data', '.hired-share-state.json');
  assert.ok(existsSync(statePath), 'state file must be written under the legacy root');
  assert.equal(JSON.parse(readFileSync(statePath, 'utf-8')).byReport['1'].status, 'never');
});
