// tests/employers-registry-own-domain.test.mjs: employer registry rows for
// careers sites on a company's own domain (phenom, successfactors, peoplesoft),
// which only contributors in employers/OWN_DOMAIN_CONTRIBUTORS may add.
//
// Split from tests/employers-registry.test.mjs (#7561); the shared setup is in
// tests/employers-registry-helpers.mjs.
//
// Run:  node --test tests/employers-registry-own-domain.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { ROOT, unlistedEmployerBoard } from './helpers.mjs';
import { validateRegistry } from '../seeds/employers-validate.mjs';
import { NEW_DAY, addRows, checkout, pr, reg } from './employers-registry-helpers.mjs';

// ── Careers sites on a company's own domain (phenom, successfactors, peoplesoft) ──

const MARK = { mark: 'phenompeople-assets', checked_on: NEW_DAY };
const ownRow = (over = {}) => ({ ats: 'phenom', board: 'careers.fixture-own.example', own_domain_mark: MARK, ...over });
const allowNewcomer = (head) => appendFileSync(reg(head, 'OWN_DOMAIN_CONTRIBUTORS'), '\nnewcomer\n');

test('own domain: rows from a contributor in OWN_DOMAIN_CONTRIBUTORS pass, for each of the three systems', () => {
  const r = pr((head) => {
    allowNewcomer(head);
    addRows(head, [
      ownRow(),
      { ats: 'successfactors', board: 'jobs.fixture-own.example/Brand', own_domain_mark: { mark: 'rmkcdn-assets', checked_on: NEW_DAY } },
      { ats: 'peoplesoft', board: 'recruit.fixture-own.example/own1', own_domain_mark: { mark: 'hrs-cg-search', checked_on: NEW_DAY } },
    ]);
  });
  assert.equal(r.status, 0, r.stderr);
});

test('own domain: the contributor, the mark, the host and the board are checked', () => {
  const cases = [
    [(head) => addRows(head, [ownRow()]), 'comes only from a contribution of OWN_DOMAIN_CONTRIBUTORS'],
    [(head) => { allowNewcomer(head); addRows(head, [ownRow({ own_domain_mark: undefined })]); }, 'own_domain_mark is required on phenom rows'],
    [(head) => { allowNewcomer(head); addRows(head, [ownRow({ own_domain_mark: { mark: 'jobs2web', checked_on: NEW_DAY } })]); }, 'own_domain_mark.mark "jobs2web" is not one of: phenompeople-assets'],
    [(head) => { allowNewcomer(head); addRows(head, [ownRow({ own_domain_mark: { mark: 'phenompeople-assets', checked_on: '2999-01-01' } })]); }, 'is in the future'],
    [(head) => { allowNewcomer(head); addRows(head, [ownRow(), { ats: 'successfactors', board: 'careers.fixture-own.example', own_domain_mark: { mark: 'jobs2web', checked_on: NEW_DAY } }]); }, 'a company\'s own domain is on one row'],
    [(head) => { allowNewcomer(head); addRows(head, [ownRow({ board: 'careers.phenompeople.com' })]); }, 'not on a vendor\'s domain'],
    [(head) => { allowNewcomer(head); addRows(head, [ownRow({ board: 'jobs.fixture-own.local' })]); }, 'not local'],
    [(head) => { allowNewcomer(head); addRows(head, [ownRow({ board: 'careers.fixture-own.example/Brand' })]); }, 'must be the site\'s host'],
    [(head) => { allowNewcomer(head); addRows(head, [{ ats: 'peoplesoft', board: 'recruit.fixture-own.example', own_domain_mark: { mark: 'hrs-cg-search', checked_on: NEW_DAY } }]); }, 'must be host/site'],
    [(head) => addRows(head, [{ ats: 'teamtailor', board: unlistedEmployerBoard('teamtailor', 'fixture-co'), own_domain_mark: MARK }]), 'own_domain_mark is only used on phenom, successfactors, peoplesoft rows'],
  ];
  for (const [change, message] of cases) {
    const head = checkout();
    try {
      change(head);
      const { errors } = validateRegistry({ root: head });
      assert.ok(errors.some((x) => x.message.includes(message)), `${message}\n${JSON.stringify(errors)}`);
    } finally { rmSync(head, { recursive: true, force: true }); }
  }
});

test('own domain: OWN_DOMAIN_CONTRIBUTORS is a file, and the committed one names only the maintainer', () => {
  const lines = readFileSync(reg(ROOT, 'OWN_DOMAIN_CONTRIBUTORS'), 'utf8').split('\n').map((l) => l.split('#')[0].trim()).filter(Boolean);
  assert.deepEqual(lines, ['santifer']);
  const head = checkout();
  try {
    rmSync(reg(head, 'OWN_DOMAIN_CONTRIBUTORS'), { force: true });
    mkdirSync(reg(head, 'OWN_DOMAIN_CONTRIBUTORS'));
    const { errors } = validateRegistry({ root: head });
    assert.ok(errors.some((x) => x.file === 'employers/OWN_DOMAIN_CONTRIBUTORS' && x.message === 'must be a file'), JSON.stringify(errors));
  } finally { rmSync(head, { recursive: true, force: true }); }
});
