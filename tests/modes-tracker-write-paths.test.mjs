// tests/modes-tracker-write-paths.test.mjs — the mode prompts send tracker
// writes through the canonical writers, never through a hand edit.
//
// `modes/_shared.md` is loaded by every evaluation, and its Tools table said
// `Write → applications.md` and `Edit → Update tracker`, eleven lines below the
// rule that says never to edit applications.md directly. Fourteen localized
// copies carried the same two rows. A direct Write or Edit skips the lock that
// merge-tracker.mjs, set-status.mjs, the web and the dashboard share, and a
// hand-edited status never reaches data/status-log.tsv, so funnel and velocity
// stats go wrong with no error.
//
// A prompt contradiction produces no failing run, which is why it lasted since
// the first release. These checks read the tables themselves, in every
// language, by the tool name in the first cell (the one part no translation
// changes).
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

const sharedFiles = ['modes/_shared.md', ...readdirSync(join(ROOT, 'modes'), { withFileTypes: true })
  .filter(e => e.isDirectory() && existsSync(join(ROOT, 'modes', e.name, '_shared.md')))
  .map(e => `modes/${e.name}/_shared.md`)].sort();

/** The Tools-table row for one tool: `| Write | … |` or `| **Write** | … |`. */
function toolRow(text, tool) {
  const re = new RegExp(`^\\|\\s*\\*{0,2}${tool}\\*{0,2}\\s*\\|(.*)\\|\\s*$`, 'm');
  return text.match(re)?.[1].trim() ?? null;
}

const withTable = sharedFiles.filter(f => toolRow(read(f), 'Write') !== null);

ok('the Tools table is found in the English _shared.md and its localized copies', () => {
  assert.ok(withTable.includes('modes/_shared.md'), 'modes/_shared.md has no Write row');
  // The audit counted 14 localized copies plus three already-corrected ones.
  // A recognizer that silently stops matching would pass everything below.
  assert.ok(withTable.length >= 18, `only ${withTable.length} Tools tables recognized: ${withTable.join(', ')}`);
  for (const f of withTable) assert.ok(toolRow(read(f), 'Edit') !== null, `${f}: Write row found but no Edit row`);
  for (const f of withTable) assert.ok(toolRow(read(f), 'Bash') !== null, `${f}: Write row found but no Bash row`);
});

for (const file of withTable) {
  ok(`${file}: Write points new tracker rows at the TSV additions directory`, () => {
    const row = toolRow(read(file), 'Write');
    assert.ok(row.includes('batch/tracker-additions/'), `Write row: "${row}"`);
  });
  ok(`${file}: Edit points status changes at set-status.mjs and new rows at merge-tracker.mjs`, () => {
    const row = toolRow(read(file), 'Edit');
    assert.ok(row.includes('set-status.mjs'), `Edit row: "${row}"`);
    assert.ok(row.includes('merge-tracker.mjs'), `Edit row: "${row}"`);
  });
  // The Write and Edit rows send the agent to two scripts. A Bash row that
  // lists generate-pdf.mjs alone reads as if those two were not allowed.
  ok(`${file}: Bash lists the two tracker writers next to generate-pdf.mjs`, () => {
    const row = toolRow(read(file), 'Bash');
    for (const script of ['generate-pdf.mjs', 'merge-tracker.mjs', 'set-status.mjs']) {
      assert.ok(row.includes(`node ${script}`), `Bash row: "${row}"`);
    }
  });
}

ok('no localized rule 9 still allows hand-editing existing tracker rows', () => {
  // The Russian and Ukrainian copies said direct editing of existing rows was
  // acceptable for status/notes, in the sentence right after the TSV rule.
  for (const file of sharedFiles) {
    const rule = read(file).split('\n').find(l => /^9\.\s/.test(l) && l.includes('batch/tracker-additions/'));
    assert.ok(rule, `${file}: rule 9 (tracker additions as TSV) not found`);
    assert.ok(!/допустим/i.test(rule), `${file}: rule 9 still permits a direct edit`);
  }
});

/** The body of one `### N. Title` / `## Title` section, up to the next heading of that depth. */
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim() === heading);
  assert.ok(start !== -1, `heading "${heading}" not found`);
  const depth = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${depth}}\\s`).test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

ok('oferta.md "Record in tracker" goes through the TSV and merge-tracker', () => {
  const step = section(read('modes/oferta.md'), '### 2. Record in tracker');
  assert.ok(step.includes('node merge-tracker.mjs'), 'does not name merge-tracker.mjs');
  assert.ok(step.includes('TSV Format for Tracker Additions'), 'does not point at the TSV spec');
  assert.ok(!/record in `data\/applications\.md`/i.test(step), 'still says to record in applications.md');
  // A confirmed agency must not be dropped by a tracker with no Via column.
  assert.ok(step.includes('--migrate-via'), 'does not say how to keep a confirmed Via');
});

ok('oferta.md takes the salary line\'s tracker number after the merge', () => {
  const step = section(read('modes/oferta.md'), '### 3. Salary observations (desired ask only)');
  assert.match(step, /after\*{0,2} the merge/i);
});

ok('the other English steps name the writer instead of the tracker file', () => {
  assert.ok(section(read('modes/auto-pipeline.md'), '## Step 5 — Update Tracker').includes('node merge-tracker.mjs'));
  assert.ok(section(read('modes/pdf.md'), '## Post-generation').includes('node mark-pdf-ready.mjs'));
  const followup = read('modes/followup.md').split('\n').find(l => l.includes('Follow-up {N} sent'));
  assert.ok(followup && followup.includes('node set-status.mjs'), 'followup.md notes step does not use set-status.mjs');
});

// ── The apply modes' role-change step ────────────────────────────────────────
// Every apply mode asks the candidate whether to re-evaluate or adapt when the
// role on screen differs from the evaluated one ("... from [X] to [Y] ..."). The
// step then ended "change the role title in applications.md", in English and
// in fifteen translations, and named no writer: the one edit the modes asked for
// that an agent could only make by hand. The `[X]`/`[Y]` prompt is the part no
// translation changes, so it is how the step is found in every language.
const modeFiles = [
  ...readdirSync(join(ROOT, 'modes')).filter(f => f.endsWith('.md')).map(f => `modes/${f}`),
  ...readdirSync(join(ROOT, 'modes'), { withFileTypes: true }).filter(e => e.isDirectory()).flatMap(e =>
    readdirSync(join(ROOT, 'modes', e.name)).filter(f => f.endsWith('.md')).map(f => `modes/${e.name}/${f}`)),
].sort();
const isRolePrompt = (l) => l.includes('[X]') && l.includes('[Y]') && /^\s*-\s/.test(l);

/** The bullet list that starts at the "[X] to [Y]" prompt, sub-bullets included. */
function roleChangeStep(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(isRolePrompt);
  if (start === -1) return null;
  let end = start;
  while (end + 1 < lines.length && /^\s*-\s/.test(lines[end + 1])) end++;
  return lines.slice(start, end + 1).join('\n');
}

const applyModes = modeFiles.filter(f => roleChangeStep(read(f)) !== null);

ok('the role-change step is found in the English apply mode and its translations', () => {
  assert.ok(applyModes.includes('modes/apply.md'), 'modes/apply.md has no role-change step');
  // English plus 18 locales at the time of writing. A recognizer that silently
  // stops matching would pass everything below.
  assert.ok(applyModes.length >= 19, `only ${applyModes.length} apply modes recognized: ${applyModes.join(', ')}`);
});

for (const file of applyModes) {
  ok(`${file}: a changed role title reaches the tracker through merge-tracker.mjs`, () => {
    const step = roleChangeStep(read(file));
    assert.ok(step.includes('node merge-tracker.mjs'), `the role-change step names no writer:\n${step}`);
  });
  ok(`${file}: no note in the step carries a placeholder for page text`, () => {
    // The new title `[Y]` is read off the page. Inside `--note "..."` it would be
    // spliced into a shell command, where `$(...)` or backticks in a title run.
    // The note is fixed wording, so the quoted argument holds no placeholder.
    const notes = [...roleChangeStep(read(file)).matchAll(/--note\s+"([^"]*)"/g)].map(m => m[1]);
    for (const note of notes) assert.ok(!/[[\]{}<>$`]/.test(note), `--note carries a placeholder or shell syntax: "${note}"`);
  });
  ok(`${file}: Applied is set through set-status.mjs`, () => {
    const line = read(file).split('\n').find(l => l.includes('set-status.mjs') && l.includes('Applied'));
    assert.ok(line, 'no line sets Applied with set-status.mjs');
  });
}

ok('apply.md says what each path does to the row', () => {
  const step = roleChangeStep(read('modes/apply.md'));
  assert.ok(!/change role title in applications\.md/i.test(step), 'still says to change the title in applications.md');
  assert.match(step, /status is kept/, 'does not say a re-evaluation keeps the row\'s status');
  assert.ok(step.includes('node set-status.mjs') && step.includes('--note'), 'the adaptation path does not record the new title as a note');
});

// What the step now promises, run against the real merge: a TSV that carries the
// row's report number replaces the title and keeps the status, and a TSV cannot
// change an existing row's status (the Korean apply mode sent "Applied" that way,
// which merged cleanly and left the row on Evaluated).
function mergeOnto(status, tsvRow, fn, company = 'Acme') {
  const dir = mkdtempSync(join(tmpdir(), 'modes-tracker-write-'));
  try {
    for (const d of ['data', 'reports', 'batch/tracker-additions']) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, 'reports', '042-acme-2026-09-01.md'), '# report\n');
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker', '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|---|---|---|---|---|---|---|---|',
      `| 42 | 2026-09-01 | ${company} | Backend Engineer | 4.2/5 | ${status} | ✅ | [42](../reports/042-acme-2026-09-01.md) | first pass |`,
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'batch', 'tracker-additions', '042-acme.tsv'),
      `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n${tsvRow}\n`);
    const r = spawnSync(NODE, [join(ROOT, 'merge-tracker.mjs')], { encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir } });
    assert.equal(r.status, 0, `merge-tracker exited ${r.status}: ${r.stderr}`);
    const rows = readFileSync(join(dir, 'data', 'applications.md'), 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
    fn(rows.map(row => row.split('|').map(c => c.trim())));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const REPORT_42 = '[42](reports/042-acme-2026-09-01.md)';

ok('a TSV carrying the row\'s report number replaces the title and keeps the status', () => {
  mergeOnto('Applied', `42\t2026-09-01\tAcme\tPlatform Engineer\tEvaluated\t4.2/5\t✅\t${REPORT_42}\tretitled`, (rows) => {
    assert.equal(rows.length, 1, 'the merge added a second row');
    assert.equal(rows[0][4], 'Platform Engineer');
    assert.equal(rows[0][6], 'Applied');
  });
});

ok('a TSV does not change an existing row\'s status', () => {
  mergeOnto('Evaluated', `42\t2026-09-01\tAcme\tBackend Engineer\tApplied\t4.2/5\t✅\t${REPORT_42}\tsubmitted`, (rows) => {
    assert.equal(rows.length, 1);
    assert.equal(rows[0][6], 'Evaluated');
  });
});

// ── tracker.md: the remaining cells, and the employer reveal ─────────────────
// The tracker mode ended its status paragraph "Hand-edit only what set-status
// can't express (non-status cells)", and its reveal workflow began "Edit the
// row's Company cell in place". Neither names applications.md, so a search for
// the file name does not find them.
ok('tracker.md sends every cell through a writer', () => {
  const text = read('modes/tracker.md');
  assert.ok(!/hand-edit only/i.test(text), 'still tells the agent to hand-edit the non-status cells');
  const reveal = text.split('\n').find(l => /^1\.\s/.test(l) && l.includes('`?`'));
  assert.ok(reveal, 'reveal step 1 not found');
  assert.ok(!/edit the row's company cell in place/i.test(reveal), 'still says to edit the Company cell in place');
  assert.ok(reveal.includes('node merge-tracker.mjs'), `reveal step 1 names no writer: "${reveal}"`);
});

ok('a TSV carrying the row\'s report link renames a `?` row and keeps its number and status', () => {
  mergeOnto('Applied', `42\t2026-09-01\tBarclays\tBackend Engineer\tApplied\t4.2/5\t✅\t${REPORT_42}\temployer revealed`, (rows) => {
    assert.equal(rows.length, 1, 'the merge added a second row');
    assert.equal(rows[0][1], '42');
    assert.equal(rows[0][3], 'Barclays');
    assert.equal(rows[0][6], 'Applied');
  }, '?');
});
