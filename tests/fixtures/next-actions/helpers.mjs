import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createActionsContext, importActions, updateAction } from '../../../next-actions-core.mjs';

export const FIXTURES = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(FIXTURES, '../../..');
export const CORE_URL = new URL('../../../next-actions-core.mjs', import.meta.url).href;
export const CLI = join(REPO, 'next-actions.mjs');
export const NOW = new Date('2030-03-01T09:00:00.000Z');
export const LATER = new Date('2030-03-02T09:00:00.000Z');
export const CASES = JSON.parse(readFileSync(join(FIXTURES, 'history-cases.json'), 'utf8'));
const execFileAsync = promisify(execFile);

// Node 18.0-18.12 has no TestContext.after. Keep one fallback listener per
// test process, including failing tests, without raising the project's floor.
const deferredCleanup = new Set();
const removeFixture = root => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
process.once('exit', () => { for (const root of deferredCleanup) removeFixture(root); });

export function fixture(t, { tracker = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-next-actions-'));
  if (typeof t.after === 'function') t.after(() => removeFixture(root));
  else deferredCleanup.add(root);
  const store = join(root, 'data', 'next-actions.json');
  if (tracker) {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'applications.md'), readFileSync(join(FIXTURES, 'tracker.md')));
    writeFileSync(join(root, 'data', 'status-log.tsv'), '101\t2030-02-20\tApplied\tResponded\tset-status\tFixture transition\n');
    writeFileSync(join(root, 'data', 'follow-ups.md'), '# Follow-ups\n\nNo fixture messages sent.\n');
    writeFileSync(join(root, 'data', 'reply-candidates.json'), '[]\n');
  }
  const context = createActionsContext({ dataRoot: root, codeRoot: REPO, trackerPath: join(root, 'data', 'applications.md') });
  return { root, context, store };
}

export function proposal(key, overrides = {}) {
  return {
    source: { namespace: 'fixture', eventId: 'fixture-event', actionKey: key },
    title: `Review ${key}`, actor: 'user',
    evidence: { text: 'A fictional obligation was explicitly reviewed.', ref: null },
    ...overrides,
  };
}

export async function createTask(context, input = proposal('first'), now = NOW) {
  const result = await importActions(context, [structuredClone(input)], { now });
  assert.equal(result.created.length, 1);
  return result.created[0];
}

export async function mutate(context, task, operation, values = {}, now = NOW) {
  return updateAction(context, task.id, {
    operation, expectedRevision: task.revision,
    reason: 'The user explicitly reviewed this fixture change.',
    ...values,
  }, { now });
}

export async function openTask(context, input = proposal('first'), now = NOW) {
  return mutate(context, await createTask(context, input, now), 'accept', {}, now);
}

export function storeBytes(store) {
  return existsSync(store) ? readFileSync(store) : null;
}

export async function expectCode(operation, code) {
  await assert.rejects(async () => operation(), (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

export function protectedBytes(root) {
  return Object.fromEntries(['applications.md', 'status-log.tsv', 'follow-ups.md', 'reply-candidates.json']
    .map((name) => [name, readFileSync(join(root, 'data', name))]));
}

export function assertProtected(root, before) {
  for (const [name, bytes] of Object.entries(before)) {
    assert.deepEqual(readFileSync(join(root, 'data', name)), bytes, `${name} must remain byte-identical`);
  }
}

export function isolatedEnv(root, extra = {}) {
  const env = { ...process.env };
  delete env.CAREER_OPS_ROOT;
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_TRACKER;
  return { ...env, CAREER_OPS_ROOT: root, ...extra };
}

export function cli(root, args, { cwd = root, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, env: isolatedEnv(root, env), encoding: 'utf8', timeout: 20_000,
  });
}

export async function childModule(code, args = [], options = {}) {
  const env = { ...process.env };
  delete env.CAREER_OPS_ROOT;
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_TRACKER;
  const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', code, ...args], {
    encoding: 'utf8', timeout: 20_000, env, ...options,
  });
  return result.stdout;
}
