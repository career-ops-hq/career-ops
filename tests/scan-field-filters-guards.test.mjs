// tests/scan-field-filters-guards.test.mjs — #3438, accounting under awkward input.
//
// The per-(target, field) presence counters behind the end-of-run warning, on
// configs that are legal but easy to miscount: two targets sharing a name, and
// a board whose code-bearing postings are blacklisted. Bad config shapes are
// covered by tests/scan-field-filters-parity.test.mjs, through both tools.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

console.log('\nscan.mjs — filter_on presence accounting');

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

// ── Two enabled targets sharing one name ───────────────────────────
// A duplicate enabled name is only a validate-portals WARNING, so this config
// is legal. If the counters merged by name, the second board's noc would
// suppress the first board's all-absent warning.
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
// Presence is counted before the blacklist skip: whether a provider publishes
// a field cannot depend on the user's do-not-apply list. Counted after it,
// only the code-less posting would be seen and the run would report "noc
// absent on all 1 job". The board must be MIXED — blacklisting every posting
// keeps the seen count at zero, so the warning is silent either way.
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
