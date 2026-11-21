#!/usr/bin/env node
// Zero-token batch pre-filter.
//
// batch-runner.sh curls every offer URL before it spawns a worker. The result of
// that curl used to decide only whether the JD file was pre-populated or
// truncated, so a dead posting still got a full worker, which read an empty file,
// tried WebFetch, failed, and billed a real model call for nothing. In one
// observed run, 9 of 20 offers failed that way.
//
// This script turns the curl result the runner already has into a spawn/no-spawn
// decision. It reuses liveness-core.mjs's classifyLiveness rather than keeping a
// second keyword list, so the batch path and `check-liveness.mjs` cannot disagree
// about what "expired" means.
//
// Usage: node batch/prefilter-url.mjs <status> <requestedUrl> <finalUrl> <bodyTextFile>
// Prints one line: <decision>\t<code>\t<reason>
//
// Decisions:
//   proceed      spawn the worker as usual
//   skip-dead    the posting is gone: terminal, never retry
//   skip-blocked batch mode cannot read this page (anti-bot wall, or a redirect to
//                a listing page); it needs an interactive browser session
//   retry-later  transient (429/5xx): do not spend a worker now, retry the run
//
// Anything that is not clearly one of the three skips proceeds (fail open).

import { readFileSync } from 'node:fs';
import { classifyLiveness, isUnreadableVerdict } from '../liveness-core.mjs';
import { pageClosureEvidence, sameDocument, visibleTextForLiveness } from '../lib/jd-page-fetch.mjs';

// Strong expiry signals only. The soft and listing heuristics depend on an
// apply-control check that this curl-only path cannot run.
const DEAD_CODES = new Set(['http_gone', 'expired_url', 'expired_body', 'deadline_passed']);
const BODY_CLOSURE_CODES = new Set(['expired_body', 'deadline_passed']);

/**
 * @param {{status?: number, requestedUrl?: string, finalUrl?: string, bodyText?: string, bodyClosureTrusted?: boolean}} input
 * @returns {{decision: 'proceed'|'skip-dead'|'skip-blocked'|'retry-later', code: string, reason: string}}
 */
export function decide({ status = 0, requestedUrl = '', finalUrl = '', bodyText = '', bodyClosureTrusted = true } = {}) {
  // Curl received no HTTP response (DNS, TLS, connect or transfer failure).
  // Its last attempted redirect URL is not page evidence, so let the runner's
  // existing transport/thin-JD handling decide whether to retry or WebFetch.
  if (status === 0) return { decision: 'proceed', code: 'transport_unconfirmed', reason: 'no HTTP response' };
  // A page fetched for another posting cannot lend its closure banner to the
  // requested URL. Keep the final URL: classifyLiveness can still recognise an
  // explicit expired redirect, but body-derived closure is ignored.
  const trustedBody = finalUrl && !sameDocument(requestedUrl, finalUrl) ? '' : bodyText;
  const verdict = classifyLiveness({ status, requestedUrl, finalUrl, bodyText: trustedBody });
  const { result, code, reason } = verdict;
  let decision;
  if (result === 'expired') {
    const bodyClosureAllowed = !BODY_CLOSURE_CODES.has(code) || bodyClosureTrusted;
    decision = !isUnreadableVerdict(verdict) && DEAD_CODES.has(code) && bodyClosureAllowed ? 'skip-dead' : 'proceed';
  } else if (code === 'redirected_off_posting') {
    // The requested URL carried a job id and the final URL does not: what curl
    // downloaded is a board listing, not this posting. A worker handed that file
    // can only fail, or evaluate whatever job tops the listing. Recorded as
    // blocked rather than dead because liveness-core keeps it `uncertain` (a
    // portal migration can redirect live postings too).
    decision = 'skip-blocked';
  } else if (code === 'access_blocked' || code === 'bot_challenge') {
    // For a browser these may be readable, but a batch worker has no browser and
    // its WebFetch fallback hits the same wall.
    decision = status === 429 || status >= 500 ? 'retry-later' : 'skip-blocked';
  } else if (code === 'server_error') {
    decision = 'retry-later';
  } else {
    decision = 'proceed';
  }
  return { decision, code, reason };
}

function main() {
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log('Usage: node batch/prefilter-url.mjs <status> <requestedUrl> <finalUrl> <bodyTextFile>\nPrints: <proceed|skip-dead|skip-blocked|retry-later>\t<code>\t<reason>');
    return;
  }
  const [statusRaw, requestedUrl = '', finalUrl = '', bodyFile = ''] = process.argv.slice(2);
  const status = Number.parseInt(statusRaw, 10) || 0;
  let bodyHtml = '';
  let bodyText = '';
  try {
    bodyHtml = readFileSync(bodyFile, 'utf-8');
    bodyText = visibleTextForLiveness(bodyHtml);
  } catch {
    bodyText = '';
  }
  // Text alone cannot say which posting it belongs to. Preserve the page-fetch
  // ambiguity and identity gates before treating body closure evidence as
  // terminal; status and expired-URL evidence stay independently decisive.
  const bodyClosureTrusted = Boolean(bodyHtml) && Boolean(pageClosureEvidence(bodyHtml, requestedUrl, finalUrl));
  const { decision, code, reason } = decide({ status, requestedUrl, finalUrl, bodyText, bodyClosureTrusted });
  process.stdout.write(`${decision}\t${code}\t${reason}\n`);
}

import { isMainModule } from '../lib/is-main-module.mjs';
if (isMainModule(import.meta.url)) main();
