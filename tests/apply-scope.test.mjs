// tests/apply-scope.test.mjs — apply stays inside this checkout and launches
// its own Playwright browser.
//
// A headless apply run searched the home directory, read a different
// career-ops install, and read the user's Chrome DevToolsActivePort. A second
// run tried remote debugging. The mode text told it to read the active Chrome
// tab, and the apply command followed an absolute report path out of the
// project. These checks lock the boundary the agent and the command share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTree } from '../lib/walk-tree.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;

const FORBIDDEN_DETECT = [
  'Read active Chrome tab',
  'Active Chrome tab',
  'aktiven Chrome-Tab',
  'Læs den aktive Chrome-fane',
  'Прочитать активную вкладку Chrome',
  'Прочитати активну вкладку Chrome',
  '读取当前 Chrome 活动标签页',
  '讀取當前 Chrome 作用中分頁',
  '활성 Chrome 탭',
  'actieve Chrome-tabblad',
  'aktywną kartę Chrome',
  'aba ativa do Chrome',
  'tab Chrome yang aktif',
  'tab Chrome đang hoạt động',
  'pestaña activa de Chrome',
  'onglet Chrome actif',
];

function scratch() {
  return mkdtempSync(join(tmpdir(), 'apply-scope-'));
}

// A file symlink on Windows needs SeCreateSymbolicLinkPrivilege, which a
// non-elevated account without Developer Mode lacks, so symlink() answers
// EPERM. CI runs elevated and takes the symlink every time. Only that EPERM,
// from symlink() itself, is tolerated here; anything else still fails.
function noSymlinkPrivilege(error) {
  return process.platform === 'win32' && error?.code === 'EPERM' && error?.syscall === 'symlink';
}

// A link to a path that does not exist yet. Without the privilege a junction
// stands in: it needs none, and apply-scope sees it the way it sees a dangling
// symlink, an entry lstat finds and realpath cannot resolve.
function danglingLink(target, path) {
  try {
    symlinkSync(target, path);
  } catch (error) {
    if (!noSymlinkPrivilege(error)) throw error;
    symlinkSync(target, path, 'junction');
  }
}

test('resolveInsideProject accepts a file inside the root and rejects escapes', async (t) => {
  const { resolveInsideProject, ApplyScopeError } = await import('../apply-scope.mjs');
  const root = scratch();
  const outside = scratch();
  try {
    writeFileSync(join(root, 'cv.md'), 'inside');
    writeFileSync(join(outside, 'secret.md'), 'other-install');
    let fileLink = true;
    try {
      symlinkSync(join(outside, 'secret.md'), join(root, 'linked.md'));
    } catch (error) {
      if (!noSymlinkPrivilege(error)) throw error;
      fileLink = false;
    }

    const inside = resolveInsideProject(root, 'cv.md');
    assert.equal(inside, resolve(root, 'cv.md'));

    assert.throws(() => resolveInsideProject(root, join(outside, 'secret.md')), ApplyScopeError);
    // A file link has no privilege-free stand-in on Windows (a hard link is
    // not an escape), so this one check waits for a machine that can make it.
    if (fileLink) assert.throws(() => resolveInsideProject(root, 'linked.md'), ApplyScopeError);
    else t.diagnostic('not checked here: a file symlink out of the root (no symlink privilege, EPERM)');
    assert.throws(() => resolveInsideProject(root, join(root, '..', 'outside.md')), ApplyScopeError);
    assert.throws(() => resolveInsideProject(root, ''), ApplyScopeError);

    const link = join(root, 'link');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => resolveInsideProject(root, join(link, 'new.md')), ApplyScopeError);

    const dangling = join(root, 'dangling');
    danglingLink(join(outside, 'not-yet'), dangling);
    assert.throws(() => resolveInsideProject(root, dangling), ApplyScopeError);
    assert.throws(() => resolveInsideProject(root, join(dangling, 'new.md')), ApplyScopeError);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('allowed roots are this checkout and the configured data root only', async () => {
  const { projectRoot, allowedRoots } = await import('../apply-scope.mjs');
  assert.equal(projectRoot(), ROOT);
  const previous = process.env.CAREER_OPS_ROOT;
  const previousData = process.env.CAREER_OPS_DATA_DIR;
  const data = scratch();
  try {
    process.env.CAREER_OPS_ROOT = '';
    process.env.CAREER_OPS_DATA_DIR = '';
    assert.deepEqual(allowedRoots(), [ROOT]);

    process.env.CAREER_OPS_DATA_DIR = data;
    const roots = allowedRoots();
    assert.ok(roots.includes(ROOT));
    assert.ok(roots.includes(resolve(data)));
    assert.equal(roots.length, 2);
  } finally {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    if (previousData === undefined) delete process.env.CAREER_OPS_DATA_DIR;
    else process.env.CAREER_OPS_DATA_DIR = previousData;
    rmSync(data, { recursive: true, force: true });
  }
});

test('freshLaunchOptions starts a new browser and refuses an attached one', async () => {
  const { freshLaunchOptions, ApplyScopeError, HEADED_APPLY_LAUNCH } = await import('../apply-scope.mjs');
  const fresh = freshLaunchOptions({ headless: false });
  assert.deepEqual(fresh, { headless: false });
  assert.equal(JSON.stringify(fresh).includes('remote-debugging'), false);
  assert.equal(Object.hasOwn(fresh, 'userDataDir'), false);

  const refused = [
    { debuggingPort: 9222 },
    { wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser' },
    { args: ['--remote-debugging-port=9222'] },
    { args: ['--remote-debugging-pipe'] },
    { userDataDir: join(tmpdir(), 'chrome-profile') },
    { executablePath: join(tmpdir(), 'DevToolsActivePort') },
  ];
  for (const options of refused) {
    assert.throws(() => freshLaunchOptions(options), ApplyScopeError);
  }

  assert.equal(HEADED_APPLY_LAUNCH.channel, 'chrome');
  assert.equal(HEADED_APPLY_LAUNCH.headless, false);
  assert.equal(JSON.stringify(HEADED_APPLY_LAUNCH).includes('remote-debugging'), false);
  assert.equal(Object.hasOwn(HEADED_APPLY_LAUNCH, 'userDataDir'), false);
});

test('locateApplyReport reads a report inside the data root and refuses another install', async () => {
  const { locateApplyReport, ApplyScopeError } = await import('../apply-scope.mjs');
  const root = scratch();
  const other = scratch();
  try {
    mkdirSync(join(root, 'reports'));
    writeFileSync(join(root, 'reports', '001-acme-2026-01-01.md'), 'score: 4.2/5');
    writeFileSync(join(other, '001-other.md'), 'other-install');
    const reads = [];
    const listed = [];
    const io = {
      exists: (p) => {
        reads.push(p);
        return p === join(root, 'reports', '001-acme-2026-01-01.md');
      },
      list: (p) => {
        listed.push(p);
        return ['001-acme-2026-01-01.md'];
      },
    };

    const found = locateApplyReport(root, '1', io);
    assert.equal(found.ok, true);
    assert.equal(found.path, join(root, 'reports', '001-acme-2026-01-01.md'));
    assert.deepEqual(listed, [join(root, 'reports')]);

    reads.length = 0;
    assert.throws(() => locateApplyReport(root, join(other, '001-other.md'), io), ApplyScopeError);
    assert.deepEqual(reads, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('locateApplyReport refuses a reports directory that escapes the data root', async () => {
  const { locateApplyReport, ApplyScopeError } = await import('../apply-scope.mjs');
  const root = scratch();
  const outside = scratch();
  try {
    mkdirSync(join(outside, 'reports'));
    writeFileSync(join(outside, 'reports', '001-secret.md'), 'secret');
    symlinkSync(join(outside, 'reports'), join(root, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
    let listed = false;
    const io = {
      exists: () => false,
      list: () => {
        listed = true;
        return ['001-secret.md'];
      },
    };
    assert.throws(() => locateApplyReport(root, '1', io), ApplyScopeError);
    assert.equal(listed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('apply command refuses a report path outside the project', () => {
  const outside = scratch();
  const report = join(outside, '001-other.md');
  writeFileSync(report, 'other-install secret');
  const escaped = relative(ROOT, report);
  try {
    for (const ref of [report, escaped]) {
      const result = spawnSync(NODE, [join(ROOT, 'openrouter-runner.mjs'), 'apply', ref], {
        cwd: ROOT,
        env: {
          ...process.env,
          CAREER_OPS_ROOT: '',
          CAREER_OPS_DATA_DIR: '',
          CAREER_OPS_TRACKER: '',
          CAREER_OPS_MODEL: 'offline-test',
          OPENROUTER_API_KEY: '',
        },
        encoding: 'utf8',
        timeout: 20_000,
      });
      const out = `${result.stdout || ''}${result.stderr || ''}`;
      assert.equal(out.includes('other-install secret'), false, ref);
      assert.match(out, /outside the project/);
      assert.equal(out.includes('Generating application form answers'), false, ref);
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('apply instructions name the scope guard and stop telling agents to attach to Chrome', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const apply = readFileSync(join(ROOT, 'modes/apply.md'), 'utf8');
  for (const text of [agents, apply]) {
    assert.match(text, /apply-scope\.mjs/);
    assert.match(text, /DevToolsActivePort/);
  }
  assert.match(agents, /NEVER submit an application/);
  assert.equal(apply.includes('Read active Chrome tab'), false);

  const session = readFileSync(join(ROOT, 'web/src/lib/apply/session.ts'), 'utf8');
  assert.match(session, /HEADED_APPLY_LAUNCH/);
  assert.match(session, /resolveRootScript/);
  assert.equal(/from\s+['"][^'"]*apply-scope\.mjs['"]/.test(session), false);
  assert.equal(session.includes('remote-debugging'), false);
  assert.equal(session.includes('connectOverCDP'), false);
  assert.equal(session.includes('DevToolsActivePort'), false);

  const modeText = listTree(join(ROOT, 'modes'), { match: /\.md$/ })
    .map((path) => `${relative(ROOT, path)}\n${readFileSync(path, 'utf8')}`)
    .join('\n');
  for (const phrase of FORBIDDEN_DETECT) {
    assert.equal(modeText.includes(phrase), false, `still telling apply to read an open Chrome tab: ${phrase}`);
  }
});

test('check-path and launch-options stay inside the project browser', () => {
  const rootRun = spawnSync(NODE, [join(ROOT, 'apply-scope.mjs'), 'root'], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '' },
    encoding: 'utf8',
  });
  assert.equal(rootRun.status, 0);
  assert.equal(rootRun.stdout.trim(), ROOT);

  const launch = spawnSync(NODE, [join(ROOT, 'apply-scope.mjs'), 'launch-options'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(launch.status, 0);
  const options = JSON.parse(launch.stdout);
  assert.equal(options.headless, false);
  assert.equal(Object.hasOwn(options, 'channel'), false);
  assert.equal(JSON.stringify(options).includes('remote-debugging'), false);

  const help = spawnSync(NODE, [join(ROOT, 'apply-scope.mjs'), '--help'], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '' },
    encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:/);
  assert.equal(help.stdout.includes(ROOT), false);

  const outside = scratch();
  const data = scratch();
  try {
    const checked = spawnSync(NODE, [join(ROOT, 'apply-scope.mjs'), 'check-path', outside], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: '' },
      encoding: 'utf8',
    });
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /outside the project/);

    const link = join(data, 'link');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const escaped = spawnSync(NODE, [join(ROOT, 'apply-scope.mjs'), 'check-path', join(link, 'new.md')], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: data },
      encoding: 'utf8',
    });
    assert.equal(escaped.status, 1);
    assert.match(escaped.stderr, /outside the project/);

    const dangling = join(data, 'dangling');
    danglingLink(join(outside, 'not-yet'), dangling);
    const danglingCheck = spawnSync(NODE, [join(ROOT, 'apply-scope.mjs'), 'check-path', dangling], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: data },
      encoding: 'utf8',
    });
    assert.equal(danglingCheck.status, 1);
    assert.match(danglingCheck.stderr, /outside the project/);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});
