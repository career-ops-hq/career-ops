import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { ROOT, NODE } from './helpers.mjs';

const initial = '# User configuration\ntracked_companies:\n  - name: Existing\n    careers_url: https://jobs.lever.co/existing\njob_boards: []\n';

async function until(check) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'fixture did not reach its write or lock barrier');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-discover-concurrent-'));
  const portals = join(dir, 'portals.yml');
  const preload = join(dir, 'preload.mjs');
  writeFileSync(portals, initial);
  // Stub only the provider response. The actual CLI, YAML splice, dedupe,
  // write/rename and shared lock all run in independent processes.
  writeFileSync(preload, `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import greenhouse from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers/greenhouse.mjs')).href)};
    greenhouse.fetch = async () => [{ title: 'Engineer', url: 'https://example.test/job' }];
    const portals = process.env.CAREER_OPS_PORTALS;
    const role = process.env.DISCOVERY_WRITER;
    const write = fs.writeFileSync;
    const rename = fs.renameSync;
    const mkdir = fs.mkdirSync;
    fs.writeFileSync = function(file, ...args) {
      if (role === 'first' && String(file).startsWith(portals + '.tmp-')) {
        write(portals + '.paused', 'ready');
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(portals + '.resume')) {
          if (Date.now() > deadline) throw new Error('fixture resume timed out');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
      return write.call(this, file, ...args);
    };
    fs.renameSync = function(from, to) {
      const result = rename.call(this, from, to);
      if (role === 'second' && String(to) === portals) write(portals + '.second-written', 'ready');
      return result;
    };
    fs.mkdirSync = function(file, ...args) {
      try { return mkdir.call(this, file, ...args); }
      catch (error) {
        if (role === 'second' && String(file) === portals + '.lock' && error.code === 'EEXIST') {
          write(portals + '.second-waiting', 'ready');
        }
        throw error;
      }
    };
    syncBuiltinESMExports();
  `);
  return { dir, portals, preload };
}

function start(f, company, role, write = true) {
  const child = spawn(NODE, ['--import', pathToFileURL(f.preload).href,
    join(ROOT, 'discover-ats.mjs'), company, '--vendors', 'gh', ...(write ? ['--write'] : [])], {
    cwd: ROOT,
    env: { ...process.env, CAREER_OPS_ROOT: f.dir, CAREER_OPS_PORTALS: f.portals, DISCOVERY_WRITER: role },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

for (const { company, names, fresh } of [
  { company: 'Beta', names: ['Alpha', 'Beta', 'Existing'], fresh: 1 },
  { company: 'Alpha', names: ['Alpha', 'Existing'], fresh: 0 },
]) test(`concurrent discover --write retains configuration and dedupes ${company}`, async () => {
  const f = fixture();
  const children = [];
  try {
    const first = start(f, 'Alpha', 'first'); children.push(first);
    await until(() => existsSync(f.portals + '.paused'));
    const second = start(f, company, 'second'); children.push(second);
    // On the old code Beta finishes its rename; with locking it waits for
    // Alpha. Neither path depends on guessing how long a CLI takes to start.
    await until(() => existsSync(f.portals + '.second-written') || existsSync(f.portals + '.second-waiting'));
    writeFileSync(f.portals + '.resume', 'continue');
    for (const [index, job] of children.entries()) {
      const result = await job.done;
      assert.equal(result.code, 0, result.stderr + result.stdout);
      assert.equal(JSON.parse(result.stdout).metadata.freshWritten, index === 0 ? 1 : fresh);
    }
    const saved = readFileSync(f.portals, 'utf8');
    assert.deepEqual(yaml.load(saved).tracked_companies.map(entry => entry.name).sort(), names);
    assert.ok(saved.startsWith('# User configuration\n'));
    assert.deepEqual(yaml.load(saved).job_boards, []);
    assert.equal(existsSync(f.portals + '.lock'), false);
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL');
    await Promise.all(children.map(job => job.done));
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('preview does not alter portals.yml or create its lock', async () => {
  const f = fixture();
  try {
    const result = await start(f, 'Alpha', 'preview', false).done;
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout).metadata.written, false);
    assert.equal(readFileSync(f.portals, 'utf8'), initial);
    assert.equal(existsSync(f.portals + '.lock'), false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
