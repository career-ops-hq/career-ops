// tests/agent-docs-data-root-paths.test.mjs — the agent docs send user-layer
// reads and writes to the data root, not the checkout (#5346).
//
// With CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR / a .career-ops-data marker, the
// scripts resolve user files through path-resolver.mjs, but an interactive
// agent resolves them from what the docs tell it. Two docs told it the
// checkout:
//
//   - the router resolved `config/`, `data/` and the user's mode files against
//     PROJECT_ROOT, so profile.yml, _profile.md and _custom.md were read from
//     the checkout and, being "(if exists)", skipped without a word;
//   - AGENTS.md and modes/_shared.md put tracker TSVs at a bare
//     `batch/tracker-additions/`, while merge-tracker.mjs reads
//     <dataRoot>/batch/tracker-additions. The row never merged, and both
//     merge-tracker and verify-pipeline reported nothing pending.
//
// The suite runs with the default layout, where the two roots are one
// directory, so nothing caught either. The last case merges a TSV written
// where AGENTS.md says to write it, under a configured data root.
//
// Run:  node --test tests/agent-docs-data-root-paths.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

const ROUTER = '.agents/skills/career-ops/SKILL.md';
const TSV_DIR = 'batch/tracker-additions/';

/** The router paragraph that assigns each path to a root. */
function routingRule(text) {
  const rule = text.split(/\r?\n/).find(line => line.startsWith('Resolve every path in this router'));
  assert.ok(rule, `${ROUTER} has no "Resolve every path in this router" rule`);
  return rule;
}

test('the router derives DATA_ROOT with path-resolver.mjs precedence', () => {
  const text = read(ROUTER);
  for (const token of ['`DATA_ROOT`', '`CAREER_OPS_ROOT`', '`CAREER_OPS_DATA_DIR`', '.career-ops-data', 'path-resolver.mjs']) {
    assert.ok(text.includes(token), `${ROUTER} does not mention ${token}`);
  }
});

test('the router resolves user-layer paths against DATA_ROOT', () => {
  const rule = routingRule(read(ROUTER));
  const [userPart, systemPart] = rule.split('Everything else');
  assert.ok(systemPart, 'the routing rule no longer separates user-layer paths from everything else');
  assert.match(userPart, /against `DATA_ROOT`/);
  for (const path of ['`config/`', '`data/`', '`reports/`', '`output/`', '`modes/_profile.md`', '`modes/_custom.md`', `\`${TSV_DIR}\``]) {
    assert.ok(userPart.includes(path), `the routing rule does not resolve ${path} against DATA_ROOT`);
  }
  assert.match(systemPart, /against `PROJECT_ROOT`/);
});

/**
 * Bare `batch/tracker-additions/` code spans outside the layer lists. Each one
 * is an instruction an agent reads as "under the checkout".
 */
function bareTsvPaths(text, allowedLinePrefixes) {
  return text.split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes('`' + TSV_DIR))
    .filter(({ line }) => !allowedLinePrefixes.some(prefix => line.startsWith(prefix)))
    .map(({ n, line }) => `${n}: ${line.slice(0, 100)}`);
}

test('AGENTS.md and modes/_shared.md write tracker TSVs under {DATA_ROOT}', () => {
  const agents = read('AGENTS.md');
  const shared = read('modes/_shared.md');
  assert.deepEqual(bareTsvPaths(agents, ['- **User Layer', '- **System Layer']), []);
  assert.deepEqual(bareTsvPaths(shared, ['All User Layer files']), []);
  assert.ok(agents.includes('`{DATA_ROOT}/batch/tracker-additions/{num}-{company-slug}.tsv`'));
  assert.ok(shared.includes('`{DATA_ROOT}/batch/tracker-additions/`'));
  assert.match(agents, /`batch\/\*` \(except `batch\/tracker-additions\/`\)/,
    'AGENTS.md lists all of batch/* as System Layer, which points agents at the checkout');
});

test('a TSV written where AGENTS.md says merges under a configured data root', () => {
  const documented = read('AGENTS.md').match(/`\{DATA_ROOT\}\/(batch\/tracker-additions)\/\{num\}-\{company-slug\}\.tsv`/);
  assert.ok(documented, 'AGENTS.md no longer names the TSV location as {DATA_ROOT}/batch/tracker-additions/');

  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-docs-dataroot-'));
  try {
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    const tracker = join(dataRoot, 'data', 'applications.md');
    writeFileSync(tracker, '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n');
    const additions = join(dataRoot, documented[1]);
    mkdirSync(additions, { recursive: true });
    writeFileSync(join(additions, '901-example-co.tsv'),
      'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n' +
      '901\t2026-10-16\tExample Co\tEngineer\tEvaluated\t4.0/5\t❌\t—\tsynthetic\n');

    const r = spawnSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], {
      cwd: ROOT, encoding: 'utf-8', timeout: 60_000,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: dataRoot,
        CAREER_OPS_DATA_DIR: '',
        CAREER_OPS_TRACKER: '',
        CAREER_OPS_ADDITIONS: '',
      },
    });
    assert.equal(r.status, 0, `merge-tracker exited ${r.status}: ${r.stderr}`);
    assert.match(readFileSync(tracker, 'utf-8'), /\| 901 \| 2026-10-16 \| Example Co \| Engineer \|/,
      `the documented TSV was not merged:\n${r.stdout}`);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
