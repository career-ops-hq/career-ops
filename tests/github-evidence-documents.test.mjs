// tests/github-evidence-documents.test.mjs — document names in the GitHub
// evidence step of `expand` (#5728). Product and requirement documents kept
// under a repo's docs/ folder were invisible to both the README read and the
// PR evidence. Every gh call goes through an injected runner fed from
// fixtures: nothing here spawns gh or reaches the network.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import {
  isDocumentPath, documentKeywords, summarizeDocuments, collectDocuments, renderDocumentsMarkdown, codeSpan, runCli,
  MAX_DOCUMENT_REPOS, MAX_DOCUMENTS_PER_REPO,
} from '../github-evidence.mjs';

console.log('\ngithub-evidence.mjs — document names on default branches (names only, never read)');

const check = (ok, msg) => (ok ? pass(msg) : fail(msg));
const USER = 'jane-doe';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. Which paths are documents ────────────────────────────────────

const pathCases = [
  ['docs/PRD.md', true],
  ['docs/需求变更对比.docx', true],
  ['doc/spec.pdf', true],
  ['Documentation/flows/acceptance-baseline.xlsx', true],
  ['docs/notes.txt', true],
  ['DESIGN.md', true],
  ['roadmap.docx', true],
  ['README.md', false],
  ['README.zh-CN.md', false],
  ['readme.rst', false],
  ['CHANGELOG.md', false],
  ['LICENSE', false],
  ['LICENSE.md', false],
  ['CONTRIBUTING.md', false],
  ['CODE_OF_CONDUCT.md', false],
  ['requirements.txt', false],
  ['notes.txt', false],
  ['docs/requirements.txt', false],
  ['docs/requirements-docs.txt', false],
  ['docs/CMakeLists.txt', false],
  ['docs/conf.py', false],
  ['docs/Makefile', false],
  ['docs/img/flow.png', false],
  ['docs/.vitepress/theme/spec.md', false],
  ['.github/requirements.md', false],
  ['src/spec/requirements.md', false],
  ['packages/app/docs/prd.md', false],
  ['spec/prd.md', false],
];
for (const [path, want] of pathCases) {
  check(isDocumentPath(path) === want, `isDocumentPath(${JSON.stringify(path)}) -> ${want}`);
}

// ── 2. Which names are flagged ──────────────────────────────────────

const keywordCases = [
  ['docs/需求变更对比.docx', ['需求']],
  ['docs/口径与数据契约.docx', ['契约', '口径']],
  ['docs/验收基线-业务流程.xlsx', ['验收']],
  ['docs/設計規格.md', ['規格', '設計']],
  ['docs/business-definition-and-data-contract.md', ['contract']],
  ['docs/acceptance/baseline-by-flow.md', ['acceptance']],
  ['docs/Requirements.md', ['requirement']],
  ['docs/PRD_v2.docx', ['prd']],
  ['docs/APISpec.md', ['spec']],
  ['docs/dataContract.md', ['contract']],
  ['docs/rfc0001-auth.md', ['rfc']],
  ['docs/adr/0003-queue.md', ['adr']],
  ['docs/user-research.pdf', ['research']],
  ['docs/inspect.md', []],
  ['docs/address-book.md', []],
  ['docs/designer-notes.md', []],
  ['docs/install.md', []],
];
for (const [path, want] of keywordCases) {
  const got = documentKeywords(path);
  check(same(got, want), `documentKeywords(${JSON.stringify(path)}) -> ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
}

// ── 3. One repo's row: privacy, order, caps ─────────────────────────

const PATHS = [
  'README.md', 'src/index.js', 'src/spec/requirements.md', 'package.json',
  'docs/install.md', 'docs/需求变更对比.docx', 'docs/acceptance/baseline.md', 'docs/img/flow.png',
];

{
  const row = summarizeDocuments({ repo: `${USER}/app`, visibility: 'public', own: true, allowlisted: false, branch: 'main', paths: PATHS });
  check(row.total === 3 && row.flagged === 2, `public repo: 3 documents, 2 flagged (got ${row.total}, ${row.flagged})`);
  check(row.namesShown === true && same(row.files.map((f) => f.path), ['docs/acceptance/baseline.md', 'docs/需求变更对比.docx', 'docs/install.md']),
    `public repo: names listed, flagged first (got ${JSON.stringify(row.files.map((f) => f.path))})`);
  check(!row.files.some((f) => f.path.startsWith('src/')), 'source files are never listed, whatever their name');
}

{
  const row = summarizeDocuments({ repo: `${USER}/client-portal`, visibility: 'private', own: true, allowlisted: false, paths: PATHS });
  check(row.namesShown === false && row.files.length === 0 && row.total === 3 && row.flagged === 2,
    'private repo not allowlisted: counts only, no names');
  const unknown = summarizeDocuments({ repo: `${USER}/odd`, visibility: 'unknown', own: true, allowlisted: true, paths: PATHS });
  check(unknown.namesShown === false && unknown.files.length === 0, 'unknown visibility fails closed, even when allowlisted');
  const allowed = summarizeDocuments({ repo: 'ClientCo/App', visibility: 'private', own: false, allowlisted: true, paths: PATHS });
  check(allowed.namesShown === true && allowed.files.length === 3, 'allowlisted private repo: names listed');
}

{
  const many = Array.from({ length: MAX_DOCUMENTS_PER_REPO + 10 }, (_, i) => `docs/page-${String(i).padStart(3, '0')}.md`);
  const row = summarizeDocuments({
    repo: `${USER}/site`, visibility: 'public', own: true, allowlisted: false, paths: [...many, 'docs/zz-prd.md'],
  });
  check(row.total === MAX_DOCUMENTS_PER_REPO + 11 && row.files.length === MAX_DOCUMENTS_PER_REPO && row.filesCapped === true,
    `per-repo cap: ${MAX_DOCUMENTS_PER_REPO} names listed, the total still counted`);
  check(row.files[0].path === 'docs/zz-prd.md', 'per-repo cap keeps flagged names first');
  const ctrl = summarizeDocuments({ repo: `${USER}/x`, visibility: 'public', own: true, allowlisted: false, paths: ['docs/a\nb.md'] });
  check(ctrl.files[0].path === 'docs/a�b.md', 'a control character in a name cannot break its line');
}

{
  // A file name is untrusted: in the Markdown report it must show literally,
  // never as a link or formatting. CommonMark code spans: no escapes inside, a
  // fence longer than any backtick run, one space of padding at a backtick edge.
  check(codeSpan('docs/[Q3 plan](#requirements).md') === '`docs/[Q3 plan](#requirements).md`', 'a link-like name becomes a code span');
  check(codeSpan('docs/a`b.md') === '``docs/a`b.md``', 'a backtick inside a name gets a longer fence');
  check(codeSpan('`edge`.md') === '`` `edge`.md ``', 'a backtick at an edge gets padded');
  check(codeSpan(' spaced ') === '`  spaced  `', 'a name with a space at both ends keeps them');
  const docs = {
    status: 'ok', ownRepos: { total: 1, listed: 1, max: MAX_DOCUMENT_REPOS }, scanned: 1, gaps: [],
    repos: [summarizeDocuments({ repo: `${USER}/x`, visibility: 'public', own: true, allowlisted: false, paths: ['docs/[Q3 plan](#requirements).md'] })],
  };
  check(renderDocumentsMarkdown(docs).includes('- `docs/[Q3 plan](#requirements).md` (flagged: requirement)'),
    'the Markdown report renders a link-like name as a code span, keyword kept');
}

// ── 4. The gh calls ─────────────────────────────────────────────────

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '', notFound: false });
const failed = (stderr) => ({ status: 1, stdout: '', stderr, notFound: false });
const tree = (paths, truncated = false) => ok(JSON.stringify({
  sha: 'abc', truncated,
  tree: [...paths.map((path) => ({ path, type: 'blob', sha: 'b' })), { path: 'docs', type: 'tree', sha: 't' }],
}));

function ownRepo(name, { isPrivate = false, isFork = false, isEmpty = false, branch = 'main' } = {}) {
  return { nameWithOwner: `${USER}/${name}`, isPrivate, isFork, isEmpty, defaultBranchRef: branch ? { name: branch } : null };
}

function docsFixture() {
  return {
    own: [
      ownRepo('public-app'),
      ownRepo('client-portal', { isPrivate: true }),
      ownRepo('allowed-private', { isPrivate: true }),
      ownRepo('empty', { isEmpty: true, branch: null }),
      ownRepo('broken'),
      ownRepo('huge'),
      ownRepo('no-docs'),
      ownRepo('slashed', { branch: 'release/2.0' }),
      ownRepo('sneaky-fork', { isFork: true }),
    ],
    total: 45,
    trees: {
      [`${USER}/public-app`]: tree(['README.md', 'src/main.js', 'docs/需求变更对比.docx', 'docs/install.md']),
      [`${USER}/client-portal`]: tree(['docs/SECRETCLIENT-需求说明书.docx', 'docs/SECRETCLIENT-handbook.md']),
      [`${USER}/allowed-private`]: tree(['docs/acceptance-baseline.md']),
      [`${USER}/broken`]: failed('gh: Not Found (HTTP 404)'),
      [`${USER}/huge`]: tree(['docs/design.md'], true),
      [`${USER}/no-docs`]: tree(['README.md', 'index.js']),
      [`${USER}/slashed`]: tree(['docs/roadmap.md']),
      'ClientCo/App': tree(['docs/口径与数据契约.docx']),
    },
    meta: {
      'clientco/app': { name: 'ClientCo/App', private: true, fork: false, branch: 'trunk' },
      'forkco/forked': { name: 'forkco/forked', private: false, fork: true, branch: 'main' },
    },
  };
}

/** A fake gh serving the fixture. Records every call. */
function docsGh(f = docsFixture(), { failList = false, throwOn = null } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (throwOn && args.join(' ').includes(throwOn)) throw new Error(`unexpected gh call: ${args.join(' ')}`);
    if (args[0] !== 'api') throw new Error(`unexpected gh call: ${args.join(' ')}`);
    if (args[1] === 'graphql') {
      if (failList) return failed('gh: HTTP 502: Bad Gateway');
      return ok(JSON.stringify({ data: { repositoryOwner: { repositories: { totalCount: f.total, nodes: f.own } } } }));
    }
    const treeMatch = /^repos\/([^/]+\/[^/]+)\/git\/trees\/([^?]+)\?recursive=1$/.exec(args[1]);
    if (treeMatch) return f.trees[treeMatch[1]] ?? failed('gh: Not Found (HTTP 404)');
    const metaMatch = /^repos\/([^/]+\/[^/]+)$/.exec(args[1]);
    if (metaMatch) {
      const meta = f.meta[metaMatch[1]];
      return meta ? ok(JSON.stringify(meta)) : failed('gh: Not Found (HTTP 404)');
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { runner, calls };
}

const ALLOWLIST = new Set([`${USER}/allowed-private`, 'clientco/app', 'forkco/forked', 'gone/repo']);
const rowOf = (docs, repo) => docs.repos.find((r) => r.repo === repo);

{
  const { runner, calls } = docsGh();
  const docs = collectDocuments(USER, runner, { allowlist: ALLOWLIST });
  const paths = calls.map((a) => String(a[1]));

  const list = calls.filter((a) => a[1] === 'graphql');
  check(list.length === 1 && list[0].includes(`login=${USER}`) && list[0].includes(`first=${MAX_DOCUMENT_REPOS}`),
    `one GraphQL call lists the own repos, capped at ${MAX_DOCUMENT_REPOS}`);
  check(list[0].some((a) => a.includes('isFork: false') && a.includes('PUSHED_AT')),
    'the own-repo query leaves forks out and orders by last push');
  const trees = paths.filter((p) => p.includes('/git/trees/'));
  check(trees.length === 8, `one tree call per non-empty, non-fork repo (got ${trees.length})`);
  check(trees.every((p) => p.endsWith('?recursive=1')), 'tree calls are recursive');
  check(!trees.some((p) => p.includes(`${USER}/empty/`) || p.includes('sneaky-fork') || p.includes('forkco/')),
    'no tree call for an empty repo or a fork');
  check(trees.includes(`repos/${USER}/slashed/git/trees/release%2F2.0?recursive=1`), 'a branch name is URL-encoded');
  check(trees.includes('repos/ClientCo/App/git/trees/trunk?recursive=1'), 'an allowlisted repo is read on its own default branch');
  check(calls.every((a) => a[0] === 'api' && !a.some((x) => /contents|blobs|tarball|zipball|raw|readme|archive/i.test(String(x)))),
    'names only: no contents, blob, archive, raw or README call');
  check(paths.filter((p) => /^repos\/[^/]+\/[^/]+$/.test(p)).sort().join(',') === 'repos/clientco/app,repos/forkco/forked,repos/gone/repo',
    'one metadata call per allowlisted repo the own-repo list did not return');

  check(docs.status === 'partial', `a failed tree read makes the status partial (got ${docs.status})`);
  check(same(docs.ownRepos, { total: 45, listed: 8, max: MAX_DOCUMENT_REPOS }), `ownRepos reports how many were listed of how many (got ${JSON.stringify(docs.ownRepos)})`);
  check(docs.scanned === 8, `scanned counts every repo read, empty ones included (got ${docs.scanned})`);
  check(same(docs.gaps.map((g) => g.repo), [`gone/repo`, `${USER}/broken`]) && /HTTP 404/.test(docs.gaps[1].detail),
    `gaps name each repo not read and why (got ${JSON.stringify(docs.gaps)})`);

  const pub = rowOf(docs, `${USER}/public-app`);
  check(pub?.namesShown && pub.own && pub.files[0].path === 'docs/需求变更对比.docx' && same(pub.files[0].keywords, ['需求']),
    'public own repo: flagged Chinese name listed first with its keyword');
  const hidden = rowOf(docs, `${USER}/client-portal`);
  check(hidden && hidden.namesShown === false && hidden.total === 2 && hidden.flagged === 1,
    'private own repo not allowlisted: counts only');
  check(!JSON.stringify(docs).includes('SECRETCLIENT') && !renderDocumentsMarkdown(docs).includes('SECRETCLIENT'),
    'names from a private repo that is not allowlisted appear nowhere in the JSON or Markdown');
  check(rowOf(docs, `${USER}/allowed-private`)?.namesShown === true, 'allowlisted own private repo: names listed');
  const client = rowOf(docs, 'ClientCo/App');
  check(client && client.own === false && client.allowlisted && client.branch === 'trunk' && same(client.files[0].keywords, ['契约', '口径']),
    'allowlisted third-party repo: listed with its own name, branch and keywords');
  check(rowOf(docs, `${USER}/huge`)?.treeTruncated === true, 'a truncated tree is flagged');
  check(!rowOf(docs, `${USER}/no-docs`) && !rowOf(docs, `${USER}/empty`), 'repos with no documents are left out of the rows');
  check(!docs.repos.some((r) => /fork/.test(r.repo)), 'a fork is never listed, own or allowlisted');
  check(docs.repos[0].flagged >= docs.repos[docs.repos.length - 1].flagged, 'rows are ordered by flagged count');

  const md = renderDocumentsMarkdown(docs);
  check(/untrusted external content/i.test(md) && /No file was opened/.test(md), 'the Markdown section says names only, untrusted');
  check(md.includes(`### ${USER}/client-portal (private, yours): 2 documents, 1 flagged`) && md.includes('Names hidden (private, not allowlisted)'),
    'the Markdown says which names are hidden and how to list them');
  check(md.includes('- `docs/需求变更对比.docx` (flagged: 需求)'), 'the Markdown lists a flagged name with its keyword');
  check(md.includes(`- ${USER}/broken: tree read failed`) && md.includes('8 of your 45 own non-fork repos'),
    'the Markdown lists the gaps and the repo cap');
}

{
  const { runner } = docsGh(docsFixture(), { failList: true });
  const docs = collectDocuments(USER, runner, { allowlist: new Set(['clientco/app']) });
  check(docs.status === 'partial' && docs.gaps[0].repo === null && /own repo list failed: .*502/.test(docs.gaps[0].detail),
    'a failed own-repo list is a gap, not a crash');
  check(docs.ownRepos.total === null && rowOf(docs, 'ClientCo/App'), 'allowlisted repos are still read when the own-repo list fails');
  const none = collectDocuments(USER, runner);
  check(none.status === 'failed' && none.scanned === 0 && none.repos.length === 0, 'nothing read at all -> status failed');
  check(renderDocumentsMarkdown(none).includes('your own repos could not be listed'), 'and the Markdown says so');
}

{
  const { runner } = docsGh(docsFixture(), { throwOn: 'git/trees' });
  let docs;
  let threw = false;
  try { docs = collectDocuments(USER, runner); } catch { threw = true; }
  check(!threw && docs.gaps.length === 7 && docs.gaps.every((g) => /unexpected gh call/.test(g.detail)) && docs.status === 'partial',
    `a runner that throws is recorded as a gap, never thrown (got ${threw ? 'a throw' : `${docs.gaps.length} gaps, ${docs.status}`})`);
  const emptyRepo = collectDocuments(USER, () => ({ status: 1, stdout: '', stderr: 'gh: Git Repository is empty. (HTTP 409)' }), {});
  check(emptyRepo.gaps.length === 1 && emptyRepo.gaps[0].repo === null, 'HTTP 409 on the list is still a gap');
}

{
  const f = docsFixture();
  f.trees[`${USER}/broken`] = { status: 1, stdout: '', stderr: 'gh: Git Repository is empty. (HTTP 409)' };
  const docs = collectDocuments(USER, docsGh(f).runner);
  check(!docs.gaps.some((g) => g.repo === `${USER}/broken`), 'an empty repo (HTTP 409 on its tree) is read as zero documents, not a gap');
}

// ── 5. CLI: a new key, and nothing else changes ─────────────────────

let seq = 0;
function pr(repo, title) {
  seq += 1;
  return {
    author: { login: USER }, repository: { name: repo.split('/')[1], nameWithOwner: repo },
    title, number: seq, url: `https://github.com/${repo}/pull/${seq}`, closedAt: '2026-03-01T00:00:00Z', createdAt: '2026-02-01T00:00:00Z',
  };
}
const MERGED = [pr('acme/widgets', 'Add retry'), pr(`${USER}/public-app`, 'Own change')];
const REPO_META = { 'acme/widgets': { private: false, fork: false, stars: 1200 }, [`${USER}/public-app`]: { private: false, fork: false, stars: 3 } };

/** The document step's own calls: the own-repo query, allowlist metadata, trees. */
const isDocumentCall = (args) => args[0] === 'api'
  && (args[1] === 'graphql' || /\/git\/trees\//.test(String(args[1])) || args.some((a) => String(a).startsWith('{name: .full_name')));

/**
 * The PR side of gh, then the document side from docsGh. Any other call (a
 * later evidence step) answers 404, the same in every run, so the comparison
 * below holds whatever else the script reads.
 */
function fullGh({ failDocs = false } = {}) {
  const docs = docsGh();
  const runner = (args) => {
    if (args[0] === '--version') return ok('gh version 2.60.0');
    if (args[0] === 'api' && args[1] === 'user') return ok(`${USER}\n`);
    if (args[0] === 'search') return ok(JSON.stringify(args.includes('open') ? [] : MERGED));
    const meta = args[0] === 'api' && args.includes('{private: .private, fork: .fork, stars: .stargazers_count}')
      ? REPO_META[args[1].replace(/^repos\//, '').toLowerCase()] : undefined;
    if (meta) return ok(JSON.stringify(meta));
    if (!isDocumentCall(args)) return failed('gh: Not Found (HTTP 404)');
    if (failDocs) return failed('gh: HTTP 503: Service Unavailable');
    return docs.runner(args);
  };
  return { runner };
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'co-gh-docs-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'profile.yml'), [
    'candidate:', '  full_name: "Jane Doe"', `  github: "github.com/${USER}"`,
    'github_evidence:', '  private_allowlist:', `    - "${USER}/allowed-private"`, '    - "clientco/app"', '',
  ].join('\n'));
  writeFileSync(join(root, 'cv.md'), '# CV\n\n## Projects\n- Something else.\n');
  return root;
}

function cli(root, runGh) {
  let out = '';
  let err = '';
  // A fixed clock and no pauses for any evidence step that takes them (runCli
  // ignores options it does not use), so two runs differ only in what gh returns.
  const code = runCli({
    args: ['--json'], dataRoot: root, runGh, profilePath: join(root, 'config', 'profile.yml'), today: '2026-10-23',
    stdout: (s) => { out += s; }, stderr: (s) => { err += s; },
    now: () => new Date('2026-10-23T09:00:00Z'), pause: () => {},
  });
  return { code, out, err };
}

{
  const root = sandbox();
  const failRoot = sandbox();
  try {
    const good = cli(root, fullGh().runner);
    const bad = cli(failRoot, fullGh({ failDocs: true }).runner);
    check(good.code === 0 && bad.code === 0, `exit 0 whether the document listing works or fails (got ${good.code}, ${bad.code})`);
    const goodJson = JSON.parse(readFileSync(join(root, 'output', 'github-evidence-2026-10-23.json'), 'utf8'));
    const badJson = JSON.parse(readFileSync(join(failRoot, 'output', 'github-evidence-2026-10-23.json'), 'utf8'));
    check(goodJson.documents?.status === 'partial' && rowOf(goodJson.documents, 'ClientCo/App'),
      'the JSON carries `documents`, with the profile allowlist applied');
    check(badJson.documents?.status === 'failed' && /document listing failed/.test(bad.err),
      'a failed listing is reported in `documents` and on stderr');
    const { documents: d1, ...restGood } = goodJson;
    const { documents: d2, ...restBad } = badJson;
    check(same(restGood, restBad) && same(Object.keys(goodJson).slice(0, -1), Object.keys(restBad)),
      'every other key of the report is the same whether the listing works or fails');
    check(same(JSON.parse(good.out), goodJson), '--json prints the same report, documents included');
    const md = readFileSync(join(root, 'output', 'github-evidence-2026-10-23.md'), 'utf8');
    check(md.includes('## Claim check against cv.md') && md.includes('## Documents on default branches (names only, never opened)')
      && md.indexOf('## Documents on default branches') > md.indexOf('## Your own repos'),
      'the Markdown report keeps its sections and adds the document section last');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(failRoot, { recursive: true, force: true });
  }
}

// ── 6. modes/expand.md: confirm before reading ──────────────────────

{
  const flat = readFileSync(join(ROOT, 'modes/expand.md'), 'utf-8').replace(/\s+/g, ' ');
  const has = (probe) => flat.includes(probe.replace(/\s+/g, ' '));
  check(has('documents the evidence did not read'), 'expand presents flagged files as documents the evidence did not read');
  check(has('Ask which reflect the user\'s own work'), 'expand asks which documents are the user\'s own work');
  check(has('Read only what the user confirms') && has('Never read source code'), 'expand reads a document only after the user confirms it, and never source code');
  check(has('`documents`') && has('Untrusted External Content'), 'expand treats a confirmed document as untrusted external content');
  check(has('the branch the way `encodeURIComponent` does') && has('leave out `?ref=<branch>`'),
    'expand URL-encodes the path and branch before a read, and drops ?ref= when the branch is unknown');
}
