// tests/verifiers-plugin-providers.test.mjs — the scanner and both health
// checkers must resolve providers through the SAME path (#4026).
//
// scan.mjs folds enabled provider plugins into its map with
// mergeProviderPlugins(). verify-pipeline.mjs and verify-portals.mjs did not,
// so a supported `provider: <plugin-id>` portals entry was reported as an
// "unknown provider" that "never scans" — while the scanner scanned it. The
// divergence is the bug and it can reappear the moment a caller drifts, so it
// is pinned structurally (three callers must run the call) AND behaviorally
// (the real verifiers resolve an enabled plugin instead of flagging it).
import {
  readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync,
  symlinkSync, readdirSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail, NODE } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('\nverifiers resolve provider plugins like the scanner (#4026)');

// Strip block and line comments so a commented-out mention of the call does
// not satisfy the structural check (a call-only revert must redden it).
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A throwaway checkout that verify-pipeline/verify-portals run FROM, so the
// test never reads, writes, or deletes the developer's real config/plugins.yml
// (mergeProviderPlugins resolves plugins/ and config/plugins.yml from the
// script's own CODE_ROOT). Copies the flat scripts plus the four dirs the
// verifiers reach into; node_modules is symlinked.
function prepareFixtureCodeRoot(tmp) {
  const codeRoot = join(tmp, 'code-root');
  mkdirSync(codeRoot, { recursive: true });
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && /\.(mjs|cjs|json)$/.test(entry.name)) {
      cpSync(join(ROOT, entry.name), join(codeRoot, entry.name));
    }
  }
  for (const dir of ['providers', 'plugins', 'templates', 'lib', 'batch']) {
    if (existsSync(join(ROOT, dir))) cpSync(join(ROOT, dir), join(codeRoot, dir), { recursive: true });
  }
  if (existsSync(join(ROOT, 'node_modules'))) {
    symlinkSync(join(ROOT, 'node_modules'), join(codeRoot, 'node_modules'), 'dir');
  }
  return codeRoot;
}

const MINIMAL_TRACKER =
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
  '| 1 | 2026-01-05 | Northwind | Backend Engineer | 4.2/5 | Applied | ❌ | - | fixture |\n';

// ── 1. Structural: all three provider-map builders run mergeProviderPlugins ──
{
  const callers = ['scan.mjs', 'verify-pipeline.mjs', 'verify-portals.mjs'];
  const missing = callers.filter(
    (f) => !/\bmergeProviderPlugins\s*\(/.test(stripJsComments(readFileSync(join(ROOT, f), 'utf8'))),
  );
  if (missing.length === 0) {
    pass('scan.mjs, verify-pipeline.mjs and verify-portals.mjs all run mergeProviderPlugins()');
  } else {
    fail(`these provider-map builders skip mergeProviderPlugins() and will disagree with the scanner: ${missing.join(', ')}`);
  }
}

// ── 2. Behavioral: run the real verifiers against a portals entry using the
//    bundled `apify` plugin, enabled. Before the fix both printed
//    "unknown provider: apify"; after, apify resolves to an actionable
//    "missing env APIFY_TOKEN" stub. A minimal tracker is seeded so
//    verify-pipeline gets past its "no applications.md" early exit and actually
//    reaches the provider-resolution check. ──
{
  const tmp = mkdtempSync(join(tmpdir(), 'co-4026-'));
  try {
    const codeRoot = prepareFixtureCodeRoot(tmp);
    mkdirSync(join(codeRoot, 'config'), { recursive: true });
    writeFileSync(join(codeRoot, 'config', 'plugins.yml'), 'plugins:\n  apify: { enabled: true }\n');

    const tracker = join(tmp, 'applications.md');
    writeFileSync(tracker, MINIMAL_TRACKER);

    const portals = join(tmp, 'portals.yml');
    writeFileSync(portals,
      'tracked_companies:\n' +
      '  - name: "apify entry"\n    provider: apify\n    actor: x/y\n    enabled: true\n' +
      '  - name: "bogus entry"\n    provider: definitely-not-a-provider\n    enabled: true\n');

    const runVerifier = (script, extraArgs = []) => {
      try {
        return {
          out: execFileSync(NODE, [join(codeRoot, script), ...extraArgs], {
            cwd: codeRoot, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, CAREER_OPS_PORTALS: portals, CAREER_OPS_TRACKER: tracker, APIFY_TOKEN: '' },
          }),
          code: 0,
        };
      } catch (e) {
        return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status ?? 1 };
      }
    };

    const pipeline = runVerifier('verify-pipeline.mjs');
    if (/unknown provider:\s*apify/i.test(pipeline.out)) {
      fail(`verify-pipeline.mjs still reports the enabled apify plugin as an unknown provider (exit ${pipeline.code})`);
    } else {
      pass('verify-pipeline.mjs resolves an enabled `apify` plugin provider instead of "unknown provider"');
    }
    // Negative direction: a genuinely unknown id must STILL be flagged — the
    // fix must not turn the check into accept-everything.
    if (/unknown provider:\s*definitely-not-a-provider/i.test(pipeline.out)) {
      pass('verify-pipeline.mjs still flags a genuinely unknown provider id');
    } else {
      fail('verify-pipeline.mjs stopped flagging an unknown provider id — the resolution check is now too permissive');
    }

    const portalsRun = runVerifier('verify-portals.mjs', ['--file', portals]);
    if (/unknown provider:\s*apify/i.test(portalsRun.out)) {
      fail(`verify-portals.mjs still reports the enabled apify plugin as an unknown provider (exit ${portalsRun.code})`);
    } else if (/missing env APIFY_TOKEN/i.test(portalsRun.out)) {
      pass('verify-portals.mjs resolves `apify` to the actionable missing-env plugin stub');
    } else {
      fail(`verify-portals.mjs did not prove apify reached the missing-env plugin path (exit ${portalsRun.code})`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
