#!/usr/bin/env node
/** Read one known ATS JD in an isolated process, retaining transport facts.
 * The existing dispatcher owns ATS mapping, headers and body consumption.
 * This module is import-safe; only CLI main scopes a child-local fetch wrapper.
 */
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
      record.respondedAt = now();
      return response;
    } catch (error) {
      record.error = 'fetch_failed';
      throw error;
    }
  };
}

async function readIsolated(request) {
  const selected = knownJdInput(request?.url);
  if (!selected) throw new Error('invalid source URL');
  const records = [];
  const packet = { version: 1, originalURL: selected.originalURL, textCap: KNOWN_JD_TEXT_CAP, result: null, transport: { fetchCallCount: 0, requests: records } };
  if (selected.linkedIn) return { ...packet, skipped: 'linkedin_loading_guard' };
  const nativeFetch = globalThis.fetch;
  // This function is private and called ONLY by isolated CLI main, never from
  // the long-lived web server. Importing this module changes no global state.
  globalThis.fetch = recordedGetFetch(nativeFetch.bind(globalThis), records);
  try {
    packet.result = await fetchJdViaKnownApi(selected.originalURL, KNOWN_JD_TEXT_CAP, 15_000);
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
