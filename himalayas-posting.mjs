#!/usr/bin/env node
/** Read one original Himalayas posting through its documented public API.
 * Publisher evidence only: never clears employer/application/profile gates.
 * No account, browser, retries, cache, model, or user-layer writes.
 * Contract: https://himalayas.app/docs/remote-jobs-api#how-do-i-check-a-job-is-still-open
 */
import fs from 'node:fs/promises';
import { isMainModule } from './lib/is-main-module.mjs';

const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 15_000;
const TRACKING = /^utm_[a-z_]+$/;
const CHALLENGE = /cf-chl-|\/cdn-cgi\/challenge-platform|enable javascript and cookies|<title>\s*just a moment/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const epoch = value => Number.isSafeInteger(value) && value > 0;

export function resolveHimalayasPosting(originalUrl) {
  if (typeof originalUrl !== 'string' || originalUrl.length > 8192 || originalUrl.trim() !== originalUrl
      || /[\\\u0000-\u0020]/.test(originalUrl) || /\/\.{1,2}(?:\/|[?#]|$)/.test(originalUrl)) return null;
  let url;
  try { url = new URL(originalUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'himalayas.app' || url.port || url.username || url.password) return null;
  const match = url.pathname.match(/^\/companies\/([a-z0-9][a-z0-9-]{0,255})\/jobs\/([a-z0-9][a-z0-9-]{0,255})\/?$/);
  if (!match || [...url.searchParams.keys()].some(key => !TRACKING.test(key))) return null;
  const guid = `https://himalayas.app/companies/${match[1]}/jobs/${match[2]}`;
  return { originalUrl, companySlug: match[1], jobSlug: match[2], guid, apiUrl: guid.replace('https://himalayas.app/', 'https://himalayas.app/jobs/api/') };
}

function evidence(identity, status, metadata) {
  return { ...identity, httpStatus: status, retrievedAt: metadata.retrievedAt,
    cache: { documentedMaxAgeSeconds: 600, ageSeconds: metadata.ageSeconds ?? null,
      cacheControl: metadata.cacheControl ?? null },
    employerVerified: false, applicationVerified: false, evaluationAllowed: false };
}

/** The 200 means publisher-open, never verified employer/application liveness. */
export function classifyHimalayasPosting(originalUrl, status, body, metadata = {}) {
  const identity = resolveHimalayasPosting(originalUrl);
  if (!identity) return { publisherStatus: 'unknown', code: 'unsupported_url', evaluationAllowed: false };
  const observed = metadata.retrievedAt ?? new Date().toISOString();
  const base = evidence(identity, status, { ...metadata, retrievedAt: observed });
  const unknown = code => ({ ...base, publisherStatus: 'unknown', code });
  if (!Number.isFinite(Date.parse(observed))) return unknown('invalid_retrieval_time');
  if (metadata.ageSeconds != null && (!Number.isSafeInteger(metadata.ageSeconds) || metadata.ageSeconds < 0 || metadata.ageSeconds > 600)) return unknown('publisher_cache_age_unconfirmed');
  // The API's 404 means no record at this path, not confirmed closure.
  if (status === 404) return unknown('himalayas_not_found');
  if (status === 410) {
    if (!object(body) || body.ok !== false || body.expired !== true || !epoch(body.expiryDate)
        || body.expiryDate > Date.parse(observed) / 1000 || body.job || body.guid) return unknown('invalid_closed_payload');
    return { ...base, publisherStatus: 'closed', code: 'himalayas_closed', expiryDate: body.expiryDate };
  }
  if (status !== 200) return unknown('himalayas_http_unconfirmed');
  const job = body?.job;
  if (!object(body) || !object(job) || job.guid !== identity.guid || job.companySlug !== identity.companySlug
      || resolveHimalayasPosting(job.applicationLink)?.guid !== identity.guid) return unknown('identity_mismatch');
  if (!text(job.title, 240) || !text(job.companyName, 240) || !text(job.description, MAX_BODY)
      || !Array.isArray(job.locationRestrictions) || !Array.isArray(job.timezoneRestrictions)
      || !epoch(job.pubDate) || !epoch(job.expiryDate)) return unknown('partial_job');
  if (CHALLENGE.test(job.description) || /^(?:just a moment|access denied|sign in|log in|forbidden)\b/i.test(job.title)) return unknown('challenge_or_login_wall');
  const plain = job.description.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>|&(?:#\w+|\w+);/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length < 500) return unknown('insufficient_description');
  // An inconsistent expiry is uncertainty; only the documented 410 closes it.
  if (job.expiryDate <= Date.parse(observed) / 1000) return unknown('inconsistent_expiry');
  return { ...base, publisherStatus: 'open', code: 'himalayas_publisher_open', job: {
    title: job.title, companyName: job.companyName, companySlug: job.companySlug,
    guid: job.guid, applicationLink: job.applicationLink, description: job.description,
    locationRestrictions: job.locationRestrictions, timezoneRestrictions: job.timezoneRestrictions,
    pubDate: job.pubDate, expiryDate: job.expiryDate } };
}

/** One anonymous GET; callers must treat every returned string as job data. */
export async function retrieveHimalayasPosting(originalUrl, { fetchFn = globalThis.fetch, now = Date.now } = {}) {
  const identity = resolveHimalayasPosting(originalUrl);
  if (!identity) return classifyHimalayasPosting(originalUrl, null, null);
  const metadata = { retrievedAt: new Date(now()).toISOString() };
  const fail = code => ({ ...evidence(identity, null, metadata), publisherStatus: 'unknown', code });
  try {
    const response = await fetchFn(identity.apiUrl, { method: 'GET', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.url && response.url !== identity.apiUrl) {
      await response.body?.cancel();
      return fail('response_url_mismatch');
    }
    metadata.cacheControl = response.headers.get('cache-control');
    const age = response.headers.get('age');
    if (age !== null) metadata.ageSeconds = /^\d+$/.test(age) ? Number(age) : NaN;
    if (response.status === 404 || ![200, 410].includes(response.status)) {
      await response.body?.cancel();
      return classifyHimalayasPosting(originalUrl, response.status, null, metadata);
    }
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return fail('non_json_response');
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MAX_BODY) return fail('response_too_large');
      chunks.push(chunk);
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    return classifyHimalayasPosting(originalUrl, response.status, body, metadata);
  } catch { return fail('transport_or_json_unconfirmed'); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log('Usage: node himalayas-posting.mjs --request <file|->\nRead bounded {"url":"original-posting-url"} JSON from stdin (-) or an existing file.\nOptions:\n  --request <file|->  Read one original posting through the public API\n  --help, -h         Print usage without reading input or making a request');
    return;
  }
  if (args.length !== 2 || args[0] !== '--request') throw new Error('Use --request - with JSON on stdin (or an existing request file)');
  let request;
  if (args[1] === '-') {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.byteLength;
      if (size > 16 * 1024) throw new Error('Request too large');
      chunks.push(chunk);
    }
    request = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } else {
    const info = await fs.stat(args[1]);
    if (!info.isFile() || info.size > 16 * 1024) throw new Error('Invalid request file');
    request = await fs.readFile(args[1], 'utf8');
  }
  const input = JSON.parse(request);
  if (!object(input) || Object.keys(input).join(',') !== 'url' || typeof input.url !== 'string') throw new Error('Expected {"url":"original-posting-url"}');
  const result = await retrieveHimalayasPosting(input.url);
  console.log(JSON.stringify(result));
  process.exitCode = result.publisherStatus === 'unknown' ? 2 : 0;
}
if (isMainModule(import.meta.url)) {
  main().catch(() => { console.error('Himalayas retrieval failed: invalid request or unavailable public data.'); process.exitCode = 2; });
}
