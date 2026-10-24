// Every sentinel mutation must participate in the same guard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
import { claimActivity, releaseActivity, gcStaleActivity } from '../session-activity.mjs';

const dir = mkdtempSync(join(tmpdir(), 'career-ops-session-reclaim-'));
const key = 'report:fictional-42';
const path = join(dir, createHash('sha1').update(key).digest('hex') + '.json');
const dead = spawnSync(process.execPath, ['-e', '']);
function reset(stale = true) {
  rmSync(path, { force: true });
  rmSync(path + '.recover', { recursive: true, force: true, maxRetries: 10 });
  writeFileSync(path, JSON.stringify({ key, token: 'old-token', pid: process.pid, process_bound: true }));
  if (stale) {
    writeFileSync(path, JSON.stringify({ key, token: 'old-token', pid: dead.pid, process_bound: true }));
    utimesSync(path, 1, 1);
  }
}
const hook = join(dir, 'pause-sentinel.mjs');
writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync, write = fs.writeFileSync;
let paused = false;
function pause() {
  paused = true;
  write(process.env.READ_MARKER, 'ready');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(process.env.RESUME)) {
    if (Date.now() > deadline) throw new Error('sentinel barrier timed out');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
fs.readFileSync = (path, ...options) => {
  const bytes = read(path, ...options);
  if (!paused && process.env.PAUSE_ON === 'read' && String(path) === process.env.SENTINEL && String(bytes).includes('old-token')) pause();
  return bytes;
};
fs.writeFileSync = (path, data, options) => {
  if (!paused && process.env.PAUSE_ON === 'write' && String(path) === process.env.SENTINEL && options?.flag === 'wx') {
    const fd = fs.openSync(path, 'wx');
    try { pause(); return write(fd, data); } finally { fs.closeSync(fd); }
  }
  return write(path, data, options);
};
syncBuiltinESMExports();\n`);

async function race(operation, pauseOn, compete) {
  const marker = join(dir, 'paused'), resume = join(dir, 'resume');
  rmSync(marker, { force: true });
  rmSync(resume, { force: true });
  const code = `import { claimActivity, releaseActivity } from ${JSON.stringify(pathToFileURL(join(ROOT, 'session-activity.mjs')).href)};
console.log(JSON.stringify(${operation}(${JSON.stringify(key)}, { activityDir: process.env.ACTIVITY, processBound: true, token: 'old-token' })));\n`;
  const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, '--input-type=module', '-e', code], {
    env: { ...process.env, SENTINEL: path, ACTIVITY: dir, READ_MARKER: marker, RESUME: resume, PAUSE_ON: pauseOn },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', bytes => out += bytes);
  child.stderr.on('data', bytes => err += bytes);
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code));
  });
  try {
    const deadline = Date.now() + 10_000;
    while (!existsSync(marker)) {
      assert.equal(child.exitCode, null, err || 'sentinel worker exited early');
      assert.ok(Date.now() < deadline, 'sentinel worker did not reach the barrier');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const competing = compete();
    writeFileSync(resume, 'continue');
    assert.equal(await closed, 0, err);
    return { result: JSON.parse(out), competing };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await closed;
    }
  }
}

try {
  reset();
  const { result, competing } = await race('claimActivity', 'read', () => claimActivity(key, { activityDir: dir, processBound: true }));
  assert.equal(Number(result.claimed) + Number(competing.claimed), 1, 'two stale readers took the same claim');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).token, (result.claimed ? result : competing).token, 'the winning owner was erased');
  pass('a paused stale reader preserves the single winning owner');
} catch (err) { fail(err.message); process.exitCode = 1; }
try {
  reset();
  rmSync(path);
  const { result, competing } = await race('claimActivity', 'write', () => ({
    removed: gcStaleActivity({ activityDir: dir }),
    claim: claimActivity(key, { activityDir: dir, processBound: true }),
  }));
  assert.equal(competing.removed, 0, 'GC removed a sentinel while its claimant was writing');
  assert.equal(competing.claim.claimed, false, 'a contender took a claim during sentinel creation');
  assert.equal(result.claimed, true);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).token, result.token);
  pass('GC and another claimant preserve an in-progress sentinel creation');
} catch (err) { fail(err.message); process.exitCode = 1; }
try {
  reset(false);
  const { result, competing } = await race('releaseActivity', 'read', () => ({
    released: releaseActivity(key, { activityDir: dir, token: 'old-token' }),
    claim: claimActivity(key, { activityDir: dir, processBound: true }),
  }));
  assert.equal(competing.released, false, 'another release crossed the ownership check');
  assert.equal(competing.claim.claimed, false, 'a new owner appeared during an unfinished release');
  assert.equal(result, true);
  const next = claimActivity(key, { activityDir: dir, processBound: true });
  assert.equal(next.claimed, true);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).token, next.token);
  pass('a paused release cannot remove a replacement owner');
} catch (err) { fail(err.message); process.exitCode = 1; }
try {
  reset(false);
  writeFileSync(path, JSON.stringify({ key, token: 'old-token', pid: dead.pid, process_bound: false }));
  const mkdir = fs.mkdirSync;
  let collided = false;
  const { result, competing } = await race('claimActivity', 'read', () => {
    fs.mkdirSync = (target, ...options) => {
      try { return mkdir(target, ...options); }
      catch (err) {
        if (!collided && String(target) === path + '.recover' && err.code === 'EEXIST') {
          collided = true;
          writeFileSync(join(dir, 'resume'), 'continue');
          const deadline = Date.now() + 10_000;
          while (existsSync(path + '.recover')) {
            assert.ok(Date.now() < deadline, 'the contending claimant did not release its guard');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
        }
        throw err;
      }
    };
    syncBuiltinESMExports();
    try { return releaseActivity(key, { activityDir: dir, token: 'old-token' }); }
    finally { fs.mkdirSync = mkdir; syncBuiltinESMExports(); }
  });
  assert.equal(competing, true, 'a transiently busy guard abandoned the owner release');
  if (result.claimed) {
    assert.notEqual(result.token, 'old-token');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).token, result.token);
  } else {
    assert.equal(existsSync(path), false, 'the completed CLI claim remained active until its TTL');
    assert.equal(claimActivity(key, { activityDir: dir, processBound: true }).claimed, true);
  }
  pass('an owner release survives a transient claim guard collision');
} catch (err) { fail(err.message); process.exitCode = 1; }
try {
  reset();
  mkdirSync(path + '.recover');
  assert.equal(claimActivity(key, { activityDir: dir, processBound: true }).claimed, false);
  pass('a busy recovery guard returns without taking a second claim');
} catch (err) { fail(err.message); process.exitCode = 1; }
try {
  reset();
  mkdirSync(path + '.recover');
  utimesSync(path + '.recover', 1, 1);
  assert.equal(claimActivity(key, { activityDir: dir, processBound: true }).claimed, true);
  assert.equal(existsSync(path + '.recover'), false);
  pass('an independently created abandoned guard is reclaimed and released');
} catch (err) { fail(err.message); process.exitCode = 1; }
finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
