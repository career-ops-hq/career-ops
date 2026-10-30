// tests/precheck-duplicate.test.mjs — precheck-duplicate.mjs ranks possible
// duplicate tracker rows and never writes. Synthetic fixtures only.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findDuplicateCandidates, companyRelation, stripLocationSuffix } from '../precheck-duplicate.mjs';

console.log('\nprecheck-duplicate — read-only pre-apply duplicate check');

const HEADER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|-----|',
];
const row = (n, date, company, role, status, notes = '', url = '') =>
  `| ${n} | ${date} | ${company} | ${role} | 4.0/5 | ${status} | ❌ | [${n}](reports/${n}.md) | ${notes} | ${url} |`;

const ROWS = [
  row(1, '2026-01-10', 'Northwind Hospital', 'Help Desk Analyst', 'Applied', 'req JR-1001', 'https://jobs.example.test/p/1001'),
  row(2, '2026-02-01', 'Fabrikam University', 'Program Coordinator', 'Rejected'),
  row(3, '2026-03-01', 'Contoso Robotics', 'Data Engineer', 'Evaluated'),
  row(4, '2026-03-02', 'Contoso Foods', 'Data Engineer', 'Applied'),
];
const FIXTURE = [...HEADER, ...ROWS].join('\n') + '\n';

const work = mkdtempSync(join(tmpdir(), 'co-precheck-'));
try {
  const root = join(work, 'root');
  mkdirSync(join(root, 'data'), { recursive: true });
  const tracker = join(root, 'data', 'applications.md');
  writeFileSync(tracker, FIXTURE);

  const run = (args, env = {}) => execFileSync(NODE, [join(ROOT, 'precheck-duplicate.mjs'), ...args], {
    encoding: 'utf-8', timeout: 30000,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', ...env },
  });
  const json = (args, env) => JSON.parse(run([...args, '--json'], env));

  // 1. URL match; tracking params ignored.
  let r = json(['--company', 'Anything', '--title', 'Whatever', '--url', 'https://jobs.example.test/p/1001?utm_source=x']);
  if (r.candidates[0]?.num === 1 && r.candidates[0].reason === 'url') pass('URL match (tracking params stripped) ranks first');
  else fail(`URL match: ${JSON.stringify(r.candidates)}`);

  // 2. Repost under a new title but the same requisition ID.
  r = json(['--company', 'Northwind Hospital', '--title', 'Service Desk Lead', '--req', 'JR-1001']);
  if (r.candidates[0]?.num === 1 && r.candidates[0].reason === 'req') pass('same requisition ID at the same company matches');
  else fail(`req match: ${JSON.stringify(r.candidates)}`);

  // 3. A req ID alone does not match an unrelated company.
  r = json(['--company', 'Globex Corp', '--title', 'Service Desk Lead', '--req', 'JR-1001']);
  if (r.candidates.length === 0) pass('req ID at an unrelated company is not a match');
  else fail(`req false positive: ${JSON.stringify(r.candidates)}`);

  // 4. Same company, reordered title.
  r = json(['--company', 'northwind hospital', '--title', 'Analyst, Help Desk']);
  if (r.candidates[0]?.num === 1 && r.candidates[0].reason === 'same-title') pass('same company + same title identity matches');
  else fail(`same-title: ${JSON.stringify(r.candidates)}`);

  // 5. Parent organisation with a parenthesised unit; Rejected is a warning.
  r = json(['--company', 'Fabrikam University Eastside (FUE)', '--title', 'Program Coordinator']);
  const c = r.candidates[0];
  if (c && c.num === 2 && c.reason === 'parent-org' && c.warning === true) pass('parent organisation + similar title matches; Rejected row is a warning');
  else fail(`parent-org: ${JSON.stringify(r.candidates)}`);

  // 6. One shared leading word is not a parent organisation.
  r = json(['--company', 'Contoso Foods', '--title', 'Data Engineer']);
  if (r.candidates.length === 1 && r.candidates[0].num === 4) pass('"Contoso Robotics" is not folded into "Contoso Foods"');
  else fail(`over-match: ${JSON.stringify(r.candidates)}`);
  if (companyRelation('Contoso', 'Contoso Robotics') === null) pass('a single-token name is never a parent organisation');
  else fail('single-token parent match');

  // 7. Pure function and the no-match line.
  if (findDuplicateCandidates([], { company: 'X', title: 'Y' }).length === 0) pass('empty tracker -> no candidates');
  else fail('empty tracker');
  const text = run(['--company', 'Nobody Inc', '--title', 'Nothing']);
  if (/No possible duplicate/.test(text)) pass('no match prints a clear line and exits 0');
  else fail(`text output: ${text}`);

  // 8. Text format: one line per candidate with row number, status, date.
  const line = run(['--company', 'Northwind Hospital', '--title', 'Help Desk Analyst']).split('\n').find(l => l.startsWith('#1'));
  if (line && line.includes('Applied') && line.includes('2026-01-10')) pass('text output is one line per candidate with status and date');
  else fail(`text line: ${line}`);

  // 9. CAREER_OPS_TRACKER override is honoured; the tracker is never modified.
  const other = join(work, 'other.md');
  writeFileSync(other, [...HEADER, row(9, '2026-04-01', 'Initech', 'Analyst', 'Applied')].join('\n') + '\n');
  r = json(['--company', 'Initech', '--title', 'Analyst']);
  if (r.candidates.length === 0) pass('default tracker has no Initech row');
  else fail('unexpected Initech match');
  const o = json(['--company', 'Initech', '--title', 'Analyst'], { CAREER_OPS_TRACKER: other });
  if (o.candidates[0]?.num === 9) pass('CAREER_OPS_TRACKER override is honoured');
  else fail(`override: ${JSON.stringify(o)}`);
  if (readFileSync(tracker, 'utf-8') === FIXTURE) pass('tracker file is unchanged (read-only)');
  else fail('tracker was modified');

  // 10. A missing tracker is advisory, exit 0.
  const none = run(['--company', 'X', '--title', 'Y'], { CAREER_OPS_TRACKER: join(work, 'missing.md') });
  if (/No tracker found/.test(none)) pass('missing tracker exits 0 with a notice');
  else fail(`missing tracker: ${none}`);

  // 11. Different parenthesised units under one parent are siblings, not the same unit.
  if (companyRelation('Fabrikam University (East)', 'Fabrikam University (West)') === 'parent') pass('different parenthesised units are a parent relation');
  else fail('East/West units should be parent, not same');
  if (companyRelation('Fabrikam University (East)', 'Fabrikam University (East)') === 'same') pass('identical parenthesised unit is the same');
  else fail('identical unit should be same');

  // 11b. The same unit written in round or square brackets is the same unit.
  if (companyRelation('Fabrikam University (East)', 'Fabrikam University [East]') === 'same') pass('round and square brackets around the same unit are the same');
  else fail('(East) vs [East] should be same');
  if (companyRelation('Fabrikam University [East]', 'Fabrikam University [West]') === 'parent') pass('different square-bracket units are a parent relation');
  else fail('[East] vs [West] should be parent');

  // 11c. A REQ- label is not part of the requisition identity; a decorated status still warns.
  const reqRows = [
    { num: 7, date: '2026-04-01', company: 'Northwind Hospital', role: 'Coordinator', status: '**Rejected** 2026-04-02', notes: 'req REQ-2026-32061', url: '' },
    { num: 8, date: '2026-04-01', company: 'Northwind Hospital', role: 'Analyst', status: 'Applied', notes: 'job id 88214', url: '' },
  ];
  for (const q of ['REQ-2026-32061', '2026-32061']) {
    const r = findDuplicateCandidates(reqRows, { company: 'Northwind Hospital', title: 'Zzz', req: q });
    if (r.length === 1 && r[0].num === 7 && r[0].reason === 'req') pass(`requisition "${q}" matches the row written as REQ-2026-32061`);
    else fail(`requisition "${q}" should match #7 by req, got ${JSON.stringify(r)}`);
  }
  const w = findDuplicateCandidates(reqRows, { company: 'Northwind Hospital', title: 'Zzz', req: '2026-32061' })[0];
  if (w && w.warning === true) pass('a bold/dated Rejected status still sets the warning flag');
  else fail('decorated Rejected status should warn');

  // 13. Issue #5997: separator-less req IDs and location-suffixed titles (fictional tracker).
  const root2 = join(work, 'root2');
  mkdirSync(join(root2, 'data'), { recursive: true });
  writeFileSync(join(root2, 'data', 'applications.md'), [...HEADER,
    row(1, '2026-10-23', 'Acme Supply Canada', 'HR Generalist (Brampton, ON)', 'Applied', 'Brampton ON on-site; JR9727; full time'),
    row(2, '2026-10-24', 'Northwind Foods', 'Operations Analyst', 'Applied', 'req JR-4411; remote'),
    row(3, '2026-10-25', 'Acme Supply Canada', 'Payroll Manager (Brampton, ON)', 'Applied'),
  ].join('\n') + '\n');
  const q = (args) => json(args, { CAREER_OPS_ROOT: root2 }).candidates;
  let cc = q(['--company', 'Acme Supply Canada', '--title', 'Zzz Unrelated', '--req', 'JR9727']);
  if (cc[0]?.num === 1 && cc[0].reason === 'req') pass('--req JR9727 matches a note written JR9727');
  else fail(`JR9727: ${JSON.stringify(cc)}`);
  for (const rq of ['JR-9727', '9727']) {
    cc = q(['--company', 'Acme Supply Canada', '--title', 'Zzz Unrelated', '--req', rq]);
    if (cc[0]?.num === 1 && cc[0].reason === 'req') pass(`--req ${rq} matches the same requisition as JR9727`);
    else fail(`${rq}: ${JSON.stringify(cc)}`);
  }
  cc = q(['--company', 'Acme Supply Canada', '--title', 'HR Generalist']);
  if (cc.length === 1 && cc[0].num === 1 && cc[0].reason === 'same-title') pass('title without the location suffix matches the suffixed row');
  else fail(`suffix one side: ${JSON.stringify(cc)}`);
  cc = q(['--company', 'Acme Supply Canada', '--title', 'HR Generalist (Brampton, ON)', '--req', 'JR9727']);
  if (cc[0]?.num === 1 && cc[0].reason === 'req') pass('suffixed title plus req still matches #1');
  else fail(`suffix + req: ${JSON.stringify(cc)}`);
  cc = q(['--company', 'Northwind Foods', '--title', 'Operations Analyst II', '--req', 'JR-4411']);
  if (cc[0]?.num === 2 && cc[0].reason === 'req') pass('hyphenated JR-4411 still matches');
  else fail(`JR-4411: ${JSON.stringify(cc)}`);
  cc = q(['--company', 'Globex Corp', '--title', 'HR Generalist', '--req', 'JR9727']);
  if (cc.length === 0) pass('same req at an unrelated company still does not match');
  else fail(`unrelated company req: ${JSON.stringify(cc)}`);
  cc = q(['--company', 'Acme Supply Canada', '--title', 'Warehouse Supervisor (Brampton, ON)']);
  if (cc.length === 0) pass('different titles at the same company do not match on a shared suffix');
  else fail(`suffix-only match: ${JSON.stringify(cc)}`);
  cc = q(['--company', 'Acme Supply Canada', '--title', 'Payroll Manager']);
  if (cc.length === 1 && cc[0].num === 3) pass('suffix stripping does not cross-match #1 and #3');
  else fail(`payroll: ${JSON.stringify(cc)}`);
  if (stripLocationSuffix('Analyst (II)') === 'Analyst (II)' && stripLocationSuffix('(Remote)') === '(Remote)' && stripLocationSuffix('Analyst (Remote)') === 'Analyst')
    pass('stripLocationSuffix keeps level markers and never empties a title');
  else fail('stripLocationSuffix edge cases');

  // 13b. Review follow-ups: REQ9727, specialisation qualifiers, parent-org keeps suffixes.
  const rr = findDuplicateCandidates([{ num: 9, date: '2026-10-01', company: 'Acme Supply Canada', role: 'Zzz', status: 'Applied', notes: 'REQ9727', url: '' }], { company: 'Acme Supply Canada', title: 'Other Role', req: 'REQ9727' });
  if (rr[0]?.reason === 'req') pass('--req REQ9727 matches a note written REQ9727'); else fail('REQ9727');
  const sw = findDuplicateCandidates([{ num: 10, date: '2026-10-01', company: 'Acme Supply Canada', role: 'Software Engineer (Backend)', status: 'Applied', notes: '', url: '' }], { company: 'Acme Supply Canada', title: 'Software Engineer (Frontend)' });
  if (!sw.some(x => x.reason === 'same-title')) pass('(Backend) vs (Frontend) are not the same title');
  else fail('specialisation merged');
  if (stripLocationSuffix('Engineer (Backend)') === 'Engineer (Backend)' && stripLocationSuffix('Analyst (Hybrid)') === 'Analyst' && stripLocationSuffix('Analyst (Toronto)') === 'Analyst' && stripLocationSuffix('Analyst (Austin, TX)') === 'Analyst')
    pass('only location/work-mode suffixes are stripped'); else fail('stripLocationSuffix location detection');
  const par = findDuplicateCandidates([{ num: 11, date: '2026-10-01', company: 'Fabrikam University (East)', role: 'Research Analyst (East)', status: 'Applied', notes: '', url: '' }], { company: 'Fabrikam University (West)', title: 'Research Analyst (West)' });
  if (par.length === 0) pass('parent-org tier keeps (East) vs (West) distinct (original titles)');
  else fail(`parent-org east/west: ${JSON.stringify(par)}`);

  // 13c. Every component of a parenthesised label must be recognised; bare region codes count.
  const keep = ['Engineer (Remote Backend)', 'Engineer (Hybrid, Platform Team)', 'Engineer (Remote, Backend)', 'Engineer (Backend, TX)', 'Engineer (Frontend, TX)', 'Engineer (Oakville, ON)'];
  const drop = ['Analyst (TX)', 'Analyst (Remote, ON)', 'Analyst (Remote/Hybrid)', 'Analyst (Austin, TX)', 'Analyst (Fully Remote)'];
  if (keep.every(k => stripLocationSuffix(k) === k) && drop.every(d => stripLocationSuffix(d) === 'Analyst')) pass('compound labels are stripped only when every component is recognised');
  else fail(`compound labels: ${[...keep, ...drop].map(x => stripLocationSuffix(x)).join(' | ')}`);

  // 12. A lookup with no usable key is rejected, not reported as "no duplicate".
  const rejects = (args) => {
    try { run(args); return false; } catch (e) { return e.status === 1; }
  };
  if (rejects(['--company', 'Fabrikam University', '--url', 'N/A'])) pass('an unusable --url is rejected');
  else fail('--url N/A should exit 1');
  if (rejects(['--company', 'Fabrikam University'])) pass('company alone is rejected');
  else fail('company alone should exit 1');
} catch (e) {
  fail(`precheck-duplicate test crashed: ${(e.stderr || e.message || '').toString().slice(0, 400)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
