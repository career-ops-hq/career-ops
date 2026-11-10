// tests/scan-ats-full-workable-resume.test.mjs — a --resume whose checkpoint
// already lists the Workable source as complete must not download the feed
// again: its status and size come from the checkpoint.
//
// Driven end-to-end in a child process against a sandbox data root, with a
// stubbed dns.lookup that records every hostname and fails it, so no network
// is used and any attempt to reach the feed host is visible.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, run, formatRunFailure, NODE, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — a resumed run does not read a finished Workable feed again');

const dir = mkdtempSync(join(tmpdir(), 'career-ops-workable-resume-'));
try {
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - engineer\n', 'utf-8');
  mkdirSync(join(dir, 'data', 'cache'), { recursive: true });
  const lookups = join(dir, 'lookups.txt');
  const scanUrl = pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href;
  writeFileSync(join(dir, 'launch.mjs'), `
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
dns.lookup = (hostname, options, callback) => {
  const cb = typeof options === 'function' ? options : callback;
  appendFileSync(${JSON.stringify(lookups)}, hostname + '\\n');
  const err = new Error('getaddrinfo ENOTFOUND ' + hostname);
  err.code = 'ENOTFOUND';
  err.syscall = 'getaddrinfo';
  err.hostname = hostname;
  process.nextTick(cb, err);
};
process.argv[1] = ${JSON.stringify(join(ROOT, 'scan-ats-full.mjs'))};
await import(${JSON.stringify(scanUrl)});
`, 'utf-8');

  // What a run that finished the workable source and then stopped leaves behind.
  writeFileSync(join(dir, 'data', 'cache', 'ats-full-checkpoint.json'), JSON.stringify({
    version: 1,
    cutoffMs: Date.now() - 3 * 86_400_000,
    ats: ['workable'],
    limit: null,
    includeUndated: false,
    completedSources: ['workable'],
    datasets: { workable: { status: 'ok', available: 55 } },
    offers: [],
    counters: {},
    current: null,
    savedAt: new Date().toISOString(),
  }), 'utf-8');

  const out = run(NODE, [join(dir, 'launch.mjs'), '--ats', 'workable', '--json', '--resume', '--dry-run'], {
    cwd: dir,
    env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0' },
    timeout: 120_000,
  });
  if (out === null) {
    fail(`resumed run did not complete${formatRunFailure()}`);
  } else {
    let json = null;
    try { json = JSON.parse(out); } catch { /* reported below */ }
    const asked = existsSync(lookups) ? readFileSync(lookups, 'utf-8').split('\n').filter(Boolean) : [];
    if (!asked.some((h) => h.endsWith('workable.com'))) pass('the finished Workable source is not downloaded again on --resume');
    else fail(`the resumed run looked up ${asked.join(', ')}`);
    if (json?.datasetStatus?.workable === 'ok' && json.companiesAvailable === 55) {
      pass("its status and size in the report come from the checkpoint");
    } else {
      fail(`report wrong: ${JSON.stringify({ datasetStatus: json?.datasetStatus, companiesAvailable: json?.companiesAvailable })}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
