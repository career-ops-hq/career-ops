// tests/upskill-empty-summary-gaps.test.mjs — regression coverage for #2762:
// an empty-list Machine Summary must not swallow the body Gap table.
//
// The aggregate path reads gaps from two sources: the cached Machine Summary's
// hard_stops/soft_gaps, and — as a FALLBACK when the summary can't supply them —
// the report body's Gap table. The bug: the fallback was gated on KEY PRESENCE
// (`'hard_stops' in summary || 'soft_gaps' in summary`). But the canonical
// Machine Summary emits `hard_stops: []` / `soft_gaps: []` when empty
// (batch/batch-prompt.md:323), so the keys are present-but-empty. Presence was
// true, the fallback body read was skipped, and a report whose gaps live only in
// its Gap table contributed ZERO gaps — silently, with no error and no failing
// test. The fix gates on NON-EMPTY length after normalizeList().
//
// This suite exercises the real analyze() aggregate path (imported via the
// documented appsFile/cvFile/profileFile test seams, mirroring
// reports-index.mjs's reportsDir/cachePath) against a planted fixture report.
// The report lives in the real reports/ dir because analyze()'s containment
// guard (withinReports) is rooted there; it carries a unique pid-tagged name and
// is removed in finally. cvFile/profileFile point at absent paths so no real CV
// skill can suppress the fixture's gaps.
//
// Auto-discovered by test-all.mjs and imported in-process, so it must NEVER exit
// the process itself — only pass()/fail() from ./helpers.mjs.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nupskill.mjs aggregate: empty-list Machine Summary falls through to the Gap table (#2762)');

const tag = `co2762-${process.pid}-${Date.now()}`;
const reportName = `909-${tag}-2026-01-01.md`;
const reportPath = join(ROOT, 'reports', reportName);
const sandbox = mkdtempSync(join(tmpdir(), 'co-upskill-emptygaps-'));

try {
  const { analyze } = await import(pathToFileURL(join(ROOT, 'upskill.mjs')).href);
  if (typeof analyze !== 'function') {
    fail('upskill.mjs does not export analyze() — the #2762 regression test cannot drive the aggregate path');
  } else {
    // A report whose Machine Summary lists NO gaps (canonical empty `[]`), but
    // whose body Gap table names two real ones. main's path recovers both from
    // the table; the buggy presence-gated path recovers zero.
    const report = [
      `# 909 - Contoso Platform Engineer`,
      '',
      'Assessment narrative here.',
      '',
      '| Gap | Severity | Mitigation |',
      '|-----|----------|------------|',
      '| Kubernetes cluster operations | hard stop | Ramp on K8s |',
      '| Terraform module authoring | soft gap | Study IaC |',
      '',
      '## Machine Summary',
      '',
      '```yaml',
      'company: Contoso',
      'score: 3.0',
      'hard_stops: []',
      'soft_gaps: []',
      '```',
      '',
    ].join('\n');
    writeFileSync(reportPath, report);

    // Temp tracker linking ONLY to the fixture report (root-relative link, the
    // form analyze() resolves against CAREER_OPS).
    const tracker = [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      `| 909 | 2026-01-01 | Contoso | Platform Engineer | 3.0/5 | Evaluated | ❌ | [909](reports/${reportName}) | fixture |`,
      '',
    ].join('\n');
    const trackerPath = join(sandbox, 'applications.md');
    writeFileSync(trackerPath, tracker);

    const result = analyze(1, {
      noCache: true,
      appsFile: trackerPath,
      cvFile: join(sandbox, 'no-such-cv.md'),
      profileFile: join(sandbox, 'no-such-profile.yml'),
    });

    const gapSkills = (result.gaps || []).map(g => g.skill);
    const hasK8s = gapSkills.includes('Kubernetes');
    const hasTerraform = gapSkills.includes('Terraform');

    if (result.error) {
      fail(`analyze() returned an error instead of a gap map: ${result.error}`);
    } else if (hasK8s && hasTerraform) {
      // The load-bearing assertion: BOTH body-table gaps survive an empty-list
      // Machine Summary. Reverting the fix (presence check) makes gaps === [],
      // reddening this line — the mutation check.
      pass('both Gap-table gaps (Kubernetes, Terraform) recovered despite hard_stops:[] / soft_gaps:[] in the Machine Summary');
    } else {
      fail(`empty-list summary swallowed the Gap table (#2762): gaps=[${gapSkills.join(', ')}]`);
    }
  }

  // Bonus (#2762 rebase collision): `--no-cache` must be a recognized flag in
  // upskill.mjs's strict validateFlags gate, not rejected before it is read.
  {
    const res = spawnSync(NODE, [join(ROOT, 'upskill.mjs'), '--no-cache'], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stderr = res.stderr || '';
    if (!/unrecognized flag/i.test(stderr)) {
      pass('`upskill.mjs --no-cache` is accepted by validateFlags (not rejected as an unrecognized flag)');
    } else {
      fail(`\`upskill.mjs --no-cache\` was rejected as unrecognized: ${JSON.stringify(stderr.slice(0, 200))}`);
    }
  }
} catch (e) {
  fail(`upskill empty-summary-gaps tests crashed: ${e.stack || e.message}`);
} finally {
  rmSync(reportPath, { force: true });
  rmSync(sandbox, { recursive: true, force: true });
}
