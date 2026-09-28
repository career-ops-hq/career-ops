// Regression: a dated file in reports/ must not be read as a report number.
//
// `scan-ats-full.mjs --md-out reports/` writes `reports/YYYY-MM-DD.md`. The old
// occupancy scan matched `/^(\d+)-/`, so `2026-08-12.md` was read as report
// #2026 and the next reservation jumped to 2027 — silently, and permanently.

import { strict as assert } from 'assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { reserveReportNumbers, releaseReportNumbers } from '../reserve-report-num.mjs';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

// Reserve one slot in a scratch root and report which number it got. Released
// afterwards so the assertion reflects the occupancy scan, not leftover state.
async function peekIn(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rrn-'));
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(
    join(dir, 'data/applications.md'),
    '# Applications Tracker\n\n'
    + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
    + '|---|---|---|---|---|---|---|---|---|\n'
  );
  for (const f of files) writeFileSync(join(dir, 'reports', f), '# x\n');
  try {
    const nums = await reserveReportNumbers(1, { rootDir: dir });
    await releaseReportNumbers(nums, { rootDir: dir });
    return String(nums[0]).padStart(3, '0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = [
  {
    name: 'scan digest is ignored',
    files: ['009-acme-2026-08-12.md', '2026-08-12.md'],
    expect: '010',
  },
  {
    name: 'real reports still counted',
    files: ['009-acme-2026-08-12.md', '010-globex-2026-08-12.md'],
    expect: '011',
  },
  {
    name: 'RESERVED sentinels still counted',
    files: ['009-acme-2026-08-12.md', '010-RESERVED.md'],
    expect: '011',
  },
  {
    name: 'digest alone leaves numbering at the start',
    files: ['2026-08-12.md'],
    expect: '001',
  },
];

for (const c of cases) {
  let got;
  try {
    got = await peekIn(c.files);
  } catch (err) {
    fail(`${c.name}: threw ${err.message.split('\n')[0]}`);
    continue;
  }
  try {
    assert.equal(got, c.expect);
    pass(`${c.name} → ${got}`);
  } catch {
    fail(`${c.name}: expected ${c.expect}, got ${got}`);
  }
}

// Regression: `--help`/`-h` used to fall through the CLI's cmd dispatch into
// the default reserve-1 path — silently burning a real report-number slot
// instead of printing usage. It must now short-circuit before touching any
// reports/tracker path at all.
for (const flag of ['--help', '-h']) {
  const dir = mkdtempSync(join(tmpdir(), 'rrn-help-'));
  try {
    const result = spawnSync(NODE, [join(ROOT, 'reserve-report-num.mjs'), flag], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    const sentinels = existsSync(join(dir, 'reports'))
      ? readdirSync(join(dir, 'reports')).filter((f) => /-RESERVED\.md$/.test(f))
      : [];
    if (result.status === 0 && /Usage: node reserve-report-num\.mjs/.test(result.stdout) && sentinels.length === 0) {
      pass(`${flag} prints usage and reserves nothing`);
    } else {
      fail(`${flag}: exit=${result.status}, sentinels=${sentinels.length}, stdout=${JSON.stringify(result.stdout.slice(0, 120))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `--status` must be read-only and printable JSON: no sentinel created, exit 0.
{
  const reportsDir = join(ROOT, 'reports');
  const before = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((f) => /-RESERVED\.md$/.test(f)).sort()
    : [];
  const result = spawnSync(NODE, [join(ROOT, 'reserve-report-num.mjs'), '--status'], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 15000,
  });
  const after = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((f) => /-RESERVED\.md$/.test(f)).sort()
    : [];
  let jsonOk = false;
  try {
    const parsed = JSON.parse(result.stdout);
    jsonOk = Number.isSafeInteger(parsed.next) && Array.isArray(parsed.occupied) && Array.isArray(parsed.sentinels);
  } catch { /* not JSON */ }
  if (result.status === 0 && jsonOk && JSON.stringify(before) === JSON.stringify(after)) {
    pass('--status prints occupancy JSON and writes nothing');
  } else {
    fail(`--status: exit=${result.status}, jsonOk=${jsonOk}, unchanged=${JSON.stringify(before) === JSON.stringify(after)}, stderr=${JSON.stringify(result.stderr.slice(0, 120))}`);
  }
}

// Regression: any unrecognized command used to fall through to the default
// reserve path — a read-only-looking `--status` typed before it existed wrote
// reports/165-RESERVED.md (2026-09-28). An unknown command must exit non-zero
// and write nothing anywhere.
for (const bogus of ['--bogus', '--releas']) {
  const reportsDir = join(ROOT, 'reports');
  const before = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((f) => /-RESERVED\.md$/.test(f)).sort()
    : [];
  const result = spawnSync(NODE, [join(ROOT, 'reserve-report-num.mjs'), bogus], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 15000,
  });
  const after = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((f) => /-RESERVED\.md$/.test(f)).sort()
    : [];
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  if (result.status !== 0 && /unknown command/.test(result.stderr) && unchanged) {
    pass(`${bogus} rejected (exit ${result.status}) and writes nothing`);
  } else {
    fail(`${bogus}: exit=${result.status}, unchanged=${unchanged}, stderr=${JSON.stringify(result.stderr.slice(0, 120))}`);
  }
}
