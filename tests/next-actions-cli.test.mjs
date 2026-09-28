import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, symlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readActions } from '../next-actions-core.mjs';
import {
  CLI, REPO, FIXTURES, fixture, proposal, openTask, mutate,
  cli, isolatedEnv, protectedBytes, assertProtected, storeBytes,
} from './fixtures/next-actions/helpers.mjs';

function jsonSuccess(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

function jsonError(result, code, exitCode = 1) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, exitCode, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout, '');
  const body = JSON.parse(result.stderr);
  assert.equal(body.error.code, code);
  return body;
}

function writeInput(root, name, input) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(input));
  return path;
}

test('CLI help and read commands do not initialize user data', (t) => {
  const { root } = fixture(t, { tracker: false });
  const help = cli(root, ['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /ack-source/);
  assert.match(help.stdout, /--key/);
  assert.equal(jsonSuccess(cli(root, ['list'])).counts.total, 0);
  const summary = cli(root, ['list', '--summary']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /Next actions/i);
  assert.equal(existsSync(join(root, 'data')), false);
});

test('manual add with a stable key retries exactly; missing keys intentionally create new proposals', (t) => {
  const { root, context } = fixture(t);
  const args = ['add', 'Complete fixture form', '--evidence', 'The user requested the action.', '--actor', 'user'];
  const first = jsonSuccess(cli(root, [...args, '--key', 'form-one']));
  const retry = jsonSuccess(cli(root, [...args, '--key', 'form-one']));
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].state, 'proposed');
  assert.deepEqual(first.created[0].source, { namespace: 'manual', eventId: 'form-one', actionKey: 'main' });
  assert.equal(retry.created.length, 0);
  assert.deepEqual(retry.unchanged.map((task) => task.id), [first.created[0].id]);
  const second = jsonSuccess(cli(root, args));
  const third = jsonSuccess(cli(root, args));
  assert.notEqual(second.created[0].id, third.created[0].id);
  assert.equal(readActions(context).tasks.length, 3);
});

test('list is compact, show retains audit data, and --all keeps terminal source keys discoverable', async (t) => {
  const { root, context } = fixture(t);
  let task = await openTask(context, proposal('audit-source', {
    links: [{ label: 'Prepared answers', ref: 'local:output/answers.txt' }],
  }));
  const changed = proposal('audit-source', { title: 'Updated incoming title' });
  task = await mutate(context, task, 'ack-source', { proposal: changed });
  const listed = jsonSuccess(cli(root, ['list']));
  assert.equal(listed.tasks.length, 1);
  for (const field of ['history', 'imported', 'acknowledgedImports']) {
    assert.equal(Object.hasOwn(listed.tasks[0], field), false, `${field} does not belong in the routine list`);
  }
  assert.deepEqual(listed.tasks[0].source, task.source);
  const shown = jsonSuccess(cli(root, ['show', task.id]));
  assert.equal(shown.history.length, task.revision);
  assert.deepEqual(shown.imported, task.imported);
  assert.deepEqual(shown.acknowledgedImports, task.acknowledgedImports);
  task = await mutate(context, task, 'done');
  assert.equal(jsonSuccess(cli(root, ['list'])).tasks.length, 0);
  const all = jsonSuccess(cli(root, ['list', '--all']));
  assert.deepEqual(all.groups.done, [task.id]);
  assert.deepEqual(all.tasks[0].source, task.source);
  const summary = cli(root, ['list', '--all', '--summary']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /Prepared answers/);
  assert.match(summary.stdout, /local:output\/answers\.txt/);
  assert.doesNotMatch(summary.stdout, /employerDueUnknown|requestedSnoozeActive/);
});

test('CLI import, accept, edit, done and corrected-source acknowledgement preserve the tracker and old retries', (t) => {
  const { root } = fixture(t);
  const before = protectedBytes(root);
  const original = proposal('cli-flow');
  const input = writeInput(root, 'input.json', [original]);
  const first = jsonSuccess(cli(root, ['import', '--file', input]));
  let task = first.created[0];
  const run = (operation, extra = []) => jsonSuccess(cli(root, [operation, task.id, '--revision', String(task.revision), '--reason', 'The user reviewed this action.', ...extra]));
  task = run('accept');
  task = run('edit', ['--file', writeInput(root, 'patch.json', { title: 'User wording' })]);
  task = run('done');
  const changed = { ...original, title: 'Updated source wording' };
  const changedArray = writeInput(root, 'changed-array.json', [changed]);
  jsonError(cli(root, ['import', '--file', changedArray]), 'CONFLICT', 3);
  task = run('ack-source', ['--file', writeInput(root, 'changed-proposal.json', changed)]);
  assert.equal(task.state, 'done');
  assert.equal(task.title, 'User wording');
  const oldRetry = jsonSuccess(cli(root, ['import', '--file', input]));
  const newRetry = jsonSuccess(cli(root, ['import', '--file', changedArray]));
  assert.equal(oldRetry.created.length, 0);
  assert.equal(newRetry.created.length, 0);
  assert.equal(oldRetry.unchanged[0].revision, task.revision);
  assert.equal(newRetry.unchanged[0].revision, task.revision);
  assertProtected(root, before);
});

test('CLI errors use specific exit codes and never echo malformed input content', async (t) => {
  const { root, context, store } = fixture(t);
  const task = await openTask(context);
  const before = storeBytes(store);
  jsonError(cli(root, ['accept', task.id, '--revision', '1', '--reason', 'Outdated caller.']), 'CONFLICT', 3);
  jsonError(cli(root, ['show', '11111111-1111-4111-8111-111111111111']), 'NOT_FOUND', 2);
  const malformed = join(root, 'malformed.json');
  writeFileSync(malformed, '{"PRIVATE_FIXTURE_MARKER": broken-json}');
  const invalid = cli(root, ['import', '--file', malformed]);
  jsonError(invalid, 'VALIDATION');
  assert.doesNotMatch(invalid.stderr, /PRIVATE_FIXTURE_MARKER|broken-json/);
  assert.deepEqual(storeBytes(store), before);
});

test('CLI rejects unknown, duplicate, missing and inapplicable flags before any store write', (t) => {
  const { root } = fixture(t, { tracker: false });
  const cases = [
    ['add', 'A', '--evidence', 'Reviewed', '--all'],
    ['list', '--time-zone', 'UTC', '--time-zone', 'Europe/London'],
    ['list', '--summary', '--json'],
    ['list', '--unknown-option'],
    ['add', 'A', '--evidence'],
    ['accept', '11111111-1111-4111-8111-111111111111', '--revision', '9007199254740993', '--reason', 'Reviewed'],
    ['accept', '11111111-1111-4111-8111-111111111111', '--revision', '1.0', '--reason', 'Reviewed'],
    ['accept', '11111111-1111-4111-8111-111111111111', '--revision', '1'],
    ['list', 'unexpected-operand'],
    ['--help', '-h'],
    ['list', '--summary=true'],
    ['list', '--help', '--revision'],
    ['add', 'A', '--evidence', '-h'],
    ['add', 'A', '--evidence='],
    ['list', '--__proto__=unsafe'],
  ];
  for (const args of cases) jsonError(cli(root, args), 'VALIDATION');
  assert.equal(existsSync(join(root, 'data')), false);
});

test('CLI accepts equals values and the option terminator without changing their meaning', (t) => {
  const { root } = fixture(t, { tracker: false });
  const args = ['add', '--evidence=Reviewed = a real note', '--actor=user', '--key=equals-key', '--', '--literal title'];
  const task = jsonSuccess(cli(root, args)).created[0];
  assert.equal(task.title, '--literal title');
  assert.equal(task.evidence.text, 'Reviewed = a real note');
  assert.equal(task.actor, 'user');
  assert.equal(jsonSuccess(cli(root, args)).unchanged[0].id, task.id);
  jsonError(cli(root, ['add', 'A', '--key=x', '--key', 'y', '--evidence', 'Reviewed']), 'VALIDATION');
  assert.equal(jsonSuccess(cli(root, ['list', '--time-zone=UTC'])).counts.total, 1);
});

for (const state of ['done', 'dismissed']) {
  test(`summary retains timing evidence for ${state} tasks without claiming they remain unfinished`, async (t) => {
    const { root, context } = fixture(t);
    let task = await openTask(context, proposal(`closed-${state}`, {
      employerDue: { kind: 'date', date: '2000-01-01', timeZone: 'UTC', text: 'Finish before the original call.' },
    }));
    task = await mutate(context, task, 'edit', { patch: { targetDate: { date: '2000-01-01', timeZone: 'UTC' } } });
    task = await mutate(context, task, state === 'done' ? 'done' : 'dismiss');
    const summary = cli(root, ['list', '--all', '--summary']);
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /Timing evidence: Finish before the original call\./);
    assert.match(summary.stdout, /Personal target: 2000-01-01/);
    assert.doesNotMatch(summary.stdout, /still unfinished|Employer deadline has passed|keeps this item visible/);
    assert.equal(jsonSuccess(cli(root, ['show', task.id])).state, state);
  });
}

test('summary keeps uncertain timing text visible without inferring a deadline', async (t) => {
  const { root, context } = fixture(t);
  await openTask(context, proposal('unknown-timing', {
    employerDue: { kind: 'unknown', text: 'Before the next interview; date not established.' },
  }));
  const summary = cli(root, ['list', '--summary']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /Employer due: unknown/);
  assert.match(summary.stdout, /Timing evidence: Before the next interview; date not established\./);
  assert.doesNotMatch(summary.stdout, /Employer deadline has passed|Employer deadline is today/);
});

test('summary displays instant deadlines in the selected timezone while JSON retains UTC precision', async (t) => {
  const { root, context } = fixture(t);
  const at = '2030-03-04T20:00:00.000Z';
  await openTask(context, proposal('zoned-deadline', {
    employerDue: { kind: 'instant', at, text: 'The confirmed cut-off.' },
  }));
  const summary = cli(root, ['list', '--time-zone', 'Asia/Bangkok', '--summary']);
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /Employer due: 05 Mar 2030,? 03:00:00 \(Asia\/Bangkok\)/);
  assert.equal(jsonSuccess(cli(root, ['list', '--time-zone', 'Asia/Bangkok'])).tasks[0].employerDue.at, at);
});

test('fixture fallback cleans up on process success and failure without TestContext.after', (t) => {
  const helpers = new URL('./fixtures/next-actions/helpers.mjs', import.meta.url).href;
  for (const fails of [false, true]) {
    const script = `import {fixture} from ${JSON.stringify(helpers)};
      const {root}=fixture({}, {tracker:false});
      process.stdout.write(JSON.stringify({root}));
      ${fails ? 'throw new Error("Expected fixture failure");' : ''}`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, fails ? 1 : 0, result.stderr);
    const { root } = JSON.parse(result.stdout);
    assert.equal(existsSync(root), false, 'temporary root is removed even after a thrown assertion');
  }
});

test('CLI dry-run validates proposals without reserving tasks or creating a data directory', (t) => {
  const { root } = fixture(t, { tracker: false });
  const path = writeInput(root, 'proposals.json', [proposal('preview')]);
  const result = jsonSuccess(cli(root, ['import', '--file', path, '--dry-run']));
  assert.equal(result.created.length, 1);
  assert.equal(result.dryRun, true);
  assert.equal(existsSync(join(root, 'data')), false);
  assert.equal(jsonSuccess(cli(root, ['list'])).tasks.length, 0);
});

test('CLI rejects FIFO input promptly rather than blocking before dry-run validation', { skip: process.platform === 'win32' }, (t) => {
  const { root } = fixture(t, { tracker: false });
  const fifo = join(root, 'named-pipe');
  const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const result = spawnSync(process.execPath, [CLI, 'import', '--file', fifo, '--dry-run'], {
    cwd: root, env: isolatedEnv(root), encoding: 'utf8', timeout: 3000,
  });
  jsonError(result, 'VALIDATION');
  assert.equal(existsSync(join(root, 'data')), false);
});

test('CLI rejects non-regular, invalid UTF-8 and oversized import files without initializing storage', (t) => {
  const { root } = fixture(t, { tracker: false });
  jsonError(cli(root, ['import', '--file', root, '--dry-run']), 'VALIDATION');
  const badUtf8 = join(root, 'bad-utf8.json');
  writeFileSync(badUtf8, Buffer.concat([
    Buffer.from('[{"source":{"namespace":"fixture","eventId":"bad-text","actionKey":"one"},"title":"'),
    Buffer.from([0xff]), Buffer.from('","evidence":{"text":"Reviewed"}}]'),
  ]));
  jsonError(cli(root, ['import', '--file', badUtf8, '--dry-run']), 'VALIDATION');
  const big = join(root, 'big.json');
  writeFileSync(big, ' '.repeat(1024 * 1024 + 1));
  jsonError(cli(root, ['import', '--file', big, '--dry-run']), 'VALIDATION');
  assert.equal(existsSync(join(root, 'data')), false);
});

function copiedInstall(root) {
  const code = join(root, 'install');
  const data = join(root, 'personal');
  const cwd = join(root, 'foreign-cwd');
  for (const directory of [code, data, cwd]) mkdirSync(directory, { recursive: true });
  for (const relative of ['next-actions.mjs', 'next-actions-core.mjs', 'path-resolver.mjs', 'pipeline-lock.mjs', 'tracker-utils.mjs', 'tracker-parse.mjs', 'tracker-aliases.json', 'lib/is-main-module.mjs']) {
    const destination = join(code, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(REPO, relative), destination);
  }
  symlinkSync(join(REPO, 'node_modules'), join(code, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return { code, data, cwd };
}

for (const routing of ['root-env', 'data-dir-env', 'marker']) {
  test(`CLI resolves ${routing} and relative tracker override against code root from a foreign CWD`, (t) => {
    const { root } = fixture(t, { tracker: false });
    const { code, data, cwd } = copiedInstall(root);
    const tracker = join(code, 'override.md');
    writeFileSync(tracker, readFileSync(join(FIXTURES, 'tracker.md')));
    // Same filename in all three roots catches accidental Data Root/CWD routing.
    writeFileSync(join(data, 'override.md'), 'Wrong Data Root tracker');
    writeFileSync(join(cwd, 'override.md'), 'Wrong working-directory tracker');
    const trackerBefore = readFileSync(tracker);
    const env = isolatedEnv(root);
    delete env.CAREER_OPS_ROOT;
    if (routing === 'root-env') env.CAREER_OPS_ROOT = '../personal';
    else if (routing === 'data-dir-env') env.CAREER_OPS_DATA_DIR = '../personal';
    else writeFileSync(join(code, '.career-ops-data'), '../personal\n');
    env.CAREER_OPS_TRACKER = 'override.md';
    const run = (args) => spawnSync(process.execPath, [join(code, 'next-actions.mjs'), ...args], { cwd, env, encoding: 'utf8', timeout: 20_000 });
    let task = jsonSuccess(run(['add', 'Reply to fixture invitation', '--evidence', 'User requested this reply.', '--key', routing])).created[0];
    task = jsonSuccess(run(['bind', task.id, '--revision', String(task.revision), '--tracker-id', '101', '--reason', 'User selected the exact tracker row.']));
    assert.equal(task.application.trackerId, '101');
    assert.equal(existsSync(join(data, 'data/next-actions.json')), true);
    assert.equal(existsSync(join(code, 'data/next-actions.json')), false);
    assert.deepEqual(readdirSync(cwd), ['override.md']);
    assert.deepEqual(readFileSync(tracker), trackerBefore);
    assert.equal(jsonSuccess(run(['list'])).tasks[0].flags.bindingState, 'current');
  });
}

test('explicit missing tracker override never falls back to a different application file', async (t) => {
  const { root, context, store } = fixture(t);
  const task = await openTask(context);
  const before = storeBytes(store);
  const result = cli(root, ['bind', task.id, '--revision', String(task.revision), '--tracker-id', '101', '--reason', 'Select a specific tracker.'], {
    env: { CAREER_OPS_TRACKER: join(root, 'does-not-exist.md') },
  });
  jsonError(result, 'NOT_FOUND', 2);
  assert.deepEqual(storeBytes(store), before);
});

test('explicit --file paths use the caller directory for import, edit and ack-source, independently of storage', (t) => {
  const { root } = fixture(t, { tracker: false });
  const { code, data, cwd } = copiedInstall(root);
  const env = isolatedEnv(data);
  const run = args => spawnSync(process.execPath, [join(code, 'next-actions.mjs'), ...args], { cwd, env, encoding: 'utf8', timeout: 20_000 });
  const input = proposal('foreign-file');
  for (const name of ['input.json', 'patch.json', 'source.json']) {
    writeFileSync(join(code, name), 'wrong code-root input');
    writeFileSync(join(data, name), 'wrong Data Root input');
  }
  writeInput(cwd, 'input.json', [input]);
  const preview = jsonSuccess(run(['import', '--file=input.json', '--dry-run']));
  assert.equal(preview.created[0].title, input.title);
  assert.equal(existsSync(join(data, 'data')), false);
  let task = jsonSuccess(run(['import', '--file', 'input.json'])).created[0];
  const revise = (operation, file) => jsonSuccess(run([operation, task.id, '--revision', String(task.revision), '--reason', 'Reviewed input from the caller directory.', '--file', file]));
  writeInput(cwd, 'patch.json', { title: 'Reviewed title from CWD' });
  task = revise('edit', 'patch.json');
  assert.equal(task.title, 'Reviewed title from CWD');
  writeInput(cwd, 'source.json', { ...input, title: 'Corrected incoming title' });
  task = revise('ack-source', 'source.json');
  assert.equal(task.title, 'Reviewed title from CWD');
  assert.equal(task.acknowledgedImports[0].title, 'Corrected incoming title');
  assert.equal(jsonSuccess(run(['import', '--file', join(cwd, 'input.json')])).unchanged[0].id, task.id);
  assert.equal(existsSync(join(code, 'data')), false);
  assert.equal(existsSync(join(cwd, 'data')), false);

  const missingRoot = join(root, 'not-created');
  const missing = spawnSync(process.execPath, [join(code, 'next-actions.mjs'), 'import', '--file', 'absent.json'], {
    cwd, env: isolatedEnv(missingRoot), encoding: 'utf8', timeout: 20_000,
  });
  jsonError(missing, 'IO');
  assert.equal(existsSync(missingRoot), false);
});
