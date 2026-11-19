import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createEngine } from '../engine.mjs';
import { candidate, cvHtml, modelServer, engineRevision, browserExecutable } from './fixtures.mjs';

const engineFor = provider => createEngine({ provider, engineRevision, browserExecutable, allowLocalProvider: true });
const evaluate = (engine, workspace) => engine.evaluate({ workspace, jobId: randomUUID(), postingText: 'Example Employer needs a Python Software Engineer.', postingUrl: 'https://example.org/jobs/engineer' });

test('complete real engine flow: two candidates evaluate, tailor, render and register distinct PDFs', async t => {
  const a = await candidate(t), b = await candidate(t, 'Synthetic Beta');
  const mock = await modelServer(t);
  const engine = engineFor(mock.provider);
  const evaluated = await Promise.allSettled([evaluate(engine, a), evaluate(engine, b)]);
  for (const result of evaluated) if (result.status === 'rejected') throw result.reason;
  const [ea, eb] = evaluated.map(r => r.value);
  const ia = { workspace: a, jobId: randomUUID(), evaluationJobId: ea.jobId };
  const ib = { workspace: b, jobId: randomUUID(), evaluationJobId: eb.jobId };
  const results = await Promise.allSettled([engine.tailor(ia), engine.tailor(ib)]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const [ra, rb] = results.map(r => r.value);
  assert.equal(ra.pages, 1);
  assert.equal(rb.pages, 1);
  assert.notEqual(ra.pdfSha256, rb.pdfSha256);
  assert.equal(mock.requests.length, 4);
  for (const [root, result, ownName, otherName] of [[a, ra, 'Synthetic Alpha', 'Synthetic Beta'], [b, rb, 'Synthetic Beta', 'Synthetic Alpha']]) {
    const bytes = await fs.readFile(path.join(root, result.pdf));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const html = await fs.readFile(path.join(root, result.html), 'utf8');
    assert.ok(html.includes(ownName) && !html.includes(otherName));
    assert.ok((await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8')).includes('✅'));
    assert.ok((await fs.readFile(path.join(root, 'data', 'pdf-index.tsv'), 'utf8')).includes(result.pdf));
  }
  const prompts = mock.requests.filter(r => !r.stream).map(r => JSON.stringify(r.messages));
  assert.ok(prompts.some(p => p.includes('Synthetic Alpha') && !p.includes('Synthetic Beta')));
  assert.ok(prompts.some(p => p.includes('Synthetic Beta') && !p.includes('Synthetic Alpha')));
  assert.equal((await engine.tailor(ia)).replayed, true);
  assert.equal(mock.requests.length, 4);
  await fs.appendFile(path.join(a, ra.pdf), 'tampered');
  await assert.rejects(engine.tailor(ia), { code: 'artifact_changed' });
});

test('rejects invented metrics and invalid HTML without a ready PDF', async t => {
  for (const [name, html, code] of [
    ['fabricated team size', cvHtml().replace('4 engineers', '40 engineers'), 'cv_facts_failed'],
    ['incomplete HTML', '<html><body>unfinished', 'invalid_cv_html'],
    ['missing source section', cvHtml().replace('<h2 class="section-title">Experience</h2>', '<h2 class="section-title">Skills</h2>'), 'cv_render_failed'],
  ]) {
    await t.test(name, async st => {
      const root = await candidate(st);
      const mock = await modelServer(st, html);
      const engine = engineFor(mock.provider), evaluation = await evaluate(engine, root);
      const input = { workspace: root, jobId: randomUUID(), evaluationJobId: evaluation.jobId };
      await assert.rejects(engine.tailor(input), { code });
      await assert.rejects(fs.access(path.join(root, 'output', 'hosted', input.jobId, 'cv.pdf')));
      assert.ok(!(await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8')).includes('✅'));
      await assert.rejects(engine.tailor(input), { code: 'job_needs_recovery' });
    });
  }
});

test('locked experience cannot be rewritten even when the same metric is retained', async t => {
  const root = await candidate(t);
  await fs.writeFile(path.join(root, 'config', 'profile.yml'), 'name: Synthetic Alpha\ncv:\n  locked_sections: [experience]\n');
  const mock = await modelServer(t, cvHtml().replace('Led a team of 4 engineers.', 'Managed a team of 4 engineers.'));
  const engine = engineFor(mock.provider), evaluation = await evaluate(engine, root);
  const jobId = randomUUID();
  await assert.rejects(engine.tailor({ workspace: root, jobId, evaluationJobId: evaluation.jobId }), { code: 'tailoring_failed' });
  await assert.rejects(fs.access(path.join(root, 'output', 'hosted', jobId, 'cv.pdf')));
});

test('unscoped profile photos are rejected before model tailoring', async t => {
  const root = await candidate(t);
  await fs.writeFile(path.join(root, 'config', 'profile.yml'), 'name: Synthetic Alpha\ncandidate:\n  photo: /server/private.png\n');
  const mock = await modelServer(t);
  const engine = engineFor(mock.provider), evaluation = await evaluate(engine, root);
  await assert.rejects(engine.tailor({ workspace: root, jobId: randomUUID(), evaluationJobId: evaluation.jobId }), { code: 'profile_photo_not_supported' });
  assert.equal(mock.requests.length, 1);
});

test('strict page budget rejects overflow rather than marking it ready', async t => {
  const root = await candidate(t);
  const overflow = Array.from({ length: 4 }, () => '<div style="break-before:page">Built internal reporting tools with Python.</div>').join('');
  const mock = await modelServer(t, cvHtml('Synthetic Alpha', overflow));
  const engine = engineFor(mock.provider), evaluation = await evaluate(engine, root);
  const jobId = randomUUID();
  await assert.rejects(engine.tailor({ workspace: root, jobId, evaluationJobId: evaluation.jobId }), { code: 'cv_render_failed' });
  await assert.rejects(fs.access(path.join(root, 'output', 'hosted', jobId, 'cv.pdf')));
  assert.ok(!(await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8')).includes('✅'));
});

test('stale profiles and evaluation IDs from another workspace cannot trigger tailoring', async t => {
  const root = await candidate(t), other = await candidate(t, 'Synthetic Beta');
  const mock = await modelServer(t);
  const engine = engineFor(mock.provider), evaluation = await evaluate(engine, root);
  await assert.rejects(engine.tailor({ workspace: other, jobId: randomUUID(), evaluationJobId: evaluation.jobId }), { code: 'evaluation_not_found' });
  await fs.appendFile(path.join(root, 'cv.md'), '\nNew confirmed source fact.');
  await assert.rejects(engine.tailor({ workspace: root, jobId: randomUUID(), evaluationJobId: evaluation.jobId }), { code: 'evaluation_stale' });
  assert.equal(mock.requests.length, 1);
});

test('rendering disables scripts and blocks outbound image requests from generated HTML', async t => {
  const root = await candidate(t);
  let origin;
  const mock = await modelServer(t, () => cvHtml('Synthetic Alpha', `<script>fetch('${origin}/script-canary')</script><img src="${origin}/image-canary">`));
  origin = mock.origin;
  const engine = engineFor(mock.provider), evaluation = await evaluate(engine, root);
  const result = await engine.tailor({ workspace: root, jobId: randomUUID(), evaluationJobId: evaluation.jobId });
  assert.equal(result.pages, 1);
  assert.deepEqual(mock.unexpected, []);
});
