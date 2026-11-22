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
//   4. GitHub Actions output: ::error/::warning annotations and the step
//      summary, only when GITHUB_ACTIONS is true.
//
// What a pull request may change (--base), the subdomain ATS and own-domain
// careers sites have suites of their own; tests/employers-registry-helpers.mjs
// says why.
//
// Run:  node --test tests/employers-registry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { resolveProvider } from '../providers/_registry.mjs';
import {
  BOARD_ATS, DNS_LABEL_ATS, OWN_DOMAIN_ATS, OPTIONAL_REGION_BOARD_URL_BUILDERS, REGIONAL_BOARD_URL_BUILDERS, REGIONS,
  SUBDOMAIN_LABEL_RE, WORKDAY_HOSTS, buildBoardUrl, regionsOf,
} from '../lib/ats-board-url.mjs';
import {
  ALSO_PERMITS, DOMAIN_RE, FIXED_SOURCES, GITHUB_LOGIN_RE, LICENSE_ID, MANIFEST_ID_RE, MANIFEST_KEYS,
  MANIFEST_REQUIRED, NAME_MAX, RETIRED_REASONS, ROW_KEYS, ROW_REQUIRED, SOURCE_PATTERNS, SUMMARY_MAX_FINDINGS,
  annotation, escapeCommandData, escapeCommandProperty, renderStepSummary, sourceProblem, validateRegistry,
} from '../seeds/employers-validate.mjs';
import { GARBAGE, PROVIDERS, REGISTRY, COMMITTED, checkout, readJson, reg, rowsOf, run } from './employers-registry-helpers.mjs';

/** The one warning a contribution waiting in the inbox may bring. */
const ALREADY_LISTED = /^warning: employers\/inbox\/[^:]+:\d+: \d+ boards? (?:is|are) already in the registry and will be skipped when the inbox is folded in \(lines? [^)]*\)$/;

// ── 1. The real registry ──────────────────────────────────────────────────

test('the committed registry passes the validator', () => {
  const r = run(COMMITTED);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /employer registry is valid: \d+ rows/);
  assert.equal(r.stderr, '', 'no warnings either');
});

test('the tree as it is, inbox included, passes the validator, and warns only of inbox boards the registry already lists', () => {
  const r = run(ROOT);
  assert.equal(r.status, 0, r.stderr);
  for (const line of r.stderr.split('\n').filter(Boolean)) assert.match(line, ALREADY_LISTED);
});

test('a contribution waiting in the inbox with a board the registry already lists: a warning, and the registry still passes', () => {
  const dir = checkout();
  try {
    const { row } = rowsOf(reg(dir))[0];
    mkdirSync(reg(dir, 'inbox'), { recursive: true });
    const line = { ats: row.ats, board: row.board, name: row.name };
    if (row.region) line.region = row.region;
    writeFileSync(reg(dir, 'inbox', '2026-11-16-octocat.ndjson'), `${JSON.stringify(line)}\n`);
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /inbox: 1 board\(s\) in 1 file\(s\), 1 already in the registry/);
    const warnings = r.stderr.split('\n').filter(Boolean);
    assert.equal(warnings.length, 1, r.stderr);
    assert.match(warnings[0], ALREADY_LISTED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed registry passes against itself as the base (a PR that changes nothing)', () => {
  const r = run(COMMITTED, ['--base', '.']);
  assert.equal(r.status, 0, r.stderr);
});

test('every admitted ATS has the provider that reads it, and that provider reads its canonical URL', () => {
  assert.deepEqual(Object.keys(PROVIDERS).sort(), [...BOARD_ATS].sort());
  for (const ats of BOARD_ATS) {
    assert.equal(PROVIDERS[ats].id, ats);
    // A ClearCompany board is its career site's GUID, not a slug.
    const board = ats === 'workday' ? 'acme/wd5/External' : ats === 'clearcompany' ? '0f8fad5b-d9cb-469f-a165-70867728950e' : ats === 'successfactors-classic' ? 'career5/eu/ACME001' : ats === 'oraclecloud' ? 'acme.fa.us2.oraclecloud.com/CX_1001' : ats === 'peoplesoft' ? 'recruit.acme.example/acme1' : OWN_DOMAIN_ATS.includes(ats) ? 'careers.acme.example' : 'acme';
    const regions = Object.hasOwn(REGIONAL_BOARD_URL_BUILDERS, ats) ? regionsOf(ats) : [undefined, ...regionsOf(ats)];
    for (const region of regions) {
      const url = buildBoardUrl({ ats, region, board, workday_host: ats === 'workday' ? 'jobs' : undefined });
      assert.ok(url, `${ats} ${region ?? ''}`);
      // A careers site on a company's own domain is read with `provider:` set: no URL names its system.
      if (OWN_DOMAIN_ATS.includes(ats)) continue;
      assert.ok(PROVIDERS[ats].detect({ name: 'Acme', careers_url: url }), `${ats}.detect() rejects ${url}`);
    }
  }
});

test('every committed row is read by its own provider', () => {
  const rows = rowsOf(REGISTRY);
  const providers = new Map(Object.entries(PROVIDERS));
  assert.ok(rows.length >= 40, `expected the first hand-picked boards, found ${rows.length}`);
  for (const { file, row } of rows) {
    if (OWN_DOMAIN_ATS.includes(row.ats)) {
      assert.equal(buildBoardUrl({ ats: row.ats, board: row.board }), row.careers_url, file);
      const entry = { name: row.name, careers_url: row.careers_url, provider: row.ats };
      const resolved = resolveProvider(entry, providers);
      assert.ok(resolved?.provider, file);
      assert.equal(resolved.provider, PROVIDERS[row.ats], file);
      continue;
    }
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
  const allRegions = [...new Set([...REGIONS, ...Object.values(OPTIONAL_REGION_BOARD_URL_BUILDERS).flatMap((b) => Object.keys(b))])];
  assert.deepEqual(rowSchema.properties.region.enum, allRegions);
  assert.deepEqual(rowSchema.properties.workday_host.enum, [...WORKDAY_HOSTS]);
  assert.deepEqual(rowSchema.properties.retired_reason.enum, [...RETIRED_REASONS]);
  assert.equal(rowSchema.properties.name.maxLength, NAME_MAX);
  assert.equal(new RegExp(rowSchema.properties.website.pattern).source, DOMAIN_RE.source);
  // The regional ATS (region required) are the ones with regional URL builders.
  assert.deepEqual(sorted(rowSchema.allOf[0].if.properties.ats.enum), sorted(Object.keys(REGIONAL_BOARD_URL_BUILDERS)));
  assert.deepEqual(rowSchema.allOf[0].then.properties.region.enum, [...REGIONS]);
  // The ATS with an optional region, and the regions each may name.
  const optional = rowSchema.allOf[0].else;
  assert.deepEqual(sorted(optional.if.properties.ats.enum), sorted(Object.keys(OPTIONAL_REGION_BOARD_URL_BUILDERS)));
  const perAts = optional.then.allOf.map((b) => [b.if.properties.ats.const, b.then.properties.region.enum]);
  assert.deepEqual(sorted(perAts.map(([ats]) => ats)), sorted(Object.keys(OPTIONAL_REGION_BOARD_URL_BUILDERS)));
  for (const [ats, regions] of perAts) assert.deepEqual(sorted(regions), sorted(regionsOf(ats)), ats);
  assert.deepEqual(optional.else, { not: { required: ['region'] } });
  // Subdomain boards: one DNS label.
  const label = rowSchema.allOf.find((b) => b.then?.properties?.board?.pattern && b.if.properties.ats.enum);
  assert.deepEqual(label.if.properties.ats.enum, [...DNS_LABEL_ATS]);
  assert.equal(new RegExp(label.then.properties.board.pattern).source, SUBDOMAIN_LABEL_RE.source);
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

test('sourceProblem: web-index:<name>@<date> needs a lowercase name and a real date', () => {
  for (const ok of ['web-index:wayback@2026-11-12', 'web-index:a@2026-02-28', 'web-index:a1-b2@2024-02-29']) {
    assert.equal(sourceProblem(ok), null, ok);
  }
  for (const bad of [
    'web-index:wayback', 'web-index:wayback@', 'web-index:wayback@2026-11', 'web-index:wayback@2026-13-40',
    'web-index:wayback@2026-02-30', 'web-index:wayback@2025-02-29', 'web-index:Wayback@2026-11-12',
    'web-index:@2026-11-12', 'web-index:-wayback@2026-11-12', 'web-index:wayback-@2026-11-12',
    `web-index:${'a'.repeat(65)}@2026-11-12`, 'web-index:way back@2026-11-12', 'web-index:wayback@2026-11-12 ',
  ]) {
    assert.match(sourceProblem(bad) ?? '', /^source .* (is not one of|does not end in a real calendar date)/, bad);
  }
  assert.match(sourceProblem('scraped'), /web-index:<name>@<YYYY-MM-DD>$/);
});

test('schema.json: the manifest id pattern accepts and rejects what the validator does', () => {
  const idPatterns = [manifestSchema.properties.id.pattern, rowSchema.properties.contribution.pattern].map((p) => new RegExp(p));
  const samples = ['2026-11-08-santifer', '2026-11-20-acme', '2026-11-20-a', '2026-11-20-Acme', '2026-11-20-', '2026-11-20-acme-', '26-11-20-acme', '2026-11-20-acme_co',
    '2026-11-20-acme.2', '2026-11-20-acme.9', '2026-11-20-acme.10', '2026-11-20-acme.99', '2026-11-20-acme-2.3',
    '2026-11-20-acme.1', '2026-11-20-acme.0', '2026-11-20-acme.02', '2026-11-20-acme.100', '2026-11-20-acme.', '2026-11-20-acme.2.3', '2026-11-20-acme.2-2', '2026-11-20-.2'];
  for (const s of samples) {
    for (const re of idPatterns) assert.equal(re.test(s), MANIFEST_ID_RE.test(s), s);
  }
  const accepted = samples.filter((s) => MANIFEST_ID_RE.test(s));
  assert.deepEqual(accepted, ['2026-11-08-santifer', '2026-11-20-acme', '2026-11-20-a', '2026-11-20-acme.2', '2026-11-20-acme.9', '2026-11-20-acme.10', '2026-11-20-acme.99', '2026-11-20-acme-2.3']);
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
    assert.ok(errorCommands.includes('::error file=employers/notes.txt::unexpected entry; the registry holds only README.md, LICENSE, THIRD_PARTY_NOTICES.md, CHANGELOG.md, schema.json, contributions, boards, inbox, OWN_DOMAIN_CONTRIBUTORS'), r.stdout);
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
    const r = run(COMMITTED, [], { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('::error') && !r.stdout.includes('::warning'), r.stdout);
    const md = readFileSync(summary, 'utf8');
    assert.ok(md.startsWith('# an earlier step\n## Employer registry\n'), 'the summary is appended, not overwritten');
    const n = readdirSync(join(REGISTRY, 'contributions')).filter((f) => f.endsWith('.json')).length;
    assert.match(md, new RegExp(`\\*\\*Valid\\*\\*: \\d+ rows in \\d+ files, ${n} contribution${n === 1 ? '' : 's'}; 0 errors, 0 warnings\\.`));
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
