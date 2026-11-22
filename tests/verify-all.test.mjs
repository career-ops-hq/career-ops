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

function run(dir, args, cwd = dir, extraEnv = {}) {
  // Pin the link-guard configuration so the result does not depend on the
  // machine running the test (an ambient proxy or DNS-cache opt-out).
  const env = { ...process.env, CAREER_OPS_ROOT: dir, ...extraEnv };
  for (const k of ['CAREER_OPS_NO_DNS_CACHE', 'NODE_USE_ENV_PROXY', 'CAREER_OPS_TRUST_PROXY_EGRESS']) {
    if (!(k in extraEnv)) delete env[k];
  }
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env });
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

test('isPrivateHost applies address ranges to IP literals only, not to names that start like one', () => {
  for (const u of ['https://fcc.gov', 'https://fdic.gov/about', 'https://127.example.com', 'https://10x.dev', 'https://fe80.example.org']) {
    assert.equal(isPrivateHost(u), false, u);
  }
  for (const u of ['http://169.254.169.254/latest', 'http://[::ffff:127.0.0.1]/', 'http://[fd12::1]/', 'http://[fe80::1]/', 'http://printer.local/', 'http://localhost./']) {
    assert.equal(isPrivateHost(u), true, u);
  }
});

test('unpinnedNamed matches whole repo names, case-insensitively', () => {
  assert.deepEqual(unpinnedNamed('<p>Shipped RootCause and litmus-x</p>', ['rootcause', 'litmus', 'litmus-x'], ['LITMUS-X']), ['rootcause']);
});

test('unpinnedNamed still finds a repo name followed by sentence punctuation', () => {
  assert.deepEqual(unpinnedNamed('I built rootcause. Then litmus-x, and my.repo!', ['rootcause', 'litmus-x', 'my.repo'], []), ['rootcause', 'litmus-x', 'my.repo']);
});

test('a bare relative path resolves in the data root, not the working directory', () => {
  const dir = workspace({ 'cv.md': CV, 'clean.md': '- Ran the weekly release train for the payments app\n' });
  const elsewhere = mkdtempSync(join(tmpdir(), 'verify-all-cwd-'));
  try {
    const r = run(dir, ['clean.md'], elsewhere);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // ./ names the working directory on purpose, where there is no such file.
    assert.equal(run(dir, ['./clean.md'], elsewhere).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('--links never dials a private literal, however it is spelled', () => {
  const dir = workspace({
    'cv.md': CV,
    'links.md': '- Ran the weekly release train for the payments app\n\nhttp://2130706433:9/ http://0x7f.1:9/ http://169.254.169.254/latest\n',
  });
  try {
    const r = run(dir, ['links.md', '--links']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal((r.stdout.match(/not checked \(private or local host\)/g) || []).length, 3, r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--links reports a malformed link as a failure instead of throwing', () => {
  const dir = workspace({ 'cv.md': CV, 'bad.md': '- Ran the weekly release train for the payments app\n\nhttp://[::1\n' });
  try {
    const r = run(dir, ['bad.md', '--links']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /\[fail\] http:\/\/\[::1: not a valid URL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--links still fails a malformed link when the address guard skips the network checks', () => {
  const dir = workspace({ 'cv.md': CV, 'bad.md': '- Ran the weekly release train for the payments app\n\nhttp://[::1\n' });
  try {
    for (const extra of [{ CAREER_OPS_NO_DNS_CACHE: '1' }, { NODE_USE_ENV_PROXY: '1' }]) {
      const r = run(dir, ['bad.md', '--links'], dir, extra);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, /\[fail\] http:\/\/\[::1: not a valid URL/);
      assert.match(r.stdout, /links not checked/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
