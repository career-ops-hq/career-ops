// tests/web-core-argv-contract.test.mjs — the web app spawns core scripts with
// a fixed argv, and the core validates its own flags. Nothing linked the two.
//
// followup-cadence.mjs gained validateFlags() without `--json` on its
// KNOWN_FLAGS list, while both web follow-up routes had been spawning
// `[script, '--json']` all along. The script started exiting 1 with
// "unrecognized flag(s): --json"; both routes discard the error and resolve to
// "", so the UI rendered an empty follow-up list and told the user they were
// caught up. No test could see it: the suite exercised the cadence analysis
// in-process and never spawned the CLI with the web's argv.
//
// This file is that missing link. Every web call site that spawns a root
// script is listed below with the argv it passes, and the argv is put to the
// real script.
import { pass, fail, ROOT, NODE, rmSync, walkFiles } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';

console.log('\nweb → core argv contract');

// Probe kinds:
//   'run'        — spawn the exact argv the web passes and require exit 0.
//   'flags-only' — the real run would sweep live job boards, so append --help
//                  instead. validateFlags() checks unrecognized flags BEFORE
//                  --help, so an argv the script rejects still exits 1 naming
//                  the flag, and exit 0 with usage means every flag was
//                  accepted. Same verdict on the flags, no network.
//   'none'       — the call site spawns node with an inline module rather than
//                  a root script with flags; listed so the enumeration at the
//                  bottom stays complete.
//
// route.ts holds SIX runCoreScript() call sites (gate3 linter capture + ledger,
// jev triage ledger, browser-extract JD capture, and the Envelope B
// jev-decide/jev-inject pair). The static half of this file scans by SOURCE, so
// every --flag literal anywhere in route.ts is checked against EVERY route.ts
// entry — the guard cannot tell call sites within one file apart. Rather than
// repeating the same union comment on all six, the union lives here once.
const ROUTE_UNION_FLAGS = ['--mode', '--max-chars', '--jd', '--out', '--report', '--slots', '--envelope', '--timeout-ms'];
const CALL_SITES = [
  {
    source: 'web/src/app/api/followups/route.ts',
    script: 'followup-cadence.mjs',
    args: ['--json'],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/followups/cadence/route.ts',
    script: 'followup-cadence.mjs',
    args: ['--json'],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/doctor/route.ts',
    script: 'doctor.mjs',
    args: ['--json'],
    probe: 'run',
  },
  {
    // Gate 3 telemetry in the pdf done lane: collectGate3Telemetry() passes the
    // tailored payload path and the target JD path as two POSITIONAL args, no
    // flags.
    //
    // probe 'none', NOT 'run'/'flags-only': this script has no validateFlags()
    // and no --help handling — argv is positional, so any appended flag is
    // simply ignored and the real linter runs, spending a provider call. Worse,
    // it exits 3 on a real `halt` finding (and 0 on unavailable), so an argv
    // probe that required exit 0 would fail on a CV that merely has weak
    // metrics. The argv is therefore left to the static half of this file.
    // TODO(#gate3): the stdout parser in route.ts has no automated test yet —
    // it was verified by hand against observed CLI output (pass / halt /
    // unavailable / usage-text / empty / provider-error shapes). Extracting it
    // into web/src/lib/core/ with a parity test would close that gap.
    source: 'web/src/app/api/run/route.ts',
    script: 'jev-post-linter.mjs',
    args: ['<tailored-payload.json>', '<target-jd.txt>'],
    probe: 'none',
    // runtimeFlags is the route.ts union (ROUTE_UNION_FLAGS): the static guard
    // scans by SOURCE so every route.ts flag literal must be covered here.
    runtimeFlags: ROUTE_UNION_FLAGS,
  },
  {
    // Gate 3's URL-input JD capture: captureUrlJdText() calls
    // runCoreScript("browser-extract", [url, "--mode", "jd", "--max-chars", "30000"]).
    //
    // probe 'none', like the jev-post-linter entry above and for the same two
    // reasons: this script has no validateFlags() and no --help handling, so an
    // appended flag is ignored positionally and the real thing runs — which here
    // means launching a headless browser and hitting the network. The argv is
    // covered by the static half of this file plus the observed-output matrix in
    // web/tests/lib/gate3-telemetry-parser.test.mjs.
    source: 'web/src/app/api/run/route.ts',
    script: 'browser-extract.mjs',
    args: ['<url>', '--mode', 'jd', '--max-chars', '30000'],
    probe: 'none',
    // --mode / --max-chars are already in `args`; the rest of the route.ts
    // union rides in runtimeFlags (see ROUTE_UNION_FLAGS above).
    runtimeFlags: ROUTE_UNION_FLAGS,
  },
  {
    // Gate 3's on-disk ledger append, fired from collectGate3Telemetry after a
    // verdict resolves: runCoreScript("append-gate3-log", [id, company, role,
    // decision, reason]).
    //
    // probe 'none': positional argv, no flags, and the one thing a probe could
    // usefully assert — that it accepts its operands — is already covered by the
    // script's own argument check (exit 2 with usage when any are missing).
    // Probing for real would WRITE A ROW to the user's gate3-log.tsv, which is
    // exactly the side effect this suite must not have.
    source: 'web/src/app/api/run/route.ts',
    script: 'append-gate3-log.mjs',
    args: ['<id>', '<company>', '<role>', '<decision>', '<reason>'],
    probe: 'none',
    // runtimeFlags is the route.ts union (ROUTE_UNION_FLAGS).
    runtimeFlags: ROUTE_UNION_FLAGS,
  },
  {
    // Jev System 1 triage ledger: fire-and-forget persistence of the calibrated
    // ATS prior from the run route (runCoreScript("append-jev-log",
    // [id, score, band, wallMs])).
    //
    // probe 'none': positional argv, no flags, and a real probe would WRITE a row
    // to the user's data/jev-runs.tsv — the side effect this suite must not have.
    // The script's own argument check (exit 2 with usage) is the only assertion
    // that matters here, and the ledger shape is verified by its own unit tests.
    source: 'web/src/app/api/run/route.ts',
    script: 'append-jev-log.mjs',
    args: ['<id>', '<score>', '<band>', '<wallMs>'],
    probe: 'none',
    // runtimeFlags is the route.ts union (ROUTE_UNION_FLAGS).
    runtimeFlags: ROUTE_UNION_FLAGS,
  },
  {
    // Envelope B System One screen: the pre-spawn gatekeeper decide for a local
    // JD (runCoreScript("jev-decide", ["--jd", jdPath, "--out", envelopePath,
    // "--timeout-ms", String(JEV_DECIDE_TIMEOUT_MS)])). The explicit timeout
    // (90s) is the route halving the inner spawn budget so a slow frame fails
    // open at the decide layer before the route's own broader budget kills it.
    //
    // probe 'none', like the jev-post-linter entry above: a 'run' probe would
    // answer 21 Block A/D/G questions through the PROVIDER (spending the user's
    // model budget), and a 'flags-only' probe cannot work — jev-decide.mjs has
    // no validateFlags()/--help; it parses a fixed argv and exits 2 with usage
    // on anything else. When the env gate is off the call does not even exist
    // at runtime. The full decide contract is covered by its own unit suite
    // (tests/jev-decide.test.mjs), which drives main() with these exact flags.
    source: 'web/src/app/api/run/route.ts',
    script: 'jev-decide.mjs',
    args: ['--jd', '<jd-path>', '--out', '<envelope.json>', '--timeout-ms', '<ms>'],
    probe: 'none',
    // --jd/--out/--timeout-ms are in `args`; the rest of the route.ts union
    // rides in runtimeFlags (see ROUTE_UNION_FLAGS above).
    runtimeFlags: ROUTE_UNION_FLAGS,
  },
  {
    // Envelope B compose step: fuse the worker's prose slots with the System
    // One envelope and inject the deterministic Machine Summary block
    // (runCoreScript("jev-inject", ["--report", report, "--slots", slotsPath,
    // "--envelope", envelopePath])).
    //
    // probe 'none' for the same two reasons as the jev-decide entry: a real
    // probe would mutate a report file, and there is no --help/validateFlags()
    // to probe (fixed argv + exit 2 usage). The inject contract is covered by
    // tests/jev-inject.test.mjs, which drives main() with these exact flags.
    source: 'web/src/app/api/run/route.ts',
    script: 'jev-inject.mjs',
    args: ['--report', '<report.md>', '--slots', '<slots.json>', '--envelope', '<envelope.json>'],
    probe: 'none',
    // --report/--slots/--envelope are in `args`; the rest of the route.ts union
    // rides in runtimeFlags (see ROUTE_UNION_FLAGS above).
    runtimeFlags: ROUTE_UNION_FLAGS,
  },
  {
    source: 'web/src/lib/core/status-update.ts',
    script: 'set-status.mjs',
    // runStatusUpdate builds ['--row', n, status, '--source', 'web', '--json',
    // ...('--note', note, '--on', on)] for the set-status branch. row 1,
    // Responded, and the fixture note/date are all fixture-safe values.
    args: ['--row', '1', 'Responded', '--source', 'web', '--json', '--note', 'fixture', '--on', '2026-01-01'],
    // --feedback/--stage are literals of the OUTCOME branch (outcome.mjs takes
    // them; set-status.mjs rejects them), assembled at runtime from the request
    // body — not probeable through this set-status argv.
    runtimeFlags: ['--feedback', '--stage'],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/portals/verify/route.ts',
    script: 'verify-portals.mjs',
    args: [],
    probe: 'run',
  },
  {
    source: 'web/src/app/api/tracker/delete/route.ts',
    script: 'tracker.mjs',
    // --dry-run is conditional in the route (added when the caller asks for a
    // preview); passing it keeps the probe off the fixture tracker.
    args: ['delete', '--num', '1', '--dry-run'],
    probe: 'run',
  },
  {
    source: 'web/src/lib/core/scan.ts',
    script: 'scan-ats-full.mjs',
    // The values are the route's own defaults; only the flag names matter here.
    args: ['--dry-run', '--since', '7', '--ats', 'greenhouse', '--limit', '150', '--json'],
    probe: 'flags-only',
  },
  {
    source: 'web/src/lib/core/pipeline.ts',
    script: null,
    args: [],
    probe: 'none',
  },
  // runCoreScript() callers — argv is assembled at runtime from the request
  // body and dispatched through web/src/lib/core/run-core-script.ts, so there
  // is no probeable root-script argv. Listed so the enumeration below stays
  // complete and any new flag literal lands here via flagDrift.
  {
    source: 'web/src/app/api/plugins/enrich-linkedin-jobs/route.ts',
    script: null,
    args: ['--apply-only'],
    probe: 'none',
  },
  {
    source: 'web/src/app/api/plugins/run-linkedin-alerts/route.ts',
    script: null,
    args: [],
    probe: 'none',
  },
  {
    source: 'web/src/app/api/portals/run-apify/route.ts',
    script: null,
    args: ['--company'],
    probe: 'none',
  },
  {
    source: 'web/src/app/api/portals/run-scan/route.ts',
    script: null,
    args: [],
    probe: 'none',
  },
  {
    source: 'web/src/lib/core/run-core-script.ts',
    script: null,
    args: [],
    probe: 'none',
  },
];

/**
 * Verify the static half of the contract against a checkout root.
 *
 * `tests/` is deliberately shipped by the updater while `web/` is not. The
 * dynamic argv probes above still apply to that core-only install, but there
 * are no web call sites to inspect there. Treat that absence as a scoped skip;
 * if web/ is present, keep every source-consistency assertion strict.
 *
 * @param {{root?: string, reportPass?: (message: string) => void, reportFail?: (message: string) => void}} options
 * @returns {{skipped: boolean}}
 */
export function verifyWebStaticSources({ root = ROOT, reportPass = pass, reportFail = fail } = {}) {
  // web/ ships as its own release-please component and is excluded from
  // SYSTEM_PATHS wholesale, so `update-system.mjs apply` never installs it.
  // An install created that way has no web/ at all, and the checks below read
  // the web sources unconditionally: readFileSync threw ENOENT and took the
  // whole suite with it, so the argv probes above — which need only the core
  // scripts and are the point of this file — reported nothing either.
  const webRoot = join(root, 'web');
  if (!existsSync(webRoot)) {
    reportPass('web/ is not present in this checkout — skipping static argv-source contract');
    return { skipped: true };
  }
  const webSrcRoot = join(webRoot, 'src');
  if (!existsSync(webSrcRoot)) {
    reportFail('web/ exists but web/src is missing — cannot verify the static argv-source contract');
    return { skipped: false };
  }

  // Every `"--flag"` literal in a listed source must appear in its argv here.
  // This covers the argv literals the routes write inline; it does NOT cover a
  // flag assembled at runtime from a variable or a template string.
  // A listed source that doesn't exist in this checkout (an upstream route the
  // web checkout predates) is reported as a skip, not fatal — one stale entry
  // must not kill the remaining probes or leave the suite permanently red.
  const missing = CALL_SITES.filter((s) => !existsSync(join(root, s.source)));
  if (missing.length > 0) {
    reportPass(`skipping ${missing.length} listed source(s) not in this checkout: ${missing.map((m) => m.source).join(', ')}`);
  }
  const flagDrift = [];
  for (const site of CALL_SITES) {
    // Sources reported as missing above are skipped here — nothing to scan.
    if (!existsSync(join(root, site.source))) continue;
    const src = readFileSync(join(root, site.source), 'utf-8');
    const literals = [...new Set([...src.matchAll(/"(--[a-z][a-z0-9-]*)"/g)].map((m) => m[1]))];
    const runtime = site.runtimeFlags ?? [];
    for (const flag of literals) {
      if (runtime.includes(flag)) continue; // runtime-assembled, not probeable here
      if (!site.args.includes(flag)) flagDrift.push(`${site.source} passes ${flag}, which no probe above covers`);
    }
  }
  if (flagDrift.length === 0) reportPass('every --flag literal in the listed web sources is covered by a probe');
  else for (const d of flagDrift) reportFail(d);

  // Every web source that spawns a core script must be listed. A new route is
  // a new argv nobody has put to the script. runCoreScript( (the web layer's
  // canonical spawn helper, run-core-script.ts) and spawnSync( both delegate to
  // the core, so they count the same as a direct spawn.
  const spawners = walkFiles(webSrcRoot, /\.(ts|tsx|mjs)$/)
    .map((f) => relative(root, f).split(sep).join('/'))
    .filter((rel) => {
      const src = readFileSync(join(root, rel), 'utf-8');
      const referencesCore = /\b(rootScript|runCoreScript)\(/.test(src);
      const spawnsDirectly = /\b(execFile|spawnSync)\(|\bspawn\(/.test(src);
      // runCoreScript( (the web layer's canonical spawn helper) delegates to the
      // core the same way a direct spawn does, so it counts too.
      return referencesCore && (spawnsDirectly || /\brunCoreScript\(/.test(src));
    });
  const listed = new Set(CALL_SITES.filter((s) => existsSync(join(root, s.source))).map((s) => s.source));
  const unlisted = spawners.filter((f) => !listed.has(f));
  if (unlisted.length === 0) reportPass(`all ${spawners.length} web sources that spawn a core script are listed here`);
  else reportFail(`web sources spawning a core script with no argv probe: ${unlisted.join(', ')}`);

  const stale = [...listed].filter((f) => !spawners.includes(f));
  if (stale.length === 0) reportPass('no stale entries — every listed source still spawns a core script');
  else reportFail(`listed sources that no longer spawn a core script: ${stale.join(', ')}`);

  return { skipped: false };
}

const sandbox = mkdtempSync(join(tmpdir(), 'co-web-argv-'));
try {
  // A minimal data root: one Applied row, enough for every script here to have
  // something to report on. Fictional company and role.
  const tracker = join(sandbox, 'data', 'applications.md');
  mkdirSync(join(sandbox, 'data'), { recursive: true });
  writeFileSync(
    tracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    '| 1 | 2026-01-05 | Northwind Robotics | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-northwind-robotics-2026-01-05.md) | fixture |\n',
    'utf-8',
  );

  const env = {
    ...process.env,
    CAREER_OPS_ROOT: sandbox,
    CAREER_OPS_DATA_DIR: '',
    // set-status.mjs resolves its root from the codebase, not from
    // CAREER_OPS_ROOT, so without this the probe would read and write the
    // developer's own tracker.
    CAREER_OPS_TRACKER: tracker,
    // verify-portals.mjs reads portals.yml relative to the codebase root, and
    // a real one would put this probe on the network. Point it at a path that
    // does not exist: the script's documented no-op for a fresh setup.
    CAREER_OPS_PORTALS: join(sandbox, 'no-portals.yml'),
  };

  for (const site of CALL_SITES) {
    if (site.probe === 'none') continue;
    const argv = site.probe === 'flags-only' ? [...site.args, '--help'] : site.args;
    const label = `${site.script} ${argv.join(' ')}`.trim();
    const result = spawnSync(NODE, [join(ROOT, site.script), ...argv], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60_000, env,
    });

    if (result.error || result.signal) {
      fail(`${label} — did not run (${result.error?.message || `killed by ${result.signal}`})`);
      continue;
    }
    if (result.status !== 0) {
      // The flag rejection is the failure this file exists to catch, so name it.
      const why = /unrecognized flag/.test(result.stderr || '')
        ? `${site.script} rejects a flag ${site.source} passes — ${result.stderr.trim()}`
        : `exit ${result.status}: ${(result.stderr || result.stdout || '').trim().split('\n').slice(0, 3).join(' | ')}`;
      fail(`${label} — ${why}`);
      continue;
    }
    if (site.probe === 'run' && argv.includes('--json')) {
      try {
        JSON.parse(result.stdout);
        pass(`${label} — exit 0, stdout parses as JSON (${site.source})`);
      } catch (e) {
        fail(`${label} — exit 0 but stdout is not JSON: ${e.message}`);
      }
    } else {
      pass(`${label} — exit 0 (${site.source})`);
    }
  }

  // --- static half ---------------------------------------------------------
  // The probes above test the argv as transcribed into this file. The static
  // checks tie that transcription back to the sources, so a flag added to a
  // web route — or a whole new route that spawns a script — cannot land
  // without going through a probe. Extracted into verifyWebStaticSources()
  // so a core-only install (tests/ without web/) can run it too (#4165).
  verifyWebStaticSources();
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
