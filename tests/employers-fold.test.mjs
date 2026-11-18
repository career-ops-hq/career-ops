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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, copyEmployerRegistry, employerRegistryToday, unlistedEmployerBoard, unusedEmployerContributionDay } from './helpers.mjs';
import { listTree } from '../lib/walk-tree.mjs';

import { applyFold, formatManifest, looseManifest, planFold } from '../seeds/employers-fold.mjs';
import { INBOX_DIR } from '../seeds/employers-inbox.mjs';
import { compareContributionIds, validateRegistry } from '../seeds/employers-validate.mjs';

const FOLD = join(ROOT, 'seeds', 'employers-fold.mjs');
const IMPORTER = join(ROOT, 'seeds', 'employers-import.mjs');
const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, ...PLAIN_ENV } = process.env;
const node = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: PLAIN_ENV });

const TODAY = employerRegistryToday();
const DATE = unusedEmployerContributionDay();

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
    copyEmployerRegistry(dir);
    mkdirSync(join(dir, INBOX_DIR), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, INBOX_DIR, name), typeof content === 'string' ? content : `${content.map((l) => JSON.stringify(l)).join('\n')}\n`);
    }
    return body(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** An inbox line for a board the committed registry does not list (see unlistedEmployerBoard). */
const unlisted = (line) => ({ ...line, board: unlistedEmployerBoard(line.ats, line.board) });
/** The board file a line folds into, and whether the committed registry has it yet. */
const boardFile = (line) => `employers/boards/${line.ats}/${line.board[0].toLowerCase()}.ndjson`;
const isNewFile = (path) => !existsSync(join(ROOT, path));
/** The row a fold wrote for `line`, read back from its board file. */
const foldedRow = (dir, line) => readFileSync(join(dir, boardFile(line)), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).find((row) => row.board === line.board);

// A recruitee initial with no board file yet, so that one write creates its file.
const FREE_INITIAL = [...'abcdefghijklmnopqrstuvwxyz0123456789'].find((c) => isNewFile(`employers/boards/recruitee/${c}.ndjson`));

const LOOSE = [
  unlisted({ ats: 'greenhouse', board: 'notion-labs', name: 'Notion Labs' }), // sorts inside greenhouse/n.ndjson
  { ats: 'greenhouse', board: 'anthropic', name: 'Anthropic' }, // already listed; rows are retired, never deleted
  unlisted({ ats: 'workday', board: 'acmeco/wd3/Careers', name: 'AcmeCo', website: 'acmeco.example' }),
];
const ORG = [
  unlisted({ ats: 'ashby', board: 'Aardvark', name: 'Aardvark' }),
  unlisted({ ats: 'lever', region: 'eu', board: 'eurocorp', name: 'Eurocorp' }),
];
const ORG2 = [{ ats: 'recruitee', board: `${FREE_INITIAL}-tinyco`, name: 'TinyCo' }];
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
    ['employers/boards/ashby/a.ndjson', isNewFile('employers/boards/ashby/a.ndjson'), 1],
    ['employers/boards/greenhouse/n.ndjson', false, 1],
    ['employers/boards/lever/e.ndjson', isNewFile('employers/boards/lever/e.ndjson'), 1],
    [boardFile(ORG2[0]), true, 1],
    ['employers/boards/workday/a.ndjson', isNewFile('employers/boards/workday/a.ndjson'), 1],
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
    ats: 'greenhouse', region: 'us', board: LOOSE[0].board, careers_url: `https://job-boards.greenhouse.io/${LOOSE[0].board}`,
    name: 'Notion Labs', source: 'community', contribution: `${DATE}-octocat`, added: DATE,
  })));
  const wd = foldedRow(dir, LOOSE[2]);
  assert.equal(wd.careers_url, `https://${LOOSE[2].board.split('/')[0]}.wd3.myworkdayjobs.com/Careers`);
  assert.equal(wd.workday_host, 'jobs');
  const eu = foldedRow(dir, ORG[1]);
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

// A committed contribution id without a number whose -2 is still free.
const TAKEN = readdirSync(join(ROOT, 'employers/contributions')).map((f) => f.replace(/\.json$/, ''))
  .sort().find((id) => !id.includes('.') && !existsSync(join(ROOT, 'employers/contributions', `${id}-2.json`)));
const [TAKEN_DATE, TAKEN_LOGIN] = [TAKEN.slice(0, 10), TAKEN.slice(11)];

test('a taken contribution id gets -2, and an organization manifest is rewritten with the rows it really added', () => withInbox({
  [`${TAKEN}.ndjson`]: [unlisted({ ats: 'ashby', board: 'Aardvark', name: 'Aardvark' }), { ats: 'ashby', board: 'langchain', name: 'LangChain' }],
  [`${TAKEN}.json`]: sheet({ id: TAKEN, contributor: TAKEN_LOGIN, rows: 2, date: TAKEN_DATE }),
}, (dir) => {
  const { plan } = planFold({ root: dir, today: TODAY });
  assert.deepEqual(plan.contributions.map((c) => [c.inboxId, c.id, c.added, c.skipped]), [[TAKEN, `${TAKEN}-2`, 1, 1]]);
  applyFold(plan, dir);
  const m = JSON.parse(readFileSync(join(dir, `employers/contributions/${TAKEN}-2.json`), 'utf8'));
  assert.deepEqual([m.id, m.rows, m.contributor, m.signed_by], [`${TAKEN}-2`, 1, TAKEN_LOGIN, 'A founder of Acme']);
  assert.deepEqual(validateRegistry({ root: dir, base: ROOT, today: TODAY }).errors, []);
}));

// Three contributions of one login on one day: the first with no number, then
// .2 from another source, then .10 with no manifest of its own (.3 to .9 need
// not exist).
const DAY = [unlisted({ ats: 'ashby', board: 'Aardvark', name: 'Aardvark' })];
const DAY2 = [unlisted({ ats: 'lever', region: 'eu', board: 'eurocorp', name: 'Eurocorp' })];
const DAY10 = [unlisted({ ats: 'greenhouse', board: 'notion-labs', name: 'Notion Labs' })];
const DAY_INBOX = {
  [`${DATE}-acme-hr.10.ndjson`]: DAY10,
  [`${DATE}-acme-hr.2.json`]: sheet({ id: `${DATE}-acme-hr.2`, rows: 1, source: `web-index:wayback@${DATE}`, attribution: 'Archived pages contributed by Acme' }),
  [`${DATE}-acme-hr.2.ndjson`]: DAY2,
  [`${DATE}-acme-hr.json`]: sheet({ rows: 1 }),
  [`${DATE}-acme-hr.ndjson`]: DAY,
};

test('several contributions of one login on one day: each folds with its own id, source, manifest and credit line, in number order', () => withInbox(DAY_INBOX, (dir) => {
  const { errors, plan } = planFold({ root: dir, today: TODAY });
  assert.deepEqual(errors, []);
  assert.deepEqual(plan.contributions.map((c) => [c.inboxId, c.id, c.login, c.source, c.added, c.manifest]), [
    [`${DATE}-acme-hr`, `${DATE}-acme-hr`, 'acme-hr', 'employer-list:acme', 1, 'organization'],
    [`${DATE}-acme-hr.2`, `${DATE}-acme-hr.2`, 'acme-hr', `web-index:wayback@${DATE}`, 1, 'organization'],
    [`${DATE}-acme-hr.10`, `${DATE}-acme-hr.10`, 'acme-hr', 'community', 1, 'written'],
  ]);
  applyFold(plan, dir);

  assert.deepEqual([DAY[0], DAY2[0], DAY10[0]].map((l) => { const r = foldedRow(dir, l); return [r.contribution, r.source, r.added]; }), [
    [`${DATE}-acme-hr`, 'employer-list:acme', DATE],
    [`${DATE}-acme-hr.2`, `web-index:wayback@${DATE}`, DATE],
    [`${DATE}-acme-hr.10`, 'community', DATE],
  ]);
  assert.equal(readFileSync(join(dir, `employers/contributions/${DATE}-acme-hr.2.json`), 'utf8'), DAY_INBOX[`${DATE}-acme-hr.2.json`]);
  // A numbered contribution without a manifest credits the login, not the id.
  assert.deepEqual(JSON.parse(readFileSync(join(dir, `employers/contributions/${DATE}-acme-hr.10.json`), 'utf8')),
    looseManifest({ id: `${DATE}-acme-hr.10`, login: 'acme-hr', date: DATE, rows: 1 }));

  const changelog = readFileSync(join(dir, 'employers/CHANGELOG.md'), 'utf8').split('\n');
  const lines = [
    `- ${DATE} \`${DATE}-acme-hr\` (1 board, source \`employer-list:acme\`): Employer pages contributed by Acme`,
    `- ${DATE} \`${DATE}-acme-hr.2\` (1 board, source \`web-index:wayback@${DATE}\`): Archived pages contributed by Acme`,
    `- ${DATE} \`${DATE}-acme-hr.10\` (1 board, source \`community\`): Boards contributed by @acme-hr`,
  ].map((l) => changelog.indexOf(l));
  assert.ok(lines.every((i) => i > 0), JSON.stringify(lines));
  assert.deepEqual(lines, [lines[0], lines[0] + 1, lines[0] + 2]);

  const after = validateRegistry({ root: dir, base: ROOT, today: TODAY });
  assert.deepEqual(after.errors, []);
  assert.deepEqual(after.warnings, []);
}));

test('a numbered id already in contributions/ is an error that names a free number, and the fold refuses it', () => withInbox(DAY_INBOX, (dir) => {
  applyFold(planFold({ root: dir, today: TODAY }).plan, dir);
  const again = {
    [`${DATE}-acme-hr.2.ndjson`]: [unlisted({ ats: 'recruitee', board: 'tinyco', name: 'TinyCo' })],
    [`${DATE}-acme-hr.ndjson`]: [unlisted({ ats: 'workday', board: 'acmeco/wd3/Careers', name: 'AcmeCo' })],
  };
  mkdirSync(join(dir, INBOX_DIR));
  for (const [name, lines] of Object.entries(again)) writeFileSync(join(dir, INBOX_DIR, name), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  // Only the numbered id is an error: one without a number keeps today's rule and is folded in as -2.
  assert.deepEqual(validateRegistry({ root: dir, today: TODAY }).errors.map((e) => `${e.file}: ${e.message}`), [
    `${INBOX_DIR}/${DATE}-acme-hr.2.ndjson: contribution ${DATE}-acme-hr.2 is already in the registry (contributions/${DATE}-acme-hr.2.json): give this one another number; the next free one is ${DATE}-acme-hr.3`,
  ]);
  const before = snapshot(dir);
  const r = node(FOLD, ['--apply'], dir);
  assert.equal(r.status, 1);
  assert.deepEqual(snapshot(dir), before);

  // Renamed to .3, both fold: the unnumbered one as -2, the numbered one as it is.
  writeFileSync(join(dir, INBOX_DIR, `${DATE}-acme-hr.3.ndjson`), readFileSync(join(dir, INBOX_DIR, `${DATE}-acme-hr.2.ndjson`)));
  rmSync(join(dir, INBOX_DIR, `${DATE}-acme-hr.2.ndjson`));
  const { errors, plan } = planFold({ root: dir, today: TODAY });
  assert.deepEqual(errors, []);
  assert.deepEqual(plan.contributions.map((c) => [c.inboxId, c.id]), [[`${DATE}-acme-hr`, `${DATE}-acme-hr-2`], [`${DATE}-acme-hr.3`, `${DATE}-acme-hr.3`]]);
}));

test('ids without a number keep their order: compareContributionIds sorts them as plain text', () => {
  const committed = readdirSync(join(ROOT, 'employers/contributions')).map((f) => f.replace(/\.json$/, ''));
  const plain = [...committed, '2026-11-10-octocat', '2026-11-10-octocat-2', '2026-11-10-octo', '2026-11-10-octo-cat', '2026-11-09-zed', '2026-11-10-a1', '2026-11-10-a-1'];
  assert.deepEqual([...plain].sort(compareContributionIds), [...plain].sort());
  const numbered = ['2026-11-10-octocat.10', '2026-11-10-octocat-2', '2026-11-10-octocat.2', '2026-11-10-octocat', '2026-11-10-octocat.9'];
  assert.deepEqual([...numbered].sort(compareContributionIds),
    ['2026-11-10-octocat', '2026-11-10-octocat.2', '2026-11-10-octocat.9', '2026-11-10-octocat.10', '2026-11-10-octocat-2']);
});

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

test('end to end: the committed boards plus new ones, imported, validated, folded in a copy and validated again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-e2e-'));
  try {
    copyEmployerRegistry(dir);
    const urls = [];
    for (const ats of readdirSync(join(dir, 'employers/boards'))) {
      for (const f of readdirSync(join(dir, 'employers/boards', ats))) {
        for (const l of readFileSync(join(dir, 'employers/boards', ats, f), 'utf8').split('\n').filter(Boolean)) urls.push(JSON.parse(l).careers_url);
      }
    }
    assert.equal(urls.length, validateRegistry({ root: ROOT }).stats.rows);
    const list = join(dir, 'list.csv');
    const [one, two] = [unlistedEmployerBoard('lever', 'newco-one'), unlistedEmployerBoard('lever', 'newco-two')];
    writeFileSync(list, ['url,name', ...urls.map((u) => `${u},`), `https://jobs.lever.co/${one},Newco One`, `https://jobs.eu.lever.co/${two}/abc,Newco Two`].join('\n'));
    const imp = node(IMPORTER, [list, '--login', 'octocat', '--date', DATE], dir);
    assert.equal(imp.status, 0, imp.stderr);

    const v1 = node(VALIDATOR, [], dir);
    assert.equal(v1.status, 0, v1.stderr);
    // The warning is one for each inbox file, and a registry above the size of one file is imported in parts.
    const already = [...v1.stderr.matchAll(/: (\d+) boards? (?:is|are) already in the registry/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    assert.equal(already, urls.length);

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
