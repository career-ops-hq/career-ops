// tests/employers-registry-pr.test.mjs: what a pull request may change in the
// employer registry relative to the base branch (--base), the boards/ size
// warning, the generated CHANGELOG and the validator's CLI arguments.
//
// Split from tests/employers-registry.test.mjs (#7561); the shared setup is in
// tests/employers-registry-helpers.mjs.
//
// Run:  node --test tests/employers-registry-pr.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { BOARDS_WARN_BYTES, compareRows, renderChangelog, validateRegistry, writeChangelog } from '../seeds/employers-validate.mjs';
import { REGISTRY, COMMITTED, NEW_MANIFEST, NEW_ROW, checkout, editRow, insertRow, pr, readJson, reg, rowsOf, run, writeJson } from './employers-registry-helpers.mjs';

// ── 4. Pull-request rules (--base), the size limit, the CHANGELOG ─────────

function addContribution(dir, row = NEW_ROW) {
  writeJson(reg(dir, 'contributions', `${NEW_MANIFEST.id}.json`), NEW_MANIFEST);
  insertRow(dir, row);
  // No CHANGELOG.md edit: a contribution does not touch it.
}
// Not retired, so that retiring it is a change.
const firstRow = () => rowsOf(REGISTRY).find((r) => !r.row.retired).row;


test('--base: a contribution with its own manifest passes, without touching CHANGELOG.md', () => {
  const r = pr((head) => {
    addContribution(head);
    assert.equal(readFileSync(reg(head, 'CHANGELOG.md'), 'utf8'), readFileSync(join(REGISTRY, 'CHANGELOG.md'), 'utf8'));
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'no warnings either');
});

test('--base: a base with no registry (the bootstrap PR) counts every row as new', () => {
  const empty = mkdtempSync(join(tmpdir(), 'co-employers-base-'));
  // A registry that starts has no retired row (a new row cannot be retired), and the real one may
  // have some: the copy it is checked from drops those marks.
  const head = checkout();
  try {
    // One pass per file. Looking each retired row up with editRow() read the whole registry once per
    // retired row, so this test grew with the registry times its retired rows.
    for (const ats of readdirSync(reg(head, 'boards'))) {
      for (const f of readdirSync(reg(head, 'boards', ats))) {
        const path = reg(head, 'boards', ats, f);
        const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
        const next = lines.map((l) => {
          const { retired, retired_reason, ...rest } = JSON.parse(l);
          return retired === true ? JSON.stringify(rest) : l;
        });
        if (next.some((l, i) => l !== lines[i])) writeFileSync(path, `${next.join('\n')}\n`);
      }
    }
    const r = run(head, ['--base', empty]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /counts as new/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(head, { recursive: true, force: true });
  }
});

test('--base: a deleted row fails; rows are retired, never deleted', () => {
  const r = pr((head) => {
    const victim = firstRow();
    editRow(head, victim.careers_url, () => null);
    const m = readJson(reg(head, 'contributions', `${victim.contribution}.json`));
    writeJson(reg(head, 'contributions', `${victim.contribution}.json`), { ...m, rows: m.rows - 1 });
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /was removed; rows are retired \(retired: true, retired_reason\), never deleted/);
});

test('--base: a new row on an already merged manifest fails', () => {
  const r = pr((head) => {
    const id = firstRow().contribution;
    const m = readJson(reg(head, 'contributions', `${id}.json`));
    writeJson(reg(head, 'contributions', `${id}.json`), { ...m, rows: m.rows + 1 });
    insertRow(head, { ...NEW_ROW, contribution: id, added: m.date });
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /which is already merged; new rows come with their own manifest/);
  assert.match(r.stderr, /warning: .*edits a manifest that is already merged/);
});

test('--base: a contribution cannot retire an existing row', () => {
  const r = pr((head) => {
    addContribution(head);
    editRow(head, firstRow().careers_url, (row) => ({ ...row, retired: true, retired_reason: 'gone' }));
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a contribution pull request \(it adds a manifest\) cannot change retired or retired_reason/);
});

test('--base: a maintainer change that only retires a row passes', () => {
  const r = pr((head) => editRow(head, firstRow().careers_url, (row) => ({ ...row, retired: true, retired_reason: 'owner_request' })));
  assert.equal(r.status, 0, r.stderr);
});

test('--base: a new row cannot arrive retired', () => {
  const r = pr((head) => addContribution(head, { ...NEW_ROW, retired: true, retired_reason: 'gone' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a new row cannot be retired/);
});

test('--base: the provenance of an existing row is fixed', () => {
  const r = pr((head) => editRow(head, firstRow().careers_url, (row) => ({ ...row, added: row.added === '2026-11-09' ? '2026-11-10' : '2026-11-09' })));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /changes added of an existing row \(was "\d{4}-\d{2}-\d{2}"\); provenance is fixed once merged/);
});

// A second spelling of a merged board fails on the newcomer, wherever it sorts.
// Workday's API answers any letter case, so the registry stores the case of the
// careers page's canonical link; CrowdStrike's is all lowercase, which makes an
// uppercase newcomer sort BEFORE the merged row.
const CROWDSTRIKE = 'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers';
const GUIDEWIRE = 'https://wd5.myworkdaysite.com/recruiting/guidewire/external';

/** Add one Workday row under a new manifest and return the file's lines, sorted as the format requires. */
function addWorkdayVariant(dir, board, workdayHost) {
  const row = {
    ats: 'workday', board, workday_host: workdayHost,
    careers_url: workdayHost === 'jobs'
      ? `https://${board.split('/')[0]}.${board.split('/')[1]}.myworkdayjobs.com/${board.split('/')[2]}`
      : `https://${board.split('/')[1]}.myworkdaysite.com/recruiting/${board.split('/')[0]}/${board.split('/')[2]}`,
    name: 'Variant', source: 'community', contribution: NEW_MANIFEST.id, added: NEW_MANIFEST.date,
  };
  writeJson(reg(dir, 'contributions', `${NEW_MANIFEST.id}.json`), NEW_MANIFEST);
  const path = reg(dir, 'boards', 'workday', `${board[0]}.ndjson`);
  const rows = [...readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)), row];
  rows.sort(compareRows);
  writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return rows.map((r) => r.careers_url);
}

test('the committed Workday rows keep the case of the careers page canonical link', () => {
  const workdayRows = rowsOf(REGISTRY).filter((r) => r.row.ats === 'workday').map((r) => r.row);
  assert.ok(workdayRows.some((r) => r.workday_host === 'jobs') && workdayRows.some((r) => r.workday_host === 'site'), 'both host forms');
  assert.ok(workdayRows.some((r) => r.board === 'nvidia/wd5/NVIDIAExternalCareerSite'));
  assert.ok(workdayRows.some((r) => r.careers_url === CROWDSTRIKE));
});

test('--base: a letter-case variant of a merged board fails on the new row, even when it sorts first', () => {
  const head = checkout();
  try {
    const order = addWorkdayVariant(head, 'crowdstrike/wd5/CrowdStrikeCareers', 'jobs');
    const newLine = order.indexOf('https://crowdstrike.wd5.myworkdayjobs.com/CrowdStrikeCareers') + 1;
    const keptLine = order.indexOf(CROWDSTRIKE) + 1;
    assert.ok(newLine < keptLine, 'the variant sorts before the merged row');
    const r = run(head, ['--base', COMMITTED]);
    assert.equal(r.status, 1);
    const file = 'employers/boards/workday/c.ndjson';
    assert.match(r.stderr, new RegExp(`${file}:${newLine}: careers_url differs only in letter case from ${file}:${keptLine}, which is already merged and keeps its spelling`));
    assert.ok(!r.stderr.includes(`${file}:${keptLine}: `), `the merged row must not be the one reported:\n${r.stderr}`);
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('--base: a merged Workday board added again under the other host form fails on the new row', () => {
  const head = checkout();
  try {
    const order = addWorkdayVariant(head, 'guidewire/wd5/external', 'jobs');
    const newLine = order.indexOf('https://guidewire.wd5.myworkdayjobs.com/external') + 1;
    const keptLine = order.indexOf(GUIDEWIRE) + 1;
    const r = run(head, ['--base', COMMITTED]);
    assert.equal(r.status, 1);
    const file = 'employers/boards/workday/g.ndjson';
    assert.match(r.stderr, new RegExp(`${file}:${newLine}: the same Workday board as ${file}:${keptLine}, which is already merged and keeps its spelling, under the other host form`));
    assert.ok(!r.stderr.includes(`${file}:${keptLine}: `), r.stderr);
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('boards/ has no hard size limit: above 25 MB it is a warning, never an error', () => {
  assert.equal(BOARDS_WARN_BYTES, 25 * 1024 * 1024);
  const head = checkout();
  try {
    // One oversized row: its name is an error of its own, but the size is only a warning.
    mkdirSync(reg(head, 'boards', 'breezy'), { recursive: true });
    writeFileSync(reg(head, 'boards', 'breezy', 'f.ndjson'), `${JSON.stringify({ ...NEW_ROW, name: 'x'.repeat(BOARDS_WARN_BYTES) })}\n`);
    const { errors, warnings } = validateRegistry({ root: head });
    assert.ok(warnings.some((w) => w.file === 'employers/boards' && /^boards\/ is \d+(?:\.\d+)? MB, above 25 MB/.test(w.message)), JSON.stringify(warnings));
    assert.deepEqual(errors.filter((e) => e.file === 'employers/boards'), [], 'the size is never an error');
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('boards/ under the warning size is quiet, and the threshold is the only trigger', () => {
  const quiet = validateRegistry({ root: COMMITTED });
  assert.deepEqual(quiet.warnings, []);
  const tight = validateRegistry({ root: COMMITTED, boardsWarnBytes: 1024 });
  assert.deepEqual(tight.errors, []);
  assert.deepEqual(tight.warnings.map((w) => w.file), ['employers/boards']);
});

test('CHANGELOG.md is generated by --write-changelog and not compared with the manifests', () => {
  const manifests = readdirSync(join(REGISTRY, 'contributions')).map((f) => readJson(join(REGISTRY, 'contributions', f)));
  for (const m of manifests) assert.ok(renderChangelog(manifests).includes(`\`${m.id}\` (${m.rows} boards, source \`${m.source}\`): ${m.attribution}`));

  const head = checkout();
  try {
    writeFileSync(reg(head, 'CHANGELOG.md'), '# edited by hand\n');
    const stale = run(head);
    assert.equal(stale.status, 0, stale.stderr);
    assert.equal(stale.stderr, '', 'a stale CHANGELOG.md is neither an error nor a warning');
    const r = run(head, ['--write-changelog']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(reg(head, 'CHANGELOG.md'), 'utf8'), renderChangelog(manifests));
    // writeChangelog() is what --write-changelog calls.
    writeFileSync(reg(head, 'CHANGELOG.md'), '');
    writeChangelog(head);
    assert.equal(readFileSync(reg(head, 'CHANGELOG.md'), 'utf8'), renderChangelog(manifests));
  } finally { rmSync(head, { recursive: true, force: true }); }
});

test('the CLI rejects unknown arguments and a missing --base directory with exit 2', () => {
  assert.equal(run(ROOT, ['--nope']).status, 2);
  assert.equal(run(ROOT, ['--base', join(tmpdir(), 'co-employers-does-not-exist')]).status, 2);
});
