import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareEvaluationArchive, validateEvaluationArchive, sameArchivePosting, extractExactJsonLd, capturePostingSource } from '../lib/evaluation-archive.mjs';
import { persistEvaluationArtifacts, writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';

const JD = 'The Product Manager owns the product roadmap, collects customer requirements, works with engineering and design, and measures reliable delivery. This role includes maintaining copyright notices and archive retention duties for customer documentation. '.repeat(6);
const stub = 'Full reproduction of the source job description is omitted due to copyright limits. This section is not a completed JD archive.';
const report = x => `# Evaluation: ExampleCo — Product Manager\n\n## Job Description (archived verbatim)\n${x}\n`;
const payload = (overrides = {}) => ({ markdown: report('See jds/061-exampleco-missing.md for the full archive (archive-posting.mjs --report=061).'), num: '061', today: '2026-11-04', company: 'ExampleCo', role: 'Product Manager', score: '2.9/5', notes: '', via: null, url: 'https://careers.example.org/jobs/2468', reportFile: '061-exampleco-2026-11-04.md', ...overrides });
const source = (id, overrides = {}) => ({ text: JD, sourceUrl: id.url, settledUrl: id.url, complete: true, truncated: false, httpStatus: 200, ...overrides });
const fixture = fn => async () => { const root = fs.mkdtempSync(path.join(tmpdir(), 'career-archive-')); try { await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } };

// A real JD's ordinary copyright/archive duties are not an omission disclosure.
test('complete inline source is accepted without any machine capture', fixture(async root => {
  let calls = 0; const p = payload({ markdown: report(JD) });
  const result = await persistEvaluationArtifacts(root, p, { captureFn: async () => { calls++; throw new Error('must not fetch'); } });
  assert.equal(result.ok, true, result.error); assert.equal(calls, 0);
  assert.equal(fs.readFileSync(path.join(root, 'reports', p.reportFile), 'utf8'), p.markdown);
  assert.equal(fs.existsSync(path.join(root, 'jds')), false);
}));

test('omission is replaced by a verified canonical pointer before report and TSV write', fixture(async root => {
  const p = payload({ markdown: report(stub) }); let calls = 0;
  const result = await persistEvaluationArtifacts(root, p, { captureFn: async id => { calls++; assert.match(path.basename(id.privateDir), /^\.evaluation-061-/); return source(id); } });
  assert.equal(result.ok, true, result.error); assert.equal(calls, 1);
  const md = fs.readFileSync(path.join(root, 'reports', p.reportFile), 'utf8');
  assert.doesNotMatch(md, /reproduction.*omitted/); assert.match(md, /See jds\/061-exampleco-.*\.md for the full archive/);
  assert.equal(validateEvaluationArchive(root, { ...p, markdown: md }).ok, true);
  assert.equal(fs.readdirSync(path.join(root, 'jds')).some(x => x.startsWith('.evaluation-')), false);
}));

test('failed capture writes no report or TSV and removes only its private scratch', fixture(async root => {
  const result = await persistEvaluationArtifacts(root, payload(), { captureFn: async id => { fs.writeFileSync(path.join(id.privateDir, 'partial.pdf'), 'partial'); throw new Error('capture offline'); } });
  assert.equal(result.ok, false); assert.match(result.error, /capture offline/);
  assert.equal(fs.existsSync(path.join(root, 'reports')), false); assert.equal(fs.existsSync(path.join(root, 'batch')), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'jds')), []);
}));

test('valid existing report-bound pointer is reused without recapture', fixture(async root => {
  const p = payload(); const first = await prepareEvaluationArchive(root, p, { captureFn: async id => source(id) });
  assert.equal(first.ok, true, first.error); let called = false;
  const second = await prepareEvaluationArchive(root, { ...p, markdown: first.markdown }, { captureFn: async () => { called = true; throw new Error('no'); } });
  assert.equal(second.ok, true, second.error); assert.equal(called, false);
}));

test('a completed capture from an interrupted save is adopted idempotently', fixture(async root => {
  const p = payload(); const first = await prepareEvaluationArchive(root, p, { captureFn: async id => source(id) });
  assert.equal(first.ok, true, first.error); const before = fs.readdirSync(path.join(root, 'jds'));
  const second = await prepareEvaluationArchive(root, p, { captureFn: async () => { throw new Error('must not recapture'); } });
  assert.equal(second.ok, true, second.error); assert.deepEqual(fs.readdirSync(path.join(root, 'jds')), before);
}));

for (const [name, edit] of [
  ['wrong source URL', { sourceUrl: 'https://careers.example.org/jobs/9999' }],
  ['generic redirected homepage', { settledUrl: 'https://careers.example.org/' }],
  ['non-200 source', { httpStatus: 403 }],
  ['truncated full-text claim', { truncated: true }],
  ['missing completeness evidence', { complete: false }],
]) test(`machine capture refuses ${name}`, fixture(async root => {
  const result = await persistEvaluationArtifacts(root, payload(), { captureFn: async id => source(id, edit) });
  assert.equal(result.ok, false); assert.equal(fs.existsSync(path.join(root, 'reports')), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'jds')), []);
}));

test('private URL is refused before capture callback or filesystem writes', fixture(async root => {
  let calls = 0; const result = await prepareEvaluationArchive(root, payload({ url: 'http://127.0.0.1/private' }), { captureFn: async id => { calls++; return source(id); } });
  assert.equal(result.ok, false); assert.equal(calls, 0); assert.equal(fs.existsSync(path.join(root, 'jds')), false);
}));

test('symlinked private capture directory cannot redirect writes', fixture(async root => {
  const other = fs.mkdtempSync(path.join(tmpdir(), 'career-unrelated-'));
  try { fs.symlinkSync(other, path.join(root, 'jds')); let calls = 0;
    const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => { calls++; return source(id); } });
    assert.equal(result.ok, false); assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(other), []);
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
}));

test('wrong URL receipt and existing collisions are refused without overwriting', fixture(async root => {
  const p = payload(); const first = await prepareEvaluationArchive(root, p, { captureFn: async id => source(id) });
  assert.equal(first.ok, true); const name = /See jds\/(\S+) for/.exec(first.markdown)[1]; const receiptPath = path.join(root, 'jds', '.' + name + '.receipt.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath)); receipt.sourceUrl = 'https://careers.example.org/jobs/9999'; fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const before = fs.readFileSync(receiptPath); const result = await prepareEvaluationArchive(root, p, { captureFn: async () => { throw new Error('must not capture over a collision'); } });
  assert.equal(result.ok, false); assert.deepEqual(fs.readFileSync(receiptPath), before); assert.equal(validateEvaluationArchive(root, { ...p, markdown: first.markdown }).ok, false);
}));

test('direct native writer cannot accept an omission or dangling pointer', fixture(async root => {
  assert.equal(writeEvaluationArtifacts(root, payload({ markdown: report(stub) })).ok, false);
  assert.equal(writeEvaluationArtifacts(root, payload({ markdown: report('See jds/061-exampleco-fake.md for the full archive (archive-posting.mjs --report=061).') })).ok, false);
  assert.equal(fs.existsSync(path.join(root, 'reports')), false);
}));

test('existing report collision preserves previous bytes and creates no TSV', fixture(async root => {
  fs.mkdirSync(path.join(root, 'reports')); fs.writeFileSync(path.join(root, 'reports', '061-exampleco-2026-11-04.md'), 'prior bytes');
  const result = writeEvaluationArtifacts(root, payload({ markdown: report(JD) }));
  assert.equal(result.ok, false); assert.equal(fs.readFileSync(path.join(root, 'reports', '061-exampleco-2026-11-04.md'), 'utf8'), 'prior bytes');
  assert.equal(fs.existsSync(path.join(root, 'batch', 'tracker-additions', '061-exampleco.tsv')), false);
}));

test('iCIMS canonical role slug changes preserve exact tenant/requisition identity only', () => {
  const original = 'https://careers-en-fixture.icims.com/jobs/2468/technical-product-manager/job';
  const canonical = 'https://careers-en-fixture.icims.com/jobs/2468/senior-technical-product-manager/job';
  assert.equal(sameArchivePosting(original, canonical), true);
  assert.equal(sameArchivePosting(original, canonical.replace('2468', '2469')), false);
  assert.equal(sameArchivePosting(original, 'https://careers-en-fixture.icims.com/'), false);
  const jsonld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Senior Technical Product Manager', identifier: { value: '2468' }, description: JD })}</script>`;
  assert.ok(extractExactJsonLd(jsonld, original, 'Technical Product Manager'));
  assert.equal(extractExactJsonLd(jsonld.replace('2468', '2469'), original, 'Technical Product Manager'), null);
});

test('exact JSON-LD retrieval archives the full source, not a 20K truncation', fixture(async root => {
  const url = payload().url; const full = JD.repeat(30); const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url, title: 'Product Manager', description: full })}</script>`;
  const result = await capturePostingSource({ url, num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, { guardFn: async () => {}, fetchFn: async () => new Response(html, { status: 200 }) });
  assert.equal(result.complete, true); assert.equal(result.truncated, false); assert.equal(JSON.parse(result.text).description, full); assert.ok(result.text.length > 20_000);
}));

test('missing optional Himalayas adapter fails explicitly without requesting a fake alternative source', fixture(async root => {
  let requests = 0;
  await assert.rejects(() => capturePostingSource({ url: 'https://himalayas.app/companies/exampleco/jobs/product-manager', num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, {
    guardFn: async () => {}, fetchFn: async () => { requests++; throw new Error('must not fetch'); },
    himalayasAdapterLoader: async () => { const e = new Error("Cannot find module himalayas-posting.mjs"); e.code = 'ERR_MODULE_NOT_FOUND'; throw e; },
  }), /exact publisher archive adapter is unavailable/);
  assert.equal(requests, 0);
}));

test('present exact publisher adapter supplies complete source without employer/evaluation permission', fixture(async root => {
  const url = 'https://himalayas.app/companies/exampleco/jobs/product-manager';
  const result = await capturePostingSource({ url, num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, {
    guardFn: async () => {}, himalayasAdapterLoader: async () => ({ resolveHimalayasPosting: u => u === url && { guid: url },
      retrieveHimalayasPosting: async () => ({ publisherStatus: 'open', httpStatus: 200, guid: url, employerVerified: false, evaluationAllowed: false, job: { description: JD } }) }),
    fetchFn: async () => { throw new Error('adapter fixture only'); },
  });
  assert.equal(result.text, JD); assert.equal(result.kind, 'himalayas-publisher-api');
  const p = payload({ url }); const saved = await prepareEvaluationArchive(root, p, { captureFn: async () => result });
  assert.equal(saved.ok, true, saved.error); assert.equal(saved.archive.receipt.evaluationAllowed, false);
  assert.equal(saved.archive.receipt.evidenceScope, 'source-archive-only');
}));

test('generic JSON-LD works when the optional adapter does not exist and never loads it', fixture(async root => {
  const url = payload().url; let imports = 0;
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url, title: 'Product Manager', description: JD })}</script>`;
  const result = await capturePostingSource({ url, num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, {
    guardFn: async () => {}, fetchFn: async () => new Response(html, { status: 200 }),
    himalayasAdapterLoader: async () => { imports++; throw new Error('absent'); },
  });
  assert.equal(result.complete, true); assert.equal(imports, 0);
}));

test('oversized raw source fails rather than marking truncated text complete', fixture(async root => {
  await assert.rejects(() => capturePostingSource({ url: payload().url, num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, {
    guardFn: async () => {}, fetchFn: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }),
  }), /byte bound; no truncation accepted/);
}));

test('JSON-LD source with a wrong requisition URL is not accepted by title alone', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url: 'https://careers.example.org/jobs/9999', title: 'Product Manager', description: JD })}</script>`;
  assert.equal(extractExactJsonLd(html, payload().url, 'Product Manager'), null);
});

test('raw captured HTML and embedded fences stay inert inside a longer code fence', fixture(async root => {
  const raw = `<script>alert('untrusted source data')</script>\n\`\`\`\n${JD}`;
  const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => source(id, { text: raw, sourceFormat: 'text/html' }) });
  assert.equal(result.ok, true, result.error);
  const name = /See jds\/(\S+) for/.exec(result.markdown)[1]; const saved = fs.readFileSync(path.join(root, 'jds', name), 'utf8');
  assert.match(saved, /\n````\n<script>/); assert.ok(saved.includes(raw)); assert.ok(saved.endsWith('\n````\n'));
}));

test('capture cannot supply a PDF from outside its private prefix', fixture(async root => {
  const outside = path.join(root, 'unrelated.pdf'); fs.writeFileSync(outside, '%PDF-1.7\nprior bytes\n%%EOF');
  const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => source(id, { text: undefined, file: outside }) });
  assert.equal(result.ok, false); assert.equal(fs.readFileSync(outside, 'utf8'), '%PDF-1.7\nprior bytes\n%%EOF');
  assert.deepEqual(fs.readdirSync(path.join(root, 'jds')), []);
}));

test('iCIMS contradictory JSON-LD requisition ID is refused despite matching URL/title', () => {
  const url = 'https://careers-en-fixture.icims.com/jobs/2468/technical-product-manager/job';
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', url, title: 'Technical Product Manager', identifier: { value: '2469' }, description: JD })}</script>`;
  assert.equal(extractExactJsonLd(html, url, 'Technical Product Manager'), null);
});

test('a full private PDF with typed source evidence is promoted and bound to this report', fixture(async root => {
  const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => {
    const file = path.join(id.privateDir, 'machine.pdf'); fs.writeFileSync(file, '%PDF-1.7\ncomplete rendered source fixture\n%%EOF');
    return source(id, { text: undefined, file, kind: 'exact-rendered-posting-pdf' });
  } });
  assert.equal(result.ok, true, result.error); assert.match(result.markdown, /jds\/061-exampleco-\w+\.pdf/);
  assert.equal(result.archive.receipt.format, 'application/pdf'); assert.equal(validateEvaluationArchive(root, { ...payload(), markdown: result.markdown }).ok, true);
}));


test('a same-title homepage JobPosting without URL/ID is not exact source evidence', fixture(async root => {
  const url = 'https://careers.example.org/';
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Product Manager', description: JD })}</script>`;
  assert.equal(extractExactJsonLd(html, url, 'Product Manager'), null);
  let browserCalls = 0;
  await assert.rejects(() => capturePostingSource({ url, num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, {
    guardFn: async () => {}, fetchFn: async () => new Response(html, { status: 200 }),
    browserCaptureFn: async () => { browserCalls++; throw new Error('must not attest a homepage'); },
  }), /no direct individual-posting identity/);
  assert.equal(browserCalls, 0);
}));

test('an unidentifiable jobs listing cannot mint an exact PDF receipt by title', fixture(async root => {
  let browserCalls = 0;
  await assert.rejects(() => capturePostingSource({ url: 'https://careers.example.org/jobs', num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, {
    guardFn: async () => {}, fetchFn: async () => new Response('<main>Product Manager opportunities and company navigation</main>', { status: 200 }),
    browserCaptureFn: async () => { browserCalls++; throw new Error('must not attest a listing'); },
  }), /no direct individual-posting identity/);
  assert.equal(browserCalls, 0);
}));

test('missing LinkedIn archive never starts another HTTP or browser loading attempt', fixture(async root => {
  const url = 'https://www.linkedin.com/jobs/view/900000000001';
  let http = 0, browser = 0, security = 0;
  const options = { guardFn: async () => { security++; }, fetchFn: async () => { http++; return new Response('', { status: 404 }); },
    browserCaptureFn: async () => { browser++; throw new Error('offline browser sentinel'); } };
  const result = await prepareEvaluationArchive(root, payload({ url }), { captureFn: id => capturePostingSource(id, options) });
  assert.equal(result.ok, false);
  assert.equal(http, 0, 'a prior LinkedIn load budget cannot be retried for archival');
  assert.equal(browser, 0);
  assert.match(result.error, /LinkedIn.*unavailable|LinkedIn.*already loaded/i);
  await assert.rejects(() => capturePostingSource({ url, num: '061', slug: 'exampleco', role: 'Product Manager', privateDir: root }, options), /LinkedIn.*unavailable|LinkedIn.*already loaded/i);
  assert.equal(http, 0); assert.equal(browser, 0); assert.equal(security, 0, 'no security/DNS lookup may precede the LinkedIn guard');
}));

test('complete inline LinkedIn text remains valid without any new source load', fixture(async root => {
  const p = payload({ url: 'https://www.linkedin.com/jobs/view/900000000001', markdown: report(JD) });
  let captures = 0;
  const result = await persistEvaluationArtifacts(root, p, { captureFn: async () => { captures++; throw new Error('must reuse text'); } });
  assert.equal(result.ok, true, result.error); assert.equal(captures, 0);
}));

test('an existing verified LinkedIn capture is reused without network or replacement', fixture(async root => {
  const { createHash } = await import('node:crypto'); const digest = value => createHash('sha256').update(value).digest('hex');
  const url = 'https://www.linkedin.com/jobs/view/900000000001'; const p = payload({ url });
  const name = `061-exampleco-${digest(url).slice(0, 16)}.md`; const dir = path.join(root, 'jds'); fs.mkdirSync(dir, { mode: 0o700 });
  const bytes = Buffer.from('# Previously captured full source\n\n' + JD);
  fs.writeFileSync(path.join(dir, name), bytes, { mode: 0o600 });
  const receipt = { version: 1, report: '061', companySlug: 'exampleco', sourceUrl: url, settledUrl: url,
    httpStatus: 200, complete: true, truncated: false, format: 'text/markdown', bytes: bytes.length, sha256: digest(bytes),
    sourceKind: 'previous-verified-source', evidenceScope: 'source-archive-only', evaluationAllowed: false };
  fs.writeFileSync(path.join(dir, '.' + name + '.receipt.json'), JSON.stringify(receipt), { mode: 0o600 });
  const files = fs.readdirSync(dir); let captures = 0;
  const result = await prepareEvaluationArchive(root, p, { captureFn: async () => { captures++; throw new Error('must reuse existing capture'); } });
  assert.equal(result.ok, true, result.error); assert.equal(captures, 0);
  assert.match(result.markdown, /See jds\/061-exampleco-/); assert.deepEqual(fs.readdirSync(dir), files);
}));
