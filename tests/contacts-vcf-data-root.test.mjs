// tests/contacts-vcf-data-root.test.mjs — contacts.mjs --vcf measures its write
// guard against the data root, the same root it reads contacts from and
// defaults its output into.
//
// contacts.mjs resolves three things:
//
//   CONTACTS_PATH = join(DATA_ROOT, 'data/contacts.tsv')    (read)
//   DEFAULT_VCF   = join(DATA_ROOT, 'output/contacts.vcf')  (default target)
//   CAREER_OPS    = dirname(fileURLToPath(import.meta.url)) (guard anchor)
//
// and the path-traversal guard measured the target against CAREER_OPS, the
// directory the script lives in. When CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR /
// .career-ops-data puts the user layer outside the checkout, the command's own
// default output counted as "outside the project directory", so `--vcf` exited
// 1 and wrote nothing.
//
// tests/contacts.test.mjs copies the script into a temp dir, which makes the
// code root and the data root the same directory and hides the case. Each check
// here runs the real script with the data root, the checkout and the working
// directory all different.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';

const SCRIPT = join(ROOT, 'contacts.mjs');

const CONTACT = [
  'Jane Doe', 'Acme', 'recruiter', 'Talent Partner', '', 'jane@acme.example', '', '-', 'met at screen',
].join('\t');

function fixture() {
  // realpath: see tests/gmail-state-data-root.test.mjs.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'contacts-vcf-')));
  const dataRoot = join(base, 'data-root');
  const workDir = join(base, 'cwd');
  mkdirSync(join(dataRoot, 'data'), { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(
    join(dataRoot, 'data', 'contacts.tsv'),
    `# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes\n${CONTACT}\n`,
  );
  return { base, dataRoot, workDir };
}

function run(f, args, envName = 'CAREER_OPS_ROOT') {
  const env = { ...process.env };
  delete env.CAREER_OPS_ROOT;
  delete env.CAREER_OPS_DATA_DIR;
  env[envName] = f.dataRoot;
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: f.workDir, env, encoding: 'utf8', timeout: 20000 });
}

test('--vcf writes its default output into the data root when the data root is not the checkout', () => {
  const f = fixture();
  try {
    const r = run(f, ['--vcf']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Wrote 1 contact/);
    const out = join(f.dataRoot, 'output', 'contacts.vcf');
    assert.ok(existsSync(out), 'vCard lands in <data root>/output/contacts.vcf');
    assert.match(readFileSync(out, 'utf8'), /FN:Jane Doe/);
    assert.ok(!existsSync(join(f.workDir, 'output')), 'nothing written under the cwd');
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});

test('--vcf accepts an explicit path inside the data root (CAREER_OPS_DATA_DIR spelling)', () => {
  const f = fixture();
  try {
    const target = join(f.dataRoot, 'output', 'custom.vcf');
    const r = run(f, ['--vcf', target], 'CAREER_OPS_DATA_DIR');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(target), 'vCard lands at the explicit path');
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});

test('--vcf still refuses a target outside the data root', () => {
  const f = fixture();
  try {
    const outside = join(f.workDir, 'escape.vcf');
    const r = run(f, ['--vcf', outside]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Refusing to write the vCard outside the project directory/);
    assert.ok(!existsSync(outside), 'the guard leaves no file outside the data root');
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});

test('--vcf refuses a path into the checkout when the data root is elsewhere', () => {
  // The guard exists to stop escapes; with the data root elsewhere the checkout
  // is just another outside directory, so a path into it is refused too.
  const f = fixture();
  const inCheckout = join(ROOT, 'output', `contacts-vcf-guard-${process.pid}-${Date.now()}.vcf`);
  try {
    const r = run(f, ['--vcf', inCheckout]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Refusing to write the vCard outside the project directory/);
    assert.ok(!existsSync(inCheckout), 'nothing written into the checkout');
  } finally {
    rmSync(inCheckout, { force: true }); // only matters if the guard regresses
    rmSync(f.base, { recursive: true, force: true });
  }
});
