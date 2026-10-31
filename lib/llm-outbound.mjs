/**
 * llm-outbound.mjs — the shared boundary every outbound LLM request passes through.
 *
 * WHY THIS EXISTS
 * ---------------
 * The privacy guard (`lib/privacy-guard.mjs`) is only worth anything if it is
 * invoked at the moment a request is about to leave the machine. Prompt
 * construction happens in a dozen places; the network call happens in a few.
 * This module is the one function those call sites share, so the policy lives
 * in a single spot instead of being re-implemented (or forgotten) per provider.
 *
 * TWO ENFORCEMENT LAYERS
 * ----------------------
 * 1. EXPLICIT — a call site builds its request body and calls
 *    `assertLlmRequestAllowed(url, body)` before `fetch`. This is the primary
 *    layer: it runs after prompt construction and before the network call, and
 *    it fails closed.
 * 2. AMBIENT — `lib/pii-interceptor.mjs` installs a global `fetch` wrapper that
 *    calls the same function for any request whose host is an LLM provider.
 *    This covers a path nobody remembered to instrument, including third-party
 *    SDKs (the Google Generative AI SDK issues its own `fetch`).
 *
 * The ambient layer is a safety net, not a substitute: a request that never
 * reaches global `fetch` (a native HTTP client, a child process, a browser) is
 * outside both layers, and the docs say so plainly.
 *
 * HOST MATCHING
 * -------------
 * Only requests to known LLM hosts are inspected by the ambient layer. Job
 * boards, ATS APIs and general web scraping must keep working untouched, and a
 * false block there would break the scanner. The host list is deliberately a
 * list of LLM providers, not "anything that looks like an API".
 */

import {
  CATEGORY,
  PrivacyGuardError,
  getDefaultGuard,
  serializePayload,
} from './privacy-guard.mjs';

/**
 * Is redaction explicitly requested? Only the exact string `1`/`true` counts, so
 * an unrelated truthy value cannot switch modes by accident.
 */
export function redactModeEnabled(env = process.env) {
  const raw = String(env.PRIVACY_REDACT ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * Hosts that are treated as external LLM providers.
 *
 * Matched against the request URL's hostname (suffix match on label boundaries,
 * so `openrouter.ai` does not match `evil-openrouter.ai.example`). A port may be
 * present — Ollama on `localhost:11434` is a local model, but the payload still
 * leaves the process, and a user who has pointed `OLLAMA_BASE_URL` at a remote
 * box is sending CV text over the network all the same.
 */
export const LLM_HOSTS = Object.freeze([
  'openrouter.ai',
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.deepseek.com',
  'api.moonshot.ai',
  'api.mistral.ai',
  'api.groq.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.perplexity.ai',
  'api.cohere.ai',
  'api.x.ai',
  'api.z.ai',
  'router.requesty.ai',
  'api.cerebras.ai',
  // Local/self-hosted, matched by host+port pair below rather than suffix.
]);

/** host:port pairs for local model servers. */
const LOCAL_LLM_ENDPOINTS = Object.freeze([
  'localhost:11434',      // Ollama
  '127.0.0.1:11434',
  'localhost:1234',       // LM Studio / llama.cpp
  '127.0.0.1:1234',
  'localhost:8000',       // generic vLLM
  '127.0.0.1:8000',
]);

/**
 * Path fragments that mark a URL as an LLM completion endpoint even on a host
 * that is not in the list (a self-hosted gateway, a corporate proxy).
 *
 * Two shapes exist. Most are path SEGMENTS (`/v1/chat/completions`), and a
 * bare `includes` was too loose for those — `/feedback/completions-stats`
 * contains `/completions` and would have been scanned. Google's is a colon
 * METHOD (`models:generateContent`) with no leading segment boundary, so it
 * needs a substring match. The shape is declared per entry rather than guessed.
 */
const LLM_PATH_HINTS = Object.freeze([
  { fragment: '/chat/completions', match: 'segment' },
  { fragment: '/completions', match: 'segment' },
  { fragment: '/v1/messages', match: 'segment' },
  { fragment: '/api/chat', match: 'segment' },
  { fragment: ':generatecontent', match: 'substring' },
]);

/**
 * Resolve a fetch argument to a URL string.
 *
 * Handles the three shapes `fetch` accepts: a string, a `URL`, and a `Request`.
 *
 * @param {string|URL|{url?: string}} input
 * @returns {string}
 */
export function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
  return '';
}

/**
 * Is this URL an external LLM request the guard should inspect?
 *
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isLlmRequestUrl(rawUrl) {
  if (!rawUrl) return false;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  const hostPort = url.port ? `${host}:${url.port}` : host;

  if (LOCAL_LLM_ENDPOINTS.includes(hostPort)) return true;

  for (const known of LLM_HOSTS) {
    if (host === known || host.endsWith(`.${known}`)) return true;
  }

  const path = url.pathname.toLowerCase();
  return LLM_PATH_HINTS.some(({ fragment, match }) =>
    match === 'substring' ? path.includes(fragment) : matchesPathHint(path, fragment)
  );
}

/**
 * Does a URL pathname END IN a known path segment, on a boundary?
 *
 * A bare `includes` was too loose for segment hints: `/feedback/completions-stats`
 * contains `/completions` and would be treated as an LLM endpoint, so the
 * ambient layer would serialize and scan an unrelated request. Requiring the
 * hint at the tail keeps real endpoints (`/v1/chat/completions`, `/api/chat`)
 * and drops the false shapes, since an LLM path segment is always the tail.
 *
 * @param {string} path Lowercased URL pathname.
 * @param {string} hint Lowercased fragment such as `/chat/completions`.
 * @returns {boolean}
 */
function matchesPathHint(path, hint) {
  return path === hint || path.endsWith(hint) || path.endsWith(`${hint}/`);
}

/** The Gemini generateContent endpoint the Google SDK targets. */
export const GOOGLE_GENAI_URL =
  'https://generativelanguage.googleapis.com/v1/models:generateContent';

/**
 * Inspect a Google Generative AI request built from the SAME parts the SDK is
 * about to receive.
 *
 * `@google/generative-ai` issues its own global `fetch`, so there is no way to
 * hand the SDK's serialized body to the guard. The next best thing is to build
 * the body here, pass it to the guard, and then pass the very same parts to
 * `generateContent()` — one function decides both, so the inspected payload and
 * the transmitted payload cannot drift apart.
 *
 * Shape approximates the REST body the SDK produces: `systemInstruction` (when
 * the model was configured with one) plus `contents` with one `parts[].text`
 * entry per turn. It is serialized for inspection only; it is never sent.
 *
 * The ambient interceptor (`lib/pii-interceptor.mjs`) remains the backstop for
 * anything this reconstruction misses, since the SDK's real request still goes
 * through the wrapped global `fetch`.
 *
 * @param {{systemInstruction?: string, turns: string[]}} request
 * @param {object} [options] Passed through to the guard.
 * @returns {{allowed: boolean, inspectedBytes: number}}
 * @throws {PrivacyGuardError}
 */
export function assertGoogleRequestAllowed(request, options = {}) {
  const { systemInstruction, turns } = request ?? {};
  const body = {
    contents: (turns ?? []).map((text) => ({ role: 'user', parts: [{ text }] })),
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  return assertLlmRequestAllowed(GOOGLE_GENAI_URL, JSON.stringify(body), options);
}

/**
 * The outcome of a guard check, for callers that want to branch.
 *
 * @typedef {{allowed: boolean, reason?: string, inspectedBytes: number}} GuardDecision
 */

function redactPreview(text, guard) {
  if (!guard?.textValues || typeof text !== 'string') return text;
  let out = text;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sortedValues = [...guard.textValues].sort((a, b) => b.length - a.length);
  for (const value of sortedValues) {
    if (value.length < 5) continue;
    const escaped = JSON.stringify(value).slice(1, -1);
    const forms = escaped === value ? [value] : [escaped, value];
    for (const pattern of forms) {
      const re = new RegExp(escapeRe(pattern), 'gi');
      out = out.replace(re, '{{PRIVACY_REDACTED}}');
    }
  }
  return out;
}
/**
 * Inspect a fully-built request body and throw if it carries protected data.
 *
 * This is THE function to call immediately before a network request. It fails
 * closed in both directions:
 *   - a protected value found  → `PrivacyGuardError` (nothing is sent)
 *   - the body cannot be read  → `PrivacyGuardError` (nothing is sent), because
 *     "I could not inspect this" must never be reported as "this is clean".
 *
 * A body that is absent or genuinely empty is allowed: there is nothing to leak.
 *
 * @param {string} url
 * @param {unknown} body The serialized string or object about to be transmitted.
 * @param {object} [options]
 * @param {import('./privacy-guard.mjs').PrivacyGuard} [options.guard]
 * @param {boolean} [options.requireLlmHost] When true, also verify the URL is an LLM host.
 * @returns {GuardDecision}
 * @throws {PrivacyGuardError}
 */
export function assertLlmRequestAllowed(
  url,
  body,
  { guard = getDefaultGuard(), requireLlmHost = false, allowRedact = redactModeEnabled() } = {}
) {
  if (requireLlmHost && !isLlmRequestUrl(url)) {
    throw new PrivacyGuardError('request to a non-LLM host', {
      detail: 'The outbound LLM guard was asked to inspect a URL it does not recognise as an LLM provider.',
    });
  }

  // Nothing to inspect. `undefined`/`null`/`''` mean no payload was set at all.
  if (body === undefined || body === null || body === '') {
    return { allowed: true, inspectedBytes: 0 };
  }

  let text;
  try {
    text = serializePayload(body);
  } catch (err) {
    // Fail closed: a request we cannot read is not a request we can clear.
    // The message names the body SHAPE (e.g. "ReadableStream"), which is not
    // the payload content, so this stays a category-only error.
    throw new PrivacyGuardError('request body that could not be inspected', {
      detail:
        err instanceof TypeError && err.message.includes('cannot be inspected as text')
          ? `${err.message}.`
          : `The outbound payload could not be serialized (${err?.name ?? 'Error'}).`,
    });
  }
  if (typeof text !== 'string') {
    throw new PrivacyGuardError('request body that could not be inspected', {
      detail: 'The outbound payload did not serialize to text.',
    });
  }

  if (allowRedact) {
    // When redact mode is enabled, evaluate a preview with configured text
    // redacted so that configured values (such as an email address) do not
    // trip pattern detection during preflight while still allowing the
    // request to proceed to wrapFetch where the text will be redacted.
    // Non-redactable findings (numbers and pattern-detected PII outside configured text)
    // are evaluated on the preview and still rejected immediately.
    const preview = redactPreview(text, guard);
    const findings = guard.inspect(preview, { haystack: preview });
    const nonTextFindings = findings.filter((f) => f.category !== CATEGORY.CONFIGURED_TEXT);
    if (nonTextFindings.length > 0) {
      guard.assertSafe(preview, { haystack: preview });
    }
  } else {
    guard.assertSafe(text, { haystack: text });
  }

  return { allowed: true, inspectedBytes: text.length };
}

/**
 * Non-throwing variant. Returns a decision instead of raising, for callers that
 * want to render their own message.
 *
 * Note it still returns `allowed: false` for an unreadable body — the
 * fail-closed behaviour is a property of the check, not of the calling style.
 *
 * @param {string} url
 * @param {unknown} body
 * @param {object} [options]
 * @returns {GuardDecision}
 */
export function checkLlmRequest(url, body, options) {
  try {
    return assertLlmRequestAllowed(url, body, options);
  } catch (err) {
    return { allowed: false, reason: err?.category ?? err?.message ?? 'unknown', inspectedBytes: 0 };
  }
}
