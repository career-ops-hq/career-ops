import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uidPart, contactUid, parseContacts, buildVcf } from '../contacts.mjs';

const NAME = 'Jos\u00e9';
const COMPANY = 'Caf\u00e9';
const SCRIPT = fileURLToPath(new URL('../contacts.mjs', import.meta.url));
const cardCount = text => (text.match(/BEGIN:VCARD/g) || []).length;
const unfold = text => text.replace(/\r\n /g, '');
const store = () => [
  [NAME, COMPANY, 'peer', 'Engineer', '', 'old@example.test'].join('\t'),
  [NAME.normalize('NFD'), COMPANY.normalize('NFD'), 'peer', 'Lead', '', 'new@example.test'].join('\t'),
].join('\n');

test('contact UID folds Unicode composition in both name and company', () => {
  const expected = contactUid({ name: NAME, company: COMPANY });
  for (const name of [NAME, NAME.normalize('NFD')]) {
    for (const company of [COMPANY, COMPANY.normalize('NFD')]) {
      assert.equal(contactUid({ name, company }), expected);
    }
  }
  assert.equal(uidPart(NAME.normalize('NFD')), uidPart(NAME));
  assert.equal(uidPart(COMPANY.normalize('NFD')), uidPart(COMPANY));
  assert.equal(contactUid({ name: 'Jane Doe', company: 'Acme' }),
    'careerops-jane-doe-bc225ac5--acme-293abb6b', 'existing ASCII UIDs stay stable');
  assert.equal(uidPart(NAME), 'jos-8e9c993b', 'existing NFC UIDs stay stable');
  assert.notEqual(uidPart(NAME), uidPart('Jos\u00e8'), 'different accents remain different identities');
});

test('composition variants report one duplicate and export the last contact', () => {
  const { contacts, quality } = parseContacts(store());
  const vcf = unfold(buildVcf(contacts, { rev: '2026-10-28T00:00:00.000Z' }));
  assert.equal(contacts.length, 2, 'JSON keeps both source rows');
  assert.equal(quality.duplicates.length, 1);
  assert.equal(quality.duplicates[0].count, 2);
  assert.equal(cardCount(vcf), 1);
  assert.match(vcf, /EMAIL;TYPE=INTERNET:new@example\.test/);
  assert.doesNotMatch(vcf, /old@example\.test/);
  const distinct = parseContacts(store() + '\n' + ['Jos\u00e8', COMPANY, 'peer', 'Engineer'].join('\t'));
  assert.equal(cardCount(buildVcf(distinct.contacts)), 2, 'different accented names are not merged');
});

test('contacts CLI writes one current vCard for composition variants', () => {
  const root = mkdtempSync(join(tmpdir(), 'contacts-unicode-'));
  try {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'contacts.tsv'), store(), 'utf8');
    const options = { env: { ...process.env, CAREER_OPS_ROOT: root }, encoding: 'utf8', windowsHide: true, timeout: 20000 };
    const json = JSON.parse(execFileSync(process.execPath, [SCRIPT], options));
    execFileSync(process.execPath, [SCRIPT, '--vcf'], options);
    const vcf = unfold(readFileSync(join(root, 'output', 'contacts.vcf'), 'utf8'));
    assert.equal(cardCount(vcf), 1);
    assert.equal(json.total, 2);
    assert.equal(json.quality.duplicates.length, 1);
    assert.equal(json.quality.duplicates[0].count, 2);
    assert.match(vcf, /EMAIL;TYPE=INTERNET:new@example\.test/);
    assert.doesNotMatch(vcf, /old@example\.test/);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
