// Keep both contenders alive while measuring a stale-claim recovery race.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, pass, fail } from './helpers.mjs';
const dir = mkdtempSync(join(tmpdir(), 'career-ops-session-reclaim-'));
const key = 'report:fictional-42';
const path = join(dir, createHash('sha1').update(key).digest('hex') + '.json');
const dead = spawnSync(process.execPath, ['-e', '']);
writeFileSync(path, JSON.stringify({ key, token: 'old-token', pid: dead.pid, process_bound: true, label: 'old', claimed_at: '2020-01-01T00:00:00Z' }));
utimesSync(path, 1, 1);
const hook = join(dir, 'slow-stale-read.mjs');
writeFileSync(hook, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = (path, ...options) => {
  const bytes = read(path, ...options);
  if (String(path) === process.env.SENTINEL && String(bytes).includes('old-token')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  return bytes;
};
const stat = fs.statSync;
fs.statSync = (path, ...options) => {
  const info = stat(path, ...options);
  if (String(path) === process.env.SENTINEL && info.mtimeMs < 10000) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  return info;
};
syncBuiltinESMExports();\n`);
const code = `import { existsSync } from 'node:fs';
import { claimActivity } from ${JSON.stringify(pathToFileURL(join(ROOT, 'session-activity.mjs')).href)};
console.log('ready');
while (!existsSync(process.env.START)) await new Promise(r => setTimeout(r, 10));
console.log(JSON.stringify(claimActivity(${JSON.stringify(key)}, { activityDir: process.env.ACTIVITY, processBound: true })));
setInterval(() => {}, 1000);\n`;
const children = [], ready = [], results = [];
try {
  for (let i = 0; i < 4; i++) {
    let readyResolve, resultResolve, resultReject;
    ready.push(new Promise(r => readyResolve = r));
    results.push(new Promise((r, e) => { resultResolve = r; resultReject = e; }));
    const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, '--input-type=module', '-e', code], {
      env: { ...process.env, SENTINEL: path, ACTIVITY: dir, START: join(dir, 'start') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let out = '', err = '';
    child.stderr.on('data', b => err += b);
    child.stdout.on('data', b => {
      out += b;
      if (out.includes('ready\n')) readyResolve();
      const line = out.split('\n').find(s => s.startsWith('{'));
      if (line) resultResolve(JSON.parse(line));
    });
    child.on('error', resultReject);
    child.on('close', () => { readyResolve(); if (!out.includes('{')) resultReject(new Error(err || 'claim child exited without a result')); });
  }
  await Promise.all(ready);
  writeFileSync(join(dir, 'start'), 'go');
  const rows = await Promise.all(results);
  const winners = rows.filter(r => r.claimed);
  try {
    assert.equal(winners.length, 1, 'two live sessions both claimed the stale key');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).token, winners[0].token);
    pass('stale recovery reports one winner and preserves that live owner');
  } catch (e) { fail(e.message); process.exitCode = 1; }
} finally {
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('close', resolve); child.kill();
  })));
  try {
    const { claimActivity } = await import('../session-activity.mjs');
    mkdirSync(path + '.recover');
    assert.equal(claimActivity(key, { activityDir: dir, processBound: true }).claimed, false);
    pass('a busy stale-recovery guard returns without taking a second claim');
    utimesSync(path + '.recover', 1, 1);
    assert.equal(claimActivity(key, { activityDir: dir, processBound: true }).claimed, false);
    assert.equal(existsSync(path + '.recover'), false);
    assert.equal(claimActivity(key, { activityDir: dir, processBound: true }).claimed, true);
    pass('an abandoned recovery guard ages out and permits a subsequent claim');
  } catch (e) { fail(e.message); process.exitCode = 1; }
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
}
