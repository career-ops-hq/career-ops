// tests/company-history-corporate-form.test.mjs — `company-history --company`
// finds a tracker row stored with a corporate form.
//
// getCompanyCard() looked the card up by the exact normalizeCompany() key only:
// "Acme" keys as acme and "Acme Inc." as acmeinc, so `--company Acme` returned
// the empty no-history card for a company the tracker has. set-status and
// outcome resolve the same name to that row through
// companiesMatchIgnoringCorporateForm(), and contact-lookup does since #7151.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, NODE } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); });

// Applied in September, so by now each row is a silent-on-you fact.
function card(companies, query) {
  const root = mkdtempSync(join(tmpdir(), 'company-history-form-'));
  dirs.push(root);
  mkdirSync(join(root, 'data'));
  const rows = companies.map((c, i) => `| ${i + 1} | 2026-09-0${i + 1} | ${c} | Senior Data Engineer | 4.2/5 | Applied | ❌ | — | |`);
  writeFileSync(join(root, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...rows, '',
  ].join('\n'));
  const env = { ...process.env };
  // Inherited overrides would point the run at the developer's own files, and
  // environment names are case-insensitive on Windows.
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
  env.CAREER_OPS_ROOT = root;
  const r = spawnSync(NODE, [join(ROOT, 'company-history.mjs'), '--company', query], { cwd: root, env, encoding: 'utf-8', timeout: 30000 });
  assert.equal(r.status, 0, describeSpawn(r));
  return JSON.parse(r.stdout);
}

test('--company finds the row stored with a corporate form', () => {
  for (const query of ['Acme', 'Acme Inc.', 'acme, inc']) {
    const c = card(['Acme Inc.'], query);
    assert.equal(c.company, 'Acme Inc.', query);
    assert.equal(c.responsiveness.label, 'silent-on-you', query);
    assert.equal(c.responsiveness.facts.length, 1, query);
  }
});

test('two corporate-form variants are not one employer to pick from', () => {
  assert.equal(card(['Acme Inc.', 'Acme GmbH'], 'Acme').responsiveness.label, 'no-history');
});

test('a different employer with the same first word is still not this card', () => {
  assert.equal(card(['Acme Inc.'], 'Acme Robotics').responsiveness.label, 'no-history');
});
