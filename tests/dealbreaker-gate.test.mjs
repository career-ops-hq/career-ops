// tests/dealbreaker-gate.test.mjs — a posting that breaks one of the
// candidate's own hard rules stops before Block A.
//
// Without the gate the agent noticed the broken rule in its first turn and
// still wrote the full A-H report, so a skip took as long as a real candidate
// (about 5 to 8 minutes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, ownRootEnv } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const oferta = readFileSync(join(ROOT, 'modes', 'oferta.md'), 'utf8');
const autoPipeline = readFileSync(join(ROOT, 'modes', 'auto-pipeline.md'), 'utf8');

function section(text, heading) {
  const start = text.indexOf(`\n${heading}`);
  assert.ok(start >= 0, `missing section: ${heading}`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

const gate = section(oferta, '## Dealbreaker gate');

test('the gate runs after the blacklist gate and before any evaluation', () => {
  const at = oferta.indexOf('\n## Dealbreaker gate');
  const blacklistAt = oferta.indexOf('\n## Blacklist gate');
  assert.ok(blacklistAt >= 0, 'missing blacklist gate');
  assert.ok(blacklistAt < at);
  assert.ok(at < oferta.indexOf('\n## Step 0'));
  assert.ok(at < oferta.indexOf('\n## Block A'));
});

test('the gate reads the candidate\'s own rules and no new config', () => {
  for (const source of ['config/profile.yml', 'modes/_profile.md', 'modes/_custom.md', 'compensation.minimum']) {
    assert.ok(gate.includes(source), `gate does not read ${source}`);
  }
});

test('only a stated JD fact against a hard rule stops the evaluation', () => {
  assert.match(gate, /states?/i);
  assert.match(gate, /inferred/i);
  assert.match(gate, /scored preference/i, 'a scored preference must not count as a hard rule');
});

test('a hit writes nothing and lets the candidate override', () => {
  assert.match(gate, /stop before Block A/i);
  for (const artifact of ['report', 'tracker', 'CV']) assert.ok(gate.includes(artifact), `gate does not rule out a ${artifact}`);
  assert.match(gate, /anyway\?/);
  assert.match(gate, /explicit yes/i);
});

test('auto-pipeline applies the same gate before Step 1', () => {
  const step = section(autoPipeline, '## Step 0.7 — Dealbreaker gate');
  assert.ok(step.includes('modes/oferta.md'));
  assert.match(step, /headless/i);
  assert.ok(autoPipeline.indexOf('## Step 0.7') < autoPipeline.indexOf('## Step 1'));
});

test('a headless run records a SKIP and ends on one fixed line instead of asking', () => {
  assert.match(gate, /headless/i);
  for (const runner of ['-p', 'auto-pipeline', 'batch/batch-prompt.md']) assert.ok(gate.includes(runner), `headless rule does not name ${runner}`);
  assert.match(gate, /^\s*needs_confirmation: dealbreaker "\{rule\}" - rerun with "evaluate anyway" to evaluate$/m);
  assert.match(gate, /Interactive/);
});

test('the headless SKIP row merges into the tracker with the rule and the JD line', (t) => {
  const tsv = gate.match(/```tsv\n([\s\S]*?)```/)?.[1]?.replace(/^[ \t]+/gm, '');
  assert.ok(tsv, 'gate has no tsv example');
  const dir = mkdtempSync(join(tmpdir(), 'co-dealbreaker-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'batch', 'tracker-additions'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n');
  const row = tsv
    .replace('{num}', '7').replace('{date}', '2026-01-31').replace('{company}', 'Adatum').replace('{role}', 'Staff Designer')
    .replace('{rule}', 'no fully on-site roles').replace('{jd_line}', 'This role is on site five days a week')
    .replace('{url}', 'https://example.test/jobs/7')
    .replaceAll('\\t', '\t');
  writeFileSync(join(dir, 'batch', 'tracker-additions', '7-adatum.tsv'), row);
  const result = spawnSync(process.execPath, [join(ROOT, 'merge-tracker.mjs')], { cwd: dir, encoding: 'utf8', env: ownRootEnv({ CAREER_OPS_ROOT: dir }) });
  assert.equal(result.status, 0, describeSpawn(result));
  const merged = readFileSync(join(dir, 'data', 'applications.md'), 'utf8').trim().split('\n').at(-1);
  assert.match(merged, /\| Adatum \| Staff Designer \| N\/A \| SKIP \|/);
  assert.ok(merged.includes('"no fully on-site roles"') && merged.includes('"This role is on site five days a week"'), merged);
});

test('a headless hit on an agency posting waits for the agency answer and writes nothing', () => {
  assert.match(gate, /agency[^.]*write no SKIP row/i);
  assert.ok(gate.includes('Agency confirmation handoff'));
});

test('quoted text cannot break the one-line TSV row', () => {
  assert.match(gate, /tab or line break[^.]*with a space/i);
});
