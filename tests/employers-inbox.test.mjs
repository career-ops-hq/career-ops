// tests/employers-inbox.test.mjs: the contribution inbox of the employer
// registry, employers/inbox/ (seeds/employers-inbox.mjs), as the validator
// (seeds/employers-validate.mjs) judges it.
//
// A contribution is one new file, employers/inbox/<date>-<login>[-NNN].ndjson,
// one short line per board, plus an optional manifest <date>-<login>.json. The
// cases pin the file names, the line format and its defaults, the 5,000-line
// limit, duplicates (an error inside the inbox, a warning against boards/) and
// the manifest checks.
//
// Run:  node --test tests/employers-inbox.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, copyEmployerRegistry } from './helpers.mjs';

import {
  DEFAULT_REGION, DEFAULT_WORKDAY_HOST, INBOX_DIR, INBOX_LINE_KEYS, INBOX_MAX_LINES,
  inboxCareersUrl, inboxLineToRow, parseInboxName,
} from '../seeds/employers-inbox.mjs';
import { ROW_KEYS, inboxLineProblems, renderStepSummary, validateRegistry } from '../seeds/employers-validate.mjs';

const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, ...PLAIN_ENV } = process.env;
const run = (cwd, args = [], env = {}) => spawnSync(process.execPath, [VALIDATOR, ...args], { cwd, encoding: 'utf8', env: { ...PLAIN_ENV, ...env } });

const DATE = '2026-11-10';
const TODAY = new Date('2026-11-11T12:00:00Z');

/** A scratch checkout with a copy of the real registry and the given inbox files. */
function withInbox(files, body) {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-inbox-'));
  try {
    copyEmployerRegistry(dir);
    mkdirSync(join(dir, INBOX_DIR), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const text = typeof content === 'string' ? content : `${content.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`;
      writeFileSync(join(dir, INBOX_DIR, name), text);
    }
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const validate = (dir) => validateRegistry({ root: dir, today: TODAY });
const at = (findings) => findings.map((f) => `${f.file.replace(`${INBOX_DIR}/`, '')}:${f.line}: ${f.message}`);

const NEW = [
  { ats: 'greenhouse', board: 'acmerobotics', name: 'Acme Robotics', website: 'acmerobotics.example' },
  { ats: 'lever', region: 'eu', board: 'eurocorp', name: 'Eurocorp' },
  { ats: 'ashby', board: 'NovaLabs', name: 'Nova Labs' },
  { ats: 'workday', board: 'acmeco/wd3/Careers', name: 'AcmeCo' },
  { ats: 'workday', board: 'bigco/wd1/External', workday_host: 'site', name: 'BigCo' },
  { ats: 'recruitee', board: 'tinyco', name: 'TinyCo' },
];

// ── File names ─────────────────────────────────────────────────────────────

test('parseInboxName: a boards file, its numbered parts and its manifest share one contribution id', () => {
  assert.deepEqual(parseInboxName('2026-11-10-octocat.ndjson'), { kind: 'boards', date: DATE, login: 'octocat', part: null, id: '2026-11-10-octocat' });
  assert.deepEqual(parseInboxName('2026-11-10-octo-cat-002.ndjson'), { kind: 'boards', date: DATE, login: 'octo-cat', part: 2, id: '2026-11-10-octo-cat' });
  assert.deepEqual(parseInboxName('2026-11-10-octo-cat.json'), { kind: 'sheet', date: DATE, login: 'octo-cat', part: null, id: '2026-11-10-octo-cat' });
});

test('parseInboxName: rejects what is not <date>-<login>[-NNN].ndjson or <date>-<login>.json', () => {
  for (const [name, why] of [
    ['2026-11-10-OctoCat.ndjson', /lowercase: 2026-11-10-octocat\.ndjson/],
    ['2026-02-30-octocat.ndjson', /not a YYYY-MM-DD calendar date/],
    ['2026-11-10-octocat-000.ndjson', /start at 001/],
    ['2026-11-10-octocat-01.ndjson', null], // two digits are not a part number: login "octocat-01"
    ['2026-11-10-octocat-.ndjson', /inbox files are named/],
    ['2026-11-10-octocat-001.json', null], // a manifest has no part number: login "octocat-001"
    ['2026-11-10-octocat.csv', /inbox files are named/],
    ['2026-11-10-octo--cat.ndjson', /inbox files are named/],
    ['2026-11-10-.ndjson', /inbox files are named/],
    ['octocat.ndjson', /inbox files are named/],
    ['README.md', /inbox files are named/],
  ]) {
    const r = parseInboxName(name);
    if (why === null) assert.ok(!('error' in r), `${name} should parse`);
    else assert.match(r.error || '', why, name);
  }
});

// ── Lines ──────────────────────────────────────────────────────────────────

test('an inbox line builds its careers URL with the default hosts', () => {
  assert.equal(DEFAULT_REGION, 'us');
  assert.equal(DEFAULT_WORKDAY_HOST, 'jobs');
  assert.equal(inboxCareersUrl(NEW[0]), 'https://job-boards.greenhouse.io/acmerobotics');
  assert.equal(inboxCareersUrl(NEW[1]), 'https://jobs.eu.lever.co/eurocorp');
  assert.equal(inboxCareersUrl(NEW[3]), 'https://acmeco.wd3.myworkdayjobs.com/Careers');
  assert.equal(inboxCareersUrl(NEW[4]), 'https://wd1.myworkdaysite.com/recruiting/bigco/External');
});

test('inboxLineToRow writes a full registry row, keys in the registry order', () => {
  const row = inboxLineToRow(NEW[0], { source: 'community', contribution: '2026-11-10-octocat', added: DATE });
  assert.deepEqual(row, {
    ats: 'greenhouse', region: 'us', board: 'acmerobotics', careers_url: 'https://job-boards.greenhouse.io/acmerobotics',
    name: 'Acme Robotics', website: 'acmerobotics.example', source: 'community', contribution: '2026-11-10-octocat', added: DATE,
  });
  const order = Object.keys(row).map((k) => ROW_KEYS.indexOf(k));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('inboxLineProblems: the short format and nothing else', () => {
  const agg = new Set(['jooble.org']);
  assert.deepEqual(INBOX_LINE_KEYS, ['ats', 'region', 'board', 'workday_host', 'name', 'website']);
  for (const line of NEW) assert.deepEqual(inboxLineProblems(line, agg), [], JSON.stringify(line));
  const cases = [
    [{ ats: 'ashby', board: 'acme', name: 'Acme', careers_url: 'x' }, /unknown key "careers_url"/],
    [{ ats: 'ashby', board: 'acme' }, /missing required key "name"/],
    [{ ats: 'dayforce', board: 'acme', name: 'Acme' }, /ats "dayforce" is not one of/],
    [{ ats: 'ashby', region: 'eu', board: 'acme', name: 'Acme' }, /region is only used on greenhouse and lever/],
    [{ ats: 'greenhouse', region: 'ap', board: 'acme', name: 'Acme' }, /region "ap" is not one of/],
    [{ ats: 'lever', workday_host: 'jobs', board: 'acme', name: 'Acme' }, /workday_host is only used on workday/],
    [{ ats: 'workday', workday_host: 'www', board: 'a/wd1/b', name: 'Acme' }, /workday_host "www" is not one of/],
    [{ ats: 'workday', board: 'acme', name: 'Acme' }, /workday board is "tenant\/wdN\/site"/],
    [{ ats: 'greenhouse', board: 'jobs', name: 'Acme' }, /placeholder/],
    [{ ats: 'recruitee', board: 'Acme', name: 'Acme' }, /lowercase/],
    [{ ats: 'ashby', board: 'acme', name: 'Jane jane@example.com' }, /email address/],
    [{ ats: 'ashby', board: 'acme', name: 'Acme +34 600 123 456' }, /phone number/],
    [{ ats: 'ashby', board: 'acme', name: 'Acme', website: 'https://acme.example' }, /bare domain/],
    [{ ats: 'ashby', board: 'acme', name: 'Acme', website: 'jooble.org' }, /aggregator/],
    [['ashby', 'acme'], /one JSON object/],
  ];
  for (const [line, why] of cases) {
    const problems = inboxLineProblems(line, agg);
    assert.ok(problems.some((p) => why.test(p)), `${JSON.stringify(line)}: ${problems.join(' | ')}`);
  }
});

// ── The inbox in the registry ─────────────────────────────────────────────

test('a valid inbox passes, with no warning, and the CLI reports it', () => withInbox({ [`${DATE}-octocat.ndjson`]: NEW }, (dir) => {
  const { errors, warnings, stats } = validate(dir);
  assert.deepEqual(at(errors), []);
  assert.deepEqual(at(warnings), []);
  assert.equal(stats.inboxFiles, 1);
  assert.equal(stats.inboxLines, NEW.length);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /inbox: 6 board\(s\) in 1 file\(s\), 0 already in the registry/);
}));

test('a pull request that only adds an inbox file passes --base against the registry it targets', () => withInbox({ [`${DATE}-octocat.ndjson`]: NEW }, (dir) => {
  const r = run(dir, ['--base', ROOT]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
}));

test('the registry without inbox/ is valid: the directory is optional', () => {
  const { errors } = validateRegistry({ root: ROOT, today: TODAY });
  assert.deepEqual(errors, []);
});

test('bad lines are errors on their own line, and the rest of the file is still read', () => withInbox({
  [`${DATE}-octocat.ndjson`]: [NEW[0], { ats: 'ashby', board: 'acme', name: 'Acme', tags: [] }, '', 'not json', NEW[2]],
}, (dir) => {
  const { errors } = validate(dir);
  assert.deepEqual(at(errors), [
    `${DATE}-octocat.ndjson:2: unknown key "tags"; an inbox line has only ats, region, board, workday_host, name, website`,
    `${DATE}-octocat.ndjson:3: blank line`,
    `${DATE}-octocat.ndjson:4: not valid JSON: ${(() => { try { JSON.parse('not json'); } catch (e) { return e.message; } })()}`,
  ]);
}));

test('file names, CRLF, a missing final newline, an empty file and a subdirectory are errors', () => withInbox({
  '2026-11-10-OctoCat.ndjson': [NEW[0]],
  [`${DATE}-crlf.ndjson`]: `${JSON.stringify(NEW[1])}\r\n`,
  [`${DATE}-nonewline.ndjson`]: JSON.stringify(NEW[2]),
  [`${DATE}-empty.ndjson`]: '',
  'boards.csv': 'x\n',
}, (dir) => {
  mkdirSync(join(dir, INBOX_DIR, 'nested'));
  const { errors } = validate(dir);
  const lines = at(errors);
  for (const want of [
    /^2026-11-10-OctoCat\.ndjson:0: .*lowercase/,
    /^boards\.csv:0: inbox files are named/,
    /^nested:0: inbox files are named/,
    /^2026-11-10-crlf\.ndjson:1: CRLF line ending/,
    /^2026-11-10-nonewline\.ndjson:1: the file must end with a newline/,
    /^2026-11-10-empty\.ndjson:0: empty file/,
  ]) assert.ok(lines.some((l) => want.test(l)), `${want}\n${lines.join('\n')}`);
  assert.equal(lines.length, 6, lines.join('\n'));
}));

test(`a file over ${INBOX_MAX_LINES} lines is an error that says how to split it`, () => {
  const many = Array.from({ length: INBOX_MAX_LINES + 1 }, (_, i) => ({ ats: 'ashby', board: `co${i}x`, name: `Company ${i}` }));
  withInbox({ [`${DATE}-bigorg.ndjson`]: many }, (dir) => {
    const { errors } = validate(dir);
    assert.deepEqual(at(errors), [
      `${DATE}-bigorg.ndjson:${INBOX_MAX_LINES + 1}: ${INBOX_MAX_LINES + 1} lines; an inbox file holds up to ${INBOX_MAX_LINES}: split the list into ${DATE}-bigorg-001.ndjson, ${DATE}-bigorg-002.ndjson, …`,
    ]);
  });
  // Exactly at the limit, and split in parts, it passes.
  withInbox({
    [`${DATE}-bigorg-001.ndjson`]: many.slice(0, INBOX_MAX_LINES),
    [`${DATE}-bigorg-002.ndjson`]: many.slice(INBOX_MAX_LINES),
  }, (dir) => {
    const { errors, stats } = validate(dir);
    assert.deepEqual(at(errors), []);
    assert.equal(stats.inboxLines, INBOX_MAX_LINES + 1);
  });
});

test('a board twice in the inbox is an error, in one file or across files, whatever its spelling', () => withInbox({
  [`${DATE}-alice.ndjson`]: [NEW[0], { ...NEW[0], name: 'Acme again' }, NEW[3]],
  [`${DATE}-bob.ndjson`]: [
    { ats: 'greenhouse', region: 'us', board: 'AcmeRobotics', name: 'Acme' },
    { ats: 'workday', workday_host: 'site', board: 'acmeco/wd3/Careers', name: 'AcmeCo' },
  ],
}, (dir) => {
  const { errors } = validate(dir);
  assert.deepEqual(at(errors), [
    `${DATE}-alice.ndjson:2: the same board as employers/inbox/${DATE}-alice.ndjson:1; list a board once`,
    `${DATE}-bob.ndjson:1: the same board as employers/inbox/${DATE}-alice.ndjson:1; list a board once`,
    `${DATE}-bob.ndjson:2: the same board as employers/inbox/${DATE}-alice.ndjson:3; list a board once`,
  ]);
}));

test('a board already in boards/ is one warning per file, never an error', () => {
  const known = [
    { ats: 'greenhouse', board: 'anthropic', name: 'Anthropic' },
    { ats: 'greenhouse', board: 'Airtable', name: 'Airtable' }, // letter case does not make it new
    { ats: 'workday', workday_host: 'site', board: 'nvidia/wd5/NVIDIAExternalCareerSite', name: 'NVIDIA' }, // nor the other host form
  ];
  withInbox({ [`${DATE}-octocat.ndjson`]: [NEW[0], ...known] }, (dir) => {
    const { errors, warnings, stats } = validate(dir);
    assert.deepEqual(errors, []);
    assert.deepEqual(at(warnings), [
      `${DATE}-octocat.ndjson:2: 3 boards are already in the registry and will be skipped when the inbox is folded in (lines 2, 3, 4)`,
    ]);
    assert.equal(stats.inboxKnown, 3);
  });
});

test('a date in the future is an error', () => withInbox({ '2099-01-01-octocat.ndjson': [NEW[0]] }, (dir) => {
  assert.deepEqual(at(validate(dir).errors), ['2099-01-01-octocat.ndjson:0: the date in the file name, 2099-01-01, is in the future']);
}));

// ── An organization's manifest ─────────────────────────────────────────────

const sheet = (over = {}) => JSON.stringify({
  id: `${DATE}-acme-hr`, contributor: 'Acme-HR', on_behalf_of: 'Acme Inc.', signed_by: 'A founder of Acme',
  rows: 3, source: 'employer-list:acme', origin: 'The employer pages Acme keeps for its own job search product.',
  no_conflicting_contract: true, personal_data: false, exclusive: false, license: 'CC-BY-4.0',
  also_permits: ['ODbL-1.0', 'CC0-1.0'], attribution: 'Employer pages contributed by Acme', date: DATE, ...over,
}, null, 2);

test('a manifest next to its parts passes when rows counts every line of every part', () => withInbox({
  [`${DATE}-acme-hr-001.ndjson`]: NEW.slice(0, 2),
  [`${DATE}-acme-hr-002.ndjson`]: NEW.slice(2, 3),
  [`${DATE}-acme-hr.json`]: sheet(),
}, (dir) => {
  const { errors, stats } = validate(dir);
  assert.deepEqual(at(errors), []);
  assert.equal(stats.inboxFiles, 3);
}));

test('a manifest is checked like contributions/, plus its rows and its login', () => withInbox({
  [`${DATE}-acme-hr.ndjson`]: NEW.slice(0, 2),
  [`${DATE}-acme-hr.json`]: sheet({ contributor: 'someone-else', license: 'MIT', personal_data: true }),
  [`${DATE}-orphan.json`]: sheet({ id: `${DATE}-orphan`, contributor: 'orphan', rows: 1 }),
}, (dir) => {
  const lines = at(validate(dir).errors);
  for (const want of [
    `${DATE}-acme-hr.json:0: rows is 3, but 2 line(s) are in its inbox files`,
    `${DATE}-acme-hr.json:0: license must be "CC-BY-4.0"`,
    `${DATE}-acme-hr.json:0: personal_data must be false: the registry holds no personal data`,
    `${DATE}-acme-hr.json:0: contributor "someone-else" is not the login in the file name (acme-hr)`,
    `${DATE}-orphan.json:0: a manifest with no boards: add ${DATE}-orphan.ndjson (or ${DATE}-orphan-001.ndjson, …) next to it`,
    `${DATE}-orphan.json:0: rows is 1, but 0 line(s) are in its inbox files`,
  ]) assert.ok(lines.includes(want), `missing: ${want}\n${lines.join('\n')}`);
  assert.equal(lines.length, 6, lines.join('\n'));
}));

// ── GitHub Actions output ─────────────────────────────────────────────────

test('in GitHub Actions, inbox errors are annotations and the summary counts the inbox', () => withInbox({
  [`${DATE}-octocat.ndjson`]: [NEW[0], { ats: 'ashby', board: 'acme', name: 'Acme', foo: 1 }, { ats: 'greenhouse', board: 'anthropic', name: 'Anthropic' }],
}, (dir) => {
  const summary = join(dir, 'summary.md');
  const r = run(dir, [], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes(`::error file=employers/inbox/${DATE}-octocat.ndjson,line=2::unknown key "foo"`), r.stdout);
  assert.ok(r.stdout.includes(`::warning file=employers/inbox/${DATE}-octocat.ndjson,line=3::1 board is already in the registry`), r.stdout);
  assert.match(readFileSync(summary, 'utf8'), /\*\*Failed\*\*: 1 error, 1 warning\./);
}));

test('the step summary of a valid registry with an inbox says how many boards wait in it', () => {
  const md = renderStepSummary({ errors: [], warnings: [], stats: { rows: 53, files: 37, contributions: 1, inboxFiles: 2, inboxLines: 7, inboxKnown: 1 } });
  assert.ok(md.includes('Inbox: 7 boards in 2 files, 1 already in the registry.'), md);
  const none = renderStepSummary({ errors: [], warnings: [], stats: { rows: 53, files: 37, contributions: 1, inboxFiles: 0, inboxLines: 0, inboxKnown: 0 } });
  assert.ok(!none.includes('Inbox'), none);
});
