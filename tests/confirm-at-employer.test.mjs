// tests/confirm-at-employer.test.mjs — confirm-at-employer.mjs (#6166).
//
// One case per step of the confirmation, from a URL that already is the
// employer's to a title matched on the company's board. No network: the board
// lister, the liveness check and the probe candidates are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  confirmAtEmployer, titleSimilarity, titleContains, boardOfPosting, knownBoards, companySlugs, VERDICTS,
} from '../confirm-at-employer.mjs';

const AGG = 'https://www.linkedin.com/jobs/view/4000000001/';
const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\n';

// A fake ATS: boards by careers URL, every call recorded.
function fakeBoards(boards) {
  const calls = [];
  const listBoard = async (url) => { calls.push(url); return boards[url] ?? null; };
  return { listBoard, calls };
}
const noLiveness = async () => { throw new Error('liveness must not be called'); };

test('step 1: a URL that is not an aggregator is the employer posting, liveness via the ATS API', async () => {
  const url = 'https://job-boards.greenhouse.io/acme/jobs/123';
  const r = await confirmAtEmployer({ url, company: 'Acme', title: 'Product Manager' }, {
    checkLiveness: async () => ({ result: 'active' }),
    listBoard: async () => assert.fail('no board listing for an employer URL'),
  });
  assert.equal(r.verdict, 'employer_url');
  assert.equal(r.employerUrl, url);
  assert.equal(r.board, 'https://job-boards.greenhouse.io/acme');
  assert.equal(r.live, 'open');
});

test('step 1: an expired ATS answer reads as closed', async () => {
  const r = await confirmAtEmployer({ url: 'https://jobs.ashbyhq.com/acme/abc', company: 'Acme', title: 'PM' }, {
    checkLiveness: async () => ({ result: 'expired', reason: 'not on board' }),
  });
  assert.equal(r.verdict, 'employer_url');
  assert.equal(r.live, 'closed');
});

test('step 2: an employer link given by the posting is used as the employer URL', async () => {
  const origin = 'https://jobs.lever.co/acme/1111-2222';
  const r = await confirmAtEmployer({ url: AGG, origin, company: 'Acme', title: 'PM' }, {
    checkLiveness: async () => ({ result: 'active' }),
    listBoard: async () => assert.fail('no board listing when the posting gives the employer link'),
  });
  assert.equal(r.verdict, 'found');
  assert.equal(r.employerUrl, origin);
  assert.equal(r.board, 'https://jobs.lever.co/acme');
});

test('step 3: no employer name → unidentified, nothing is probed', async () => {
  for (const company of ['', '?', 'Confidential']) {
    const r = await confirmAtEmployer({ url: AGG, company, title: 'PM' }, { checkLiveness: noLiveness, listBoard: async () => assert.fail('probed') });
    assert.equal(r.verdict, 'unidentified', company);
  }
});

test('step 4a: a board from portals.yml is read first, and a matching title is found', async () => {
  const portalsText = 'tracked_companies:\n  - name: Acme GmbH\n    careers_url: https://jobs.ashbyhq.com/acme\n';
  const { listBoard, calls } = fakeBoards({ 'https://jobs.ashbyhq.com/acme': [
    { title: 'Senior Product Manager (f/m/d)', url: 'https://jobs.ashbyhq.com/acme/9' },
    { title: 'Data Engineer', url: 'https://jobs.ashbyhq.com/acme/8' },
  ] });
  const r = await confirmAtEmployer({ url: AGG, company: 'Acme', title: 'Sr. Product Manager (m/w/d)' }, {
    portalsText, listBoard, checkLiveness: noLiveness, candidates: () => assert.fail('no probing when a board is known'),
  });
  assert.equal(r.verdict, 'found');
  assert.equal(r.employerUrl, 'https://jobs.ashbyhq.com/acme/9');
  assert.equal(r.live, 'open');
  assert.deepEqual(calls, ['https://jobs.ashbyhq.com/acme']);
});

test('step 4b: an ATS link of the same company in scan history gives the board', () => {
  const historyText = HEADER
    + 'https://jobs.ashbyhq.com/acme/1\t2026-10-01\tashby\tPM\tAcme GmbH\tadded\t\t\t\t\t\tacme\n'
    + `${AGG}\t2026-10-02\tlinkedin\tPM\tAcme\tadded\t\t\t\t\t\tacme\n`
    + 'https://jobs.lever.co/other/1\t2026-10-02\tlever\tPM\tOther\tadded\t\t\t\t\t\tother\n';
  assert.deepEqual(knownBoards('Acme', { historyText }), ['https://jobs.ashbyhq.com/acme']);
});

test('step 4c: with no known board, slugs are probed and the first board with jobs is used', async () => {
  const { listBoard, calls } = fakeBoards({ 'https://acme-labs.jobs.personio.de': [{ title: 'Product Owner', url: 'https://acme-labs.jobs.personio.de/job/7' }] });
  const r = await confirmAtEmployer({ url: AGG, company: 'Acme Labs GmbH', title: 'Product Owner (m/w/d)' }, {
    listBoard, checkLiveness: noLiveness,
    candidates: () => ['https://job-boards.greenhouse.io/acme-labs', 'https://acme-labs.jobs.personio.de', 'https://jobs.lever.co/acme-labs'],
  });
  assert.equal(r.verdict, 'found');
  assert.equal(r.board, 'https://acme-labs.jobs.personio.de');
  assert.deepEqual(calls, ['https://job-boards.greenhouse.io/acme-labs', 'https://acme-labs.jobs.personio.de'], 'stops at the first board with jobs and does not list it twice');
});

test('step 4d: no board anywhere → no_board', async () => {
  const r = await confirmAtEmployer({ url: AGG, company: 'Acme', title: 'PM' }, {
    listBoard: async () => null, checkLiveness: noLiveness, candidates: () => ['https://jobs.ashbyhq.com/acme'],
  });
  assert.equal(r.verdict, 'no_board');
});

test('step 5: one board title that contains ours is likely the same role', async () => {
  const portalsText = 'tracked_companies:\n  - name: Acme\n    careers_url: https://jobs.ashbyhq.com/acme\n';
  const { listBoard } = fakeBoards({ 'https://jobs.ashbyhq.com/acme': [
    { title: 'Senior Product Manager, Payments Platform', url: 'https://jobs.ashbyhq.com/acme/5' },
    { title: 'Office Manager', url: 'https://jobs.ashbyhq.com/acme/6' },
  ] });
  const r = await confirmAtEmployer({ url: AGG, company: 'Acme', title: 'Senior Product Manager' }, { portalsText, listBoard, checkLiveness: noLiveness });
  assert.equal(r.verdict, 'likely');
  assert.equal(r.employerUrl, 'https://jobs.ashbyhq.com/acme/5');
});

test('step 5: the board lists other roles → board_without_role with the nearest three', async () => {
  const portalsText = 'tracked_companies:\n  - name: Acme\n    careers_url: https://jobs.ashbyhq.com/acme\n';
  const jobs = ['Product Designer', 'Product Marketing Manager', 'Backend Engineer', 'Recruiter']
    .map((t, i) => ({ title: t, url: `https://jobs.ashbyhq.com/acme/${i}` }));
  const { listBoard } = fakeBoards({ 'https://jobs.ashbyhq.com/acme': jobs });
  const r = await confirmAtEmployer({ url: AGG, company: 'Acme', title: 'Product Manager Identity' }, { portalsText, listBoard, checkLiveness: noLiveness });
  assert.equal(r.verdict, 'board_without_role');
  assert.equal(r.near.length, 3);
  assert.equal(r.near[0].title, 'Product Marketing Manager');
  assert.equal(r.employerUrl, '');
});

test('step 5: a two-word title is not matched to a longer one, and several near titles are not a match', async () => {
  const portalsText = 'tracked_companies:\n  - name: Acme\n    careers_url: https://jobs.ashbyhq.com/acme\n';
  const { listBoard } = fakeBoards({ 'https://jobs.ashbyhq.com/acme': [
    { title: 'Product Manager - Realtime', url: 'https://jobs.ashbyhq.com/acme/1' },
    { title: 'Senior Product Manager Payments', url: 'https://jobs.ashbyhq.com/acme/2' },
    { title: 'Senior Product Manager Payments', url: 'https://jobs.ashbyhq.com/acme/3' },
    { title: 'Senior Product Manager Identity', url: 'https://jobs.ashbyhq.com/acme/4' },
  ] });
  const two = await confirmAtEmployer({ url: AGG, company: 'Acme', title: 'Product Manager' }, { portalsText, listBoard, checkLiveness: noLiveness });
  assert.equal(two.verdict, 'board_without_role');
  const many = await confirmAtEmployer({ url: AGG, company: 'Acme', title: 'Senior Product Manager Platform' }, { portalsText, listBoard, checkLiveness: noLiveness });
  assert.equal(many.verdict, 'board_without_role', 'two different near titles: the agent decides');
  assert.deepEqual(many.near.map((n) => n.title), ['Senior Product Manager Payments', 'Senior Product Manager Identity', 'Product Manager - Realtime'], 'nearest titles listed once each');
});

test('every verdict the function returns is a declared one', () => {
  assert.deepEqual([...VERDICTS].sort(), ['board_without_role', 'employer_url', 'found', 'likely', 'no_board', 'unidentified']);
});

test('title matching ignores gender tags and Sr./Senior, and needs three words to contain', () => {
  assert.equal(titleSimilarity('Sr. Product Manager (m/w/x)', 'Senior Product Manager (f/m/d)'), 1);
  assert.ok(titleSimilarity('Product Owner Traffic Domain (m/f/d)', 'SEO Marketing Manager') < 0.3);
  assert.ok(titleContains('Sr. Product Manager (m/w/x), Circular Supply Chain', 'Sr. Product Manager (m/w/x)'));
  assert.ok(!titleContains('Product Manager (Post-Sales)', 'Product Manager'), 'two words are too generic');
});

test('boardOfPosting maps posting links to the board the providers read', () => {
  assert.equal(boardOfPosting('https://boards.greenhouse.io/grover/jobs/8042949003'), 'https://job-boards.greenhouse.io/grover');
  assert.equal(boardOfPosting('https://job-boards.eu.greenhouse.io/acme/jobs/123'), 'https://job-boards.eu.greenhouse.io/acme');
  assert.equal(boardOfPosting('https://jobs.ashbyhq.com/prior-labs/9d27aa'), 'https://jobs.ashbyhq.com/prior-labs');
  assert.equal(boardOfPosting('https://jobs.lever.co/acme/abc-123'), 'https://jobs.lever.co/acme');
  assert.equal(boardOfPosting('https://jobs.smartrecruiters.com/SWARCO/744000132780759-x'), 'https://careers.smartrecruiters.com/SWARCO');
  assert.equal(boardOfPosting('https://acme.jobs.personio.de/job/1140517?language=de'), 'https://acme.jobs.personio.de');
  assert.equal(boardOfPosting('https://acme.recruitee.com/o/pm'), 'https://acme.recruitee.com');
  assert.equal(boardOfPosting(AGG), '');
});

test('companySlugs drops legal suffixes and gives hyphenated and joined forms', () => {
  assert.deepEqual(companySlugs('Acme Labs GmbH'), ['acme-labs', 'acmelabs']);
  assert.deepEqual(companySlugs('Foo (m/w/d) AG'), ['foo']);
});

test('CLI: bad input exits 2 without touching the network', () => {
  const script = fileURLToPath(new URL('../confirm-at-employer.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'confirm-employer-'));
  const bad = join(dir, 'p.json');
  writeFileSync(bad, JSON.stringify({ url: 'not a url', company: 'Acme', title: 'PM' }));
  const r = spawnSync(process.execPath, [script, '--input', bad], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  const none = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(none.status, 2);
});
