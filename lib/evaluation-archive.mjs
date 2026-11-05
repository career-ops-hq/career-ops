/** Trusted, report-numbered JD archive enforcement. Never calls a model.
 * Machine capture is injected in tests; production uses exact publisher/JSON-LD
 * evidence or the existing isolated browser archiver. No model-selected paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hasEmbeddedJdArchive, extractStrippedJdSection, detectNonContentMarker } from '../check-jd-archive.mjs';
import { withJdArchiveSection } from './jd-archive-section.mjs';
import { findCaptureForReport } from '../jd-capture.mjs';
import { postingUrlRelation } from '../url-key.mjs';

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const RECEIPT_MAX = 16 * 1024;
const POINTER = /^See jds\/([A-Za-z0-9][A-Za-z0-9_.-]*\.(?:md|pdf)) for the full archive \(archive-posting\.mjs --report=(\d+)\)\.$/;
const hash = x => createHash('sha256').update(x).digest('hex');
/** Root containers may write a host-owned bind mount. Scope that exception to
 * this selected data root's owner; ordinary users still accept only their UID.
 */
export function isEvaluationArtifactOwner(st, dataRootUid) {
  if (typeof process.getuid !== 'function') return true;
  const uid = process.getuid();
  return st.uid === uid || (uid === 0 && Number.isInteger(dataRootUid) && dataRootUid >= 0 && st.uid === dataRootUid);
}
const plain = x => String(x).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const titleKey = x => String(x).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const receiptName = name => `.${name}.receipt.json`;
const present = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const failure = error => ({ ok: false, error: `Job description archive incomplete: ${error}` });

const LINKEDIN_ARCHIVE_UNAVAILABLE = 'LinkedIn automatic archive loading is unavailable; reuse already loaded JD text or an existing verified capture.';
function linkedInArchiveUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/\.+$/, '');
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
  } catch { return false; }
}

export function sameArchivePosting(a, b) {
  if (postingUrlRelation(a, b) === 'same') return true;
  // iCIMS changes the role slug while retaining its tenant + requisition ID.
  try {
    const x = new URL(a), y = new URL(b);
    const id = u => u.hostname.endsWith('.icims.com') && /^\/jobs\/(\d+)\/[^/]+\/job\/?$/.exec(u.pathname)?.[1];
    return x.protocol === 'https:' && y.protocol === 'https:' && x.host === y.host
      && !x.search && !y.search && Boolean(id(x)) && id(x) === id(y);
  } catch { return false; }
}

function location(root, num, slug) {
  if (typeof root !== 'string' || !/^\d{3,}$/.test(num) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('invalid backend-owned archive identity');
  const resolved = fs.realpathSync(root);
  const st = fs.lstatSync(resolved);
  const dataRootUid = st.uid;
  if (!st.isDirectory() || !isEvaluationArtifactOwner(st, dataRootUid)) throw new Error('archive data root is not an own-user directory');
  const jds = path.join(resolved, 'jds');
  let info;
  try { info = fs.lstatSync(jds); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (info && (!info.isDirectory() || info.isSymbolicLink() || !isEvaluationArtifactOwner(info, dataRootUid))) throw new Error('jds/ is not a contained own-user directory');
  return { root: resolved, jds, dataRootUid };
}

function archiveIdentity(payload) {
  const { num, today, reportFile, url, role, company } = payload ?? {};
  if (typeof num !== 'string' || !/^\d{3,}$/.test(num) || !Number.isSafeInteger(Number(num)) || Number(num) <= 0 || typeof today !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(today)
      || typeof reportFile !== 'string' || path.basename(reportFile) !== reportFile || !reportFile.startsWith(`${num}-`) || !reportFile.endsWith(`-${today}.md`)) throw new Error('invalid report archive metadata');
  const slug = reportFile.slice(num.length + 1, -(`-${today}.md`.length));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('invalid report company slug');
  if (typeof role !== 'string' || !role.trim() || typeof company !== 'string' || !company.trim()) throw new Error('missing report identity');
  return { num, slug, url: typeof url === 'string' ? url : '', role, company };
}

function regular(file, max, dataRootUid) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || !isEvaluationArtifactOwner(st, dataRootUid) || st.nlink !== 1 || st.size <= 0 || st.size > max) throw new Error('archive is not a bounded own-user regular file');
  return fs.readFileSync(file);
}

function verifyCapture(jds, name, identity, dataRootUid) {
  if (path.basename(name) !== name || !name.startsWith(`${identity.num}-${identity.slug}-`) || !/\.(md|pdf)$/.test(name)) throw new Error('capture path does not match this report/company');
  const matched = findCaptureForReport(jds, identity.num, { companySlug: identity.slug });
  if (!matched || !matched.candidates.includes(name)) throw new Error('capture is not report-number bound');
  const data = regular(path.join(jds, name), MAX_CAPTURE_BYTES + 8192, dataRootUid);
  const receipt = JSON.parse(regular(path.join(jds, receiptName(name)), RECEIPT_MAX, dataRootUid));
  if (receipt.version !== 1 || receipt.report !== identity.num || receipt.companySlug !== identity.slug
      || receipt.complete !== true || receipt.truncated !== false || receipt.httpStatus !== 200
      || !sameArchivePosting(identity.url, receipt.sourceUrl) || !sameArchivePosting(identity.url, receipt.settledUrl)
      || receipt.bytes !== data.length || receipt.sha256 !== hash(data)) throw new Error('capture provenance/URL/checksum does not match the evaluated posting');
  if (receipt.format === 'application/pdf') {
    if (!name.endsWith('.pdf') || !data.subarray(0, 5).equals(Buffer.from('%PDF-')) || !data.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new Error('capture is not a complete PDF');
  } else if (receipt.format !== 'text/markdown' || !name.endsWith('.md')) throw new Error('unsupported archive format');
  return { filename: name, receipt };
}

/** Sync final writer guard. A pointer must resolve to this exact own-user source. */
export function validateEvaluationArchive(root, payload) {
  try {
    const identity = archiveIdentity(payload);
    if (hasEmbeddedJdArchive(payload.markdown)) return { ok: true, kind: 'embedded' };
    const section = extractStrippedJdSection(payload.markdown) ?? '';
    const pointer = POINTER.exec(section);
    if (!pointer || Number(pointer[2]) !== Number(identity.num)) return failure('no complete inline JD or verified report-numbered capture');
    const { jds, dataRootUid } = location(root, identity.num, identity.slug);
    const result = verifyCapture(jds, pointer[1], identity, dataRootUid);
    return { ok: true, kind: 'capture', ...result };
  } catch (error) { return failure(error.message); }
}

function fencedSource(text, identity, source) {
  const runs = String(text).match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(x => x.length + 1)));
  return `# Job description source archive\n\nSource URL: ${identity.url}\nReport: ${identity.num}\nCompany slug: ${identity.slug}\nSource format: ${source.sourceFormat ?? 'text/plain'}\n\n${fence}\n${text}\n${fence}\n`;
}

/** Prepare a deterministic pointer before any report/TSV write. No model data
 * can inject capture bytes, paths, a receipt, or a different tenant/root.
 */
export async function prepareEvaluationArchive(root, payload, { captureFn = capturePostingSource } = {}) {
  let privateDir = null;
  try {
    const identity = archiveIdentity(payload);
    const existing = validateEvaluationArchive(root, payload);
    if (existing.ok) return { ok: true, markdown: payload.markdown, archive: existing };
    if (!identity.url || !/^https?:\/\//i.test(identity.url) || /[\s\\]/.test(identity.url)) return failure('a public exact posting URL is needed for machine capture');
    const parsed = new URL(identity.url);
    if (parsed.username || parsed.password) return failure('posting URL contains credentials');
    const { rejectPrivateOrInvalid } = await import('../liveness-browser.mjs');
    if (rejectPrivateOrInvalid(identity.url)) return failure('restricted posting URL cannot be captured');
    const { jds, dataRootUid } = location(root, identity.num, identity.slug);
    const base = `${identity.num}-${identity.slug}-${hash(identity.url).slice(0, 16)}`;
    // A retry may adopt only an already complete, matching capture. Never
    // overwrite a collision, and never reserve or evaluate a second time here.
    for (const ext of ['md', 'pdf']) {
      const name = `${base}.${ext}`;
      if (present(path.join(jds, name)) || present(path.join(jds, receiptName(name)))) {
        verifyCapture(jds, name, identity, dataRootUid);
        const markdown = withJdArchiveSection(payload.markdown, `See jds/${name} for the full archive (archive-posting.mjs --report=${identity.num}).`);
        const checked = validateEvaluationArchive(root, { ...payload, markdown });
        if (!checked.ok) return checked;
        return { ok: true, markdown, archive: checked };
      }
    }
    if (linkedInArchiveUrl(identity.url)) return failure(LINKEDIN_ARCHIVE_UNAVAILABLE);
    fs.mkdirSync(jds, { recursive: true, mode: 0o700 });
    privateDir = fs.mkdtempSync(path.join(jds, `.evaluation-${identity.num}-`));
    fs.chmodSync(privateDir, 0o700);
    const source = await captureFn({ ...identity, root: fs.realpathSync(root), privateDir });
    if (!source || source.complete !== true || source.truncated !== false || source.httpStatus !== 200
        || !sameArchivePosting(identity.url, source.sourceUrl) || !sameArchivePosting(identity.url, source.settledUrl)) throw new Error('machine capture did not establish a full exact posting source');
    let bytes, format, ext;
    if (typeof source.text === 'string') {
      if (Buffer.byteLength(source.text) > MAX_CAPTURE_BYTES || plain(source.text).length < 200 || detectNonContentMarker(source.text)) throw new Error('machine JD text is incomplete, truncated or non-content');
      bytes = Buffer.from(fencedSource(source.text, identity, source)); format = 'text/markdown'; ext = 'md';
    } else if (typeof source.file === 'string' && path.dirname(source.file) === privateDir) {
      bytes = regular(source.file, MAX_CAPTURE_BYTES, dataRootUid); format = 'application/pdf'; ext = 'pdf';
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new Error('browser capture is not a complete PDF');
    } else throw new Error('machine capture supplied no bounded source artifact');
    const name = `${base}.${ext}`;
    const receipt = { version: 1, report: identity.num, companySlug: identity.slug, sourceUrl: identity.url,
      settledUrl: source.settledUrl, retrievedAt: new Date().toISOString(), httpStatus: 200, complete: true,
      truncated: false, format, bytes: bytes.length, sha256: hash(bytes), sourceKind: source.kind ?? 'machine',
      evidenceScope: 'source-archive-only', evaluationAllowed: false };
    const created = [];
    try {
      for (const [file, body] of [[name, bytes], [receiptName(name), Buffer.from(JSON.stringify(receipt, null, 2) + '\n')]]) {
        const target = path.join(jds, file); const fd = fs.openSync(target, 'wx', 0o600); created.push(target);
        try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
      const markdown = withJdArchiveSection(payload.markdown, `See jds/${name} for the full archive (archive-posting.mjs --report=${identity.num}).`);
      const checked = validateEvaluationArchive(root, { ...payload, markdown });
      if (!checked.ok) throw new Error(checked.error);
      return { ok: true, markdown, archive: checked };
    } catch (error) { for (const file of created.reverse()) fs.unlinkSync(file); throw error; }
  } catch (error) { return failure(error.message); }
  finally { if (privateDir) fs.rmSync(privateDir, { recursive: true, force: true }); }
}

export function extractExactJsonLd(html, url, _role) {
  const jobs = [];
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if ([node['@type']].flat().some(x => x === 'JobPosting')) jobs.push(node);
    if (node['@graph']) visit(node['@graph']);
  };
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* malformed blocks are not evidence */ }
  }
  const icimsId = (() => { try { const x = new URL(url); return x.hostname.endsWith('.icims.com') && /^\/jobs\/(\d+)\//.exec(x.pathname)?.[1]; } catch { return null; } })();
  const matching = jobs.filter(x => {
    const identifier = x.identifier && typeof x.identifier === 'object' ? x.identifier.value : x.identifier;
    if (icimsId && identifier != null && String(identifier) !== icimsId) return false;
    const strong = typeof x.url === 'string' ? sameArchivePosting(url, x.url) : Boolean(icimsId && String(identifier) === icimsId);
    return typeof x.title === 'string' && x.title.trim() && typeof x.description === 'string' && plain(x.description).length >= 200
      && strong;
  });
  if (matching.length !== 1) return null;
  return JSON.stringify(matching[0], null, 2);
}

function distinctPostingLocator(url) {
  const value = new URL(url);
  const segments = value.pathname.split('/').filter(Boolean);
  if (value.searchParams.has('gh_jid') && /^\d+$/.test(value.searchParams.get('gh_jid'))) return true;
  if (!segments.length) return false;
  return !/^(?:jobs?|careers?|positions?|openings?|search|about|team|company|vacancies)$/i.test(segments.at(-1));
}

async function boundedHtml(url, { fetchFn, guard }) {
  let target = url;
  for (let hops = 0; hops < 4; hops++) {
    await guard(target);
    const response = await fetchFn(target, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get('location'), target).href; await response.body?.cancel();
      if (!sameArchivePosting(url, next)) throw new Error('posting redirected to a different identity');
      target = next; continue;
    }
    if (response.status !== 200 || (response.url && !sameArchivePosting(url, response.url))) { await response.body?.cancel(); return null; }
    const parts = []; let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MAX_CAPTURE_BYTES) { throw new Error('source exceeds archive byte bound; no truncation accepted'); }
      parts.push(chunk);
    }
    return { html: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)), settledUrl: response.url || target };
  }
  throw new Error('posting redirect budget exhausted');
}

/** Production machine source, with injectable IO for offline tests. */
export async function capturePostingSource({ url, num, slug, role, privateDir }, { fetchFn = globalThis.fetch, guardFn, browserCaptureFn,
  himalayasAdapterLoader = () => import('../himalayas-posting.mjs') } = {}) {
  if (linkedInArchiveUrl(url)) throw new Error(LINKEDIN_ARCHIVE_UNAVAILABLE);
  const { rejectPrivateOrInvalid, validateUrlSecurity } = await import('../liveness-browser.mjs');
  const guard = guardFn ?? (async target => { const rejected = rejectPrivateOrInvalid(target); if (rejected) throw new Error('restricted archive URL'); await validateUrlSecurity(target); });
  await guard(url);
  // Optional enhancement supplied by the separate exact-publisher adapter.
  // Main without that helper still supports generic JSON-LD/PDF; a publisher
  // API source must never be fabricated when the optional adapter is absent.
  if (/^https:\/\/himalayas\.app\/companies\/[a-z0-9-]+\/jobs\/[a-z0-9-]+(?:[/?#]|$)/.test(url)) {
    let adapter;
    try { adapter = await himalayasAdapterLoader(); }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('himalayas-posting.mjs')) throw new Error('exact publisher archive adapter is unavailable');
      throw error;
    }
    if (typeof adapter.resolveHimalayasPosting !== 'function' || typeof adapter.retrieveHimalayasPosting !== 'function'
        || !adapter.resolveHimalayasPosting(url)) throw new Error('publisher URL is not supported by its exact archive adapter');
    const value = await adapter.retrieveHimalayasPosting(url, { fetchFn });
    if (value.publisherStatus !== 'open' || value.httpStatus !== 200 || typeof value.job?.description !== 'string') throw new Error('exact publisher API returned no complete open source');
    return { text: value.job.description, sourceFormat: 'text/html', sourceUrl: url, settledUrl: value.guid,
      kind: 'himalayas-publisher-api', complete: true, truncated: false, httpStatus: value.httpStatus };
  }
  const page = await boundedHtml(url, { fetchFn, guard });
  const jd = page && extractExactJsonLd(page.html, page.settledUrl, role);
  if (jd) return { text: jd, sourceFormat: 'application/ld+json', sourceUrl: url, settledUrl: page.settledUrl,
    kind: 'exact-jobposting-jsonld', complete: true, truncated: false, httpStatus: 200 };
  if (!distinctPostingLocator(url)) throw new Error('source has no direct individual-posting identity');
  if (browserCaptureFn) return browserCaptureFn({ url, num, slug, role, privateDir });
  const { chromium } = await import('playwright');
  const { archiveUrl } = await import('../archive-posting.mjs');
  const { browserLaunchOptions } = await import('./browser-launch.mjs');
  const browser = await chromium.launch(browserLaunchOptions({ headless: true }));
  try {
    const result = await archiveUrl(browser, url, { company: slug, role, report: num, directory: privateDir, log: () => {},
      requirePosting: ({ settledUrl, httpStatus, title, bodyText }) => httpStatus === 200 && sameArchivePosting(url, settledUrl)
        && titleKey(title).includes(titleKey(role)) && plain(bodyText).length >= 500 && !detectNonContentMarker(bodyText) });
    return { file: path.join(privateDir, result.filename), sourceUrl: url, settledUrl: result.settledUrl,
      kind: 'exact-rendered-posting-pdf', complete: true, truncated: false, httpStatus: result.httpStatus };
  } finally { await browser.close(); }
}
