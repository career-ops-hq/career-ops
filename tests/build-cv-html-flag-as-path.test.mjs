// tests/build-cv-html-flag-as-path.test.mjs — build-cv-html never treats a
// flag as a file path.
//
// main() took the Markdown branch only on the bare token `--markdown`, so
// `--markdown=out.md` fell through to the HTML path. That path reads its
// arguments by position with no flag check, so `--markdown=out.md`, a
// `--preview` written after the payload, or a mistyped flag became the output
// path: a full HTML CV was written to a file named after the flag in the
// current directory, with "valid": true at exit 0, and the file asked for was
// never made. The Markdown path already refused a flag as its output.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const PAYLOAD = {
  lang: 'en',
  candidate: { name: 'Test Candidate', title: 'Senior Engineer', email: 'test@example.com', location: 'Remote' },
  summary: 'Builds things.',
  competencies: ['Testing'],
  experience: [{ company: 'Acme Corp', role: 'Senior Engineer', location: 'Remote', dates: '2021 – Present', bullets: ['Shipped things.'] }],
  projects: [],
  education: [{ title: 'BSc', org: 'Test University', year: '2015' }],
  certifications: [],
  awards: [],
  skills: [{ category: 'Tools', items: ['Node.js'] }],
};

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

// Runs in its own folder, which is also the data root, so a stray output
// lands where the test can see it.
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'build-cv-html-flags-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'output'));
  writeFileSync(join(dir, 'in.json'), JSON.stringify(PAYLOAD));
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = dir;
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'build-cv-html.mjs'), ...args], { cwd: dir, env, encoding: 'utf8', timeout: 30000 });
  const stray = () => readdirSync(dir).filter((name) => name.startsWith('-'));
  return { dir, run, stray };
}

test('--markdown=<path> renders Markdown to <path>, like --markdown <path>', () => {
  const { dir, run, stray } = workspace();
  const r = run('in.json', '--markdown=output/cv.md');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(readFileSync(join(dir, 'output', 'cv.md'), 'utf8'), /^# Test Candidate/);
  assert.deepEqual(stray(), []);
});

test('an empty --markdown= is a usage error', () => {
  const { run, stray } = workspace();
  const r = run('in.json', '--markdown=');
  assert.equal(r.status, 1, describeSpawn(r));
  assert.match(r.stderr, /Usage: node build-cv-html\.mjs <input\.json> --markdown <output\.md>/, describeSpawn(r));
  assert.deepEqual(stray(), []);
});

test('a flag in a path slot is refused, not written to', () => {
  for (const args of [['in.json', '--preview'], ['in.json', 'output/cv.html', '--frobnicate']]) {
    const { dir, run, stray } = workspace();
    const r = run(...args);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stderr, /Unknown or misplaced flag: --/, describeSpawn(r));
    assert.deepEqual(stray(), []);
    assert.equal(existsSync(join(dir, 'output', 'cv.html')), false);
  }
});

test('the documented forms still build', () => {
  const { dir, run } = workspace();
  const html = run('in.json', 'output/cv.html');
  assert.equal(html.status, 0, describeSpawn(html));
  assert.match(readFileSync(join(dir, 'output', 'cv.html'), 'utf8'), /^<!DOCTYPE html>/i);
  const preview = run('--preview', 'in.json');
  assert.equal(preview.status, 0, describeSpawn(preview));
  assert.equal(existsSync(join(dir, 'output', 'cv-preview.html')), true);
});
