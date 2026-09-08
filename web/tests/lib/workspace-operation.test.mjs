import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webSrc = fileURLToPath(new URL('../../src/', import.meta.url));
const coreRoot = fileURLToPath(new URL('../../../', import.meta.url));
// Core CI installs at the repo root; Web CI installs only under web/.
const yamlPackageRoot = path.dirname(fileURLToPath(import.meta.resolve('js-yaml/package.json')));
const spawnKey = Symbol.for('career-ops.test.workspace-spawn');
// Only the AI CLI is replaced. PDF children and follow-up file locks are real.
// This exercises delayed HTTP completion without starting an installed agent.
register('data:text/javascript,' + encodeURIComponent(`
  import fs from 'node:fs';
  import path from 'node:path';
  import { pathToFileURL } from 'node:url';
  export async function resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/api/run/route.ts')) {
      if (specifier === '@/lib/clis') return {
        url: 'data:text/javascript,' + encodeURIComponent('export function resolveCli() { return { spec: { args: () => [] }, binPath: "fixture-cli" }; }'), shortCircuit: true
      };
      if (specifier === '@/lib/spawn-cli.mjs') return {
        url: 'data:text/javascript,' + encodeURIComponent('export function spawnHeadlessCli(...args) { return globalThis[Symbol.for("career-ops.test.workspace-spawn")](...args); }'), shortCircuit: true
      };
    }
    if (specifier.startsWith('@/')) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.mts', '']) {
        if (fs.existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`), pathToFileURL(webSrc));

const { POST: run } = await import('../../src/app/api/run/route.ts');
const { followupsLogPath, withLogLock, withFollowupsWrite, FollowupsBusyError } = await import('../../src/lib/followups-server.ts');

function put(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function withWorkspace(fn) {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'co-web-operation-')));
  const code = path.join(sandbox, 'code');
  const a = path.join(sandbox, 'a');
  const b = path.join(sandbox, 'b');
  const oldCwd = process.cwd();
  const keys = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS'];
  const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    fs.mkdirSync(path.join(code, 'web'), { recursive: true });
    put(code, '.career-ops-data', '../a');
    put(code, 'tracker-aliases.json', fs.readFileSync(path.join(coreRoot, 'tracker-aliases.json')));
    for (const root of [a, b]) {
      put(root, 'cv.md', '# Synthetic candidate\n');
      put(root, 'config/profile.yml', 'candidate:\n  full_name: Synthetic Candidate\n');
      put(root, 'reports/007-fixture-2026-01-02.md', '# Fixture\n');
      put(root, 'data/follow-ups.md', '# Follow-ups\n');
      put(root, 'generate-pdf.mjs', 'import fs from "node:fs"; fs.writeFileSync("rendered.txt", process.env.CAREER_OPS_ROOT);');
      put(root, 'mark-pdf-ready.mjs', 'import fs from "node:fs"; fs.writeFileSync("marked.txt", process.env.CAREER_OPS_TRACKER); process.stdout.write(JSON.stringify({ok:true}));');
    }
    for (const key of keys) delete process.env[key];
    process.chdir(path.join(code, 'web'));
    await fn({ code, a, b });
  } finally {
    delete globalThis[spawnKey];
    process.chdir(oldCwd);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

test('a PDF run keeps its original workspace when the marker changes before CLI completion', async () => {
  await withWorkspace(async ({ code, a, b }) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    let childClosed = false;
    child.once('close', () => { childClosed = true; });
    let initial;
    globalThis[spawnKey] = (_bin, _args, options) => { initial = options; return child; };
    let response;
    try {
      response = await run(new Request('http://localhost/api/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'pdf', input: '7', cliId: 'fixture' }),
      }));
      assert.equal(response.status, 200);
      assert.equal(initial.cwd, a);
      assert.equal(initial.env.CAREER_OPS_TRACKER, path.join(a, 'data/applications.md'));
      put(code, '.career-ops-data', '../b');
      child.stdout.write('<<cv-html format="a4">>\n<!DOCTYPE html><html><body>Synthetic CV</body></html>\n<</cv-html>>');
      child.emit('close', 0);
      const events = await response.text();
      assert.match(events, /"type":"done"/);
      assert.doesNotMatch(events, /"type":"error"/);
      assert.equal(fs.readFileSync(path.join(a, 'rendered.txt'), 'utf8'), a);
      assert.equal(fs.readFileSync(path.join(a, 'marked.txt'), 'utf8'), path.join(a, 'data/applications.md'));
      assert.equal(fs.existsSync(path.join(b, 'rendered.txt')), false);
      assert.equal(fs.existsSync(path.join(b, 'marked.txt')), false);
    } finally {
      if (!childClosed) child.emit('close', 1);
      if (response?.body && !response.body.locked) await response.body.cancel();
      child.stdout.destroy();
      child.stderr.destroy();
    }
  });
});

test('a queued follow-up write still contends on the captured file after the marker changes', async () => {
  await withWorkspace(async ({ code, a, b }) => {
    for (const relative of ['followup-seed.mjs', 'followup-cadence.mjs', 'tracker-utils.mjs',
      'tracker-parse.mjs', 'path-resolver.mjs', 'pipeline-lock.mjs', 'lib/local-today.mjs',
      'lib/cli-flags.mjs', 'lib/is-main-module.mjs']) {
      put(code, relative, fs.readFileSync(path.join(coreRoot, relative)));
    }
    put(code, 'templates/states.yml', fs.readFileSync(path.join(coreRoot, 'templates/states.yml')));
    fs.cpSync(yamlPackageRoot, path.join(code, 'node_modules/js-yaml'), { recursive: true });
    const core = await import(pathToFileURL(path.join(code, 'followup-seed.mjs')).href);
    const file = followupsLogPath();
    assert.equal(file, path.join(a, 'data/follow-ups.md'));
    const lockEntered = deferred();
    const releaseFile = deferred();
    const releaseQueue = deferred();
    const queueEntered = deferred();
    const holder = core.withFollowupsLock(file, async () => { lockEntered.resolve(); await releaseFile.promise; }, { timeoutMs: 1_000 });
    let queued;
    let pending;
    try {
      await Promise.race([lockEntered.promise, holder.then(() => { throw new Error('lock callback did not run'); })]);
      queued = withLogLock(async () => { queueEntered.resolve(); await releaseQueue.promise; });
      await queueEntered.promise;
      process.env.CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS = '100';
      pending = withFollowupsWrite(file, () => fs.appendFileSync(file, 'must not write under another file lock\n'));
      const rejected = assert.rejects(pending, FollowupsBusyError);
      put(code, '.career-ops-data', '../b');
      assert.equal(followupsLogPath(), path.join(b, 'data/follow-ups.md'));
      releaseQueue.resolve();
      await rejected;
      assert.equal(fs.readFileSync(file, 'utf8'), '# Follow-ups\n');
      assert.equal(fs.readFileSync(path.join(b, 'data/follow-ups.md'), 'utf8'), '# Follow-ups\n');
    } finally {
      releaseQueue.resolve();
      releaseFile.resolve();
      await Promise.allSettled([holder, queued, pending]);
    }
  });
});
