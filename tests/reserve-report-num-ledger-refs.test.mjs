// Regression: a tracker number that a deleted or merged-away row leaves behind
// in the ledgers must not be handed to a new application.
//
// status-log.tsv, data/follow-ups.md, data/salary-observations.tsv and
// data/contacts.tsv all key on the tracker `#`. Neither `tracker.mjs delete` nor
// dedup-tracker.mjs rewrites them, so the removed row's history stays under its
// old number. The allocator counted only report files, sentinels and the rows
// still in the tracker: when the removed row was the highest number and no
// report file carried it, the next reservation reused that number, and the new
// application inherited the old one's transitions and follow-ups.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { reserveReportNumbers, releaseReportNumbers } from '../reserve-report-num.mjs';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

// The allocator and the spawned writers honor these ahead of the scratch root,
// so a developer's own overrides could feed real follow-ups into the count or
// receive a reservation sentinel. Every reader treats empty as unset. The
// children get them blanked in their own env; peek() passes explicit paths and
// blanks the one with no option for the duration of the call only, because
// test-all imports suites in-process and shares process.env with later ones.
const PATH_OVERRIDES = ['CAREER_OPS_REPORTS_DIR', 'CAREER_OPS_FOLLOWUPS', 'CAREER_OPS_BATCH_STATE'];

const HEADER = '# Applications Tracker\n\n'
  + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
  + '|---|------|---------|------|-------|--------|-----|--------|-------|\n';

function scratchRoot(rows, { reports = [], data = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rrn-ledger-'));
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data/applications.md'), HEADER + rows.join('\n') + '\n');
  for (const f of reports) writeFileSync(join(dir, 'reports', f), '# x\n');
  for (const [name, content] of Object.entries(data)) writeFileSync(join(dir, 'data', name), content);
  return dir;
}

async function peek(dir, { trackerPath = join(dir, 'data/applications.md') } = {}) {
  const opts = {
    rootDir: dir,
    reportsDir: join(dir, 'reports'),
    trackerPath,
    batchStateFile: join(dir, 'batch/batch-state.tsv'),
  };
  const saved = process.env.CAREER_OPS_FOLLOWUPS;
  process.env.CAREER_OPS_FOLLOWUPS = '';
  try {
    const nums = await reserveReportNumbers(1, opts);
    await releaseReportNumbers(nums, opts);
    return nums[0];
  } finally {
    if (saved === undefined) delete process.env.CAREER_OPS_FOLLOWUPS;
    else process.env.CAREER_OPS_FOLLOWUPS = saved;
  }
}

function run(dir, args) {
  return spawnSync(NODE, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...Object.fromEntries(PATH_OVERRIDES.map(name => [name, ''])),
      CAREER_OPS_ROOT: dir,
      CAREER_OPS_TRACKER: '',
    },
  });
}

async function check(name, dir, expect, peekOpts) {
  try {
    const got = await peek(dir, peekOpts);
    if (got === expect) pass(`${name} → ${got}`);
    else fail(`${name}: expected ${expect}, got ${got}`);
  } catch (err) {
    fail(`${name}: threw ${err.message.split('\n')[0]}`);
  }
}

// Delete: #3 was added by hand (no report), applied to and followed up on, then
// removed with `tracker.mjs delete`. Its ledger lines still say #3.
{
  const dir = scratchRoot([
    '| 1 | 2026-10-01 | Acme | Backend Engineer | 4.0/5 | Evaluated | ❌ | [001](reports/001-acme-2026-10-01.md) | |',
    '| 2 | 2026-10-02 | Globex | Data Engineer | 3.8/5 | Evaluated | ❌ | [002](reports/002-globex-2026-10-02.md) | |',
    '| 3 | 2026-10-03 | Initech | Platform Engineer | N/A | Applied | ❌ | — | added by hand |',
  ], {
    reports: ['001-acme-2026-10-01.md', '002-globex-2026-10-02.md'],
    data: {
      'status-log.tsv': '3\t2026-10-03\tEvaluated\tApplied\tset-status\t\n',
      'follow-ups.md': '# Follow-ups\n\n| # | App | Date | Company | Role | Channel | Contact | Notes |\n'
        + '|---|-----|------|---------|------|---------|---------|-------|\n'
        + '| 1 | 3 | 2026-10-10 | Initech | Platform Engineer | Email | Pat | first nudge |\n',
    },
  });
  try {
    const res = run(dir, ['tracker.mjs', 'delete', '--num', '3']);
    const tracker = readFileSync(join(dir, 'data/applications.md'), 'utf-8');
    if (tracker.includes('| 3 |')) fail(`delete fixture: row #3 still in the tracker (exit ${res.status}: ${res.stderr.trim()})`);
    else await check('a deleted row\'s number stays taken while its ledger lines exist', dir, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Merge: #2 and #3 are one evaluation (both link report 002). dedup-tracker
// keeps the higher-scored #2, moves #3's Applied onto it and removes #3. The
// follow-up and transition recorded against #3 stay there.
{
  const dir = scratchRoot([
    '| 1 | 2026-10-01 | Acme | Backend Engineer | 4.0/5 | Evaluated | ❌ | [001](reports/001-acme-2026-10-01.md) | |',
    '| 2 | 2026-10-02 | Globex | Data Engineer | 4.5/5 | Evaluated | ❌ | [002](reports/002-globex-2026-10-02.md) | |',
    '| 3 | 2026-10-02 | Globex | Data Engineer | 3.0/5 | Applied | ❌ | [002](reports/002-globex-2026-10-02.md) | |',
  ], {
    reports: ['001-acme-2026-10-01.md', '002-globex-2026-10-02.md'],
    data: {
      'status-log.tsv': '3\t2026-10-04\tEvaluated\tApplied\tset-status\t\n',
      'salary-observations.tsv': '3\t2026-10-04\tdesired\t150000\tUSD\trecruiter-call\t\n',
    },
  });
  try {
    const res = run(dir, ['dedup-tracker.mjs']);
    const tracker = readFileSync(join(dir, 'data/applications.md'), 'utf-8');
    if (tracker.includes('| 3 |')) fail(`merge fixture: dedup-tracker kept row #3 (exit ${res.status}: ${res.stderr.trim()})`);
    else await check('a merged-away row\'s number stays taken while its ledger lines exist', dir, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Contacts carry the tracker # in their eighth column; `-` is "no application".
{
  const dir = scratchRoot([
    '| 1 | 2026-10-01 | Acme | Backend Engineer | 4.0/5 | Evaluated | ❌ | [001](reports/001-acme-2026-10-01.md) | |',
  ], {
    reports: ['001-acme-2026-10-01.md'],
    data: {
      'contacts.tsv': 'Pat Lee\tInitech\trecruiter\tTalent Partner\t\tpat@example.com\t\t7\t\n'
        + 'Sam Roe\tGlobex\tpeer\t\t\t\t\t-\t\n',
    },
  });
  try {
    await check('a contact\'s tracker # is taken; a `-` is not a number', dir, 8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Ledgers with nothing beyond the tracker change nothing.
{
  const dir = scratchRoot([
    '| 1 | 2026-10-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | [001](reports/001-acme-2026-10-01.md) | |',
  ], {
    reports: ['001-acme-2026-10-01.md'],
    data: {
      'status-log.tsv': '1\t2026-10-02\tEvaluated\tApplied\tset-status\t\nnot-a-number\tjunk\n',
      'follow-ups.md': '- 2026-10-09 · #1 Acme — legacy bullet\n- next #1 2026-10-20\n',
    },
  });
  try {
    await check('ledgers that only name live rows leave numbering alone', dir, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A `#N` in follow-ups prose is not a reference; only the table, the legacy
// bullet and the next/cleared directives name an application.
{
  const dir = scratchRoot([
    '| 1 | 2026-10-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | [001](reports/001-acme-2026-10-01.md) | |',
  ], {
    reports: ['001-acme-2026-10-01.md'],
    data: {
      'follow-ups.md': '# Follow-ups\n\n- Review issue #5000 before the next nudge\n- see #4000 for context\n'
        + '- cleared #3 2026-10-21\n',
    },
  });
  try {
    await check('prose `#N` in follow-ups is ignored; a cleared directive still counts', dir, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A ledger that exists but cannot be read fails the reservation instead of
// counting as empty, which is how its numbers would be handed out again.
{
  const dir = scratchRoot([
    '| 1 | 2026-10-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | [001](reports/001-acme-2026-10-01.md) | |',
  ], { reports: ['001-acme-2026-10-01.md'] });
  mkdirSync(join(dir, 'data/contacts.tsv'));
  try {
    const got = await peek(dir);
    fail(`an unreadable ledger was read as empty (reserved ${got})`);
  } catch (err) {
    if (err?.code === 'EISDIR') pass('an unreadable ledger fails the reservation instead of reading as empty');
    else fail(`an unreadable ledger: expected EISDIR, got ${err?.code ?? err?.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A tracker outside the data root's data/ (CAREER_OPS_TRACKER): a status change
// seeds its follow-up beside that tracker, not in data/follow-ups.md.
{
  const dir = scratchRoot([], { reports: ['001-acme-2026-10-01.md'] });
  const elsewhere = join(dir, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  writeFileSync(join(elsewhere, 'applications.md'), HEADER
    + '| 1 | 2026-10-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | [001](reports/001-acme-2026-10-01.md) | |\n');
  writeFileSync(join(elsewhere, 'follow-ups.md'), '- next #6 2026-10-20 (set 2026-10-13)\n');
  try {
    await check('a follow-up seeded beside a relocated tracker is counted', dir, 7,
      { trackerPath: join(elsewhere, 'applications.md') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
