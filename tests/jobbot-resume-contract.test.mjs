import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import test from 'node:test';
import { buildResumeRequest, listResumeCandidates, renderResume, validateTailoringResult } from '../jobbot-resume.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'careerops-resume-'));
  for (const path of ['data', 'reports', 'config', 'modes', 'templates/ats', 'output']) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report |',
    '|---|---|---|---|---|---|---|---|',
    '| 7 | 2026-08-30 | Example Labs | Platform Engineer | 4.5 | EVALUATED | ❌ | [007](../reports/007-example-labs-platform-engineer.md) |',
  ].join('\n'));
  writeFileSync(join(root, 'reports/007-example-labs-platform-engineer.md'), '# Evaluation\n| Location | Singapore |\nRequirements: Python and distributed systems.');
  writeFileSync(join(root, 'cv.md'), '# CV\nExample Labs evidence: built Python systems.');
  writeFileSync(join(root, 'config/profile.yml'), 'candidate:\n  full_name: Test Candidate\n  email: test@example.invalid\n  location: Singapore\n');
  writeFileSync(join(root, 'modes/pdf.md'), '# PDF rules\nNever invent facts.');
  writeFileSync(join(root, 'templates/ats/cv-template.ats.html'), '<!doctype html><html><body>{{summary}}</body></html>');
  return root;
}

function tailoring(request) {
  return {
    version: 'resume.tailoring.result@1',
    manifest_hash: request.manifest_hash,
    opportunity: { report_id: '7', company: 'Example Labs', role: 'Platform Engineer' },
    summary: 'Platform engineer with Python systems experience.',
    competencies: ['Python', 'Distributed systems'],
    experience: [{ company: 'Example Labs', role: 'Engineer', location: 'Singapore', dates: '2020 - 2026', bullets: ['Built Python systems.'] }],
    projects: [], education: [], certifications: [], awards: [],
    skills: [{ category: 'Languages', items: ['Python'] }],
  };
}

test('request is deterministic, bounded, versioned, and path-free', () => {
  const root = workspace();
  const first = buildResumeRequest({ workspace: root, query: '7' });
  const second = buildResumeRequest({ workspace: root, query: '7' });
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.version, 'careerops.resume.request@1');
  assert.equal(first.role_context.trust, 'external_untrusted');
  assert.equal(first.render_policy.template, 'ats');
  assert.equal(JSON.stringify(first).includes(root), false);
});

test('candidate list is path-free and exact report selection is deterministic', () => {
  const root = workspace();
  const listed = listResumeCandidates({ workspace: root });
  assert.deepEqual(listed, {
    version: 'careerops.resume.candidates@1',
    candidates: [{ report_id: '7', company: 'Example Labs', role: 'Platform Engineer', status: 'EVALUATED' }],
  });
  assert.equal(JSON.stringify(listed).includes(root), false);
  assert.equal(buildResumeRequest({ workspace: root, reportId: '7' }).opportunity.report_id, '7');
});

test('request refuses an ambiguous or unevaluated identity', () => {
  const root = workspace();
  writeFileSync(join(root, 'data/applications.md'), `${readFileSync(join(root, 'data/applications.md'), 'utf8')}\n| 8 | 2026-08-30 | Example Labs | Platform Engineer II | 4.0 | EVALUATED | ❌ | [008](../reports/008-example-labs-platform-engineer-ii.md) |`);
  assert.throws(() => buildResumeRequest({ workspace: root, query: 'Example Labs' }), /ambiguous/);
  assert.throws(() => buildResumeRequest({ workspace: root, query: 'missing' }), /matched no/);
});

test('tailoring is exact, manifest-bound, and opportunity-bound', () => {
  const root = workspace();
  const request = buildResumeRequest({ workspace: root, query: '7' });
  assert.equal(validateTailoringResult(tailoring(request), request).version, 'resume.tailoring.result@1');
  assert.throws(() => validateTailoringResult({ ...tailoring(request), manifest_hash: 'sha256:bad' }, request), /manifest/);
  assert.throws(() => validateTailoringResult({ ...tailoring(request), extra: true }, request), /fields/);
});

test('render uses existing builder, fact gate, and renderer and emits a path-free receipt', () => {
  const root = workspace();
  const request = buildResumeRequest({ workspace: root, query: '7' });
  const calls = [];
  const run = (_command, args) => {
    calls.push(args);
    if (args[0].endsWith('build-cv-html.mjs')) writeFileSync(args[2], '<!doctype html><html><body>Platform engineer</body></html>');
    if (args[0].endsWith('verify-cv-facts.mjs')) return { status: 0, stdout: '{"verdict":"pass"}', stderr: '' };
    if (args[0].endsWith('generate-pdf.mjs')) {
      writeFileSync(args[2], '%PDF-1.7\nsynthetic\n%%EOF\n');
      return { status: 0, stdout: 'Pages: 1\n', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const key = '123e4567-e89b-12d3-a456-426614174000';
  const outputRoot = mkdtempSync(join(tmpdir(), 'jobbot-controlled-staging-'));
  const receipt = renderResume({ workspace: root, request, tailoring: tailoring(request), outputRoot, outputKey: key, run });
  assert.equal(receipt.version, 'careerops.resume.render.receipt@1');
  assert.equal(receipt.artifact_key, `${key}/resume.pdf`);
  assert.equal(receipt.mime_type, 'application/pdf');
  assert.equal(JSON.stringify(receipt).includes(root), false);
  assert.equal(JSON.stringify(receipt).includes(outputRoot), false);
  assert.equal(calls.some(args => args.includes('--report=7')), false);
  assert.equal(calls.some(args => args.includes(`--jobbot-staging-root=${realpathSync(outputRoot)}`)), true);
});

test('checked-in ATS template accepts the JobBot candidate contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'careerops-ats-template-'));
  const input = join(root, 'resume-input.json');
  const output = join(root, 'resume.html');
  writeFileSync(input, JSON.stringify({
    lang: 'en', page_format: 'a4',
    candidate: { name: 'Test Candidate', email: 'test@example.invalid', location: 'Singapore' },
    summary: 'Verified summary.', competencies: [], experience: [], projects: [], education: [], certifications: [], awards: [], skills: [],
  }));
  const result = spawnSync(process.execPath, [join(import.meta.dirname, '..', 'build-cv-html.mjs'), input, output, join(import.meta.dirname, '..', 'templates/ats/cv-template.ats.html')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(output, 'utf8').includes('{{'), false);
});

test('render refuses changed source bytes before running a command', () => {
  const root = workspace();
  const request = buildResumeRequest({ workspace: root, query: '7' });
  writeFileSync(join(root, 'cv.md'), '# changed');
  const outputRoot = join(root, 'controlled-staging');
  mkdirSync(outputRoot, { mode: 0o700 });
  let calls = 0;
  assert.throws(() => renderResume({ workspace: root, request, tailoring: tailoring(request), outputRoot, outputKey: '123e4567-e89b-12d3-a456-426614174000', run: () => { calls++; } }), /changed/);
  assert.equal(calls, 0);
});

test('render refuses changed PDF rules before running a command', () => {
  const root = workspace();
  const request = buildResumeRequest({ workspace: root, query: '7' });
  writeFileSync(join(root, 'modes/pdf.md'), '# changed rules');
  const outputRoot = join(root, 'controlled-staging');
  mkdirSync(outputRoot, { mode: 0o700 });
  let calls = 0;
  assert.throws(() => renderResume({ workspace: root, request, tailoring: tailoring(request), outputRoot, outputKey: '123e4567-e89b-12d3-a456-426614174000', run: () => { calls++; } }), /rules changed/);
  assert.equal(calls, 0);
});

test('render refuses a symlinked evaluation report', () => {
  const root = workspace();
  const report = join(root, 'reports/007-example-labs-platform-engineer.md');
  const outside = join(tmpdir(), `outside-${Date.now()}.md`);
  writeFileSync(outside, 'outside');
  writeFileSync(report, 'temporary');
  // The report resolver follows the final path and then enforces workspace containment.
  const linked = join(root, 'reports/009-linked.md');
  symlinkSync(outside, linked);
  const tracker = readFileSync(join(root, 'data/applications.md'), 'utf8').replace('../reports/007-example-labs-platform-engineer.md', '../reports/009-linked.md');
  writeFileSync(join(root, 'data/applications.md'), tracker);
  assert.throws(() => buildResumeRequest({ workspace: root, query: '7' }), /escapes/);
});
