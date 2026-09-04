// tests/linkedin-join.test.mjs — the join contract for the warm-intro finder
// (#2943, #2679).
//
// Three properties carry the whole feature, and each one has a way of failing
// that looks like success:
//
//   1. Company matching must fold names WITHOUT collapsing distinct companies.
//      A naive NFKD fold silently drops non-decomposing Latin, so "Ørsted"
//      never matches "Orsted" and the user simply never learns they had a
//      contact. Delegating to lib/ascii-fold.mjs fixes the whole class.
//   2. `strong` requires distinctive token sets to be EQUAL, not nested.
//      Containment reads like a match while naming a different company
//      ("Epic" is in "Epic Games", but Epic Systems is an EHR vendor).
//   3. Substring matching must never appear. #2679 acceptance criterion 6
//      makes this explicit, because one bad match erodes trust in the column
//      faster than several misses.
//
// Run:  node --test tests/linkedin-join.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  companyTokens, matchCompany, parseCsv, findHeaderRow, parseConnectedOn,
  parseConnections, parseTrackerTargets, joinConnections, parseKnownContacts,
  secondDegreeSearchUrl,
} from '../linkedin-join.mjs';

const tier = (a, b) => matchCompany(companyTokens(a), companyTokens(b));

test('folds decomposing and non-decomposing Latin alike', () => {
  // Decomposing: NFKD exposes a combining mark that can be stripped.
  assert.equal(tier('Société Générale', 'Societe Generale'), 'exact');
  assert.equal(tier('Telefónica', 'Telefonica'), 'exact');
  // Non-decomposing: the stroke IS the glyph, so only a mapping table works.
  assert.equal(tier('Ørsted', 'Orsted'), 'exact');
  assert.equal(tier('Işık Holding', 'Isik Holding'), 'exact');
  assert.equal(tier('Straße GmbH', 'Strasse GmbH'), 'exact');
  assert.equal(tier('Æther Labs', 'Aether Labs'), 'exact');
  assert.equal(tier('Łukasiewicz', 'Lukasiewicz'), 'exact');
});

test('non-Latin names survive the ASCII fold', () => {
  // asciiFold returns '' for CJK/Cyrillic, which is right for a hostname
  // target and wrong here: both sides of this join are free text.
  assert.ok(companyTokens('株式会社テスト').key.length > 0);
  assert.ok(companyTokens('Яндекс').key.length > 0);
  assert.equal(tier('株式会社テスト', '株式会社テスト'), 'exact');
});

test('generic filler may differ, distinctive tokens may not', () => {
  assert.equal(tier('Siemens', 'Siemens Digital Industries Software'), 'strong');
  assert.equal(tier('Akamai', 'Akamai Technologies'), 'strong');
  assert.equal(tier('EXL', 'EXL Service Holdings, Inc.'), 'strong');
  assert.equal(tier('New York Times', 'The New York Times'), 'strong');
});

test('nesting is not identity', () => {
  assert.equal(tier('Epic Systems', 'Epic Games'), 'weak');
  assert.equal(tier('Optimal Blue', 'Blue Cloud Ventures'), 'weak');
  assert.equal(tier('GE', 'GE Inc'), 'weak', 'sub-3-char overlap is coincidence as often as signal');
});

test('never matches on a shared generic word or a substring (#2679 criterion 6)', () => {
  assert.equal(tier('Monogram Health', 'Advocate Health'), null);
  assert.equal(tier('Loop', 'Loopio'), null);
  assert.equal(tier('Datavant', 'Snyk'), null);
});

test('an all-generic company name is inert rather than matching everything', () => {
  assert.equal(tier('Stealth Startup', 'Acme Startup'), null);
});

test('parses the export past its free-text preamble', () => {
  const csv = [
    'Notes:', '"preamble that has moved before"', '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Jane,Doe,https://linkedin.com/in/janedoe,,Datavant,"Director, Platform",03 Aug 2026',
    'No,Employer,https://x,,,Consultant,01 Jan 2020',
  ].join('\n');
  const { connections, quality } = parseConnections(csv);
  assert.equal(connections.length, 1);
  assert.equal(connections[0].name, 'Jane Doe');
  assert.equal(connections[0].title, 'Director, Platform', 'quoted comma must survive');
  assert.equal(connections[0].connectedOn, '2026-08-03');
  assert.equal(quality.noCompany, 1, 'an employerless row is counted, not dropped silently');
});

test('header is found by content, so a longer preamble cannot shift the columns', () => {
  assert.equal(findHeaderRow(parseCsv('x\ny\nz\nw\nFirst Name,Company\nA,B\n')), 4);
});

test('CSV parser handles quotes, escapes and embedded newlines', () => {
  const rows = parseCsv('a,"b,c",d\n"line\nbreak","say ""hi""",z\n');
  assert.equal(rows[0][1], 'b,c');
  assert.equal(rows[1][0], 'line\nbreak');
  assert.equal(rows[1][1], 'say "hi"');
});

test('parses both date shapes LinkedIn has shipped', () => {
  assert.equal(parseConnectedOn('03 Aug 2026').iso, '2026-08-03');
  assert.equal(parseConnectedOn('2026-08-03').iso, '2026-08-03');
  assert.equal(parseConnectedOn('').iso, null);
  assert.equal(parseConnectedOn('sometime').iso, null);
});

test('anonymized tracker rows are dropped as targets', () => {
  const md = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-01-01 | Stealth Startup | CTO | 4.0/5 | Evaluated | ❌ | [1](reports/x.md) | - |',
    '| 2 | 2026-01-01 | ? | CTO | 4.0/5 | Evaluated | ❌ | [2](reports/y.md) | - |',
    '| 3 | 2026-01-01 | Datavant | CTO | 4.0/5 | Applied | ❌ | [3](reports/z.md) | - |',
  ].join('\n');
  const { targets, skipped } = parseTrackerTargets(md);
  assert.deepEqual(targets.map(t => t.company), ['Datavant']);
  assert.equal(skipped.length, 2);
});

test('a company in both lists keeps its tracker context and one copy', () => {
  const conn = [{
    name: 'Jane Doe', company: 'Datavant', title: 'Director', linkedin: '', email: '',
    connectedOn: '2026-01-01', connectedYear: 2026, tokens: companyTokens('Datavant'),
  }];
  const { targets } = joinConnections(conn, [
    { company: 'Datavant', source: 'tracker', tokens: companyTokens('Datavant'), tracker: { num: '23', status: 'Applied' } },
    { company: 'Datavant', source: 'portals', tokens: companyTokens('Datavant'), tracker: null },
  ]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].source, 'tracker');
  assert.equal(targets[0].connections.length, 1);
});

test('weak matches stay hidden unless asked for', () => {
  const conn = [{
    name: 'A B', company: 'GE', title: '', linkedin: '', email: '',
    connectedOn: null, connectedYear: null, tokens: companyTokens('GE'),
  }];
  const target = () => ({ company: 'GE Inc', source: 'tracker', tokens: companyTokens('GE Inc'), tracker: { num: '1' } });
  assert.equal(joinConnections(conn, [target()]).targets.length, 0);
  assert.equal(joinConnections(conn, [target()], { includeWeak: true }).targets.length, 1);
});

test('people already in the phonebook are marked, not re-suggested', () => {
  const known = parseKnownContacts('# name\tcompany\nJane Doe\tDatavant\tpeer\n\n');
  assert.ok(known.has('janedoe::datavant'));
  const conn = [{
    name: 'Jane Doe', company: 'Datavant', title: '', linkedin: '', email: '',
    connectedOn: null, connectedYear: null, tokens: companyTokens('Datavant'),
  }];
  const { targets } = joinConnections(conn, [
    { company: 'Datavant', source: 'tracker', tokens: companyTokens('Datavant'), tracker: null },
  ], { known });
  assert.equal(targets[0].connections[0].alreadyInPhonebook, true);
});

test('every target carries a second-degree link the user opens themselves (#2679 criterion 3)', () => {
  const url = secondDegreeSearchUrl('Acme & Co');
  assert.ok(url.startsWith('https://www.linkedin.com/search/results/people/?'));
  assert.ok(url.includes('keywords=Acme%20%26%20Co'));
  assert.ok(url.includes('network=%5B%22S%22%5D'), 'must filter to 2nd degree');
});

// --- Review findings from PR #3200 -----------------------------------------

test('the folded key concatenates, because LinkedIn spacing varies more than wording', () => {
  // Space-joining the key would read as safer and would lose all five of
  // these, which are one employer typed two ways. The collision it prevents
  // ("A B" vs "AB") still has to get past a human reading both raw names.
  assert.equal(tier('GoDaddy', 'Go Daddy'), 'exact');
  assert.equal(tier('PayPal', 'Pay Pal'), 'exact');
  assert.equal(tier('Salesforce', 'Sales Force'), 'exact');
  assert.equal(tier('Red Hat', 'RedHat'), 'exact');
  assert.equal(tier('ServiceNow', 'Service Now'), 'exact');
});

test('a strong-equivalent target from both sources is merged, not duplicated', () => {
  const conn = [{
    name: 'Jane Doe', company: 'Akamai Technologies', title: 'Eng', linkedin: '', email: '',
    connectedOn: '2020-01-01', connectedYear: 2020, tokens: companyTokens('Akamai Technologies'),
  }];
  const { targets } = joinConnections(conn, [
    { company: 'Akamai', source: 'tracker', tokens: companyTokens('Akamai'), tracker: { num: '7', status: 'Applied' } },
    { company: 'Akamai Technologies', source: 'portals', tokens: companyTokens('Akamai Technologies'), tracker: null },
  ]);
  assert.equal(targets.length, 1, 'the two spellings are one employer');
  assert.equal(targets[0].source, 'tracker', 'the surviving copy keeps tracker context');
  assert.equal(targets[0].tracker.num, '7');
  const appearances = targets.reduce(
    (n, t) => n + t.connections.filter(c => c.name === 'Jane Doe').length, 0);
  assert.equal(appearances, 1, 'the connection must not be reported twice');
});

test('a weak twin is left alone, since weak may be two different companies', () => {
  const { targets } = joinConnections([{
    name: 'A B', company: 'Epic Systems', title: '', linkedin: '', email: '',
    connectedOn: null, connectedYear: null, tokens: companyTokens('Epic Systems'),
  }], [
    { company: 'Epic Systems', source: 'tracker', tokens: companyTokens('Epic Systems'), tracker: { num: '1' } },
    { company: 'Epic Games', source: 'portals', tokens: companyTokens('Epic Games'), tracker: null },
  ]);
  assert.equal(targets.length, 1, 'only Epic Systems matches the connection');
  assert.equal(targets[0].company, 'Epic Systems');
});

test('impossible calendar dates are reported unparsed, not turned into real-looking ISO', () => {
  // The regex shape matches; the calendar does not. 2026 is not a leap year.
  assert.equal(parseConnectedOn('31 Feb 2026').iso, null);
  assert.equal(parseConnectedOn('29 Feb 2026').iso, null);
  assert.equal(parseConnectedOn('2026-02-31').iso, null);
  // Genuine dates, including a real leap day, still parse.
  assert.equal(parseConnectedOn('29 Feb 2024').iso, '2024-02-29');
  assert.equal(parseConnectedOn('03 Aug 2026').iso, '2026-08-03');
  assert.equal(parseConnectedOn('2026-08-03').iso, '2026-08-03');
});

test('an undated row cannot satisfy "connections made in/after YYYY"', () => {
  const csv = [
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Dated,One,https://x,,Datavant,Eng,03 Aug 2026',
    'Undated,Two,https://y,,Datavant,Eng,',
  ].join('\n');
  const { connections } = parseConnections(csv);
  assert.equal(connections.length, 2);
  const kept = connections.filter(c => c.connectedYear != null && c.connectedYear >= 2020);
  assert.deepEqual(kept.map(c => c.name), ['Dated One']);
});

test('the reported target count reflects merged targets, not the raw input list', () => {
  const conn = [{
    name: 'Jane Doe', company: 'Akamai Technologies', title: 'Eng', linkedin: '', email: '',
    connectedOn: '2020-01-01', connectedYear: 2020, tokens: companyTokens('Akamai Technologies'),
  }];
  const { targets, targetCount } = joinConnections(conn, [
    { company: 'Akamai', source: 'tracker', tokens: companyTokens('Akamai'), tracker: { num: '7' } },
    { company: 'Akamai Technologies', source: 'portals', tokens: companyTokens('Akamai Technologies'), tracker: null },
  ]);
  assert.equal(targets.length, 1);
  assert.equal(targetCount, 1, 'counting raw keys would report 2 for one merged target');
});

test('--since 0000 filters rather than being read as "no filter"', () => {
  // 0000 passes the four-digit check and converts to 0, which a truthiness
  // test treats as absent — the flag would silently do nothing.
  const csv = [
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Dated,One,https://x,,Datavant,Eng,03 Aug 2026',
    'Undated,Two,https://y,,Datavant,Eng,',
  ].join('\n');
  const { connections } = parseConnections(csv);
  const sinceYear = 0;
  const active = sinceYear !== null;
  const filtered = active
    ? connections.filter(c => c.connectedYear != null && c.connectedYear >= sinceYear)
    : connections;
  assert.deepEqual(filtered.map(c => c.name), ['Dated One'],
    'the undated row must still be excluded when the year is 0');
});
