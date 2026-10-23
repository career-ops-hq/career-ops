/** Descriptor-relative publication must survive races after path validation. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openWorkspaceOutputRoot, publishWorkspaceFile, updateWorkspaceManifest } from '../lib/workspace-output.mjs';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { applyManifestRow } from '../generate-pdf.mjs';

const helper = join(ROOT, 'lib/workspace-output.py');
const moduleUrl = pathToFileURL(join(ROOT, 'lib/workspace-output.mjs')).href;
const content = Buffer.from([0, 1, 2, 255, 10, 13, 128]);
const manifestRow = { reportNum: '8', pdf: 'output/cv.pdf', html: 'output/cv.html', format: 'a4', date: '2026-10-23', kind: 'cv' };

function check(name, run) {
  try { run(); pass(`workspace output: ${name}`); }
  catch (error) { fail(`workspace output: ${name}: ${error.stack}`); }
}

function withFixture(run) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'workspace publication ')));
  const root = join(base, 'workspace');
  const outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'outside content');
  try { run({ base, root, outside }); }
  finally { rmSync(base, { recursive: true, force: true }); }
}

function assertOutsideUnchanged(outside) {
  assert.deepEqual(readdirSync(outside), ['keep.txt'], 'no temporary, directory, or final output may appear outside');
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'outside content');
}

// Run the shipping helper, replacing only OS calls at the precise race point.
// No production environment switch or timing-sensitive concurrent loop is needed.
const raceHarness = String.raw`
import errno, os, runpy, sys
helper, root, outside, race, destination = sys.argv[1:]
original_open, original_mkdir, original_link = os.open, os.mkdir, os.link
original_write = os.write
fired = False
write_count = 0

def swap(name):
    global fired
    fired = True
    os.rename(os.path.join(root, name), os.path.join(root, name + '-original'))
    os.symlink(outside, os.path.join(root, name))
    with open(os.path.join(root, 'race-fired'), 'w') as marker:
        marker.write('yes')

def racing_open(path, flags, mode=0o777, *, dir_fd=None):
    if race == 'before-open' and not fired and path == 'output' and dir_fd is not None:
        swap('output')
    return original_open(path, flags, mode, dir_fd=dir_fd)

def racing_mkdir(path, mode=0o777, *, dir_fd=None):
    result = original_mkdir(path, mode, dir_fd=dir_fd)
    if race == 'after-mkdir' and not fired and path == 'fresh' and dir_fd is not None:
        swap('fresh')
    return result

def racing_link(source, target, *, src_dir_fd=None, dst_dir_fd=None, follow_symlinks=True):
    if race.startswith('before-link') and not fired:
        swap('output')
        if race == 'before-link-file':
            fd = original_open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=dst_dir_fd)
            try:
                os.write(fd, b'winning destination')
            finally:
                os.close(fd)
        elif race == 'before-link-symlink':
            os.symlink(os.path.join(outside, 'keep.txt'), target, dir_fd=dst_dir_fd)
        elif race == 'before-link-hardlink':
            original_link(os.path.join(outside, 'keep.txt'), target, dst_dir_fd=dst_dir_fd)
    return original_link(source, target, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd, follow_symlinks=follow_symlinks)

def racing_write(fd, content):
    global write_count
    write_count += 1
    if race == 'partial-write' and write_count > 1:
        raise OSError(errno.ENOSPC, 'injected write failure after a prefix')
    return original_write(fd, content[:2] if race in ('short-write', 'partial-write') else content)

for name, wrapper in [('open', racing_open), ('mkdir', racing_mkdir), ('link', racing_link), ('write', racing_write)]:
    original = getattr(os, name)
    for capabilities in (os.supports_dir_fd, os.supports_follow_symlinks):
        if original in capabilities:
            capabilities.add(wrapper)
    setattr(os, name, wrapper)
sys.argv = [helper, destination, str(0o600)]
runpy.run_path(helper, run_name='__main__')
`;

function runRace(f, race, destination) {
  const anchor = openWorkspaceOutputRoot(f.root);
  try {
    return spawnSync('python3', ['-I', '-B', '-c', raceHarness, helper, f.root, f.outside, race, destination], {
      input: content, encoding: 'utf8', timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe', anchor.fd],
    });
  } finally { anchor.close(); }
}

const manifestRaceHarness = String.raw`
import errno, json, os, runpy, subprocess, sys
helper, root, outside, race, node, lock_module = sys.argv[1:]
original_open, original_rename, original_write = os.open, os.rename, os.write
original_dump = json.dump
fired = False
temporary_fd = None
owner_dir_fd = None
write_count = 0

def swap():
    global fired
    fired = True
    original_rename(os.path.join(root, 'data'), os.path.join(root, 'data-original'))
    os.symlink(outside, os.path.join(root, 'data'))
    with open(os.path.join(root, 'manifest-race-fired'), 'w') as marker:
        marker.write('yes')

def racing_open(path, flags, mode=0o777, *, dir_fd=None):
    global temporary_fd, owner_dir_fd
    if race == 'before-open' and not fired and path == 'data' and dir_fd is not None:
        swap()
    if path == 'owner.json' and flags & os.O_CREAT:
        owner_dir_fd = dir_fd
        if race == 'owner-open':
            with open(root + '/owner-failure-fired', 'w') as marker:
                marker.write('yes')
            raise OSError(errno.ENOSPC, 'injected owner stamp open failure')
    fd = original_open(path, flags, mode, dir_fd=dir_fd)
    if flags & os.O_CREAT and str(path).endswith('.tmp'):
        temporary_fd = fd
    return fd

def racing_rename(source, target, *, src_dir_fd=None, dst_dir_fd=None):
    global fired
    if race == 'before-rename' and not fired and target == 'pdf-index.tsv':
        swap()
    if race == 'ordinary-writer' and not fired and target == 'pdf-index.tsv':
        fired = True
        script = "import assert from 'node:assert/strict'; const { acquirePipelineLock } = await import(" + json.dumps(lock_module) + "); await assert.rejects(acquirePipelineLock(" + json.dumps(root + '/data/pdf-index.tsv') + ", { timeoutMs: 100, retryMs: 10, maxWaitMs: 300 }), /lock timeout/);"
        result = subprocess.run([node, '--input-type=module', '-e', script], capture_output=True, text=True, timeout=5)
        if result.returncode:
            raise RuntimeError('Ordinary writer did not respect the protected lock: ' + result.stderr)
        with open(root + '/ordinary-lock-observed', 'w') as marker:
            marker.write('yes')
    return original_rename(source, target, src_dir_fd=src_dir_fd, dst_dir_fd=dst_dir_fd)

def racing_write(fd, content):
    global write_count
    if race == 'partial-write' and fd == temporary_fd:
        write_count += 1
        if write_count > 1:
            raise OSError(errno.ENOSPC, 'injected manifest write failure after a prefix')
        return original_write(fd, content[:2])
    return original_write(fd, content)

def racing_dump(value, stream, *args, **kwargs):
    if race in ('owner-partial-write', 'owner-replaced') and isinstance(value, dict) and 'token' in value:
        stream.write('{"pid":')
        stream.flush()
        if race == 'owner-replaced':
            os.unlink('owner.json', dir_fd=owner_dir_fd)
            replacement = original_open('owner.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=owner_dir_fd)
            try:
                original_write(replacement, b'{"pid":123,"token":"competing-owner"}')
            finally:
                os.close(replacement)
        with open(root + '/owner-failure-fired', 'w') as marker:
            marker.write('yes')
        raise OSError(errno.ENOSPC, 'injected failure after a partial owner stamp write')
    return original_dump(value, stream, *args, **kwargs)

json.dump = racing_dump
for name, wrapper in [('open', racing_open), ('rename', racing_rename), ('write', racing_write)]:
    original = getattr(os, name)
    for capabilities in (os.supports_dir_fd, os.supports_follow_symlinks):
        if original in capabilities:
            capabilities.add(wrapper)
    setattr(os, name, wrapper)
sys.argv = [helper, '--manifest', 'data/pdf-index.tsv']
runpy.run_path(helper, run_name='__main__')
`;

function runManifestRace(f, race, row = manifestRow) {
  const anchor = openWorkspaceOutputRoot(f.root);
  try {
    return spawnSync('python3', ['-I', '-B', '-c', manifestRaceHarness, helper, f.root, f.outside, race,
      NODE, pathToFileURL(join(ROOT, 'pipeline-lock.mjs')).href], {
      input: JSON.stringify(row), encoding: 'utf8', timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe', anchor.fd],
    });
  } finally { anchor.close(); }
}

function manifestLines(path) {
  return readFileSync(path, 'utf8').split('\n').filter(line => line.trim() && !line.startsWith('#'));
}

check('unsupported platforms reject publication before creating output', () => withFixture(f => {
  const result = spawnSync(NODE, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { publishWorkspaceFile } = await import(${JSON.stringify(moduleUrl)});
    assert.throws(() => publishWorkspaceFile(${JSON.stringify(join(f.root, 'new/cv.html'))}, 'bytes', ${JSON.stringify(f.root)}), /support|POSIX|Windows|platform/i);
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, describeSpawn(result));
  assert.deepEqual(readdirSync(f.root), []);
  assertOutsideUnchanged(f.outside);
}));

if (process.platform !== 'win32') {
  check('a missing manifest and parent are created without leaving lock or temporary files', () => withFixture(f => {
    const manifest = join(f.root, 'data/pdf-index.tsv');
    updateWorkspaceManifest(manifest, manifestRow, f.root);
    assert.deepEqual(manifestLines(manifest), applyManifestRow([], manifestRow));
    assert.deepEqual(readdirSync(join(f.root, 'data')), ['pdf-index.tsv']);
    assertOutsideUnchanged(f.outside);
  }));

  check('protected manifest merging matches padded report, kind, legacy and duplicate-path behavior', () => withFixture(f => {
    const manifest = join(f.root, 'data/pdf-index.tsv');
    mkdirSync(join(f.root, 'data'));
    const existing = [
      '# existing manifest', '',
      '008\toutput/old-cv.pdf\t\tletter\t2026-01-01\t cv ',
      ' 0008 \toutput/old-cover.pdf\t\tletter\t2026-01-01\t cover ',
      '8\toutput/legacy.pdf\t\ta4\t2026-01-01',
      '9\toutput/cv.pdf\t\ta4\t2026-01-01\tcover',
      '10\toutput/untouched.pdf\t\ta4\t2026-01-01\tcv',
    ];
    for (const row of [manifestRow, { ...manifestRow, kind: 'cover' }, { ...manifestRow, reportNum: '' }, { ...manifestRow, kind: undefined }]) {
      writeFileSync(manifest, `${existing.join('\n')}\n`);
      updateWorkspaceManifest(manifest, row, f.root);
      assert.deepEqual(manifestLines(manifest), applyManifestRow(existing, row));
      assert.deepEqual(readdirSync(join(f.root, 'data')), ['pdf-index.tsv']);
    }
    assertOutsideUnchanged(f.outside);
  }));

  for (const kind of ['symlink', 'dangling-symlink', 'directory']) check(`a manifest ${kind} is refused without following or overwriting it`, () => withFixture(f => {
    mkdirSync(join(f.root, 'data'));
    const manifest = join(f.root, 'data/pdf-index.tsv');
    if (kind === 'directory') mkdirSync(manifest);
    else symlinkSync(join(f.outside, kind === 'symlink' ? 'keep.txt' : 'missing.tsv'), manifest);
    assert.throws(() => updateWorkspaceManifest(manifest, manifestRow, f.root), /symlink|regular|directory|ELOOP|EISDIR/i);
    assert.equal(lstatSync(manifest).isSymbolicLink(), kind !== 'directory');
    assert.deepEqual(readdirSync(join(f.root, 'data')), ['pdf-index.tsv']);
    assertOutsideUnchanged(f.outside);
  }));

  check('a manifest parent swapped before its directory open cannot receive any outside writes', () => withFixture(f => {
    mkdirSync(join(f.root, 'data'));
    const previous = '# previous manifest\n';
    writeFileSync(join(f.root, 'data/pdf-index.tsv'), previous);
    const result = runManifestRace(f, 'before-open');
    assert.equal(result.status, 1, describeSpawn(result));
    assert.equal(readFileSync(join(f.root, 'manifest-race-fired'), 'utf8'), 'yes');
    assert.equal(readFileSync(join(f.root, 'data-original/pdf-index.tsv'), 'utf8'), previous);
    assert.deepEqual(readdirSync(join(f.root, 'data-original')), ['pdf-index.tsv']);
    assertOutsideUnchanged(f.outside);
  }));

  check('a manifest parent swapped immediately before rename keeps update and cleanup on its opened directory', () => withFixture(f => {
    mkdirSync(join(f.root, 'data'));
    writeFileSync(join(f.root, 'data/pdf-index.tsv'), '# previous manifest\n');
    const result = runManifestRace(f, 'before-rename');
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(readFileSync(join(f.root, 'manifest-race-fired'), 'utf8'), 'yes');
    assert.deepEqual(manifestLines(join(f.root, 'data-original/pdf-index.tsv')), applyManifestRow([], manifestRow));
    assert.deepEqual(readdirSync(join(f.root, 'data-original')), ['pdf-index.tsv']);
    assertOutsideUnchanged(f.outside);
  }));

  check('a partial manifest write preserves its previous contents and removes temporary and lock files', () => withFixture(f => {
    mkdirSync(join(f.root, 'data'));
    const previous = '# previous manifest\n42\toutput/earlier.pdf\t\ta4\t2026-01-01\tcv\n';
    writeFileSync(join(f.root, 'data/pdf-index.tsv'), previous);
    const result = runManifestRace(f, 'partial-write');
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr, /ENOSPC/);
    assert.equal(readFileSync(join(f.root, 'data/pdf-index.tsv'), 'utf8'), previous);
    assert.deepEqual(readdirSync(join(f.root, 'data')), ['pdf-index.tsv']);
    assertOutsideUnchanged(f.outside);
  }));

  for (const stage of ['owner-open', 'owner-partial-write']) check(`${stage} failure removes its own lock without changing the manifest`, () => withFixture(f => {
    mkdirSync(join(f.root, 'data'));
    const previous = '# previous manifest\n42\toutput/earlier.pdf\t\ta4\t2026-01-01\tcv\n';
    writeFileSync(join(f.root, 'data/pdf-index.tsv'), previous);
    const result = runManifestRace(f, stage);
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr, /ENOSPC/);
    assert.equal(readFileSync(join(f.root, 'owner-failure-fired'), 'utf8'), 'yes');
    assert.equal(readFileSync(join(f.root, 'data/pdf-index.tsv'), 'utf8'), previous);
    assert.deepEqual(readdirSync(join(f.root, 'data')), ['pdf-index.tsv']);
    // A failed acquisition must not wedge the next protected writer.
    updateWorkspaceManifest(join(f.root, 'data/pdf-index.tsv'), manifestRow, f.root);
    assert.deepEqual(manifestLines(join(f.root, 'data/pdf-index.tsv')), applyManifestRow(previous.split('\n'), manifestRow));
    assertOutsideUnchanged(f.outside);
  }));

  check('cleanup preserves a competing owner stamp that replaced its partial write', () => withFixture(f => {
    mkdirSync(join(f.root, 'data'));
    const previous = '# previous manifest\n';
    writeFileSync(join(f.root, 'data/pdf-index.tsv'), previous);
    const result = runManifestRace(f, 'owner-replaced');
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr, /ENOSPC/);
    assert.equal(readFileSync(join(f.root, 'owner-failure-fired'), 'utf8'), 'yes');
    assert.equal(readFileSync(join(f.root, 'data/pdf-index.tsv'), 'utf8'), previous);
    const lock = join(f.root, 'data/pdf-index.tsv.lock');
    assert.equal(readFileSync(join(lock, 'owner.json'), 'utf8'), '{"pid":123,"token":"competing-owner"}');
    assert.deepEqual(readdirSync(lock), ['owner.json']);
    assert.deepEqual(readdirSync(join(f.root, 'data')).sort(), ['pdf-index.tsv', 'pdf-index.tsv.lock']);
    assertOutsideUnchanged(f.outside);
  }));

  check('protected manifest updates respect a live ordinary pipeline lock', () => withFixture(f => {
    mkdirSync(join(f.root, 'data'));
    const manifest = join(f.root, 'data/pdf-index.tsv');
    const previous = '# previous manifest\n';
    writeFileSync(manifest, previous);
    const result = spawnSync(NODE, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import { acquirePipelineLock } from ${JSON.stringify(pathToFileURL(join(ROOT, 'pipeline-lock.mjs')).href)};
      import { updateWorkspaceManifest } from ${JSON.stringify(moduleUrl)};
      const manifest = ${JSON.stringify(manifest)};
      const lock = await acquirePipelineLock(manifest);
      const before = readFileSync(lock.lockDir + '/owner.json', 'utf8');
      try {
        assert.throws(() => updateWorkspaceManifest(manifest, ${JSON.stringify(manifestRow)}, ${JSON.stringify(f.root)}), /lock.*timeout|timed.*out|ETIMEDOUT/i);
        assert.equal(readFileSync(manifest, 'utf8'), ${JSON.stringify(previous)});
        assert.equal(readFileSync(lock.lockDir + '/owner.json', 'utf8'), before);
      } finally { lock.release(); }
    `], {
      encoding: 'utf8', timeout: 5_000,
      env: { ...process.env, CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: '100', CAREER_OPS_PIPELINE_LOCK_RETRY_MS: '10' },
    });
    assert.equal(result.status, 0, describeSpawn(result));
    assert.deepEqual(readdirSync(join(f.root, 'data')), ['pdf-index.tsv']);
    updateWorkspaceManifest(manifest, manifestRow, f.root);
    assert.deepEqual(manifestLines(manifest), applyManifestRow([], manifestRow));
    assertOutsideUnchanged(f.outside);
  }));

  check('an ordinary manifest writer respects the protected writer’s live lock', () => withFixture(f => {
    const result = runManifestRace(f, 'ordinary-writer');
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(readFileSync(join(f.root, 'ordinary-lock-observed'), 'utf8'), 'yes');
    assert.deepEqual(manifestLines(join(f.root, 'data/pdf-index.tsv')), applyManifestRow([], manifestRow));
    assert.deepEqual(readdirSync(join(f.root, 'data')), ['pdf-index.tsv']);
    assertOutsideUnchanged(f.outside);
  }));

  check('publishes exact binary bytes through new nested directories and removes the temporary', () => withFixture(f => {
    const destination = join(f.root, 'output/new/cv.pdf');
    publishWorkspaceFile(destination, content, f.root);
    assert.deepEqual(readFileSync(destination), content);
    assert.deepEqual(readdirSync(join(f.root, 'output/new')), ['cv.pdf']);
    assertOutsideUnchanged(f.outside);
  }));

  check('short writes still publish every byte', () => withFixture(f => {
    const result = runRace(f, 'short-write', 'output/cv.pdf');
    assert.equal(result.status, 0, describeSpawn(result));
    assert.deepEqual(readFileSync(join(f.root, 'output/cv.pdf')), content);
    assert.deepEqual(readdirSync(join(f.root, 'output')), ['cv.pdf']);
    assertOutsideUnchanged(f.outside);
  }));

  check('a failure after a partial write removes its temporary without publishing', () => withFixture(f => {
    const result = runRace(f, 'partial-write', 'output/cv.pdf');
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr, /ENOSPC/);
    assert.deepEqual(readdirSync(join(f.root, 'output')), []);
    assertOutsideUnchanged(f.outside);
  }));

  check('an existing ancestor replaced immediately before directory open is refused', () => withFixture(f => {
    mkdirSync(join(f.root, 'output'));
    const result = runRace(f, 'before-open', 'output/nested/cv.html');
    assert.equal(result.status, 1, describeSpawn(result));
    assert.equal(readFileSync(join(f.root, 'race-fired'), 'utf8'), 'yes');
    assert.equal(lstatSync(join(f.root, 'output')).isSymbolicLink(), true);
    assert.deepEqual(readdirSync(join(f.root, 'output-original')), []);
    assertOutsideUnchanged(f.outside);
  }));

  check('a fresh ancestor replaced between mkdir and open is refused', () => withFixture(f => {
    const result = runRace(f, 'after-mkdir', 'fresh/nested/cv.html');
    assert.equal(result.status, 1, describeSpawn(result));
    assert.equal(readFileSync(join(f.root, 'race-fired'), 'utf8'), 'yes');
    assert.equal(lstatSync(join(f.root, 'fresh')).isSymbolicLink(), true);
    assert.deepEqual(readdirSync(join(f.root, 'fresh-original')), []);
    assertOutsideUnchanged(f.outside);
  }));

  check('an ancestor replaced just before publication keeps writes on its opened directory', () => withFixture(f => {
    mkdirSync(join(f.root, 'output'));
    const result = runRace(f, 'before-link', 'output/cv.html');
    assert.equal(result.status, 0, describeSpawn(result));
    assert.equal(readFileSync(join(f.root, 'race-fired'), 'utf8'), 'yes');
    assert.deepEqual(readFileSync(join(f.root, 'output-original/cv.html')), content);
    assert.deepEqual(readdirSync(join(f.root, 'output-original')), ['cv.html']);
    assertOutsideUnchanged(f.outside);
  }));

  for (const kind of ['file', 'symlink', 'hardlink']) check(`a winning ${kind} survives a simultaneous parent replacement at publication`, () => withFixture(f => {
    mkdirSync(join(f.root, 'output'));
    const result = runRace(f, `before-link-${kind}`, 'output/cv.html');
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr, /exist|EEXIST/i);
    assert.equal(readFileSync(join(f.root, 'race-fired'), 'utf8'), 'yes');
    const destination = join(f.root, 'output-original/cv.html');
    assert.equal(readFileSync(destination, 'utf8'), kind === 'file' ? 'winning destination' : 'outside content');
    assert.equal(lstatSync(destination).isSymbolicLink(), kind === 'symlink');
    assert.deepEqual(readdirSync(join(f.root, 'output-original')), ['cv.html'], 'failed publication cleans its anchored temporary');
    assertOutsideUnchanged(f.outside);
  }));

  check('an inherited descriptor publishes through the validated root', () => withFixture(f => {
    const anchor = openWorkspaceOutputRoot(f.root);
    try {
      const result = spawnSync(NODE, ['--input-type=module', '-e', `
        const { publishWorkspaceFile } = await import(${JSON.stringify(moduleUrl)});
        publishWorkspaceFile(${JSON.stringify(join(f.root, 'output/inherited.pdf'))}, Buffer.from([0, 1, 2, 255, 10, 13, 128]), ${JSON.stringify(f.root)});
      `], {
        encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe', anchor.fd],
        env: { ...process.env, CAREER_OPS_OUTPUT_ROOT_FD: '3', CAREER_OPS_OUTPUT_ROOT: anchor.root,
          CAREER_OPS_OUTPUT_ROOT_DEV: String(anchor.dev), CAREER_OPS_OUTPUT_ROOT_INO: String(anchor.ino) },
      });
      assert.equal(result.status, 0, describeSpawn(result));
      assert.deepEqual(readFileSync(join(f.root, 'output/inherited.pdf')), content);
      assert.deepEqual(readdirSync(join(f.root, 'output')), ['inherited.pdf']);
      assertOutsideUnchanged(f.outside);
    } finally { anchor.close(); }
  }));

  check('the opened root remains authoritative after its pathname becomes an external symlink', () => withFixture(f => {
    const anchor = openWorkspaceOutputRoot(f.root);
    const moved = join(f.base, 'original-workspace');
    try {
      renameSync(f.root, moved);
      symlinkSync(f.outside, f.root, 'dir');
      publishWorkspaceFile(join(f.root, 'output/direct.pdf'), content, f.root, anchor);
      assert.deepEqual(readFileSync(join(moved, 'output/direct.pdf')), content);
      assert.deepEqual(readdirSync(join(moved, 'output')), ['direct.pdf']);
      assertOutsideUnchanged(f.outside);
    } finally { anchor.close(); }
  }));

  check('an inherited root whose pathname changed is refused without falling back to that pathname', () => withFixture(f => {
    const anchor = openWorkspaceOutputRoot(f.root);
    const moved = join(f.base, 'original-workspace');
    try {
      renameSync(f.root, moved);
      symlinkSync(f.outside, f.root, 'dir');
      const result = spawnSync(NODE, ['--input-type=module', '-e', `
        const { publishWorkspaceFile } = await import(${JSON.stringify(moduleUrl)});
        publishWorkspaceFile(${JSON.stringify(join(f.root, 'output/cv.pdf'))}, 'bytes', ${JSON.stringify(f.root)});
      `], {
        encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe', anchor.fd],
        env: { ...process.env, CAREER_OPS_OUTPUT_ROOT_FD: '3', CAREER_OPS_OUTPUT_ROOT: anchor.root,
          CAREER_OPS_OUTPUT_ROOT_DEV: String(anchor.dev), CAREER_OPS_OUTPUT_ROOT_INO: String(anchor.ino) },
      });
      assert.equal(result.status, 1, describeSpawn(result));
      assert.match(result.stderr, /anchor|workspace/i);
      assert.deepEqual(readdirSync(moved), []);
      assertOutsideUnchanged(f.outside);
    } finally { anchor.close(); }
  }));

  check('a missing Python executable fails before creating output', () => withFixture(f => {
    const result = spawnSync(NODE, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const { publishWorkspaceFile } = await import(${JSON.stringify(moduleUrl)});
      assert.throws(() => publishWorkspaceFile(${JSON.stringify(join(f.root, 'new/cv.html'))}, 'bytes', ${JSON.stringify(f.root)}), /Python 3/);
    `], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PATH: '' } });
    assert.equal(result.status, 0, describeSpawn(result));
    assert.deepEqual(readdirSync(f.root), []);
    assertOutsideUnchanged(f.outside);
  }));

  check('missing descriptor-relative runtime support fails before writing', () => withFixture(f => {
    const result = spawnSync('python3', ['-I', '-B', '-c', `
import os, runpy, sys
os.supports_dir_fd = set()
sys.argv = [sys.argv[1], '--check']
runpy.run_path(sys.argv[0], run_name='__main__')
`, helper], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr, /support|descriptor|dir_fd|POSIX/i);
    assert.deepEqual(readdirSync(f.root), []);
    assertOutsideUnchanged(f.outside);
  }));
}
