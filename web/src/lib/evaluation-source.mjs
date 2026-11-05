import { spawn } from 'node:child_process';
import path from 'node:path';

const MAX_OUTPUT = 128 * 1024;
const MAX_STDERR = 4096;
const TEXT_CAP = 20_000;
const MAX_URL_BYTES = 8192;
const elapsed = start => Math.max(0, Math.ceil(performance.now() - start));

function publicURL(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > MAX_URL_BYTES || /[\s\u0000-\u001f\u007f-\u009f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function substantiveBody(text) {
  const blocks = text.split(/\n\s*\n/);
  const first = blocks[0].split('\n');
  if (first.every(line => /^[A-Za-z][A-Za-z /()-]{0,60}:/.test(line) || /^Not currently listed\b/.test(line))) blocks.shift();
  return blocks.join('\n\n').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Only known, bounded fields from Workday's parsed jobPostingInfo survive.
// They remain untrusted source data; this is not an open/eligible verdict.
function workdaySourceFacts(value) {
  if (!value || value.type !== 'workday-cxs' || !['boolean', 'absent', 'invalid'].includes(value.canApplyState)
      || !value.jobPostingInfo || typeof value.jobPostingInfo !== 'object' || Array.isArray(value.jobPostingInfo)) return null;
  const info = value.jobPostingInfo, jobPostingInfo = {};
  const hasCanApply = Object.hasOwn(info, 'canApply');
  if (value.canApplyState === 'boolean') {
    if (!hasCanApply || typeof info.canApply !== 'boolean') return null;
    jobPostingInfo.canApply = info.canApply;
  } else if (hasCanApply) return null;
  for (const [field, limit] of [['title', 1000], ['jobReqId', 300], ['externalPath', 2048]]) {
    if (!Object.hasOwn(info, field)) continue;
    const item = info[field];
    if (typeof item !== 'string' || !item.trim() || item.length > limit || /[\u0000-\u001f\u007f-\u009f]/u.test(item)) return null;
    jobPostingInfo[field] = item;
  }
  return { type: 'workday-cxs', canApplyState: value.canApplyState, jobPostingInfo };
}

function ashbySourceFacts(value) {
  if (!value || value.type !== 'ashby-listing' || !['boolean', 'absent', 'invalid'].includes(value.isListedState)) return null;
  if (value.isListedState === 'boolean') return typeof value.isListed === 'boolean'
    ? { type: 'ashby-listing', isListedState: 'boolean', isListed: value.isListed } : null;
  return Object.hasOwn(value, 'isListed') ? null : { type: 'ashby-listing', isListedState: value.isListedState };
}

// Keep native child data private. The core writer is the authoritative packet
// and ATS-chain validator; neither request JSON nor model text can supply this.
function privateArchiveSource(packet, evidence) {
  if (packet.version !== 2 || evidence?.outcome !== 'available' || !packet.chain || typeof packet.chain !== 'object' || Array.isArray(packet.chain)) return undefined;
  const chain = Object.fromEntries(['kind', 'publisherRequestIndex', 'applyRequestIndex', 'apiRequestIndex', 'observedApplyHref', 'redirectLocation']
    .filter(key => Object.hasOwn(packet.chain, key)).map(key => [key, packet.chain[key]]));
  if (chain.kind === 'direct-known-ats' && (packet.sourcePostingURL !== packet.originalURL || evidence.transport.requests.length !== 1
      || ['greenhouse-embedded', 'workable-short'].includes(packet.result.ats))) return undefined;
  if (chain.kind === 'arbeitnow-apply-redirect' && evidence.transport.requests.length !== 3) return undefined;
  if (!['direct-known-ats', 'arbeitnow-apply-redirect'].includes(chain.kind)
      || Object.values(chain).some(value => !['string', 'number'].includes(typeof value) || (typeof value === 'string' && value.length > 8192))) return undefined;
  const sourceFacts = Object.hasOwn(packet.result, 'sourceFacts') ? packet.result.sourceFacts : undefined;
  return { version: 2, originalURL: packet.originalURL, sourcePostingURL: packet.sourcePostingURL,
    textCap: packet.textCap, result: { url: packet.result.url, title: packet.result.title, text: packet.result.text,
      ats: packet.result.ats, ...(sourceFacts !== undefined ? { sourceFacts } : {}) }, transport: evidence.transport, chain };
}

/** Validate backend-child facts before any packet reaches a prompt. */
export function evaluationSourceEvidence(packet, originalURL) {
  if (!packet || ![1, 2].includes(packet.version) || packet.originalURL !== originalURL || packet.textCap !== TEXT_CAP
      || !packet.transport || !Array.isArray(packet.transport.requests) || packet.transport.requests.length > 8
      || packet.transport.fetchCallCount !== packet.transport.requests.length) return null;
  const requests = [];
  for (const item of packet.transport.requests) {
    if (!item || item.method !== 'GET' || !publicURL(item.requestURL)
        || (item.httpStatus !== null && (!Number.isInteger(item.httpStatus) || item.httpStatus < 100 || item.httpStatus > 599))
        || (item.finalURL !== null && !publicURL(item.finalURL))
        || typeof item.requestedAt !== 'string' || !Number.isFinite(Date.parse(item.requestedAt))
        || (item.respondedAt !== null && (typeof item.respondedAt !== 'string' || !Number.isFinite(Date.parse(item.respondedAt))))
        || ![null, true, false].includes(item.redirected)
        || [item.accept, item.userAgent].some(value => value !== null && (typeof value !== 'string' || value.length > 512))
        || (item.location != null && (typeof item.location !== 'string' || item.location.length > 8192 || /[\r\n\u0000]/.test(item.location)))) return null;
    requests.push({ requestURL: item.requestURL, method: 'GET', requestedAt: item.requestedAt,
      accept: item.accept, userAgent: item.userAgent, httpStatus: item.httpStatus, finalURL: item.finalURL,
      redirected: item.redirected, respondedAt: item.respondedAt, ...(packet.version === 2 ? { location: item.location ?? null } : {}) });
  }
  const evidence = { originalURL, helper: 'read-known-jd.mjs → fetchJdViaKnownApi',
    textCap: TEXT_CAP, transport: { fetchCallCount: requests.length, requests }, outcome: 'inconclusive' };
  const source = packet.result, sourcePostingURL = packet.version === 2 ? packet.sourcePostingURL : originalURL;
  if (!publicURL(sourcePostingURL) || /(^|\.)linkedin\.com$/i.test(new URL(sourcePostingURL).hostname.replace(/\.+$/, ''))) return evidence;
  if (!source || source.url !== sourcePostingURL || typeof source.ats !== 'string' || !/^[a-z0-9-]{1,64}$/.test(source.ats)
      || typeof source.title !== 'string' || !source.title.trim() || source.title.length > 1000
      || typeof source.text !== 'string' || source.text.length >= TEXT_CAP || source.text.trimEnd().endsWith('…')
      || substantiveBody(source.text).length < 200 || /^(?:you need to enable javascript|enable javascript to|access denied|just a moment)[.!\s]*$/i.test(substantiveBody(source.text))
      || requests.at(-1)?.httpStatus !== 200 || !requests.at(-1)?.finalURL) return evidence;
  const facts = source.ats === 'workday' ? workdaySourceFacts(source.sourceFacts)
    : source.ats === 'ashby' ? ashbySourceFacts(source.sourceFacts) : null;
  return { ...evidence, outcome: 'available', ats: source.ats,
    ...(packet.version === 2 ? { sourcePostingURL, sourceChain: privateArchiveSource(packet, { ...evidence, outcome: 'available' })?.chain ?? null } : {}),
    // Source facts remain untrusted, including an observed canApply boolean.
    // Transport 200 alone never asserts open status, eligibility or verification.
    jobData: { title: source.title, text: source.text, ...(facts ? { sourceFacts: facts } : {}) }, observedTextLength: source.text.length };
}

/** One anonymous native read, in an isolated process, before the model starts.
 * @returns {Promise<{outcome: string, elapsedMs: number, attempted: boolean, evidence?: Record<string, unknown>|null, archiveSource?: Record<string, unknown>, reason?: string|null}>}
 */
export async function readEvaluationSource({ kind, input, root, signal, spawnFn = spawn,
  execPath = process.execPath, timeoutMs = 25_000, killGraceMs = 1000 }) {
  const start = performance.now();
  const result = (outcome, more = {}) => ({ outcome, elapsedMs: elapsed(start), ...more });
  if (signal?.aborted) return result('aborted', { attempted: false });
  const selected = publicURL(input);
  if (kind !== 'evaluate' || !selected || /(^|\.)linkedin\.com$/i.test(selected.hostname.replace(/\.+$/, ''))) return result('skipped', { attempted: false });
  return new Promise(resolve => {
    let child, closed = false, reason = null, timer, forceTimer;
    let stdout = '', bytes = 0, stderrBytes = 0;
    const finish = (code) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer); clearTimeout(forceTimer);
      signal?.removeEventListener('abort', abort);
      if (reason === 'aborted') { resolve(result('aborted', { attempted: true })); return; }
      const failed = why => result('inconclusive', { attempted: true, reason: why,
        evidence: { originalURL: input, helper: 'read-known-jd.mjs → fetchJdViaKnownApi', textCap: TEXT_CAP,
          outcome: 'inconclusive', failure: why, transport: { fetchCallCount: null, requests: [] } } });
      if (reason || code !== 0) { resolve(failed(reason ?? 'helper_failed')); return; }
      let packet;
      try { packet = JSON.parse(stdout); } catch { resolve(failed('invalid_packet')); return; }
      const evidence = evaluationSourceEvidence(packet, input);
      resolve(evidence ? result(evidence.outcome, { attempted: true, evidence, archiveSource: privateArchiveSource(packet, evidence), reason: null }) : failed('invalid_packet'));
    };
    const stop = why => {
      if (closed || reason) return;
      reason = why;
      forceTimer = setTimeout(() => { if (!closed) { try { child?.kill('SIGKILL'); } catch { /* wait for close */ } } }, killGraceMs);
      try { child?.kill('SIGTERM'); } catch { /* close/error owns completion */ }
    };
    const failChild = () => {
      // 'error' can mean a failed kill of a still-running process, not just
      // ENOENT. A reader with a PID keeps ownership until stdio CLOSE.
      if (child?.pid) stop('helper_failed');
      else finish(-1);
    };
    const abort = () => stop('aborted');
    try {
      child = spawnFn(execPath, [path.join(root, 'read-known-jd.mjs'), '--request', '-'],
        { cwd: root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
      child.on('error', failChild);
      child.once('close', code => finish(code));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_OUTPUT) stop('output_limit');
        else stdout += chunk;
      });
      child.stderr.on('data', chunk => { stderrBytes += Buffer.byteLength(chunk); if (stderrBytes > MAX_STDERR) stop('stderr_limit'); });
      child.stdin.on('error', () => stop('stdin_failed'));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => stop('timeout'), timeoutMs);
      child.stdin.end(JSON.stringify({ url: input }));
      if (signal?.aborted) abort();
    } catch { failChild(); }
  });
}
