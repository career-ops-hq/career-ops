// tests/github-evidence.test.mjs — the optional GitHub evidence step of
// `expand` (#5295). Every gh call goes through an injected runner fed from
// fixtures: nothing here spawns gh or reaches the network.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import {
  collectCommits, searchAuthoredCommits, countAuthoredCommits, COMMIT_PAGE_PAUSE_MS,
  normalizeGithubUser, readPrivateAllowlist, cleanTitle, cvMention, buildEvidence,
  checkGh, collect, renderMarkdown, runCli, SEARCH_LIMIT, EXIT_GH_UNAVAILABLE, EXIT_GH_QUERY_FAILED,
} from '../github-evidence.mjs';

console.log('\ngithub-evidence.mjs — authored-PR and commit evidence + cv.md claim check');

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const USER = 'jane-doe';

let seq = 0;
function pr(repo, title, { author = USER, closedAt = '2026-03-01T00:00:00Z', createdAt = '2026-02-01T00:00:00Z' } = {}) {
  seq += 1;
  return {
    author: author === null ? undefined : { login: author },
    repository: { name: repo.split('/')[1], nameWithOwner: repo },
    title, number: seq, url: `https://github.com/${repo}/pull/${seq}`, closedAt, createdAt,
  };
}

// ── 1. Username and allowlist parsing ───────────────────────────────

const userCases = [
  ['janesmith', 'janesmith'],
  ['@janesmith', 'janesmith'],
  ['github.com/janesmith', 'janesmith'],
  ['https://www.github.com/Jane-Smith/', 'Jane-Smith'],
  ['https://github.com/janesmith/', 'janesmith'],
  ['www.github.com/JaneSmith', 'JaneSmith'],
  ['  HTTP://GitHub.com/janesmith//  ', 'janesmith'],
  ['a'.repeat(39), 'a'.repeat(39)],
  // Input step 4 of modes/expand.md: a repo link is rejected, not cut to its owner.
  ['https://github.com/janesmith/some-repo', null],
  ['github.com/janesmith/tool', null],
  ['github.com/janesmith?tab=repositories', null],
  ['', null],
  [undefined, null],
  ['-leading-hyphen', null],
  ['github.com/-janesmith', null],
  ['a'.repeat(40), null],
  ['https://gitlab.com/janesmith', null],
];
for (const [raw, want] of userCases) {
  const got = normalizeGithubUser(raw);
  check(got === want, `normalizeGithubUser(${JSON.stringify(raw)}) -> ${want} (got ${got})`);
}

{
  const { allowlist, invalid } = readPrivateAllowlist({ github_evidence: { private_allowlist: ['Acme-Corp/Billing', 'not a repo', 42, ' clientco/app '] } });
  check(allowlist.has('acme-corp/billing') && allowlist.has('clientco/app') && allowlist.size === 2, 'allowlist keeps owner/repo entries, lowercased and trimmed');
  check(invalid.length === 2, 'allowlist reports entries that are not owner/repo');
  check(readPrivateAllowlist({}).allowlist.size === 0, 'no github_evidence block -> empty allowlist (default)');
  const scalar = readPrivateAllowlist({ github_evidence: { private_allowlist: 'acme/x' } });
  check(scalar.allowlist.size === 0 && scalar.invalid.length === 1, 'a non-list allowlist narrows to empty and is reported');
}

check(cleanTitle('Fix\nthe | parser\u0007  now') === 'Fix the | parser now', 'cleanTitle folds newlines and control characters to one line');
check(cleanTitle('x'.repeat(500)).length === 200, 'cleanTitle caps length');

// ── 2. cv.md mention matching ───────────────────────────────────────

{
  const cv = 'contributed to acme/widgets and the framework project at bigco. built a toolkit. worked at globex.';
  check(cvMention(cv, 'acme/widgets') === 'repo', 'cvMention: owner/repo match');
  check(cvMention(cv, 'other/framework') === 'name', 'cvMention: repo-name match');
  check(cvMention(cv, 'globex/internal-thing') === 'owner', 'cvMention: owner-only match is reported as such');
  check(cvMention(cv, 'someone/kit') === null, 'cvMention: "kit" does not match inside "toolkit"');
  check(cvMention('i write go every day', 'golang/go') === null, 'cvMention: names under 3 characters need the full owner/repo');
}

// ── 3. Aggregation, authorship, forks, own repos, privacy ───────────

function fixture() {
  seq = 0;
  const merged = [
    pr('acme/widgets', 'Add retry to widget loader'),
    pr('acme/widgets', 'Fix widget cache key'),
    pr('bigco/framework', 'Speed up router', { closedAt: '2026-04-01T00:00:00Z' }),
    pr('starco/engine', 'Document engine flags'),
    pr('jane-doe/tool', 'Self-merged change in own repo'),
    pr('forker/widgets-fork', 'Change in a fork'),
    pr('secretco/payroll', 'SECRET-TITLE-NOT-ALLOWLISTED'),
    pr('ClientCo/App', 'Allowlisted private work'),
    pr('ghostco/deleted', 'UNKNOWN-VISIBILITY-TITLE'),
    pr('acme/widgets', 'Authored by someone else', { author: 'someone-else' }),
    pr('acme/widgets', 'No author field', { author: null }),
  ];
  const open = [
    pr('acme/widgets', 'Open widget PR', { closedAt: '0001-01-01T00:00:00Z', createdAt: '2026-05-01T00:00:00Z' }),
    pr('namedco/library', 'Open library PR', { closedAt: '0001-01-01T00:00:00Z' }),
  ];
  const closedUnmerged = [pr('namedco/library', 'Closed library PR')];
  const closed = [...merged, ...closedUnmerged]; // --state closed includes merged PRs
  const repoMeta = new Map([
    ['acme/widgets', { private: false, fork: false, stars: 1200 }],
    ['bigco/framework', { private: false, fork: false, stars: 48000 }],
    ['starco/engine', { private: false, fork: false, stars: 300 }],
    ['jane-doe/tool', { private: false, fork: false, stars: 5 }],
    ['forker/widgets-fork', { private: false, fork: true, stars: 0 }],
    ['secretco/payroll', { private: true, fork: false, stars: 0 }],
    ['clientco/app', { private: true, fork: false, stars: 0 }],
    ['ghostco/deleted', null],
    ['namedco/library', { private: false, fork: false, stars: 900 }],
  ]);
  return { merged, open, closed, repoMeta };
}

const CV = '# CV\n\n## Projects\n- Contributor to acme/widgets.\n- Merged fixes into the NamedCo library.\n';

{
  const f = fixture();
  const result = buildEvidence({ user: USER, ...f, allowlist: new Set(['clientco/app']), cvText: CV, generatedAt: '2026-10-16' });
  const byRepo = (list, repo) => list.find((r) => r.repo === repo);

  // Totals count only authored PRs; closed-unmerged excludes merged ones.
  check(result.totals.merged === 9, `totals.merged counts authored PRs only (got ${result.totals.merged})`);
  check(result.totals.open === 2 && result.totals.closedUnmerged === 1, 'closed-unmerged = closed minus merged');

  const widgets = byRepo(result.contributions, 'acme/widgets');
  check(widgets && widgets.counts.merged === 2 && widgets.counts.open === 1 && widgets.counts.closedUnmerged === 0,
    'per-repo merged / open / closed counts aggregate correctly');
  check(widgets && !JSON.stringify(widgets).includes('Authored by someone else') && !JSON.stringify(widgets).includes('No author field'),
    'PRs authored by someone else, or with no author, are not evidence');
  check(widgets && widgets.recentMerged.length === 2 && widgets.recentOpen[0]?.date === '2026-05-01',
    'open PRs date from createdAt when gh reports closedAt as 0001-01-01');

  check(!byRepo(result.contributions, 'jane-doe/tool') && byRepo(result.excluded.ownRepos, 'jane-doe/tool')?.counts.merged === 1,
    'own repo is not evidence: listed under excluded.ownRepos by count only');
  check(!byRepo(result.contributions, 'forker/widgets-fork') && byRepo(result.excluded.forks, 'forker/widgets-fork'),
    'a fork is never evidence');

  const hidden = byRepo(result.privateNotAllowlisted, 'secretco/payroll');
  check(hidden && hidden.counts.merged === 1 && !('recentMerged' in hidden), 'non-allowlisted private repo: name and count only');
  check(byRepo(result.privateNotAllowlisted, 'ghostco/deleted')?.visibility === 'unknown', 'unreadable visibility fails closed (treated as private)');
  const md = renderMarkdown(result);
  const json = JSON.stringify(result);
  check(!json.includes('SECRET-TITLE-NOT-ALLOWLISTED') && !md.includes('SECRET-TITLE-NOT-ALLOWLISTED'),
    'non-allowlisted private titles appear nowhere in the JSON or Markdown');
  check(!json.includes('UNKNOWN-VISIBILITY-TITLE') && !md.includes('UNKNOWN-VISIBILITY-TITLE'),
    'titles from repos of unknown visibility appear nowhere');

  const allowlisted = byRepo(result.contributions, 'ClientCo/App');
  check(allowlisted?.visibility === 'private' && allowlisted.recentMerged[0]?.title === 'Allowlisted private work',
    'allowlisted private repo (case-insensitive) is evidence with titles');

  // Claim check: third-party, non-fork, visible repos only.
  const named = result.claimCheck.namedNoMerge.map((c) => c.repo);
  const unnamed = result.claimCheck.mergedNotNamed.map((c) => c.repo);
  check(result.claimCheck.cvFound === true, 'claim check runs when cv.md exists');
  check(named.length === 1 && named[0] === 'namedco/library', `namedNoMerge lists repos cv.md names with no merged PR (got ${named})`);
  check(result.claimCheck.namedNoMerge[0].open === 1 && result.claimCheck.namedNoMerge[0].closedUnmerged === 1,
    'namedNoMerge carries the open and closed-unmerged counts');
  check(JSON.stringify(unnamed) === JSON.stringify(['bigco/framework', 'starco/engine', 'ClientCo/App']),
    `mergedNotNamed: unnamed merged repos, most-starred first (got ${unnamed})`);
  check(!unnamed.includes('acme/widgets'), 'a repo cv.md names is not in mergedNotNamed');
  check(!unnamed.includes('jane-doe/tool') && !unnamed.includes('forker/widgets-fork') && !unnamed.includes('secretco/payroll'),
    'own repos, forks and non-allowlisted private repos stay out of the claim check');
  check(md.includes('Untrusted external content'), 'the Markdown report is labelled as untrusted external content');
}

{
  const result = buildEvidence({ user: USER, ...fixture(), cvText: null });
  check(result.claimCheck.cvFound === false && result.claimCheck.mergedNotNamed.length === 0,
    'no cv.md -> claim check skipped, not "everything is unnamed"');
  check(renderMarkdown(result).includes('cv.md not found'), 'and the report says so');
}

{
  seq = 0;
  const spoofed = pr('acme/widgets', 'Pipe | and\nnewline');
  const result = buildEvidence({
    user: USER, merged: [spoofed], open: [], closed: [spoofed],
    repoMeta: new Map([['acme/widgets', { private: false, fork: false, stars: 1 }]]),
  });
  const md = renderMarkdown(result);
  check(md.includes('Pipe | and newline') && !md.includes('and\nnewline'), 'a title cannot break out of its Markdown line');
}

{
  // An escaped pipe `\|`, a lone `\`, and a bare `|` in every value that lands in
  // a table cell. Rows are split the way GFM does: `\` escapes the next
  // character, any other `|` ends a cell.
  seq = 0;
  const HOSTILE = 'a\\|b\\c|d';
  const repos = {
    named: `${HOSTILE}-named/named-lib`,
    merged: `${HOSTILE}-merged/merged-lib`,
    secret: `${HOSTILE}-secret/secret-lib`,
    fork: `${HOSTILE}-fork/fork-lib`,
    own: `${USER}/${HOSTILE}`,
  };
  const openNamed = pr(repos.named, HOSTILE, { closedAt: '0001-01-01T00:00:00Z' });
  const merged = [repos.merged, repos.secret, repos.fork, repos.own].map((r) => pr(r, HOSTILE));
  const meta = (m) => ({ stars: 1, fork: false, private: false, ...m });
  const result = buildEvidence({
    user: USER, merged, open: [openNamed], closed: merged,
    repoMeta: new Map([
      [repos.named.toLowerCase(), meta({})],
      [repos.merged.toLowerCase(), meta({})],
      [repos.secret.toLowerCase(), meta({ private: true })],
      [repos.fork.toLowerCase(), meta({ fork: true })],
    ]),
    cvText: `Worked on ${repos.named}.`,
  });
  const md = renderMarkdown(result);

  const splitRow = (line) => {
    const cells = [];
    let cur = '';
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '\\' && i + 1 < line.length) { cur += line[i] + line[i + 1]; i += 1; continue; }
      if (line[i] === '|') { cells.push(cur); cur = ''; continue; }
      cur += line[i];
    }
    cells.push(cur);
    return cells.slice(1, -1).map((c) => c.trim());
  };
  const unescapeCell = (c) => c.replace(/\\(.)/g, '$1');

  const tables = [];
  let table = null;
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) { table = null; continue; }
    if (!table) { table = { width: splitRow(line).length, rows: [] }; tables.push(table); continue; }
    if (!/^\|[-:|]+\|$/.test(line)) table.rows.push(line);
  }
  const dataRows = tables.flatMap((t) => t.rows.map((line) => ({ width: t.width, cells: splitRow(line) })));
  const misaligned = dataRows.filter((r) => r.cells.length !== r.width);
  check(tables.length === 6 && dataRows.length === 5,
    `every table row with \\|, \\ and | in it is rendered (got ${tables.length} tables, ${dataRows.length} rows)`);
  check(misaligned.length === 0,
    `\\|, a lone \\ and | in a cell keep the column count (misaligned: ${misaligned.map((r) => r.cells.length).join(', ') || 'none'})`);
  const restored = new Set(dataRows.map((r) => unescapeCell(r.cells[0])));
  check(Object.values(repos).every((r) => restored.has(r)),
    `each repo cell unescapes back to the original name (got ${[...restored].join(' ; ')})`);
  const named = dataRows.find((r) => unescapeCell(r.cells[0]) === repos.named);
  const unnamed = dataRows.find((r) => unescapeCell(r.cells[0]) === repos.merged);
  check(named && unescapeCell(named.cells[1]) === 'repo' && unnamed && unescapeCell(unnamed.cells[1]) === 'public',
    'matchedOn and visibility cells sit in their own columns');
  check(md.split('\n').some((line) => line.endsWith(`: ${HOSTILE}`) && line.startsWith('- merged #')),
    'a title with \\|, \\ and | stays on its one list line, unchanged');
}

// ── 4. gh availability and the injected runner ──────────────────────

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '', notFound: false });
const notFound = () => ({ status: null, stdout: '', stderr: '', notFound: true });

const loggedOutGh = (args) => (args[0] === 'api'
  ? { status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login', notFound: false }
  : ok('gh version 2'));
check(checkGh(() => notFound()).reason === 'not-installed', 'checkGh: gh missing -> not-installed');
check(checkGh(loggedOutGh).reason === 'not-authenticated', 'checkGh: logged out -> not-authenticated');
{
  const calls = [];
  const res = checkGh((args) => { calls.push(args); return ok(args[0] === 'api' ? 'jane-doe\n' : 'gh version 2'); });
  check(res.ok === true && res.login === 'jane-doe', 'checkGh: installed and logged in -> ok, with the active login');
  check(!calls.some((a) => a[0] === 'auth'), 'checkGh: probes the active account, not `gh auth status` (which fails on any stale stored account)');
}
{
  let threw = false;
  try {
    checkGh((args) => (args[0] === 'api' ? { status: 1, stdout: '', stderr: 'error connecting to api.github.com', notFound: false } : ok('gh version 2')));
  } catch { threw = true; }
  check(threw, 'checkGh: a network failure is a query failure, not "logged out"');
}

/** The probe's outcome: what checkGh returned, or the error it threw. */
function probe(apiResult) {
  try {
    return { result: checkGh((args) => (args[0] === 'api' ? apiResult : ok('gh version 2'))) };
  } catch (error) {
    return { error };
  }
}
{
  const emptyStderr = probe({ status: 1, stdout: '', stderr: '', notFound: false });
  check(emptyStderr.error?.constructor.name === 'GhQueryError' && /exit 1\b/.test(emptyStderr.error.message),
    `checkGh: non-zero exit with empty stderr -> GhQueryError naming the exit status, not "logged out" (got ${emptyStderr.error?.message ?? JSON.stringify(emptyStderr.result)})`);

  const killed = probe({ status: null, signal: 'SIGKILL', stdout: '', stderr: '', notFound: false });
  check(killed.error?.constructor.name === 'GhQueryError' && /SIGKILL/.test(killed.error.message),
    `checkGh: gh killed by a signal (status null) -> GhQueryError naming the signal (got ${killed.error?.message ?? JSON.stringify(killed.result)})`);

  const noSignal = probe({ status: null, stdout: '', stderr: '', notFound: false });
  check(noSignal.error?.constructor.name === 'GhQueryError' && /exit null/.test(noSignal.error.message),
    'checkGh: status null with no signal recorded -> GhQueryError, not "logged out"');

  const badToken = probe({ status: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)\n', notFound: false });
  check(badToken.result?.reason === 'not-authenticated', 'checkGh: an auth-failure stderr (HTTP 401) is still not-authenticated');
}

/** A fake gh serving the fixture. Records every call. */
function fakeGh(f = fixture(), { failSearch = false, failRepo = [] } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === '--version') return ok('gh version 2.60.0');
    if (args[0] === 'api' && args[1] === 'user') return ok(`${USER}\n`);
    if (args[0] === 'search') {
      if (failSearch) return { status: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded', notFound: false };
      if (args.includes('--merged')) return ok(JSON.stringify(f.merged));
      return ok(JSON.stringify(args.includes('open') ? f.open : f.closed));
    }
    if (args[0] === 'api') {
      const name = args[1].replace(/^repos\//, '');
      const meta = f.repoMeta.get(name.toLowerCase());
      if (!meta || failRepo.includes(name)) return { status: 1, stdout: '', stderr: 'HTTP 404', notFound: false };
      return ok(JSON.stringify(meta));
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { runner, calls };
}

{
  const { runner, calls } = fakeGh();
  const data = collect(USER, runner);
  const searches = calls.filter((a) => a[0] === 'search');
  check(searches.length === 3 && searches.every((a) => a[a.indexOf('--author') + 1] === USER),
    'collect: three searches, all by --author <user>');
  check(calls.every((a) => a[0] !== 'repo' && !a.some((x) => /contents|git\/|tarball|zipball/.test(String(x)))),
    'collect: no source-code reads (no contents, git, tarball or clone calls)');
  check(data.repoMeta.get('ghostco/deleted') === null, 'collect: a repo whose metadata call fails is recorded as unreadable');
  check(Object.values(data.truncated).every((v) => v === false), 'collect: small result sets are not flagged truncated');
}

{
  seq = 0;
  const many = Array.from({ length: SEARCH_LIMIT }, (_, i) => pr('acme/widgets', `PR ${i}`));
  const f = { merged: many, open: [], closed: many, repoMeta: new Map([['acme/widgets', { private: false, fork: false, stars: 1 }]]) };
  const data = collect(USER, fakeGh(f).runner);
  check(data.truncated.merged === true && data.truncated.open === false, `collect: ${SEARCH_LIMIT} results flags the list as possibly truncated`);
}

// ── 5. CLI: fallback, errors, and the written report ────────────────

function sandbox({ github = 'github.com/jane-doe', cv = CV, allowlist = ['clientco/app'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'co-gh-evidence-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  const lines = ['candidate:', `  full_name: "Jane Doe"`];
  if (github !== null) lines.push(`  github: "${github}"`);
  if (allowlist) lines.push('github_evidence:', '  private_allowlist:', ...allowlist.map((r) => `    - "${r}"`));
  writeFileSync(join(root, 'config', 'profile.yml'), `${lines.join('\n')}\n`);
  if (cv !== null) writeFileSync(join(root, 'cv.md'), cv);
  return root;
}

function cli(root, runGh, args = ['--json']) {
  let out = '';
  let err = '';
  const code = runCli({
    args, dataRoot: root, runGh, profilePath: join(root, 'config', 'profile.yml'), today: '2026-10-16',
    stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, pause: () => {},
  });
  return { code, out, err };
}

const outputFiles = (root) => (existsSync(join(root, 'output')) ? readdirSync(join(root, 'output')) : []);

{
  const root = sandbox();
  try {
    const res = cli(root, () => notFound());
    check(res.code === EXIT_GH_UNAVAILABLE, `gh missing -> exit ${EXIT_GH_UNAVAILABLE} (got ${res.code})`);
    const status = JSON.parse(res.out);
    check(status.status === 'gh-unavailable' && status.reason === 'not-installed', 'gh missing -> machine-readable status on stdout');
    check(/zero-key/.test(res.err), 'gh missing -> stderr says expand stays zero-key');
    check(outputFiles(root).length === 0, 'gh missing -> nothing written');

    const loggedOut = cli(root, loggedOutGh);
    check(loggedOut.code === EXIT_GH_UNAVAILABLE && JSON.parse(loggedOut.out).reason === 'not-authenticated',
      'gh logged out -> exit 3 with reason not-authenticated');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox({ github: null });
  try {
    const { runner, calls } = fakeGh();
    const res = cli(root, runner);
    check(res.code === 1 && calls.length === 0, 'no candidate.github -> exit 1 before any gh call');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox({ github: 'github.com/jane-doe/some-repo' });
  try {
    const { runner, calls } = fakeGh();
    const res = cli(root, runner);
    check(res.code === 1 && calls.length === 0 && outputFiles(root).length === 0,
      `candidate.github is a repo link -> exit 1 before any gh call, nothing written (got ${res.code})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox();
  try {
    const offline = (args) => (args[0] === 'api' ? { status: 1, stdout: '', stderr: 'error connecting to api.github.com', notFound: false } : ok('gh version 2'));
    const res = cli(root, offline);
    check(res.code === EXIT_GH_QUERY_FAILED && outputFiles(root).length === 0, 'gh logged in but offline -> exit 2, nothing written');

    const silentCrash = (args) => (args[0] === 'api' ? { status: 1, stdout: '', stderr: '', notFound: false } : ok('gh version 2'));
    const crash = cli(root, silentCrash);
    const crashStatus = JSON.parse(crash.out);
    check(crash.code === EXIT_GH_QUERY_FAILED && crashStatus.status === 'gh-query-failed' && /exit 1\b/.test(crashStatus.detail),
      `gh api user exits non-zero with empty stderr -> exit 2 gh-query-failed with the exit status (got ${crash.code}: ${crash.out.trim()})`);
    check(!/auth login/.test(crash.err) && outputFiles(root).length === 0, 'empty-stderr failure -> no `gh auth login` advice, nothing written');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox();
  try {
    const res = cli(root, fakeGh(fixture(), { failSearch: true }).runner);
    check(res.code === EXIT_GH_QUERY_FAILED && JSON.parse(res.out).status === 'gh-query-failed',
      `a failed search -> exit ${EXIT_GH_QUERY_FAILED} with status gh-query-failed`);
    check(outputFiles(root).length === 0, 'a failed search -> nothing written');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox();
  const cvBefore = readFileSync(join(root, 'cv.md'), 'utf8');
  try {
    const res = cli(root, fakeGh().runner);
    check(res.code === 0, res.code === 0 ? 'success -> exit 0' : `success -> exit 0 (got ${res.code}: ${res.err.trim()})`);
    const files = outputFiles(root).sort();
    check(JSON.stringify(files) === JSON.stringify(['github-evidence-2026-10-16.json', 'github-evidence-2026-10-16.md']),
      `writes output/github-evidence-{date}.{json,md} under the data root (got ${files})`);
    const written = JSON.parse(readFileSync(join(root, 'output', 'github-evidence-2026-10-16.json'), 'utf8'));
    const printed = JSON.parse(res.out);
    check(written.status === 'ok' && printed.user === 'jane-doe', '--json prints the same report on stdout');
    check(written.contributions.some((c) => c.repo === 'ClientCo/App'), 'the profile allowlist reaches the report');
    check(readFileSync(join(root, 'cv.md'), 'utf8') === cvBefore, 'cv.md is never modified');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const script = join(ROOT, 'github-evidence.mjs');
  const help = spawnSync(NODE, [script, '--help'], { encoding: 'utf8', timeout: 30000 });
  check(help.status === 0 && help.stdout.includes('Usage:'), '--help prints usage and exits 0');
  const bogus = spawnSync(NODE, [script, '--bogus'], { encoding: 'utf8', timeout: 30000 });
  check(bogus.status === 1 && /unrecognized flag/.test(bogus.stderr), 'an unknown flag fails fast, before any gh call');
}

// ── 6. Authored commits on default branches ─────────────────────────
// A repo the user pushes to directly, with no PR, is still found: one commit
// search by author, then exact counts read from the repo for the user's own
// repos and the allowlisted ones. Commit counts sit apart from PR counts and are
// never added to them.

let shaSeq = 0;
/** One commit search result in the REST shape, message included (it must be dropped). */
function commitItem(repo, { author = USER, date = '2026-10-01', priv = false, fork = false, message = 'COMMIT-MESSAGE-NEVER-KEPT' } = {}) {
  shaSeq += 1;
  return {
    sha: `c0ffee${String(shaSeq).padStart(34, '0')}`,
    author: author === null ? null : { login: author },
    commit: { author: { date: `${date}T12:00:00Z`, name: 'Jane Doe', email: 'jane@example.com' }, message },
    repository: { full_name: repo, private: priv, fork },
  };
}
const searchBody = (items, total = items.length, extra = {}) => JSON.stringify({ total_count: total, incomplete_results: false, items, ...extra });

/** What `gh api -i repos/{r}/commits?author=…&per_page=1` prints when the user has `count` commits there. */
function includeOutput(count, newest, { crlf = false } = {}) {
  const nl = crlf ? '\r\n' : '\n';
  const url = 'https://api.github.com/repositories/42/commits?author=jane-doe&per_page=1';
  const head = ['HTTP/2.0 200 OK', 'Content-Type: application/json; charset=utf-8'];
  if (count > 1) head.push(`Link: <${url}&page=2>; rel="next", <${url}&page=${count}>; rel="last"`);
  const body = count > 0 ? [{ sha: 'x', commit: { author: { date: `${newest}T09:00:00Z` }, message: 'COMMIT-MESSAGE-NEVER-KEPT' } }] : [];
  return `${head.join(nl)}${nl}${nl}${JSON.stringify(body)}`;
}

/**
 * A fake gh for the commit step; anything else goes to `base`.
 * pages: search bodies by page number, or {fail: stderr}.
 * repos: per lowercase repo, {count, newest, oldest, crlf} or {status, stderr}.
 * meta: `repos/{r}` metadata per lowercase repo (null: the call fails).
 */
function commitGh({ base = fakeGh().runner, pages = [searchBody([])], repos = {}, meta = {} } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    const target = String(args[1] === '-i' ? args[2] : args[1]);
    if (args[0] === 'api' && target.startsWith('search/commits?')) {
      const p = pages[Number(/[?&]page=(\d+)/.exec(target)[1]) - 1];
      if (p == null || p.fail) return { status: 1, stdout: '', stderr: p?.fail || 'HTTP 422: Validation Failed', notFound: false };
      return ok(p);
    }
    const listing = /^repos\/([^/]+\/[^/?]+)\/commits\?(.*)$/.exec(target);
    if (args[0] === 'api' && listing) {
      const r = repos[listing[1].toLowerCase()];
      if (!r) return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)', notFound: false };
      if (r.status) return { status: r.status, stdout: '', stderr: r.stderr, notFound: false };
      if (/[?&]page=\d+/.test(listing[2])) return ok(JSON.stringify([{ commit: { author: { date: `${r.oldest}T08:00:00Z` } } }]));
      return ok(includeOutput(r.count, r.newest, r));
    }
    const repoKey = /^repos\/([^/]+\/[^/]+)$/.exec(target)?.[1]?.toLowerCase();
    if (args[0] === 'api' && repoKey && repoKey in meta) {
      return meta[repoKey] === null ? { status: 1, stdout: '', stderr: 'HTTP 404', notFound: false } : ok(JSON.stringify(meta[repoKey]));
    }
    return base(args);
  };
  return { runner, calls };
}

const isSearch = (a) => a[0] === 'api' && String(a[1]).startsWith('search/commits');
const countTarget = (a) => /^repos\/([^/]+\/[^/?]+)\/commits\?/.exec(String(a[1] === '-i' ? a[2] : a[1]))?.[1];

// 6a. Discovery, privacy, forks, own repos and the no-summing rule, end to end
// through collect() + collectCommits() + buildEvidence().
{
  shaSeq = 0;
  const items = [
    // A third-party public repo with commits and no PR: the case this step is for.
    commitItem('pushco/service', { date: '2026-09-24' }),
    commitItem('pushco/service', { date: '2026-10-20' }),
    commitItem('pushco/service', { date: '2026-10-02' }),
    // Not the user's commits: dropped by the authorship re-check.
    commitItem('pushco/service', { author: 'someone-else', date: '2026-10-21' }),
    commitItem('pushco/service', { author: null, date: '2026-10-21' }),
    // A private org repo, not allowlisted: name and count only.
    commitItem('orgco/internal', { priv: true, date: '2025-12-30', message: 'SECRET-COMMIT-MESSAGE' }),
    commitItem('orgco/internal', { priv: true, date: '2025-12-31' }),
    // Visibility missing from the result: fails closed.
    commitItem('mystery/repo', { priv: 'unknown' }),
    // A fork: never evidence.
    commitItem('forkco/fork-of-x', { fork: true, date: '2025-11-11' }),
    // acme/widgets has 2 merged PRs in fixture(); squash merges show up as commits too.
    commitItem('acme/widgets', { date: '2026-03-01' }),
    commitItem('acme/widgets', { date: '2026-03-02' }),
    commitItem('acme/widgets', { date: '2026-03-03' }),
    // Own repos: one public (dates shown), one private and not allowlisted (no dates).
    commitItem('jane-doe/tool', { date: '2026-01-01' }),
    commitItem('jane-doe/secret-side', { priv: true, date: '2025-10-10' }),
  ];
  items.push({ ...items[0] }); // the same commit twice counts once

  const prData = collect(USER, fakeGh().runner);
  const allowlist = new Set(['clientco/app', 'allowco/never-searched']);
  const { runner, calls } = commitGh({
    pages: [searchBody(items)],
    repos: {
      'jane-doe/tool': { count: 140, newest: '2026-10-18', oldest: '2024-05-02' },
      'jane-doe/secret-side': { count: 7, newest: '2025-10-10', oldest: '2025-06-01' },
      'clientco/app': { count: 65, newest: '2026-10-20', oldest: '2026-09-24' },
      'allowco/never-searched': { count: 12, newest: '2026-08-01', oldest: '2026-07-01' },
    },
    meta: { 'allowco/never-searched': { private: true, fork: false, stars: 0 } },
  });
  const pauses = [];
  const commits = collectCommits(USER, runner, { repoMeta: prData.repoMeta, allowlist, pause: (ms) => pauses.push(ms) });
  const result = buildEvidence({ user: USER, ...prData, ...commits, allowlist, cvText: CV, generatedAt: '2026-10-22' });
  const json = JSON.stringify(result);
  const md = renderMarkdown(result);
  const byRepo = (list, repo) => list.find((r) => r.repo === repo);

  check(commits.commitSearch.status === 'ok' && result.truncated.commits === false && pauses.length === 0,
    'commits: one search page for a small result set, no pause, not flagged truncated');
  const search = calls.find(isSearch);
  check(/q=author:jane-doe&/.test(search[1]) && /sort=author-date&order=desc/.test(search[1]) && /per_page=100&page=1$/.test(search[1]),
    `commits: searched by author, newest first, 100 per page (got ${search[1]})`);

  const pushed = byRepo(result.contributions, 'pushco/service');
  check(pushed && pushed.counts.merged === 0 && pushed.counts.open === 0 && pushed.counts.closedUnmerged === 0,
    'commits: a repo with authored commits and no PR appears among the contributions');
  check(pushed && pushed.commits.count === 3 && pushed.commits.first === '2026-09-24' && pushed.commits.last === '2026-10-20' && pushed.commits.exact === false,
    `commits: count, first and last date from the search, other authors and duplicates dropped (got ${JSON.stringify(pushed?.commits)})`);
  check(byRepo(result.claimCheck.commitsNotNamed, 'pushco/service')?.commits.count === 3 && !byRepo(result.claimCheck.mergedNotNamed, 'pushco/service'),
    'claim check: a commits-only repo cv.md does not name is in commitsNotNamed, never in mergedNotNamed');

  const hidden = byRepo(result.privateNotAllowlisted, 'orgco/internal');
  check(hidden && hidden.visibility === 'private' && hidden.commits.count === 2 && !('first' in hidden.commits) && !('last' in hidden.commits),
    'commits: a private, non-allowlisted commits-only repo is listed by name and count only, without dates');
  check(!json.includes('2025-12-30') && !md.includes('2025-12-30') && !json.includes('2025-12-31') && !md.includes('2025-12-31'),
    'commits: dates of a non-allowlisted private repo appear nowhere in the JSON or Markdown');
  check(byRepo(result.privateNotAllowlisted, 'mystery/repo')?.visibility === 'unknown', 'commits: unreadable visibility from the search fails closed');
  check(!/COMMIT-MESSAGE|c0ffee/.test(json) && !/COMMIT-MESSAGE|c0ffee/.test(md), 'commits: no commit message or sha reaches the JSON or Markdown');

  const fork = byRepo(result.excluded.forks, 'forkco/fork-of-x');
  check(fork && fork.commits.count === 1 && !('first' in fork.commits) && !byRepo(result.contributions, 'forkco/fork-of-x') && !json.includes('2025-11-11'),
    'commits: a fork is never evidence: name and count only');

  const widgets = byRepo(result.contributions, 'acme/widgets');
  check(widgets && widgets.counts.merged === 2 && widgets.commits.count === 3, 'no summing: PR and commit counts stay in separate fields');
  check(result.totals.merged === 9 && result.totals.commits === 140 + 7 + 65 + 12 + 3 + 2 + 1 + 1 + 3,
    `no summing: totals.merged is unchanged by commits, totals.commits is its own figure (got ${JSON.stringify(result.totals)})`);
  check(md.includes('Merged 2 · Open 1 · Closed unmerged 0') && md.includes('Commits to the default branch: 3 (first 2026-03-01, last 2026-03-03)') && !md.includes('Merged 5'),
    'no summing: the Markdown shows merged PRs and commits on separate lines, never added up');

  const tool = byRepo(result.excluded.ownRepos, 'jane-doe/tool');
  check(tool && tool.counts.merged === 1 && tool.commits.count === 140 && tool.commits.exact && tool.commits.first === '2024-05-02' && tool.commits.last === '2026-10-18',
    'own public repo: exact count and dates read from the repo (search saw only 1 commit)');
  const side = byRepo(result.excluded.ownRepos, 'jane-doe/secret-side');
  check(side && side.commits.count === 7 && side.commits.exact && !('first' in side.commits), 'own private repo, not allowlisted: exact count, no dates');
  check(!byRepo(result.contributions, 'jane-doe/tool') && !byRepo(result.claimCheck.commitsNotNamed, 'jane-doe/tool'), 'own repos stay out of the evidence and the claim check');

  const app = byRepo(result.contributions, 'ClientCo/App');
  check(app && app.commits.count === 65 && app.commits.exact && app.commits.first === '2026-09-24',
    'allowlisted private repo the search did not return: exact count and dates');
  const never = byRepo(result.contributions, 'allowco/never-searched');
  check(never && never.visibility === 'private' && never.commits.count === 12 && byRepo(result.claimCheck.commitsNotNamed, 'allowco/never-searched'),
    'an allowlisted repo neither search returned is still counted and listed');

  const metaCalls = calls.filter((a) => a[0] === 'api' && /^repos\/[^/]+\/[^/]+$/.test(String(a[1])));
  check(metaCalls.length === 1 && metaCalls[0][1] === 'repos/allowco/never-searched',
    `calls: one metadata call, for the allowlisted repo neither search returned; commits-only repos use the search result (got ${metaCalls.map((a) => a[1])})`);
  const counted = calls.filter(countTarget).map(countTarget);
  const want = { 'jane-doe/tool': 2, 'jane-doe/secret-side': 1, 'clientco/app': 2, 'allowco/never-searched': 2 };
  const got = Object.fromEntries([...new Set(counted)].map((r) => [r, counted.filter((x) => x === r).length]));
  check(JSON.stringify(got, Object.keys(got).sort()) === JSON.stringify(want, Object.keys(want).sort()),
    `calls: count reads only for own and allowlisted non-fork repos, a second only for dates that may be shown (got ${JSON.stringify(got)})`);
  check(calls.length === 1 + 1 + 7, `calls: 1 search page + 1 metadata + 7 count reads (got ${calls.length})`);
  check(calls.every((a) => !a.some((x) => /contents|git\/|tarball|zipball|commits\/[0-9a-f]{7,}/.test(String(x)))),
    'calls: no source code, diffs or single-commit reads');
  check(calls.filter(countTarget).every((a) => /\?author=jane-doe&per_page=1(&page=\d+)?$/.test(String(a[1] === '-i' ? a[2] : a[1]))),
    'calls: count reads filter by author on the default branch, one commit per page');

  const commitsTable = md.split('### Commits on the default branch, no merged PR, not named in cv.md')[1]?.split('\n## ')[0] || '';
  check(commitsTable.includes('| pushco/service | public | ? | 3 | 2026-09-24 | 2026-10-20 |') && !/merged/i.test(commitsTable.split('\n').slice(3).join('\n')),
    'Markdown: commits-only repos get their own table, with no "merged" wording');
  check(md.includes('| orgco/internal | 0 | 0 | 0 | 2 | — | — |'), 'Markdown: a non-allowlisted private repo row shows the commit count and no dates');
}

// 6b. Search paging, the 1000-result cap and failures.
{
  shaSeq = 0;
  const page = (n) => Array.from({ length: n }, () => commitItem('pushco/service'));
  const pauses = [];
  let g = commitGh({ pages: [searchBody(page(100), 250), searchBody(page(100), 250), searchBody(page(50), 250)] });
  let s = searchAuthoredCommits(USER, g.runner, (ms) => pauses.push(ms));
  check(s.status === 'ok' && s.read === 250 && s.items.length === 250 && g.calls.length === 3, `search: reads every page up to total_count (got ${s.status}, ${s.read})`);
  check(pauses.length === 2 && pauses.every((ms) => ms === COMMIT_PAGE_PAUSE_MS), 'search: pages are read COMMIT_PAGE_PAUSE_MS apart, no wait before the first');

  g = commitGh({ pages: Array.from({ length: 10 }, () => searchBody(page(100), 1000)) });
  s = searchAuthoredCommits(USER, g.runner, () => {});
  check(s.status === 'ok' && s.read === 1000 && g.calls.length === 10, 'search: exactly 1000 matches is complete, not truncated');

  g = commitGh({ pages: Array.from({ length: 12 }, () => searchBody(page(100), 5000)) });
  s = searchAuthoredCommits(USER, g.runner, () => {});
  check(s.status === 'partial' && s.read === SEARCH_LIMIT && g.calls.length === 10 && /at most 1000/.test(s.detail),
    `search: stops at GitHub's ${SEARCH_LIMIT}-result cap and says so (got ${s.status}, ${s.read}, ${g.calls.length} calls)`);
  const capped = buildEvidence({ user: USER, merged: [], open: [], closed: [], ...collectCommits(USER, g.runner, { pause: () => {} }), generatedAt: '2026-10-22' });
  const cappedMd = renderMarkdown(capped);
  check(capped.truncated.commits === true && capped.commitSearch.total === 5000 && capped.commitSearch.read === 1000,
    'cap: truncated.commits is set, with GitHub\'s total and how many were read');
  check(capped.contributions[0]?.commits.first === null && capped.contributions[0]?.commits.last === '2026-10-01',
    'cap: a search-derived first date is withheld (the search read newest first); last is kept');
  check(cappedMd.includes('read 1000 of 5000 authored commits') && cappedMd.includes('Authored commits on default branches: ≥1000')
    && cappedMd.includes('Commits to the default branch: ≥1000 (last 2026-10-01)') && /these lists may be incomplete: commits/.test(cappedMd),
    'cap: the Markdown flags the list and marks search counts as lower bounds');

  g = commitGh({ pages: [searchBody(page(100), 300), searchBody(page(100), 300), { fail: 'HTTP 403: You have exceeded a secondary rate limit' }] });
  s = searchAuthoredCommits(USER, g.runner, () => {});
  check(s.status === 'partial' && s.read === 200 && s.items.length === 200 && /page 3 failed: .*secondary rate limit/.test(s.detail),
    `search: a later page that fails keeps the pages already read (got ${s.status}, ${s.read}, ${s.detail})`);

  g = commitGh({ pages: [{ fail: 'HTTP 403: You have exceeded a secondary rate limit' }] });
  s = searchAuthoredCommits(USER, g.runner, () => {});
  check(s.status === 'failed' && s.read === 0 && s.items.length === 0 && /page 1 failed/.test(s.detail), 'search: a failed first page is status failed');
  const failed = buildEvidence({
    user: USER, merged: [], open: [], closed: [], repoMeta: new Map([['acme/widgets', { private: false, fork: false, stars: 1 }]]),
    commitSearch: s, commitItems: [], commitCounts: new Map([['jane-doe/tool', { count: 4, first: '2026-01-01', last: '2026-02-01' }]]),
    generatedAt: '2026-10-22',
  });
  check(failed.truncated.commits === true && failed.totals.commits === 4 && failed.excluded.ownRepos[0]?.commits.count === 4,
    'search failed: exact counts still reach the report');
  check(renderMarkdown(failed).includes('Commit search: page 1 failed'), 'search failed: the Markdown says so');
  const cutExact = buildEvidence({
    user: USER, merged: [], open: [], closed: [], repoMeta: new Map([['jane-doe/tool', { private: false, fork: false, stars: 1 }]]),
    commitSearch: { status: 'partial', total: 5000, read: 1000, detail: 'cap' }, commitItems: [],
    commitCounts: new Map([['jane-doe/tool', { count: 4, first: '2026-01-01', last: '2026-02-01' }]]), generatedAt: '2026-10-22',
  });
  check(cutExact.excluded.ownRepos[0]?.commits.first === '2026-01-01', 'search cut short: a count read from the repo keeps its first date');

  g = commitGh({ pages: [searchBody(page(3), 3, { incomplete_results: true })] });
  s = searchAuthoredCommits(USER, g.runner, () => {});
  check(s.status === 'partial' && /incomplete/.test(s.detail), 'search: incomplete_results from GitHub is flagged');
}

// 6c. Exact per-repo counts from the Link header.
{
  const read = (repo, opts) => {
    const g = commitGh({ repos: { 'orgco/app': repo } });
    return { c: countAuthoredCommits(g.runner, 'orgco/app', USER, opts), calls: g.calls };
  };
  let r = read({ count: 65, newest: '2026-10-20', oldest: '2026-09-24' });
  check(r.c?.count === 65 && r.c.last === '2026-10-20' && r.c.first === '2026-09-24' && r.calls.length === 2,
    `count: the Link header's last page is the count; that page holds the oldest commit (got ${JSON.stringify(r.c)}, ${r.calls.length} calls)`);
  check(r.calls[0][1] === '-i' && r.calls[0][2] === 'repos/orgco/app/commits?author=jane-doe&per_page=1' && r.calls[1][1] === 'repos/orgco/app/commits?author=jane-doe&per_page=1&page=65',
    'count: per_page=1 with headers, then the last page');
  r = read({ count: 65, newest: '2026-10-20', oldest: '2026-09-24' }, { dates: false });
  check(r.c?.count === 65 && r.c.first === null && r.c.last === null && r.calls.length === 1, 'count: without dates, one call');
  r = read({ count: 1, newest: '2026-05-05' });
  check(r.c?.count === 1 && r.c.first === '2026-05-05' && r.c.last === '2026-05-05' && r.calls.length === 1, 'count: one commit, no Link header, one call');
  r = read({ count: 0 });
  check(r.c?.count === 0 && r.c.first === null && r.calls.length === 1, 'count: no authored commits -> 0');
  r = read({ count: 3, newest: '2026-05-05', oldest: '2026-04-04', crlf: true });
  check(r.c?.count === 3 && r.c.first === '2026-04-04', 'count: CRLF between headers and body is handled');
  r = read({ status: 1, stderr: 'gh: Git Repository is empty. (HTTP 409)' });
  check(r.c?.count === 0, 'count: an empty repository (HTTP 409) -> 0');
  r = read({ status: 1, stderr: 'gh: Not Found (HTTP 404)' });
  check(r.c === null, 'count: an unreadable repo -> null, never a guess');
}

// 6d. CLI: commits reach the written report; a failed commit search costs nothing else.
{
  const root = sandbox();
  try {
    shaSeq = 0;
    const { runner } = commitGh({
      pages: [searchBody([commitItem('pushco/service', { date: '2026-10-20' }), commitItem('orgco/internal', { priv: true })])],
      repos: { 'jane-doe/tool': { count: 3, newest: '2026-10-01', oldest: '2026-01-01' }, 'clientco/app': { count: 65, newest: '2026-10-20', oldest: '2026-09-24' } },
    });
    const res = cli(root, runner);
    check(res.code === 0, res.code === 0 ? 'CLI with commits -> exit 0' : `CLI with commits -> exit 0 (got ${res.code}: ${res.err.trim()})`);
    const written = JSON.parse(readFileSync(join(root, 'output', 'github-evidence-2026-10-16.json'), 'utf8'));
    check(written.claimCheck.commitsNotNamed.some((c) => c.repo === 'pushco/service') && written.commitSearch.status === 'ok',
      'CLI: a commits-only repo reaches claimCheck.commitsNotNamed in the written JSON');
    check(written.privateNotAllowlisted.some((r) => r.repo === 'orgco/internal' && r.commits.count === 1 && !('first' in r.commits)),
      'CLI: a private, non-allowlisted commits-only repo is written by name and count only');
    check(written.contributions.find((c) => c.repo === 'ClientCo/App')?.commits.count === 65, 'CLI: the allowlist reaches the exact counts');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

{
  const root = sandbox();
  try {
    const { runner } = commitGh({ pages: [{ fail: 'HTTP 403: You have exceeded a secondary rate limit' }] });
    const res = cli(root, runner);
    const printed = JSON.parse(res.out);
    check(res.code === 0 && printed.contributions.some((c) => c.repo === 'acme/widgets') && printed.commitSearch.status === 'failed',
      `CLI: a failed commit search still writes the PR evidence, exit 0 (got ${res.code})`);
    check(/commit search failed: page 1 failed/.test(res.err), 'CLI: and says on stderr that the commit search failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
