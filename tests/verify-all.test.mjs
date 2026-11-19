import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractUrls, isPrivateHost, unpinnedNamed } from '../verify-all.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'verify-all.mjs');

const CV = `# Jane Doe

## Experience

### Program Manager, Northwind Payments
2021 - 2024

- Ran the weekly release train for the payments app
- Cut deploy time from 2 weeks to 4 hours by writing a checklist the engineers follow
`;

function workspace(files) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-all-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

function run(dir, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CAREER_OPS_ROOT: dir },
  });
}

test('extractUrls keeps scheme links and bare profile hosts, skips emails and file names', () => {
  const urls = extractUrls('<a href="https://x.dev/a?b=1&amp;c=2">x</a> github.com/Jo, linkedin.com/in/jo. j@x.com node.js www.jo.me.');
  assert.deepEqual(urls.sort(), ['https://github.com/Jo', 'https://linkedin.com/in/jo', 'https://www.jo.me', 'https://x.dev/a?b=1&c=2'].sort());
});

test('isPrivateHost refuses loopback and private ranges only', () => {
  for (const u of ['http://localhost:8080', 'http://127.0.0.1/', 'http://10.1.2.3', 'http://172.20.0.1', 'http://[::1]/', 'not a url']) {
    assert.equal(isPrivateHost(u), true, u);
  }
  for (const u of ['https://example.com', 'https://172.32.0.1', 'https://github.com/jo']) {
    assert.equal(isPrivateHost(u), false, u);
  }
});

test('unpinnedNamed matches whole repo names, case-insensitively', () => {
  assert.deepEqual(unpinnedNamed('<p>Shipped RootCause and litmus-x</p>', ['rootcause', 'litmus', 'litmus-x'], ['LITMUS-X']), ['rootcause']);
});

test('usage errors exit 2', () => {
  const dir = workspace({ 'cv.md': CV });
  try {
    assert.equal(run(dir, []).status, 2);
    assert.equal(run(dir, ['missing.md']).status, 2);
    assert.equal(run(dir, ['cv.md', '--nope']).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file in the candidate words passes; a stock phrase fails the voice check', () => {
  const dir = workspace({
    'cv.md': CV,
    'clean.md': '- Ran the weekly release train for the payments app\n',
    'tell.md': '- Spearheaded the weekly release train for the payments app\n',
  });
  try {
    const clean = run(dir, ['clean.md']);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const tell = run(dir, ['tell.md']);
    assert.equal(tell.status, 1, tell.stdout + tell.stderr);
    assert.match(tell.stdout, /spearheaded/i);
    const self = run(dir, ['cv.md']);
    assert.match(self.stdout, /Voice: skipped/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
