// Verifies sourced CV proposals preview, deduplicate, and require confirmation.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'career-ops-cv-maintenance-'));
try {
  const cv = join(root, 'cv.md'); const digest = join(root, 'article-digest.md'); const proposal = join(root, 'proposal.json');
  writeFileSync(cv, '# CV\n\n## Projects\n');
  const base = { source: 'user-stated', sourceRef: 'conversation:2026-09-15', exactEvidence: 'Project: Atlas', targetSection: 'Projects', proposedWording: '- **Atlas** — Documented project.', dedupKey: 'Atlas', provenance: 'verified', provenanceRef: 'user-stated:2026-09-15', claimKinds: [] };
  writeFileSync(proposal, JSON.stringify({ proposals: [base] }));
  const run = args => spawnSync(process.execPath, [join(process.cwd(), 'cv-maintenance.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, CAREER_OPS_CV: cv, CAREER_OPS_ARTICLE_DIGEST: digest } });
  assert.equal(run(['preview', proposal]).status, 0);
  assert.notEqual(run(['apply', proposal]).status, 0);
  assert.equal(run(['apply', proposal, '--confirm', 'approved']).status, 0);
  assert.match(readFileSync(cv, 'utf8'), /Atlas/);
  assert.equal(JSON.parse(run(['preview', proposal]).stdout).preview[0].result.cv.status, 'duplicate');
  assert.equal(JSON.parse(run(['apply', proposal, '--confirm', 'approved']).stdout).applied, false);
  writeFileSync(proposal, JSON.stringify({ proposals: [base, { ...base, proposedWording: '- **Atlas Two**', dedupKey: 'atlas' }] }));
  assert.notEqual(run(['preview', proposal]).status, 0);
  writeFileSync(proposal, JSON.stringify({ proposals: [{ ...base, source: 'external-discovery', sourceRef: 'https://example.com', dedupKey: 'Atlas 2', proposedWording: '- **Atlas 2** — Built systems.', provenance: 'unverified', provenanceRef: 'https://example.com', claimKinds: [] }] }));
  assert.notEqual(run(['preview', proposal]).status, 0);
  writeFileSync(proposal, JSON.stringify({ proposals: [{ ...base, source: 'external-discovery', sourceRef: 'https://example.com', dedupKey: 'Atlas Three', proposedWording: '- **Atlas Three** — Responsible for a team.', provenance: 'unverified', provenanceRef: 'https://example.com', claimKinds: [] }] }));
  assert.equal(run(['preview', proposal]).status, 0);
  assert.notEqual(run(['apply', proposal, '--confirm', 'approved']).status, 0);
  console.log('cv maintenance: sourced preview, confirmation, dedup, and provenance gate passed');
} finally { rmSync(root, { recursive: true, force: true }); }
