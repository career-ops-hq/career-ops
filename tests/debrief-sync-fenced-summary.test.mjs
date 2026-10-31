import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadYaml } from '../lib/yaml-document.mjs';

const SCRIPT = fileURLToPath(new URL('../debrief-sync.mjs', import.meta.url));
const SENTENCE = 'On-site relocation is not possible';
const SUMMARY = '## Machine Summary\n\n```yaml\ncompany: "Northwind"\nrole: "Platform Engineer"\nscore: 4.2\nfinal_decision: "Apply"\nhard_stops: []\n```\n';

function fixture(report) {
  const root = mkdtempSync(join(tmpdir(), 'debrief-fenced-summary-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'reports'));
  const tracker = join(root, 'data/applications.md');
  const reportPath = join(root, 'reports/007-northwind.md');
  writeFileSync(tracker, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 7 | 2026-01-05 | Northwind | Platform Engineer | 4.2/5 | Interview | — | [7](reports/007-northwind.md) | screen done |',
    '',
  ].join('\n'));
  writeFileSync(reportPath, report);
  return { root, tracker, reportPath };
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT, '--app', '7', '--dealbreaker', SENTENCE], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_FOLLOWUPS: '',
      CAREER_OPS_PROFILE: '',
    },
  });
}

for (const outer of ['````', '~~~']) {
  const example = `${outer}markdown\n${SUMMARY}${outer}\n\n`;
  test(`dealbreaker updates the real summary after a ${outer} example`, () => {
    const prefix = '# Evaluation: Northwind\n\n## Reference example\n\n' + example;
    const f = fixture(prefix + SUMMARY);
    try {
      const result = run(f.root);
      assert.equal(result.status, 0, result.stderr);
      const actual = readFileSync(f.reportPath, 'utf8');
      assert.equal(actual.slice(0, prefix.length), prefix, 'example must remain byte-for-byte unchanged');
      const body = actual.slice(prefix.length).match(/```yaml\n([\s\S]*?)\n```/)[1];
      const summary = loadYaml(body);
      assert.equal(summary.final_decision, 'Skip');
      assert.deepEqual(summary.hard_stops, [SENTENCE]);
      assert.equal(summary.score, 4.2);
      assert.match(readFileSync(f.tracker, 'utf8'), /Dealbreaker: On-site relocation is not possible/);
      assert.equal(run(f.root).status, 0);
      assert.equal(readFileSync(f.reportPath, 'utf8'), actual, 'repeat must be idempotent');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  for (const heading of ['', '## Machine Summary\n\n']) {
    test(`an example inside ${outer} is not a report summary (section: ${Boolean(heading)})`, () => {
      const original = '# Evaluation: Northwind\n\n' + heading + example;
      const f = fixture(original);
      try {
        const tracker = readFileSync(f.tracker, 'utf8');
        const result = run(f.root);
        assert.notEqual(result.status, 0, 'missing real summary must fail');
        assert.match(result.stderr, /no Machine Summary YAML/);
        assert.equal(readFileSync(f.reportPath, 'utf8'), original);
        assert.equal(readFileSync(f.tracker, 'utf8'), tracker);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    });
  }
}
