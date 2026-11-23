// tests/employers-registry-subdomain.test.mjs: employer registry rows of the
// ATS whose boards are a subdomain of the vendor's host (Zoho Recruit,
// Teamtailor, Personio, Trakstar, HiBob, Taleez and the rest of DNS_LABEL_ATS).
//
// Split from tests/employers-registry.test.mjs (#7561); the shared setup is in
// tests/employers-registry-helpers.mjs.
//
// Run:  node --test tests/employers-registry-subdomain.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { unlistedEmployerBoard } from './helpers.mjs';
import { DNS_LABEL_ATS, SUBDOMAIN_LABEL_RE, SUBDOMAIN_RESERVED_LABELS, buildBoardUrl } from '../lib/ats-board-url.mjs';
import { parseBoardUrl } from '../seeds/employers-import.mjs';
import { inboxLineProblems, validateRegistry } from '../seeds/employers-validate.mjs';
import { PROVIDERS, addRows, checkout, pr } from './employers-registry-helpers.mjs';

test('--base: rows of the new subdomain ATS pass, and one Zoho Recruit tenant on two data-centre domains is two boards', () => {
  const zoho = unlistedEmployerBoard('zoho-recruit', 'fixture-co');
  const r = pr((head) => addRows(head, [
    { ats: 'zoho-recruit', board: zoho },
    { ats: 'zoho-recruit', region: 'eu', board: zoho },
    { ats: 'zoho-recruit', region: 'au', board: zoho },
  ]));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'no warnings either');
  for (const [ats, region] of [['teamtailor'], ['personio'], ['personio', 'com'], ['trakstar'], ['hibob']]) {
    const one = pr((head) => addRows(head, [{ ats, region, board: unlistedEmployerBoard(ats, 'fixture-co') }]));
    assert.equal(one.status, 0, `${ats} ${region ?? ''}: ${one.stderr}`);
  }
});

test('Zoho Recruit and the new subdomain ATS: region, case, own subdomains and the canonical URL are checked', () => {
  const zoho = unlistedEmployerBoard('zoho-recruit', 'fixture-co');
  const dotCom = buildBoardUrl({ ats: 'zoho-recruit', board: zoho });
  const cases = [
    [{ ats: 'zoho-recruit', region: 'us', board: zoho, careers_url: dotCom },
      'region "us" is not one of: au, ca, cn, eu, in, jp, sa; leave it out for a board on the default host'],
    [{ ats: 'zoho-recruit', region: 'eu', board: zoho, careers_url: dotCom },
      `is not the canonical URL for this board; expected "${buildBoardUrl({ ats: 'zoho-recruit', region: 'eu', board: zoho })}"`],
    [{ ats: 'zoho-recruit', board: zoho.toUpperCase(), careers_url: dotCom }, 'zoho-recruit boards are lowercase'],
  ];
  for (const [row, message] of cases) {
    const head = checkout();
    try {
      addRows(head, [row]);
      const { errors } = validateRegistry({ root: head });
      assert.ok(errors.some((x) => x.message.includes(message)), `${message}\n${JSON.stringify(errors)}`);
    } finally { rmSync(head, { recursive: true, force: true }); }
  }
  const head = checkout();
  try {
    const teamtailor = unlistedEmployerBoard('teamtailor', 'fixture-co');
    addRows(head, [
      { ats: 'teamtailor', region: 'eu', board: teamtailor, careers_url: buildBoardUrl({ ats: 'teamtailor', board: teamtailor }) },
      // A reserved label is never a committed board, so it needs no unlisted name.
      { ats: 'taleez', board: 'aide', careers_url: 'https://aide.taleez.com' },
    ]);
    const { errors } = validateRegistry({ root: head });
    assert.ok(errors.some((x) => x.message.startsWith('region is only used on greenhouse and lever rows, and on personio and zoho-recruit rows off the default host')), JSON.stringify(errors));
    assert.ok(errors.some((x) => x.message === 'board "aide" is one of taleez\'s own subdomains, not a board'), JSON.stringify(errors));
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('new subdomain ATS: the inbox and the importer admit the same board ids; the builder refuses exactly the ones that are no host label', () => {
  const reserved = [...new Set(Object.values(SUBDOMAIN_RESERVED_LABELS).flat())];
  const ids = [
    'acme', 'a', 'a1', 'acme-co', 'a'.repeat(63), 'a'.repeat(64), 'acme.inc', 'acme_inc', '-acme', 'acme-', '12345', 'jobs',
    ...reserved, 'marketplace', 'careers', 'support',
  ];
  for (const ats of DNS_LABEL_ATS) {
    // The importer reads the board's own host: the canonical URL with the id in place of "acme".
    const canonical = buildBoardUrl({ ats, board: 'acme' });
    for (const board of ids) {
      const inbox = inboxLineProblems({ ats, board, name: 'Acme' }, new Set());
      const imported = parseBoardUrl(canonical.replace('acme', board));
      const importOk = !('error' in imported) && imported.board === board;
      const where = `${ats} ${JSON.stringify(board)}`;
      assert.equal(importOk, inbox.length === 0, `${where}: inbox ${JSON.stringify(inbox)}, import ${JSON.stringify(imported)}`);
      const url = buildBoardUrl({ ats, board });
      if (inbox.length === 0) {
        assert.ok(url, `${where}: valid but builds no URL`);
        assert.ok(PROVIDERS[ats].detect({ name: 'Acme', careers_url: url }), `${where}: ${ats}.detect() rejects ${url}`);
      }
      // The URL rules (one DNS label, not the vendor's own subdomain) are the builder's too.
      // Numeric-only ids and placeholders are registry rules: the builder still makes their URL.
      const urlRule = !SUBDOMAIN_LABEL_RE.test(board) || (SUBDOMAIN_RESERVED_LABELS[ats] || []).includes(board);
      assert.equal(url === null, urlRule, `${where}: builder`);
    }
  }
});

test("each new subdomain ATS's reserved labels are refused by its own provider", () => {
  for (const [ats, labels] of Object.entries(SUBDOMAIN_RESERVED_LABELS)) {
    const canonical = buildBoardUrl({ ats, board: 'acme' });
    for (const label of labels) {
      assert.equal(PROVIDERS[ats].detect({ name: 'Acme', careers_url: canonical.replace('acme', label) }), null, `${ats} ${label}`);
    }
  }
});
