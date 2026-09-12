// tests/merge-tracker-url-dedup.test.mjs — URL-keyed deterministic dedup.
//
// Unit-tests normalizeUrl (pure), then drives the REAL merge-tracker.mjs CLI
// end-to-end against a temp tracker via the CAREER_OPS_TRACKER /
// CAREER_OPS_ADDITIONS env hooks — the merge path is where the bug lived, so
// asserting on the resulting tracker rows is what actually proves the fix.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeUrl } from '../url-key.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MERGE = join(HERE, '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

// ───────────────────────── normalizeUrl (unit) ─────────────────────────
console.log('normalizeUrl()');
ok('strips utm_* and gh_src, keeps gh_jid', () => {
  const a = normalizeUrl('https://careers.airbnb.com/positions/8028783?gh_jid=8028783&utm_source=x&gh_src=abc');
  assert.equal(a, 'https://careers.airbnb.com/positions/8028783?gh_jid=8028783');
});
ok('lowercases host, forces https, drops trailing slash + fragment', () => {
  assert.equal(normalizeUrl('HTTP://Jobs.Lever.co/Stripe/123/#apply'), 'https://jobs.lever.co/Stripe/123');
});
ok('query order does not matter (sorted)', () => {
  assert.equal(normalizeUrl('https://x.com/j?b=2&a=1'), normalizeUrl('https://x.com/j?a=1&b=2'));
});
ok('two genuinely different postings stay different', () => {
  assert.notEqual(
    normalizeUrl('https://job-boards.greenhouse.io/doordashusa/jobs/8027044'),
    normalizeUrl('https://job-boards.greenhouse.io/doordashusa/jobs/8026972'));
});
ok('idempotent', () => {
  const once = normalizeUrl('https://X.com/a/?utm_source=y');
  assert.equal(once, normalizeUrl(once));
});
ok('anything that is not an http(s) posting yields NO key', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
  // Non-http references and placeholders must not become comparable values.
  // The earlier lowercased-string fallback gave every one of these a key, so
  // two unrelated employers whose report said "N/A" matched each other.
  for (const v of ['local:jds/foo.md', 'N/A', 'n/a', 'TBD', '—', '-', 'none', 'see email']) {
    assert.equal(normalizeUrl(v), '', `${JSON.stringify(v)} must yield no key`);
  }
});

// ───────────────────────── merge-tracker (integration) ─────────────────────────
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';

function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'merge-url-test-'));
  const dataDir = join(base, 'data');
  const addDir = join(base, 'additions');
  const reportsDir = join(base, 'reports');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(addDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  const tracker = join(dataDir, 'applications.md');
  return { base, dataDir, addDir, reportsDir, tracker };
}
function writeTracker(env, rows) {
  writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
}
function addTsv(env, name, cols) {
  writeFileSync(join(env.addDir, name), cols.join('\t'));
}
function runMerge(env, args = []) {
  return execFileSync('node', [MERGE, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_TRACKER: env.tracker, CAREER_OPS_ADDITIONS: env.addDir },
  });
}
function trackerRows(env) {
  // Exclude the markdown separator PRECISELY (not any `---`) so rows whose URL
  // contains `---` (Workday slugs) are counted — same bug class as the merge.
  return readFileSync(env.tracker, 'utf-8').split('\n').filter(l => l.startsWith('|') && !/^\|[\s|:-]+\|\s*$/.test(l) && !/^\|\s*#\s*\|/.test(l));
}
// Read the URL cell EXACTLY rather than substring-matching the row. A
// `row.includes(url)` assertion passes when the URL lands in any column — the
// Notes cell, say — so it cannot tell "the key was written" from "the key ended
// up somewhere else". Comparing the parsed cell is what these tests actually
// mean, and it is also what stops CodeQL flagging the URL-substring pattern.
function urlCell(row) {
  const cells = row.split('|').map(s => s.trim());
  // split() yields a leading and trailing empty from the surrounding pipes.
  return cells[cells.length - 2] ?? '';
}
const cleanup = (env) => rmSync(env.base, { recursive: true, force: true });

console.log('\nmerge-tracker — deterministic URL dedup');

ok('THE BUG: two distinct same-company roles with different URLs stay two rows', () => {
  const env = makeEnv();
  try {
    writeTracker(env, [
      '| 1 | 2026-06-01 | Google | Strategy and Operations Lead | 3.8/5 | Evaluated | ❌ | [1](reports/1-google-2026-06-01.md) | n | https://www.google.com/about/careers/applications/jobs/results/111-strategy-and-operations-lead |',
    ]);
    // different posting (gTech), fuzzy-matches "strategy operations" but different URL
    addTsv(env, '2-google.tsv', ['2', '2026-06-25', 'Google', 'Strategy and Operations Senior Associate, gTech Ads', 'Evaluated', '3.9/5', '❌', '[2](reports/2-google-2026-06-25.md)', 'n', 'https://www.google.com/about/careers/applications/jobs/results/222-gtech-ads']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, `expected 2 rows, got ${rows.length}`);
  } finally { cleanup(env); }
});

ok('a NEW row is written WITH its URL (the key must exist to ever match)', () => {
  const env = makeEnv();
  try {
    const url = 'https://boards.greenhouse.io/acme/jobs/9001';
    writeTracker(env, []);
    addTsv(env, '1-acme.tsv', ['1', '2026-06-25', 'Acme', 'Corporate Strategy Manager', 'Evaluated', '4.1/5', '❌', '[1](reports/1-acme.md)', 'n', url]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1);
    assert.equal(urlCell(rows[0]), url, 'new row carries its posting URL');

    // …and the key is live immediately: a second TSV for a DIFFERENT posting at
    // the same company, with a fuzzy-matching title, must not collapse into it.
    addTsv(env, '2-acme.tsv', ['2', '2026-06-26', 'Acme', 'Corporate Strategy Manager, Growth', 'Evaluated', '4.2/5', '❌', '[2](reports/2-acme.md)', 'n', 'https://boards.greenhouse.io/acme/jobs/9002']);
    runMerge(env);
    assert.equal(trackerRows(env).length, 2, 'Pass 0 keeps the two postings apart on the very next run');
  } finally { cleanup(env); }
});

ok('THE REGRESSION: a 9-col re-eval UPDATES a URL-bearing row, never duplicates it', () => {
  const env = makeEnv();
  try {
    const url = 'https://boards.greenhouse.io/acme/jobs/9001';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Acme | Strategy Manager | 4.0/5 | Applied | ✅ | [1](reports/1-acme.md) | n | ${url} |`,
    ]);
    // The DOCUMENTED nine-column TSV: no url field at all. An absent key must
    // not read as "different posting" — same report number, same company.
    addTsv(env, '1-acme.tsv', ['1', '2026-06-20', 'Acme', 'Strategy Manager', 'Applied', '4.4/5', '✅', '[1](reports/1-acme.md)', 're-eval']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1, `expected the row to be UPDATED, got ${rows.length} rows (duplicate)`);
    assert.ok(rows[0].includes('4.4/5'), 're-eval score written through');
    assert.equal(urlCell(rows[0]), url, 'the row kept its key');
  } finally { cleanup(env); }
});

ok('a placeholder **URL:** never becomes a key (no cross-company collapse)', () => {
  const env = makeEnv();
  try {
    writeTracker(env, [
      '| 1 | 2026-06-01 | Acme | Strategy Manager | 4.0/5 | Applied | ✅ | [1](reports/1-acme.md) | n |  |',
      '| 2 | 2026-06-02 | Globex | Finance Lead | 3.9/5 | Applied | ✅ | [2](reports/2-globex.md) | n |  |',
    ]);
    // One report has an EMPTY header (the \s* bug captured the next line), the
    // other a legitimate recruiter-sourced placeholder.
    writeFileSync(join(env.reportsDir, '1-acme.md'), '**Score:** 4.0/5\n**URL:**\n**Legitimacy:** verified\n');
    writeFileSync(join(env.reportsDir, '2-globex.md'), '**Score:** 3.9/5\n**URL:** N/A\n**Legitimacy:** verified\n');
    const out = runMerge(env, ['--backfill-urls']);
    assert.match(out, /0 filled/, 'neither row is fillable — both reports lack a real URL');
    const rows = trackerRows(env);
    for (const r of rows) {
      assert.ok(!r.includes('**Legitimacy:**'), 'never captures the following header line');
      assert.ok(!/\|\s*(N\/A|TBD)\s*\|\s*$/i.test(r), 'never writes a placeholder as a key');
    }
  } finally { cleanup(env); }
});

ok('an update keeps the URL cell (key survives a re-eval)', () => {
  const env = makeEnv();
  try {
    const url = 'https://job-boards.greenhouse.io/doordashusa/jobs/8027044';
    writeTracker(env, [
      `| 4 | 2026-06-01 | DoorDash | Senior Associate, Finance & Strategy | 4.0/5 | Evaluated | ❌ | [4](reports/4-dd.md) | good | ${url} |`,
    ]);
    addTsv(env, '4-dd.tsv', ['4', '2026-06-25', 'DoorDash', 'Senior Associate, Finance & Strategy', 'Evaluated', '4.4/5', '❌', '[4](reports/4-dd.md)', 're-eval', url]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1);
    assert.equal(urlCell(rows[0]), url, 'update path did not blank the URL cell');
    assert.ok(rows[0].includes('4.4/5'), 're-eval score written through');
  } finally { cleanup(env); }
});

ok('control: same two WITHOUT urls collapse (legacy fuzzy fallback)', () => {
  const env = makeEnv();
  try {
    // The pair must be one roleFuzzyMatch STILL considers the same opening.
    // Upstream tightened the matcher (#1881 / #793): the original pair here
    // ("…Lead" vs "…Senior Associate gTech") matched at v1.14 and correctly
    // does not at v1.21, so it no longer exercises the fuzzy fallback. An
    // ampersand/word variant of one title does.
    writeTracker(env, [
      '| 1 | 2026-06-01 | Google | Strategy and Operations Lead | 3.8/5 | Evaluated | ❌ | [1](reports/1-google.md) | n |  |',
    ]);
    addTsv(env, '2-google.tsv', ['2', '2026-06-25', 'Google', 'Strategy & Operations Lead', 'Evaluated', '3.9/5', '❌', '[2](reports/2-google.md)', 'n']);
    runMerge(env);
    assert.equal(trackerRows(env).length, 1, 'no-URL rows still collapse via fuzzy (fallback)');
  } finally { cleanup(env); }
});

ok('URL match → last-write-wins, even when the new score is LOWER', () => {
  const env = makeEnv();
  try {
    const url = 'https://explore.jobs.netflix.net/careers/job/790316748684';
    writeTracker(env, [
      `| 5 | 2026-06-01 | Netflix | Associate, Product FP&A | 4.4/5 | Evaluated | ❌ | [5](reports/5-netflix.md) | stale wrong-high | ${url} |`,
    ]);
    addTsv(env, '5-netflix.tsv', ['5', '2026-06-25', 'Netflix', 'Associate, Product FP&A', 'Evaluated', '2.8/5', '❌', '[5](reports/5-netflix.md)', 'corrected', url]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1, 'same URL → one row');
    assert.ok(rows[0].includes('2.8/5'), 'LWW: corrected lower score wins (not pinned at 4.4)');
    assert.ok(!rows[0].includes('4.4/5'), 'stale wrong-high score is gone');
  } finally { cleanup(env); }
});

ok('URL match → status never downgrades (monotonic funnel)', () => {
  const env = makeEnv();
  try {
    const url = 'https://job-boards.greenhouse.io/doordashusa/jobs/8027044';
    writeTracker(env, [
      `| 7 | 2026-06-01 | DoorDash | Senior Associate, Finance & Strategy | 4.0/5 | Interview | ✅ | [7](reports/7-dd.md) | n | ${url} |`,
    ]);
    addTsv(env, '7-dd.tsv', ['7', '2026-06-25', 'DoorDash', 'Senior Associate, Finance & Strategy', 'Evaluated', '4.3/5', '❌', '[7](reports/7-dd.md)', 're-eval', url]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].includes('Interview'), 'status stays Interview, not downgraded to Evaluated');
    assert.ok(rows[0].includes('4.3/5'), 'score advances via LWW');
    assert.ok(rows[0].includes('✅'), 'PDF ✅ is not lost to a ❌ re-eval (monotonic)');
  } finally { cleanup(env); }
});

ok('terminal status (Rejected) is absorbing — re-eval cannot revive it', () => {
  const env = makeEnv();
  try {
    const url = 'https://jobs.ashbyhq.com/openai/abc';
    writeTracker(env, [
      `| 9 | 2026-06-01 | OpenAI | GTM Strategy & Operations | 3.4/5 | Rejected | ❌ | [9](reports/9-openai.md) | n | ${url} |`,
    ]);
    addTsv(env, '9-openai.tsv', ['9', '2026-06-25', 'OpenAI', 'GTM Strategy & Operations', 'Evaluated', '3.6/5', '❌', '[9](reports/9-openai.md)', 're-eval', url]);
    runMerge(env);
    assert.ok(trackerRows(env)[0].includes('Rejected'), 'Rejected stays Rejected');
  } finally { cleanup(env); }
});

ok('9-col TSV (no url) still parses + inserts (backward compat)', () => {
  const env = makeEnv();
  try {
    writeTracker(env, []);
    addTsv(env, '3-acme.tsv', ['3', '2026-06-25', 'Acme', 'Strategy Manager', 'Evaluated', '4.0/5', '❌', '[3](reports/3-acme.md)', 'note']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].includes('Acme') && rows[0].includes('4.0/5'));
  } finally { cleanup(env); }
});

ok('--backfill-urls fills empty url from the linked report, idempotently', () => {
  const env = makeEnv();
  try {
    writeFileSync(join(env.reportsDir, '11-snap-2026-06-25.md'),
      '# Eval\n**URL:** https://snapchat.wd1.myworkdayjobs.com/snap/job/LA/Senior-Specialist_R1\n');
    writeTracker(env, [
      '| 11 | 2026-06-25 | Snap | Senior Specialist, Product S&O | 3.8/5 | Evaluated | ❌ | [11](../reports/11-snap-2026-06-25.md) | n |  |',
    ]);
    runMerge(env, ['--backfill-urls']);
    let rows = trackerRows(env);
    assert.ok(rows[0].includes('myworkdayjobs.com/snap/job/LA/Senior-Specialist_R1'), 'url backfilled from report');
    // idempotent: a second run changes nothing
    const before = readFileSync(env.tracker, 'utf-8');
    runMerge(env, ['--backfill-urls']);
    assert.equal(readFileSync(env.tracker, 'utf-8'), before, 'second backfill is a no-op');
  } finally { cleanup(env); }
});

// NOTE: an earlier revision of this PR also guarded against an unscoreable
// re-eval (N/A → parseScore 0) overwriting a real score on a URL match. That
// guard is gone, deliberately: the hazard is neither URL-specific nor this
// PR's. On pristine main an N/A re-eval already overwrites a real score through
// the report-number tier — #2411 made re-evals write through in both
// directions, and parseScore('N/A') is 0, so an absent score is
// indistinguishable from a downgrade to zero. Fixing that inside the URL branch
// would have hidden a general bug behind a new key and left the fuzzy tiers
// exposed. Reported separately instead.

ok('no-URL addition does NOT clobber a URL-bearing row (over-dedup guard)', () => {
  const env = makeEnv();
  try {
    const url = 'https://stripe.com/jobs/listing/company-strategy/111';
    writeTracker(env, [
      `| 6 | 2026-06-01 | Stripe | Company Strategy & Operations | 4.0/5 | Applied | ✅ | [6](reports/6-stripe.md) | tracked | ${url} |`,
    ]);
    // same company+role, but NO url on the addition → must not seize the known posting's row
    addTsv(env, '7-stripe.tsv', ['7', '2026-06-25', 'Stripe', 'Company Strategy & Operations', 'Evaluated', '4.5/5', '❌', '[7](reports/7-stripe.md)', 'different posting']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, 'inserts a new row instead of clobbering the URL-bearing one');
    const orig = rows.find(r => r.includes('[6]') || r.includes('| 6 |'));
    assert.ok(orig && orig.includes('Applied') && orig.includes('✅') && orig.includes('4.0/5'), 'original Applied row untouched');
  } finally { cleanup(env); }
});

ok('buildRow round-trips a Location + URL layout (COLMAP-driven)', () => {
  const env = makeEnv();
  try {
    const H = '| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes | URL |';
    const S = '|---|---|---|---|---|---|---|---|---|---|---|';
    const url = 'https://snapchat.wd1.myworkdayjobs.com/snap/job/LA/Sr_R1';
    writeFileSync(env.tracker, ['# T', '', H, S,
      `| 8 | 2026-06-01 | Snap | Sr Specialist, S&O | Los Angeles | 3.8/5 | Interview | ✅ | [8](reports/8-snap.md) | n | ${url} |`, ''].join('\n'));
    addTsv(env, '8-snap.tsv', ['8', '2026-06-25', 'Snap', 'Sr Specialist, S&O', 'Evaluated', '4.0/5', '❌', '[8](reports/8-snap.md)', 're-eval', url]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].split('|').length, H.split('|').length, 'same column count as header (no misalignment)');
    assert.ok(rows[0].includes('Los Angeles'), 'Location preserved across the re-eval');
    assert.ok(rows[0].includes('4.0/5') && rows[0].includes('Interview') && rows[0].includes('✅'), 'LWW score, status kept, PDF kept');
  } finally { cleanup(env); }
});

ok('legacy 9-col tracker (no URL column) still merges; URL is dropped, no crash', () => {
  const env = makeEnv();
  try {
    const H = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
    const S = '|---|---|---|---|---|---|---|---|---|';
    writeFileSync(env.tracker, ['# T', '', H, S, ''].join('\n'));
    addTsv(env, '9-acme.tsv', ['9', '2026-06-25', 'Acme', 'Strategy Manager', 'Evaluated', '4.0/5', '❌', '[9](reports/9-acme.md)', 'n', 'https://acme.com/jobs/9']);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].split('|').length, H.split('|').length, 'row stays 9-col');
    assert.ok(!/https?:\/\//.test(rows[0]), 'URL dropped (no column to hold it)');
    assert.ok(rows[0].includes('4.0/5') && rows[0].includes('Acme'));
  } finally { cleanup(env); }
});

ok('--backfill-urls resolves a ROOT-relative reports/ link (the P0 regression)', () => {
  const env = makeEnv();
  try {
    writeFileSync(join(env.reportsDir, '13-figma-2026-06-25.md'),
      '# Eval\n**URL:** https://job-boards.greenhouse.io/figma/jobs/13\n');
    // root-relative link (the common real-tracker style), data/ layout
    writeTracker(env, [
      '| 13 | 2026-06-25 | Figma | Strategy & Ops | 3.5/5 | Evaluated | ❌ | [13](reports/13-figma-2026-06-25.md) | n |  |',
    ]);
    runMerge(env, ['--backfill-urls']);
    assert.ok(trackerRows(env)[0].includes('greenhouse.io/figma/jobs/13'), 'root-relative link resolved + url backfilled');
  } finally { cleanup(env); }
});

ok('row with `---` in its URL (Workday slug) stays visible to dedup', () => {
  const env = makeEnv();
  try {
    // Workday URLs encode `&`/spaces as `--`/`---`; the merge must not mistake
    // such a data row for the markdown separator and drop it from existingApps.
    const url = 'https://snapchat.wd1.myworkdayjobs.com/snap/job/LA/Senior-Specialist--Product-Strategy---Operations_R1';
    writeTracker(env, [
      `| 20 | 2026-06-01 | Snap | Senior Specialist, Product S&O | 3.0/5 | Evaluated | ❌ | [20](reports/20-snap.md) | n | ${url} |`,
    ]);
    addTsv(env, '20-snap.tsv', ['20', '2026-06-25', 'Snap', 'Senior Specialist, Product S&O', 'Evaluated', '4.0/5', '❌', '[20](reports/20-snap.md)', 're-eval', url]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1, 'updated in place, not duplicated, despite --- in the URL');
    assert.ok(rows[0].includes('4.0/5'), 'the row was found and LWW-updated');
  } finally { cleanup(env); }
});
