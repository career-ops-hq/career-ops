import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { findStaleScanQueries } from '../audit-portals.mjs';

const entry = (scan_query, extra = {}) => ({ name: 'Example', scan_method: 'websearch', scan_query, ...extra });

test('changed targeting flags the old query and preserves its evidence', () => {
  const query = 'site:careers.example.com "AI Engineer" OR "Solutions Architect"';
  const companies = [entry(query)];
  const original = structuredClone(companies);
  const rows = findStaleScanQueries(companies, ['Design Technologist', 'Front-End']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].query, query);
  assert.match(rows[0].detail, /possibly stale/);
  assert.deepEqual(companies, original);
});

test('matching, case, punctuation and Unicode normalization stay quiet', () => {
  for (const [query, keyword] of [
    ['"FRONT end"', 'Front-End'], ['"Ｄｅｓｉｇｎ"', 'Design'],
    ['"Développeur"', 'De\u0301veloppeur'], ['"数据工程师"', '数据工程师'],
    ['"C++ Developer"', 'C++'],
  ]) assert.deepEqual(findStaleScanQueries([entry(query)], [keyword]), []);
});

test('domain names, exclusions and Boolean operators cannot supply the overlap', () => {
  const queries = [
    'site:design.example.com "AI"', 'site:"design.example.com" "AI"',
    '"AI" -"Design Engineer"', '"AI" -design', '"AI" OR "ML"',
    '"AI" NOT "Design"', '"AI" (-"Design")', '"AI" -(Design OR UX)',
    'https://design.example.com/jobs "AI"',
  ];
  for (const query of queries) {
    assert.equal(findStaleScanQueries([entry(query)], ['Design', 'OR']).length, 1, query);
  }
});

test('whole words avoid substring matches', () => {
  assert.equal(findStaleScanQueries([entry('"Chair"')], ['AI']).length, 1);
});

test('missing targeting or non-query entries do not produce warnings', () => {
  for (const keywords of [undefined, [], ['', null, 42], {}]) {
    assert.deepEqual(findStaleScanQueries([entry('AI')], keywords), []);
  }
  assert.deepEqual(findStaleScanQueries([
    null, entry('AI', { enabled: false }), entry('AI', { scan_method: 'api' }),
    entry(''), entry(42), entry('site:example.com'),
    { scan_method: 'websearch', careers_url: 'https://example.com' },
  ], ['Design']), []);
});

test('search_query fallback and scan_query precedence match scanner handoff', () => {
  assert.equal(findStaleScanQueries([entry('', { search_query: 'AI' })], ['Design']).length, 1);
  assert.deepEqual(findStaleScanQueries([entry('Design', { search_query: 'AI' })], ['Design']), []);
});

test('CLI is offline, advisory, data-root aware, filterable and read-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-query-audit-'));
  try {
    const file = join(dir, 'portals.yml');
    const content = 'title_filter:\n  positive: [Design]\ntracked_companies:\n  - name: Old Target\n    scan_method: websearch\n    scan_query: AI\n    careers_url: https://example.invalid/jobs\n  - name: Current Target\n    scan_method: websearch\n    scan_query: Design\n';
    writeFileSync(file, content);
    const guard = join(dir, 'network-guard.cjs');
    const networkLog = join(dir, 'network-attempts');
    writeFileSync(guard, `const { appendFileSync } = require('node:fs');
      const deny = () => { appendFileSync(${JSON.stringify(networkLog)}, 'attempt\\n'); throw new Error('network forbidden'); };
      globalThis.fetch = deny;
      for (const id of ['node:http', 'node:https']) {
        const mod = require(id); mod.request = deny; mod.get = deny;
      }
    `);
    // A recognized provider would fetch if --queries fell through to live auditing.
    const guardedContent = content + '  - name: Live Board\n    careers_url: https://job-boards.greenhouse.io/example\n';
    writeFileSync(file, guardedContent);
    const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir };
    delete env.CAREER_OPS_PORTALS;
    const run = (...args) => spawnSync(process.execPath, [
      '--require', guard,
      fileURLToPath(new URL('../audit-portals.mjs', import.meta.url)), '--queries', ...args,
    ], { cwd: tmpdir(), encoding: 'utf8', timeout: 10000, env });
    const result = run('--json', '--strict');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).warnings[0].name, 'Old Target');
    const alternate = join(dir, 'alternate.yml');
    writeFileSync(alternate, content.replace('Current Target', 'Alternate Target'));
    const filtered = run('--file', alternate, '--company', 'Alternate', '--json');
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.deepEqual(JSON.parse(filtered.stdout), { warnings: [] });
    assert.match(run('--summary').stdout, /possibly stale/);
    assert.equal(run('--company', 'missing').status, 1);
    assert.equal(readFileSync(file, 'utf8'), guardedContent);
    assert.throws(() => readFileSync(networkLog), { code: 'ENOENT' });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
