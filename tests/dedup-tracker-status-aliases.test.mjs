// tests/dedup-tracker-status-aliases.test.mjs — dedup-tracker.mjs ranks every
// spelling of a status the way templates/states.yml defines it.
//
// dedup-tracker.mjs used to rank statuses from a hand-copied table of spellings.
// A row whose Status was an alias that table did not carry ("Sent", "Aplicada",
// "Başvuruldu", "Mülakat"...) ranked 0, the same as SKIP. Two consequences, both
// silent:
//
//   - isAdvancedStatus() was false, so the "an Applied row is never deleted
//     because a higher-scored exact-title sibling exists" guard did not apply
//     and the in-flight application (report link, PDF flag, notes) was removed;
//   - when the rows were the same report, the more advanced alias status lost
//     the promotion contest and the keeper stayed on Evaluated.
//
// The table now holds the rank ORDER only, keyed by states.yml id, and every
// cell is resolved through states.yml. So the suite checks every label and alias
// states.yml declares, not a sample, and it checks what the script does when
// states.yml cannot be read: with no vocabulary every status would rank 0, so it
// must stop before it touches the tracker.
//
// Drives the REAL dedup-tracker.mjs CLI against a temp tracker via the
// CAREER_OPS_TRACKER hook: the deletion is what loses data, so the rows left in
// the file are what is asserted.
import { pass, fail, rmSync, linkRepoPackage, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const trackerText = (rows) => ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n');

function withTracker(rows, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-alias-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, trackerText(rows));
    const r = spawnSync(process.execPath, [DEDUP], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    assert.equal(r.status, 0, `dedup-tracker exited ${r.status}: ${r.stderr}`);
    fn(readFileSync(tracker, 'utf-8').split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cells = (row) => row.split('|').map((c) => c.trim());
const nums = (rows) => rows.map((r) => cells(r)[1]).sort();

// Aliases of states at or above Applied that the old table never carried.
for (const alias of ['Sent', 'Aplicada', 'Enviada', 'Başvuruldu', 'Mülakat', 'Teklif', 'TEKLİF']) {
  ok(`an exact-title duplicate is not removed when the other row's status is the alias "${alias}"`, () => {
    withTracker([
      '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | re-evaluated |',
      `| 2 | 2026-08-20 | Acme | Backend Engineer | 4.0/5 | ${alias} | ✅ | [2](reports/002-acme-2026-08-20.md) | sent by email |`,
    ], (rows) => {
      assert.deepEqual(nums(rows), ['1', '2'], 'the in-flight application must survive');
    });
  });
}

ok('the same report under an alias status promotes the keeper instead of losing the status', () => {
  withTracker([
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | [7](reports/007-acme-2026-09-01.md) | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | Mülakat | ❌ | [7](reports/007-acme-2026-09-01.md) | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
    assert.equal(cells(rows[0])[6], 'Mülakat', 'the more advanced status of the removed row is promoted');
  });
});

ok('a states.yml alias below Applied still merges as before', () => {
  withTracker([
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | Hold | ❌ | — | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1']);
  });
});

ok('a canonical Applied row is still protected (regression guard)', () => {
  withTracker([
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | Applied | ✅ | — | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2']);
  });
});

// The legacy cell shape: bold wrappers and a date after the status word. The
// script's own normalizer used to strip these; the shared resolver does now.
ok('a bold alias with a trailing date ("**Entrevista** 2026-06-01") is still read as Interview', () => {
  withTracker([
    '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | first |',
    '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | **Entrevista** 2026-06-01 | ✅ | — | second |',
  ], (rows) => {
    assert.deepEqual(nums(rows), ['1', '2']);
  });
});

// ── Every spelling states.yml declares ──────────────────────────────────────
// One company per spelling, each holding a higher-scored Evaluated row and a
// lower-scored row under that spelling, with the same role title and no report
// identity in common. If the spelling is read as Applied or later, both rows
// survive; if not, the pair merges into the Evaluated row. One run of the CLI
// covers all of them.
//
// Which states count as "in motion" is the script's policy, restated here on
// purpose: a new state in states.yml fails the first check below until someone
// decides which side of the line it is on.
const IN_MOTION = ['applied', 'responded', 'assessment', 'interview', 'offer', 'hired'];
const NOT_IN_MOTION = ['evaluated', 'rejected', 'discarded', 'skip'];

const { loadCanonicalStates } = await import(pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href);
const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));

ok('every state in states.yml is classified here as in motion or not', () => {
  const unclassified = states.map((s) => s.id.toLowerCase()).filter((id) => !IN_MOTION.includes(id) && !NOT_IN_MOTION.includes(id));
  assert.deepEqual(unclassified, [], `states.yml has a state this suite does not classify: ${unclassified.join(', ')}`);
});

// "Qaa", "Qab", ...: distinct company names with no digits or suffixes for
// normalizeCompany to fold together.
const companyName = (i) => `Q${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
const spellings = states.flatMap((s) => [s.label, ...s.aliases].map((text) => ({ text, id: s.id.toLowerCase() })));
const pairs = spellings.map((spelling, i) => ({ ...spelling, company: companyName(i), keeperNum: String(2 * i + 1), otherNum: String(2 * i + 2) }));

ok(`all ${spellings.length} labels and aliases in states.yml are ranked as the state they name`, () => {
  const rows = pairs.flatMap((p) => [
    `| ${p.keeperNum} | 2026-09-01 | ${p.company} | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | first |`,
    `| ${p.otherNum} | 2026-09-02 | ${p.company} | Backend Engineer | 3.0/5 | ${p.text} | ❌ | — | second |`,
  ]);
  withTracker(rows, (after) => {
    const left = new Set(after.map((r) => cells(r)[1]));
    const wrong = [];
    for (const p of pairs) {
      if (!left.has(p.keeperNum)) wrong.push(`"${p.text}": the Evaluated keeper was removed`);
      const survived = left.has(p.otherNum);
      const inMotion = IN_MOTION.includes(p.id);
      if (inMotion && !survived) wrong.push(`"${p.text}" (${p.id}): the in-flight row was deleted`);
      if (!inMotion && survived) wrong.push(`"${p.text}" (${p.id}): the duplicate was not merged`);
    }
    assert.deepEqual(wrong, [], wrong.join('; '));
  });
});

// ── states.yml missing or unreadable ────────────────────────────────────────
// The script reads templates/states.yml from beside itself, so this runs a copy
// of it (and of what it imports) in a sandbox where that file can be withheld.
// The first case is the control: with states.yml in place the sandbox copy
// dedups normally, so the refusals below are caused by states.yml and not by a
// file this list forgot.
const SANDBOX_FILES = [
  'dedup-tracker.mjs', 'path-resolver.mjs', 'role-matcher.mjs', 'url-key.mjs',
  'tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json', 'pipeline-lock.mjs',
  'lib/cli-flags.mjs', 'lib/linkedin-url.mjs', 'lib/dir-lock.mjs', 'lib/yaml-document.mjs',
];
const DUPLICATE_ROWS = [
  '| 1 | 2026-09-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | — | first |',
  '| 2 | 2026-09-02 | Acme | Backend Engineer | 3.0/5 | Evaluated | ❌ | — | second |',
];

function inSandbox(statesYml, fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dedup-states-test-')));
  try {
    for (const file of SANDBOX_FILES) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(dir, file));
    }
    linkRepoPackage(dir, 'js-yaml');
    if (statesYml !== null) {
      mkdirSync(join(dir, 'templates'), { recursive: true });
      writeFileSync(join(dir, 'templates', 'states.yml'), statesYml);
    }
    const tracker = join(dir, 'data', 'applications.md');
    mkdirSync(dirname(tracker), { recursive: true });
    writeFileSync(tracker, trackerText(DUPLICATE_ROWS));
    const r = spawnSync(process.execPath, [join(dir, 'dedup-tracker.mjs')], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    fn({ r, tracker });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

ok('control: the sandbox copy dedups normally when states.yml is beside it', () => {
  inSandbox(readFileSync(join(ROOT, 'templates', 'states.yml'), 'utf-8'), ({ r, tracker }) => {
    assert.equal(r.status, 0, `exited ${r.status}: ${r.stderr}`);
    assert.ok(!readFileSync(tracker, 'utf-8').includes('| 2 | 2026-09-02 |'), 'the duplicate row is still there');
  });
});

// A states.yml that parses but leaves a ranked state undefined is the same
// hazard as one that cannot be read: every spelling of that state resolves to
// nothing and ranks 0. An empty list is the limiting case.
const statesWithout = (missingId) => `states:\n${states.filter((s) => s.id !== missingId)
  .map((s) => `  - { id: ${s.id}, label: ${s.label} }\n`).join('')}`;

for (const [what, statesYml, names] of [
  ['is missing', null, /states\.yml/],
  ['has no states list', 'version: 1\n', /states\.yml/],
  ['is not valid YAML', 'states: [\n', /states\.yml/],
  ['has an empty states list', 'states: []\n', /states\.yml.*\bapplied\b/s],
  ['defines every state but Interview', statesWithout('interview'), /states\.yml.*\binterview\b/s],
]) {
  ok(`when states.yml ${what}, dedup-tracker stops with an error and leaves the tracker alone`, () => {
    inSandbox(statesYml, ({ r, tracker }) => {
      assert.equal(r.status, 1, `expected exit 1, got ${r.status}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, names, `the error does not say what is wrong: ${r.stderr}`);
      assert.equal(readFileSync(tracker, 'utf-8'), trackerText(DUPLICATE_ROWS), 'the tracker was modified');
      assert.ok(!existsSync(`${tracker}.bak`), 'a .bak was written although nothing ran');
    });
  });
}
