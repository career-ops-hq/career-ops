import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendContact } from '../contact-extract.mjs';
import { parseContacts, buildVcf } from '../contacts.mjs';
import { pass, fail, rmSync } from './helpers.mjs';

for (const name of ['Jane Doe', 'JANE DOE']) {
  const dir = mkdtempSync(join(tmpdir(), 'contact-last-duplicate-'));
  const label = `contact update reaches the exported duplicate (${name})`;
  try {
    const file = join(dir, 'contacts.tsv');
    const header = '# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes';
    const first = 'Jane Doe\tAcme\trecruiter\tOld title\t+12025550101\told@example.test\t\t001\told note';
    const unrelated = 'Other Person\tGlobex\tpeer\tEngineer\t\tother@example.test\t\t-\tkeep';
    const last = 'Jane Doe\tAcme\thiring-manager\tTeam lead\t+12025550102\tcurrent@example.test\t\t002\tlatest note';
    writeFileSync(file, [header, first, unrelated, last, ''].join('\n'));

    assert.equal(await appendContact({ name, company: 'Acme', email: 'updated@example.test' }, file), 3);
    const saved = readFileSync(file, 'utf8');
    assert.equal(saved.split('\n')[1], first, 'older historical row stays intact');
    assert.equal(saved.split('\n')[2], unrelated, 'other contacts stay intact');
    const { contacts } = parseContacts(saved);
    const vcf = buildVcf(contacts);
    assert.match(vcf, /EMAIL;TYPE=INTERNET:updated@example\.test/);
    assert.doesNotMatch(vcf, /current@example\.test/);
    assert.match(vcf, /TITLE:Team lead/);
    assert.match(vcf, /TEL;TYPE=CELL:\+12025550102/);
    assert.match(vcf, /latest note/);
    assert.equal((vcf.match(/BEGIN:VCARD/g) || []).length, 2);
    pass(label);
  } catch (error) { fail(`${label}: ${error.message}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
