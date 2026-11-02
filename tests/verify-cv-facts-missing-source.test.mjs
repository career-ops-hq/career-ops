// tests/verify-cv-facts-missing-source.test.mjs — a --source path that does
// not exist is refused, not read as an empty CV.
//
// verify-cv-facts.mjs read every source through readIfExists(), so a
// mistyped --source was empty evidence: every metric in the CV was "absent
// from sources", the run blocked, and the advice said "cv.md and
// article-digest.md do not contain these claims. Add career evidence to one of
// them." The target path was already checked for existence; the sources were
// not. generate-latex.mjs refuses a missing --source the same way.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const dir = mkdtempSync(join(tmpdir(), 'vcf-missing-source-'));
try {
  const target = join(dir, 'cv.html');
  const source = join(dir, 'cv.md');
  const config = join(dir, 'cv-facts.json');
  writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));
  writeFileSync(target, '<html><body><p>Led a team of 4 engineers and cut latency by 30%.</p></body></html>');
  writeFileSync(source, '# CV\n\n- Led a team of 4 engineers and cut latency by 30%.\n');
  const run = (...sources) => {
    const r = spawnSync(NODE, [join(ROOT, 'verify-cv-facts.mjs'), '--config', config, ...sources.flatMap((s) => ['--source', s]), target], { encoding: 'utf-8', timeout: 30000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  console.log('\nverify-cv-facts — a missing --source is an error, not empty evidence');

  ok('premise: the real source passes', () => {
    const r = run(source);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /CV fact check passed/);
  });

  ok('a mistyped --source is refused by name, without blaming the CV', () => {
    const r = run(`${source}.typo`);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.out, /--source file not found: .*cv\.md\.typo/);
    assert.doesNotMatch(r.out, /Add career evidence/);
  });

  ok('one missing --source among real ones is still refused', () => {
    // Dropping it silently would check the CV against less than the user named.
    const r = run(source, join(dir, 'digest.md'));
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.out, /--source file not found: .*digest\.md/);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
