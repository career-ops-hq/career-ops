// tests/validate-template-registry.test.mjs — the shape gate for
// templates-registry/<id>.json (#5947), the template-pack analog of
// validate-plugin-registry.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateRegistry } from '../validate-template-registry.mjs';
import { loadRegistry, loadRegistryFiles, validateRegistryEntry } from '../lib/templates-registry.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SHA = 'a'.repeat(40);

const good = (over = {}) => ({
  name: 'career-ops-template-reactive',
  id: 'reactive',
  repo: 'https://github.com/rubicon/career-ops-template-reactive',
  kind: ['cv', 'cover'],
  themes: 15,
  ats: true,
  license: 'MIT',
  version: '0.1.0',
  sha: SHA,
  ...over,
});

const dirs = [];
function root(files = {}) {
  const r = mkdtempSync(join(tmpdir(), 'tpl-reg-'));
  dirs.push(r);
  if (Object.keys(files).length) mkdirSync(join(r, 'templates-registry'));
  for (const [f, body] of Object.entries(files)) {
    writeFileSync(join(r, 'templates-registry', f), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return r;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const entryProblems = (e) => validateRegistryEntry(e, { idRe: ID_RE });

test('a well-formed entry has no problems', () => {
  assert.deepEqual(entryProblems(good()), []);
});

const BAD = [
  ['name without the prefix', { name: 'reactive' }, /name must start with/],
  ['name that does not match the id', { name: 'career-ops-template-other' }, /name must equal/],
  ['an id with capitals', { id: 'Reactive', name: 'career-ops-template-Reactive' }, /invalid id/],
  ['a repo that is not a GitHub URL', { repo: 'https://gitlab.com/a/b' }, /repo must be/],
  ['a short sha', { sha: 'abc123' }, /sha must be a 40-hex/],
  ['a repo URL whose repo name is in the query', { repo: 'https://github.com/alice?tab=repo/pack' }, /repo must be/],
  ['a repo URL with a query string', { repo: 'https://github.com/alice/pack?x=1' }, /repo must be/],
  ['a repo URL with a fragment', { repo: 'https://github.com/alice/pack#readme' }, /repo must be/],
  ['a repo URL with a trailing slash', { repo: 'https://github.com/alice/pack/' }, /repo must be/],
  ['a repo URL with a third path segment', { repo: 'https://github.com/alice/pack/tree/main' }, /repo must be/],
  ['a repo URL whose repo is ..', { repo: 'https://github.com/owner/..' }, /repo must be/],
  ['a repo URL whose repo is .', { repo: 'https://github.com/owner/.' }, /repo must be/],
  ['a repo URL whose owner is ..', { repo: 'https://github.com/../pack' }, /repo must be/],
  ['a repo URL whose owner is .', { repo: 'https://github.com/./pack' }, /repo must be/],
  ['a repo whose name is not career-ops-template-<id>', { repo: 'https://github.com/alice/other-name' }, /repo name must equal/],
  ['a repo named for a different id', { repo: 'https://github.com/alice/career-ops-template-other' }, /repo name must equal/],
  ['a repo given as an array', { repo: ['https://github.com/alice/pack'] }, /repo must be/],
  ['a sha given as an array', { sha: ['a'.repeat(40)] }, /sha must be a 40-hex/],
  ['an uppercase sha', { sha: 'A'.repeat(40) }, /sha must be a 40-hex/],
  ['an empty kind', { kind: [] }, /kind must be/],
  ['an unknown kind', { kind: ['cv', 'tex'] }, /kind must be/],
  ['a kind that is not an array', { kind: 'cv' }, /kind must be/],
  ['zero themes', { themes: 0 }, /themes must be a positive integer/],
  ['fractional themes', { themes: 1.5 }, /themes must be a positive integer/],
  ['themes as a string', { themes: '15' }, /themes must be a positive integer/],
  ['ats as a string', { ats: 'true' }, /ats must be a boolean/],
  ['a missing license', { license: '' }, /license is required/],
  ['a missing version', { version: undefined }, /version is required/],
];
for (const [label, over, re] of BAD) {
  test(`rejects ${label}`, () => {
    const errs = entryProblems(good(over));
    assert.ok(errs.some((e) => re.test(e)), `expected ${re}, got ${JSON.stringify(errs)}`);
  });
}

test('ats false and a single kind are valid', () => {
  assert.deepEqual(entryProblems(good({ ats: false, kind: ['cover'], themes: 1 })), []);
});

test('an empty or missing registry directory is valid', () => {
  assert.deepEqual(validateRegistry(root()), []);
  assert.deepEqual(validateRegistry(root({})), []);
});

test('a valid single-file registry passes', () => {
  assert.deepEqual(validateRegistry(root({ 'reactive.json': good() })), []);
});

test('the filename must equal <id>.json', () => {
  const p = validateRegistry(root({ 'wrong.json': good() }));
  assert.ok(p.some((x) => /wrong\.json: filename must equal "<id>\.json" \(id is "reactive"\)/.test(x)), JSON.stringify(p));
});

test('duplicate names and ids are reported', () => {
  const p = validateRegistry(root({
    'reactive.json': good(),
    'other.json': good({ id: 'reactive' }),
  }));
  assert.ok(p.some((x) => /duplicate name/.test(x)), JSON.stringify(p));
  assert.ok(p.some((x) => /duplicate id: reactive/.test(x)), JSON.stringify(p));
});

test('a file that is not JSON is reported, not skipped', () => {
  const p = validateRegistry(root({ 'broken.json': '{ nope' }));
  assert.ok(p.some((x) => /broken\.json: not a JSON object/.test(x)), JSON.stringify(p));
});

test('a JSON file that is not an object is reported', () => {
  const p = validateRegistry(root({ 'list.json': '[]', 'null.json': 'null' }));
  assert.equal(p.filter((x) => /not a JSON object/.test(x)).length, 2, JSON.stringify(p));
});

test('non-JSON files in the directory are ignored', () => {
  assert.deepEqual(validateRegistry(root({ 'README.md': '# notes', 'reactive.json': good() })), []);
});

test('loadRegistry returns the packs sorted by filename and drops malformed files', () => {
  const r = root({ 'b.json': good({ id: 'b', name: 'career-ops-template-b' }), 'a.json': good({ id: 'a', name: 'career-ops-template-a' }), 'x.json': '{' });
  assert.deepEqual(loadRegistry(r).packs.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(loadRegistryFiles(r).map((f) => f.file), ['a.json', 'b.json', 'x.json']);
});

test('the shipped registry is valid', () => {
  assert.deepEqual(validateRegistry(ROOT), []);
});

test('the CLI exits 0 on a valid registry and 1 with problems on a bad one', () => {
  const ok = spawnSync('node', ['validate-template-registry.mjs'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /template registry is valid/);
  const bad = spawnSync('node', [join(ROOT, 'validate-template-registry.mjs'), '--root', root({ 'x.json': good({ sha: 'no' }) })], { encoding: 'utf-8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /sha must be a 40-hex/);
});

test('--root without a directory is a usage error, never the default root', () => {
  for (const args of [['--root'], ['--root', '--help-not']]) {
    const r = spawnSync('node', ['validate-template-registry.mjs', ...args], { cwd: ROOT, encoding: 'utf-8' });
    assert.equal(r.status, 2, `args ${args}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /Usage: node validate-template-registry\.mjs/);
  }
});

test('--help prints usage and does not validate', () => {
  const r = spawnSync('node', ['validate-template-registry.mjs', '--help'], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: node validate-template-registry\.mjs/);
  assert.doesNotMatch(r.stdout, /✓/);
});
