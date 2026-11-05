#!/usr/bin/env node
/** Read one known ATS JD in an isolated process, retaining transport facts.
 * The existing dispatcher owns ATS mapping, headers and body consumption.
 * This module is import-safe; only CLI main scopes a child-local fetch wrapper.
 */
import { createHash } from 'node:crypto';
import { resolveAtsApi, JD_TEXT_API_ATS } from './liveness-api.mjs';
import { rejectPrivateOrInvalid } from './liveness-browser.mjs';
import { decodeEntities } from './providers/_html-entities.mjs';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';
import { fetchJdViaKnownApi } from './browser-extract.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

export const KNOWN_JD_TEXT_CAP = 20_000;
export const KNOWN_JD_REQUEST_LIMIT = 16_384;
const MAX_FETCH_CALLS = 8;

export function knownJdInput(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 8192 || /[\s\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return { originalURL: value, linkedIn: /(^|\.)linkedin\.com$/i.test(url.hostname.replace(/\.+$/, '')) };
  } catch { return null; }
}

/** Observe metadata only. Never clone, consume, replace or modify a Response. */
export function recordedGetFetch(fetchFn, records, now = () => new Date().toISOString()) {
  return async (input, options) => {
    const method = String(options?.method ?? (typeof input === 'object' ? input.method : undefined) ?? 'GET').toUpperCase();
    if (method !== 'GET' || records.length >= MAX_FETCH_CALLS) throw new Error('unsupported source request');
    const requestURL = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(options?.headers ?? (typeof input === 'object' ? input.headers : undefined));
    const record = { requestURL, method, requestedAt: now(), accept: headers.get('accept'), userAgent: headers.get('user-agent'), httpStatus: null, finalURL: null, redirected: null, respondedAt: null };
    records.push(record);
    try {
      const response = await fetchFn(input, options);
      record.httpStatus = response.status;
      record.finalURL = response.url || null;
      record.redirected = response.redirected;
      const location = response.headers?.get?.('location');
      record.location = typeof location === 'string' && location.length <= 8192 && !/[\r\n\u0000]/.test(location) ? location : null;
      record.respondedAt = now();
      return response;
    } catch (error) {
      record.error = 'fetch_failed';
      throw error;
    }
  };
}

// A source packet is transport/data evidence only. These pure validators do not
// classify the role as open, eligible or independently verified.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const failure = error => ({ ok: false, error });
const textHash = value => createHash('sha256').update(value).digest('hex');
const validTime = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const fieldsOnly = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
function safeURL(value) {
  const selected = knownJdInput(value);
  return selected && !selected.linkedIn && !rejectPrivateOrInvalid(value) ? new URL(value) : null;
}
function publisherURL(value) {
  const url = safeURL(value);
  return url && url.protocol === 'https:' && ['www.arbeitnow.com', 'arbeitnow.com'].includes(url.hostname)
    && !url.port && /^\/jobs\/companies\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+-\d+\/?$/.test(url.pathname) ? url : null;
}
function applyHref(originalURL, href) {
  const original = publisherURL(originalURL);
  if (!original || typeof href !== 'string' || href.length > 8192 || /[\s\\\u0000-\u001f\u007f-\u009f]/u.test(href)) return null;
  try {
    const resolved = new URL(decodeEntities(href), original);
    return safeURL(resolved.href) && resolved.origin === original.origin
      && resolved.pathname === `${original.pathname.replace(/\/$/, '')}/apply`
      && !resolved.search && !resolved.hash ? resolved.href : null;
  } catch { return null; }
}
function observedApplyHref(html, originalURL) {
  // Read actual quoted href attributes, not data-href, quoted attribute text,
  // comments or raw-text examples. Ambiguous/malformed anchors are ignored.
  const visible = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|textarea|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const candidates = [];
  for (const anchor of visible.matchAll(/<a(?=\s|>)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const attributes = anchor[0].slice(2, -1), hrefs = [];
    const token = /\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gy;
    let cursor = 0, malformed = false;
    while (cursor < attributes.length && attributes.slice(cursor).trim() !== '/') {
      if (!attributes.slice(cursor).trim()) break;
      token.lastIndex = cursor;
      const match = token.exec(attributes);
      if (!match) { malformed = true; break; }
      cursor = token.lastIndex;
      if (match[1].toLowerCase() === 'href') hrefs.push(match[2] ?? match[3] ?? null);
    }
    if (!malformed && hrefs.length === 1 && applyHref(originalURL, hrefs[0])) candidates.push(decodeEntities(hrefs[0]));
  }
  // Distinct literal spellings of the same observed route are not a second
  // posting; retain one actual href rather than synthesising it.
  const resolved = [...new Set(candidates.map(href => applyHref(originalURL, href)))];
  return resolved.length === 1 ? candidates[0] : null;
}
function apiMatches(value, expected) {
  const url = safeURL(value), api = safeURL(expected);
  return url && api && url.origin === api.origin && url.pathname === api.pathname
    && [...api.searchParams].every(([key, item]) => url.searchParams.get(key) === item);
}
function sourceIdentity(value) {
  if (!safeURL(value)) return null;
  const resolved = resolveAtsApi(value);
  // Embed/short links need extra requests and have no board+posting identity in
  // this URL. Keep their existing prompt evidence, but do not invent a binding.
  if (!resolved || !JD_TEXT_API_ATS.has(resolved.ats) || ['greenhouse-embedded', 'workable-short'].includes(resolved.ats)
      || resolved.method !== 'GET' || !safeURL(resolved.apiUrl)) return null;
  return { resolved, identity: { ats: resolved.ats, parts: { ...resolved.parts } } };
}
function transportRecords(value) {
  if (!fieldsOnly(value, ['fetchCallCount', 'requests']) || !Array.isArray(value.requests)
      || value.requests.length > MAX_FETCH_CALLS || value.fetchCallCount !== value.requests.length) return null;
  const records = [];
  for (const item of value.requests) {
    if (!fieldsOnly(item, ['requestURL', 'method', 'requestedAt', 'accept', 'userAgent', 'httpStatus', 'finalURL', 'redirected', 'respondedAt', 'location'])
        || item.method !== 'GET' || !safeURL(item.requestURL) || !safeURL(item.finalURL)
        || !Number.isInteger(item.httpStatus) || item.httpStatus < 100 || item.httpStatus > 599
        || typeof item.redirected !== 'boolean' || !validTime(item.requestedAt) || !validTime(item.respondedAt)
        || Date.parse(item.respondedAt) < Date.parse(item.requestedAt)
        || [item.accept, item.userAgent].some(v => v !== null && (typeof v !== 'string' || v.length > 512 || /[\r\n]/.test(v)))
        || (item.location != null && (typeof item.location !== 'string' || item.location.length > 8192 || /[\r\n\u0000]/.test(item.location)))) return null;
    records.push({ requestURL: item.requestURL, method: 'GET', requestedAt: item.requestedAt,
      accept: item.accept, userAgent: item.userAgent, httpStatus: item.httpStatus, finalURL: item.finalURL,
      redirected: item.redirected, respondedAt: item.respondedAt, location: item.location ?? null });
  }
  return { fetchCallCount: records.length, requests: records };
}
function actualSourceFacts(value, ats) {
  if (value === undefined) return undefined;
  if (ats === 'ashby' && fieldsOnly(value, ['type', 'isListedState', 'isListed']) && value.type === 'ashby-listing'
      && ['boolean', 'absent', 'invalid'].includes(value.isListedState)) {
    if (value.isListedState === 'boolean') return typeof value.isListed === 'boolean'
      ? { type: value.type, isListedState: value.isListedState, isListed: value.isListed } : null;
    return Object.hasOwn(value, 'isListed') ? null : { type: value.type, isListedState: value.isListedState };
  }
  if (ats !== 'workday' || !fieldsOnly(value, ['type', 'canApplyState', 'jobPostingInfo']) || value.type !== 'workday-cxs'
      || !['boolean', 'absent', 'invalid'].includes(value.canApplyState)
      || !fieldsOnly(value.jobPostingInfo, ['canApply', 'title', 'jobReqId', 'externalPath'])) return null;
  const info = value.jobPostingInfo, jobPostingInfo = {};
  if (value.canApplyState === 'boolean') {
    if (typeof info.canApply !== 'boolean') return null;
    jobPostingInfo.canApply = info.canApply;
  } else if (Object.hasOwn(info, 'canApply')) return null;
  for (const [key, max] of [['title', 1000], ['jobReqId', 300], ['externalPath', 2048]]) {
    if (!Object.hasOwn(info, key)) continue;
    if (typeof info[key] !== 'string' || !info[key].trim() || info[key].length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(info[key])) return null;
    jobPostingInfo[key] = info[key];
  }
  return { type: value.type, canApplyState: value.canApplyState, jobPostingInfo };
}
const explicitlyClosed = facts => facts?.type === 'ashby-listing' ? facts.isListedState === 'boolean' && facts.isListed === false
  : facts?.type === 'workday-cxs' && facts.canApplyState === 'boolean' && facts.jobPostingInfo.canApply === false;
function bindingFacts(value, originalURL) {
  if (!fieldsOnly(value, ['version', 'kind', 'originalURL', 'sourcePostingURL', 'textCap', 'textSha256', 'utf8Bytes', 'title', 'sourceFacts', 'atsIdentity', 'transport', 'apiRequestIndex',
      'publisherRequestIndex', 'applyRequestIndex', 'observedApplyHref', 'redirectLocation'])
      || value.version !== 1 || value.originalURL !== originalURL || !safeURL(originalURL)
      || value.textCap !== KNOWN_JD_TEXT_CAP || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 1000 || /[\u0000-\u001f\u007f-\u009f]/u.test(value.title)
      || !/^[a-f0-9]{64}$/.test(value.textSha256) || !Number.isSafeInteger(value.utf8Bytes) || value.utf8Bytes < 200 || value.utf8Bytes >= 4 * KNOWN_JD_TEXT_CAP) return failure('invalid source binding');
  const selected = sourceIdentity(value.sourcePostingURL), transport = transportRecords(value.transport);
  if (!selected || !transport || !object(value.atsIdentity)
      || JSON.stringify(value.atsIdentity) !== JSON.stringify(selected.identity)) return failure('source identity or transport does not match');
  const facts = actualSourceFacts(value.sourceFacts, selected.identity.ats);
  if (facts === null || explicitlyClosed(facts)) return failure('source status facts are invalid or explicitly closed');
  const requests = transport.requests;
  if (value.kind === 'direct-known-ats') {
    if (value.sourcePostingURL !== originalURL || value.apiRequestIndex !== 0 || requests.length !== 1
        || ['publisherRequestIndex', 'applyRequestIndex', 'observedApplyHref', 'redirectLocation'].some(key => Object.hasOwn(value, key))) return failure('invalid direct source chain');
  } else if (value.kind === 'arbeitnow-apply-redirect') {
    const observed = applyHref(originalURL, value.observedApplyHref);
    if (!observed || value.publisherRequestIndex !== 0 || value.applyRequestIndex !== 1 || value.apiRequestIndex !== 2 || requests.length !== 3
        || requests[0].requestURL !== originalURL || requests[0].finalURL !== originalURL || requests[0].httpStatus !== 200 || requests[0].redirected !== false
        || requests[1].requestURL !== observed || requests[1].finalURL !== observed || requests[1].httpStatus !== 302 || requests[1].redirected !== false
        || requests[1].location !== value.redirectLocation || value.redirectLocation !== value.sourcePostingURL) return failure('unproven publisher redirect chain');
  } else return failure('unsupported source chain');
  const apiRequest = requests[value.apiRequestIndex];
  if (!apiRequest || apiRequest.httpStatus !== 200 || !apiMatches(apiRequest.requestURL, selected.resolved.apiUrl)
      || !apiMatches(apiRequest.finalURL, selected.resolved.apiUrl)) return failure('exact known API HTTP200 is not established');
  return { ok: true, sourcePostingURL: value.sourcePostingURL, apiRequest, transport };
}

/** Import-safe, synchronous provenance checker for report-numbered receipts. */
export function validateArchiveSourceBinding(binding, originalURL) {
  try { return bindingFacts(binding, originalURL); } catch { return failure('invalid source binding'); }
}

/** Validate exact native text plus its observed transport, never model claims. */
export function validateArchiveSourcePacket(packet, originalURL) {
  try {
    if (!fieldsOnly(packet, ['version', 'originalURL', 'sourcePostingURL', 'textCap', 'result', 'transport', 'chain'])
        || packet.version !== 2 || packet.originalURL !== originalURL || packet.textCap !== KNOWN_JD_TEXT_CAP || !object(packet.chain)) return failure('invalid native source packet');
    const result = packet.result;
    if (!object(result) || result.url !== packet.sourcePostingURL || typeof result.title !== 'string' || !result.title.trim()
        || typeof result.text !== 'string' || result.text.length >= KNOWN_JD_TEXT_CAP || result.text.trimEnd().endsWith('…')) return failure('source text is incomplete or explicitly closed');
    const body = result.text.split(/\n\s*\n/);
    if (body[0].split('\n').every(line => /^[A-Za-z][A-Za-z /()-]{0,60}:/.test(line))) body.shift();
    if (body.join('\n\n').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length < 200) return failure('source has no substantive JD');
    const selected = sourceIdentity(packet.sourcePostingURL), transport = transportRecords(packet.transport);
    if (!selected || result.ats !== selected.identity.ats || !transport
        || !fieldsOnly(packet.chain, ['kind', 'publisherRequestIndex', 'applyRequestIndex', 'apiRequestIndex', 'observedApplyHref', 'redirectLocation'])) return failure('source API identity is missing');
    const facts = actualSourceFacts(result.sourceFacts, selected.identity.ats);
    if (facts === null || explicitlyClosed(facts)) return failure('source status facts are invalid or explicitly closed');
    const binding = { version: 1, ...packet.chain, originalURL, sourcePostingURL: packet.sourcePostingURL,
      textCap: packet.textCap, textSha256: textHash(result.text), utf8Bytes: Buffer.byteLength(result.text),
      title: result.title, ...(facts ? { sourceFacts: facts } : {}), atsIdentity: selected.identity, transport };
    const checked = validateArchiveSourceBinding(binding, originalURL);
    return checked.ok ? { ok: true, text: result.text, sourcePostingURL: packet.sourcePostingURL, binding } : checked;
  } catch { return failure('invalid native source packet'); }
}

async function boundedPublisherHtml(response) {
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > 1_000_000) throw new Error('publisher HTML exceeds bound');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function publisherSource(packet) {
  const options = { headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(15_000) };
  const response = await fetch(packet.originalURL, options);
  const html = await boundedPublisherHtml(response);
  if (response.status !== 200 || response.url !== packet.originalURL || response.redirected) return null;
  const href = observedApplyHref(html, packet.originalURL);
  const applyURL = applyHref(packet.originalURL, href);
  if (!applyURL) return null;
  const redirect = await fetch(applyURL, { ...options, signal: AbortSignal.timeout(10_000) });
  const location = redirect.headers?.get('location');
  // Consume each manual response once under its own abort/byte bound, so an
  // unread redirect body cannot outlive this isolated reader's useful result.
  await boundedPublisherHtml(redirect);
  // Follow only the observed known ATS Location, using the existing dispatcher.
  // Its application HTML is not requested and title aliases never supply an ID.
  if (redirect.status !== 302 || redirect.url !== applyURL || redirect.redirected || !sourceIdentity(location)) return null;
  packet.sourcePostingURL = location;
  packet.chain = { kind: 'arbeitnow-apply-redirect', publisherRequestIndex: 0, applyRequestIndex: 1,
    apiRequestIndex: 2, observedApplyHref: href, redirectLocation: location };
  return fetchJdViaKnownApi(location, KNOWN_JD_TEXT_CAP, 15_000);
}

async function readIsolated(request) {
  const selected = knownJdInput(request?.url);
  if (!selected) throw new Error('invalid source URL');
  const records = [];
  const packet = { version: 2, originalURL: selected.originalURL, sourcePostingURL: selected.originalURL,
    chain: { kind: 'direct-known-ats', apiRequestIndex: 0 }, textCap: KNOWN_JD_TEXT_CAP, result: null, transport: { fetchCallCount: 0, requests: records } };
  if (selected.linkedIn) return { ...packet, skipped: 'linkedin_loading_guard' };
  const nativeFetch = globalThis.fetch;
  // This function is private and called ONLY by isolated CLI main, never from
  // the long-lived web server. Importing this module changes no global state.
  globalThis.fetch = recordedGetFetch(nativeFetch.bind(globalThis), records);
  try {
    packet.result = publisherURL(selected.originalURL) ? await publisherSource(packet)
      : await fetchJdViaKnownApi(selected.originalURL, KNOWN_JD_TEXT_CAP, 15_000);
  } catch {
    packet.error = 'source_read_failed';
  } finally {
    globalThis.fetch = nativeFetch;
    packet.transport.fetchCallCount = records.length;
  }
  return packet;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node read-known-jd.mjs --request -\nRead bounded JSON {"url":"https://..."} from stdin; no model or file writes.');
    return;
  }
  if (args.length !== 2 || args[0] !== '--request' || args[1] !== '-') throw new Error('expected --request -');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > KNOWN_JD_REQUEST_LIMIT) throw new Error('source request exceeds limit');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => key !== 'url')) throw new Error('invalid source request');
  console.log(JSON.stringify(await readIsolated(request)));
}

if (isMainModule(import.meta.url)) {
  main().catch(() => { console.error('read-known-jd: invalid or unavailable source request'); process.exitCode = 2; });
}
