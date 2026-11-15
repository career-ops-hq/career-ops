import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCvHumanTone } from '../scripts/cv-human-check.mjs';

test('passes a varied, plain-language CV', () => {
  const sample = `
## Experience
- Cut p99 API latency from 420ms to 110ms by moving session reads to Redis.
- Migrated 14 Terraform modules to AWS Provider v5 with zero downtime.
- On-call lead during the Q3 billing outage; wrote the postmortem and added circuit breakers.
- Built a GitHub Actions matrix that trimmed CI runtimes by 9 minutes.
`;
  const res = checkCvHumanTone(sample);
  assert.equal(res.passed, true);
  assert.deepEqual(res.warnings, []);
});

test('flags banned AI vocabulary and template connectors', () => {
  const sample = `
- Spearheaded a robust migration by leveraging cloud-native tools, resulting in 40% efficiency.
`;
  const res = checkCvHumanTone(sample);
  assert.equal(res.passed, false);
  assert.ok(res.warnings.some((w) => w.includes('spearheaded')));
  assert.ok(res.warnings.some((w) => w.includes('robust')));
  assert.ok(res.warnings.some((w) => w.includes('template connector')));
});

test('flags em-dash overuse and 4+ consecutive <Verb>ed bullets', () => {
  const sample = `
- Built service A — with zero issues — and shipped fast.
- Deployed service B to prod.
- Configured monitoring alerts.
- Updated deployment pipelines.
- Fixed flaky integration tests.
`;
  const res = checkCvHumanTone(sample);
  assert.equal(res.passed, false);
  assert.ok(res.warnings.some((w) => w.includes('Em-dash count is 2')));
  assert.ok(res.warnings.some((w) => w.includes('4+ consecutive bullets')));
});

test('HTML: ignores em-dashes in <style>, <script> and comments', () => {
  const sample = `<html><head><title>Jane Doe</title>
<style>
/* page margin — matches generate-pdf.mjs — keep in sync */
</style>
<script>// helper — not CV text</script>
</head><body>
<!-- section break — template note -->
<ul>
  <li>Cut p99 API latency from 420ms to 110ms by moving session reads to Redis.</li>
  <li>Built a GitHub Actions matrix that trimmed CI runtimes by 9 minutes.</li>
</ul>
</body></html>`;
  const res = checkCvHumanTone(sample);
  assert.equal(res.passed, true, res.warnings.join('; '));
});

test('HTML: end tags with spaces or attributes and --!> comments are still dropped', () => {
  const sample = `<html><head>
<style media="print">
/* page margin — matches generate-pdf.mjs — keep in sync */
</style >
<script type="module">// helper — not CV text</script foo="bar">
</head><body>
<!-- section break — template note --!>
<ul>
  <li>Cut p99 API latency from 420ms to 110ms by moving session reads to Redis.</li>
  <li>Built a GitHub Actions matrix that trimmed CI runtimes by 9 minutes.</li>
</ul>
</body></html>`;
  const res = checkCvHumanTone(sample);
  assert.equal(res.passed, true, res.warnings.join('; '));
});

test('HTML: <li> bullets count toward the <Verb>ed streak', () => {
  const sample = `<ul>
<li>Deployed service B to prod.</li><li>Configured monitoring alerts.</li>
<li>Updated deployment pipelines.</li>
<li>Fixed flaky integration tests.</li>
</ul>`;
  const res = checkCvHumanTone(sample);
  assert.equal(res.passed, false);
  assert.ok(res.warnings.some((w) => w.includes('4+ consecutive bullets')));
});

test('CLI exits 0 for clean file, 1 for flagged file, and 2 for missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-human-check-'));
  try {
    const cleanPath = join(dir, 'clean.md');
    const badPath = join(dir, 'bad.md');
    writeFileSync(cleanPath, '- Built a CLI tool in Node.js.\n', 'utf8');
    writeFileSync(badPath, '- Spearheaded holistic synergy.\n', 'utf8');

    const out = execFileSync(process.execPath, ['scripts/cv-human-check.mjs', cleanPath], { encoding: 'utf8' });
    assert.match(out, /passed/);

    assert.throws(
      () => execFileSync(process.execPath, ['scripts/cv-human-check.mjs', badPath], { stdio: 'pipe' }),
      (err) => err.status === 1
    );

    assert.throws(
      () => execFileSync(process.execPath, ['scripts/cv-human-check.mjs', join(dir, 'missing.md')], { stdio: 'pipe' }),
      (err) => err.status === 2
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
