import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cli = fileURLToPath(new URL('../add-entry.mjs', import.meta.url));
const payload = name => ({
  cv: { section: 'Projects', dedupKey: name, entry: `- **${name}** — fictional project` },
  articleDigest: { dedupKey: name, entry: `## ${name} -- fictional project\n\nDetails.` },
});

async function race({ alias = false, duplicate = false, only, missingDigest = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-add-race-'));
  const cv = join(root, 'cv.md');
  const digest = join(root, 'article-digest.md');
  const marker = join(root, 'read');
  const done = join(root, 'done');
  const preload = join(root, 'pause.mjs');
  const children = [];
  writeFileSync(cv, '# Fictional CV\n\n## Projects\n\n- Existing project\n');
  if (!missingDigest) writeFileSync(digest, only === 'update' ? '# Fictional article digest\n\n## SharedProject -- fictional project\n\nDetails.\n' : '# Fictional article digest\n');
  mkdirSync(join(root, 'a'));
  mkdirSync(join(root, 'b'));
  const otherCv = alias ? join(root, 'cv-alias.md') : cv;
  if (alias) symlinkSync(cv, otherCv);
  const pauseFile = only === 'cv' ? cv : digest;
  writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync;
const exists = fs.existsSync;
let paused = false;
function pause(file) {
  if (!paused && file === ${JSON.stringify(pauseFile)}) {
    paused = true;
    fs.writeFileSync(${JSON.stringify(marker)}, 'read');
    const until = Date.now() + 2000;
    while (!exists(${JSON.stringify(done)}) && Date.now() < until) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}
fs.readFileSync = function(file, ...args) {
  const value = read.call(this, file, ...args);
  pause(file);
  return value;
};
fs.existsSync = function(file) {
  const value = exists(file);
  if (!value) pause(file);
  return value;
};
syncBuiltinESMExports();
`);
  function run(id, name, paused) {
    const input = join(root, `${id}.json`);
    const data = only === 'update'
      ? { articleDigestUpdate: { dedupKey: 'SharedProject', bullet: `- ${name} fictional update` } }
      : payload(name);
    if (only === 'cv') delete data.articleDigest;
    if (only === 'digest') delete data.cv;
    writeFileSync(input, JSON.stringify(data));
    const child = spawn(process.execPath, [...(paused ? ['--import', pathToFileURL(preload).href] : []), cli, input], {
      env: { ...process.env, CAREER_OPS_ROOT: join(root, id), CAREER_OPS_CV: id === 'b' ? otherCv : cv, CAREER_OPS_ARTICLE_DIGEST: digest },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', code => {
        if (!paused) writeFileSync(done, 'done');
        resolve({ code, stdout, stderr });
      });
    });
  }
  try {
    const first = run('a', 'AlphaProject', true);
    const deadline = Date.now() + 15000;
    while (!existsSync(marker)) {
      assert.ok(Date.now() < deadline, 'first CLI did not read the source files');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const results = await Promise.all([first, run('b', duplicate ? 'AlphaProject' : 'BetaProject', false)]);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    for (const file of only === 'cv' ? [cv] : ['digest', 'update'].includes(only) ? [digest] : [cv, digest]) {
      const text = readFileSync(file, 'utf8');
      assert.equal((text.match(/AlphaProject/g) || []).length, 1, text);
      if (!duplicate) assert.equal((text.match(/BetaProject/g) || []).length, 1, text);
    }
    if (duplicate) {
      const statuses = results.map(result => JSON.parse(result.stdout));
      assert.equal(statuses.filter(result => result.cv.status === 'added').length, 1);
      assert.equal(statuses.filter(result => result.articleDigest.status === 'added').length, 1);
    }
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    rmSync(root, { recursive: true, force: true, maxRetries: 10 });
  }
}

test('concurrent confirmed additions both survive in the CV and article digest', { timeout: 25000 }, () => race());
test('concurrent duplicate additions have only one successful inserter', { timeout: 25000 }, () => race({ duplicate: true }));
test('CV aliases and different data roots still serialize the same file', { skip: process.platform === 'win32', timeout: 25000 }, () => race({ alias: true, only: 'cv' }));
test('digest-only additions retain both confirmed entries', { timeout: 25000 }, () => race({ only: 'digest' }));
test('concurrent creation of a missing digest retains both confirmed entries', { timeout: 25000 }, () => race({ only: 'digest', missingDigest: true }));
test('concurrent digest updates retain both confirmed bullets', { timeout: 25000 }, () => race({ only: 'update' }));
