// tests/employers-registry.test.mjs: the employer registry in employers/
// and its validator (seeds/employers-validate.mjs).
//
// Four groups:
//   1. The real registry passes, and every row is one its provider can read.
//   2. A synthetic registry full of known mistakes
//      (tests/fixtures/employers-garbage/) fails, naming each one by file, line
//      and reason, and nothing else.
//   3. schema.json (for editors) and the validator (the gate) state the same
//      format.
//   4. --base: what a pull request may change relative to the base branch, the
//      size warning, and the generated CHANGELOG.
//   5. GitHub Actions output: ::error/::warning annotations and the step
//      summary, only when GITHUB_ACTIONS is true.
//
// Run:  node --test tests/employers-registry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

import { BOARD_ATS, REGIONAL_BOARD_URL_BUILDERS, REGIONS, WORKDAY_HOSTS } from '../lib/ats-board-url.mjs';
import {
  ALSO_PERMITS, DOMAIN_RE, FIXED_SOURCES, GITHUB_LOGIN_RE, LICENSE_ID, MANIFEST_ID_RE, MANIFEST_KEYS,
  MANIFEST_REQUIRED, NAME_MAX, RETIRED_REASONS, ROW_KEYS, ROW_REQUIRED, SOURCE_PATTERNS,
  BOARDS_WARN_BYTES, SUMMARY_MAX_FINDINGS, annotation, compareRows, escapeCommandData, escapeCommandProperty,
  renderChangelog, renderStepSummary, validateRegistry, writeChangelog,
} from '../seeds/employers-validate.mjs';

import greenhouse from '../providers/greenhouse.mjs';
import ashby from '../providers/ashby.mjs';
import lever from '../providers/lever.mjs';
import workable from '../providers/workable.mjs';
import smartrecruiters from '../providers/smartrecruiters.mjs';
import rippling from '../providers/rippling.mjs';
import joinProvider from '../providers/join.mjs';
import recruitee from '../providers/recruitee.mjs';
import breezy from '../providers/breezy.mjs';
import bamboohr from '../providers/bamboohr.mjs';
import pinpoint from '../providers/pinpoint.mjs';
import workday from '../providers/workday.mjs';

const PROVIDERS = {
  greenhouse, ashby, lever, workable, smartrecruiters, rippling, join: joinProvider,
  recruitee, breezy, bamboohr, pinpoint, workday,
};

const VALIDATOR = join(ROOT, 'seeds', 'employers-validate.mjs');
const REGISTRY = join(ROOT, 'employers');
const GARBAGE = join(ROOT, 'tests', 'fixtures', 'employers-garbage');

// The suite itself runs in GitHub Actions, so the validator's environment is
// set explicitly: plain output unless a case asks for the Actions one.
const { GITHUB_ACTIONS: _ga, GITHUB_STEP_SUMMARY: _gss, ...PLAIN_ENV } = process.env;
const run = (cwd, args = [], env = {}) => spawnSync(process.execPath, [VALIDATOR, ...args], { cwd, encoding: 'utf8', env: { ...PLAIN_ENV, ...env } });

/** Every row in a registry directory, parsed. */
function rowsOf(dir) {
  const out = [];
  for (const ats of readdirSync(join(dir, 'boards'))) {
    for (const f of readdirSync(join(dir, 'boards', ats))) {
      for (const line of readFileSync(join(dir, 'boards', ats, f), 'utf8').split('\n').filter(Boolean)) {
        out.push({ file: `${ats}/${f}`, row: JSON.parse(line) });
      }
    }
  }
  return out;
}

/** A scratch checkout holding a copy of the real registry. */
function checkout() {
  const dir = mkdtempSync(join(tmpdir(), 'co-employers-'));
  cpSync(REGISTRY, join(dir, 'employers'), { recursive: true });
  return dir;
}
const reg = (dir, ...p) => join(dir, 'employers', ...p);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** Replace one row (found by careers_url) in a registry copy. */
function editRow(dir, careersUrl, edit) {
  const hit = rowsOf(reg(dir)).find((r) => r.row.careers_url === careersUrl);
  assert.ok(hit, `row ${careersUrl} not found`);
  const path = reg(dir, 'boards', hit.file);
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => {
    const row = JSON.parse(l);
    if (row.careers_url !== careersUrl) return l;
    const next = edit(row);
    return next === null ? null : JSON.stringify(next);
  }).filter((l) => l !== null);
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '');
}

// ── 1. The real registry ──────────────────────────────────────────────────

test('the committed registry passes the validator', () => {
  const r = run(ROOT);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /employer registry is valid: \d+ rows/);
  assert.equal(r.stderr, '', 'no warnings either');
});

test('the committed registry passes against itself as the base (a PR that changes nothing)', () => {
  const r = run(ROOT, ['--base', '.']);
  assert.equal(r.status, 0, r.stderr);
});

test('every committed row is read by its own provider', () => {
  const rows = rowsOf(REGISTRY);
  assert.ok(rows.length >= 40, `expected the first hand-picked boards, found ${rows.length}`);
  for (const { file, row } of rows) {
    const detected = PROVIDERS[row.ats].detect({ name: row.name, careers_url: row.careers_url });
    assert.ok(detected, `${file}: ${row.ats}.detect() rejects ${row.careers_url}`);
  }
});

// ── 2. The garbage fixture ─────────────────────────────────────────────────

const B = 'employers/boards';
const BAD = 'employers/contributions/2026-11-02-bad.json';
const EXPECTED = [
  ['employers/notes.txt', 'unexpected entry'],
  ['employers/THIRD_PARTY_NOTICES.md', 'missing'],
  ['employers/contributions/notes.txt', 'manifests are named <YYYY-MM-DD>-<slug>.json'],
  [BAD, 'unknown key "notes"'],
  [BAD, 'id "2026-11-02-other" does not match the file name'],
  [BAD, 'contributor must be the GitHub username'],
  [BAD, 'origin contains an email address'],
  [BAD, 'rows is 7, but 1 row(s) name this contribution'],
  [BAD, 'personal_data must be false'],
  [BAD, 'license must be "CC-BY-4.0"'],
  [BAD, 'also_permits must be'],
  [BAD, 'date 2026-11-03 does not match the date in the id'],
  [`${B}/dayforce`, 'unknown ATS directory'],
  [`${B}/lever/readme.txt`, 'board files are named <initial>.ndjson'],
  [`${B}/greenhouse/a.ndjson:2`, 'duplicate careers_url, already at employers/boards/greenhouse/a.ndjson:1'],
  [`${B}/greenhouse/a.ndjson:3`, 'region "ap" is not one of: us, eu'],
  [`${B}/greenhouse/a.ndjson:4`, 'region is required on greenhouse rows'],
  [`${B}/greenhouse/a.ndjson:5`, 'is not the canonical URL for this board; expected "https://job-boards.greenhouse.io/acme-wrongurl"'],
  [`${B}/greenhouse/a.ndjson:6`, 'name contains an email address'],
  [`${B}/greenhouse/a.ndjson:7`, 'name contains a phone number'],
  [`${B}/greenhouse/a.ndjson:8`, 'website "jooble.org" is an aggregator'],
  [`${B}/greenhouse/a.ndjson:9`, 'unknown key "foo"'],
  [`${B}/greenhouse/a.ndjson:10`, 'source "scraped" is not one of'],
  [`${B}/greenhouse/a.ndjson:11`, 'contribution "2026-10-31-missing" has no manifest'],
  [`${B}/greenhouse/a.ndjson:12`, 'out of order'],
  [`${B}/greenhouse/a.ndjson:13`, 'a retired row needs retired_reason'],
  [`${B}/greenhouse/a.ndjson:14`, 'blank line'],
  [`${B}/greenhouse/a.ndjson:15`, 'not valid JSON'],
  [`${B}/greenhouse/a.ndjson:16`, 'name contains an @handle'],
  [`${B}/greenhouse/b.ndjson:1`, 'ats "lever" is filed under boards/greenhouse/'],
  [`${B}/greenhouse/b.ndjson:2`, 'belongs in c.ndjson, not b.ndjson'],
  [`${B}/greenhouse/1.ndjson:1`, 'board "12345" is numeric-only'],
  [`${B}/ashby/f.ndjson:2`, 'differs only in letter case'],
  [`${B}/ashby/j.ndjson:1`, 'board "j@nk!" has characters outside'],
  [`${B}/ashby/j.ndjson:2`, 'board "jobs" is a placeholder'],
  [`${B}/ashby/j.ndjson:3`, 'region is only used on greenhouse and lever rows'],
  [`${B}/ashby/j.ndjson:4`, 'board is 71 characters long; the limit is 64'],
  [`${B}/recruitee/u.ndjson:1`, 'recruitee boards are lowercase'],
  [`${B}/workday/w.ndjson:1`, 'workday_host is required on workday rows'],
  [`${B}/workday/w.ndjson:2`, 'workday site "en-US" is a locale'],
  [`${B}/workday/w.ndjson:4`, 'workday instance "w5"'],
  [`${B}/lever/e.ndjson:2`, 'added 2099-01-01 is in the future'],
  [`${B}/lever/e.ndjson:3`, 'tags are not accepted yet'],
  [`${B}/lever/e.ndjson:4`, 'must be a bare domain'],
  [`${B}/lever/e.ndjson:5`, 'not ISO 3166-1 alpha-2'],
  [`${B}/lever/e.ndjson:6`, 'retired_reason "bored" is not one of'],
  [`${B}/lever/e.ndjson:6`, 'retired_reason needs retired: true'],
  [`${B}/lever/s.ndjson:1`, `source "vc-portfolio" differs from its manifest's source "community"`],
];

test('the garbage fixture fails, naming each planted mistake by file, line and reason', () => {
  const r = run(GARBAGE);
  assert.equal(r.status, 1, r.stdout);
  const errorLines = r.stderr.split('\n').filter((l) => l.startsWith('employers'));
  for (const [where, reason] of EXPECTED) {
    assert.ok(errorLines.some((l) => l.startsWith(`${where}: `) && l.includes(reason)), `missing: ${where}: ${reason}\n${r.stderr}`);
  }
  // Nothing but the planted mistakes: the valid rows next to them stay quiet.
  assert.equal(errorLines.length, EXPECTED.length, r.stderr);
  assert.match(r.stderr, new RegExp(`employer registry: ${EXPECTED.length} error\\(s\\), 1 warning\\(s\\)`));
  assert.ok(!r.stdout.includes('::') && !r.stderr.includes('::'), 'no workflow commands outside GitHub Actions');
});

test('a website on two rows is a warning, not an error', () => {
  const { warnings } = validateRegistry({ root: GARBAGE });
  assert.deepEqual(warnings.map((w) => `${w.file}:${w.line}`), [`${B}/lever/e.ndjson:2`]);
  assert.match(warnings[0].message, /website "euco.example" is also on/);
});

// ── 3. schema.json states the validator's format ──────────────────────────

const schema = readJson(join(REGISTRY, 'schema.json'));
const { row: rowSchema, manifest: manifestSchema, source: sourceSchema } = schema.$defs;
const sorted = (a) => [...a].sort();

test('schema.json: row keys, required keys and closed lists match the validator', () => {
  assert.equal(rowSchema.additionalProperties, false);
  assert.deepEqual(sorted(Object.keys(rowSchema.properties)), sorted(ROW_KEYS));
  assert.deepEqual(sorted(rowSchema.required), sorted(ROW_REQUIRED));
  assert.deepEqual(rowSchema.properties.ats.enum, [...BOARD_ATS]);
  assert.deepEqual(rowSchema.properties.region.enum, [...REGIONS]);
  assert.deepEqual(rowSchema.properties.workday_host.enum, [...WORKDAY_HOSTS]);
  assert.deepEqual(rowSchema.properties.retired_reason.enum, [...RETIRED_REASONS]);
  assert.equal(rowSchema.properties.name.maxLength, NAME_MAX);
  assert.equal(new RegExp(rowSchema.properties.website.pattern).source, DOMAIN_RE.source);
  // The regional ATS (region required) are the ones with regional URL builders.
  assert.deepEqual(sorted(rowSchema.allOf[0].if.properties.ats.enum), sorted(Object.keys(REGIONAL_BOARD_URL_BUILDERS)));
});

test('schema.json: manifest keys, required keys and license terms match the validator', () => {
  assert.equal(manifestSchema.additionalProperties, false);
  assert.deepEqual(sorted(Object.keys(manifestSchema.properties)), sorted(MANIFEST_KEYS));
  assert.deepEqual(sorted(manifestSchema.required), sorted(MANIFEST_REQUIRED));
  assert.equal(manifestSchema.properties.license.const, LICENSE_ID);
  assert.deepEqual(sorted(manifestSchema.properties.also_permits.items.enum), sorted(ALSO_PERMITS));
  assert.equal(manifestSchema.properties.no_conflicting_contract.const, true);
  assert.equal(manifestSchema.properties.personal_data.const, false);
  assert.equal(manifestSchema.properties.exclusive.const, false);
  assert.equal(new RegExp(manifestSchema.properties.contributor.pattern).source, GITHUB_LOGIN_RE.source);
});

test('schema.json: the source list matches the validator', () => {
  assert.deepEqual(sourceSchema.anyOf[0].enum, [...FIXED_SOURCES]);
  assert.deepEqual(sourceSchema.anyOf.slice(1).map((s) => new RegExp(s.pattern).source), Object.values(SOURCE_PATTERNS).map((re) => re.source));
});

test('schema.json: the manifest id pattern accepts and rejects what the validator does', () => {
  const idPatterns = [manifestSchema.properties.id.pattern, rowSchema.properties.contribution.pattern].map((p) => new RegExp(p));
  const samples = ['2026-11-08-santifer', '2026-11-20-acme', '2026-11-20-a', '2026-11-20-Acme', '2026-11-20-', '2026-11-20-acme-', '26-11-20-acme', '2026-11-20-acme_co'];
  for (const s of samples) {
    for (const re of idPatterns) assert.equal(re.test(s), MANIFEST_ID_RE.test(s), s);
  }
});

// ── 4. Pull-request rules (--base), the size limit, the CHANGELOG ─────────

const NEW_MANIFEST = {
  id: '2026-11-09-newcomer', contributor: 'newcomer', signed_by: 'New Comer', rows: 1, source: 'community',
  origin: 'Typed in by hand from the employer careers page.', no_conflicting_contract: true, personal_data: false,
  exclusive: false, license: 'CC-BY-4.0', also_permits: ['ODbL-1.0', 'CC0-1.0'], attribution: 'Newcomer', date: '2026-11-09',
};
const NEW_ROW = {
  ats: 'breezy', board: 'fixture-co', careers_url: 'https://fixture-co.breezy.hr', name: 'Fixture Co',
  source: 'community', contribution: '2026-11-09-newcomer', added: '2026-11-09',
};
function addContribution(dir, row = NEW_ROW) {
  writeJson(reg(dir, 'contributions', `${NEW_MANIFEST.id}.json`), NEW_MANIFEST);
  mkdirSync(reg(dir, 'boards', 'breezy'), { recursive: true });
  writeFileSync(reg(dir, 'boards', 'breezy', 'f.ndjson'), `${JSON.stringify(row)}\n`);
  // No CHANGELOG.md edit: a contribution does not touch it.
}
const firstRow = () => rowsOf(REGISTRY)[0].row;

/** Run one PR scenario: base is the real registry, head is a copy changed by `change`. */
function pr(change) {
  const head = checkout();
  try {
    change(head);
    return run(head, ['--base', ROOT]);
  } finally {
    rmSync(head, { recursive: true, force: true });
  }
}

test('--base: a contribution with its own manifest passes, without touching CHANGELOG.md', () => {
  const r = pr((head) => {
    addContribution(head);
    assert.equal(readFileSync(reg(head, 'CHANGELOG.md'), 'utf8'), readFileSync(join(REGISTRY, 'CHANGELOG.md'), 'utf8'));
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'no warnings either');
});

test('--base: a base with no registry (the bootstrap PR) counts every row as new', () => {
  const empty = mkdtempSync(join(tmpdir(), 'co-employers-base-'));
  try {
    const r = run(ROOT, ['--base', empty]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /counts as new/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('--base: a deleted row fails; rows are retired, never deleted', () => {
  const r = pr((head) => {
    const victim = firstRow();
    editRow(head, victim.careers_url, () => null);
    const m = readJson(reg(head, 'contributions', `${victim.contribution}.json`));
    writeJson(reg(head, 'contributions', `${victim.contribution}.json`), { ...m, rows: m.rows - 1 });
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /was removed; rows are retired \(retired: true, retired_reason\), never deleted/);
});

test('--base: a new row on an already merged manifest fails', () => {
  const r = pr((head) => {
    const id = firstRow().contribution;
    const m = readJson(reg(head, 'contributions', `${id}.json`));
    writeJson(reg(head, 'contributions', `${id}.json`), { ...m, rows: m.rows + 1 });
    mkdirSync(reg(head, 'boards', 'breezy'), { recursive: true });
    writeFileSync(reg(head, 'boards', 'breezy', 'f.ndjson'), `${JSON.stringify({ ...NEW_ROW, contribution: id, added: m.date })}\n`);
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /which is already merged; new rows come with their own manifest/);
  assert.match(r.stderr, /warning: .*edits a manifest that is already merged/);
});

test('--base: a contribution cannot retire an existing row', () => {
  const r = pr((head) => {
    addContribution(head);
    editRow(head, firstRow().careers_url, (row) => ({ ...row, retired: true, retired_reason: 'gone' }));
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a contribution pull request \(it adds a manifest\) cannot change retired or retired_reason/);
});

test('--base: a maintainer change that only retires a row passes', () => {
  const r = pr((head) => editRow(head, firstRow().careers_url, (row) => ({ ...row, retired: true, retired_reason: 'owner_request' })));
  assert.equal(r.status, 0, r.stderr);
});

test('--base: a new row cannot arrive retired', () => {
  const r = pr((head) => addContribution(head, { ...NEW_ROW, retired: true, retired_reason: 'gone' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a new row cannot be retired/);
});

test('--base: the provenance of an existing row is fixed', () => {
  const r = pr((head) => editRow(head, firstRow().careers_url, (row) => ({ ...row, added: '2026-11-09' })));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /changes added of an existing row \(was "\d{4}-\d{2}-\d{2}"\); provenance is fixed once merged/);
});

// A second spelling of a merged board fails on the newcomer, wherever it sorts.
// Workday's API answers any letter case, so the registry stores the case of the
// careers page's canonical link; CrowdStrike's is all lowercase, which makes an
// uppercase newcomer sort BEFORE the merged row.
const CROWDSTRIKE = 'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers';
const GUIDEWIRE = 'https://wd5.myworkdaysite.com/recruiting/guidewire/external';

/** Add one Workday row under a new manifest and return the file's lines, sorted as the format requires. */
function addWorkdayVariant(dir, board, workdayHost) {
  const row = {
    ats: 'workday', board, workday_host: workdayHost,
    careers_url: workdayHost === 'jobs'
      ? `https://${board.split('/')[0]}.${board.split('/')[1]}.myworkdayjobs.com/${board.split('/')[2]}`
      : `https://${board.split('/')[1]}.myworkdaysite.com/recruiting/${board.split('/')[0]}/${board.split('/')[2]}`,
    name: 'Variant', source: 'community', contribution: NEW_MANIFEST.id, added: NEW_MANIFEST.date,
  };
  writeJson(reg(dir, 'contributions', `${NEW_MANIFEST.id}.json`), NEW_MANIFEST);
  const path = reg(dir, 'boards', 'workday', `${board[0]}.ndjson`);
  const rows = [...readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), row];
  rows.sort(compareRows);
  writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return rows.map((r) => r.careers_url);
}

test('the committed Workday rows keep the case of the careers page canonical link', () => {
  const workdayRows = rowsOf(REGISTRY).filter((r) => r.row.ats === 'workday').map((r) => r.row);
  assert.ok(workdayRows.some((r) => r.workday_host === 'jobs') && workdayRows.some((r) => r.workday_host === 'site'), 'both host forms');
  assert.ok(workdayRows.some((r) => r.board === 'nvidia/wd5/NVIDIAExternalCareerSite'));
  assert.ok(workdayRows.some((r) => r.careers_url === CROWDSTRIKE));
});

test('--base: a letter-case variant of a merged board fails on the new row, even when it sorts first', () => {
  const head = checkout();
  try {
    const order = addWorkdayVariant(head, 'crowdstrike/wd5/CrowdStrikeCareers', 'jobs');
    const newLine = order.indexOf('https://crowdstrike.wd5.myworkdayjobs.com/CrowdStrikeCareers') + 1;
    const keptLine = order.indexOf(CROWDSTRIKE) + 1;
    assert.ok(newLine < keptLine, 'the variant sorts before the merged row');
    const r = run(head, ['--base', ROOT]);
    assert.equal(r.status, 1);
    const file = 'employers/boards/workday/c.ndjson';
    assert.match(r.stderr, new RegExp(`${file}:${newLine}: careers_url differs only in letter case from ${file}:${keptLine}, which is already merged and keeps its spelling`));
    assert.ok(!r.stderr.includes(`${file}:${keptLine}: `), `the merged row must not be the one reported:\n${r.stderr}`);
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('--base: a merged Workday board added again under the other host form fails on the new row', () => {
  const head = checkout();
  try {
    const order = addWorkdayVariant(head, 'guidewire/wd5/external', 'jobs');
    const newLine = order.indexOf('https://guidewire.wd5.myworkdayjobs.com/external') + 1;
    const keptLine = order.indexOf(GUIDEWIRE) + 1;
    const r = run(head, ['--base', ROOT]);
    assert.equal(r.status, 1);
    const file = 'employers/boards/workday/g.ndjson';
    assert.match(r.stderr, new RegExp(`${file}:${newLine}: the same Workday board as ${file}:${keptLine}, which is already merged and keeps its spelling, under the other host form`));
    assert.ok(!r.stderr.includes(`${file}:${keptLine}: `), r.stderr);
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('boards/ has no hard size limit: above 25 MB it is a warning, never an error', () => {
  assert.equal(BOARDS_WARN_BYTES, 25 * 1024 * 1024);
  const head = checkout();
  try {
    // One oversized row: its name is an error of its own, but the size is only a warning.
    mkdirSync(reg(head, 'boards', 'breezy'), { recursive: true });
    writeFileSync(reg(head, 'boards', 'breezy', 'f.ndjson'), `${JSON.stringify({ ...NEW_ROW, name: 'x'.repeat(BOARDS_WARN_BYTES) })}\n`);
    const { errors, warnings } = validateRegistry({ root: head });
    assert.ok(warnings.some((w) => w.file === 'employers/boards' && /^boards\/ is 25\.\d+ MB, above 25 MB/.test(w.message)), JSON.stringify(warnings));
    assert.deepEqual(errors.filter((e) => e.file === 'employers/boards'), [], 'the size is never an error');
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('boards/ under the warning size is quiet, and the threshold is the only trigger', () => {
  const quiet = validateRegistry({ root: ROOT });
  assert.deepEqual(quiet.warnings, []);
  const tight = validateRegistry({ root: ROOT, boardsWarnBytes: 1024 });
  assert.deepEqual(tight.errors, []);
  assert.deepEqual(tight.warnings.map((w) => w.file), ['employers/boards']);
});

test('CHANGELOG.md is generated by --write-changelog and not compared with the manifests', () => {
  const manifests = readdirSync(join(REGISTRY, 'contributions')).map((f) => readJson(join(REGISTRY, 'contributions', f)));
  for (const m of manifests) assert.ok(renderChangelog(manifests).includes(`\`${m.id}\` (${m.rows} boards, source \`${m.source}\`): ${m.attribution}`));

  const head = checkout();
  try {
    writeFileSync(reg(head, 'CHANGELOG.md'), '# edited by hand\n');
    const stale = run(head);
    assert.equal(stale.status, 0, stale.stderr);
    assert.equal(stale.stderr, '', 'a stale CHANGELOG.md is neither an error nor a warning');
    const r = run(head, ['--write-changelog']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(reg(head, 'CHANGELOG.md'), 'utf8'), renderChangelog(manifests));
    // writeChangelog() is what --write-changelog calls.
    writeFileSync(reg(head, 'CHANGELOG.md'), '');
    writeChangelog(head);
    assert.equal(readFileSync(reg(head, 'CHANGELOG.md'), 'utf8'), renderChangelog(manifests));
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('the CLI rejects unknown arguments and a missing --base directory with exit 2', () => {
  assert.equal(run(ROOT, ['--nope']).status, 2);
  assert.equal(run(ROOT, ['--base', join(tmpdir(), 'co-employers-does-not-exist')]).status, 2);
});

// ── 5. GitHub Actions output ──────────────────────────────────────────────

test('annotation(): one workflow command per finding, escaped as the runner expects', () => {
  assert.equal(
    annotation('error', { file: 'employers/boards/greenhouse/a.ndjson', line: 2, message: 'duplicate careers_url' }),
    '::error file=employers/boards/greenhouse/a.ndjson,line=2::duplicate careers_url',
  );
  // A finding about a whole file or directory (line 0) carries no line.
  assert.equal(annotation('warning', { file: 'employers/boards', line: 0, message: 'big' }), '::warning file=employers/boards::big');
  // Message: %, CR and LF. Property: those plus ":" and ",".
  assert.equal(escapeCommandData('100% done\r\nnext: a,b'), '100%25 done%0D%0Anext: a,b');
  assert.equal(escapeCommandProperty('a%b:c,d\n'), 'a%25b%3Ac%2Cd%0A');
  assert.equal(
    annotation('error', { file: 'employers/x,y:z.ndjson', line: 1, message: 'line one\nline two 50%' }),
    '::error file=employers/x%2Cy%3Az.ndjson,line=1::line one%0Aline two 50%25',
  );
});

test('in GitHub Actions, the garbage fixture fails with one ::error per finding and a step summary', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'co-employers-summary-'));
  const summary = join(tmp, 'summary.md');
  try {
    const r = run(GARBAGE, [], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.status, 1, r.stderr);
    const errorCommands = r.stdout.split('\n').filter((l) => l.startsWith('::error '));
    const warningCommands = r.stdout.split('\n').filter((l) => l.startsWith('::warning '));
    assert.equal(errorCommands.length, EXPECTED.length, r.stdout);
    assert.equal(warningCommands.length, 1, r.stdout);
    assert.ok(errorCommands.includes('::error file=employers/boards/greenhouse/a.ndjson,line=2::duplicate careers_url, already at employers/boards/greenhouse/a.ndjson:1'), r.stdout);
    assert.ok(errorCommands.includes('::error file=employers/notes.txt::unexpected entry; the registry holds only README.md, LICENSE, THIRD_PARTY_NOTICES.md, CHANGELOG.md, schema.json, contributions, boards, inbox'), r.stdout);
    assert.match(warningCommands[0], /^::warning file=employers\/boards\/lever\/e\.ndjson,line=2::website "euco\.example" is also on /);
    // The plain per-finding lines are not repeated; the closing count stays.
    assert.ok(!r.stderr.split('\n').some((l) => l.startsWith('employers/') || l.startsWith('warning: ')), r.stderr);
    assert.match(r.stderr, new RegExp(`employer registry: ${EXPECTED.length} error\\(s\\), 1 warning\\(s\\)`));

    const md = readFileSync(summary, 'utf8');
    assert.match(md, /^## Employer registry\n/);
    assert.ok(md.includes(`**Failed**: ${EXPECTED.length} errors, 1 warning.`), md);
    const tableRows = md.split('\n').filter((l) => /^\| (error|warning) \|/.test(l));
    assert.equal(tableRows.length, Math.min(EXPECTED.length + 1, SUMMARY_MAX_FINDINGS));
    assert.ok(tableRows.some((l) => l.startsWith('| error | employers/boards/greenhouse/a.ndjson | 2 | duplicate careers\\_url')), md);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('in GitHub Actions, a valid registry passes with no ::error and a summary of what it checked', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'co-employers-summary-'));
  const summary = join(tmp, 'summary.md');
  try {
    writeFileSync(summary, '# an earlier step\n');
    const r = run(ROOT, [], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('::error') && !r.stdout.includes('::warning'), r.stdout);
    const md = readFileSync(summary, 'utf8');
    assert.ok(md.startsWith('# an earlier step\n## Employer registry\n'), 'the summary is appended, not overwritten');
    assert.match(md, /\*\*Valid\*\*: \d+ rows in \d+ files, 1 contribution; 0 errors, 0 warnings\./);
    assert.ok(!md.includes('| Level |'), 'no table without findings');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('in GitHub Actions without GITHUB_STEP_SUMMARY, annotations still print and nothing breaks', () => {
  const r = run(GARBAGE, [], { GITHUB_ACTIONS: 'true' });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.split('\n').filter((l) => l.startsWith('::error ')).length === EXPECTED.length, r.stdout);
  assert.ok(!r.stderr.includes('could not write the step summary'), r.stderr);
});

test('GITHUB_ACTIONS other than "true" keeps the plain output', () => {
  const r = run(GARBAGE, [], { GITHUB_ACTIONS: 'false' });
  assert.equal(r.status, 1);
  assert.ok(!r.stdout.includes('::'), r.stdout);
  assert.ok(r.stderr.split('\n').some((l) => l.startsWith('employers/boards/greenhouse/a.ndjson:2: duplicate careers_url')), r.stderr);
});

test('the step summary lists the first findings only, errors first, and makes registry text inert', () => {
  const errors = Array.from({ length: SUMMARY_MAX_FINDINGS + 5 }, (_, i) => ({ file: 'employers/boards/ashby/a.ndjson', line: i + 1, message: `bad ${i}` }));
  const warnings = [{ file: 'employers/boards/ashby/b.ndjson', line: 1, message: 'a | pipe, <b>html</b> and `code`\nsecond line' }];
  const md = renderStepSummary({ errors, warnings, stats: { rows: 0, files: 0, contributions: 0 } });
  const rows = md.split('\n').filter((l) => /^\| (error|warning) \|/.test(l));
  assert.equal(rows.length, SUMMARY_MAX_FINDINGS);
  assert.ok(rows.every((l) => l.startsWith('| error |')), 'errors come before warnings');
  assert.ok(md.includes(`**Failed**: ${errors.length} errors, 1 warning.`));
  assert.ok(md.includes('6 more in the job log.'), md);

  const one = renderStepSummary({ errors: [], warnings, stats: { rows: 1, files: 1, contributions: 1 } });
  const row = one.split('\n').find((l) => l.startsWith('| warning |'));
  assert.equal(row, '| warning | employers/boards/ashby/b.ndjson | 1 | a \\| pipe, \\<b\\>html\\</b\\> and \\`code\\` second line |');
  assert.ok(one.includes('**Valid**: 1 row in 1 file, 1 contribution; 0 errors, 1 warning.'), one);
});
