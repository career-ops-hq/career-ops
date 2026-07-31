// tests/scan-ats-full-outage-checkpoint.test.mjs — a sweep stopped by the
// resolver circuit breaker must LEAVE its checkpoint on disk, and leave it
// pointing at where the sweep actually stopped (#2283).
//
// The end of main() deletes the checkpoint unconditionally ("sweep completed —
// the checkpoint's job is done"), and the outage `break` falls straight into
// that exit path, so the stop deliberately designed to be resumable destroyed
// the only file `--resume` reads.
//
// Driven end-to-end in a child process rather than against an exported helper:
// the bug is not in any single function but in the interaction between the
// breaker, the checkpoint writer, and the exit path, and only a whole run
// exercises all three. The child runs in a sandbox cwd (every path
// scan-ats-full.mjs touches is relative) with a stubbed `dns.lookup`, so no
// network is involved and the resolver's behaviour is exact:
//
//   EAI_AGAIN  — a resolver-level failure; trips the breaker  → checkpoint kept
//   ENOTFOUND  — NXDOMAIN, an ordinary dead board; no outage  → checkpoint deleted
//
// The ENOTFOUND arm is load-bearing. Without it a fix that simply never
// deleted the checkpoint would pass, and every clean sweep would leave a stale
// file behind that makes the next run warn and demand --resume.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, run, formatRunFailure, NODE, ROOT } from './helpers.mjs';

console.log('\nscan-ats-full — a resolver-outage stop keeps its checkpoint (#2283)');

// Comfortably above RESOLVER_FAILURE_LIMIT (50) so the breaker trips with
// companies still unscanned, and comfortably below CHECKPOINT_EVERY (500) so
// the periodic checkpoint writer never fires. Any checkpoint on disk at the
// end of the outage arm therefore came from the outage path itself.
const COMPANIES = 120;
const CHECKPOINT_REL = join('data', 'cache', 'ats-full-checkpoint.json');

/**
 * Build a sandbox cwd holding everything a greenhouse-only sweep reads, plus
 * the launcher that stubs DNS before scan-ats-full.mjs loads.
 *
 * @returns {string} Sandbox directory.
 */
function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-outage-'));
  // Minimal portals.yml: main() exits early without one. The filters never
  // matter here — no board is reachable, so no posting reaches them.
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - director\n', 'utf-8');

  // A fresh dataset cache means loadCompanyList() returns these slugs instead
  // of downloading the real 8k-company directory.
  mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
  writeFileSync(
    join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'),
    JSON.stringify(Array.from({ length: COMPANIES }, (_, i) => `sandbox-co-${i}`)),
    'utf-8',
  );

  // Launcher: patch dns.lookup, then import the scanner. providers/_dns-cache.mjs
  // captures the real lookup at ITS import time and net.connect reads
  // dns.lookup at call time, so patching first makes the stub the resolver for
  // the whole run. Overwriting argv[1] is what makes scan-ats-full.mjs's
  // "invoked directly?" guard fire under an importing parent — preferred over
  // a --import preload so the test runs on any Node the project supports.
  const scanUrl = pathToFileURL(join(ROOT, 'scan-ats-full.mjs')).href;
  writeFileSync(join(dir, 'launch.mjs'), `
import dns from 'node:dns';
const code = process.env.STUB_DNS_CODE;
dns.lookup = (hostname, options, callback) => {
  const cb = typeof options === 'function' ? options : callback;
  const err = new Error('getaddrinfo ' + code + ' ' + hostname);
  err.code = code;
  err.syscall = 'getaddrinfo';
  err.hostname = hostname;
  process.nextTick(cb, err);
};
process.argv[1] = ${JSON.stringify(join(ROOT, 'scan-ats-full.mjs'))};
await import(${JSON.stringify(scanUrl)});
`, 'utf-8');
  return dir;
}

/**
 * Run one sandboxed sweep to completion.
 *
 * @param {string} dir - Sandbox directory.
 * @param {string} dnsCode - Error code every dns.lookup call fails with.
 * @param {string[]} [extraArgs=[]] - Additional scanner flags.
 * @returns {string|null} Trimmed stdout, or null when the child failed.
 */
function sweep(dir, dnsCode, extraArgs = []) {
  return run(NODE, [join(dir, 'launch.mjs'), '--ats', 'greenhouse', '--json', ...extraArgs], {
    cwd: dir,
    // Pacing would only add wall-clock time to a run whose every lookup fails.
    env: { ...process.env, STUB_DNS_CODE: dnsCode, CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0' },
    timeout: 120_000,
  });
}

// --- a resolver outage leaves a resumable checkpoint, and --resume uses it ---
{
  const dir = makeSandbox();
  try {
    const out = sweep(dir, 'EAI_AGAIN');
    const cpPath = join(dir, CHECKPOINT_REL);
    let resumeAt = null;
    if (out === null) {
      fail(`outage sweep did not complete${formatRunFailure()}`);
    } else if (!existsSync(cpPath)) {
      fail('a resolver-outage stop deleted its own checkpoint — --resume has nothing to read');
    } else {
      const cp = JSON.parse(readFileSync(cpPath, 'utf-8'));
      // The source must NOT be marked complete, or --resume skips the rest of it.
      const incomplete = !(cp.completedSources || []).includes('greenhouse');
      // resumeAt is parallelEach's lowest unfinished index: everything below it
      // is done, so a resumed run neither skips nor redoes completed boards.
      const at = cp.current?.resumeAt;
      const usable = cp.current?.name === 'greenhouse'
        && Number.isInteger(at) && at > 0 && at < COMPANIES;
      if (incomplete && usable) {
        resumeAt = at;
        pass(`outage checkpoint survives and resumes at ${at}/${COMPANIES} with greenhouse still open`);
      } else {
        fail(`outage checkpoint unusable: incomplete=${incomplete} current=${JSON.stringify(cp.current)}`);
      }

      // The interrupted run's own report must agree with what it checkpointed.
      // greenhouse starts at offset 0 here, so every board below resumeAt was
      // attempted and none above it was: the count it reports, the count it
      // stored, and the resume point are all the same number. A counter left at
      // the full slice shows up as companiesScanned > resumeAt — unattempted
      // boards reported as scanned, and double-counted again on resume.
      const result = JSON.parse(out);
      const stored = cp.counters?.totalCompaniesScanned;
      if (result.companiesScanned === at && stored === at) {
        pass(`interrupted run counts only what it attempted (${result.companiesScanned} = checkpoint ${stored} = resumeAt ${at})`);
      } else {
        fail(`interrupted counters disagree: companiesScanned=${result.companiesScanned} checkpoint=${stored} resumeAt=${at}`);
      }

      // A caller that reads only the JSON (the web UI does) must be able to
      // tell a resumable stop from a finished sweep without stat'ing the
      // checkpoint file itself.
      if (result.stoppedByOutage === true) {
        pass('--json reports the run as stopped by the resolver breaker');
      } else {
        fail(`--json hides the outage stop: stoppedByOutage=${result.stoppedByOutage}`);
      }
    }

    // The point of keeping the file: --resume finishes the source, and the
    // company count comes out at COMPANIES rather than COMPANIES + resumeAt.
    // A checkpoint that stored the full slice instead of the attempted part
    // would double-count the portion the first run completed.
    if (resumeAt !== null) {
      const resumed = sweep(dir, 'ENOTFOUND', ['--resume']);
      if (resumed === null) {
        fail(`--resume after an outage stop failed${formatRunFailure()}`);
      } else {
        const { companiesScanned, resumed: wasResumed } = JSON.parse(resumed);
        if (!wasResumed || companiesScanned !== COMPANIES) {
          fail(`resumed run miscounted: resumed=${wasResumed} companiesScanned=${companiesScanned}, expected ${COMPANIES}`);
        } else if (existsSync(cpPath)) {
          // The clean-sweep case below never reads a checkpoint, so it cannot
          // catch a cleanup that only fails on the --resume path.
          fail('a completed resumed sweep left its checkpoint behind');
        } else {
          pass(`--resume continues the stopped source (${companiesScanned} scanned across both runs, no double count)`);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- a sweep that merely hit dead boards still cleans up after itself ---
{
  const dir = makeSandbox();
  try {
    const out = sweep(dir, 'ENOTFOUND');
    const cpPath = join(dir, CHECKPOINT_REL);
    if (out === null) {
      fail(`clean sweep did not complete${formatRunFailure()}`);
    } else if (existsSync(cpPath)) {
      fail('a completed sweep left its checkpoint behind — the next run will demand --resume');
    } else if (JSON.parse(out).stoppedByOutage !== false) {
      fail(`a completed sweep reported stoppedByOutage=${JSON.parse(out).stoppedByOutage}`);
    } else {
      pass('a completed sweep still deletes its checkpoint and reports no outage stop');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
