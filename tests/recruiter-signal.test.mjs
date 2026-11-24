// tests/recruiter-signal.test.mjs — coverage for recruiter-signal.mjs (#7694)
//
// Fictional firms and people throughout: contacts and mandates are
// third-party data and no fixture here resembles anyone real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSignal, parseMandates } from '../recruiter-signal.mjs';

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'recruiter-signal.mjs');
const TODAY = '2026-11-24';
const titleFilter = { positive: ['CIO', 'IT Director'], negative: ['Junior'] };
const h = (company, title, first_seen = '2026-11-20', url = `https://x.example/${company}/${title}`) => ({ url, company, title, first_seen });

test('parseMandates: keeps valid rows, reports bad ones with a reason', () => {
  const { mandates, quality } = parseMandates([
    '# date\tfirm\trole\tclient\tstatus\tnotes',
    '2026-11-10\tNorthbeam Search\tCIO\t?\texpected\topens in January',
    '2026-11-11\tNorthbeam Search\tCTO\tGlobex\topen',
    '11/12/2026\tNorthbeam Search\tCOO\t?\topen',
    '2026-11-13\tNorthbeam Search\tCOO\t?\tmaybe',
    '',
  ].join('\n'));
  assert.equal(mandates.length, 2);
  assert.equal(mandates[0].client, '?');
  assert.deepEqual(quality.map((q) => q.line), [4, 5]);
});

test('buildSignal: a firm counts through via, contact, mandate or its name; others are ignored', () => {
  const { firms } = buildSignal({
    today: TODAY, titleFilter,
    history: [h('Northbeam Search', 'CIO'), h('Tallow', 'IT Director'), h('Acme Recruitment', 'Junior CIO'), h('Plain Bakery', 'CIO')],
    trackerRows: [{ num: 3, company: '?', via: 'Tallow', role: 'COO', status: 'Applied' }, { num: 4, company: 'Initech', via: '—' }],
    contacts: [{ name: 'Jo Ray', company: 'Northbeam Search', type: 'recruiter' }],
    mandates: [{ date: '2026-11-10', firm: 'Quillon', role: 'CTO', client: '?', status: 'expected', notes: '' }],
  });
  const by = Object.fromEntries(firms.map((f) => [f.firm, f]));
  assert.deepEqual(Object.keys(by).sort(), ['Acme Recruitment', 'Northbeam Search', 'Quillon', 'Tallow']);
  assert.deepEqual(by.Tallow.sources, ['via']);
  assert.equal(by.Tallow.applications.length, 1);
  assert.deepEqual(by['Northbeam Search'].contacts, ['Jo Ray']);
  assert.equal(by['Acme Recruitment'].onTarget, 0, 'negative keyword keeps the title off-target');
  assert.equal(by['Acme Recruitment'].postings, 1);
  assert.equal(by.Quillon.mandates.expected, 1);
});

test('buildSignal: window, url dedup, case-folded firm names and ranking', () => {
  const { firms, since } = buildSignal({
    today: TODAY, titleFilter, days: 30,
    history: [
      h('Northbeam Recruitment', 'CIO', '2026-11-01', 'u1'),
      h('Northbeam Recruitment', 'CIO', '2026-11-02', 'u1'),
      h('NORTHBEAM RECRUITMENT', 'IT Director', '2026-11-03', 'u2'),
      h('Northbeam Recruitment', 'CIO', '2026-09-01', 'u3'),
      h('Zed Staffing', 'CIO', '2026-11-05', 'u4'),
    ],
  });
  assert.equal(since, '2026-10-25');
  assert.equal(firms[0].firm, 'Northbeam Recruitment');
  assert.equal(firms[0].postings, 2);
  assert.equal(firms[0].onTarget, 2);
  assert.equal(firms[0].lastSeen, '2026-11-03');
  assert.equal(firms[1].firm, 'Zed Staffing');
});

test('buildSignal: --firm counts a firm nothing else knows yet, and only that firm', () => {
  const { firms } = buildSignal({ today: TODAY, titleFilter, firm: 'Tallow', history: [h('Tallow', 'CIO'), h('Zed Staffing', 'CIO')] });
  assert.equal(firms.length, 1);
  assert.equal(firms[0].onTarget, 1);
  assert.deepEqual(firms[0].sources, ['query']);
});

test('CLI: reads the data root and rejects a bad --days', () => {
  const root = mkdtempSync(join(tmpdir(), 'recruiter-signal-'));
  try {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'portals.yml'), 'title_filter:\n  positive: ["CIO"]\n');
    writeFileSync(join(root, 'data/scan-history.tsv'), `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://x.example/1\t${new Date().toISOString().slice(0, 10)}\tvdab-api\tCIO\tNorthbeam Recruitment\tadded\n`);
    writeFileSync(join(root, 'data/mandates.tsv'), 'bad line\n');
    const env = { ...process.env, CAREER_OPS_ROOT: root };
    const ok = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf-8' });
    assert.equal(ok.status, 0, ok.stderr);
    const out = JSON.parse(ok.stdout);
    assert.equal(out.firms[0].firm, 'Northbeam Recruitment');
    assert.equal(out.quality.length, 1);
    const bad = spawnSync(process.execPath, [SCRIPT, '--days', '0'], { env, encoding: 'utf-8' });
    assert.equal(bad.status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
