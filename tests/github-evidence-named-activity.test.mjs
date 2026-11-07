// tests/github-evidence-named-activity.test.mjs — new activity on repos that
// cv.md or article-digest.md already name, since the previous scan or --since
// (#5677).
// Every gh call goes through an injected runner: nothing here spawns gh or
// reaches the network.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import {
  buildEvidence, withNamedActivity, namedWithNewActivity, findPreviousScan, sinceFromFlag,
  startOfLocalDay, renderMarkdown, runCli,
} from '../github-evidence.mjs';

console.log('\ngithub-evidence.mjs — new activity on repos cv.md or article-digest.md already names');

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const USER = 'jane-doe';
const SCANNED = '2026-10-15T08:00:00.000Z';
const SINCE = { status: 'ok', source: 'previous-scan', date: '2026-10-15', at: SCANNED, file: 'output/github-evidence-2026-10-15.json', detail: null };

let seq = 0;
function pr(repo, title, mergedAt, { author = USER } = {}) {
  seq += 1;
  return {
    author: { login: author }, repository: { name: repo.split('/')[1], nameWithOwner: repo },
    title, number: seq, url: `https://github.com/${repo}/pull/${seq}`, closedAt: mergedAt, createdAt: '2026-09-01T00:00:00Z',
  };
}
/** A commit search item in the REST shape. */
function commit(repo, sha, { author = USER, authored, committed = authored, priv = false } = {}) {
  return {
    sha, author: { login: author },
    commit: { author: { date: authored }, committer: { date: committed }, message: 'COMMIT-MESSAGE-NEVER-KEPT' },
    repository: { full_name: repo, private: priv, fork: false },
  };
}
/** The same commit, as collectCommits() keeps it. */
const row = (item) => ({
  repo: item.repository.full_name, sha: item.sha, login: item.author.login, date: item.commit.author.date.slice(0, 10),
  committedAt: item.commit.committer.date, private: item.repository.private, fork: false,
});

function fixture() {
  seq = 0;
  const merged = [
    pr('acme/widgets', 'Old loader fix', '2026-10-01T10:00:00Z'),
    pr('acme/widgets', 'Merged a second before the scan', '2026-10-15T07:59:59Z'),
    pr('acme/widgets', 'Agent harness', '2026-10-15T08:00:00Z'),
    pr('acme/widgets', 'Evaluation harness', '2026-10-20T12:00:00Z'),
    pr('acme/widgets', 'NOT-THE-USERS-PR', '2026-10-21T12:00:00Z', { author: 'someone-else' }),
    pr('quietco/lib', 'Quiet old change', '2026-09-20T00:00:00Z'),
    pr('digestco/engine', 'Engine planner', '2026-10-18T00:00:00Z'),
    pr('secretco/payroll', 'SECRET-NEW-TITLE', '2026-10-19T00:00:00Z'),
    pr('ClientCo/App', 'Payments', '2026-10-19T00:00:00Z'),
    pr('forker/widgets-fork', 'FORK-NEW-TITLE', '2026-10-19T00:00:00Z'),
    pr('jane-doe/tool', 'OWN-REPO-NEW-TITLE', '2026-10-19T00:00:00Z'),
    pr('unnamed/thing', 'Unnamed new work', '2026-10-19T00:00:00Z'),
  ];
  const commits = [
    commit('acme/widgets', 'a1', { authored: '2026-10-10T00:00:00Z' }),
    // Authored before the scan, applied after it (a rebase merge): new.
    commit('acme/widgets', 'a2', { authored: '2026-10-01T00:00:00Z', committed: '2026-10-18T03:04:05Z' }),
    commit('acme/widgets', 'a3', { authored: '2026-10-19T00:00:00Z' }),
    commit('acme/widgets', 'a3', { authored: '2026-10-19T00:00:00Z' }),
    commit('acme/widgets', 'a4', { author: 'someone-else', authored: '2026-10-19T00:00:00Z' }),
    commit('quietco/lib', 'q1', { authored: '2026-09-20T00:00:00Z' }),
    commit('secretco/payroll', 's1', { authored: '2026-10-19T00:00:00Z', priv: true }),
  ];
  const repoMeta = new Map([
    ['acme/widgets', { private: false, fork: false, stars: 1200 }],
    ['quietco/lib', { private: false, fork: false, stars: 40 }],
    ['digestco/engine', { private: false, fork: false, stars: 300 }],
    ['secretco/payroll', { private: true, fork: false, stars: 0 }],
    ['clientco/app', { private: true, fork: false, stars: 0 }],
    ['forker/widgets-fork', { private: false, fork: true, stars: 0 }],
    ['jane-doe/tool', { private: false, fork: false, stars: 5 }],
    ['unnamed/thing', { private: false, fork: false, stars: 9 }],
  ]);
  return { merged, commits, repoMeta };
}

const CV = [
  '# CV', '', '## Projects',
  '- Contributor to acme/widgets.', '- Fixes to quietco/lib.', '- Payroll work at secretco/payroll.',
  '- Client work on clientco/app.', '- Maintains forker/widgets-fork and jane-doe/tool.', '',
].join('\n');
const DIGEST = [
  '# Article Digest -- Proof Points', '', '---', '',
  '## Engine — Query engine', '', '**Proof points:**', '- Planner work merged into digestco/engine.', '', '---', '',
  '## Widgets — Loader', '', '- 727 of 734 commits to acme/widgets.', '',
].join('\n');
const ALLOW = new Set(['clientco/app']);

function evidence({ since = SINCE, commitSearch = { status: 'ok', total: 7, read: 7, detail: null }, cvText = CV, digestText = DIGEST, f = fixture() } = {}) {
  const commitItems = f.commits.map(row);
  const base = buildEvidence({
    user: USER, merged: f.merged, open: [], closed: f.merged, repoMeta: f.repoMeta, allowlist: ALLOW,
    cvText, commitSearch, commitItems, generatedAt: '2026-10-22',
  });
  return withNamedActivity(base, { scannedAt: '2026-10-22T09:00:00.000Z', since, merged: f.merged, commitItems, commitSearch, cvText, digestText });
}

// ── 1. A repo named with new activity ───────────────────────────────

{
  const result = evidence();
  const list = result.claimCheck.namedWithNewActivity;
  const widgets = list.find((r) => r.repo === 'acme/widgets');
  check(result.since === SINCE && result.scannedAt === '2026-10-22T09:00:00.000Z', 'the report carries scannedAt and the baseline it used');
  check(widgets?.newMerged === 2, `named repo: PRs merged at or after the baseline count, earlier ones and other authors' do not (got ${widgets?.newMerged})`);
  check(JSON.stringify(widgets?.recentNewMerged.map((t) => t.title)) === JSON.stringify(['Evaluation harness', 'Agent harness']),
    `named repo: titles are the new merged PRs only, newest first (got ${JSON.stringify(widgets?.recentNewMerged.map((t) => t.title))})`);
  check(widgets?.newCommits?.count === 2 && widgets.newCommits.lowerBound === false,
    `named repo: commits applied after the baseline count once each, a rebased one included (got ${JSON.stringify(widgets?.newCommits)})`);
  check(widgets?.matchedOn === 'repo' && JSON.stringify(widgets.digestEntries) === JSON.stringify([{ name: 'Widgets', matchedOn: 'repo' }]),
    'named repo: says where it is named, in cv.md and by article-digest entry');
  check(widgets && !Object.values(widgets).includes(4) && !('newActivity' in widgets),
    'no summing: new merged PRs (2) and new commits (2) stay separate figures, never a 4');

  const engine = list.find((r) => r.repo === 'digestco/engine');
  check(engine?.matchedOn === null && engine.digestEntries[0]?.name === 'Engine' && engine.newMerged === 1,
    'a repo named only in article-digest.md is listed too, with the entry that names it');

  const json = JSON.stringify(result);
  check(!json.includes('NOT-THE-USERS-PR'), 'a PR by someone else in a named repo never reaches the report');
  check(!json.includes('2026-10-18T03:04:05') && !json.includes('COMMIT-MESSAGE'), 'commit times and messages stay out of the report');

  const md = renderMarkdown(result);
  check(md.includes('## Named in cv.md or article-digest.md: new activity') && md.includes('Since 2026-10-15 (previous scan output/github-evidence-2026-10-15.json'),
    'Markdown: the section names the baseline');
  check(md.includes('| acme/widgets | public | 1.2K | repo | Widgets (repo) | 2 | 2 |') && md.includes('- acme/widgets: merged #4 (2026-10-20): Evaluation harness'),
    'Markdown: one table row per repo, then the new titles');
}

// ── 2. Named, nothing new; not named; and the evidence rules ────────

{
  const list = evidence().claimCheck.namedWithNewActivity;
  const repos = list.map((r) => r.repo);
  check(!repos.includes('quietco/lib'), 'a named repo with no new merged PR and no new commit is not listed');
  check(!repos.includes('unnamed/thing'), 'a repo neither file names is not listed (mergedNotNamed covers it)');
  check(repos.includes('ClientCo/App') && list.find((r) => r.repo === 'ClientCo/App').visibility === 'private',
    'an allowlisted private repo named in cv.md is listed');
  check(!repos.includes('forker/widgets-fork') && !repos.includes('jane-doe/tool'), 'forks and own repos are never listed');
  check(JSON.stringify(repos) === JSON.stringify(['acme/widgets', 'ClientCo/App', 'digestco/engine']),
    `sorted by new merged PRs, then new commits, then name (got ${repos})`);
}

// ── 3. A private repo that is not allowlisted ───────────────────────

{
  const result = evidence();
  const json = JSON.stringify(result);
  const md = renderMarkdown(result);
  check(!result.claimCheck.namedWithNewActivity.some((r) => r.repo === 'secretco/payroll'),
    'private, not allowlisted, named in cv.md, new PR: not listed');
  check(!json.includes('SECRET-NEW-TITLE') && !md.includes('SECRET-NEW-TITLE'), 'and its new title appears nowhere in the JSON or Markdown');
  check(result.privateNotAllowlisted.some((r) => r.repo === 'secretco/payroll' && !('recentMerged' in r)),
    'it stays in privateNotAllowlisted by name and count only');
  check(!json.includes('FORK-NEW-TITLE') && !json.includes('OWN-REPO-NEW-TITLE'), 'fork and own-repo titles appear nowhere either');
}

// ── 4. No baseline, and the commit search's limits ──────────────────

{
  const none = { status: 'none', source: null, date: null, at: null, file: null, detail: 'no earlier output/github-evidence-*.json and no --since' };
  const result = evidence({ since: none });
  check(result.claimCheck.namedWithNewActivity.length === 0 && result.since.status === 'none', 'no previous scan and no --since: the list is skipped');
  check(renderMarkdown(result).includes('Skipped: no earlier output/github-evidence-*.json and no --since. Rerun with `--since YYYY-MM-DD`'),
    'and the Markdown says so');

  const cut = evidence({ commitSearch: { status: 'partial', total: 5000, read: 1000, detail: 'cap' }, f: (() => {
    const f = fixture();
    f.commits = f.commits.filter((c) => c.commit.author.date >= '2026-10-15');
    return f;
  })() });
  const w = cut.claimCheck.namedWithNewActivity.find((r) => r.repo === 'acme/widgets');
  check(w?.newCommits?.lowerBound === true && w.newCommits.count === 1,
    `a search cut short gives a lower bound (got ${JSON.stringify(w?.newCommits)})`);
  check(renderMarkdown(cut).includes('| acme/widgets | public | 1.2K | repo | Widgets (repo) | 2 | ≥1 |'), 'the Markdown marks it ≥');

  // Ordered by author date, judged by committer time: a rebased commit with an
  // old author date can sit past the cut, so reading older commits proves nothing.
  const reached = evidence({ commitSearch: { status: 'partial', total: 5000, read: 1000, detail: 'cap' } });
  check(reached.claimCheck.namedWithNewActivity.find((r) => r.repo === 'acme/widgets')?.newCommits.lowerBound === true,
    'a search cut short is a lower bound even after it read commits older than the baseline');

  const failed = evidence({ commitSearch: { status: 'failed', total: null, read: 0, detail: 'page 1 failed' } });
  const fw = failed.claimCheck.namedWithNewActivity.find((r) => r.repo === 'acme/widgets');
  check(fw?.newCommits === null && fw.newMerged === 2, 'a failed commit search: new commits unknown (null), new merged PRs unaffected');

  check(evidence({ cvText: null, digestText: null }).claimCheck.namedWithNewActivity.length === 0, 'neither cv.md nor article-digest.md: nothing is named');
}

// ── 5. --since and the previous-scan lookup ─────────────────────────

{
  check(sinceFromFlag('2026-10-19', '2026-10-22')?.at === startOfLocalDay('2026-10-19'), '--since: the baseline is local midnight of that day');
  check(sinceFromFlag('2026-02-30', '2026-10-22') === null && sinceFromFlag('yesterday', '2026-10-22') === null && sinceFromFlag(undefined, '2026-10-22') === null,
    '--since: not a real YYYY-MM-DD date -> rejected');
  check(sinceFromFlag('2026-10-23', '2026-10-22') === null && sinceFromFlag('2026-10-22', '2026-10-22') !== null, '--since: after today -> rejected; today is fine');
  const late = evidence({ since: sinceFromFlag('2026-10-19', '2026-10-22') });
  check(late.claimCheck.namedWithNewActivity.find((r) => r.repo === 'acme/widgets')?.newMerged === 1, '--since: counts from that day');

  const dir = mkdtempSync(join(tmpdir(), 'co-gh-since-'));
  try {
    check(findPreviousScan(join(dir, 'missing'), '2026-10-22').status === 'none', 'no output/ directory: no previous scan');
    const report = (extra) => JSON.stringify({ status: 'ok', generatedAt: 'x', ...extra });
    writeFileSync(join(dir, 'github-evidence-2026-10-01.json'), report({ scannedAt: '2026-10-01T06:00:00.000Z' }));
    writeFileSync(join(dir, 'github-evidence-2026-10-15.json'), report({}));
    writeFileSync(join(dir, 'github-evidence-2026-10-20.json'), '{ not json');
    writeFileSync(join(dir, 'github-evidence-2026-10-22.json'), report({ scannedAt: '2026-10-22T01:00:00.000Z' }));
    writeFileSync(join(dir, 'github-evidence-2026-10-21.md'), '# not the JSON');
    const found = findPreviousScan(dir, '2026-10-22');
    check(found.status === 'ok' && found.file === 'output/github-evidence-2026-10-15.json',
      `previous scan: newest readable report dated before today; today's own file is skipped (got ${found.file})`);
    check(found.at === startOfLocalDay('2026-10-15') && /no scannedAt/.test(found.detail) && /skipped unreadable output\/github-evidence-2026-10-20\.json/.test(found.detail),
      'a report without scannedAt gives the start of its day, and an unreadable newer one is skipped and named');
    const exact = findPreviousScan(dir, '2026-10-15');
    check(exact.at === '2026-10-01T06:00:00.000Z' && exact.detail === null, 'a report with scannedAt is the exact baseline');
    check(findPreviousScan(dir, '2026-10-01').status === 'none', 'nothing dated before today: no previous scan');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  check(namedWithNewActivity({ result: evidence(), since: null }).length === 0, 'namedWithNewActivity without a baseline returns nothing');
}

// ── 6. CLI: the previous scan, --since, and the written report ──────

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '', notFound: false });
function fakeGh(f = fixture()) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === '--version') return ok('gh version 2.60.0');
    if (args[0] === 'api' && args[1] === 'user') return ok(`${USER}\n`);
    if (args[0] === 'search') return ok(JSON.stringify(args.includes('open') ? [] : f.merged));
    const target = String(args[1] === '-i' ? args[2] : args[1]);
    if (target.startsWith('search/commits?')) return ok(JSON.stringify({ total_count: f.commits.length, incomplete_results: false, items: f.commits }));
    if (/^repos\/[^/]+\/[^/?]+\/commits\?/.test(target)) {
      const body = JSON.stringify([{ commit: { author: { date: '2026-10-19T00:00:00Z' } } }]);
      return ok(args[1] === '-i' ? `HTTP/2.0 200 OK\n\n${body}` : body);
    }
    const repo = /^repos\/([^/]+\/[^/]+)$/.exec(target)?.[1]?.toLowerCase();
    if (repo && f.repoMeta.has(repo)) return ok(JSON.stringify(f.repoMeta.get(repo)));
    return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)', notFound: false };
  };
  return { runner, calls };
}

function sandbox({ previous = { 'github-evidence-2026-10-15.json': { status: 'ok', generatedAt: '2026-10-15', scannedAt: SCANNED } } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'co-gh-named-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  github: "github.com/jane-doe"\ngithub_evidence:\n  private_allowlist:\n    - "clientco/app"\n');
  writeFileSync(join(root, 'cv.md'), CV);
  writeFileSync(join(root, 'article-digest.md'), DIGEST);
  mkdirSync(join(root, 'output'));
  for (const [name, body] of Object.entries(previous)) writeFileSync(join(root, 'output', name), JSON.stringify(body));
  return root;
}

function cli(root, args = ['--json'], runGh = fakeGh().runner) {
  let out = '';
  let err = '';
  const code = runCli({
    args, dataRoot: root, runGh, profilePath: join(root, 'config', 'profile.yml'), today: '2026-10-22',
    stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, pause: () => {}, now: () => new Date('2026-10-22T09:00:00Z'),
  });
  return { code, out, err };
}

{
  const root = sandbox();
  const digestBefore = readFileSync(join(root, 'article-digest.md'), 'utf8');
  try {
    const res = cli(root);
    check(res.code === 0, res.code === 0 ? 'CLI with a previous scan -> exit 0' : `CLI with a previous scan -> exit 0 (got ${res.code}: ${res.err.trim()})`);
    const written = JSON.parse(readFileSync(join(root, 'output', 'github-evidence-2026-10-22.json'), 'utf8'));
    check(written.scannedAt === '2026-10-22T09:00:00.000Z' && written.since.source === 'previous-scan' && written.since.at === SCANNED,
      'CLI: the written report has scannedAt and uses the previous scan as its baseline');
    const w = written.claimCheck.namedWithNewActivity.find((r) => r.repo === 'acme/widgets');
    check(w?.newMerged === 2 && w.newCommits?.count === 2, `CLI: commit times come through the commit search (got ${JSON.stringify(w && { m: w.newMerged, c: w.newCommits })})`);
    check(readFileSync(join(root, 'output', 'github-evidence-2026-10-22.md'), 'utf8').includes('## Named in cv.md or article-digest.md: new activity'),
      'CLI: the Markdown report has the section');
    check(readFileSync(join(root, 'article-digest.md'), 'utf8') === digestBefore, 'CLI: article-digest.md is never modified');

    const since = cli(root, ['--json', '--since', '2026-10-19']);
    const printed = JSON.parse(since.out);
    check(since.code === 0 && printed.since.source === 'flag' && printed.claimCheck.namedWithNewActivity.find((r) => r.repo === 'acme/widgets')?.newMerged === 1,
      '--since overrides the previous scan');
    const eq = cli(root, ['--since=2026-10-19']);
    check(eq.code === 0, '--since=YYYY-MM-DD works too');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox({ previous: {} });
  try {
    const res = cli(root);
    const printed = JSON.parse(res.out);
    check(res.code === 0 && printed.since.status === 'none' && printed.claimCheck.namedWithNewActivity.length === 0,
      'CLI without a previous scan: exit 0, the list is skipped');
    check(/no earlier output\/github-evidence-\*\.json and no --since: skipping new activity/.test(res.err), 'CLI without a previous scan: stderr says so');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox();
  try {
    for (const bad of [['--since', '2026-13-01'], ['--since', '2026-10-23'], ['--since']]) {
      const { runner, calls } = fakeGh();
      const res = cli(root, bad, runner);
      check(res.code === 1 && calls.length === 0 && /--since takes a date/.test(res.err), `${bad.join(' ')} -> exit 1 before any gh call`);
    }
    check(!existsSync(join(root, 'output', 'github-evidence-2026-10-22.json')), 'a rejected --since writes nothing');
  } finally { rmSync(root, { recursive: true, force: true }); }
  const missing = spawnSync(NODE, [join(ROOT, 'github-evidence.mjs'), '--since'], { encoding: 'utf8', timeout: 30000 });
  check(missing.status === 1 && /--since/.test(missing.stderr), '--since with no value fails fast at the command line');
}
