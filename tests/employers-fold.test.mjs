// tests/employers-fold.test.mjs: folding the employer registry's inbox into
// boards/ and contributions/ (seeds/employers-fold.mjs).
//
// Every case works on a scratch copy of the registry, never on the checkout.
// The fold must leave a registry the validator accepts, also against the
// registry it started from (--base), skip boards already listed, keep the
// lines already in boards/ byte for byte, credit each contribution, and be
// deterministic and idempotent.
//
// Run:  node --test tests/employers-fold.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { listTree } from '../lib/walk-tree.mjs';

import { applyFold, formatManifest, looseManifest, planFold } from '../seeds/employers-fold.mjs';
import { INBOX_DIR } from '../seeds/employers-inbox.mjs';
import { validateRegistry } from '../seeds/employers-validate.mjs';

const FOLD = join(ROOT, 'seeds', 'employers-fold.mjs');
const IMPORTER = join(ROOT, 'seeds', 'employers-import.mjs');
const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, ...PLAIN_ENV } = process.env;
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: PLAIN_ENV });

const TODAY = new Date('2026-11-11T12:00:00Z');
const DATE = '2026-11-10';

/** Every file under dir/employers, path → text. */
function snapshot(dir) {
  const out = {};
  // Keys use `/` on every OS, so a lookup like before['employers/boards/greenhouse/n.ndjson'] also works on Windows.
  for (const p of listTree(join(dir, 'employers'))) out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
  return out;
}

/** A scratch copy of the registry with the given inbox files. */
function withInbox(files, body) {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-fold-'));
  try {
    cpSync(join(ROOT, 'employers'), join(dir, 'employers'), { recursive: true });
    mkdirSync(join(dir, INBOX_DIR), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, INBOX_DIR, name), typeof content === 'string' ? content : `${content.map((l) => JSON.stringify(l)).join('\n')}\n`);
    }
    return body(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const LOOSE = [
  { ats: 'greenhouse', board: 'notion-labs', name: 'Notion Labs' }, // sorts inside greenhouse/n.ndjson
  { ats: 'greenhouse', board: 'anthropic', name: 'Anthropic' }, // already listed
  { ats: 'workday', board: 'acmeco/wd3/Careers', name: 'AcmeCo', website: 'acmeco.example' },
];
const ORG = [
  { ats: 'ashby', board: 'Aardvark', name: 'Aardvark' },
  { ats: 'lever', region: 'eu', board: 'eurocorp', name: 'Eurocorp' },
];
const ORG2 = [{ ats: 'recruitee', board: 'tinyco', name: 'TinyCo' }];
const sheet = (over = {}) => formatManifest({
  id: `${DATE}-acme-hr`, contributor: 'acme-hr', on_behalf_of: 'Acme Inc.', signed_by: 'A founder of Acme',
  rows: 3, source: 'employer-list:acme', origin: 'The employer pages Acme keeps for its own job search product.',
  no_conflicting_contract: true, personal_data: false, exclusive: false, license: 'CC-BY-4.0',
  also_permits: ['ODbL-1.0', 'CC0-1.0'], attribution: 'Employer pages contributed by Acme', date: DATE, ...over,
});
const INBOX = {
  [`${DATE}-octocat.ndjson`]: LOOSE,
  [`${DATE}-acme-hr-001.ndjson`]: ORG,
  [`${DATE}-acme-hr-002.ndjson`]: ORG2,
  [`${DATE}-acme-hr.json`]: sheet(),
};

test('dry run: the plan, and nothing written', () => withInbox(INBOX, (dir) => {
  const before = snapshot(dir);
  const { errors, plan } = planFold({ root: dir, today: TODAY });
  assert.deepEqual(errors, []);
  assert.deepEqual(plan.contributions, [
    { inboxId: `${DATE}-acme-hr`, id: `${DATE}-acme-hr`, login: 'acme-hr', source: 'employer-list:acme', added: 3, skipped: 0, manifest: 'organization' },
    { inboxId: `${DATE}-octocat`, id: `${DATE}-octocat`, login: 'octocat', source: 'community', added: 2, skipped: 1, manifest: 'written' },
  ]);
  assert.equal(plan.added, 5);
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.writes.map((w) => [w.path, w.created, w.added]), [
    ['employers/boards/ashby/a.ndjson', false, 1],
    ['employers/boards/greenhouse/n.ndjson', false, 1],
    ['employers/boards/lever/e.ndjson', true, 1],
    ['employers/boards/recruitee/t.ndjson', true, 1],
    ['employers/boards/workday/a.ndjson', true, 1],
    [`employers/contributions/${DATE}-acme-hr.json`, true, 0],
    [`employers/contributions/${DATE}-octocat.json`, true, 0],
    ['employers/CHANGELOG.md', false, 0],
  ]);
  assert.deepEqual(plan.deletes, Object.keys(INBOX).map((f) => `${INBOX_DIR}/${f}`).sort());
  assert.deepEqual(snapshot(dir), before);
}));

test('apply: a valid registry, also against the one it started from, with the inbox gone', () => withInbox(INBOX, (dir) => {
  const before = snapshot(dir);
  const { plan } = planFold({ root: dir, today: TODAY });
  applyFold(plan, dir);
  assert.ok(!existsSync(join(dir, INBOX_DIR)), 'the empty inbox directory is removed');

  const after = validateRegistry({ root: dir, base: ROOT, today: TODAY });
  assert.deepEqual(after.errors, []);
  assert.deepEqual(after.warnings, []);
  assert.equal(after.stats.rows, validateRegistry({ root: ROOT }).stats.rows + 5);
  const cli = node(VALIDATOR, ['--base', ROOT], dir);
  assert.equal(cli.status, 0, cli.stderr);

  // Lines already in a board file keep their exact text; the new one is in order.
  const n = readFileSync(join(dir, 'employers/boards/greenhouse/n.ndjson'), 'utf8').split('\n').filter(Boolean);
  for (const line of before['employers/boards/greenhouse/n.ndjson'].split('\n').filter(Boolean)) assert.ok(n.includes(line));
  assert.deepEqual(n.map((l) => JSON.parse(l).board), [...n.map((l) => JSON.parse(l).board)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  assert.ok(n.includes(JSON.stringify({
    ats: 'greenhouse', region: 'us', board: 'notion-labs', careers_url: 'https://job-boards.greenhouse.io/notion-labs',
    name: 'Notion Labs', source: 'community', contribution: `${DATE}-octocat`, added: DATE,
  })));
  const wd = JSON.parse(readFileSync(join(dir, 'employers/boards/workday/a.ndjson'), 'utf8'));
  assert.equal(wd.careers_url, 'https://acmeco.wd3.myworkdayjobs.com/Careers');
  assert.equal(wd.workday_host, 'jobs');
  const eu = JSON.parse(readFileSync(join(dir, 'employers/boards/lever/e.ndjson'), 'utf8'));
  assert.deepEqual([eu.source, eu.contribution], ['employer-list:acme', `${DATE}-acme-hr`]);

  // The organization's manifest moves as it was; the loose one credits the login.
  assert.equal(readFileSync(join(dir, `employers/contributions/${DATE}-acme-hr.json`), 'utf8'), sheet());
  assert.deepEqual(JSON.parse(readFileSync(join(dir, `employers/contributions/${DATE}-octocat.json`), 'utf8')),
    looseManifest({ id: `${DATE}-octocat`, login: 'octocat', date: DATE, rows: 2 }));
  const changelog = readFileSync(join(dir, 'employers/CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`- ${DATE} \`${DATE}-acme-hr\` \\(3 boards, source \`employer-list:acme\`\\): Employer pages contributed by Acme`));
  assert.match(changelog, new RegExp(`- ${DATE} \`${DATE}-octocat\` \\(2 boards, source \`community\`\\): Boards contributed by @octocat`));
}));

test('idempotent and deterministic: a second fold changes nothing, and two copies fold the same', () => {
  const folded = [];
  for (let i = 0; i < 2; i++) {
    withInbox(INBOX, (dir) => {
      applyFold(planFold({ root: dir, today: TODAY }).plan, dir);
      const once = snapshot(dir);
      const { plan } = planFold({ root: dir, today: TODAY });
      assert.deepEqual(plan, { contributions: [], added: 0, skipped: 0, writes: [], deletes: [] });
      applyFold(plan, dir);
      assert.deepEqual(snapshot(dir), once);
      folded.push(once);
    });
  }
  assert.deepEqual(folded[0], folded[1]);
});

test('a taken contribution id gets -2, and an organization manifest is rewritten with the rows it really added', () => withInbox({
  '2026-11-08-santifer.ndjson': [{ ats: 'ashby', board: 'Aardvark', name: 'Aardvark' }, { ats: 'ashby', board: 'langchain', name: 'LangChain' }],
  '2026-11-08-santifer.json': sheet({ id: '2026-11-08-santifer', contributor: 'santifer', rows: 2, date: '2026-11-08' }),
}, (dir) => {
  const { plan } = planFold({ root: dir, today: TODAY });
  assert.deepEqual(plan.contributions.map((c) => [c.inboxId, c.id, c.added, c.skipped]), [['2026-11-08-santifer', '2026-11-08-santifer-2', 1, 1]]);
  applyFold(plan, dir);
  const m = JSON.parse(readFileSync(join(dir, 'employers/contributions/2026-11-08-santifer-2.json'), 'utf8'));
  assert.deepEqual([m.id, m.rows, m.contributor, m.signed_by], ['2026-11-08-santifer-2', 1, 'santifer', 'A founder of Acme']);
  assert.deepEqual(validateRegistry({ root: dir, base: ROOT, today: TODAY }).errors, []);
}));

test('a contribution whose boards are all listed adds no manifest and no credit line', () => withInbox({
  [`${DATE}-octocat.ndjson`]: [{ ats: 'greenhouse', board: 'anthropic', name: 'Anthropic' }],
}, (dir) => {
  const changelog = readFileSync(join(dir, 'employers/CHANGELOG.md'), 'utf8');
  const { plan } = planFold({ root: dir, today: TODAY });
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.contributions.map((c) => c.manifest), ['none']);
  applyFold(plan, dir);
  assert.ok(!existsSync(join(dir, INBOX_DIR)));
  assert.equal(readFileSync(join(dir, 'employers/CHANGELOG.md'), 'utf8'), changelog);
  assert.deepEqual(validateRegistry({ root: dir, today: TODAY }).errors, []);
}));

test('an invalid registry is not folded', () => withInbox({ [`${DATE}-octocat.ndjson`]: [{ ats: 'ashby', board: 'acme', name: 'Acme', extra: 1 }] }, (dir) => {
  const before = snapshot(dir);
  const { errors, plan } = planFold({ root: dir, today: TODAY });
  assert.equal(plan, null);
  assert.ok(errors.some((e) => /unknown key "extra"/.test(e.message)));
  const r = node(FOLD, ['--apply'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fix them before folding/);
  assert.deepEqual(snapshot(dir), before);
}));

test('CLI: dry run by default, --apply writes, an empty inbox is a no-op, unknown flags exit 2', () => withInbox(INBOX, (dir) => {
  const before = snapshot(dir);
  const dry = node(FOLD, [], dir);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^dry run: 2 contribution\(s\), 5 new board\(s\), 1 already in the registry skipped/);
  assert.match(dry.stdout, /run with --apply/);
  assert.deepEqual(snapshot(dir), before);
  const applied = node(FOLD, ['--apply'], dir);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /^folded: /);
  assert.match(applied.stdout, /employer registry is valid: \d+ rows/);
  const again = node(FOLD, ['--apply'], dir);
  assert.equal(again.status, 0);
  assert.equal(again.stdout.trim(), 'the inbox is empty: nothing to fold');
  assert.equal(node(FOLD, ['--force'], dir).status, 2);
}));

test('end to end: the 53 committed boards plus new ones, imported, validated, folded in a copy and validated again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-e2e-'));
  try {
    cpSync(join(ROOT, 'employers'), join(dir, 'employers'), { recursive: true });
    const urls = [];
    for (const ats of readdirSync(join(dir, 'employers/boards'))) {
      for (const f of readdirSync(join(dir, 'employers/boards', ats))) {
        for (const l of readFileSync(join(dir, 'employers/boards', ats, f), 'utf8').split('\n').filter(Boolean)) urls.push(JSON.parse(l).careers_url);
      }
    }
    assert.equal(urls.length, validateRegistry({ root: ROOT }).stats.rows);
    const list = join(dir, 'list.csv');
    writeFileSync(list, ['url,name', ...urls.map((u) => `${u},`), 'https://jobs.lever.co/newco-one,Newco One', 'https://jobs.eu.lever.co/newco-two/abc,Newco Two'].join('\n'));
    const imp = node(IMPORTER, [list, '--login', 'octocat', '--date', DATE], dir);
    assert.equal(imp.status, 0, imp.stderr);

    const v1 = node(VALIDATOR, [], dir);
    assert.equal(v1.status, 0, v1.stderr);
    assert.match(v1.stderr, new RegExp(`${urls.length} boards are already in the registry`));

    const dry = node(FOLD, [], dir);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, new RegExp(`2 new board\\(s\\), ${urls.length} already in the registry skipped`));

    const applied = node(FOLD, ['--apply'], dir);
    assert.equal(applied.status, 0, applied.stderr);
    const v2 = node(VALIDATOR, ['--base', ROOT], dir);
    assert.equal(v2.status, 0, v2.stderr);
    assert.match(v2.stdout, new RegExp(`valid: ${urls.length + 2} rows`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
