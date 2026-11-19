// doctor.mjs warns about CV content variants (#6792) that fail to parse or
// have drifted from cv.md. Advisory only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CV = '## Work Experience\n\n### Acme Corp -- Sydney\n\n**Engineer**\n2020-2024\n\n- Led a team of 3 engineers\n';

function doctorJson(target) {
  return JSON.parse(execFileSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--json', '--target', target], {
    cwd: target, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function target(variants) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-var-'));
  writeFileSync(join(dir, 'cv.md'), CV);
  mkdirSync(join(dir, 'data', 'cv-variants'), { recursive: true });
  for (const [file, text] of Object.entries(variants)) writeFileSync(join(dir, 'data', 'cv-variants', file), text);
  return dir;
}

test('a variant that does not parse is a warning naming the file', () => {
  const out = doctorJson(target({ 'broken.md': '# nothing\n' }));
  const warning = out.warnings.find((w) => w.includes('broken.md'));
  assert.ok(warning, JSON.stringify(out.warnings));
});

test('a drifted variant is a warning', () => {
  const out = doctorJson(target({ 'drift.md': CV.replace('**Engineer**', '**CTO**') }));
  assert.ok(out.warnings.some((w) => w.includes('drift.md') && w.includes('CTO')), JSON.stringify(out.warnings));
});

test('a healthy variant and no variants add no warning, and onboarding is unchanged', () => {
  const healthy = doctorJson(target({ 'fine.md': CV }));
  assert.ok(!healthy.warnings.some((w) => w.includes('cv-variants')), JSON.stringify(healthy.warnings));
  const none = doctorJson(target({}));
  assert.ok(!none.warnings.some((w) => w.includes('cv-variants')));
  assert.equal(doctorJson(target({ 'broken.md': 'x' })).onboardingNeeded, none.onboardingNeeded);
});
