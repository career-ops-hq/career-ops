// tests/rejection-latency-placeholder-rows.test.mjs — an Interview-state
// application with a placeholder employer must not vanish from the latency
// signal without a word (#1596 for the marker, #3410's neighbourhood).
//
// companyKey() strips everything that is not a letter or a digit, so `?` — the
// documented marker for an undisclosed end employer — normalizes to the empty
// string, and parseTrackerInterviewRows' `if (!key) continue` discarded the row.
// The `—`/`-` no-data sentinels went the same way.
//
// This is the wrong blind spot for this particular check to have. It exists to
// flag applications that have gone quiet, and agency-brokered roles — the ones
// carrying `?` plus a via= field — are where the candidate has the least
// visibility and ghosting is most common. A report that omits them silently
// reads as "nothing is overdue", not "I did not look at these".
//
// Two sibling readers of the same two files, reply-matcher.mjs and
// process-quality.mjs, each already recognised placeholders explicitly. This
// one had neither copy, which is why lib/placeholder-cell.mjs now holds the
// single definition all three import.
//
// Run:  node --test tests/rejection-latency-placeholder-rows.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { placeholderInterviewRows, parseTrackerInterviewRows, groupIdentity } =
  await import(pathToFileURL(join(ROOT, 'rejection-latency.mjs')).href);

// One named employer and three that name nothing: the `?` of #1596 and both
// no-data sentinels. All four are in Interview state.
const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Interview | ✅ | [1](r1.md) | n |',
  '| 2 | 2026-01-06 | ? | Staff Engineer | 4.5/5 | Interview | ✅ | [2](r2.md) | via=Hays |',
  '| 3 | 2026-01-07 | — | ML Lead | 4.1/5 | Interview | ✅ | [3](r3.md) | n |',
  '| 4 | 2026-01-08 | - | Platform Lead | 4.0/5 | Interview | ✅ | [4](r4.md) | n |',
  '| 5 | 2026-01-09 | Globex | SRE | 4.3/5 | Applied | ✅ | [5](r5.md) | not interviewing |',
  '',
].join('\n');

test('placeholder employers are reported, not silently dropped', () => {
  const excluded = placeholderInterviewRows(TRACKER);
  assert.equal(excluded.length, 3, `expected the ?/—/- rows to be reported, got ${JSON.stringify(excluded.map(r => r.company))}`);
  assert.deepEqual(excluded.map(r => r.num).sort((a, b) => a - b), [2, 3, 4]);
});

test('only Interview-state rows count — this signal is about interview silence', () => {
  // Row 5 is Applied with a real company; a placeholder in some other state is
  // not something this check would have looked at anyway, so counting it would
  // overstate the gap.
  const applied = TRACKER.replace(
    '| 2 | 2026-01-06 | ? | Staff Engineer | 4.5/5 | Interview |',
    '| 2 | 2026-01-06 | ? | Staff Engineer | 4.5/5 | Applied |',
  );
  assert.equal(placeholderInterviewRows(applied).length, 2, 'a non-Interview placeholder row was counted');
});

test('named companies are untouched by the placeholder path', () => {
  // Guard: the fix must not start excluding real employers. Acme still groups.
  const byCompany = parseTrackerInterviewRows(TRACKER);
  assert.ok(byCompany.has('acme'), 'the named company stopped being grouped');
  assert.equal(byCompany.size, 1, `a placeholder leaked into company grouping: ${[...byCompany.keys()].join(',')}`);
});

test('an empty or malformed tracker returns nothing rather than throwing', () => {
  assert.deepEqual(placeholderInterviewRows(''), []);
  assert.deepEqual(placeholderInterviewRows(null), []);
  assert.deepEqual(placeholderInterviewRows('not a table at all'), []);
});

test('the CLI states the gap in its warnings and metadata', () => {
  // End to end, because the value of this fix is entirely in the user being
  // told. A count that never reaches the report is the same silence.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-rejlat-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), TRACKER);
    writeFileSync(join(dir, 'data', 'active-interviews.md'), [
      '| Company | Role | Date | Round | Notes |',
      '|---|---|---|---|---|',
      '| Acme | Backend Engineer | 2026-01-20 | 2 | n |',
      '',
    ].join('\n'));
    const r = spawnSync(process.execPath, [join(ROOT, 'rejection-latency.mjs'), '--today', '2026-06-01'], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.equal(
      out.metadata?.placeholderApplicationsExcluded,
      3,
      `the report does not say how many applications it could not see: ${JSON.stringify(out.metadata)}`,
    );
    assert.ok(
      (out.warnings || []).some((w) => /placeholder/i.test(w) && /#2/.test(w)),
      `no warning named the excluded rows: ${JSON.stringify(out.warnings)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

// ── via= is read, not just recommended ─────────────────────────────────────
//
// The first version of this fix told the user to "put the agency in a via=
// field", and nothing read it: applying the remediation returned the identical
// warning. Advice the code does not honour is worse than no advice, because the
// user spends the effort and gets the same output.
//
// process-quality.mjs:190-205 had already solved this for the same data — a `?`
// row that names its CHANNEL identifies something real, since every round
// brokered by one agency is one relationship, and that is the thing going quiet.
// groupIdentity mirrors it, including the normalized `?` prefix that keeps
// `— (via Hays)` from keying apart from `? (via Hays)`.

const TRACKER_WITH_VIA = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Via |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Interview | ✅ | [1](r1.md) | n | |',
  '| 2 | 2026-01-06 | ? | Staff Engineer | 4.5/5 | Interview | ✅ | [2](r2.md) | n | Hays |',
  '| 3 | 2026-01-07 | ? | ML Lead | 4.1/5 | Interview | ✅ | [3](r3.md) | n | |',
  '',
].join('\n');

test('a placeholder employer with via= groups under that channel', () => {
  const byCompany = parseTrackerInterviewRows(TRACKER_WITH_VIA);
  assert.ok(byCompany.has('acme'), 'the named company stopped grouping');
  assert.ok(
    [...byCompany.keys()].some((k) => k.startsWith('?via:')),
    `the via= row was not grouped: ${[...byCompany.keys()].join(', ')}`,
  );
});

test('and is no longer counted as excluded — the remediation actually works', () => {
  // The regression this closes: the warning named via= while the counter
  // ignored it, so a user who added via= got the same message forever.
  const excluded = placeholderInterviewRows(TRACKER_WITH_VIA);
  assert.deepEqual(
    excluded.map((r) => r.num),
    [3],
    `only the row naming neither employer nor channel should remain excluded, got ${JSON.stringify(excluded.map((r) => r.num))}`,
  );
});

test('the group label carries the channel, so no blacklist row names a bare "?"', () => {
  // data/blacklist.md is matched by NAME. A suggestion row reading `| ? |`
  // would be a do-not-apply entry naming no company.
  assert.equal(groupIdentity('?', 'Hays').label, '? (via Hays)');
  assert.equal(groupIdentity('Acme', '').label, 'Acme');
  assert.equal(groupIdentity('?', ''), null, 'a row naming neither employer nor channel must identify nothing');
});

test('every placeholder spelling keys to the same channel bucket', () => {
  // `— (via Hays)` and `? (via Hays)` are one channel; keeping the cell's own
  // spelling would split its totals — this function's own bug in miniature.
  const keys = ['?', '—', '-', ''].map((c) => groupIdentity(c, 'Hays')?.key);
  assert.equal(new Set(keys).size, 1, `placeholder spellings split the bucket: ${JSON.stringify(keys)}`);
});

test('an unattributable round in active-interviews.md is reported too', () => {
  // The flags come from active-interviews.md, not the tracker. The first
  // version counted only tracker rows, so a `?` round there was still dropped
  // silently — a named tracker row plus one `?` round gave zero of everything.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-rejlat-rounds-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-01-05 | Acme | Backend Engineer | 4.2/5 | Interview | ✅ | [1](r1.md) | n |', '',
    ].join('\n'));
    writeFileSync(join(dir, 'data', 'active-interviews.md'), [
      '| Company | Role | Date | Round | Notes |',
      '|---|---|---|---|---|',
      '| ? | Staff Engineer | 2026-01-21 | 2 | agency-brokered |', '',
    ].join('\n'));
    const r = spawnSync(process.execPath, [join(ROOT, 'rejection-latency.mjs'), '--today', '2026-06-01'], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    assert.ok(
      (out.warnings || []).some((w) => /active-interviews\.md could not be attributed/i.test(w)),
      `the dropped interview round was not reported: ${JSON.stringify(out.warnings)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('--summary does not print an all-clear over rows it could not assess', () => {
  // "No post-interview silence exceeded the configured thresholds" printed above
  // a warning about unassessed rows is a claim about a subset, presented as
  // covering the whole file — the same silence, one line higher.
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-rejlat-allclear-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-01-05 | ? | Staff Engineer | 4.5/5 | Interview | ✅ | [1](r1.md) | n |', '',
    ].join('\n'));
    writeFileSync(join(dir, 'data', 'active-interviews.md'), '| Company | Role | Date | Round | Notes |\n|---|---|---|---|---|\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'rejection-latency.mjs'), '--summary', '--today', '2026-06-01'], {
      cwd: ROOT, encoding: 'utf-8', timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '' },
    });
    const all = `${r.stdout}${r.stderr}`;
    assert.doesNotMatch(
      all,
      /No post-interview silence exceeded the configured thresholds/,
      `an all-clear was printed for a tracker whose only Interview rows could not be assessed:\n${all.slice(0, 500)}`,
    );
    assert.match(all, /could not be/i, 'the summary did not say anything went unassessed');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
