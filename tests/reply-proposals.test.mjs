// The proposal bridge stays offline and writes only after explicit review.
// Every CLI run uses a copied code root and fictional, disposable trackers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReplyProposals } from '../lib/reply-proposals.mjs';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';
import { loadCanonicalStates } from '../tracker-utils.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATES = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
const HEADER = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
const ROWS = [
  { num: 7, date: '2026-09-01', company: 'Example Labs', role: 'Backend Engineer', report: '[12](../reports/012-example.md)' },
  { num: 12, date: '2026-09-02', company: 'Fictional Works', role: 'Platform Engineer', report: '-' },
];

function tracker(rows = ROWS) {
  return HEADER + rows.map(row => `| ${row.num} | ${row.date} | ${row.company} | ${row.role} | 4.0/5 | ${row.status ?? 'Applied'} | ❌ | ${row.report} | ${row.notes ?? 'existing note'} |`).join('\n') + '\n';
}

// Include the writer explicitly: reply-watch invokes it as a subprocess, so
// following static imports alone would omit the most important integration.
function importClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!rel.endsWith('.mjs')) continue;
    for (const match of readFileSync(join(ROOT, rel), 'utf8').matchAll(/(?:from\s+|import\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
      const dep = relative(ROOT, join(ROOT, dirname(rel), match[1]));
      if (existsSync(join(ROOT, dep))) queue.push(dep);
    }
  }
  return [...seen];
}

const ASSETS = [...importClosure(['reply-watch.mjs', 'set-status.mjs']), 'tracker-aliases.json', 'templates/states.yml'];

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-proposals-')));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const f = { dir };
  for (const name of ['code', 'data', 'other', 'cwd']) {
    const root = join(dir, name);
    mkdirSync(join(root, 'data', 'reply-proposals'), { recursive: true });
    writeFileSync(join(root, 'data', 'applications.md'), tracker());
    f[name] = root;
  }
  f.tracker = join(f.data, 'data', 'applications.md');
  f.log = join(f.data, 'data', 'status-log.tsv');
  return f;
}

// Reader-only cases need no runtime copy. Materialize the code only when a
// case actually exercises the CLI, keeping validation matrices cheap on CI.
function prepareCode(f) {
  if (f.codeReady) return;
  for (const file of ASSETS) {
    mkdirSync(dirname(join(f.code, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(f.code, file));
  }
  for (let dir = ROOT; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules'))) {
      symlinkSync(join(dir, 'node_modules'), join(f.code, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      break;
    }
    if (dirname(dir) === dir) break;
  }
  f.codeReady = true;
}

function proposal(f, row = ROWS[0], extra = {}) {
  return {
    schema_version: 1,
    source: { kind: 'gmail', account_id: 'a'.repeat(64), message_id: `message-${row.num}` },
    tracker_path: f.tracker,
    application: { ...row },
    from_status: 'applied',
    to_status: 'interview',
    evidence: 'We would like to invite you to an interview.',
    ...extra,
  };
}

function drop(f, value = proposal(f), name = 'proposal.json', root = f.data) {
  const file = join(root, 'data', 'reply-proposals', name);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function apps(f) {
  const lines = readFileSync(f.tracker, 'utf8').split('\n');
  const columns = resolveColumns(lines);
  return lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
}

function read(f) {
  return readReplyProposals(f.data, f.tracker, apps(f), STATES);
}

function envFor(f, env = {}) {
  return {
    ...process.env,
    CAREER_OPS_ROOT: f.data, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_REPLY_CANDIDATES: '',
    ...env,
  };
}

function run(f, input = '', env = {}) {
  prepareCode(f);
  const result = spawnSync(process.execPath, [join(f.code, 'reply-watch.mjs')], {
    cwd: f.cwd, input, encoding: 'utf8', timeout: 30_000, env: envFor(f, env),
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result;
}

function receipt(source) {
  return `[reply-proposal:${createHash('sha256').update(JSON.stringify([source.kind, source.account_id, source.message_id])).digest('hex')}]`;
}

function unchanged(f, expected = tracker()) {
  assert.equal(readFileSync(f.tracker, 'utf8'), expected);
  assert.equal(existsSync(f.log), false, 'unaccepted proposals must not create a transition ledger');
}

// Stop at the real review prompt, change fixture data, then provide consent.
function duringReview(t, f, mutate) {
  prepareCode(f);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(f.code, 'reply-watch.mjs')], {
      cwd: f.cwd, env: envFor(f), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let reviewed = false;
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`review timed out: ${stdout}\n${stderr}`)); }, 30_000);
    t.after(() => { clearTimeout(timeout); if (child.exitCode === null) child.kill(); });
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!reviewed && stdout.includes('(y/N, or comma-separated row IDs):')) {
        reviewed = true;
        try { mutate(); child.stdin.end('y\n'); } catch (err) { child.kill(); reject(err); }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => {
      clearTimeout(timeout);
      if (!reviewed) return reject(new Error(`no review prompt: ${stdout}\n${stderr}`));
      if (status !== 0) return reject(new Error(`reply-watch exited ${status}: ${stdout}\n${stderr}`));
      resolve({ stdout, stderr });
    });
  });
}

for (const answer of ['n\n', 'N\n', 'no\n', '', '\n', 'sure\n', '7,999\n']) {
  test(`proposal review preserves tracker and drop without explicit valid consent: ${JSON.stringify(answer)}`, t => {
    const f = fixture(t);
    const p = proposal(f, ROWS[0], { evidence: 'The recruiter said "interview"; this remains quoted evidence.' });
    const file = drop(f, p);
    const before = readFileSync(file, 'utf8');
    const result = run(f, answer);
    assert.match(result.stdout, /Proposal for #7/);
    assert.ok(result.stdout.includes(JSON.stringify(p.evidence)), 'external evidence must be JSON-quoted');
    assert.match(result.stdout, /Updates skipped/);
    unchanged(f);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(existsSync(join(f.data, 'data', 'reply-candidates.json')), false, 'proposal review must not manufacture mailbox examples');
  });
}

for (const answer of ['y\n', 'yes\n']) {
  test(`explicit ${answer.trim()} uses canonical writer, row IDs and an atomic receipt`, t => {
    const f = fixture(t);
    const p = proposal(f);
    const file = drop(f, p);
    const before = readFileSync(file, 'utf8');
    run(f, answer);
    const rows = apps(f);
    assert.equal(rows[0].status, 'Interview');
    assert.equal(rows[0].notes, `existing note; ${receipt(p.source)}`);
    assert.equal(rows[1].status, 'Applied', 'report #12 on row #7 must not select tracker row #12');
    assert.match(readFileSync(f.log, 'utf8'), /^7\t\d{4}-\d{2}-\d{2}\tApplied\tInterview\treply-watch\t\n$/);
    assert.equal(readFileSync(file, 'utf8'), before, 'accepted drops are retained read-only');
  });
}

test('comma-separated tracker row IDs accept only the selected proposals', t => {
  const f = fixture(t);
  const third = { ...ROWS[1], num: 19, role: 'Site Reliability Engineer' };
  writeFileSync(f.tracker, tracker([...ROWS, third]));
  drop(f);
  drop(f, proposal(f, ROWS[1]), 'second.json');
  drop(f, proposal(f, third), 'third.json');
  run(f, '12, 19\n');
  assert.deepEqual(apps(f).map(row => row.status), ['Applied', 'Interview', 'Interview']);
  assert.equal(apps(f)[0].notes, 'existing note');
  assert.deepEqual(readFileSync(f.log, 'utf8').trim().split('\n').map(line => Number(line.split('\t')[0])), [12, 19]);
  assert.deepEqual(read(f).recommendations.map(row => row.num), [7]);
});

test('identical files deduplicate despite key order; accepted source cannot replay after a later reversal', t => {
  const f = fixture(t);
  const p = proposal(f);
  drop(f, p);
  drop(f, Object.fromEntries(Object.entries(p).reverse()), 'redelivery.json');
  assert.equal(read(f).recommendations.length, 1);
  run(f, 'y\n');
  const firstLog = readFileSync(f.log, 'utf8');
  const accepted = readFileSync(f.tracker, 'utf8');
  run(f, 'y\n');
  assert.equal(readFileSync(f.tracker, 'utf8'), accepted);
  assert.equal(readFileSync(f.log, 'utf8'), firstLog);
  writeFileSync(f.tracker, accepted.replace('| Interview |', '| Applied |'));
  const reversed = readFileSync(f.tracker, 'utf8');
  const retry = run(f, 'y\n');
  assert.doesNotMatch(retry.stdout, /Apply recommended status updates/);
  assert.equal(readFileSync(f.tracker, 'utf8'), reversed);
  assert.equal(readFileSync(f.log, 'utf8'), firstLog);
});

test('receipt on another row also suppresses an already accepted source identity', t => {
  const f = fixture(t);
  const p = proposal(f);
  writeFileSync(f.tracker, tracker([ROWS[0], { ...ROWS[1], notes: `other note; ${receipt(p.source)}` }]));
  drop(f, p);
  assert.deepEqual(read(f).recommendations, []);
});

test('different mailbox accounts with the same message ID keep distinct receipts', t => {
  const f = fixture(t);
  const first = proposal(f);
  const second = proposal(f, ROWS[0], { source: { ...first.source, account_id: 'b'.repeat(64) } });
  drop(f, first);
  drop(f, second, 'other-account.json');
  run(f, 'y\n');
  assert.deepEqual(new Set(apps(f)[0].notes.split('; ')), new Set(['existing note', receipt(first.source), receipt(second.source)]));
  assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
});

test('contradictory payloads sharing one source are all blocked, including a valid sibling of an invalid drop', t => {
  const f = fixture(t);
  const p = proposal(f);
  drop(f, p, 'first.json');
  drop(f, { ...p, to_status: 'rejected' }, 'second.json');
  let result = read(f);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.warnings.join('\n'), /conflicting payloads/);
  drop(f, { ...p, extra: 'unknown field' }, 'second.json');
  result = read(f);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.warnings.join('\n'), /invalid schema or fields/);
  unchanged(f);
});

test('different sources recommending conflicting states for one application never reach the writer', t => {
  const f = fixture(t);
  const p = proposal(f);
  drop(f, p);
  drop(f, { ...p, source: { ...p.source, message_id: 'other-message' }, to_status: 'rejected' }, 'conflict.json');
  const result = run(f, 'y\n');
  assert.match(result.stderr, /Conflicting status recommendations/);
  assert.doesNotMatch(result.stdout, /Apply recommended status updates/);
  unchanged(f);
});

test('malformed schema, sources, status aliases and unsafe evidence fail closed', async t => {
  const cases = [
    ['malformed JSON', () => '{'],
    ['array', p => [p]],
    ['unknown field', p => ({ ...p, hook: 'auto-apply' })],
    ['missing evidence', p => { delete p.evidence; return p; }],
    ['unsupported version', p => ({ ...p, schema_version: 2 })],
    ['unknown source', p => ({ ...p, source: { ...p.source, kind: 'smtp' } })],
    ['source extra field', p => ({ ...p, source: { ...p.source, sender: 'hr@example.invalid' } })],
    ['unhashed account', p => ({ ...p, source: { ...p.source, account_id: 'person@example.invalid' } })],
    ['uppercase hash', p => ({ ...p, source: { ...p.source, account_id: 'A'.repeat(64) } })],
    ['empty message ID', p => ({ ...p, source: { ...p.source, message_id: '' } })],
    ['path as message ID', p => ({ ...p, source: { ...p.source, message_id: '../message' } })],
    ['unknown status', p => ({ ...p, to_status: 'scheduled' })],
    ['display label', p => ({ ...p, to_status: 'Interview' })],
    ['status alias', p => ({ ...p, to_status: 'entrevista' })],
    ['from label', p => ({ ...p, from_status: 'Applied' })],
    ['no-op transition', p => ({ ...p, to_status: p.from_status })],
    ['empty evidence', p => ({ ...p, evidence: '   ' })],
    ['oversized evidence', p => ({ ...p, evidence: 'x'.repeat(2001) })],
    ['terminal escape evidence', p => ({ ...p, evidence: '\u001b[2JInterview' })],
    ['bidi evidence', p => ({ ...p, evidence: 'Interview\u202erejected' })],
    ['multiline evidence', p => ({ ...p, evidence: 'Interview\nInjected line' })],
    ['extra application field', p => ({ ...p, application: { ...p.application, status: 'Applied' } })],
    ['string row ID', p => ({ ...p, application: { ...p.application, num: '7' } })],
    ['zero row ID', p => ({ ...p, application: { ...p.application, num: 0 } })],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, t => {
      const f = fixture(t);
      drop(f, mutate(proposal(f)));
      const result = read(f);
      assert.deepEqual(result.recommendations, []);
      assert.equal(result.warnings.length, 1, 'rejected drops must be diagnosed');
      unchanged(f);
    });
  }
});

test('oversized and incomplete temporary files cannot become recommendations', t => {
  const f = fixture(t);
  drop(f, ' '.repeat(64 * 1024 + 1));
  drop(f, proposal(f), 'unfinished.json.tmp');
  const result = read(f);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.warnings.join('\n'), /64 KiB/);
  unchanged(f);
});

test('malformed JSON diagnostics escape ANSI and bidi controls in content and filenames', t => {
  const f = fixture(t);
  // Windows forbids ASCII control bytes in filenames, but permits bidi marks.
  // The malformed content exercises the JSON parser diagnostic on every OS.
  const name = `bad-${process.platform === 'win32' ? '' : '\u001b[31m'}\u202e.json`;
  const file = drop(f, '\u001b[31m\u202e{"broken":', name);
  const before = readFileSync(file);
  const result = read(f);
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.warnings.length, 1);
  assert.doesNotMatch(result.warnings[0], /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
  assert.ok(result.warnings[0].includes('\\u202e'), 'filename bidi mark must be visibly escaped');
  const cli = run(f, 'y\n');
  assert.doesNotMatch(cli.stderr, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
  assert.doesNotMatch(cli.stdout, /Apply recommended status updates/);
  assert.deepEqual(readFileSync(file), before);
  unchanged(f);
});

test('invalid UTF-8 inside otherwise valid JSON evidence is rejected without tracker writes', t => {
  const f = fixture(t);
  const json = Buffer.from(JSON.stringify(proposal(f, ROWS[0], { evidence: 'Evidence __BYTE__ for interview' })));
  const position = json.indexOf('__BYTE__');
  const invalid = Buffer.concat([json.subarray(0, position), Buffer.from([0xff]), json.subarray(position + '__BYTE__'.length)]);
  const file = join(f.data, 'data', 'reply-proposals', 'invalid-utf8.json');
  writeFileSync(file, invalid);
  const result = read(f);
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /utf-8/i);
  assert.deepEqual(readFileSync(file), invalid);
  unchanged(f);
});

test('missing drop directory is normal and leaves no state files', t => {
  const f = fixture(t);
  rmSync(join(f.data, 'data', 'reply-proposals'), { recursive: true });
  assert.deepEqual(read(f), { recommendations: [], warnings: [] });
  assert.equal(existsSync(join(f.data, 'data', 'reply-proposals')), false);
  unchanged(f);
});

test('foreign trackers, changed identities, ambiguous row IDs and stale states are rejected', async t => {
  const cases = [
    ['foreign tracker', (f, p) => ({ ...p, tracker_path: join(f.other, 'data', 'applications.md') }), /tracker path/],
    ['relative tracker', (f, p) => ({ ...p, tracker_path: 'data/applications.md' }), /tracker path/],
    ['company changed', (f, p) => ({ ...p, application: { ...p.application, company: 'Another Company' } }), /identity changed/],
    ['role changed', (f, p) => ({ ...p, application: { ...p.application, role: 'Different Role' } }), /identity changed/],
    ['date changed', (f, p) => ({ ...p, application: { ...p.application, date: '2026-08-01' } }), /identity changed/],
    ['report changed', (f, p) => ({ ...p, application: { ...p.application, report: '-' } }), /identity changed/],
    ['missing row', (f, p) => ({ ...p, application: { ...p.application, num: 999 } }), /missing or ambiguous/],
    ['duplicate row IDs', (f, p) => { writeFileSync(f.tracker, tracker([ROWS[0], ROWS[0]])); return p; }, /missing or ambiguous/],
    ['stale state', (f, p) => { writeFileSync(f.tracker, tracker([{ ...ROWS[0], status: 'Rejected' }, ROWS[1]])); return p; }, /stale from-status/],
  ];
  for (const [name, mutate, warning] of cases) {
    await t.test(name, t => {
      const f = fixture(t);
      drop(f, mutate(f, proposal(f)));
      const before = readFileSync(f.tracker, 'utf8');
      const result = read(f);
      assert.deepEqual(result.recommendations, []);
      assert.match(result.warnings.join('\n'), warning);
      unchanged(f, before);
      assert.equal(readFileSync(join(f.other, 'data', 'applications.md'), 'utf8'), tracker());
    });
  }
});

const ROOT_CONFIGS = [
  ['repository default', f => ({ CAREER_OPS_ROOT: '' }), 'code'],
  ['absolute root', f => ({ CAREER_OPS_ROOT: f.data }), 'data'],
  ['relative root', f => ({ CAREER_OPS_ROOT: relative(f.code, f.data) }), 'data'],
  ['data-dir alias', f => ({ CAREER_OPS_ROOT: '', CAREER_OPS_DATA_DIR: f.data }), 'data'],
  ['relative marker', f => { writeFileSync(join(f.code, '.career-ops-data'), relative(f.code, f.data)); return { CAREER_OPS_ROOT: '' }; }, 'data'],
  ['environment over marker', f => { writeFileSync(join(f.code, '.career-ops-data'), f.other); return { CAREER_OPS_ROOT: f.data }; }, 'data'],
];

for (const [name, setup, selectedRoot] of ROOT_CONFIGS) {
  test(`proposal drops follow ${name} and never cross into another data root`, t => {
    const f = fixture(t);
    const env = setup(f);
    for (const root of [f.code, f.data, f.other, f.cwd]) {
      drop(f, proposal(f, ROWS[0], { tracker_path: join(root, 'data', 'applications.md'), evidence: `Evidence from ${root}` }), 'proposal.json', root);
    }
    const result = run(f, 'y\n', env);
    assert.ok(result.stdout.includes(`Evidence from ${f[selectedRoot]}`));
    for (const root of [f.code, f.data, f.other, f.cwd]) {
      const content = readFileSync(join(root, 'data', 'applications.md'), 'utf8');
      if (root === f[selectedRoot]) assert.match(content, /\| Interview \|/);
      else {
        assert.equal(content, tracker(), `stray write under ${root}`);
        assert.equal(existsSync(join(root, 'data', 'status-log.tsv')), false);
        assert.ok(!result.stdout.includes(`Evidence from ${root}`), 'foreign proposal must not be displayed');
      }
    }
  });
}

test('explicit tracker override still scans only the chosen data root and demands the exact tracker path', t => {
  const f = fixture(t);
  const target = join(f.other, 'data', 'applications.md');
  drop(f, proposal(f));
  drop(f, proposal(f, ROWS[1], { tracker_path: target }), 'override.json');
  // A valid proposal next to the overridden tracker must not be read.
  drop(f, proposal(f, ROWS[0], { tracker_path: target }), 'foreign-root.json', f.other);
  const result = run(f, 'y\n', { CAREER_OPS_TRACKER: target });
  assert.match(result.stderr, /foreign or noncanonical tracker path/);
  assert.doesNotMatch(result.stdout, /Proposal for #7/);
  assert.match(readFileSync(target, 'utf8'), /\| 12 \|.+\| Interview \|/);
  assert.match(readFileSync(target, 'utf8'), /\| 7 \|.+\| Applied \|/);
  unchanged(f);
});

for (const target of ['file', 'directory']) {
  test(`symlinked proposal ${target} is refused without following its content`, t => {
    const f = fixture(t);
    const source = target === 'file' ? drop(f, proposal(f), 'outside.json', f.other) : join(f.other, 'data', 'reply-proposals');
    const destination = target === 'file' ? join(f.data, 'data', 'reply-proposals', 'link.json') : join(f.data, 'data', 'reply-proposals');
    if (target === 'directory') {
      drop(f, proposal(f), 'outside.json', f.other);
      rmSync(destination, { recursive: true });
    }
    try { symlinkSync(source, destination, target === 'directory' ? 'dir' : 'file'); }
    catch (err) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(err.code)) { t.skip('symlink permission unavailable'); return; }
      throw err;
    }
    const result = read(f);
    assert.deepEqual(result.recommendations, []);
    assert.match(result.warnings.join('\n'), /expected a regular/);
    unchanged(f);
  });
}

for (const field of ['status', 'identity', 'notes']) {
  test(`a tracker ${field} change during review invalidates the displayed proposal`, async t => {
    const f = fixture(t);
    drop(f);
    let changed;
    const result = await duringReview(t, f, () => {
      const row = field === 'status' ? { ...ROWS[0], status: 'Rejected' }
        : field === 'identity' ? { ...ROWS[0], role: 'Changed Role' }
          : { ...ROWS[0], notes: 'Concurrent note' };
      changed = tracker([row, ROWS[1]]);
      writeFileSync(f.tracker, changed);
    });
    assert.match(result.stderr, /tracker row changed during review/);
    unchanged(f, changed);
  });
}

test('receipt accepted on another row during review invalidates consent', async t => {
  const f = fixture(t);
  const p = proposal(f);
  drop(f, p);
  let changed;
  const result = await duringReview(t, f, () => {
    changed = tracker([ROWS[0], { ...ROWS[1], notes: receipt(p.source) }]);
    writeFileSync(f.tracker, changed);
  });
  assert.match(result.stderr, /already accepted during review/);
  unchanged(f, changed);
});

test('failed canonical write leaves no receipt and may be reviewed again', async t => {
  const f = fixture(t);
  drop(f);
  prepareCode(f);
  const statesPath = join(f.code, 'templates', 'states.yml');
  const states = readFileSync(statesPath, 'utf8');
  // The reader already loaded its states. Losing the writer's template now
  // models an interrupted system update without permissions-dependent tests.
  const result = await duringReview(t, f, () => unlinkSync(statesPath));
  assert.match(result.stderr, /Skipped #7/);
  unchanged(f);
  writeFileSync(statesPath, states);
  run(f, 'y\n');
  assert.equal(apps(f)[0].status, 'Interview');
  assert.ok(apps(f)[0].notes.includes(receipt(proposal(f).source)));
  assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
});

test('ledger append failure keeps the atomic status and receipt, preventing a duplicate retry', t => {
  const f = fixture(t);
  const p = proposal(f);
  drop(f, p);
  mkdirSync(f.log);
  const result = run(f, 'y\n');
  assert.match(result.stderr, /status-log append failed/);
  assert.equal(apps(f)[0].status, 'Interview');
  assert.ok(apps(f)[0].notes.includes(receipt(p.source)));
  const accepted = readFileSync(f.tracker, 'utf8');
  rmSync(f.log, { recursive: true });
  const retry = run(f, 'y\n');
  assert.doesNotMatch(retry.stdout, /Apply recommended status updates/);
  assert.equal(readFileSync(f.tracker, 'utf8'), accepted);
  assert.equal(existsSync(f.log), false);
});
