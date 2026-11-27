// A plain (non --json) full sweep had no signal handler, so a supervisor's
// SIGTERM or a Ctrl-C killed it with every match since the last periodic
// checkpoint lost. This stops a stubbed sweep with each signal, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCAN = join(ROOT, 'scan-ats-full.mjs');
const FIRST = 'https://jobs.example/sandbox-co-0/jobs/1';

function env(dir) {
  return {
    ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '',
    CAREER_OPS_PORTALS: '', CAREER_OPS_PIPELINE: '', CAREER_OPS_SCAN_HISTORY: '', CAREER_OPS_TRACKER: '',
    CAREER_OPS_DNS_LOOKUPS_PER_MIN: '0',
  };
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'ats-signal-stop-'));
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - director\n', 'utf-8');
  mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
  const list = Array.from({ length: 8 }, (_, i) => `sandbox-co-${i}`);
  writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'), JSON.stringify(list), 'utf-8');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n', 'utf-8');
  const fetched = join(dir, 'fetched.txt');
  writeFileSync(fetched, '', 'utf-8');
  const preload = join(dir, 'preload.mjs');
  // The first board returns one match; every other board hangs, so the sweep
  // is still running when the signal arrives.
  writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'greenhouse.mjs')).href)};
provider.fetchListing = undefined;
provider.fetch = async (entry) => {
  appendFileSync(${JSON.stringify(fetched)}, entry.name + '\\n');
  if (entry.name === 'sandbox-co-0') return [{ title: 'Director of Engineering', url: ${JSON.stringify(FIRST)}, company: 'Sandbox Co', location: 'Remote', postedAt: Date.now(), description: '' }];
  await new Promise(() => {});
};
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
`, 'utf-8');
  return { dir, preload, fetched };
}

const fetchedCount = (file) => readFileSync(file, 'utf-8').split('\n').filter(Boolean).length;

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
  // child.kill() is TerminateProcess on Windows, so no handler runs there.
  test(`${signal} during a plain sweep keeps matches, writes the checkpoint, and exits ${code}`, { skip: platform() === 'win32' }, async () => {
    const { dir, preload, fetched } = sandbox();
    try {
      const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, SCAN, '--ats', 'greenhouse', '--since', '7'], { cwd: dir, env: env(dir) });
        let out = '';
        let sent = false;
        const hard = setTimeout(() => child.kill('SIGKILL'), 20_000);
        // Wait until the match is in hand and the other workers are parked.
        const poll = setInterval(() => {
          if (!sent && fetchedCount(fetched) >= 3) { sent = true; clearInterval(poll); setTimeout(() => child.kill(signal), 300); }
        }, 50);
        child.stderr.on('data', (b) => { out += b.toString(); });
        child.stdout.on('data', (b) => { out += b.toString(); });
        child.on('close', (status) => { clearInterval(poll); clearTimeout(hard); resolve({ status, out }); });
      });
      assert.equal(result.status, code, result.out.slice(-600));
      assert.match(result.out, new RegExp(`${signal}: sweep stopped — 1 matches so far, saved to pipeline, checkpoint written \\(continue with --resume\\)`));
      assert.ok(readFileSync(join(dir, 'data', 'pipeline.md'), 'utf-8').split('\n').some((line) => line.trim() === `- [ ] ${FIRST}` || line.includes(`${FIRST} |`)));
      const checkpoint = join(dir, 'data', 'cache', 'ats-full-checkpoint.json');
      assert.ok(existsSync(checkpoint));
      assert.equal(JSON.parse(readFileSync(checkpoint, 'utf-8')).offers.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Matches the --seeds pass has found are held in a local array until the pass
// returns, so a signal mid-pass lost them.
test('SIGTERM during a --seeds pass keeps the matches that pass already found', { skip: platform() === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ats-signal-seeds-'));
  try {
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - director\n', 'utf-8');
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n', 'utf-8');
    const url = 'https://jobs.example/seed-co-0/jobs/1';
    const fetched = join(dir, 'fetched.txt');
    writeFileSync(fetched, '', 'utf-8');
    const preload = join(dir, 'preload.mjs');
    writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
import provider from ${JSON.stringify(pathToFileURL(join(ROOT, 'providers', 'greenhouse.mjs')).href)};
import { SEED_SOURCES } from ${JSON.stringify(pathToFileURL(join(ROOT, 'seeds', 'vc-portfolios.mjs')).href)};
SEED_SOURCES.yc.fetch = async () => Array.from({ length: 6 }, (_, i) => ({ name: 'Seed Co ' + i, slug: 'seed-co-' + i, url: '', source: 'test' }));
provider.fetch = async (entry) => {
  appendFileSync(${JSON.stringify(fetched)}, entry.name + '\\n');
  if (entry.name === 'Seed Co 0') return [{ title: 'Director of Engineering', url: ${JSON.stringify(url)}, company: 'Seed Co', location: 'Remote', postedAt: Date.now(), description: '' }];
  await new Promise(() => {});
};
globalThis.fetch = async () => new Response('{}', { status: 404 });
setInterval(() => {}, 1000);
`, 'utf-8');
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, SCAN, '--seeds', 'yc', '--since', '7'], { cwd: dir, env: env(dir) });
      let out = '';
      let sent = false;
      const hard = setTimeout(() => child.kill('SIGKILL'), 20_000);
      const poll = setInterval(() => {
        if (!sent && fetchedCount(fetched) >= 3) { sent = true; clearInterval(poll); setTimeout(() => child.kill('SIGTERM'), 300); }
      }, 50);
      child.stderr.on('data', (b) => { out += b.toString(); });
      child.stdout.on('data', (b) => { out += b.toString(); });
      child.on('close', (status) => { clearInterval(poll); clearTimeout(hard); resolve({ status, out }); });
    });
    assert.equal(result.status, 143, result.out.slice(-600));
    assert.match(result.out, /SIGTERM: sweep stopped — 1 matches so far, saved to pipeline/);
    assert.ok(readFileSync(join(dir, 'data', 'pipeline.md'), 'utf-8').split('\n').some((line) => line.trim() === `- [ ] ${url}` || line.includes(`${url} |`)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
