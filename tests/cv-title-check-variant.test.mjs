// cv-title-check.mjs --variant <name> (#6792): checks a content variant's
// titles against cv.md. Without the flag nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CV = '## Work Experience\n\n### Acme Corp -- Sydney\n\n**Engineer**\n2020-2024\n\n- Led a team of 3 engineers\n';

function run(args, variants = {}, cv = CV) {
  const dir = mkdtempSync(join(tmpdir(), 'co-title-var-'));
  writeFileSync(join(dir, 'cv.md'), cv);
  mkdirSync(join(dir, 'data', 'cv-variants'), { recursive: true });
  for (const [f, t] of Object.entries(variants)) writeFileSync(join(dir, 'data', 'cv-variants', f), t);
  return spawnSync(process.execPath, [join(ROOT, 'cv-title-check.mjs'), ...args], {
    cwd: dir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PROFILE: join(dir, 'config', 'profile.yml') },
  });
}

test('an inflated variant title is reported with both strings, exit 0 (warn-only)', () => {
  const r = run(['--variant', 'a', '--summary'], { 'a.md': CV.replace('**Engineer**', '**CTO**') });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"Engineer"/);
  assert.match(r.stdout, /"CTO"/);
});

test('a clean variant prints the no-drift line', () => {
  const r = run(['--variant', 'a', '--summary'], { 'a.md': CV });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No title drift/);
});

test('a missing variant exits 1', () => {
  assert.equal(run(['--variant', 'nope']).status, 1);
});

test('--variant=<name> selects the variant too', () => {
  const r = run(['--variant=a', '--summary'], { 'a.md': CV.replace('**Engineer**', '**CTO**') });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"CTO"/);
});

for (const form of [['--variant'], ['--variant='], ['--variant', '--summary']]) {
  test(`${form[0]} with no name and a payload argument exits 1, not payload mode`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'co-title-var-'));
    writeFileSync(join(dir, 'p.json'), '{"experience":[{"company":"Acme Corp","role":"Engineer","dates":"2020-2024"}]}');
    writeFileSync(join(dir, 'cv.md'), CV);
    const r = spawnSync(process.execPath, [join(ROOT, 'cv-title-check.mjs'), join(dir, 'p.json'), ...form], {
      cwd: dir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /--variant requires a name/);
  });
}

test('a bullet moved under another employer is reported in a variant run (#6792)', () => {
  const cv = `${CV}\n### Beta Ltd -- Remote\n\n**Engineer**\n2018-2020\n\n- Built an NLP pipeline with 94% accuracy\n`;
  const moved = `${CV}- Built an NLP pipeline with 94% accuracy\n`;
  const r = run(['--variant', 'a', '--summary'], { 'a.md': moved }, cv);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /under Beta Ltd in cv\.md/);
});

// --archetype (#6792): the variant comes from cv.variants in config/profile.yml.
function runMapped(args, { map = 'backend: ["Backend Engineer"]', variants = { 'backend.md': CV } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-title-arch-'));
  writeFileSync(join(dir, 'cv.md'), CV);
  mkdirSync(join(dir, 'data', 'cv-variants'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  for (const [f, t] of Object.entries(variants)) writeFileSync(join(dir, 'data', 'cv-variants', f), t);
  writeFileSync(join(dir, 'config', 'profile.yml'), `cv:\n  variants:\n    ${map.replace(/\n/g, '\n    ')}\n`);
  return spawnSync(process.execPath, [join(ROOT, 'cv-title-check.mjs'), ...args], {
    cwd: dir, encoding: 'utf-8', env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PROFILE: join(dir, 'config', 'profile.yml') },
  });
}

test('--archetype with a mapped archetype names the variant and checks it', () => {
  const r = runMapped(['--archetype', 'backend engineer', '--summary'], { variants: { 'backend.md': CV.replace('**Engineer**', '**CTO**') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Variant: backend \(from archetype "backend engineer"\)/m);
  assert.match(r.stdout, /"CTO"/);
});

test('--archetype with an unmapped archetype falls back to cv.md and exits 0', () => {
  const r = runMapped(['--archetype', 'Data Analyst', '--summary']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Variant: none \(cv\.md\)/m);
});

test('--variant wins over the archetype mapping', () => {
  const r = runMapped(['--archetype', 'Backend Engineer', '--variant', 'other', '--summary'], { variants: { 'backend.md': CV, 'other.md': CV } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Variant: other/m);
});

test('--archetype stops on a mapped variant that is missing or unparseable', () => {
  assert.equal(runMapped(['--archetype', 'Backend Engineer'], { variants: {} }).status, 1);
  assert.equal(runMapped(['--archetype', 'Backend Engineer'], { variants: { 'backend.md': '# Jane\n' } }).status, 1);
});

test('--archetype stops on an archetype mapped by two variants', () => {
  const r = runMapped(['--archetype', 'Backend Engineer'], { map: 'a: ["Backend Engineer"]\nb: ["Backend Engineer"]', variants: { 'a.md': CV, 'b.md': CV } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a.*b/);
});

test('--archetype without a value exits 1', () => {
  assert.equal(runMapped(['--archetype']).status, 1);
  assert.equal(runMapped(['--archetype', '--summary']).status, 1);
});

test('--archetype with no mapping prints parseable JSON without --summary', () => {
  const r = runMapped(['--archetype', 'Data Analyst']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { variant: null });
});
