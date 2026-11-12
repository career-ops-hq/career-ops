// A relative tracker override belongs to the installation, regardless of cwd
// or an external data root. Exercise reads, writes and lexical workspace paths.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT, NODE, pass, fail, linkRepoPackage, rmSync } from './helpers.mjs';

const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'co-relative-tracker-')));
const code = join(sandbox, 'code');
const data = join(sandbox, 'configured-data');
const external = join(sandbox, 'external');
const cwdA = join(sandbox, 'a');
const cwdB = join(sandbox, 'b');
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(CAREER_OPS_|DOTENV_|NODE_OPTIONS$|NODE_PATH$)/i.test(key),
));

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf-8');
}

function tracker(company) {
  return [
    '# Synthetic tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    `| 1 | 2026-01-01 | ${company} | Engineer | 4/5 | Applied | - | - | fixture |`,
    '',
  ].join('\n');
}

function run(script, args, cwd, override, codeRoot = code) {
  const env = { ...childEnv, CAREER_OPS_ROOT: data, CAREER_OPS_PROFILE: 'profiles/lane.yml' };
  if (codeRoot != null) env.CAREER_OPS_CODE_ROOT = codeRoot;
  if (override !== undefined) env.CAREER_OPS_TRACKER = override;
  return execFileSync(NODE, [join(code, script), ...args], {
    cwd, env, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function check(name, fn) {
  try { fn(); pass(name); }
  catch (error) { fail(`${name}: ${error.message}\n${error.stderr ?? ''}`); }
}

try {
  for (const dir of [code, data, external, cwdA, cwdB]) mkdirSync(dir, { recursive: true });
  // Copy only code and system inputs. Shared lib/ dependencies follow the
  // existing isolated evaluator fixture pattern; no user files are copied.
  cpSync(join(ROOT, 'lib'), join(code, 'lib'), { recursive: true });
  for (const file of [
    'path-resolver.mjs', 'tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json',
    'tracker.mjs', 'set-status.mjs', 'funnel-velocity.mjs', 'stats.mjs',
    'followup-cadence.mjs', 'funnel-stages.mjs', 'role-matcher.mjs',
    'session-activity.mjs', 'check-jd-archive.mjs', 'jd-capture.mjs', 'templates/states.yml',
    'web/src/lib/core/tracker-files.mjs', 'web/src/lib/core/code-root.mjs',
  ]) {
    mkdirSync(dirname(join(code, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(code, file));
  }
  linkRepoPackage(code, 'js-yaml');
  write(join(code, 'probe.mjs'), `
    import assert from 'node:assert/strict';
    import { readFileSync, existsSync } from 'node:fs';
    import { getCareerOpsRoot, getProfilePath, rawTrackerPath, resolveTrackerPath, resolveTrackerPathForWrite } from './path-resolver.mjs';
    import { resolveWorkspaceRootFor, trackerLinkDirsFor } from './tracker-utils.mjs';
    import { resolveTrackerPath as webResolve, trackerLinkDirs as webLinkDirs, readTrackerFile } from './web/src/lib/core/tracker-files.mjs';
    const root = getCareerOpsRoot();
    assert.equal(webResolve(root), resolveTrackerPath(root));
    assert.deepEqual(webLinkDirs(root), trackerLinkDirsFor(root));
    assert.equal(readTrackerFile(root), existsSync(resolveTrackerPath(root)) ? readFileSync(resolveTrackerPath(root), 'utf8') : null);
    console.log(JSON.stringify({
      raw: rawTrackerPath(root), read: resolveTrackerPath(root), write: resolveTrackerPathForWrite(root),
      workspace: resolveWorkspaceRootFor(root), linkDirs: trackerLinkDirsFor(root), profile: getProfilePath(),
    }));
  `);
  write(join(code, 'web-read.mjs'), `
    import { getCareerOpsRoot } from './path-resolver.mjs';
    import { readTrackerFile } from './web/src/lib/core/tracker-files.mjs';
    console.log(JSON.stringify({ tracker: readTrackerFile(getCareerOpsRoot()), ledger: readTrackerFile(getCareerOpsRoot(), 'status-log.tsv') }));
  `);

  const relativeTracker = join(code, 'custom/data/applications.md');
  const externalTracker = join(external, 'data/applications.md');
  write(relativeTracker, tracker('Code Target'));
  write(externalTracker, tracker('External Target'));
  symlinkSync(join(code, 'custom'), join(code, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');

  check('web checkout fallback and relative code-root override select the CLI tracker', () => {
    // A web deployment normally runs from <checkout>/web; an external one
    // selects its engine explicitly, independently of the configured data root.
    const webCwd = join(code, 'web');
    // null leaves CAREER_OPS_CODE_ROOT unset (the run helper defaults to code).
    for (const codeRoot of [null, '..']) {
      const actual = JSON.parse(run('probe.mjs', [], webCwd, 'custom/data/applications.md', codeRoot));
      assert.equal(actual.read, realpathSync(relativeTracker));
    }
  });

  for (const [name, override, raw, canonical, workspace, linkDirs] of [
    ['existing relative override', 'custom/data/applications.md', relativeTracker, realpathSync(relativeTracker), join(code, 'custom'), [dirname(realpathSync(relativeTracker))]],
    ['missing relative override', 'new/data/applications.md', join(code, 'new/data/applications.md'), join(code, 'new/data/applications.md'), join(code, 'new'), [join(code, 'new/data')]],
    ['trimmed relative override', '  custom/data/applications.md  ', relativeTracker, realpathSync(relativeTracker), join(code, 'custom'), [dirname(realpathSync(relativeTracker))]],
    ['symlinked directory override', 'alias/data/applications.md', join(code, 'alias/data/applications.md'), realpathSync(relativeTracker), join(code, 'alias'), [dirname(realpathSync(relativeTracker)), join(code, 'alias/data')]],
    ['absolute override', externalTracker, externalTracker, realpathSync(externalTracker), external, [dirname(realpathSync(externalTracker))]],
    ['relative external override', '../external/data/applications.md', externalTracker, realpathSync(externalTracker), external, [dirname(realpathSync(externalTracker))]],
  ]) {
    check(name, () => {
      for (const cwd of [cwdA, cwdB]) {
        const actual = JSON.parse(run('probe.mjs', [], cwd, override));
        assert.deepEqual(actual, {
          raw, read: canonical, write: canonical, workspace, linkDirs,
          profile: join(cwd, 'profiles/lane.yml'), // this distinct override remains cwd-relative
        });
      }
    });
  }

  for (const [name, override] of [['unset', undefined], ['empty', ''], ['whitespace', '  ']]) {
    check(`${name} override preserves data-root canonical/legacy precedence`, () => {
      const legacy = join(data, 'applications.md');
      const canonical = join(data, 'data/applications.md');
      rmSync(canonical, { force: true });
      write(legacy, tracker('Legacy Target'));
      for (const cwd of [cwdA, cwdB]) {
        const actual = JSON.parse(run('probe.mjs', [], cwd, override));
        assert.equal(actual.raw, legacy);
        assert.equal(actual.read, realpathSync(legacy));
        assert.equal(actual.write, canonical);
        assert.equal(actual.workspace, data);
        assert.deepEqual(actual.linkDirs, [dirname(realpathSync(legacy))]);
      }
      write(canonical, tracker('Default Target'));
      for (const cwd of [cwdA, cwdB]) {
        const actual = JSON.parse(run('probe.mjs', [], cwd, override));
        assert.equal(actual.raw, canonical);
        assert.equal(actual.read, realpathSync(canonical));
        assert.equal(actual.write, realpathSync(canonical));
        assert.equal(actual.workspace, data);
        assert.deepEqual(actual.linkDirs, [dirname(realpathSync(canonical))]);
      }
    });
  }

  const decoys = [
    join(cwdA, 'custom/data/applications.md'), join(cwdB, 'custom/data/applications.md'),
    join(data, 'custom/data/applications.md'), join(code, 'data/applications.md'),
  ];
  for (const path of decoys) write(path, tracker('Decoy Target'));
  const originalDecoys = new Map(decoys.map(path => [path, readFileSync(path, 'utf-8')]));
  for (const [name, override, target] of [
    ['relative', 'custom/data/applications.md', relativeTracker],
    ['symlinked relative', 'alias/data/applications.md', relativeTracker],
    ['absolute', externalTracker, externalTracker],
    ['unset', undefined, join(data, 'data/applications.md')],
    ['empty', '', join(data, 'data/applications.md')],
    ['whitespace', '  ', join(data, 'data/applications.md')],
  ]) {
    check(`real tracker query and set-status: ${name} override`, () => {
      // A failed red-case sync may have indexed a decoy. Isolate later controls.
      for (const path of decoys) {
        for (const file of ['applications.db', 'applications.db-wal', 'applications.db-shm', 'status-log.tsv']) {
          rmSync(join(dirname(path), file), { force: true });
        }
      }
      write(target, tracker('Selected Target'));
      for (const cwd of [cwdA, cwdB]) {
        run('tracker.mjs', ['sync'], cwd, override);
        const rows = JSON.parse(run('tracker.mjs', ['query', '--json'], cwd, override));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].company, 'Selected Target');
        assert.equal(rows[0].status, 'Applied');
      }
      run('set-status.mjs', ['1', 'Rejected', '--json'], cwdB, override);
      const rows = JSON.parse(run('tracker.mjs', ['query', '--json'], cwdA, override));
      assert.equal(rows[0].status, 'Rejected');
      const web = JSON.parse(run('web-read.mjs', [], cwdB, override));
      assert.match(web.tracker, /Rejected/);
      assert.match(web.ledger, /Rejected/);
      assert.match(readFileSync(target, 'utf-8'), /Rejected/);
      assert.ok(existsSync(join(dirname(target), 'applications.db')));
      assert.match(readFileSync(join(dirname(target), 'status-log.tsv'), 'utf-8'), /Rejected/);
      for (const [path, original] of originalDecoys) {
        assert.equal(readFileSync(path, 'utf-8'), original, 'decoy tracker remains untouched');
        assert.equal(existsSync(join(dirname(path), 'applications.db')), false, 'no index beside a decoy');
        assert.equal(existsSync(join(dirname(path), 'status-log.tsv')), false, 'no ledger beside a decoy');
      }
    });
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
