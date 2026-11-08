import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import * as yaml from 'js-yaml';
import { replaceNextPin } from '../followup-seed.mjs';
import { ROOT, pass, fail, warn } from './helpers.mjs';
import { describeSpawn, exitedNonZero } from './helpers/describe-spawn.mjs';

const SCRIPT = join(ROOT, 'debrief-sync.mjs');
const SENTENCE = 'No on-site roles outside the home city';
const DOLLAR_SENTENCE = "Pay floor $'quoted";

function localISO(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAhead(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localISO(date);
}

const FUTURE = daysAhead(60);
const REPORT_REL = 'reports/007-northwind-2026-01-05.md';

function check(label, fn) {
  try {
    fn();
    pass(label);
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
}

function childEnv(root, extraEnv = {}) {
  return {
    ...process.env,
    CAREER_OPS_ROOT: root,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_TRACKER: '',
    CAREER_OPS_FOLLOWUPS: '',
    CAREER_OPS_PROFILE: '',
    ...extraEnv,
  };
}

function run(root, args, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: childEnv(root, extraEnv),
  });
}

function summary(root, script, args, extraEnv = {}) {
  return spawnSync(process.execPath, [join(ROOT, script), ...args], {
    encoding: 'utf8',
    env: childEnv(root, extraEnv),
  });
}

function snapshot(root) {
  const files = [
    'data/applications.md',
    REPORT_REL,
    'data/follow-ups.md',
    'data/contacts.tsv',
  ];
  const out = {};
  for (const rel of files) {
    const path = join(root, rel);
    out[rel] = existsSync(path) ? readFileSync(path, 'utf8') : null;
  }
  return out;
}

function reportText(score, decision, hardStops) {
  return `# Evaluation: Northwind — Platform Engineer

**Score:** ${score}/5
**URL:** https://jobs.northwind.example/platform
**Legitimacy:** High

## Machine Summary

\`\`\`yaml
company: "Northwind"
role: "Platform Engineer"
score: ${score}
final_decision: "${decision}"
hard_stops: ${hardStops}
soft_gaps: []
\`\`\`
`;
}

function writeFixture(root, {
  status = 'Interview',
  decision = 'Apply',
  hardStops = '[]',
  notes = 'screen done',
  followups = '# Follow-ups\n\n- next #7 2026-02-01 (set 2026-01-06)\n',
  report = reportText('4.2', decision, hardStops),
} = {}) {
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'data', 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    `| 7 | 2026-01-05 | Northwind | Platform Engineer | 4.2/5 | ${status} | — | [7](${REPORT_REL}) | ${notes} |`,
    '',
  ].join('\n'));
  writeFileSync(join(root, REPORT_REL), report);
  if (followups != null) writeFileSync(join(root, 'data', 'follow-ups.md'), followups);
}

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'career-ops-debrief-'));
}

function readRoot(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const fullArgs = [
  '--app', '7',
  '--dealbreaker', SENTENCE,
  '--contact-name', 'Avery Quinn',
  '--contact-email', 'avery.quinn@northwind.example',
  '--contact-type', 'interviewer',
  '--contact-name', 'Casey Bloom',
  '--contact-email', 'casey.bloom@northwind.example',
  '--next', FUTURE,
  '--why', 'panel debrief',
];

{
  const root = freshRoot();
  try {
    writeFixture(root);
    const before = summary(root, 'followup-cadence.mjs', ['--summary']);
    check('an overdue pin is OVERDUE before the debrief command', () => {
      assert.equal(before.status, 0, describeSpawn(before));
      assert.match(before.stdout, /OVERDUE/);
    });

    const first = run(root, fullArgs);
    check('debrief command records the dealbreaker next to the evaluated score, both contacts, and the future pin', () => {
      assert.equal(first.status, 0, first.stderr || first.error?.message);
      const tracker = readRoot(root, 'data/applications.md');
      const report = readRoot(root, REPORT_REL);
      assert.match(report, /\*\*Score:\*\*\s*4\.2\/5/);
      assert.match(report, /^score:\s*4\.2$/m);
      assert.match(report, /final_decision:\s*"Skip"/);
      assert.match(report, /No on-site roles outside the home city/);
      assert.match(tracker, /\| 4\.2\/5 \|/);
      assert.match(tracker, /\| Interview \|/);
      assert.equal((tracker.match(/Dealbreaker: No on-site roles outside the home city/g) || []).length, 1);
      const contacts = summary(root, 'contacts.mjs', ['--summary']);
      assert.equal(contacts.status, 0, describeSpawn(contacts));
      assert.match(contacts.stdout, /Avery Quinn/);
      assert.match(contacts.stdout, /interviewer/);
      assert.match(contacts.stdout, /Casey Bloom/);
      assert.match(contacts.stdout, /Northwind/);
      assert.match(contacts.stdout, /#7/);
      assert.match(contacts.stdout, /total: 2 contacts/);
      const tsv = readRoot(root, 'data/contacts.tsv');
      assert.match(tsv, /Avery Quinn\tNorthwind\tinterviewer\t\t\tavery\.quinn@northwind\.example/);
      assert.match(tsv, /Casey Bloom\tNorthwind\t\t\t\tcasey\.bloom@northwind\.example/);
      const cadence = summary(root, 'followup-cadence.mjs', ['--summary']);
      assert.equal(cadence.status, 0, describeSpawn(cadence));
      assert.ok(FUTURE > localISO(new Date()));
      assert.doesNotMatch(cadence.stdout, /OVERDUE/);
      assert.ok(cadence.stdout.includes(FUTURE));
      const pins = readRoot(root, 'data/follow-ups.md');
      assert.equal((pins.match(/^- next #7 /gm) || []).length, 1);
      assert.match(pins, new RegExp(`^- next #7 ${FUTURE} \\(set \\d{4}-\\d{2}-\\d{2}\\) — panel debrief$`, 'm'));
    });

    if (first.status !== 0) {
      fail('a second run keeps the note, the contacts, the pin, and the pin set date: the first command did not exit 0');
    } else {
      const pinned = readRoot(root, 'data/follow-ups.md');
      const trackerAfter = readRoot(root, 'data/applications.md');
      const reportAfter = readRoot(root, REPORT_REL);
      const contactsAfter = readRoot(root, 'data/contacts.tsv');
      const second = run(root, fullArgs);
      check('a second run keeps the note, the contacts, the pin, and the pin set date', () => {
        assert.equal(second.status, 0, describeSpawn(second));
        const body = JSON.parse(second.stdout);
        assert.equal(body.wrote, false);
        assert.equal(readRoot(root, 'data/applications.md'), trackerAfter);
        assert.equal(readRoot(root, REPORT_REL), reportAfter);
        assert.equal(readRoot(root, 'data/contacts.tsv'), contactsAfter);
        assert.equal(readRoot(root, 'data/follow-ups.md'), pinned);
        assert.equal((readRoot(root, 'data/applications.md').match(/Dealbreaker: No on-site roles outside the home city/g) || []).length, 1);
        const contacts = summary(root, 'contacts.mjs', ['--summary']);
        assert.match(contacts.stdout, /total: 2 contacts/);
        assert.match(contacts.stdout, /duplicates: none/);
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function refuses(label, args, mutate = {}) {
  const root = freshRoot();
  try {
    writeFixture(root, mutate);
    const before = snapshot(root);
    const result = run(root, args);
    check(label, () => {
      assert.ok(exitedNonZero(result), describeSpawn(result, 'expected a non-zero exit'));
      assert.deepEqual(snapshot(root), before);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

refuses('a weekday --next writes nothing', ['--app', '7', '--dealbreaker', SENTENCE, '--next', 'Thursday']);
refuses('an impossible --next writes nothing', ['--app', '7', '--dealbreaker', SENTENCE, '--next', '2026-02-31']);
refuses('an unknown flag writes nothing', ['--app', '7', '--dealbreaker', SENTENCE, '--bogus']);
refuses('a repeated --dealbreaker writes nothing', ['--app', '7', '--dealbreaker', SENTENCE, '--dealbreaker', 'No equity-only compensation']);
refuses('a dealbreaker with a semicolon writes nothing', ['--app', '7', '--dealbreaker', 'No on-site; relocation']);
refuses('a dealbreaker with a tab writes nothing', ['--app', '7', '--dealbreaker', 'No on-site\trelocation']);
refuses('a dealbreaker with a newline writes nothing', ['--app', '7', '--dealbreaker', 'No on-site\nrelocation']);
refuses('a dealbreaker with a carriage return writes nothing', ['--app', '7', '--dealbreaker', 'No on-site\r\nrelocation']);
refuses('a Machine Summary holding only comments writes nothing', ['--app', '7', '--dealbreaker', SENTENCE], {
  report: reportText('4.2', 'Apply', '[]').replace(/```yaml\n[\s\S]*?```/, '```yaml\n# summary pending\n```'),
});

refuses('a tracker status set-status.mjs rejects writes nothing', ['--app', '7', '--dealbreaker', SENTENCE], {
  status: 'Waiting on panel',
});

function machineSummary(report) {
  return yaml.load(report.match(/```yaml\n([\s\S]*?)```/)[1]);
}

for (const [label, from, to] of [
  ['hard_stops: null', 'hard_stops: []', 'hard_stops: null'],
  ['hard_stops: ~', 'hard_stops: []', 'hard_stops: ~'],
  ['a flow list with a trailing comment', 'hard_stops: []', 'hard_stops: ["Earlier stop"]  # from the evaluation'],
  ['an unindented block list', 'hard_stops: []', 'hard_stops:\n- "Earlier stop"'],
  ['a folded final_decision', 'final_decision: "Apply"', 'final_decision: >\n  Apply after\n  the panel'],
]) {
  const root = freshRoot();
  try {
    writeFixture(root, { followups: null, report: reportText('4.2', 'Apply', '[]').replace(from, to) });
    const first = run(root, ['--app', '7', '--dealbreaker', SENTENCE]);
    const second = run(root, ['--app', '7', '--dealbreaker', SENTENCE]);
    check(`${label}: the dealbreaker is recorded once and the summary still parses`, () => {
      assert.equal(first.status, 0, describeSpawn(first));
      assert.equal(second.status, 0, describeSpawn(second));
      assert.equal(JSON.parse(second.stdout).wrote, false);
      const doc = machineSummary(readRoot(root, REPORT_REL));
      assert.equal(doc.final_decision, 'Skip');
      assert.ok(Array.isArray(doc.hard_stops), JSON.stringify(doc.hard_stops));
      assert.equal(doc.hard_stops.filter((item) => item === SENTENCE).length, 1);
      if (to.includes('Earlier stop')) assert.ok(doc.hard_stops.includes('Earlier stop'));
      assert.equal(doc.soft_gaps.length, 0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = freshRoot();
  try {
    writeFixture(root, { followups: null });
    const reportPath = join(root, REPORT_REL);
    const report = readFileSync(reportPath, 'utf8').replace(
      'soft_gaps: []',
      () => 'soft_gaps: []\ncomp_note: "$$ range"',
    );
    writeFileSync(reportPath, `${report}## After\n\nKeep this tail.\n`);
    const result = run(root, ['--app', '7', '--dealbreaker', DOLLAR_SENTENCE]);
    check('a dollar sign in the report is written literally', () => {
      assert.equal(result.status, 0, describeSpawn(result));
      const next = readRoot(root, REPORT_REL);
      assert.ok(next.includes(DOLLAR_SENTENCE));
      assert.ok(next.includes('comp_note: "$$ range"'));
      assert.ok(next.includes('Keep this tail.'));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = freshRoot();
  const custom = join(root, 'pinned-follow-ups.md');
  try {
    writeFixture(root);
    const result = run(root, ['--app', '7', '--next', FUTURE, '--why', 'panel debrief'], {
      CAREER_OPS_FOLLOWUPS: custom,
    });
    check('a CAREER_OPS_FOLLOWUPS pin is the file the cadence summary reads', () => {
      assert.equal(result.status, 0, describeSpawn(result));
      assert.match(readFileSync(custom, 'utf8'), new RegExp(`^- next #7 ${FUTURE} `, 'm'));
      assert.match(readRoot(root, 'data/follow-ups.md'), /2026-02-01/);
      const cadence = summary(root, 'followup-cadence.mjs', ['--summary'], {
        CAREER_OPS_FOLLOWUPS: custom,
      });
      assert.equal(cadence.status, 0, describeSpawn(cadence));
      assert.ok(cadence.stdout.includes(FUTURE));
      assert.doesNotMatch(cadence.stdout, /OVERDUE/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const followups = join(tmpdir(), `career-ops-debrief-pin-${process.pid}.md`);
  const lock = join(tmpdir(), `career-ops-followups-debrief-${process.pid}.lock`);
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({
    pid: process.pid,
    token: 'held',
    startedAt: new Date().toISOString(),
  }));
  const started = Date.now();
  let code = null;
  try {
    await replaceNextPin(7, {
      date: FUTURE,
      followupsPath: followups,
      lockDir: lock,
      lockTimeoutMs: 200,
    });
  } catch (err) {
    code = err?.code ?? null;
  }
  check('replaceNextPin uses the caller lock timeout', () => {
    assert.equal(code, 'LOCK_TIMEOUT');
    assert.ok(Date.now() - started < 5000);
  });
  rmSync(lock, { recursive: true, force: true });
  rmSync(followups, { force: true });
}

check('the override route keeps the web lock timeout', () => {
  const route = readFileSync(join(ROOT, 'web/src/app/api/followups/override/route.ts'), 'utf8');
  assert.match(route, /CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS/);
  assert.equal((route.match(/lockTimeoutMs: webLockTimeoutMs\(\)/g) || []).length, 2);
});

check('Step 10 tells the agent how to record the call', () => {
  const mode = readFileSync(join(ROOT, 'modes/interview/debrief.md'), 'utf8');
  const step9 = mode.indexOf('## Step 9 — Write Session Transcript');
  const step10 = mode.indexOf('## Step 10 — Record the call on the tracker');
  const rules = mode.indexOf('## Rules');
  assert.ok(step9 > 0 && step10 > step9 && rules > step10);
  const section = mode.slice(step10, rules);
  for (const phrase of [
    'modes/_profile.md',
    'config/profile.yml',
    'Record this dealbreaker on the report and the tracker? [y/N]',
    '--dealbreaker',
    'Save this contact to data/contacts.tsv? [y/N]',
    '--next YYYY-MM-DD',
    'local calendar day',
    'today counts',
    'next week',
    'node debrief-sync.mjs --app <tracker#>',
    'skip the command',
    'node contacts.mjs --summary',
    'node followup-cadence.mjs --summary',
    'set-status.mjs',
    'Do not change status unless the user names a new status',
    'one command per confirmed sentence',
    'on the first command only',
    'Drop every sentence the user declines',
    'run the list again from the first command',
    'Run the commands one at a time and check each exit status',
    "In PowerShell, write it as `''`, and double a curly quote",
    'A second run of the same commands is safe',
    'a semicolon (`;`), a tab or a line break',
    'ask for a one-line version without it that keeps the meaning',
    'Do not remove the character or reword the sentence yourself',
    "the user's one-line version",
  ]) {
    assert.ok(section.includes(phrase), `missing ${phrase}`);
  }
});

// The Step 10 example is the documented multi-dealbreaker flow (#6542). Run it
// as written: every line must be a call the CLI accepts, together they must
// record each confirmed sentence, and running them again must change nothing.
const MODE_DIR = join(ROOT, 'modes');

// Translations localize the Step 10 heading, so find the example by content:
// the bash fence whose commands call debrief-sync.mjs.
function stepTenBlock(text) {
  const fence = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].find((m) => m[1].includes('node debrief-sync.mjs'));
  return fence ? fence[1] : null;
}

function debriefModes() {
  const out = [['modes/interview/debrief.md', join(MODE_DIR, 'interview', 'debrief.md')]];
  for (const lang of readdirSync(MODE_DIR, { withFileTypes: true })) {
    const path = join(MODE_DIR, lang.name, 'interview', 'debrief.md');
    if (lang.isDirectory() && existsSync(path)) out.push([`modes/${lang.name}/interview/debrief.md`, path]);
  }
  return out;
}

// Split a documented command the way a POSIX shell would for the forms Step 10
// uses: single-quoted segments, the '\\'' escape, and bare words.
function shellWords(line) {
  const words = [];
  for (const token of line.match(/(?:'[^']*'|\\.|[^\s'\\])+/g) || []) {
    words.push([...token.matchAll(/'([^']*)'|\\(.)|([^'\\]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]).join(''));
  }
  return words;
}

function shellQuoteValue(value) {
  return value.replaceAll("'", "'\\''");
}

const englishBlock = stepTenBlock(readFileSync(join(MODE_DIR, 'interview', 'debrief.md'), 'utf8'));

check('Step 10 shows one debrief-sync command per confirmed dealbreaker', () => {
  assert.ok(englishBlock, 'Step 10 has no bash example');
  const commands = englishBlock.trim().split('\n');
  assert.ok(commands.length >= 2, 'the example needs at least two dealbreakers');
  for (const [i, line] of commands.entries()) {
    const words = shellWords(line);
    assert.deepEqual(words.slice(0, 2), ['node', 'debrief-sync.mjs']);
    const flags = words.filter((w) => w.startsWith('--'));
    assert.equal(flags.filter((f) => f === '--dealbreaker').length, 1, `line ${i + 1} must pass exactly one --dealbreaker`);
    if (i > 0) assert.deepEqual(flags, ['--app', '--dealbreaker'], `line ${i + 1} must pass only --app and --dealbreaker`);
  }
});

check('every translated Step 10 carries the same multi-dealbreaker example', () => {
  for (const [rel, path] of debriefModes()) {
    const text = readFileSync(path, 'utf8');
    assert.ok(stepTenBlock(text), `${rel} has no Step 10 debrief-sync example`);
    assert.equal(stepTenBlock(text), englishBlock, `${rel} Step 10 example differs from the English one`);
  }
});

check('no debrief mode passes a debrief-sync flag twice in one command', () => {
  for (const [rel, path] of debriefModes()) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!/^node debrief-sync\.mjs /.test(line.trim())) continue;
      const flags = shellWords(line).filter((w) => w.startsWith('--') && !/^--contact-/.test(w));
      assert.equal(new Set(flags).size, flags.length, `${rel}: ${line}`);
    }
  }
});

// Run the Step 10 example as written, once per shell Step 10 names, with values
// that shell would mangle if the documented quoting were wrong.
function exerciseExample(shell, { quote, spawnLine, second, name }) {
  const root = freshRoot();
  const FIRST = SENTENCE;
  const DECLINED = 'No travel above 25 percent';
  const lines = englishBlock.trim().split('\n').map((line) => line
    .replaceAll('<tracker#>', '7')
    .replaceAll('<sentence 1>', quote(FIRST))
    .replaceAll('<sentence 2>', quote(second))
    .replaceAll('<name>', quote(name))
    .replaceAll('YYYY-MM-DD', FUTURE));
  const runLine = (line) => spawnLine(root, line);
  const count = (text, needle) => text.split(needle).length - 1;
  try {
    writeFixture(root);
    const results = lines.map(runLine);
    check(`${shell}: the Step 10 example records both confirmed dealbreakers, the contact, and the pin`, () => {
      for (const result of results) assert.equal(result.status, 0, describeSpawn(result));
      const report = machineSummary(readRoot(root, REPORT_REL));
      assert.equal(report.final_decision, 'Skip');
      assert.deepEqual(report.hard_stops, [FIRST, second]);
      const tracker = readRoot(root, 'data/applications.md');
      assert.equal(count(tracker, `Dealbreaker: ${FIRST}`), 1);
      assert.equal(count(tracker, `Dealbreaker: ${second}`), 1);
      assert.match(tracker, /\| Interview \|/);
      assert.ok(!tracker.includes(DECLINED) && !readRoot(root, REPORT_REL).includes(DECLINED));
      assert.equal(count(readRoot(root, 'data/contacts.tsv'), name), 1);
      const pins = readRoot(root, 'data/follow-ups.md');
      assert.equal((pins.match(/^- next #7 /gm) || []).length, 1);
      assert.ok(pins.includes(`- next #7 ${FUTURE} `));
    });

    const before = snapshot(root);
    const again = lines.map(runLine);
    check(`${shell}: running the Step 10 example again writes nothing`, () => {
      for (const result of again) {
        assert.equal(result.status, 0, describeSpawn(result));
        assert.equal(JSON.parse(result.stdout).wrote, false);
      }
      assert.deepEqual(snapshot(root), before);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const shellEnv = (root) => ({
  ...childEnv(root),
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
});

if (englishBlock) {
  // A POSIX shell expands $ and runs backticks inside double quotes. The
  // example single-quotes each value, so these reach the CLI unchanged. On
  // Windows there is no /bin/sh: split the line the same way and spawn directly.
  exerciseExample('POSIX shell', {
    quote: shellQuoteValue,
    second: "No recruiter's pay below $120,000 or `whoami` pitch",
    name: "Avery O'Quinn",
    spawnLine: (root, line) => (process.platform === 'win32'
      ? run(root, shellWords(line).slice(2))
      : spawnSync('/bin/sh', ['-c', line], { cwd: ROOT, encoding: 'utf8', env: shellEnv(root) })),
  });

  // PowerShell reads ' and the curly quotes ‘ ’ ‚ ‛ as single quotes, and Step
  // 10 says to double each one inside a value. GitHub's runners ship pwsh on
  // every OS in the matrix; a machine without it warns instead of passing.
  const pwsh = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
  if (pwsh.status === 0) {
    exerciseExample('PowerShell', {
      quote: (value) => value.replace(/['‘’‚‛]/g, (c) => c + c),
      second: "No recruiter’s pay below $120,000, ‚net‛ or 'gross' `n",
      name: "Avery O’Quinn-D'Arcy",
      spawnLine: (root, line) => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', line], {
        cwd: ROOT, encoding: 'utf8', env: shellEnv(root),
      }),
    });
  } else {
    warn('PowerShell run of the Step 10 example skipped: pwsh is not installed');
  }
}

// #6541: debrief-sync.mjs refuses a --dealbreaker value with a semicolon, tab
// or line break, so every Step 10 that passes the profile sentence must check
// it first, ask the user for a safe one-line value, and check that value
// again, all before the [y/N] confirmation. Each file names the three
// characters, the one-line request and the re-check in its own language; a
// new translation that passes --dealbreaker has to be added here.
const DELIMITER_GUARD = {
  'modes/interview/debrief.md': ['a tab', 'a line break', 'one-line version', 'ask again until it has none'],
  'modes/de/interview/debrief.md': ['Tabulator', 'Zeilenumbruch', 'einzeilige Fassung', 'frag erneut'],
  'modes/fr/interview/debrief.md': ['une tabulation', 'un saut de ligne', 'une seule ligne', 'redemandez-la'],
  'modes/id/interview/debrief.md': ['tab', 'baris baru', 'versi satu baris', 'minta lagi'],
  'modes/es/interview/debrief.md': ['tabulador', 'salto de línea', 'una sola línea', 'vuelve a pedirla'],
  'modes/it/interview/debrief.md': ['tabulazione', 'a capo', 'una sola riga', "chiedine un'altra"],
  'modes/ja/interview/debrief.md': ['タブ', '改行', '1行の文', '改めて求める'],
  'modes/ko/interview/debrief.md': ['탭', '줄바꿈', '한 줄짜리', '다시 요청합니다'],
  'modes/pl/interview/debrief.md': ['tabulator', 'nowej linii', 'jednowierszową', 'proś ponownie'],
  'modes/pt/interview/debrief.md': ['tabulação', 'quebra de linha', 'uma única linha', 'peça de novo'],
  'modes/ru/interview/debrief.md': ['табуляцией', 'переводом строки', 'однострочный', 'проси снова'],
  'modes/ua/interview/debrief.md': ['табуляцією', 'новий рядок', 'однорядковий', 'просіть знову'],
  'modes/zh/interview/debrief.md': ['制表符', '换行', '单行版本', '再次请用户修改'],
};

check('every Step 10 that passes --dealbreaker checks the delimiters before the prompt', () => {
  const modesDir = join(ROOT, 'modes');
  const files = ['modes/interview/debrief.md', ...readdirSync(modesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `modes/${d.name}/interview/debrief.md`)
    .filter((rel) => existsSync(join(ROOT, rel)))];
  const affected = files.filter((rel) => readFileSync(join(ROOT, rel), 'utf8').includes('--dealbreaker'));
  assert.deepEqual([...affected].sort(), Object.keys(DELIMITER_GUARD).sort(),
    'every debrief that passes --dealbreaker needs an entry in DELIMITER_GUARD');
  for (const rel of affected) {
    const paragraph = readFileSync(join(ROOT, rel), 'utf8')
      .split(/\n\s*\n/)
      .find((p) => p.includes('`--dealbreaker`') && p.includes('[y/N]'));
    assert.ok(paragraph, `${rel}: no dealbreaker paragraph with a [y/N] prompt`);
    const prompt = paragraph.indexOf('[y/N]');
    for (const phrase of ['debrief-sync.mjs', '`;`', ...DELIMITER_GUARD[rel]]) {
      const at = paragraph.indexOf(phrase);
      assert.ok(at >= 0, `${rel}: the dealbreaker paragraph is missing ${phrase}`);
      assert.ok(at < prompt, `${rel}: ${phrase} comes after the [y/N] prompt`);
    }
  }
});
