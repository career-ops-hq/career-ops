// tests/contact-extract-corporate-form.test.mjs — contact-extract's --company
// override finds a tracker row stored with a corporate form.
//
// --company was compared with trim().toLowerCase(), so `--company Acme`, and
// even `--company "Acme Inc"` (the usage example), failed with "must name a
// company in the tracker" against a row stored as "Acme Inc.". set-status,
// outcome and company-history (#7622) resolve the same name to that row through
// normalizeCompany() and companiesMatchIgnoringCorporateForm().
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

/** Run contact-extract against a one-row tracker; return the exit status, output and saved contacts. */
function extract(args) {
  const root = mkdtempSync(join(tmpdir(), 'contact-extract-form-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|---|---|---|---|---|---|---|---|\n| 12 | 2026-06-01 | Acme Inc. | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n');
    const email = join(root, 'email.txt');
    writeFileSync(email, 'Subject: Next steps\nFrom: Jane Doe <jane@acme.com>\n\nThanks for applying, we would like to chat.\n');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('CAREER_OPS_')) delete env[key];
    env.CAREER_OPS_ROOT = root;
    const r = spawnSync(NODE, [join(ROOT, 'contact-extract.mjs'), '--file', email, '--yes', ...args], {
      cwd: root, encoding: 'utf-8', env, timeout: 30000,
    });
    const contactsPath = join(root, 'data', 'contacts.tsv');
    return { status: r.status, output: `${r.stdout}${r.stderr}`, contacts: existsSync(contactsPath) ? readFileSync(contactsPath, 'utf-8') : '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\ncontact-extract — --company matches a tracker company across its corporate form');

for (const args of [['--company', 'Acme'], ['--company', 'Acme Inc'], ['--company', 'Acme Inc', '--tracker', '12']]) {
  ok(`${args.join(' ')} attaches the contact to "Acme Inc." #12`, () => {
    const r = extract(args);
    assert.strictEqual(r.status, 0, r.output);
    assert.match(r.contacts, /^Jane Doe\tAcme Inc\.\trecruiter\t.*\t12\t/m, r.output);
  });
}

ok('--company "Acme Robotics" still names a different employer', () => {
  const r = extract(['--company', 'Acme Robotics']);
  assert.strictEqual(r.status, 1, r.output);
  assert.match(r.output, /--company must name a company in the tracker/);
  assert.strictEqual(r.contacts, '');
});

ok('--company "Acme Robotics" --tracker 12 is still a mismatch', () => {
  const r = extract(['--company', 'Acme Robotics', '--tracker', '12']);
  assert.strictEqual(r.status, 1, r.output);
  assert.match(r.output, /does not match tracker #12's company "Acme Inc\."/);
});
