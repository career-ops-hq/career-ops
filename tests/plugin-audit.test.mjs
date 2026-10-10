import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPlugin } from '../plugin-audit.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'plugin-audit.mjs');

function runAudit(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 10_000,
  });
  assert.equal(r.error, undefined, `plugin-audit.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `plugin-audit.mjs was killed by ${r.signal} (timeout?)`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('--help prints usage and exits 0', () => {
  const r = runAudit('--help');
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node plugin-audit\.mjs <plugin-dir>/);
  assert.equal(r.status, 0, '--help must exit 0');
});

test('-h prints usage and exits 0', () => {
  const r = runAudit('-h');
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /node plugin-audit\.mjs <plugin-dir>/);
  assert.equal(r.status, 0, '-h must exit 0');
});

test('--bogus unrecognized flag is rejected and exits 1', () => {
  const r = runAudit('--bogus');
  assert.match(r.stderr, /Error: unrecognized flag\(s\): --bogus/);
  assert.match(r.stderr, /Usage:/);
  assert.notEqual(r.status, 0, 'unrecognized flag must exit non-zero');
});

test('valid directory runs the audit', () => {
  // Use a known existing plugin directory from the repository.
  const r = runAudit('plugins/apify');
  // It shouldn't print usage or flag errors.
  assert.doesNotMatch(r.all, /unrecognized flag/);
  assert.doesNotMatch(r.all, /Usage:/);
});

test('help exits before checking a missing directory', () => {
  for (const flag of ['--help', '-h']) {
    const r = runAudit(flag, join(ROOT, '__missing_plugin_audit_fixture__'));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
    assert.equal(r.stderr, '');
  }
});

test('--bogus --help is rejected as unknown flag before checking help', () => {
  const r = runAudit('--bogus', '--help');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Error: unrecognized flag\(s\): --bogus/);
});

// A symlink must not be a place to hide code from the audit (#3818). The
// hand-rolled walk this replaced read a symlinked FILE (a link's Dirent is not
// a directory, so it fell through to the file branch) but never descended a
// symlinked DIRECTORY. Both resolve on import(), so both are scanned now — the
// old walk's file half kept, its directory hole closed.
test('code reached through a symlinked file or directory is audited', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-audit-links-'));
  try {
    const outside = join(dir, 'outside');
    const plugin = join(dir, 'plugin');
    mkdirSync(join(outside, 'lib'), { recursive: true });
    mkdirSync(plugin);
    writeFileSync(join(plugin, 'index.mjs'), 'export default {};\n');
    writeFileSync(join(outside, 'evil.mjs'), "export default () => eval('1');\n");
    writeFileSync(join(outside, 'lib', 'deep.mjs'), "export default () => eval('2');\n");
    try {
      symlinkSync(join(outside, 'evil.mjs'), join(plugin, 'linked.mjs'), 'file');
      symlinkSync(join(outside, 'lib'), join(plugin, 'vendor'), 'dir');
    } catch {
      t.skip('this machine cannot create symlinks (Windows without Developer Mode)');
      return;
    }

    const { ok, findings } = auditPlugin(plugin);
    const flagged = new Set(findings.filter((f) => /eval/.test(f.issue)).map((f) => f.file));
    assert.equal(ok, false, 'a plugin whose linked code calls eval() must fail the audit');
    assert.ok(flagged.has('linked.mjs'), `a symlinked file was not audited: ${JSON.stringify(findings)}`);
    assert.ok(flagged.has('vendor/deep.mjs'), `a file under a symlinked directory was not audited: ${JSON.stringify(findings)}`);
    // Named by the path inside the plugin, not the link's target, so a finding
    // points the reviewer at the file the plugin actually ships.
    assert.ok(![...flagged].some((f) => f.includes('outside')), `findings named the link target: ${[...flagged]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
