#!/usr/bin/env node

/**
 * contact-extract-tests.mjs — regression tests for contact-extract.mjs (#4361).
 *
 * Locks in the local-only, no-Gmail path from a pasted interview-invite or
 * rejection email to a saved data/contacts.tsv row:
 *   1. parseFromHeader handles "Name" <email>, Name <email>, bare email, bare
 *      name, and normalizes/lowercases the email.
 *   2. inferContactType defaults to recruiter, and recognizes hiring-manager /
 *      interviewer signals in the reply text (hiring-manager wins when both
 *      are present, as the more specific signal).
 *   3. sanitizeCell strips tabs/newlines so a TSV row can never be corrupted
 *      by name/notes content.
 *   4. appendContact creates the file with its documented header comment,
 *      updates name+company matches, and sanitizes on the way in.
 *   5. CLI end to end: auto-match via reply-matcher.mjs's matchCandidates,
 *      manual --company/--tracker override, no-match no-op (nothing written,
 *      exit 0), --type validation, interactive y/n confirm vs --yes,
 *      missing-file / unknown-flag / --help exits.
 *
 * Provisions a throwaway data root via CAREER_OPS_ROOT and a temp dir; never
 * touches the repo's real
 * data/applications.md or data/contacts.tsv.
 */

import { execFile, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const CLI = join(ROOT, 'contact-extract.mjs');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// process.env with path overrides stripped out for isolated data-root tests.
const { CAREER_OPS_TRACKER: _t, CAREER_OPS_ROOT: _r, ...cleanEnv } = process.env;

function setupWorkspace() {
  const dir = tmp('contact-extract-');
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const trackerFile = join(dataDir, 'applications.md');
  const header = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
  writeFileSync(trackerFile, `${header}| 12 | 2026-06-01 | Acme Inc | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n`);
  const contactsFile = join(dataDir, 'contacts.tsv');
  return { dir, trackerFile, contactsFile };
}

// Two distinct rows for two distinct companies, so a --company/--tracker
// mismatch (row #12 is Acme, row #34 is Globex) has something real to catch.
function setupWorkspaceTwoRows() {
  const dir = tmp('contact-extract-');
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const trackerFile = join(dataDir, 'applications.md');
  const header = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
  writeFileSync(
    trackerFile,
    `${header}| 12 | 2026-06-01 | Acme Inc | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n`
    + `| 34 | 2026-06-02 | Globex | Data Analyst | 4.0/5 | Applied | ❌ | - | |\n`,
  );
  const contactsFile = join(dataDir, 'contacts.tsv');
  return { dir, trackerFile, contactsFile };
}

function writeEmail(dir, { subject = '', from = '', body = '' }) {
  const filePath = join(dir, 'email.txt');
  writeFileSync(filePath, `Subject: ${subject}\nFrom: ${from}\n\n${body}\n`);
  return filePath;
}

function run(trackerFile, contactsFile, args, input) {
  const dataRoot = dirname(dirname(contactsFile));
  try {
    const stdout = execFileSync(NODE, [CLI, ...args], {
      cwd: ROOT,
      env: { ...cleanEnv, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_TRACKER: trackerFile },
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function runAsync(trackerFile, contactsFile, args) {
  const dataRoot = dirname(dirname(contactsFile));
  return new Promise((resolve) => {
    const child = execFile(NODE, [CLI, ...args], {
      cwd: ROOT,
      env: { ...cleanEnv, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_TRACKER: trackerFile },
      encoding: 'utf8',
      timeout: 30_000,
    }, (error, stdout, stderr) => resolve({
      status: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      stdout,
      stderr,
    }));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
console.log('1. parseFromHeader / inferContactType / sanitizeCell — direct unit imports');
{
  const mod = await import(pathToFileURL(CLI).href);

  check('parseFromHeader: "Name" <email>', JSON.stringify(mod.parseFromHeader('"Jane Doe" <jane@acme.com>')) === JSON.stringify({ name: 'Jane Doe', email: 'jane@acme.com' }));
  check('parseFromHeader: Name <email> no quotes', JSON.stringify(mod.parseFromHeader('Jane Doe <jane@acme.com>')) === JSON.stringify({ name: 'Jane Doe', email: 'jane@acme.com' }));
  check('parseFromHeader: bare email', JSON.stringify(mod.parseFromHeader('jane@acme.com')) === JSON.stringify({ name: '', email: 'jane@acme.com' }));
  check('parseFromHeader: bare name, no email', JSON.stringify(mod.parseFromHeader('Jane from Acme Recruiting')) === JSON.stringify({ name: 'Jane from Acme Recruiting', email: null }));
  check('parseFromHeader: empty/missing', JSON.stringify(mod.parseFromHeader('')) === JSON.stringify({ name: '', email: null }) && JSON.stringify(mod.parseFromHeader(undefined)) === JSON.stringify({ name: '', email: null }));
  check('parseFromHeader: email lowercased', JSON.stringify(mod.parseFromHeader('Jane Doe <Jane@ACME.com>')) === JSON.stringify({ name: 'Jane Doe', email: 'jane@acme.com' }));

  check('inferContactType: hiring manager', mod.inferContactType('Regards, the Hiring Manager for this role') === 'hiring-manager');
  check('inferContactType: interview panel', mod.inferContactType('the interview panel has decided to move forward') === 'interviewer');
  check('inferContactType: interview team', mod.inferContactType('our interview team enjoyed meeting you') === 'interviewer');
  check('inferContactType: defaults to recruiter', mod.inferContactType('Thank you for applying to Acme Inc.') === 'recruiter');
  check('inferContactType: hiring-manager checked before interviewer', mod.inferContactType('the interview panel has decided; message from your hiring manager') === 'hiring-manager');

  check('sanitizeCell strips tabs/newlines, trims', mod.sanitizeCell('  Jane\tDoe\n ') === 'Jane Doe');
  check('sanitizeCell handles null/undefined', mod.sanitizeCell(null) === '' && mod.sanitizeCell(undefined) === '');
  check('sanitizeCell neutralizes spreadsheet formula prefixes', mod.sanitizeCell('=1+1') === "'=1+1" && mod.sanitizeCell('+cmd') === "'+cmd");
  check('sanitizeCell separately encodes a literal apostrophe before a formula character', mod.sanitizeCell("'=1+1") === "''=1+1");
  check('sanitizeCell preserves arbitrary leading apostrophe runs', mod.sanitizeCell("''=1+1") === "'''=1+1");
}

// ---------------------------------------------------------------------------
console.log('2. appendContact — direct unit import');
{
  const mod = await import(pathToFileURL(CLI).href);

  const dir1 = tmp('contact-extract-append-');
  const contactsPath1 = join(dir1, 'data', 'contacts.tsv');
  const total1 = await mod.appendContact({ name: 'Jane Doe', company: 'Acme', type: 'recruiter', email: 'jane@acme.com', tracker: '12', notes: 'test' }, contactsPath1);
  check('appendContact: returns 1 on first write', total1 === 1, `got ${total1}`);
  const content1 = readFileSync(contactsPath1, 'utf8');
  check('appendContact: creates header comment line', content1.startsWith('# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes\n'), content1);
  check('appendContact: row has expected fields', content1.includes('Jane Doe\tAcme\trecruiter\t\t\tjane@acme.com\t\t12\ttest\n'), content1);

  const dir2 = tmp('contact-extract-append-');
  const contactsPath2 = join(dir2, 'data', 'contacts.tsv');
  mkdirSync(join(dir2, 'data'), { recursive: true });
  writeFileSync(contactsPath2, '# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes\nExisting Person\tOldCo\tpeer\t\t\t\t\t-\t\n');
  const total2 = await mod.appendContact({ name: 'Jane Doe', company: 'Acme', type: 'interviewer', email: '', tracker: '-', notes: '' }, contactsPath2);
  check('appendContact: returns 2 when one row already existed', total2 === 2, `got ${total2}`);
  const lines2 = readFileSync(contactsPath2, 'utf8').trim().split('\n');
  check('appendContact: unrelated row untouched, new row appended after it', lines2.length === 3 && lines2[1].startsWith('Existing Person') && lines2[2].startsWith('Jane Doe'), lines2.join(' | '));

  const totalAfterUpdate = await mod.appendContact({ name: 'Jane Doe', company: 'Acme', type: 'recruiter', email: 'new@acme.com', tracker: '12', notes: 'updated' }, contactsPath2);
  const updatedLines = readFileSync(contactsPath2, 'utf8').trim().split('\n');
  check('appendContact: same name+company updates instead of duplicating', totalAfterUpdate === 2 && updatedLines.length === 3, updatedLines.join(' | '));
  check('appendContact: update replaces supplied fields in place', updatedLines[2].includes('\trecruiter\t\t\tnew@acme.com\t\t12\tupdated'), updatedLines[2]);

  const dir3 = tmp('contact-extract-append-');
  const contactsPath3 = join(dir3, 'data', 'contacts.tsv');
  await mod.appendContact({ name: 'Jane\tDoe', company: 'Acme', type: 'recruiter', email: '', tracker: '-', notes: 'line1\nline2' }, contactsPath3);
  const lines3 = readFileSync(contactsPath3, 'utf8').trim().split('\n');
  check('appendContact: tab/newline-bearing fields sanitized to 9 clean cells', lines3.length === 2 && lines3[1].split('\t').length === 9, lines3[1]);

  let missingNameError = '';
  try {
    await mod.appendContact({ name: '', company: 'Acme', type: 'recruiter', email: 'only@acme.com' }, join(tmp('contact-extract-name-'), 'data', 'contacts.tsv'));
  } catch (error) {
    missingNameError = error.message;
  }
  check('appendContact: refuses an empty name before forming the identity key', missingNameError === 'Contact name is required', missingNameError);

  const formulaPath = join(tmp('contact-extract-formula-'), 'data', 'contacts.tsv');
  await mod.appendContact({ name: '=Formula Name', company: '@Acme', type: 'recruiter', email: 'safe@example.com', tracker: '12' }, formulaPath);
  await mod.appendContact({ name: '=Formula Name', company: '@Acme', type: 'interviewer', email: 'updated@example.com', tracker: '12' }, formulaPath);
  const formulaContent = readFileSync(formulaPath, 'utf8');
  const contactsMod = await import(pathToFileURL(join(ROOT, 'contacts.mjs')).href);
  const parsedFormula = contactsMod.parseContacts(formulaContent);
  check('appendContact: formula-leading cells are escaped on disk', formulaContent.includes("'=Formula Name\t'@Acme\t"), formulaContent);
  check('appendContact: escaped and raw identity forms update one row', parsedFormula.contacts.length === 1, formulaContent);
  check('contacts reader restores formula-leading values for vCard use', parsedFormula.contacts[0]?.name === '=Formula Name' && parsedFormula.contacts[0]?.company === '@Acme', JSON.stringify(parsedFormula.contacts[0]));

  const literalPath = join(tmp('contact-extract-literal-apostrophe-'), 'data', 'contacts.tsv');
  await mod.appendContact({ name: "'=Literal Name", company: "'@Literal Co", type: 'recruiter', email: 'literal@example.com', tracker: '12' }, literalPath);
  const literalContent = readFileSync(literalPath, 'utf8');
  const parsedLiteral = contactsMod.parseContacts(literalContent);
  check('appendContact: literal apostrophes use a distinct on-disk encoding', literalContent.includes("''=Literal Name\t''@Literal Co\t"), literalContent);
  check('contacts reader preserves literal apostrophes before formula characters', parsedLiteral.contacts[0]?.name === "'=Literal Name" && parsedLiteral.contacts[0]?.company === "'@Literal Co", JSON.stringify(parsedLiteral.contacts[0]));
  check('formula and literal-apostrophe values remain distinct identities', parsedLiteral.contacts[0]?.name !== parsedFormula.contacts[0]?.name);

  for (const value of ['=Alex', "'=Alex", "''=Alex", "'''=Alex"]) {
    check(`formula-cell codec round-trips ${JSON.stringify(value)}`, contactsMod.unescapeFormulaCell(contactsMod.escapeFormulaCell(value)) === value);
  }

  const retainedPath = join(tmp('contact-extract-retained-'), 'data', 'contacts.tsv');
  await mod.appendContact({ name: 'Retained Person', company: 'Acme', type: 'recruiter', title: '=Lead', phone: '+49 123', email: 'first@example.com', tracker: '12' }, retainedPath);
  await mod.appendContact({ name: 'Retained Person', company: 'Acme', type: 'interviewer', email: 'second@example.com', tracker: '12' }, retainedPath);
  const retainedContent = readFileSync(retainedPath, 'utf8');
  const parsedRetained = contactsMod.parseContacts(retainedContent);
  check('appendContact: retained optional fields are encoded exactly once', retainedContent.includes("\t'=Lead\t'+49 123\tsecond@example.com\t"), retainedContent);
  check('appendContact: retained optional fields decode to their original values', parsedRetained.contacts[0]?.title === '=Lead' && parsedRetained.contacts[0]?.phone === '+49 123', JSON.stringify(parsedRetained.contacts[0]));
}

// ---------------------------------------------------------------------------
console.log('3. CLI: auto-matches company + role via reply-matcher.mjs and saves with --yes');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, {
    subject: 'Acme Inc — Backend Engineer: interview invitation',
    from: 'Jane Doe <jane@acme.com>',
    body: 'We would like to invite you to interview for the Backend Engineer role.',
  });

  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--yes']);
  check('exit 0', res.status === 0, res.stderr);
  check('contacts.tsv created', existsSync(contactsFile));
  const content = existsSync(contactsFile) ? readFileSync(contactsFile, 'utf8') : '';
  check('row has matched company + inferred recruiter type + tracker#12', content.includes('Jane Doe\tAcme Inc\trecruiter\t\t\tjane@acme.com\t\t12\t'), content);
}

// ---------------------------------------------------------------------------
console.log('4. CLI: no auto-match and no override writes nothing, exits 0');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, {
    subject: 'Weekly digest of open roles you might like',
    from: 'noreply@somewhereelse.com',
    body: 'Check out these fresh opportunities curated just for you this week.',
  });

  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--yes']);
  check('exit 0 even with no match', res.status === 0, res.stderr);
  check('contacts.tsv NOT created', !existsSync(contactsFile));
}

// ---------------------------------------------------------------------------
console.log('5. CLI: --company/--tracker override bypasses auto-match');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, {
    subject: 'Totally unrelated newsletter',
    from: 'Jane Doe <jane@acme.com>',
    body: 'No matching keywords here at all.',
  });

  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--yes', '--company', 'Acme Inc', '--tracker', '12']);
  check('exit 0', res.status === 0, res.stderr);
  const content = existsSync(contactsFile) ? readFileSync(contactsFile, 'utf8') : '';
  check('override company/tracker used', content.includes('Jane Doe\tAcme Inc\trecruiter\t\t\tjane@acme.com\t\t12\t'), content);
}

// ---------------------------------------------------------------------------
console.log('5b. CLI: --company alone constrains tracker matching to that company');
{
  const { dir, trackerFile, contactsFile } = setupWorkspaceTwoRows();
  const emailFile = writeEmail(dir, {
    subject: 'Globex — Data Analyst update',
    from: 'Jane Doe <jane@acme.com>',
    body: 'An update about the Globex Data Analyst role.',
  });
  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--company', 'Acme Inc', '--yes']);
  const content = existsSync(contactsFile) ? readFileSync(contactsFile, 'utf8') : '';
  check('--company-only run exits 0', res.status === 0, res.stderr);
  check('--company-only run uses company and tracker from the same row', content.includes('Jane Doe\tAcme Inc\trecruiter\t\t\tjane@acme.com\t\t12\t'), content);
  check('--company-only run does not attach the Globex tracker row', !content.includes('\t34\t'), content);
}

// ---------------------------------------------------------------------------
console.log('5c. CLI: --company remains constrained when that company has multiple rows');
{
  const { dir, trackerFile, contactsFile } = setupWorkspaceTwoRows();
  const header = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
  writeFileSync(
    trackerFile,
    `${header}| 12 | 2026-06-01 | Acme Inc | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n`
    + `| 13 | 2026-06-02 | Acme Inc | Product Designer | 4.0/5 | Applied | ❌ | - | |\n`
    + `| 34 | 2026-06-03 | Globex | Data Analyst | 4.0/5 | Applied | ❌ | - | |\n`,
  );
  const emailFile = writeEmail(dir, {
    subject: 'Globex — Data Analyst update',
    from: 'Jane Doe <jane@acme.com>',
    body: 'An update about the Globex Data Analyst role.',
  });
  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--company', 'Acme Inc', '--yes']);
  check('ambiguous company-only run exits 0', res.status === 0, res.stderr);
  check('ambiguous company-only run asks for a tracker instead of crossing companies', res.stdout.includes('Could not match this reply to a single tracker row'), res.stdout);
  check('ambiguous company-only run writes nothing', !existsSync(contactsFile));
}

// ---------------------------------------------------------------------------
console.log('6. CLI: --type overrides the inferred type');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, {
    subject: 'Acme Inc — Backend Engineer',
    from: 'Jane Doe <jane@acme.com>',
    body: 'Backend Engineer interview follow-up.',
  });

  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--yes', '--type', 'interviewer']);
  check('exit 0', res.status === 0, res.stderr);
  const content = existsSync(contactsFile) ? readFileSync(contactsFile, 'utf8') : '';
  check('type overridden to interviewer', content.includes('Jane Doe\tAcme Inc\tinterviewer\t'), content);
}

// ---------------------------------------------------------------------------
console.log('7. CLI: unknown --type value exits 1 and writes nothing');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, { subject: 'Acme Inc — Backend Engineer', from: 'jane@acme.com', body: 'Backend Engineer.' });

  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--yes', '--type', 'bogus']);
  check('exit 1', res.status === 1, `status=${res.status}`);
  check('contacts.tsv not created', !existsSync(contactsFile));
}

// ---------------------------------------------------------------------------
console.log('8. CLI: interactive confirm — "n" does not save, "y" saves');
{
  const w1 = setupWorkspace();
  const emailFile1 = writeEmail(w1.dir, { subject: 'Acme Inc — Backend Engineer', from: 'Jane Doe <jane@acme.com>', body: 'Backend Engineer interview.' });
  const resNo = run(w1.trackerFile, w1.contactsFile, ['--file', emailFile1], 'n\n');
  check('"n": exit 0', resNo.status === 0, resNo.stderr);
  check('"n": nothing saved', !existsSync(w1.contactsFile));

  const w2 = setupWorkspace();
  const emailFile2 = writeEmail(w2.dir, { subject: 'Acme Inc — Backend Engineer', from: 'Jane Doe <jane@acme.com>', body: 'Backend Engineer interview.' });
  const resYes = run(w2.trackerFile, w2.contactsFile, ['--file', emailFile2], 'y\n');
  check('"y": exit 0', resYes.status === 0, resYes.stderr);
  check('"y": saved', existsSync(w2.contactsFile));
}

// ---------------------------------------------------------------------------
console.log('9. CLI: a contact name is required even when an email is present');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, { subject: 'Acme Inc — Backend Engineer', from: 'jane@acme.com', body: 'Backend Engineer interview.' });

  const res = run(trackerFile, contactsFile, ['--file', emailFile, '--yes']);
  check('exit 0', res.status === 0, res.stderr);
  check('name requirement is explained', res.stdout.includes('No contact name could be parsed'), res.stdout);
  check('nothing saved (email-only From header)', !existsSync(contactsFile));
}

// ---------------------------------------------------------------------------
console.log('9b. CLI: concurrent saves retain both contacts');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const first = join(dir, 'first.txt');
  const second = join(dir, 'second.txt');
  writeFileSync(first, 'Subject: Acme Inc — Backend Engineer\nFrom: Jane Doe <jane@acme.com>\n\nBackend Engineer interview.\n');
  writeFileSync(second, 'Subject: Acme Inc — Backend Engineer\nFrom: John Roe <john@acme.com>\n\nBackend Engineer interview.\n');
  const [a, b] = await Promise.all([
    runAsync(trackerFile, contactsFile, ['--file', first, '--tracker', '12', '--yes']),
    runAsync(trackerFile, contactsFile, ['--file', second, '--tracker', '12', '--yes']),
  ]);
  const content = existsSync(contactsFile) ? readFileSync(contactsFile, 'utf8') : '';
  check('both concurrent CLI runs exit 0', a.status === 0 && b.status === 0, `${a.stderr}\n${b.stderr}`);
  check('concurrent save retains Jane', content.includes('Jane Doe\tAcme Inc'), content);
  check('concurrent save retains John', content.includes('John Roe\tAcme Inc'), content);
}

// ---------------------------------------------------------------------------
console.log('10. CLI: missing --file path / unknown flag / --help');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();

  const resMissing = run(trackerFile, contactsFile, ['--file', join(dir, 'does-not-exist.txt')]);
  check('missing --file path exits 1', resMissing.status === 1, `status=${resMissing.status}`);

  const resBogus = run(trackerFile, contactsFile, ['--bogus']);
  check('unrecognized flag exits 1', resBogus.status === 1, `status=${resBogus.status}`);

  const resHelp = run(trackerFile, contactsFile, ['--help']);
  check('--help exits 0', resHelp.status === 0, resHelp.stderr);
  check('--help prints usage', resHelp.stdout.includes('Usage:'), resHelp.stdout);
  check('--help writes nothing to contacts.tsv', !existsSync(contactsFile));
}

// ---------------------------------------------------------------------------
console.log('11. CLI: --tracker is validated against real tracker rows (#4363 review)');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, {
    subject: 'Acme Inc — Backend Engineer', from: 'jane@acme.com', body: 'Backend Engineer interview.',
  });

  const resNonNumeric = run(trackerFile, contactsFile, ['--file', emailFile, '--yes', '--company', 'Acme Inc', '--tracker', 'abc']);
  check('non-numeric --tracker exits 1', resNonNumeric.status === 1, `status=${resNonNumeric.status}`);
  check('non-numeric --tracker writes nothing', !existsSync(contactsFile));

  const resNoSuchRow = run(trackerFile, contactsFile, ['--file', emailFile, '--yes', '--company', 'Acme Inc', '--tracker', '999']);
  check('--tracker naming a row that does not exist exits 1', resNoSuchRow.status === 1, `status=${resNoSuchRow.status}`);
  check('nonexistent --tracker row writes nothing', !existsSync(contactsFile));

  // --tracker with no operand (next token is itself a flag) is caught by
  // validateFlags's requireOperand before ever reaching the CLI's own check.
  const resMissingOperand = run(trackerFile, contactsFile, ['--file', emailFile, '--company', 'Acme Inc', '--tracker', '--yes']);
  check('--tracker with a flag where its value should be exits 1', resMissingOperand.status === 1, `status=${resMissingOperand.status}`);
  check('missing --tracker operand writes nothing', !existsSync(contactsFile));
}

// ---------------------------------------------------------------------------
console.log('12. CLI: interactive confirm — EOF on stdin declines rather than hanging (#4363 review)');
{
  const { dir, trackerFile, contactsFile } = setupWorkspace();
  const emailFile = writeEmail(dir, {
    subject: 'Acme Inc — Backend Engineer', from: 'jane@acme.com', body: 'Backend Engineer interview.',
  });

  // No --yes and no trailing "y\n"/"n\n" — stdin is closed immediately, which
  // must resolve the confirmation prompt as declined instead of leaving the
  // process hanging forever on an unresolved promise.
  const res = run(trackerFile, contactsFile, ['--file', emailFile], '');
  check('EOF on stdin exits 0 (does not hang)', res.status === 0, res.stderr);
  check('EOF on stdin declines — nothing saved', !existsSync(contactsFile));
}

// ---------------------------------------------------------------------------
console.log('13. CLI: tracker/follow-ups resolve through CAREER_OPS_ROOT, not the code root (#4363 review)');
{
  const dataRoot = tmp('contact-extract-dataroot-');
  const dataDir = join(dataRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  const header = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
  writeFileSync(join(dataDir, 'applications.md'), `${header}| 7 | 2026-06-01 | Globex | Data Analyst | 4.0/5 | Applied | ❌ | - | |\n`);
  const contactsFile = join(dataDir, 'contacts.tsv');

  const emailFile = join(dataRoot, 'email.txt');
  writeFileSync(emailFile, 'Subject: Globex — Data Analyst: interview invitation\nFrom: Pat Smith <pat@globex.com>\n\nWe would like to invite you to interview for the Data Analyst role.\n');

  // Deliberately CAREER_OPS_ROOT only — no CAREER_OPS_TRACKER — so the only
  // way this can find applications.md and write contacts.tsv is by resolving
  // both through the data root rather than the script's own directory.
  let res;
  try {
    const stdout = execFileSync(NODE, [CLI, '--file', emailFile, '--yes'], {
      cwd: ROOT,
      env: { ...cleanEnv, CAREER_OPS_ROOT: dataRoot },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    res = { status: 0, stdout };
  } catch (e) {
    res = { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }

  check('CAREER_OPS_ROOT-only run exits 0', res.status === 0, res.stderr);
  check('CAREER_OPS_ROOT-only run auto-matches and writes contacts.tsv under the data root', existsSync(contactsFile), `expected ${contactsFile} to exist`);
  if (existsSync(contactsFile)) {
    const content = readFileSync(contactsFile, 'utf8');
    check('row attached to the data-root tracker row (#7, Globex)', content.includes('Globex\trecruiter\t\t\tpat@globex.com\t\t7\t'), content);
  }
}

// ---------------------------------------------------------------------------
console.log('14. CLI: --company and --tracker must describe the same row (#4363 review)');
{
  const { dir, trackerFile, contactsFile } = setupWorkspaceTwoRows();
  const emailFile = writeEmail(dir, {
    subject: 'Unrelated', from: 'Some One <someone@example.com>', body: 'No matching keywords here.',
  });

  // --tracker 34 is Globex; --company names Acme (row #12) instead — a
  // deliberate mismatch that must be rejected rather than silently writing
  // Acme's name against Globex's tracker number.
  const resMismatch = run(trackerFile, contactsFile, [
    '--file', emailFile, '--yes', '--company', 'Acme Inc', '--tracker', '34',
  ]);
  check('conflicting --company/--tracker pair exits 1', resMismatch.status === 1, `status=${resMismatch.status}`);
  check('conflicting --company/--tracker pair writes nothing', !existsSync(contactsFile));

  // --tracker alone (no --company) must pull the company from that SAME row,
  // not from whatever matchCandidates() would have guessed off the email body.
  const resTrackerOnly = run(trackerFile, contactsFile, [
    '--file', emailFile, '--yes', '--tracker', '34',
  ]);
  check('--tracker alone exits 0', resTrackerOnly.status === 0, resTrackerOnly.stderr);
  const content = existsSync(contactsFile) ? readFileSync(contactsFile, 'utf8') : '';
  check('--tracker alone pulls company from that row (Globex, not Acme)', content.includes('Globex\trecruiter\t\t\tsomeone@example.com\t\t34\t'), content);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
