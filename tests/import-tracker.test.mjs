// tests/import-tracker.test.mjs — import-tracker.mjs adds the applications in
// another tracker's CSV export to applications.md, dry run by default.
//
// Every case runs the REAL CLI against a temp data root with fictional rows,
// then reads the tracker back. No real user data is used or copied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { getBash } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'import-tracker.mjs');

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|------|---------|------|-------|--------|-----|--------|-------|-----|';
const trackerText = (rows) => ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n');
const EXISTING = [
  '| 1 | 2026-06-01 | Northwind Grocers | Data Analyst | 4.2/5 | Responded | ✅ | [1](reports/001-northwind-grocers-2026-06-01.md) | Remote | |',
  '| 2 | 2026-06-02 | Bramblewood Bank | BI Developer | 3.9/5 | Evaluated | ❌ | [2](reports/002-bramblewood-bank-2026-06-02.md) | | [example.com](https://jobs.example.com/bramblewood/77) |',
];

const TEAL_CSV = [
  'Company,Job Position,Status,Date Applied,Location,Job URL,Excitement',
  'Larkspur Analytics,"Analytics Engineer, Platform",Applied,7/3/2026,Remote,https://jobs.example.com/larkspur/1,4',
  'Quillfeather Health,Data Analyst II,Interviewing,7/14/2026,"Denver, CO",https://jobs.example.com/quillfeather/2,5',
  'Tidewater Freight,BI Developer,Not Selected,8/1/2026,,,3',
  'Saltmarsh Labs,Analytics Engineer,Negotiating,8/2/2026,,,5',
  'Fennwick Insurance,Data Analyst,Withdrawn,8/3/2026,,,1',
  'Cobaltline Energy,Senior Data Analyst,Bookmarked,,,https://jobs.example.com/cobaltline/3,2',
  'Northwind Grocers,Data Analyst,Interviewing,6/1/2026,,,4',
  'Granite Hollow Bank,BI Developer,Applied,8/5/2026,,https://jobs.example.com/bramblewood/77,3',
  'Marrowfield Foods,Analytics Engineer,Hold for later review,8/6/2026,,,3',
].join('\r\n');

function makeRoot({ tracker = trackerText(EXISTING), csv = TEAL_CSV, baseDir = tmpdir() } = {}) {
  const root = mkdtempSync(join(baseDir, 'import-tracker-test-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  const trackerPath = join(root, 'data', 'applications.md');
  if (tracker !== null) writeFileSync(trackerPath, tracker);
  const csvPath = join(root, 'export.csv');
  writeFileSync(csvPath, csv);
  return { root, trackerPath, csvPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(fx, args = [], { csv = fx.csvPath, cwd, env: extra } = {}) {
  const env = { ...process.env, CAREER_OPS_ROOT: fx.root, CAREER_OPS_TRACKER: '', CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER_DB: join(fx.root, 'tracker.db') };
  delete env.CAREER_OPS_ADDITIONS;
  delete env.CAREER_OPS_REPORTS_DIR;
  delete env.CAREER_OPS_PDF_INDEX;
  Object.assign(env, extra);
  return spawnSync(process.execPath, [SCRIPT, csv, ...args], { encoding: 'utf-8', env, cwd, timeout: 60_000 });
}

function withRoot(opts, fn) {
  const fx = makeRoot(opts);
  try { return fn(fx); } finally { fx.cleanup(); }
}

function rowsOf(text) {
  return text.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
}

function rowFor(text, company) {
  return rowsOf(text).find((cells) => cells[3] === company);
}

test('a dry run is the default and writes nothing', () => {
  withRoot({}, (fx) => {
    const before = readFileSync(fx.trackerPath, 'utf-8');
    const r = run(fx);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.match(r.stdout, /5 to import/);
    assert.equal(readFileSync(fx.trackerPath, 'utf-8'), before, 'tracker must be byte-identical');
    assert.equal(existsSync(join(fx.root, 'batch', 'tracker-additions')), false, 'no addition files in a dry run');
  });
});

test('--confirm adds each applied row with an ISO date, a tracker state and the N/A score', () => {
  withRoot({}, (fx) => {
    const r = run(fx, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r));
    const text = readFileSync(fx.trackerPath, 'utf-8');
    assert.equal(rowsOf(text).length, EXISTING.length + 5);

    const larkspur = rowFor(text, 'Larkspur Analytics');
    assert.deepEqual(larkspur.slice(2, 9), ['2026-07-03', 'Larkspur Analytics', 'Analytics Engineer, Platform', 'N/A', 'Applied', '❌', '—']);
    assert.match(larkspur[10], /\(https:\/\/jobs\.example\.com\/larkspur\/1\)/, 'posting link kept in the URL column');

    const states = Object.fromEntries(['Quillfeather Health', 'Tidewater Freight', 'Saltmarsh Labs', 'Fennwick Insurance']
      .map((c) => [c, rowFor(text, c)[6]]));
    assert.deepEqual(states, {
      'Quillfeather Health': 'Interview',
      'Tidewater Freight': 'Rejected',
      'Saltmarsh Labs': 'Offer',
      'Fennwick Insurance': 'Discarded',
    });
    assert.match(rowFor(text, 'Quillfeather Health')[9], /Interviewing/, 'the source stage stays readable in Notes');
  });
});

test('rows the tracker already holds, unapplied stages and unknown stages are not added', () => {
  withRoot({}, (fx) => {
    const r = run(fx, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r));
    const text = readFileSync(fx.trackerPath, 'utf-8');
    assert.equal(rowsOf(text).filter((c) => c[3] === 'Northwind Grocers').length, 1, 'same company and role is not added twice');
    assert.equal(rowFor(text, 'Northwind Grocers')[6], 'Responded', 'an import never rewrites a tracked row');
    assert.equal(rowFor(text, 'Granite Hollow Bank'), undefined, 'same posting URL as #2 is not added');
    assert.equal(rowFor(text, 'Cobaltline Energy'), undefined, 'a bookmarked posting was never applied to');
    assert.equal(rowFor(text, 'Marrowfield Foods'), undefined, 'an unknown stage is not guessed');
    assert.match(r.stdout, /"Hold for later review"/, 'the unknown stage is named');
  });
});

test('a stage named like an object property is an unknown stage, not a crash', () => {
  const csv = 'Company,Title,Status\nAcme Example,Analyst,constructor\nGlobex Example,Engineer,Applied\n';
  withRoot({ csv }, (fx) => {
    const r = run(fx, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r));
    const text = readFileSync(fx.trackerPath, 'utf-8');
    assert.equal(rowFor(text, 'Acme Example'), undefined);
    assert.equal(rowFor(text, 'Globex Example')[6], 'Applied');
  });
});

test('a second import of the same file adds nothing', () => {
  withRoot({}, (fx) => {
    assert.equal(run(fx, ['--confirm']).status, 0);
    const once = readFileSync(fx.trackerPath, 'utf-8');
    const r = run(fx, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r));
    assert.equal(readFileSync(fx.trackerPath, 'utf-8'), once);
  });
});

test('--confirm leaves no reservation or addition file behind', () => {
  withRoot({}, (fx) => {
    assert.equal(run(fx, ['--confirm']).status, 0);
    assert.deepEqual(readdirSync(join(fx.root, 'reports')), [], 'reserved numbers are released');
    assert.equal(existsSync(join(fx.root, 'batch', 'tracker-additions')), false, 'confirm does not use the shared additions directory');
  });
});

test('--confirm does not merge or remove a TSV that was already waiting', () => {
  withRoot({}, (fx) => {
    const dir = join(fx.root, 'batch', 'tracker-additions');
    mkdirSync(dir, { recursive: true });
    const decoy = join(dir, '900-decoy-co.tsv');
    writeFileSync(decoy, 'pending decoy\n');
    const envDir = mkdtempSync(join(tmpdir(), 'import-tracker-env-'));
    const envDecoy = join(envDir, '901-other-co.tsv');
    writeFileSync(envDecoy, 'env decoy\n');
    try {
      const inherited = run(fx, ['--confirm'], { env: { CAREER_OPS_ADDITIONS: envDir } });
      assert.equal(inherited.status, 0, describeSpawn(inherited));
      assert.equal(readFileSync(decoy, 'utf-8'), 'pending decoy\n');
      assert.equal(readFileSync(envDecoy, 'utf-8'), 'env decoy\n');
      assert.ok(rowFor(readFileSync(fx.trackerPath, 'utf-8'), 'Larkspur Analytics'));
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});

test('a relative CSV name is read from the data root', () => {
  withRoot({}, (fx) => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'import-tracker-cwd-'));
    writeFileSync(join(elsewhere, 'export.csv'), 'Company,Job Position,Status\nNot The File,Analyst,Applied\n');
    try {
      const r = run(fx, [], { csv: 'export.csv', cwd: elsewhere });
      assert.equal(r.status, 0, describeSpawn(r));
      assert.match(r.stdout, /5 to import/);
      assert.doesNotMatch(r.stdout, /Not The File/);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

test('a fresh install with no tracker gets one holding the imported rows', () => {
  withRoot({ tracker: null }, (fx) => {
    const r = run(fx, ['--confirm']);
    assert.equal(r.status, 0, describeSpawn(r));
    const text = readFileSync(fx.trackerPath, 'utf-8');
    assert.equal(rowsOf(text).length, 7);
    assert.match(rowFor(text, 'Larkspur Analytics')[10], /jobs\.example\.com\/larkspur\/1/);
  });
});

test('slash dates read day first when the file proves it', () => {
  const csv = 'Company,Title,Date Applied\nAcme Example,Analyst,03/04/2026\nGlobex Example,Engineer,25/04/2026\n';
  withRoot({ csv }, (fx) => {
    assert.equal(run(fx, ['--confirm']).status, 0);
    const text = readFileSync(fx.trackerPath, 'utf-8');
    assert.equal(rowFor(text, 'Acme Example')[2], '2026-04-03');
    assert.equal(rowFor(text, 'Globex Example')[2], '2026-04-25');
  });
});

test('a date column mixing day-first and month-first dates is refused', () => {
  const csv = 'Company,Title,Date Applied\nAcme Example,Analyst,04/25/2026\nGlobex Example,Engineer,25/04/2026\n';
  withRoot({ csv }, (fx) => {
    const before = readFileSync(fx.trackerPath, 'utf-8');
    const r = run(fx, ['--confirm']);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stderr, /day\/month\/year and month\/day\/year/);
    assert.equal(readFileSync(fx.trackerPath, 'utf-8'), before);
  });
});

test('a Huntr-style export reads its list and created date', () => {
  const csv = 'Job Title,Company,Created At,List,Source\nAnalyst,Initech Example,2026-09-14T15:04:05.000Z,Interview,LinkedIn\nEngineer,Hooli Example,2026-09-15T09:00:00.000Z,Wishlist,Indeed\n';
  withRoot({ csv }, (fx) => {
    assert.equal(run(fx, ['--confirm']).status, 0);
    const text = readFileSync(fx.trackerPath, 'utf-8');
    assert.deepEqual(rowFor(text, 'Initech Example').slice(2, 7), ['2026-09-14', 'Initech Example', 'Analyst', 'N/A', 'Interview']);
    assert.equal(rowFor(text, 'Hooli Example'), undefined);
  });
});

test('a file with no role column is refused with the headers it has', () => {
  withRoot({ csv: 'Employer,Salary\nAcme Example,100\n' }, (fx) => {
    const r = run(fx);
    assert.equal(r.status, 1, describeSpawn(r));
    assert.match(r.stderr, /"Employer", "Salary"/);
  });
});

test('--confirm refuses links a tracker with no URL column cannot keep', () => {
  const noUrl = ['# Applications Tracker', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|---|---|---|---|---|---|---|---|', ''].join('\n');
  const csv = [
    'Company,Job Position,Status,Date Applied,Job URL',
    'Larkspur Analytics,Analytics Engineer,Applied,7/3/2026,https://jobs.example.com/larkspur/1',
    'Larkspur Analytics,Analytics Engineer,Applied,7/9/2026,https://jobs.example.com/larkspur/2',
  ].join('\n');
  withRoot({ tracker: noUrl, csv }, (fx) => {
    const result = run(fx, ['--confirm']);
    assert.equal(result.status, 1, describeSpawn(result));
    assert.match(result.stderr, /no URL column/);
    assert.match(result.stderr, /--backfill-urls/);
    assert.doesNotMatch(result.stdout, /Run again with --confirm/);
    assert.equal(readFileSync(fx.trackerPath, 'utf-8'), noUrl, 'nothing is written');
  });
  const linkless = 'Company,Job Position,Status,Date Applied\nLarkspur Analytics,Analytics Engineer,Applied,7/3/2026\n';
  withRoot({ tracker: noUrl, csv: linkless }, (fx) => {
    const result = run(fx, ['--confirm']);
    assert.equal(result.status, 0, describeSpawn(result));
    assert.ok(rowFor(readFileSync(fx.trackerPath, 'utf-8'), 'Larkspur Analytics'));
  });
});

// One shell word as shellQuote prints it: bare, or single-quoted (a Windows or
// spaced path).
const ARG = "(?:[^\\s']+|'[^']*')";
const QUILLFEATHER_REFUSED = [
  'Company,Job Position,Status,Date Applied,Notes',
  'Larkspur Analytics,Analytics Engineer,Applied,7/3/2026,',
  'Quillfeather Health,Data Analyst II,Applied,7/14/2026,see [7](reports/007-quillfeather-health-2026-07-14.md)',
].join('\n');
const BATCH_HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n';

// Clear the failed batch entry, then run the printed re-run from another
// directory with none of the import's overrides set.
function rerunFromElsewhere(fx, retry) {
  writeFileSync(join(fx.root, 'batch', 'batch-state.tsv'), BATCH_HEADER);
  const env = { ...process.env };
  for (const name of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_BATCH_STATE', 'CAREER_OPS_ADDITIONS']) delete env[name];
  const rerun = spawnSync(getBash(), ['-c', retry], { encoding: 'utf-8', env, cwd: tmpdir(), timeout: 60_000 });
  assert.equal(rerun.status, 0, describeSpawn(rerun));
  assert.ok(rowFor(readFileSync(fx.trackerPath, 'utf-8'), 'Quillfeather Health'), 'the re-run adds the row to the same tracker');
}

test('a row merge refuses keeps its file and number and fails the import', () => {
  const csv = [
    'Company,Job Position,Status,Date Applied,Notes',
    'Larkspur Analytics,Analytics Engineer,Applied,7/3/2026,',
    'Quillfeather Health,Data Analyst II,Applied,7/14/2026,see [7](reports/007-quillfeather-health-2026-07-14.md)',
  ].join('\n');
  withRoot({ csv }, (fx) => {
    mkdirSync(join(fx.root, 'batch'), { recursive: true });
    writeFileSync(join(fx.root, 'batch', 'batch-state.tsv'),
      'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n'
      + '1\thttps://jobs.example.com/quillfeather/2\tfailed\t-\t-\t7\t-\tno JD\t0\n');
    const result = run(fx, ['--confirm']);
    assert.equal(result.status, 1, describeSpawn(result));
    const tracker = readFileSync(fx.trackerPath, 'utf-8');
    assert.ok(rowFor(tracker, 'Larkspur Analytics'), 'the other row is still added');
    assert.equal(rowFor(tracker, 'Quillfeather Health'), undefined);
    assert.match(result.stderr, /1 row\(s\) were not added: \d+-quillfeather-health\.tsv/);
    const dir = /stay in (\S+) with their numbers reserved/.exec(result.stderr)?.[1];
    assert.ok(dir, describeSpawn(result));
    try {
      const left = readdirSync(dir).filter((f) => f.endsWith('.tsv'));
      assert.equal(left.length, 1);
      assert.match(readFileSync(join(dir, left[0]), 'utf-8'), /Quillfeather Health/);
      assert.notDeepEqual(readdirSync(join(fx.root, 'reports')), [], 'the refused row keeps its reserved number');
      // The printed re-run works from another directory with none of the
      // import's overrides set: it carries the root and the script's full path.
      const retry = /then run:\n {2}(.+)\n/.exec(result.stderr)?.[1];
      assert.ok(retry, describeSpawn(result));
      assert.match(retry, new RegExp(`^CAREER_OPS_ROOT=${ARG} CAREER_OPS_ADDITIONS=${ARG} node ${ARG}$`));
      assert.match(retry, /merge-tracker\.mjs'?$/);
      rerunFromElsewhere(fx, retry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('the printed re-run makes relative tracker and batch-state overrides absolute', () => {
  // Keep this disposable fixture on the codebase drive so the override is
  // relative on Windows too. Its cwd decoy stays inside the same fixture.
  withRoot({ csv: QUILLFEATHER_REFUSED, baseDir: ROOT }, (fx) => {
    mkdirSync(join(fx.root, 'batch'), { recursive: true });
    writeFileSync(join(fx.root, 'batch', 'batch-state.tsv'),
      BATCH_HEADER + '1\thttps://jobs.example.com/quillfeather/2\tfailed\t-\t-\t7\t-\tno JD\t0\n');
    const elsewhere = join(fx.root, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    const trackerOverride = relative(ROOT, fx.trackerPath);
    const decoy = resolve(elsewhere, trackerOverride);
    assert.notEqual(decoy, fx.trackerPath);
    mkdirSync(dirname(decoy), { recursive: true });
    const decoyText = trackerText(EXISTING);
    writeFileSync(decoy, decoyText);
    const result = run(fx, ['--confirm'], {
      cwd: elsewhere,
      // Tracker overrides are codebase-relative; batch-state remains cwd-relative.
      env: { CAREER_OPS_TRACKER: trackerOverride, CAREER_OPS_BATCH_STATE: relative(elsewhere, join(fx.root, 'batch', 'batch-state.tsv')) },
    });
    assert.equal(result.status, 1, describeSpawn(result));
    assert.equal(readFileSync(decoy, 'utf-8'), decoyText, 'initial import leaves cwd-relative decoy untouched');
    assert.equal(rowFor(readFileSync(fx.trackerPath, 'utf-8'), 'Quillfeather Health'), undefined);
    const dir = /stay in (\S+) with their numbers reserved/.exec(result.stderr)?.[1];
    assert.ok(dir, describeSpawn(result));
    try {
      const retry = /then run:\n {2}(.+)\n/.exec(result.stderr)?.[1];
      assert.ok(retry, describeSpawn(result));
      assert.doesNotMatch(retry, /CAREER_OPS_(TRACKER|BATCH_STATE)='?(data|batch)\b/);
      const trackerArgument = new RegExp(`CAREER_OPS_TRACKER=(${ARG}) `).exec(retry)?.[1];
      assert.ok([fx.trackerPath, `'${fx.trackerPath}'`].includes(trackerArgument), 'retry pins the codebase-relative tracker to its absolute path');
      assert.ok(retry.includes(join(fx.root, 'batch', 'batch-state.tsv')), 'retry pins the cwd-relative batch state');
      rerunFromElsewhere(fx, retry);
      assert.equal(readFileSync(decoy, 'utf-8'), decoyText, 'retry leaves cwd-relative decoy untouched');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
