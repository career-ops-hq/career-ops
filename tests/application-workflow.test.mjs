// Proves application preparation cannot click submit controls or skip confirmation.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fillSafeFields, renderApplicationResume, verifyApplicationPdf } from '../application-workflow.mjs';
import { openOpportunityStore } from '../src/opportunities/store.mjs';

const calls = [];
const page = { locator(selector) { return { fill: async value => calls.push(['fill', selector, value]), selectOption: async value => calls.push(['select', selector, value]), setInputFiles: async value => calls.push(['file', selector, value]) }; } };
await fillSafeFields(page, [{ type: 'text', selector: '#name', value: 'Jane' }, { type: 'select', selector: '#country', value: 'CN' }, { type: 'file', selector: '#resume', value: 'cv.pdf' }]);
assert.deepEqual(calls, [['fill', '#name', 'Jane'], ['select', '#country', 'CN'], ['file', '#resume', 'cv.pdf']]);
await assert.rejects(fillSafeFields(page, [{ type: 'text', selector: 'button[type=submit]', value: 'no' }]), /Submission controls/);
const root = mkdtempSync(join(tmpdir(), 'career-ops-application-workflow-'));
try {
  const pdf = join(root, 'cv.pdf');
  writeFileSync(pdf, '%PDF-test');
  const commands = [];
  const result = verifyApplicationPdf(pdf, ['Jane'], { visualConfirmed: true, run: (command, args) => {
    commands.push([command, args]);
    if (command === 'pdftotext') return 'Jane Doe\nExperience';
    if (command === 'pdftoppm') {
      const png = Buffer.alloc(1024);
      Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
      png.writeUInt32BE(200, 16); png.writeUInt32BE(200, 20);
      writeFileSync(`${args.at(-1)}.png`, png);
    }
    return '';
  }});
  assert.equal(result.text.includes('Jane'), true);
  assert.deepEqual(commands.map(([command]) => command), ['pdftotext', 'pdfinfo', 'pdftoppm']);
} finally { rmSync(root, { recursive: true, force: true }); }

const applicationRoot = mkdtempSync(join(tmpdir(), 'career-ops-application-render-'));
try {
  const databasePath = join(applicationRoot, 'data', 'opportunities.db');
  const payloadPath = join(applicationRoot, 'payload.json');
  mkdirSync(join(applicationRoot, 'data'), { recursive: true });
  writeFileSync(payloadPath, JSON.stringify({ candidate: { name: 'Jane Doe' }, summary: '', experience: [], projects: [], education: [], certifications: [], awards: [], skills: [] }));
  const store = await openOpportunityStore(databasePath);
  const opportunity = store.ingest({ url: 'https://example.com/job', company: 'Acme', role: 'Engineer', source: 'test', payload: {} });
  store.claim(opportunity.id, 'test');
  store.recordEligibility(opportunity.id, { status: 'pass', evidence: {} });
  store.recordEvaluation(opportunity.id, { lower: 4, upper: 4, coverage: 1, reportHash: 'hash' });
  store.startApplication(opportunity.id);
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/api/openapi', '');
    if ((init.method || 'GET') === 'GET' && path === '/resumes') return Response.json([]);
    if (init.method === 'POST') return Response.json('copy');
    if ((init.method || 'GET') === 'GET' && path === '/resumes/copy') return Response.json({ name: 'copy', slug: 'copy', updatedAt: 'now' });
    if (init.method === 'PATCH') return Response.json({});
    if (path.endsWith('/pdf')) return new Response('%PDF-test');
    return new Response('unexpected', { status: 500 });
  };
  await renderApplicationResume({ store, id: opportunity.id, reportNum: 1, payloadPath, root: join(applicationRoot, 'output'), config: { base_resume_id: 'mother', api_base_url: 'http://127.0.0.1:3000/api/openapi', api_key: 'key' }, fetchImpl });
  assert.equal(store.opportunity(opportunity.id).applicationState, 'preparing');
  assert.equal(store.events(opportunity.id).filter(event => event.type === 'application_artifact_recorded').length, 2);
  store.close();
} finally { rmSync(applicationRoot, { recursive: true, force: true }); }
console.log('application workflow: safe fill, text, and visual PDF smoke checks passed');
