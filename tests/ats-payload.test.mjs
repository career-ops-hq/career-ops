// tests/ats-payload.test.mjs — the CLI contract of ats-payload.mjs (#3251).
//
// The unit-level behaviour (the fold, its idempotency, the three lints) is
// pinned by `node ats-payload.mjs --self-test`, registered in test-all.mjs's
// script list. What CANNOT be pinned from inside the module is the property the
// whole design rests on: stdout carries the payload and ONLY the payload, so
// `node ats-payload.mjs cv.json > cv-ats.json` yields a file build-cv-html.mjs
// can read, while every human-facing word goes to stderr. A findings line that
// leaked into stdout would corrupt the artifact and nothing inside the module
// would notice.
//
// HERMETIC: tmpdir fixtures only; nothing reads or writes real user data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'ats-payload.mjs');

function run(args, { input } = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    input,
    timeout: 30_000,
  });
  assert.equal(r.error, undefined, `ats-payload.mjs failed to spawn: ${r.error?.message}`);
  assert.equal(r.signal, null, `ats-payload.mjs was killed by ${r.signal} (timeout?)`);
  return r;
}

function withFixture(payload, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ats-payload-'));
  try {
    const file = join(dir, 'cv.json');
    writeFileSync(file, JSON.stringify(payload, null, 2));
    return fn(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DIRTY_PAYLOAD = {
  candidate: { name: 'Jane Smith', email: 'jane@example.com', location: 'San Francisco, CA' },
  summary: 'Backend engineer.',
  competencies: ['RAG Pipelines', 'LLMOps', 'Kubernetes & Docker'],
  experience: [{
    company: 'Globex (Cloud Platform Division)',
    role: 'Lead Engineer at Initech',
    dates: '2016 - 2019, 2021 - Present',
    bullets: ['Shipped a retrieval pipeline'],
  }],
  skills: [{ category: 'Languages', items: 'Python, Go' }],
};

// ── stdout is the payload, stderr is everything else ────────────────────────

test('stdout parses as the transformed payload and nothing else', () => {
  withFixture(DIRTY_PAYLOAD, (file) => {
    const r = run([file]);
    assert.equal(r.status, 0, `exited ${r.status}: ${r.stderr}`);
    const out = JSON.parse(r.stdout); // throws if a finding leaked into stdout
    assert.deepEqual(out.competencies, []);
    assert.deepEqual(out.skills[0], {
      category: 'Core Competencies',
      items: 'RAG Pipelines, LLMOps, Kubernetes & Docker',
    });
    assert.deepEqual(out.skills[1], { category: 'Languages', items: 'Python, Go' });
  });
});

test('findings go to stderr as JSON by default', () => {
  withFixture(DIRTY_PAYLOAD, (file) => {
    const r = run([file]);
    const report = JSON.parse(r.stderr);
    assert.equal(report.transform.applied, true);
    assert.deepEqual(
      report.findings.map((f) => f.code),
      ['employer-in-role', 'parenthetical-in-company', 'multiple-date-ranges'],
    );
  });
});

test('--summary prints the human report to stderr and leaves stdout machine-readable', () => {
  withFixture(DIRTY_PAYLOAD, (file) => {
    const r = run([file, '--summary']);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /ATS Payload Transform/);
    assert.match(r.stderr, /reported, NOT applied/);
    assert.doesNotThrow(() => JSON.parse(r.stdout));
  });
});

test('findings are advisory — a payload with all three lints still exits 0', () => {
  withFixture(DIRTY_PAYLOAD, (file) => {
    assert.equal(run([file]).status, 0);
  });
});

test('the input file is never rewritten', () => {
  withFixture(DIRTY_PAYLOAD, (file) => {
    const before = readFileSync(file, 'utf-8');
    run([file]);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });
});

test('a payload can be piped in on stdin', () => {
  const r = run(['-'], { input: JSON.stringify(DIRTY_PAYLOAD) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).competencies, []);
});

// ── Idempotency through the CLI (#3251, santifer's requested edge) ───────────

test('running the transform twice produces a byte-identical payload', () => {
  withFixture(DIRTY_PAYLOAD, (file, dir) => {
    const first = run([file]).stdout;
    const foldedFile = join(dir, 'cv-ats.json');
    writeFileSync(foldedFile, first);
    const second = run([foldedFile]).stdout;
    assert.equal(second, first, 'a second pass changed the payload');
    const skills = JSON.parse(second).skills;
    assert.equal(
      skills.filter((s) => s.category === 'Core Competencies').length,
      1,
      'the second pass duplicated the Core Competencies category',
    );
  });
});

// ── The reason the transform exists: what build-cv-html.mjs then renders ─────

test('the folded payload renders comma-delimited under Skills, with no CSS-only tag spans', () => {
  withFixture(DIRTY_PAYLOAD, (file, dir) => {
    const foldedFile = join(dir, 'cv-ats.json');
    writeFileSync(foldedFile, run([file]).stdout);
    const htmlFile = join(dir, 'cv.html');

    const build = spawnSync(process.execPath, [join(ROOT, 'build-cv-html.mjs'), foldedFile, htmlFile], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30_000,
    });
    assert.equal(build.status, 0, `build-cv-html.mjs failed: ${build.stderr}`);

    const html = readFileSync(htmlFile, 'utf-8');
    // The defect: competency tags separated by `gap: 8px` and nothing else, so
    // the extracted text layer runs adjacent competencies into one token.
    assert.ok(
      !html.includes('<span class="competency-tag">'),
      'competencies still render as CSS-separated tag spans',
    );
    // The fix: the same facts, comma-delimited, under a header parsers know.
    assert.match(
      html,
      /<span class="skill-category">Core Competencies: <\/span>RAG Pipelines, LLMOps, Kubernetes &amp; Docker/,
    );
  });
});

// ── Failure modes ───────────────────────────────────────────────────────────

test('--help exits 0 and prints usage', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test('an unrecognized flag is named and refused', () => {
  const r = run(['--sumary']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unrecognized flag/i);
  assert.ok(r.stderr.includes('--sumary'));
});

test('--help --bogus still errors', () => {
  const r = run(['--help', '--bogus']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unrecognized flag/i);
});

test('a missing file exits 1 and writes nothing to stdout', () => {
  const r = run([join(tmpdir(), 'ats-payload-does-not-exist.json')]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /cannot read payload/);
});

test('malformed JSON exits 1 and writes nothing to stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-payload-bad-'));
  try {
    const file = join(dir, 'cv.json');
    writeFileSync(file, '{ "competencies": [');
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a JSON array is refused — a payload is an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-payload-arr-'));
  try {
    const file = join(dir, 'cv.json');
    writeFileSync(file, '[]');
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a CV payload object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a string skills field is refused rather than silently discarded (PR #3422)', () => {
  // The regression this guards: `skills` was normalized to [] before the fold,
  // so "Python" vanished and stdout carried a well-formed-looking payload with
  // the skills gone — data loss disguised as a clean result.
  const r = run(['-'], { input: JSON.stringify({ competencies: ['AWS'], skills: 'Python' }) });
  assert.equal(r.status, 1, `exited ${r.status}, want 1`);
  assert.equal(r.stdout, '', 'a refused payload must not reach stdout');
  assert.match(r.stderr, /unusable payload shape/);
  assert.match(r.stderr, /`skills` must be an array/);
});

test('a non-array experience is refused rather than reported as clean', () => {
  // Otherwise the lints iterate [] and print "No lint findings", which reads
  // exactly like a genuinely clean payload.
  const r = run(['-'], { input: JSON.stringify({ experience: { company: 'Acme' } }) });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /`experience` must be an array/);
});

test('a valid array skills field is preserved through the fold', () => {
  const r = run(['-'], {
    input: JSON.stringify({ competencies: ['AWS'], skills: [{ category: 'Languages', items: 'Python' }] }),
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.skills, [
    { category: 'Core Competencies', items: 'AWS' },
    { category: 'Languages', items: 'Python' },
  ]);
});

test('an absent skills field is still fine', () => {
  const r = run(['-'], { input: JSON.stringify({ competencies: ['AWS'] }) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).skills, [{ category: 'Core Competencies', items: 'AWS' }]);
});

test('a mixed-type competencies array is refused rather than silently thinned', () => {
  // The reported input: the container is an array, so the earlier container
  // check passed, while toItemList() dropped the object and the fold emitted
  // `items: "AWS"` — one competency gone from a payload that looked fine.
  const r = run(['-'], { input: JSON.stringify({ competencies: ['AWS', { name: 'Kubernetes' }] }) });
  assert.equal(r.status, 1, `exited ${r.status}, want 1`);
  assert.equal(r.stdout, '', 'a refused payload must not reach stdout');
  assert.match(r.stderr, /`competencies` has 1 member\(s\) with no scalar value/);
  assert.match(r.stderr, /\[1\] \(object\)/);
});

test('a numeric competency is accepted, not refused', () => {
  // The guard is drawn at what is LOST, not at what is non-string: String()
  // carries a numeric scalar through, and build-cv-html.mjs renders it
  // (tests/cv-numeric-scalars.test.mjs). Rejecting it would make this script
  // stricter than the builder it feeds.
  const r = run(['-'], { input: JSON.stringify({ competencies: ['AWS', 2024] }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).skills[0].items, 'AWS, 2024');
});

test('a non-scalar in the skills category the fold merges into is refused', () => {
  const r = run(['-'], {
    input: JSON.stringify({
      competencies: ['A'],
      skills: [{ category: 'Core Competencies', items: ['X', { y: 1 }] }],
    }),
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Merging the competencies into it would drop them/);
});

test('a skills category the fold never touches is not policed for it', () => {
  const r = run(['-'], {
    input: JSON.stringify({
      competencies: ['A'],
      skills: [{ category: 'Languages', items: ['X', { y: 1 }] }],
    }),
  });
  assert.equal(r.status, 0, r.stderr);
});

test('a scalar items on the merge target is refused and reaches stdout not at all', () => {
  // toItemList() returns [] for a non-string non-array, so the merge REPLACED
  // `items: 2024` with the folded competencies — the supplied value silently
  // overwritten in the artifact this script exists to produce safely.
  for (const items of [2024, true, { a: 1 }]) {
    const r = run(['-'], {
      input: JSON.stringify({ competencies: ['A'], skills: [{ category: 'Core Competencies', items }] }),
    });
    assert.equal(r.status, 1, `items=${JSON.stringify(items)} exited ${r.status}, want 1`);
    assert.equal(r.stdout, '', `items=${JSON.stringify(items)} let a payload reach stdout`);
    assert.match(r.stderr, /a string or array is expected/);
  }
});

test('a string items on the merge target merges instead of being replaced', () => {
  const r = run(['-'], {
    input: JSON.stringify({ competencies: ['A'], skills: [{ category: 'Core Competencies', items: 'X' }] }),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).skills[0].items, 'X, A');
});

test('a scalar items on a category the fold never touches is not policed', () => {
  const r = run(['-'], {
    input: JSON.stringify({ competencies: ['A'], skills: [{ category: 'Languages', items: 2024 }] }),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).skills[1].items, 2024, 'the untouched value must pass through unchanged');
});

test('a second positional argument is refused rather than ignored', () => {
  withFixture(DIRTY_PAYLOAD, (file) => {
    const r = run([file, 'extra.json']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unexpected extra positional argument/);
  });
});
