// tests/verifiers-plugin-providers.test.mjs — the scanner and both health
// checkers must resolve providers through the SAME path (#4026).
//
// scan.mjs folds enabled provider plugins into its map with
// mergeProviderPlugins(). verify-pipeline.mjs and verify-portals.mjs did not,
// so a supported `provider: <plugin-id>` portals entry was reported as an
// "unknown provider" that "never scans" — while the scanner scanned it. The
// divergence is the bug and it can reappear the moment a caller drifts, so it
// is pinned structurally (three callers must agree) AND behaviorally (an
// enabled stub plugin resolves in verify-pipeline's own load path).
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail, warn, NODE } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('\nverifiers resolve provider plugins like the scanner (#4026)');

// ── 1. Structural: all three provider-map builders call mergeProviderPlugins ──
{
  const callers = ['scan.mjs', 'verify-pipeline.mjs', 'verify-portals.mjs'];
  const missing = callers.filter((f) => !/mergeProviderPlugins\s*\(/.test(readFileSync(join(ROOT, f), 'utf8')));
  if (missing.length === 0) {
    pass('scan.mjs, verify-pipeline.mjs and verify-portals.mjs all call mergeProviderPlugins()');
  } else {
    fail(`these provider-map builders skip mergeProviderPlugins() and will disagree with the scanner: ${missing.join(', ')}`);
  }
}

// ── 2. Behavioral: run the real verify-pipeline.mjs against a portals entry
//    using the bundled `apify` plugin, enabled. Before the fix it printed
//    "unknown provider: apify" and exited 1; after, apify resolves (to an
//    actionable "missing env APIFY_TOKEN" stub here) and the false error is
//    gone. verify-pipeline resolves plugins from its own CODE_ROOT, so
//    config/plugins.yml has to live in the real checkout — skip rather than
//    clobber a real user's config. ──
{
  const pluginsConfig = join(ROOT, 'config', 'plugins.yml');
  if (existsSync(pluginsConfig)) {
    warn('config/plugins.yml already exists — skipping the spawn test rather than overwriting it');
  } else {
    const tmp = mkdtempSync(join(tmpdir(), 'co-4026-'));
    try {
      writeFileSync(pluginsConfig, 'plugins:\n  apify: { enabled: true }\n');
      const portals = join(tmp, 'portals.yml');
      writeFileSync(portals,
        'tracked_companies:\n  - name: "apify 4026"\n    provider: apify\n    actor: x/y\n    enabled: true\n');

      let out = '';
      let exitCode = 0;
      try {
        out = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs')], {
          cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, CAREER_OPS_PORTALS: portals, APIFY_TOKEN: '' },
        });
      } catch (e) {
        out = `${e.stdout || ''}${e.stderr || ''}`;
        exitCode = e.status ?? 1;
      }

      if (!/unknown provider:\s*apify/i.test(out)) {
        pass('verify-pipeline.mjs resolves an enabled `apify` plugin provider instead of "unknown provider"');
      } else {
        fail(`verify-pipeline.mjs still reports the enabled apify plugin as an unknown provider (exit ${exitCode})`);
      }
    } finally {
      if (existsSync(pluginsConfig)) unlinkSync(pluginsConfig);
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}
