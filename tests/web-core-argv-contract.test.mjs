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
    source: 'web/src/app/api/status/route.ts',
    script: 'set-status.mjs',
    // The route builds ['--row', row, canon, '--source', 'web', '--json'];
    // row 1 and Responded are the fixture tracker's row and a canonical state.
    args: ['--row', '1', 'Responded', '--source', 'web', '--json'],
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
    source: 'web/src/app/api/keyword-match/route.ts',
    script: 'keyword-match.mjs',
    // {{report}} is replaced with the fixture report below. This script takes a
    // FILE as its first argument, so unlike every other site here the argv is
    // only meaningful against a real report — and `--help` exits 1, so
    // 'flags-only' cannot stand in for it either.
    args: ['{{report}}', '--json'],
    probe: 'run',
  },
  {
    source: 'web/src/lib/core/pipeline.ts',
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
  // SYSTEM_PATHS wholesale (validate-system-paths-coverage.mjs,
  // EXCLUDE_PREFIXES = ['web/']), so `update-system.mjs apply` never installs
  // it. An install created that way has no web/ at all, and the two checks
  // below read the web sources unconditionally: readFileSync threw ENOENT and
  // took the whole suite with it, so the argv probes above — which need only
  // the core scripts and are the point of this file — reported nothing either.
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
  const flagDrift = [];
  for (const site of CALL_SITES) {
    const src = readFileSync(join(root, site.source), 'utf-8');
    const literals = [...new Set([...src.matchAll(/"(--[a-z][a-z0-9-]*)"/g)].map((m) => m[1]))];
    for (const flag of literals) {
      if (!site.args.includes(flag))
        flagDrift.push(`${site.source} passes ${flag}, which no probe above covers`);
    }
  }
  if (flagDrift.length === 0)
    reportPass('every --flag literal in the listed web sources is covered by a probe');
  else for (const d of flagDrift) reportFail(d);

  // Every web source that spawns a core script must be listed. A new route is
  // a new argv nobody has put to the script.
  const spawners = walkFiles(webSrcRoot, /\.(ts|tsx|mjs)$/)
    .map((f) => relative(root, f).split(sep).join('/'))
    .filter((rel) => {
      const src = readFileSync(join(root, rel), 'utf-8');
      return /\brootScript\(/.test(src) && /\b(execFile|spawn)\(/.test(src);
    });
  const listed = new Set(CALL_SITES.map((s) => s.source));
  const unlisted = spawners.filter((f) => !listed.has(f));
  if (unlisted.length === 0)
    reportPass(`all ${spawners.length} web sources that spawn a core script are listed here`);
  else reportFail(`web sources spawning a core script with no argv probe: ${unlisted.join(', ')}`);

  const stale = [...listed].filter((f) => !spawners.includes(f));
  if (stale.length === 0) reportPass('no stale entries — every listed source still spawns a core script');
  else reportFail(`listed sources that no longer spawn a core script: ${stale.join(', ')}`);

  return { skipped: false };
}

export function runWebCoreArgvContract() {
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

    // The report the fixture tracker already links to, which until now was not
    // written. keyword-match.mjs reads a report's `## Keywords extracted` block,
    // so a probe of its argv needs one to exist.
    const reportFile = join(sandbox, 'reports', '001-northwind-robotics-2026-01-05.md');
    mkdirSync(join(sandbox, 'reports'), { recursive: true });
    writeFileSync(
      reportFile,
      '**URL:** https://example.invalid/northwind\n**Legitimacy:** verified\n\n' +
        '## Keywords extracted\n\n- Go\n- PostgreSQL\n- Kubernetes\n\n' +
        '## Job Description (archived verbatim)\n\nFixture posting text.\n',
      'utf-8',
    );

    // keyword-match.mjs compares the report against the CV at the data root and
    // exits 1 when there is none, so the fixture needs both halves of the
    // comparison. Two of the three keywords above appear here on purpose: the
    // probe asserts the argv and the JSON shape, and a run with no overlap at
    // all would exercise a narrower path than the web's.
    writeFileSync(
      join(sandbox, 'cv.md'),
      '# Fixture CV\n\nBackend engineer. Go and PostgreSQL in production.\n',
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
      // {{report}} is the only token: a couple of scripts take a FILE rather
      // than flags, and the file only exists once the sandbox is built.
      const resolved = site.args.map((a) => (a === '{{report}}' ? reportFile : a));
      const argv = site.probe === 'flags-only' ? [...resolved, '--help'] : resolved;
      // Label with the TOKEN, not the resolved temp path: a failure message
      // naming /var/folders/…/T/co-web-argv-xyz/reports/… is unreadable and
      // changes every run.
      const label = `${site.script} ${(site.probe === 'flags-only' ? [...site.args, '--help'] : site.args).join(' ')}`.trim();
      const result = spawnSync(NODE, [join(ROOT, site.script), ...argv], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60_000,
        env,
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

    verifyWebStaticSources();
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

if (process.env.CAREER_OPS_WEB_ARGV_CONTRACT_STATIC_ONLY !== '1') {
  runWebCoreArgvContract();
}
