// Regression: the CLI reserved a number for any argument it did not know.
//
// `runCli()` dispatched on the first argument only, so `--count=3`, `--bogus`,
// `--release=001`, `-c 3` or a bare `5` fell through to the default reserve-1
// path (exit 0, a number printed, a sentinel left behind), and a stray word
// after a complete command (`--count 2 extra`, `--gc now`) was ignored. A
// fan-out that typed `--count=8` assumed it owned a range and claimed one slot.
// Unrecognized input must now exit 1 before anything is reserved or released.

import { mkdtempSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { pass, fail, rmSync, NODE, ROOT } from './helpers.mjs';

const CLI = join(ROOT, 'reserve-report-num.mjs');

function runIn(dir, args) {
  return spawnSync(NODE, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 15000,
    env: {
      ...process.env,
      CAREER_OPS_REPORTS_DIR: join(dir, 'reports'),
      CAREER_OPS_TRACKER: join(dir, 'applications.md'),
      CAREER_OPS_BATCH_STATE: join(dir, 'batch-state.tsv'),
    },
  });
}

function sentinelsIn(dir) {
  return existsSync(join(dir, 'reports'))
    ? readdirSync(join(dir, 'reports')).filter((f) => /-RESERVED\.md$/.test(f)).sort()
    : [];
}

const rejected = [
  { args: ['--count=3'], offending: '--count=3' },
  { args: ['--bogus'], offending: '--bogus' },
  { args: ['--release=001'], offending: '--release=001', preReserve: true },
  { args: ['5'], offending: '5' },
  { args: ['-c', '3'], offending: '-c' },
  { args: ['--count', '2', 'extra'], offending: 'extra' },
  { args: ['--release', '001', '002'], offending: '002', preReserve: true },
  { args: ['--gc', 'now'], offending: 'now' },
];

for (const c of rejected) {
  const label = c.args.join(' ');
  const dir = mkdtempSync(join(tmpdir(), 'rrn-args-'));
  try {
    const before = c.preReserve ? runIn(dir, []) : null;
    if (before && (before.status !== 0 || before.stdout.trim() !== '001')) {
      fail(`${label}: setup reservation gave exit=${before.status}, stdout=${JSON.stringify(before.stdout)}`);
      continue;
    }
    const expected = c.preReserve ? ['001-RESERVED.md'] : [];
    const result = runIn(dir, c.args);
    const sentinels = sentinelsIn(dir);
    const ok = result.status === 1
      && result.stdout === ''
      && result.stderr.includes(`unrecognized argument: ${c.offending}`)
      && result.stderr.includes('Usage:')
      && sentinels.join() === expected.join();
    if (ok) {
      pass(`${label} is rejected and reserves nothing`);
    } else {
      fail(`${label}: exit=${result.status}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(result.stderr.slice(0, 120))}, sentinels=${sentinels.join(',')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Controls: every documented spelling keeps working, in sequence in one dir.
{
  const dir = mkdtempSync(join(tmpdir(), 'rrn-args-ok-'));
  try {
    const steps = [
      { args: [], stdout: '001\n', held: ['001'] },
      { args: ['--count', '3'], stdout: '002-004\n', held: ['001', '002', '003', '004'] },
      { args: ['--release', '002-004'], stdout: '', held: ['001'] },
      { args: ['--release', '001'], stdout: '', held: [] },
      { args: ['--gc'], stdout: '', held: [] },
    ];
    for (const s of steps) {
      const result = runIn(dir, s.args);
      const held = sentinelsIn(dir).map((f) => f.slice(0, 3));
      const label = s.args.join(' ') || '(no arguments)';
      if (result.status === 0 && result.stdout === s.stdout && held.join() === s.held.join()) {
        pass(`${label} still works`);
      } else {
        fail(`${label}: exit=${result.status}, stdout=${JSON.stringify(result.stdout)}, sentinels=${held.join(',')}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
