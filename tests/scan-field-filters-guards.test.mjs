// tests/scan-field-filters-guards.test.mjs — #3438, second review round.
//
// Each case here BREAKS a guard rather than confirming it on good input. The
// first round's tests all passed while three real defects sat in the code,
// because they asserted that correct configs behave correctly.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — filter_on guards (bad input)');

function scanWith(portalsBody, { blacklist = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-ffg-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    if (blacklist) writeFileSync(join(dir, 'data', 'blacklist.md'), blacklist);
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, portalsBody);
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      stdout = execFileSync(NODE, [join(ROOT, 'scan.mjs')], {
        cwd: dir,
        env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stdout = String(err.stdout || '');
      stderr = String(err.stderr || '');
    }
    const p = join(dir, 'data', 'pipeline.md');
    const urls = existsSync(p)
      ? readFileSync(p, 'utf-8').split('\n').filter(l => /^- \[[ x]\]\s+https?:\/\//.test(l))
      : [];
    return { stdout, stderr, exitCode, urls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TITLE = `title_filter:
  positive:
    - "Help Desk"
`;

// ── A misspelled key inside a field_filters block ──────────────────
// scan.mjs never calls validatePortalsConfig — that is a separate CLI. Without
// a startup check, `positve` leaves positive undefined, buildTitleFilter reads
// an empty positive list as "no positive constraint", and the declared
// whitelist passes every posting while the summary reports it as configured.
{
  const { exitCode, stderr, urls } = scanWith(`${TITLE}field_filters:
  noc:
    positve: ["stem:22"]
tracked_companies:
  - name: Fixture Board
    careers_url: https://example.invalid/jobs
    filter_on: noc
    parser:
      command: node
      script: tests/fixtures/noc-board.mjs
`);
  if (exitCode !== 0) pass('a misspelled key in a field_filters block exits the scan');
  else fail('the scan ran with a typo that makes the whitelist pass everything');
  if (/field_filters\.noc\.positve/.test(stderr)) pass('the error names the offending key');
  else fail(`expected the key in stderr, got: ${stderr}`);
  if (urls.length === 0) pass('nothing was written to the pipeline');
  else fail(`expected an empty pipeline, got ${urls.length} entr(y/ies)`);
}

// A block with neither list is the same pass-all, spelled differently — and
// so is a block whose lists contain nothing buildTitleFilter can compile.
{
  const { exitCode, stderr } = scanWith(`${TITLE}field_filters:
  noc: {}
tracked_companies:
  - name: Fixture Board
    careers_url: https://example.invalid/jobs
    filter_on: noc
    parser:
      command: node
      script: tests/fixtures/noc-board.mjs
`);
  if (exitCode !== 0 && /no usable keyword/.test(stderr)) {
    pass('an empty field_filters block exits rather than matching everything');
  } else {
    fail(`expected an exit naming the empty block, got code ${exitCode}: ${stderr}`);
  }
}

// ── field_filters.title, with no title_filter to fall back on ──────
// The pass-all trap in its most convincing form: the user is reading a
// positive list they believe is in force, while `title` routes to the absent
// top-level title_filter and buildTitleFilter compiles "no constraint".
{
  const { exitCode, stderr, urls } = scanWith(`field_filters:
  title:
    positive: ["Help Desk"]
tracked_companies:
  - name: Fixture Board
    careers_url: https://example.invalid/jobs
    filter_on: title
    parser:
      command: node
      script: tests/fixtures/noc-board.mjs
`);
  if (exitCode !== 0) pass('a field_filters.title block exits instead of silently passing every title');
  else fail(`the scan ran with an unread title whitelist and queued ${urls.length} posting(s)`);
  if (/field_filters.title is never read/.test(stderr)) pass('the error says where the keywords belong');
  else fail(`expected the explanation in stderr, got: ${stderr}`);
}

// ── A well-formed array that still compiles to nothing ─────────
// buildTitleFilter drops every non-string and blank entry, so Array.isArray
// says "configured" while the compiled positive list is empty — the same
// pass-all, reached through a list that looks populated.
{
  const { exitCode, stderr, urls } = scanWith(`${TITLE}field_filters:
  noc:
    positive: [123, null]
tracked_companies:
  - name: Fixture Board
    careers_url: https://example.invalid/jobs
    filter_on: noc
    parser:
      command: node
      script: tests/fixtures/noc-board.mjs
`);
  if (exitCode !== 0) pass('a keyword list with no usable entry exits');
  else fail(`the scan ran with an empty compiled whitelist and queued ${urls.length} posting(s)`);
  if (/no usable keyword/.test(stderr)) pass('the error says the list compiles to nothing');
  else fail(`expected the explanation in stderr, got: ${stderr}`);
}

// ── An empty filter_on silently became ["title"] ──────────────
// Gating on a field the user did not ask for is quieter than failing, and
// with no title_filter present it gates on nothing at all.
{
  const { exitCode, stderr } = scanWith(`field_filters:
  noc:
    positive: ["stem:22"]
tracked_companies:
  - name: Fixture Board
    careers_url: https://example.invalid/jobs
    filter_on: []
    parser:
      command: node
      script: tests/fixtures/noc-board.mjs
`);
  if (exitCode !== 0 && /no usable field name/.test(stderr)) pass('an empty filter_on exits instead of falling back to title');
  else fail(`expected an exit, got code ${exitCode}: ${stderr}`);
}

// ── Two enabled targets sharing one name ───────────────────────────
// A duplicate enabled name is only a validate-portals WARNING, so this config
// is legal. Keyed by name, the second board's noc suppressed the first board's
// all-absent warning.
{
  const { stdout } = scanWith(`${TITLE}field_filters:
  noc:
    positive: ["stem:22"]
tracked_companies:
  - name: Same Name
    careers_url: https://example.invalid/a
    filter_on: noc
    parser:
      command: node
      script: tests/fixtures/noc-less-board.mjs
  - name: Same Name
    careers_url: https://example.invalid/b
    filter_on: noc
    parser:
      command: node
      script: tests/fixtures/noc-board-two.mjs
`);
  if (/"noc" absent on all 2 job\(s\)/.test(stdout)) {
    pass('the board that never publishes noc is still reported when a same-named board does');
  } else {
    fail(`expected the all-absent warning for the first target:\n${stdout}`);
  }
}

// ── The field-bearing postings are blacklisted, one other is not ───
// The blacklist skip runs before the gate. With presence accounting inside
// the gate, only the code-less posting was ever counted and the run reported
// "noc absent on all 1 job" — a statement about the provider produced by the
// user's own do-not-apply list. Blacklisting every posting would NOT catch
// this: the seen count stays zero and the warning is silent either way.
{
  const { stdout } = scanWith(`${TITLE}field_filters:
  noc:
    positive: ["stem:22"]
tracked_companies:
  - name: Blocked Board
    careers_url: https://example.invalid/bl
    filter_on: noc
    parser:
      command: node
      script: tests/fixtures/blacklisted-noc-board.mjs
`, { blacklist: `# Do-not-apply

| Company | Since | Scope | Reason |
|---|---|---|---|
| Blocked Co | 2026-09-20 | all | fixture |
` });
  if (!/Declared field never observed/.test(stdout)) {
    pass('blacklisted postings do not make the provider look like it omits the field');
  } else {
    fail(`the dead-declaration warning fired on blacklisted postings:\n${stdout}`);
  }
}
