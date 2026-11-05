import { createHash } from 'node:crypto';
import { hasEmbeddedJdArchive } from '../check-jd-archive.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isEvaluationArtifactOwner, prepareEvaluationArchive, validateEvaluationArchive, sameArchivePosting, extractExactJsonLd, capturePostingSource, archiveSourceCapabilities } from '../lib/evaluation-archive.mjs';
import { persistEvaluationArtifacts, writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';

const JD = 'The Product Manager owns the product roadmap, collects customer requirements, works with engineering and design, and measures reliable delivery. This role includes maintaining copyright notices and archive retention duties for customer documentation. '.repeat(6);
const stub = 'Full reproduction of the source job description is omitted due to copyright limits. This section is not a completed JD archive.';
const report = x => `# Evaluation: ExampleCo — Product Manager\n\n## Job Description (archived verbatim)\n${x}\n`;
const payload = (overrides = {}) => ({ markdown: report('See jds/061-exampleco-missing.md for the full archive (archive-posting.mjs --report=061).'), num: '061', today: '2026-11-04', company: 'ExampleCo', role: 'Product Manager', score: '2.9/5', notes: '', via: null, url: 'https://careers.example.org/jobs/2468', reportFile: '061-exampleco-2026-11-04.md', ...overrides });
const source = (id, overrides = {}) => ({ text: JD, sourceUrl: id.url, settledUrl: id.url, complete: true, truncated: false, httpStatus: 200, ...overrides });
const fixture = fn => async () => { const root = fs.mkdtempSync(path.join(tmpdir(), 'career-archive-')); try { await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } };

// Simulate Docker's process/bind-mount UIDs without Docker, chown or privilege.
// All content, containment, exclusive writes and receipts still use real files.
async function withOwners(root, uid, ownerFor, fn) {
  const getuid = process.getuid, lstat = fs.lstatSync, open = fs.openSync, fstat = fs.fstatSync, close = fs.closeSync;
  const aliases = [path.resolve(root), fs.realpathSync(root)];
  const files = new Map();
  const withOwner = (st, file) => {
    if (typeof file === 'string') {
      for (const base of aliases) {
        const rel = path.relative(base, path.resolve(file));
        if (rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))) {
          st.uid = ownerFor(rel.split(path.sep).join('/'));
          break;
        }
      }
    }
    return st;
  };
  process.getuid = () => uid;
  fs.lstatSync = (file, ...args) => withOwner(lstat(file, ...args), file);
  fs.openSync = (file, ...args) => { const fd = open(file, ...args); files.set(fd, file); return fd; };
  fs.fstatSync = (fd, ...args) => withOwner(fstat(fd, ...args), files.get(fd));
  fs.closeSync = fd => { try { return close(fd); } finally { files.delete(fd); } };
  try { return await fn(); }
  finally {
    fs.lstatSync = lstat; fs.openSync = open; fs.fstatSync = fstat; fs.closeSync = close;
    if (getuid === undefined) delete process.getuid; else process.getuid = getuid;
  }
}

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

test('root ownership exception is limited to the selected bind-mount owner', fixture(async root => {
  await withOwners(root, 0, () => 12001, async () => {
    assert.equal(isEvaluationArtifactOwner({ uid: 0 }, 12001), true);
    assert.equal(isEvaluationArtifactOwner({ uid: 12001 }, 12001), true);
    assert.equal(isEvaluationArtifactOwner({ uid: 12002 }, 12001), false);
    assert.equal(isEvaluationArtifactOwner({ uid: 12001 }, undefined), false);
  });
  await withOwners(root, 12001, () => 12001, async () => {
    assert.equal(isEvaluationArtifactOwner({ uid: 12001 }, 12001), true);
    assert.equal(isEvaluationArtifactOwner({ uid: 0 }, 12001), false);
    assert.equal(isEvaluationArtifactOwner({ uid: 12002 }, 12002), false);
  });
}));

test('container root saves complete inline source into a host-owned bind root', fixture(async root => {
  fs.mkdirSync(path.join(root, 'reports'));
  await withOwners(root, 0, () => 12001, async () => {
    const p = payload({ markdown: report(JD) });
    const result = writeEvaluationArtifacts(root, p);
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.readFileSync(path.join(root, 'reports', p.reportFile), 'utf8'), p.markdown);
    assert.equal(fs.existsSync(path.join(root, 'batch', 'tracker-additions', '061-exampleco.tsv')), true);
  });
}));

test('container root captures into its new root-owned directories beneath a host-owned bind root', fixture(async root => {
  await withOwners(root, 0, rel => rel === '' ? 12001 : 0, async () => {
    let captures = 0;
    const result = await persistEvaluationArtifacts(root, payload({ markdown: report(stub) }), { captureFn: async id => { captures++; return source(id); } });
    assert.equal(result.ok, true, result.error); assert.equal(captures, 1);
    const markdown = fs.readFileSync(path.join(root, 'reports', payload().reportFile), 'utf8');
    assert.equal(validateEvaluationArchive(root, { ...payload(), markdown }).ok, true);
  });
}));

test('container root reuses host-owned capture and receipt without recapture or replacement', fixture(async root => {
  let first;
  await withOwners(root, 12001, () => 12001, async () => {
    first = await prepareEvaluationArchive(root, payload(), { captureFn: async id => source(id) });
    assert.equal(first.ok, true, first.error);
  });
  const before = fs.readdirSync(path.join(root, 'jds')).map(name => [name, fs.readFileSync(path.join(root, 'jds', name))]);
  await withOwners(root, 0, () => 12001, async () => {
    const reused = await prepareEvaluationArchive(root, payload(), { captureFn: async () => { throw new Error('must reuse the verified host capture'); } });
    assert.equal(reused.ok, true, reused.error); assert.equal(reused.markdown, first.markdown);
    assert.equal(validateEvaluationArchive(root, { ...payload(), markdown: reused.markdown }).ok, true);
  });
  for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(root, 'jds', name)), bytes);
}));

test('non-root caller cannot save or capture into a foreign-owned data root', fixture(async root => {
  await withOwners(root, 12001, () => 12002, async () => {
    assert.equal(writeEvaluationArtifacts(root, payload({ markdown: report(JD) })).ok, false);
    let captures = 0;
    const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => { captures++; return source(id); } });
    assert.equal(result.ok, false); assert.equal(captures, 0);
    assert.deepEqual(fs.readdirSync(root), []);
  });
}));

for (const foreignUid of [0, 12002]) test(`non-root caller still refuses artifact directories owned by UID ${foreignUid}`, fixture(async root => {
  fs.mkdirSync(path.join(root, 'reports')); fs.mkdirSync(path.join(root, 'jds'));
  await withOwners(root, 12001, rel => rel === '' ? 12001 : foreignUid, async () => {
    assert.equal(writeEvaluationArtifacts(root, payload({ markdown: report(JD) })).ok, false);
    let captures = 0;
    const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => { captures++; return source(id); } });
    assert.equal(result.ok, false); assert.equal(captures, 0);
    assert.deepEqual(fs.readdirSync(path.join(root, 'reports')), []);
    assert.deepEqual(fs.readdirSync(path.join(root, 'jds')), []);
  });
}));

test('container root refuses directories owned by a third UID', fixture(async root => {
  fs.mkdirSync(path.join(root, 'reports')); fs.mkdirSync(path.join(root, 'jds'));
  await withOwners(root, 0, rel => rel === '' ? 12001 : 12002, async () => {
    assert.equal(writeEvaluationArtifacts(root, payload({ markdown: report(JD) })).ok, false);
    let captures = 0;
    const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => { captures++; return source(id); } });
    assert.equal(result.ok, false); assert.equal(captures, 0);
    assert.deepEqual(fs.readdirSync(path.join(root, 'jds')), []);
  });
}));

test('container root refuses third-UID capture bytes or receipts without overwriting', fixture(async root => {
  let first;
  await withOwners(root, 12001, () => 12001, async () => {
    first = await prepareEvaluationArchive(root, payload(), { captureFn: async id => source(id) });
    assert.equal(first.ok, true, first.error);
  });
  const name = first.archive.filename;
  for (const foreign of [`jds/${name}`, `jds/.${name}.receipt.json`]) {
    const before = fs.readFileSync(path.join(root, foreign));
    await withOwners(root, 0, rel => rel === foreign ? 12002 : 12001, async () => {
      assert.equal(validateEvaluationArchive(root, { ...payload(), markdown: first.markdown }).ok, false);
      let captures = 0;
      const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => { captures++; return source(id); } });
      assert.equal(result.ok, false); assert.equal(captures, 0);
    });
    assert.deepEqual(fs.readFileSync(path.join(root, foreign)), before);
  }
}));

test('container root ownership exception does not permit symlinked output directories', fixture(async root => {
  const other = fs.mkdtempSync(path.join(tmpdir(), 'career-container-unrelated-'));
  try {
    fs.symlinkSync(other, path.join(root, 'reports'), 'junction');
    fs.symlinkSync(other, path.join(root, 'jds'), 'junction');
    await withOwners(root, 0, () => 12001, async () => {
      assert.equal(writeEvaluationArtifacts(root, payload({ markdown: report(JD) })).ok, false);
      let captures = 0;
      const result = await prepareEvaluationArchive(root, payload(), { captureFn: async id => { captures++; return source(id); } });
      assert.equal(result.ok, false); assert.equal(captures, 0);
    });
    assert.deepEqual(fs.readdirSync(other), []);
  } finally { fs.rmSync(other, { recursive: true, force: true }); }
}));


const IO_CAPTURE_LIMIT = 2 * 1024 * 1024 + 8192;
const ioFixture = fn => fixture(async root => {
  const p = payload();
  const prepared = await prepareEvaluationArchive(root, p, { captureFn: async id => source(id) });
  assert.equal(prepared.ok, true, prepared.error);
  const file = path.join(fs.realpathSync(root), 'jds', prepared.archive.filename);
  await fn({ root, p: { ...p, markdown: prepared.markdown }, file, bytes: fs.readFileSync(file) });
});

// Real isolated files plus deterministic syscall-boundary changes. No chown,
// concurrent process, external service or real secret is needed for these races.
function withCaptureIo(file, hooks, fn) {
  const methods = ['lstatSync', 'openSync', 'fstatSync', 'readSync', 'readFileSync', 'closeSync'];
  const original = Object.fromEntries(methods.map(name => [name, fs[name]]));
  const files = new Map();
  const state = { opened: 0, closed: 0, bytesRead: 0, pathReads: 0, requests: [], fstats: new Set(), readBeforeFstat: false };
  const selected = value => typeof value === 'string' && path.resolve(value) === file;
  fs.lstatSync = (value, ...args) => {
    const st = original.lstatSync(value, ...args);
    return selected(value) ? hooks.afterStat?.(st, original, state) ?? st : st;
  };
  fs.openSync = (value, flags, ...args) => {
    const fd = original.openSync(value, selected(value) && hooks.flags ? hooks.flags(flags) : flags, ...args);
    if (typeof value === 'string' && path.dirname(path.resolve(value)) === path.dirname(file)) {
      files.set(fd, path.resolve(value)); state.opened++;
    }
    return fd;
  };
  fs.fstatSync = (fd, ...args) => {
    const st = original.fstatSync(fd, ...args);
    if (files.has(fd)) state.fstats.add(fd);
    return st;
  };
  fs.readSync = (fd, buffer, offset, length, position) => {
    if (files.get(fd) === file) {
      if (!state.fstats.has(fd)) state.readBeforeFstat = true;
      state.requests.push(length); hooks.beforeRead?.(original, state);
    }
    const count = original.readSync(fd, buffer, offset, length, position);
    if (files.get(fd) === file) { state.bytesRead += count; hooks.afterRead?.(original, state); }
    return count;
  };
  fs.readFileSync = (value, ...args) => {
    if (selected(value)) { state.pathReads++; hooks.beforePathRead?.(original, state); }
    const bytes = original.readFileSync(value, ...args);
    if (selected(value)) { state.bytesRead += Buffer.byteLength(bytes); hooks.afterPathRead?.(original, state); }
    return bytes;
  };
  fs.closeSync = fd => {
    try { return original.closeSync(fd); }
    finally { if (files.delete(fd)) state.closed++; }
  };
  try { return fn(state, original); }
  finally { for (const name of methods) fs[name] = original[name]; }
}

test('archive IO: same-byte inode replacement after lstat is rejected before reading', ioFixture(({ p, root, file, bytes }) => {
  let swapped = false;
  withCaptureIo(file, { afterStat(st) {
    if (!swapped) { swapped = true; fs.renameSync(file, file + '.previous'); fs.writeFileSync(file, bytes, { mode: 0o600 }); }
    return st;
  } }, state => {
    assert.equal(validateEvaluationArchive(root, p).ok, false);
    assert.equal(state.bytesRead, 0); assert.equal(swapped, true);
    assert.equal(state.opened, state.closed);
  });
}));

for (const portable of [false, true]) test(`archive IO: leaf symlink swap is rejected before reading (portable=${portable})`, ioFixture(({ p, root, file, bytes }) => {
  const other = path.join(fs.realpathSync(root), 'unrelated-source.md'); fs.writeFileSync(other, bytes);
  let swapped = false;
  withCaptureIo(file, { flags: flags => portable ? flags & ~(fs.constants.O_NOFOLLOW ?? 0) : flags, afterStat(st) {
    if (!swapped) { swapped = true; fs.renameSync(file, file + '.previous'); fs.symlinkSync(other, file, 'file'); }
    return st;
  } }, state => {
    assert.equal(validateEvaluationArchive(root, p).ok, false);
    assert.equal(state.bytesRead, 0); assert.equal(swapped, true);
    assert.equal(state.opened, state.closed);
  });
}));

test('archive IO: oversized in-place replacement after lstat is not read', ioFixture(({ p, root, file }) => {
  let changed = false;
  withCaptureIo(file, { afterStat(st) {
    if (!changed) { changed = true; fs.writeFileSync(file, Buffer.alloc(IO_CAPTURE_LIMIT + 64, 120)); }
    return st;
  } }, state => {
    assert.equal(validateEvaluationArchive(root, p).ok, false);
    assert.ok(state.bytesRead <= IO_CAPTURE_LIMIT + 1, 'the checked size cannot be bypassed by an unbounded pathname read');
    assert.equal(state.opened, state.closed);
  });
}));

test('archive IO: growth during reading stays bounded to max plus one byte', ioFixture(({ p, root, file }) => {
  let grown = false;
  const grow = () => { if (!grown) { grown = true; fs.appendFileSync(file, Buffer.alloc(IO_CAPTURE_LIMIT + 64, 120)); } };
  withCaptureIo(file, { beforePathRead: grow, afterRead: grow }, state => {
    assert.equal(validateEvaluationArchive(root, p).ok, false);
    assert.equal(grown, true); assert.ok(state.bytesRead <= IO_CAPTURE_LIMIT + 1);
    assert.ok(state.requests.every(length => length <= IO_CAPTURE_LIMIT + 1));
    assert.equal(state.opened, state.closed);
  });
}));

test('archive IO: parent replacement is rejected even when the capture inode survives', ioFixture(({ p, root, file }) => {
  const dir = path.dirname(file); let changed = false;
  withCaptureIo(file, { afterStat(st, original) {
    if (!changed) {
      changed = true; fs.renameSync(dir, dir + '-previous'); fs.mkdirSync(dir, { mode: 0o700 });
      for (const name of fs.readdirSync(dir + '-previous')) fs.renameSync(path.join(dir + '-previous', name), path.join(dir, name));
      return original.lstatSync(file);
    }
    return st;
  } }, state => {
    assert.equal(validateEvaluationArchive(root, p).ok, false);
    assert.equal(state.bytesRead, 0); assert.equal(changed, true);
    assert.equal(state.opened, state.closed);
  });
}));

test('archive IO: successful capture and receipt reads use closed validated descriptors', ioFixture(({ p, root, file }) => {
  withCaptureIo(file, {}, state => {
    assert.equal(validateEvaluationArchive(root, p).ok, true);
    assert.equal(state.pathReads, 0); assert.equal(state.readBeforeFstat, false); assert.equal(state.opened, 2); assert.equal(state.closed, 2);
    assert.ok(state.bytesRead > 0); assert.ok(state.bytesRead <= IO_CAPTURE_LIMIT);
  });
}));

test('archive IO: read error closes the descriptor before reporting failure', ioFixture(({ p, root, file }) => {
  const readError = () => { throw new Error('fictional descriptor read failure'); };
  withCaptureIo(file, { beforeRead: readError, beforePathRead: readError }, state => {
    const result = validateEvaluationArchive(root, p);
    assert.equal(result.ok, false); assert.match(result.error, /fictional descriptor read failure/);
    assert.equal(state.opened, 1); assert.equal(state.closed, 1);
  });
}));


test('archive IO: post-read same-size mutation cannot retain the old receipt validation', ioFixture(({ p, root, file, bytes }) => {
  let changed = false;
  const change = () => {
    if (!changed) {
      changed = true; fs.writeFileSync(file, Buffer.alloc(bytes.length, 120));
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    }
  };
  withCaptureIo(file, { afterRead: change, afterPathRead: change }, state => {
    assert.equal(validateEvaluationArchive(root, p).ok, false);
    assert.equal(changed, true); assert.ok(state.bytesRead <= IO_CAPTURE_LIMIT + 1);
    assert.equal(state.opened, state.closed);
  });
}));

// IO/composition fixtures use a privileged injected validator module. Provider
// identity policy stays in read-known-jd; it is never reimplemented here.
const sourceDigest = bytes => createHash('sha256').update(bytes).digest('hex');
function nativeSourceFixture({ text = JD } = {}) {
  const originalURL='https://www.arbeitnow.com/jobs/companies/exampleco/product-manager-123456';
  const sourcePostingURL='https://jobs.ashbyhq.com/exampleco/11111111-1111-4111-8111-111111111111';
  const apiRequest={requestURL:'https://api.ashbyhq.com/posting-api/job-board/exampleco',finalURL:'https://api.ashbyhq.com/posting-api/job-board/exampleco',
    method:'GET',httpStatus:200,requestedAt:'2026-01-01T00:00:00.000Z',respondedAt:'2026-01-01T00:00:01.000Z',redirected:false,accept:'application/json',userAgent:'fictional-client',location:null};
  const sourceBinding={version:1,kind:'fixture-provenance',originalURL,sourcePostingURL,textCap:20000,textSha256:sourceDigest(text),utf8Bytes:Buffer.byteLength(text),
    title:'Product Manager',atsIdentity:{ats:'fixture',parts:{id:'123456'}},apiRequestIndex:0,transport:{fetchCallCount:1,requests:[apiRequest]},
    sourceFacts:{type:'ashby-listing',isListedState:'absent'}};
  const archiveSource={version:2,fixturePacket:'backend-known-only'};
  let packetChecks=0,bindingChecks=0;
  const sourceAdapterLoader=()=>({
    validateArchiveSourcePacket(value,url){packetChecks++;return url===originalURL && JSON.stringify(value)===JSON.stringify(archiveSource)
      ? {ok:true,text,sourcePostingURL,binding:structuredClone(sourceBinding)} : {ok:false,error:'fixture packet rejected'};},
    validateArchiveSourceBinding(value,url){bindingChecks++;return url===originalURL && JSON.stringify(value)===JSON.stringify(sourceBinding)
      ? {ok:true,sourcePostingURL,apiRequest} : {ok:false,error:'fixture binding rejected'};},
  });
  return { originalURL,sourcePostingURL,apiRequest,sourceBinding,archiveSource,sourceAdapterLoader,counts:()=>({packetChecks,bindingChecks}),
    payload:payload({url:originalURL,markdown:report(stub),archiveSource}) };
}

test('private native source is saved FULL INLINE once with actual provenance and ZERO post-model capture',fixture(async root=>{
  const f=nativeSourceFixture();let captureCalls=0;
  const posted='Posted: 2026-01-01, retained original report metadata.';
  f.payload.markdown=report(posted+'\n\n'+stub);
  const saved=await persistEvaluationArtifacts(root,f.payload,{sourceAdapterLoader:f.sourceAdapterLoader,captureFn:async()=>{captureCalls++;throw Error('no second fetch');}});
  assert.equal(saved.ok,true,saved.error);assert.equal(captureCalls,0);
  const markdown=fs.readFileSync(path.join(root,'reports',f.payload.reportFile),'utf8');
  assert.equal(markdown.split(JD).length-1,1,'complete exact native body occurs once');
  assert.ok(markdown.includes('## Job Description (archived verbatim)\n\n'+posted),'literal existing Posted line is retained first');
  assert.ok(markdown.includes(f.originalURL));assert.ok(markdown.includes(f.sourcePostingURL));assert.ok(markdown.includes(f.apiRequest.finalURL));
  assert.ok(markdown.includes(f.sourceBinding.textSha256));assert.match(markdown,/source-archive-only/);assert.match(markdown,/"evaluationAllowed"\s*:\s*false/);
  const provenance=/^(`{3,})json\n([\s\S]*?)\n\1$/m.exec(markdown);assert.ok(provenance,'typed provenance remains an inert JSON block');
  assert.deepEqual(JSON.parse(provenance[2]).sourceBinding,f.sourceBinding,'whole observed chain/status facts persist, not only an opaque hash');
  assert.equal(fs.existsSync(path.join(root,'jds')),false,'no new receipt format or supplementary sidecar is required');
  assert.equal(validateEvaluationArchive(root,{...f.payload,markdown},{sourceAdapterLoader:f.sourceAdapterLoader}).ok,true);
  const legacyRead={...f.payload,markdown};delete legacyRead.archiveSource;
  assert.equal(validateEvaluationArchive(root,legacyRead).ok,true,'legacy no-packet receiver reads the complete inline report');
  assert.equal(hasEmbeddedJdArchive(markdown),true,'unchanged legacy archive parser accepts full inline data');
  assert.ok(fs.existsSync(path.join(root,'batch/tracker-additions/061-exampleco.tsv')));
}));

test('invalid explicit source cannot be laundered through valid inline text or a legacy pointer',fixture(async root=>{
  const f=nativeSourceFixture();let calls=0;
  const legacy={...f.payload};delete legacy.archiveSource;
  const before=await prepareEvaluationArchive(root,legacy,{captureFn:async id=>source(id)});
  assert.equal(before.ok,true,before.error);const snapshots=new Map(fs.readdirSync(path.join(root,'jds')).map(name=>[name,fs.readFileSync(path.join(root,'jds',name))]));
  for(const markdown of [report(JD),before.markdown]) {
    const result=await persistEvaluationArtifacts(root,{...f.payload,markdown,archiveSource:{version:2,fixturePacket:'forged'}},
      {sourceAdapterLoader:f.sourceAdapterLoader,captureFn:async()=>{calls++;throw Error('must not retry invalid packet');}});
    assert.equal(result.ok,false);assert.match(result.error,/fixture packet rejected/);
    assert.equal(fs.existsSync(path.join(root,'reports')),false);assert.equal(fs.existsSync(path.join(root,'batch')),false);
  }
  assert.equal(calls,0);for(const[name,bytes]of snapshots)assert.deepEqual(fs.readFileSync(path.join(root,'jds',name)),bytes);
}));

test('absent/outdated/async source adapters fail only when a supplied packet requires them',fixture(async root=>{
  for(const sourceAdapterLoader of [()=>null,()=>({}),()=>Promise.resolve({})]) {
    let calls=0;const p=payload({markdown:report(JD)});
    const legacy=await prepareEvaluationArchive(root,p,{sourceAdapterLoader:()=>{calls++;throw Error('legacy must not load adapter');}});
    assert.equal(legacy.ok,true,legacy.error);assert.equal(calls,0);
    const result=await persistEvaluationArtifacts(root,{...p,archiveSource:{version:2}},
      {sourceAdapterLoader,captureFn:async()=>{calls++;throw Error('no implicit HTTP fallback');}});
    assert.equal(result.ok,false);assert.match(result.error,/adapter|synchronous/);assert.equal(calls,0);
    assert.equal(fs.existsSync(path.join(root,'reports')),false);assert.equal(fs.existsSync(path.join(root,'jds')),false);
  }
}));

test('held native source replaces a plausible partial model archive and is checked exactly by sync writer',fixture(async root=>{
  const f=nativeSourceFixture(),prefix=`# Evaluation: ExampleCo — Product Manager\n\n**URL:** ${f.originalURL}\n**Score:** 2.9/5\n\nAnalysis remains byte-exact.\n\n`;
  const partial=JD.slice(0,260),p={...f.payload,markdown:prefix+'## Job Description (archived verbatim)\n\n'+partial+'\n'};
  assert.equal(hasEmbeddedJdArchive(p.markdown),true,'old length heuristic alone would credit this partial');
  const direct=writeEvaluationArtifacts(root,p,fs,{sourceAdapterLoader:f.sourceAdapterLoader});
  assert.equal(direct.ok,false,'unprepared partial cannot bypass complete source enforcement');assert.deepEqual(fs.readdirSync(root),[]);
  const options={sourceAdapterLoader:f.sourceAdapterLoader,captureFn:async()=>{throw Error('no re-fetch');}};
  const first=await prepareEvaluationArchive(root,p,options);assert.equal(first.ok,true,first.error);
  assert.equal(first.markdown.startsWith(prefix),true);assert.equal(first.markdown.split(JD).length-1,1);
  assert.equal(/^Posted:/m.test(first.markdown),false,'absent Posted date is never fabricated from retrieval time');
  const again=await prepareEvaluationArchive(root,{...p,markdown:first.markdown},options);
  assert.equal(again.ok,true,again.error);assert.equal(again.markdown,first.markdown,'rendering is deterministic');
  const tampered=first.markdown.replace(JD,'changed '+JD.slice(8));
  assert.equal(validateEvaluationArchive(root,{...p,markdown:tampered},{sourceAdapterLoader:f.sourceAdapterLoader}).ok,false,'substantive tampered inline text is not the held source');
  const noHeading=prefix+'Trailing analysis whitespace stays exact.  \n\n  \n';
  const appended=await prepareEvaluationArchive(root,{...f.payload,markdown:noHeading},options);
  assert.equal(appended.ok,true,appended.error);assert.equal(appended.markdown.startsWith(noHeading),true,'absent-heading append preserves every original prefix byte');
  assert.equal(appended.markdown.split(JD).length-1,1);assert.equal(hasEmbeddedJdArchive(appended.markdown),true);
  const saved=writeEvaluationArtifacts(root,{...p,markdown:first.markdown},fs,{sourceAdapterLoader:f.sourceAdapterLoader});
  assert.equal(saved.ok,true,saved.error);assert.equal(fs.readFileSync(path.join(root,'reports',p.reportFile),'utf8'),first.markdown);
  assert.equal(fs.existsSync(path.join(root,'jds')),false);
}));

test('source adapter contract refuses text/hash mismatches before artifacts and never weakens collisions',fixture(async root=>{
  const f=nativeSourceFixture();const base=f.sourceAdapterLoader();
  const mismatch=()=>({...base,validateArchiveSourcePacket:(packet,url)=>({...base.validateArchiveSourcePacket(packet,url),text:JD+'changed'})});
  const result=await persistEvaluationArtifacts(root,f.payload,{sourceAdapterLoader:mismatch,captureFn:async()=>{throw Error('no fallback');}});
  assert.equal(result.ok,false);assert.match(result.error,/text.*binding/);assert.deepEqual(fs.readdirSync(root),[]);
  fs.mkdirSync(path.join(root,'reports'));fs.writeFileSync(path.join(root,'reports',f.payload.reportFile),'existing own report');
  const collision=await persistEvaluationArtifacts(root,f.payload,{sourceAdapterLoader:f.sourceAdapterLoader,captureFn:async()=>{throw Error('no fallback');}});
  assert.equal(collision.ok,false);assert.equal(fs.readFileSync(path.join(root,'reports',f.payload.reportFile),'utf8'),'existing own report');
  const additions=path.join(root,'batch','tracker-additions');
  assert.equal(fs.existsSync(path.join(additions,'061-exampleco.tsv')),false);
  assert.deepEqual(fs.readdirSync(additions),[],'no contribution is written after the report collision');
  assert.equal(fs.existsSync(path.join(root,'jds')),false);
}));

test('fixed real reader composition is validated when installed; standalone absence is explicit without skips',fixture(async root=>{
  const reader=new URL('../read-known-jd.mjs',import.meta.url);
  const capabilities=archiveSourceCapabilities();
  if(!fs.existsSync(reader)) {
    assert.deepEqual(capabilities,{version:1,archiveSourcePacketVersions:[]});
    const result=await prepareEvaluationArchive(root,{...payload({markdown:report(JD)}),archiveSource:{version:2}});
    assert.equal(result.ok,false);assert.match(result.error,/adapter.*unavailable/);assert.deepEqual(fs.readdirSync(root),[]);
    return;
  }
  assert.deepEqual(capabilities,{version:1,archiveSourcePacketVersions:[2]});
  const originalURL='https://jobs.ashbyhq.com/exampleco/11111111-1111-4111-8111-111111111111',api='https://api.ashbyhq.com/posting-api/job-board/exampleco';
  const archiveSource={version:2,originalURL,sourcePostingURL:originalURL,textCap:20000,result:{url:originalURL,ats:'ashby',title:'Product Manager',text:JD,
    sourceFacts:{type:'ashby-listing',isListedState:'absent'}},chain:{kind:'direct-known-ats',apiRequestIndex:0},transport:{fetchCallCount:1,requests:[{
      requestURL:api,finalURL:api,method:'GET',httpStatus:200,redirected:false,requestedAt:'2026-01-01T00:00:00.000Z',respondedAt:'2026-01-01T00:00:01.000Z',accept:'application/json',userAgent:'fictional-client',location:null}]}};
  let calls=0;const p=payload({url:originalURL,markdown:report(stub),archiveSource});
  const saved=await persistEvaluationArtifacts(root,p,{captureFn:async()=>{calls++;throw Error('real composition must not recapture');}});
  assert.equal(saved.ok,true,saved.error);assert.equal(calls,0);
  const markdown=fs.readFileSync(path.join(root,'reports',p.reportFile),'utf8');
  assert.equal(markdown.split(JD).length-1,1);assert.equal(hasEmbeddedJdArchive(markdown),true);
  assert.equal(validateEvaluationArchive(root,{...p,markdown}).ok,true);assert.equal(fs.existsSync(path.join(root,'jds')),false);
}));
