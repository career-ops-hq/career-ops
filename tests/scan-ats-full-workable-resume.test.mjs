// tests/scan-ats-full-workable-resume.test.mjs
//
// A finished Workable source must not download the feed again: its status and
// size come from the checkpoint.
//
// An in-progress Workable checkpoint must not be judged against a company-list
// download. Both resume flags keep that checkpoint, skip the company-list
// request, and rebuild the feed instead.
//
// Driven end-to-end in a child process against a sandbox data root. The
// finished-source case stubs dns.lookup. The in-progress case stubs fetch, so
// no network is used and every feed request is visible.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { WORKABLE_FEED_URL } from '../providers/workable.mjs';
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
    if (!asked.some((h) => h === 'workable.com' || h.endsWith('.workable.com'))) pass('the finished Workable source is not downloaded again on --resume');
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

console.log('\nscan-ats-full — an in-progress Workable checkpoint stays under both resume flags');

function childEnv(dir) {
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_PROFILE: '',
    CAREER_OPS_PORTALS: '',
    CAREER_OPS_PIPELINE: '',
    CAREER_OPS_SCAN_HISTORY: '',
    CAREER_OPS_TRACKER: '',
    CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0',
    CAREER_OPS_TRUST_PROXY_EGRESS: '',
  };
  for (const key of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
    delete env[key];
  }
  return env;
}

// A checkpoint from a sweep that stopped inside Workable. datasetLen is the
// old feed size. Reading that URL as a company list returns no array, so the
// early check would discard this record. The feed rebuild must not.
function inProgressCheckpoint() {
  return {
    version: 1,
    cutoffMs: Date.now() - 3 * 86_400_000,
    ats: ['workable'],
    limit: null,
    includeUndated: false,
    completedSources: [],
    offers: [],
    counters: {},
    current: { name: 'workable', resumeAt: 3, datasetLen: 40, datasetHash: null },
    savedAt: new Date().toISOString(),
  };
}

function resumeInProgress(flag) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-workable-open-'));
  try {
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - engineer\n', 'utf-8');
    mkdirSync(join(dir, 'data', 'cache'), { recursive: true });
    writeFileSync(join(dir, 'data', 'cache', 'ats-full-checkpoint.json'), JSON.stringify(inProgressCheckpoint()), 'utf-8');
    const fetched = join(dir, 'fetched.txt');
    writeFileSync(fetched, '', 'utf-8');
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url) => {
  appendFileSync(${JSON.stringify(fetched)}, String(url) + '\\n');
  throw new Error('blocked ' + url);
};
`, 'utf-8');
    const result = spawnSync(NODE, [
      '--import', pathToFileURL(preload).href,
      join(ROOT, 'scan-ats-full.mjs'),
      '--ats', 'workable', '--json', flag,
    ], { cwd: dir, encoding: 'utf-8', timeout: 45_000, env: childEnv(dir) });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const urls = existsSync(fetched) ? readFileSync(fetched, 'utf-8').split('\n').filter(Boolean) : [];
    const feedFetches = urls.filter((url) => url === WORKABLE_FEED_URL);
    let json = null;
    try { json = JSON.parse(result.stdout || ''); } catch { /* reported below */ }
    const restarted = /interrupted in the checkpoint; its list is rebuilt, so the pass starts again/.test(text);
    const discarded = /company dataset changed|Starting a fresh sweep|could not download company list/.test(text);
    const companyList = join(dir, 'data', 'cache', 'ats-companies', 'workable.json');
    if (
      result.status === 0
      && restarted
      && !discarded
      && json?.resumed === true
      && feedFetches.length === 1
      && urls.length === feedFetches.length
      && !existsSync(companyList)
    ) {
      pass(`${flag} keeps the in-progress Workable checkpoint and skips the company-list download`);
    } else {
      fail(`${flag} did not keep the checkpoint: status=${result.status} restarted=${restarted} discarded=${discarded} resumed=${json?.resumed} fetches=${urls.join(',')} companyList=${existsSync(companyList)}\n${(result.stderr || '').slice(-800)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

resumeInProgress('--resume');
resumeInProgress('--resume-if-compatible');
