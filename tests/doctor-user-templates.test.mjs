// doctor.mjs warns about the user's own templates (#5777): one that no longer
// resolves, or that lost a slot every shipped variant keeps. Advisory only: it
// never makes onboardingNeeded true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function doctorJson(target) {
  return JSON.parse(execFileSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--json', '--target', target], {
    cwd: target, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function target(templates) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-tpl-'));
  mkdirSync(join(dir, 'data', 'templates'), { recursive: true });
  for (const [file, text] of Object.entries(templates)) writeFileSync(join(dir, 'data', 'templates', file), text);
  return dir;
}

test('a user template that no longer resolves is a doctor warning naming the file', () => {
  const dir = target({ 'cv-template.broken.html': '{{NAME}}' });

  const out = doctorJson(dir);

  const warning = out.warnings.find((w) => w.includes('cv-template.broken.html'));
  assert.ok(warning, JSON.stringify(out.warnings));
  assert.match(warning, /missing required placeholders/);
});

test('a healthy user template adds no warning', () => {
  // A copy of the shipped base template: the realistic healthy case, whatever
  // slots the shipped set keeps today.
  const dir = target({ 'cv-template.fine.html': readFileSync(join(ROOT, 'templates', 'cv-template.html'), 'utf-8') });

  const out = doctorJson(dir);

  assert.ok(!out.warnings.some((w) => w.includes('cv-template.fine.html')), JSON.stringify(out.warnings));
});

test('the audit is advisory: it does not turn onboarding on', () => {
  const dir = target({ 'cv-template.broken.html': '{{NAME}}' });

  assert.equal(doctorJson(dir).onboardingNeeded, doctorJson(target({})).onboardingNeeded);
});

test('the shipped baseline comes from the checkout being diagnosed when it has a templates directory', () => {
  // This checkout ships only NAME, EXPERIENCE and EDUCATION in its variants, so a
  // user template with just those keeps every slot the target's shipped set keeps.
  // Against THIS checkout's shipped set it would be flagged for lacking more.
  const dir = target({ 'cv-template.lean.html': '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}' });
  mkdirSync(join(dir, 'templates'));
  writeFileSync(join(dir, 'templates', 'cv-template.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}{{SKILLS}}');
  writeFileSync(join(dir, 'templates', 'cv-template.modern.html'), '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}');

  const out = doctorJson(dir);

  // An audit that threw would also leave this template unmentioned, so rule it out.
  assert.ok(!out.warnings.some((w) => w.includes('could not be audited')), JSON.stringify(out.warnings));
  assert.ok(!out.warnings.some((w) => w.includes('cv-template.lean.html')), JSON.stringify(out.warnings));

  // The same template in a data-only target (no templates/ of its own) is judged
  // against this checkout's shipped set, which keeps more slots, so it is flagged.
  const dataOnly = target({ 'cv-template.lean.html': '{{NAME}}{{EXPERIENCE}}{{EDUCATION}}' });
  const flagged = doctorJson(dataOnly).warnings.find((w) => w.includes('cv-template.lean.html'));
  assert.ok(flagged, 'a data-only target falls back to this checkout as the baseline');
  assert.match(flagged, /lacks/);
});
