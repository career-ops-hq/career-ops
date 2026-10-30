// tests/assessment-log-take-home.test.mjs — take-home assignment tracking in
// assessment-log.mjs (#5733). Synthetic fixtures only.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };
const mod = await import(pathToFileURL(join(ROOT, 'assessment-log.mjs')).href);
const { parseAssessments, summarize, buildRow, openTakeHomes, formatInZone, resolveTimeZone } = mod;

const OLD = [
  '# old-format log',
  '2026-07-01\tFakeCo\t042\teSkill\tMS Office\t70\t92\treferences an old version',
  '2026-07-02\tNopeInc\t-\tHackerRank\tJavaScript\t-\t85\t',
  '2026-07-02\tShortLtd\t-\tCriteria\tExcel',
].join('\n');

ok('old-format rows still parse as skills-test with empty take-home fields', () => {
  const { rows, malformed } = parseAssessments(OLD);
  assert.equal(rows.length, 3);
  assert.equal(malformed.length, 0);
  for (const r of rows) {
    assert.equal(r.kind, 'skills-test');
    assert.equal(r.deadline, null);
    assert.equal(r.submittedAt, null);
    assert.equal(r.proof, null);
  }
  assert.equal(rows[0].score, 92);
  assert.equal(summarize(rows).aggregates.byPlatform.eSkill.passed, 1);
});

ok('skills-test buildRow output is byte-identical to the old 8-column format', () => {
  assert.equal(
    buildRow({ company: 'FakeCo', report: '042', platform: 'eSkill', subject: 'MS Office', threshold: '70', score: '92', stale: 'old' }, '2026-07-07'),
    '2026-07-07\tFakeCo\t042\teSkill\tMS Office\t70\t92\told');
});

ok('take-home rows round-trip through buildRow and parseAssessments', () => {
  const row = buildRow({
    kind: 'take-home', company: 'ExampleCorp', report: '7', platform: 'candidate portal', subject: 'Demo lesson',
    deadline: '2026-11-02T17:00:00-08:00', deliverable: 'video', 'requirements-url': 'https://example.test/guide',
    'submitted-at': '2026-11-01T10:00:00-05:00', proof: 'output/proof-example.png',
  }, '2026-10-30');
  const [r] = parseAssessments(row).rows;
  assert.equal(r.kind, 'take-home');
  assert.equal(r.deadline, '2026-11-02T17:00:00-08:00');
  assert.equal(r.deliverable, 'video');
  assert.equal(r.requirementsUrl, 'https://example.test/guide');
  assert.equal(r.submittedAt, '2026-11-01T10:00:00-05:00');
  assert.equal(r.proof, 'output/proof-example.png');
  // take-homes do not pollute per-platform skills aggregates
  assert.deepEqual(summarize([r]).aggregates.byPlatform, {});
});

ok('buildRow rejects bad deadline, deliverable, kind, and take-home fields on a skills-test', () => {
  const base = { kind: 'take-home', company: 'ExampleCorp', platform: 'p', subject: 's' };
  assert.throws(() => buildRow({ ...base, deadline: '2026-11-02T17:00:00' }, 'd'), /UTC offset/);
  assert.throws(() => buildRow({ ...base, deliverable: 'zip' }, 'd'), /deliverable/);
  assert.throws(() => buildRow({ ...base, kind: 'nope' }, 'd'), /--kind/);
  assert.throws(() => buildRow({ company: 'A', platform: 'p', subject: 's', deadline: '2026-11-02T17:00:00Z' }, 'd'), /take-home/);
});

ok('deadline converts across the DST boundary (US fall-back 2026-11-01)', () => {
  assert.equal(formatInZone('2026-10-28T17:00:00Z', 'America/Toronto'), '2026-10-28 13:00 EDT');
  assert.equal(formatInZone('2026-11-02T17:00:00Z', 'America/Toronto'), '2026-11-02 12:00 EST');
  // sender in Pacific time, candidate in Eastern: same wall clock, different offsets
  assert.equal(formatInZone('2026-10-30T17:00:00-07:00', 'America/Toronto'), '2026-10-30 20:00 EDT');
  assert.equal(formatInZone('2026-11-02T17:00:00-08:00', 'America/Toronto'), '2026-11-02 20:00 EST');
});

const mk = (extra) => parseAssessments(buildRow({ kind: 'take-home', platform: 'portal', ...extra }, '2026-10-01')).rows[0];
const NOW = new Date('2026-11-01T12:00:00Z');

ok('48-hour marker warns inside the window only, flags overdue, sorts by deadline', () => {
  const rows = [
    mk({ company: 'LaterCo', subject: 'task', deadline: '2026-11-10T12:00:00Z' }),
    mk({ company: 'SoonCo', subject: 'task', deadline: '2026-11-03T11:00:00Z' }),
    mk({ company: 'EdgeCo', subject: 'task', deadline: '2026-11-03T12:00:00Z' }),
    mk({ company: 'LateCo', subject: 'task', deadline: '2026-10-31T12:00:00Z' }),
  ];
  const open = openTakeHomes(rows, { tz: 'America/Toronto', now: NOW });
  assert.deepEqual(open.map(o => o.company), ['LateCo', 'SoonCo', 'EdgeCo', 'LaterCo']);
  const by = Object.fromEntries(open.map(o => [o.company, o]));
  assert.ok(by.SoonCo.warn && by.EdgeCo.warn);
  assert.ok(!by.LaterCo.warn);
  assert.ok(by.LateCo.overdue && !by.LateCo.warn);
});

ok('a submitted assignment is not listed or flagged, even when submission is a later appended row', () => {
  const rows = [
    mk({ company: 'DoneCo', report: '9', subject: 'task', deadline: '2026-11-02T12:00:00Z' }),
    mk({ company: 'DoneCo', report: '9', subject: 'task', 'submitted-at': '2026-11-01T09:00:00Z', proof: 'saw on-screen thanks' }),
    mk({ company: 'OpenCo', subject: 'task', deadline: '2026-11-02T12:00:00Z' }),
  ];
  assert.deepEqual(openTakeHomes(rows, { tz: 'UTC', now: NOW }).map(o => o.company), ['OpenCo']);
});

ok('timezone resolution: --tz wins, invalid --tz throws, abbreviation in profile is ignored', () => {
  assert.deepEqual(resolveTimeZone('Europe/London', '/nonexistent'), { tz: 'Europe/London', source: '--tz' });
  assert.throws(() => resolveTimeZone('Nowhere/City', '/nonexistent'), /IANA/);
  const dir = mkdtempSync(join(tmpdir(), 'al-tz-'));
  try {
    const p = join(dir, 'profile.yml');
    writeFileSync(p, 'location:\n  timezone: "America/Vancouver"\n');
    assert.deepEqual(resolveTimeZone(undefined, p), { tz: 'America/Vancouver', source: 'config/profile.yml' });
    writeFileSync(p, 'location:\n  timezone: "PST"\n');
    assert.equal(resolveTimeZone(undefined, p).source, 'machine');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

ok('CLI: add take-home, submit appends a row (append-only), open lists then drops it', () => {
  const root = mkdtempSync(join(tmpdir(), 'al-cli-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  const cli = (...a) => spawnSync(NODE, [join(ROOT, 'assessment-log.mjs'), ...a], {
    cwd: root, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root },
  });
  try {
    const log = join(root, 'data', 'assessments.tsv');
    writeFileSync(log, '2026-07-01\tFakeCo\t-\teSkill\tExcel\t70\t90\t\n');
    let r = cli('add', '--kind', 'take-home', '--company', 'ExampleCorp', '--platform', 'portal', '--subject', 'Demo',
      '--deadline', '2099-01-01T17:00:00-08:00', '--deliverable', 'video');
    assert.equal(r.status, 0, describeSpawn(r));
    const before = readFileSync(log, 'utf-8');
    r = cli('open', '--tz', 'America/Toronto', '--json');
    assert.equal(r.status, 0, describeSpawn(r));
    const out = JSON.parse(r.stdout);
    assert.equal(out.open.length, 1);
    assert.equal(out.open[0].deadlineLocal, '2099-01-01 20:00 EST');
    r = cli('submit', '--company', 'ExampleCorp', '--subject', 'Demo', '--submitted-at', '2098-12-30', '--proof', 'on-screen thanks');
    assert.equal(r.status, 0, describeSpawn(r));
    assert.ok(readFileSync(log, 'utf-8').startsWith(before), 'earlier rows untouched');
    assert.equal(JSON.parse(cli('open', '--tz', 'UTC', '--json').stdout).open.length, 0);
    assert.notEqual(cli('submit', '--company', 'Ghost', '--subject', 'x', '--submitted-at', '2098-12-30').status, 0);
    assert.notEqual(cli('open', '--bogus').status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- review follow-ups (#5736) ---
ok('strict date validation rejects impossible calendar dates, clocks and offsets', () => {
  const { isOffsetDateTime, isIsoDate, isLocalDateTime } = mod;
  assert.equal(isOffsetDateTime('2026-11-02T17:00:00-08:00'), true);
  assert.equal(isOffsetDateTime('2026-11-02T17:00:00Z'), true);
  assert.equal(isOffsetDateTime('2026-02-30T17:00:00Z'), false);       // no 30 February
  assert.equal(isOffsetDateTime('2026-11-02T25:00:00Z'), false);       // no hour 25
  assert.equal(isOffsetDateTime('2026-11-02T17:61:00Z'), false);       // no minute 61
  assert.equal(isOffsetDateTime('2026-11-02T17:00:00+99:99'), false);  // no such offset
  assert.equal(isOffsetDateTime('1'), false);
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isLocalDateTime('2026-11-02T17:00'), true);
  assert.equal(isLocalDateTime('2026-11-02T24:00'), false);
});
ok('buildRow rejects an invalid --submitted-at but accepts a date, a local date-time and an offset date-time', () => {
  const base = { kind: 'take-home', company: 'ExampleCorp', platform: 'portal', subject: 'Demo', deadline: '2099-01-01T17:00:00-08:00' };
  for (const bad of ['2026-02-30', 'tomorrow', '1']) {
    assert.throws(() => buildRow({ ...base, 'submitted-at': bad }, '2026-10-22'), /submitted-at/, bad);
  }
  for (const good of ['2026-11-02', '2026-11-02T17:00', '2026-11-02T17:00:00-08:00']) {
    assert.doesNotThrow(() => buildRow({ ...base, 'submitted-at': good }, '2026-10-22'), good);
  }
});
ok('open --tz with no value fails instead of falling back silently', () => {
  const root = mkdtempSync(join(tmpdir(), 'al-tz-missing-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  try {
    const r = spawnSync(NODE, [join(ROOT, 'assessment-log.mjs'), 'open', '--tz'], {
      cwd: root, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: root },
    });
    assert.notEqual(r.status, 0, describeSpawn(r));
    assert.match(r.stderr, /--tz requires/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
