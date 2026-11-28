// tests/add-certifications.test.mjs — verify modes/add.md maps certifications
// to a dedicated Certifications section and add-entry.mjs inserts & dedups it.
//
// Run:  node --test tests/add-certifications.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('modes/add.md maps certifications to Certifications (create if absent)', () => {
  const md = readFileSync(join(ROOT, 'modes', 'add.md'), 'utf-8');
  assert.match(md, /\| a certification \/ credential \| `Certifications` \(create if absent\) \|/);
  assert.match(md, /## Publications` or `## Certifications`/);
});

test('add-entry.mjs creates ## Certifications and deduplicates on re-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'add-cert-'));
  try {
    const cvPath = join(dir, 'cv.md');
    const payloadPath = join(dir, 'payload.json');
    writeFileSync(cvPath, '# Candidate\n\n## Projects\n- **Demo** — example\n');
    writeFileSync(payloadPath, JSON.stringify({
      cv: {
        section: 'Certifications',
        dedupKey: 'AWS Certified Machine Learning - Specialty',
        entry: '- **AWS Certified Machine Learning - Specialty** (Amazon Web Services, 2026-11) — https://www.credly.com/badges/example',
      },
    }));

    const env = { ...process.env, CAREER_OPS_CV: cvPath };
    const first = spawnSync(process.execPath, [join(ROOT, 'add-entry.mjs'), payloadPath], { env, encoding: 'utf-8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).cv.status, 'added');

    const updated = readFileSync(cvPath, 'utf-8');
    assert.match(updated, /^## Certifications$/m);
    assert.match(updated, /AWS Certified Machine Learning - Specialty/);

    const second = spawnSync(process.execPath, [join(ROOT, 'add-entry.mjs'), payloadPath], { env, encoding: 'utf-8' });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).cv.status, 'duplicate');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
