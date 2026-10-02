/**
 * Verify the managed-copy seam without touching the user's local service.
 */

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildResumePatch, renderReactiveResume } from '../../adapters/node/resume.mjs';

const root = await mkdtemp(join(tmpdir(), 'career-ops-reactive-resume-'));
try {
  const metadataPath = join(root, 'output', '007-acme-role', 'cv', 'reactive-resume.json');
  const outputPath = join(root, 'output', '007-acme-role', 'cv', 'tailored', 'v001', 'cv.pdf');
  const payload = {
    page_format: 'a4',
    candidate: {
      name: 'Jane Doe', email: 'jane@example.com', phone: '+1 555', location: 'Berlin',
      linkedin: { url: 'https://linkedin.com/in/jane', display: 'linkedin.com/in/jane' },
      portfolio: { url: 'https://jane.example', display: 'jane.example' },
    },
    sections: { competencies: 'Core Competencies', experience: 'Work Experience' },
    summary: 'Builds reliable AI systems.',
    competencies: ['LLMOps', 'RAG'],
    experience: [{ company: 'Acme', role: 'Engineer', dates: '2024 - Present', bullets: ['Shipped <safe> systems', '10000次访问'] }],
    projects: [], education: [], certifications: [], awards: [],
    skills: [{ category: 'Languages', items: 'Python, TypeScript' }],
  };
  let updatedAt = '2026-08-25T00:00:00.000Z';
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/api/openapi', '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body && JSON.parse(init.body) });
    if (method === 'GET' && path === '/resumes') return Response.json([]);
    if (method === 'POST' && path.endsWith('/duplicate')) return Response.json('resume-workflow');
    if (method === 'GET' && path.startsWith('/resumes/resume-') && !path.endsWith('/pdf')) {
      return Response.json({ id: 'resume-workflow',
        name: 'Career Ops workflow — Acme — Role',
        slug: 'career-ops-workflow-123e4567-e89b-12d3-a456-426614174000', updatedAt });
    }
    if (method === 'PATCH' && path.startsWith('/resumes/resume-')) {
      updatedAt = '2026-08-25T00:01:00.000Z';
      return Response.json({ id: 'resume-workflow', updatedAt });
    }
    if (method === 'GET' && path.startsWith('/resumes/resume-') && path.endsWith('/pdf')) {
      return new Response(Buffer.from('%PDF-test'), { headers: { 'content-type': 'application/pdf' } });
    }
    return new Response('unexpected request', { status: 500 });
  };
  const options = {
    payload, outputPath, metadataPath, taskId: '123e4567-e89b-12d3-a456-426614174000', company: 'Acme', role: 'Role', version: 1,
    baseResumeId: 'base-id', apiBaseUrl: 'http://127.0.0.1:3000/api/openapi', apiKey: 'test-key', fetchImpl,
  };
  await renderReactiveResume(options);
  await renderReactiveResume(options);

  assert.equal(calls.filter((call) => call.method === 'POST').length, 1, 'the base resume is duplicated only once');
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 2, 'reruns patch the stable managed copy');
  assert.equal(JSON.parse(await readFile(metadataPath, 'utf8')).resume_id, 'resume-workflow');
  assert.equal((await readFile(outputPath)).toString(), '%PDF-test');
  const operations = buildResumePatch(payload);
  assert.equal(operations.find((op) => op.path === '/sections/skills/items').value[0].name, 'Core Competencies');
  assert.match(operations.find((op) => op.path === '/sections/experience/items').value[0].description, /&lt;safe&gt;/);
  assert.match(operations.find((op) => op.path === '/sections/experience/items').value[0].description, /10000\u00a0次访问/);
  assert.equal(operations.some((op) => op.path.startsWith('/picture')), false, 'the base portrait is preserved');
  assert.equal(operations.find((op) => op.path === '/basics/headline').value, '', 'unverified base content is cleared');
  assert.deepEqual(operations.find((op) => op.path === '/customSections').value, [], 'base custom content is cleared');
  assert.deepEqual(operations.find((op) => op.path === '/sections/languages/items').value, [], 'unmapped base sections are cleared');
  const workflowOptions = options;
  const taskPatch = calls.find((call) => call.method === 'PATCH' && call.path === '/resumes/resume-workflow');
  assert.equal(taskPatch.body.operations.find((op) => op.path === '/sections/projects/startOnNewPage').value, false);
  assert.equal(taskPatch.body.operations.find((op) => op.path === '/sections/profiles/columns').value, 2);
  assert.deepEqual(Object.fromEntries(taskPatch.body.operations
    .filter((op) => op.path.startsWith('/metadata/typography/') || op.path.startsWith('/metadata/page/'))
    .map((op) => [op.path, op.value])), {
    '/metadata/page/format': 'a4',
    '/metadata/typography/body/lineHeight': 1.3,
    '/metadata/typography/heading/lineHeight': 1.3,
    '/metadata/page/gapY': 4,
    '/metadata/page/marginY': 12,
  });
  assert.equal(JSON.parse(await readFile(workflowOptions.metadataPath, 'utf8')).slug,
    'career-ops-workflow-123e4567-e89b-12d3-a456-426614174000');
  const nextMetadata = join(root, 'workflow', 'v002', 'reactive-resume.json');
  await mkdir(dirname(nextMetadata), { recursive: true });
  await copyFile(workflowOptions.metadataPath, nextMetadata);
  await renderReactiveResume({ ...workflowOptions, payload: { ...payload, projects_start_on_new_page: true }, metadataPath: nextMetadata, version: 2 });
  const lastTaskPatch = calls.filter((call) => call.method === 'PATCH' && call.path === '/resumes/resume-workflow').at(-1);
  assert.equal(lastTaskPatch.body.operations.find((op) => op.path === '/sections/projects/startOnNewPage').value, true);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1, 'a new package version reuses the task copy');
  await assert.rejects(
    renderReactiveResume({ ...options, payload: { summary: '' }, fetchImpl: () => { throw new Error('must not call API'); } }),
    /candidate\.name is required/,
  );
  await assert.rejects(
    renderReactiveResume({ ...options, payload: { ...payload, projects_start_on_new_page: 'true' }, fetchImpl: () => { throw new Error('must not call API'); } }),
    /projects_start_on_new_page must be a boolean/,
  );
  console.log('  ✅ Reactive Resume duplicates once, patches deterministically, preserves visuals, and downloads PDF');
} finally {
  await rm(root, { recursive: true, force: true });
}
