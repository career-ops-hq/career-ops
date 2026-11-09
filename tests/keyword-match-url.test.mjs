import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, fail, NODE, ROOT, rmSync } from './helpers.mjs';

console.log('\nkeyword-match: URL / jd-text sources');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

const {
  gateUrlJdResult,
  keywordsFromJdText,
  parseMatchArgs,
} = await import(pathToFileURL(join(ROOT, 'keyword-match.mjs')).href);

const dir = mkdtempSync(join(tmpdir(), 'kw-url-'));
const cvPath = join(dir, 'cv.md');
writeFileSync(cvPath, '# Candidate\n\nBuilt Python services and Docker images.\n');

function runCli(extraArgs) {
  return spawnSync(NODE, [join(ROOT, 'keyword-match.mjs'), ...extraArgs], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_ROOT: dir },
  });
}

function richJd() {
  return [
    'Qualifications',
    'We need strong experience with Python, Kubernetes and Docker.',
    'You will build services, ship containers, and operate clusters.',
    'Extra padding so the pasted body clears the shared JD character floor: ',
    'x'.repeat(220),
  ].join('\n');
}

try {
  check('gateUrlJdResult refuses a null fetch (no coverage fields)', () => {
    const gated = gateUrlJdResult('https://example.com/jobs/1', null, null);
    assert.equal(gated.ok, false);
    assert.equal(gated.code, 'fetch-miss');
    assert.match(gated.message, /--jd-text/);
    assert.equal('coveragePct' in gated, false);
    assert.equal('present' in gated, false);
  });

  check('gateUrlJdResult refuses a thin body via jdFailure outcome', () => {
    const gated = gateUrlJdResult(
      'https://example.com/jobs/1',
      { text: 'short', title: 'Role' },
      { code: 'empty_text', error: 'extracted 5 chars of JD text (minimum 200)' },
    );
    assert.equal(gated.ok, false);
    assert.equal(gated.code, 'insufficient');
    assert.match(gated.message, /too thin/);
    assert.match(gated.message, /--jd-text/);
    assert.doesNotMatch(gated.message, /ashby|greenhouse|lever/i);
  });

  check('gateUrlJdResult accepts a body when jdFailure is null', () => {
    const text = richJd();
    const gated = gateUrlJdResult(
      'https://example.com/jobs/1',
      { text, title: 'Engineer', ats: 'example' },
      null,
    );
    assert.equal(gated.ok, true);
    assert.equal(gated.text, text);
    assert.equal(gated.title, 'Engineer');
  });

  check('keywordsFromJdText matches the archived-JD skill path', () => {
    const kws = keywordsFromJdText('Experience with Python, Kubernetes and Docker.\n');
    assert.deepEqual(kws, ['Docker', 'Kubernetes', 'Python']);
  });

  check('parseMatchArgs rejects mixed report + --url', () => {
    assert.throws(
      () => parseMatchArgs(['report.md', '--url', 'https://example.com/j']),
      /exactly one/i,
    );
  });

  check('parseMatchArgs accepts --url alone', () => {
    const args = parseMatchArgs(['--url', 'https://example.com/jobs/9', '--json']);
    assert.deepEqual(args.input, { kind: 'url', url: 'https://example.com/jobs/9' });
    assert.equal(args.jsonMode, true);
  });

  check('CLI --jd-text scores known skills against the CV', () => {
    const jdPath = join(dir, 'jd.txt');
    writeFileSync(jdPath, richJd());
    const r = runCli(['--jd-text', jdPath, '--cv', cvPath, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.keywordSource, 'jd-text');
    assert.ok(out.present.includes('Python'));
    assert.ok(out.present.includes('Docker'));
    assert.ok(out.missing.includes('Kubernetes'));
    assert.equal(out.sourceUrl, undefined);
  });

  check('CLI --jd-text refuses a thin body with no coverage on stdout', () => {
    const jdPath = join(dir, 'thin.txt');
    writeFileSync(jdPath, 'too short');
    const r = runCli(['--jd-text', jdPath, '--cv', cvPath, '--json']);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), '');
    assert.match(r.stderr, /too thin|--jd-text|better link/i);
    assert.doesNotMatch(r.stderr, /ashby|greenhouse|lever/i);
  });

  check('CLI --jd-text refuses a long body with zero known skills', () => {
    const jdPath = join(dir, 'noskill.txt');
    writeFileSync(jdPath, `A long posting about teamwork and culture only. ${'y'.repeat(220)}`);
    const r = runCli(['--jd-text', jdPath, '--cv', cvPath, '--json']);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), '');
    assert.match(r.stderr, /no known skills/i);
    assert.match(r.stderr, /--jd-text|better link/i);
  });

  check('CLI mixed --url and --jd-text exits 1', () => {
    const jdPath = join(dir, 'jd2.txt');
    writeFileSync(jdPath, richJd());
    const r = runCli(['--url', 'https://example.com/jobs/1', '--jd-text', jdPath, '--cv', cvPath]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), '');
    assert.match(r.stderr, /exactly one/i);
  });

  check('CLI mixed report path and --url exits 1', () => {
    const reportPath = join(dir, 'report.md');
    writeFileSync(reportPath, '## Keywords extracted\n- Python\n');
    const r = runCli([reportPath, '--url', 'https://example.com/jobs/1', '--cv', cvPath]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), '');
    assert.match(r.stderr, /exactly one/i);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
