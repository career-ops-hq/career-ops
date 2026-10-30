// tests/skip-blockers.test.mjs — the requirements behind your most recent skips.
//
// Everything here is synthetic: invented requirements, a throwaway tmpdir for
// the CLI run. Nothing reads user data.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { isDeepStrictEqual } from 'util';

console.log('\nskip-blockers.mjs: requirements behind recent skips');

const { rankSkipBlockers, blockerGroups, parseRequirementImportance } =
  await import(pathToFileURL(join(ROOT, 'skip-blockers.mjs')).href);

const check = (label, actual, expected) => {
  if (isDeepStrictEqual(actual, expected)) pass(label);
  else fail(`${label}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
};

const req = (requirement, importance, match) => ({ requirement, importance, match });
const report = (num, date, state, score, requirements) => ({ num, date, state, score, requirements });

check('a tool name groups under its skill, a known theme under the theme, the rest under its wording', [
  blockerGroups('Production Kubernetes at scale (EKS or GKE)'),
  blockerGroups('Five years managing ML teams'),
  blockerGroups('Team management'),
  blockerGroups('Enterprise pre-sales experience'),
  blockerGroups('Distributed  training on GPUs'),
], [
  [{ key: 'skill:Kubernetes', label: 'Kubernetes', kind: 'skill' }],
  [{ key: 'theme:People management', label: 'People management', kind: 'theme' }],
  [{ key: 'theme:People management', label: 'People management', kind: 'theme' }],
  [{ key: 'theme:Pre-sales', label: 'Pre-sales', kind: 'theme' }],
  [{ key: 'requirement:distributed training on gpus', label: 'Distributed training on GPUs', kind: 'requirement' }],
]);

check('project management is not people management', blockerGroups('Project management of cross-functional teams')[0].kind, 'requirement');

{
  const reports = [
    report(1, '2026-09-01', 'skip', 3.8, [req('Kubernetes operators in production', 'critical', 'partial'), req('People management of 6+ engineers', 'high', 'missing')]),
    report(2, '2026-09-02', 'discarded', 2.9, [req('CKA or equivalent Kubernetes depth', 'high', 'missing'), req('Running Kubernetes clusters', 'critical', 'partial')]),
    report(3, '2026-09-03', 'skip', 3.1, [req('Managing managers', 'critical', 'missing'), req('Rust', 'preferred', 'missing')]),
    report(4, '2026-09-04', 'evaluated', 2.5, [req('Kubernetes in production', 'critical', 'missing')]),
    report(5, '2026-09-05', 'skip', 4.0, [req('Kubernetes in production', 'critical', 'strong'), req('Terraform', 'high', 'partial')]),
    report(6, '2026-09-06', 'skip', 2.2, []),
    report(7, '2026-08-01', 'skip', 3.6, [req('Kubernetes in production', 'high', 'partial')]),
  ];
  const result = rankSkipBlockers(reports, { window: 5 });
  check('ranks blockers across the newest skips', result, {
    window: 5,
    skips: 5,
    blockers: [
      { label: 'Kubernetes', kind: 'skill', skips: 2, missing: 1, partial: 1, closeCalls: 1, reports: [2, 1], wordings: ['CKA or equivalent Kubernetes depth', 'Running Kubernetes clusters', 'Kubernetes operators in production'], nudge: 'evidence' },
      { label: 'People management', kind: 'theme', skips: 2, missing: 2, partial: 0, closeCalls: 1, reports: [3, 1], wordings: ['Managing managers', 'People management of 6+ engineers'], nudge: 'learn' },
    ],
  });

  check('a skip without requirement rows still takes its window slot', rankSkipBlockers(reports, { window: 4 }), { window: 4, skips: 4, blockers: [] });
  check('a wider window reaches the older skip', rankSkipBlockers(reports, { window: 6 }).blockers[0].reports, [2, 1, 7]);
}

check('parses requirement rows and drops malformed ones', parseRequirementImportance([
  { requirement: ' Go ', importance: 'High', match: 'Missing', evidence: 'stated' },
  { requirement: '', importance: 'high', match: 'missing' },
  { requirement: 'SQL', importance: 'high' },
  'Python',
]), [{ requirement: 'Go', importance: 'high', match: 'missing' }]);
check('a summary without the key yields no rows', parseRequirementImportance(undefined), []);

{
  // upskill.mjs checks report links against the canonical tracker path, and macOS tmpdirs sit behind the /var symlink.
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'co-skip-blockers-')));
  try {
    mkdirSync(join(sandbox, 'data'));
    mkdirSync(join(sandbox, 'reports'));
    const rows = [];
    for (let i = 1; i <= 6; i++) {
      const status = i <= 4 ? 'SKIP' : 'Evaluated';
      const file = `${String(i).padStart(3, '0')}-acme-2026-09-0${i}.md`;
      rows.push(`| ${i} | 2026-09-0${i} | Acme ${i} | Data Engineer | 3.${i + 3}/5 | ${status} | ❌ | [${i}](../reports/${file}) | |`);
      writeFileSync(join(sandbox, 'reports', file), `# Evaluation: Acme ${i}\n\n## Machine Summary\n\n\`\`\`yaml\nscore: 3.${i + 3}\nfinal_decision: "Skip"\nhard_stops: []\nsoft_gaps: []\nrequirement_importance:\n  - requirement: "Active TS/SCI clearance"\n    jd_signal: "Active TS/SCI clearance"\n    evidence: "stated"\n    importance: "critical"\n    match: "missing"\n\`\`\`\n`);
    }
    writeFileSync(join(sandbox, 'data', 'applications.md'), ['# Applications Tracker', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|---|---|---|---|---|---|---|---|', ...rows].join('\n') + '\n');
    const res = spawnSync(NODE, [join(ROOT, 'upskill.mjs')], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60000, env: { ...process.env, CAREER_OPS_ROOT: sandbox },
    });
    const out = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
    check('upskill.mjs reports the blocker from the tracker\'s skipped rows only', out.skipBlockers, {
      window: 20,
      skips: 4,
      blockers: [{ label: 'Security clearance', kind: 'theme', skips: 4, missing: 4, partial: 0, closeCalls: 3, reports: [4, 3, 2, 1], wordings: ['Active TS/SCI clearance'], nudge: 'learn' }],
    });
    const summary = spawnSync(NODE, [join(ROOT, 'upskill.mjs'), '--summary'], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60000, env: { ...process.env, CAREER_OPS_ROOT: sandbox },
    }).stdout;
    check('--summary prints the blocker row', summary.split('\n').filter((l) => /BLOCKED|Security clearance/.test(l)), [
      'BLOCKED YOUR LAST 4 SKIPS (critical or high requirement marked missing or partial)',
      '4      4        0        3     learn it                     Security clearance',
    ]);
  } catch (err) {
    fail(`upskill.mjs skipBlockers run failed: ${err.message}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
