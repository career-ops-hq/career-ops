/** Trusted, report-numbered JD archive enforcement. Never calls a model.
 * Machine capture is injected in tests; production uses exact publisher/JSON-LD
 * evidence or the existing isolated browser archiver. No model-selected paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hasEmbeddedJdArchive, extractStrippedJdSection, detectNonContentMarker } from '../check-jd-archive.mjs';
import { withJdArchiveSection, JD_ARCHIVE_HEADING, JD_HEADING_RE, NEXT_REPORT_SECTION_RE } from './jd-archive-section.mjs';
import { findCaptureForReport } from '../jd-capture.mjs';
import { postingUrlRelation } from '../url-key.mjs';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { isBlockedAddress, blockedAddressError } from '../providers/_ip-guard.mjs';

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

// Fixed system-code adapter, never a path or function selected by a payload.
// Loading stays lazy so legacy installs/receipts need no unmerged enhancement.
const sourceRequire = createRequire(import.meta.url);
const sourceAdapterPath = fileURLToPath(new URL('../read-known-jd.mjs', import.meta.url));
function defaultSourceAdapterLoader() {
  try { fs.lstatSync(sourceAdapterPath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return sourceRequire(sourceAdapterPath);
}
function sourceAdapter(loader = defaultSourceAdapterLoader) {
  if (typeof loader !== 'function') throw new Error('archive source adapter loader is invalid');
  const adapter = loader();
  if (adapter?.then) throw new Error('archive source adapter must load synchronously');
  const names = ['validateArchiveSourcePacket', 'validateArchiveSourceBinding'];
  if (!adapter || names.some(name => typeof adapter[name] !== 'function')) return null;
  if (names.some(name => adapter[name].constructor?.name === 'AsyncFunction')) throw new Error('archive source validators must be synchronous');
  return adapter;
}
function requiredSourceAdapter(loader) {
  const adapter = sourceAdapter(loader);
  if (!adapter) throw new Error('native source archival adapter is unavailable');
  return adapter;
}
/** Read-only runtime handshake; does not reserve, capture, write or call a model. */
export function archiveSourceCapabilities({ sourceAdapterLoader } = {}) {
  return { version: 1, archiveSourcePacketVersions: sourceAdapter(sourceAdapterLoader) ? [2] : [] };
}
function checkedBinding(binding, originalURL, loader) {
  const result = requiredSourceAdapter(loader).validateArchiveSourceBinding(binding, originalURL);
  if (!result || result.ok !== true || typeof result.sourcePostingURL !== 'string' || !result.apiRequest) {
    throw new Error(result?.error || 'invalid native source binding');
  }
  return result;
}
function suppliedSource(payload, identity, loader) {
  if (!Object.hasOwn(payload, 'archiveSource')) return null;
  const result = requiredSourceAdapter(loader).validateArchiveSourcePacket(payload.archiveSource, identity.url);
  if (!result || result.ok !== true || typeof result.text !== 'string' || !result.binding) {
    throw new Error(result?.error || 'invalid native source packet');
  }
  const bound = checkedBinding(result.binding, identity.url, loader);
  const bytes = Buffer.from(result.text);
  if (result.sourcePostingURL !== bound.sourcePostingURL || bytes.length !== result.binding.utf8Bytes
      || hash(bytes) !== result.binding.textSha256 || bytes.length > MAX_CAPTURE_BYTES) throw new Error('native source text does not match its binding');
  return { ...result, apiRequest: bound.apiRequest };
}

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
  const owned = st => isEvaluationArtifactOwner({ uid: Number(st.uid) }, dataRootUid);
  const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
  const sameMetadata = (a, b) => ['mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
  const checkFile = st => {
    if (!st.isFile() || st.isSymbolicLink() || !owned(st) || st.nlink !== 1n || st.size <= 0n || st.size > BigInt(max)) throw new Error('archive is not a bounded own-user regular file');
  };
  const parent = path.dirname(file);
  const checkDirectory = () => {
    const st = fs.lstatSync(parent, { bigint: true });
    if (!st.isDirectory() || st.isSymbolicLink() || !owned(st) || fs.realpathSync(parent) !== parent) throw new Error('archive parent is not a canonical contained directory');
    return st;
  };
  const directory = checkDirectory();
  const checkParent = () => {
    const current = checkDirectory();
    // Sibling captures may legitimately change directory mtime/link count.
    if (!sameIdentity(directory, current) || directory.uid !== current.uid) throw new Error('archive parent changed while reading');
  };
  const before = fs.lstatSync(file, { bigint: true });
  checkFile(before);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    checkFile(opened);
    // The identity check also protects platforms without O_NOFOLLOW.
    if (!sameIdentity(before, opened) || !sameMetadata(before, opened)) throw new Error('archive changed before reading');
    checkParent();
    const bytes = Buffer.alloc(max + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = fs.readSync(fd, bytes, total, bytes.length - total, total);
      if (count === 0) break;
      total += count;
      if (total > max) throw new Error('archive exceeded its byte limit while reading');
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    checkFile(after); checkFile(current);
    if (total !== Number(opened.size) || !sameIdentity(opened, after) || !sameMetadata(opened, after)
        || !sameIdentity(after, current) || !sameMetadata(after, current)) throw new Error('archive changed while reading');
    checkParent();
    return bytes.subarray(0, total);
  } finally { fs.closeSync(fd); }
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

// A held native packet is authoritative source data, not a model-authored
// archive. Embed its entire body so code-only rollback needs no new receipt or
// adapter. URL/time/hash provenance stays inert and grants no evaluation gate.
function heldSourceSection(markdown, identity, source) {
  const heading = JD_HEADING_RE.exec(String(markdown));
  const prior = heading ? String(markdown).slice(heading.index + heading[0].length) : '';
  const posted = /^(?:[ \t]*\r?\n)*([ \t]*Posted:[^\r\n]*)/i.exec(prior)?.[1];
  const metadata = JSON.stringify({ originalURL: identity.url, sourcePostingURL: source.sourcePostingURL,
    requestURL: source.apiRequest.requestURL, settledURL: source.apiRequest.finalURL,
    retrievedAt: source.apiRequest.respondedAt, sourceTextSha256: source.binding.textSha256,
    sourceTextBytes: source.binding.utf8Bytes, sourceBindingSha256: hash(JSON.stringify(source.binding)),
    sourceBinding: source.binding, evidenceScope: 'source-archive-only', evaluationAllowed: false }, null, 2);
  const runs = (source.text + metadata).match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${posted ? posted + '\n\n' : ''}${fence}text\n${source.text}\n${fence}\n\nSource archive provenance:\n\n${fence}json\n${metadata}\n${fence}`;
}
function exactHeldSourceSection(markdown, identity, source) {
  const body = String(markdown), heading = JD_HEADING_RE.exec(body);
  if (!heading) return false;
  const expected = Buffer.from(`${JD_ARCHIVE_HEADING}\n\n${heldSourceSection(body, identity, source)}\n`);
  const tail = Buffer.from(body.slice(heading.index));
  if (tail.length < expected.length || !tail.subarray(0, expected.length).equals(expected)) return false;
  const after = tail.subarray(expected.length).toString('utf8').trimStart();
  // Only a real following report section may follow the complete canonical
  // archive. JD headings inside its fence are already part of the exact bytes.
  return !after || NEXT_REPORT_SECTION_RE.exec(after)?.index === 0;
}

/** Sync final writer guard. A pointer must resolve to this exact own-user source. */
export function validateEvaluationArchive(root, payload, { sourceAdapterLoader } = {}) {
  try {
    const identity = archiveIdentity(payload);
    const held = suppliedSource(payload, identity, sourceAdapterLoader);
    if (held) return exactHeldSourceSection(payload.markdown, identity, held)
      ? { ok: true, kind: 'embedded' } : failure('inline JD does not contain the complete bound native source');
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

/** Prepare an exact inline source or deterministic pointer before any report/TSV
 * write. No model data can inject capture bytes, paths, or a different tenant/root.
 */
export async function prepareEvaluationArchive(root, payload, { captureFn = capturePostingSource, sourceAdapterLoader } = {}) {
  let privateDir = null;
  try {
    const identity = archiveIdentity(payload);
    const held = suppliedSource(payload, identity, sourceAdapterLoader);
    if (held) {
      const body = String(payload.markdown), section = heldSourceSection(body, identity, held);
      const markdown = exactHeldSourceSection(body, identity, held) ? body
        : JD_HEADING_RE.test(body) ? withJdArchiveSection(body, section)
          : `${body}\n\n${withJdArchiveSection('', section)}`;
      const archive = validateEvaluationArchive(root, { ...payload, markdown }, { sourceAdapterLoader });
      return archive.ok ? { ok: true, markdown, archive } : archive;
    }
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
export async function capturePostingSource(identity, options = {}) {
  if (linkedInArchiveUrl(identity.url)) throw new Error(LINKEDIN_ARCHIVE_UNAVAILABLE);
  // An injected transport keeps its existing contract. Default HTML/API fetch
  // uses a paired Agent/fetch and validates the address it will dial. Browser
  // navigation retains its separate existing route guards.
  if (options.fetchFn !== undefined) return capturePostingSourceWithFetch(identity, options);
  const { Agent, fetch } = await (options.httpTransportLoader ?? (() => import('undici')))();
  const realLookup = options.lookupFn ?? dnsLookup;
  const lookup = (hostname, lookupOptions, callback) => {
    if (typeof lookupOptions === 'function') { callback = lookupOptions; lookupOptions = {}; }
    return realLookup(hostname, lookupOptions, (error, ...answer) => {
      if (error) return callback(error, ...answer);
      const records = Array.isArray(answer[0]) ? answer[0] : [{ address: answer[0], family: answer[1] }];
      const addresses = records.map(item => item?.address);
      const bad = records.findIndex(item => !item || typeof item.address !== 'string' || !isIP(item.address)
        || isIP(item.address) !== item.family || isBlockedAddress(item.address));
      if (!records.length || bad >= 0) return callback(blockedAddressError(hostname, addresses[bad] ?? '', addresses));
      return callback(null, ...answer);
    });
  };
  const agent = new Agent({ connect: { lookup } });
  try {
    return await capturePostingSourceWithFetch(identity, { ...options, fetchFn: (url, init) => {
      // Numeric hosts bypass lookup, so apply the same address policy before dialling.
      const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
      if (isIP(hostname) && isBlockedAddress(hostname)) throw blockedAddressError(hostname, hostname);
      return fetch(url, { ...init, dispatcher: agent });
    } });
  } finally { await agent.destroy().catch(() => {}); }
}

async function capturePostingSourceWithFetch({ url, num, slug, role, privateDir }, { fetchFn = globalThis.fetch, guardFn, browserCaptureFn } = {}) {
  if (linkedInArchiveUrl(url)) throw new Error(LINKEDIN_ARCHIVE_UNAVAILABLE);
  const { rejectPrivateOrInvalid, validateUrlSecurity } = await import('../liveness-browser.mjs');
  const guard = guardFn ?? (async target => { const rejected = rejectPrivateOrInvalid(target); if (rejected) throw new Error('restricted archive URL'); await validateUrlSecurity(target); });
  await guard(url);
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
    let verifiedText = null;
    const result = await archiveUrl(browser, url, { company: slug, role, report: num, directory: privateDir, log: () => {},
      requirePosting: ({ settledUrl, httpStatus, title, bodyText }) => {
        const exact = httpStatus === 200 && sameArchivePosting(url, settledUrl)
          && titleKey(title).includes(titleKey(role)) && plain(bodyText).length >= 500 && !detectNonContentMarker(bodyText);
        if (exact) verifiedText = bodyText;
        return exact;
      } });
    // Large rendered assets may exceed the PDF cap even when the complete
    // inspected document text fits. Reuse that exact snapshot, never truncate
    // it or navigate again. archiveUrl rechecks document identity after PDF.
    if (Number.isSafeInteger(result.size) && result.size > MAX_CAPTURE_BYTES) {
      if (result.httpStatus !== 200 || !sameArchivePosting(url, result.settledUrl)
          || typeof verifiedText !== 'string' || Buffer.byteLength(verifiedText) > MAX_CAPTURE_BYTES
          || plain(verifiedText).length < 500 || detectNonContentMarker(verifiedText)) throw new Error('oversized PDF has no complete bounded exact rendered text');
      return { text: verifiedText, sourceFormat: 'text/plain', sourceUrl: url, settledUrl: result.settledUrl,
        kind: 'exact-rendered-posting-text', complete: true, truncated: false, httpStatus: result.httpStatus };
    }
    return { file: path.join(privateDir, result.filename), sourceUrl: url, settledUrl: result.settledUrl,
      kind: 'exact-rendered-posting-pdf', complete: true, truncated: false, httpStatus: result.httpStatus };
  } finally { await browser.close(); }
}
