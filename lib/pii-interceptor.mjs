/**
 * pii-interceptor.mjs — ambient outbound guard installed over global `fetch`.
 *
 * WHAT THIS IS
 * ------------
 * A monkey-patch over `globalThis.fetch` that runs the privacy guard on any
 * request to an LLM provider before it leaves the machine. It exists because
 * the explicit call-site guard (`lib/llm-outbound.mjs`) can only cover the call
 * sites that remember to use it — and because a third-party SDK issues its own
 * `fetch` the explicit layer never sees. The Google Generative AI SDK is the
 * concrete example: `@google/generative-ai` calls the global `fetch` directly,
 * so `gemini-eval.mjs` and `scan-hn.mjs` are covered here and nowhere else.
 *
 * TWO MODES
 * ---------
 * BLOCK (default) — a protected value in an outbound request aborts the request
 *   with `PrivacyGuardError` before the network call. The prompt is never
 *   silently rewritten, because rewriting could change what the model is asked.
 *
 * REDACT (opt-in, `PRIVACY_REDACT=1`) — the legacy behaviour: replace protected
 *   values with placeholder tokens on the way out and re-hydrate tokens in the
 *   response. This is kept because some workflows depend on it (`pii-workspace
 *   .mjs`), but it is NOT the default, because silently altering a prompt's
 *   meaning is worse than refusing to send it. Rehydration covers `text()` and
 *   `json()` only — a streaming reader of `response.body` sees the tokens; see
 *   the caveat at the mutation site and limitation #7 in docs/PRIVACY.md.
 *
 * HOW IT GETS INSTALLED
 * ---------------------
 * Two ways, and both are supported:
 *   1. `NODE_OPTIONS="--import ./lib/pii-interceptor.mjs"` in `.env` — covers
 *      every `node *.mjs` command in the checkout, including scripts that do
 *      not import the guard themselves.
 *   2. `installPiiInterceptor()` called explicitly by a script. `openrouter-runner.mjs`
 *      and the other evaluators do this so the ambient layer is present even
 *      when NODE_OPTIONS is not set.
 *
 * Installation is idempotent — calling it twice does not double-wrap `fetch`.
 */

import {
  PrivacyGuardError,
  getDefaultGuard,
  loadPrivacyGuard,
} from './privacy-guard.mjs';
import { assertLlmRequestAllowed, isLlmRequestUrl, urlOf } from './llm-outbound.mjs';

/** Marker placed on the wrapper so a second install is a no-op. */
const INSTALLED = Symbol.for('career-ops.pii-interceptor.installed');

/** Tokens produced in redact mode, and the map to reverse them. */
const REDACT_TOKEN_PREFIX = '{{PRIVACY_REDACTED_';

/**
 * Is redaction explicitly requested? Only the exact string `1`/`true` counts, so
 * an unrelated truthy value cannot switch modes by accident.
 */
export function redactModeEnabled(env = process.env) {
  const raw = String(env.PRIVACY_REDACT ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
}

/**
 * Build a redactor over a guard: replace each configured value with a stable
 * placeholder and remember the mapping so the response can be rehydrated.
 *
 * Only configured values are redacted — pattern-detected PII (an email in a job
 * posting) is left alone, because replacing text the user never declared
 * sensitive would corrupt postings the evaluator needs to read.
 */
function makeRedactor(guard) {
  const tokens = new Map(); // token -> real value
  let counter = 0;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return {
    tokens,
    scrub(text) {
      let out = text;
      for (const value of guard.textValues) {
        if (value.length < 5) continue;
        // Restore the user's own spelling, not the lowercased match key.
        const original = guard.textOriginals?.get(value) ?? value;
        const re = new RegExp(escapeRe(value), 'gi');
        out = out.replace(re, () => {
          const token = `${REDACT_TOKEN_PREFIX}${++counter}}}`;
          tokens.set(token, original);
          return token;
        });
      }
      return out;
    },
    rehydrate(text) {
      let out = text;
      for (const [token, value] of tokens) out = out.split(token).join(value);
      return out;
    },
  };
}

/**
 * Wrap a fetch function.
 *
 * Exported so tests can install it over a mock without touching the real global,
 * and so a caller can compose it deliberately.
 *
 * @param {typeof fetch} baseFetch
 * @param {object} [options]
 * @param {import('./privacy-guard.mjs').PrivacyGuard} [options.guard]
 * @param {boolean} [options.redact]
 * @returns {typeof fetch}
 */
export function wrapFetch(baseFetch, { guard, redact } = {}) {
  const wrapped = async function piiProtectedFetch(input, init = {}) {
    const url = urlOf(input);

    if (!isLlmRequestUrl(url)) {
      // Not an LLM provider: job boards and ATS endpoints must pass untouched.
      return baseFetch(input, init);
    }

    const activeGuard = guard ?? getDefaultGuard();
    const activeRedact = redact !== undefined ? redact : redactModeEnabled();

    let nextInit = init;
    // Prefer the explicit body from `init`. If none was supplied but `input`
    // is a Request object with a body, clone it (so the original remains
    // readable) and extract the text for inspection. Guard the `Request`
    // global in case this runs in an environment where it is not defined.
    let body = init?.body;
    if (body === undefined && typeof Request !== 'undefined' && input instanceof Request && input.body !== null) {
      body = await input.clone().text();
    }

    // The redactor is created PER REQUEST, not per process. A process-global one
    // leaked across requests in two ways: its `tokens.size > 0` gate patched
    // `text`/`json` on every later response, including requests that carried no
    // value at all; and a rehydration pass then substituted this request's token
    // strings on the strength of an EARLIER request, so a token echoed back by
    // the provider in unrelated output came out as the real value (case-folded,
    // since the token replaced a case-insensitive match). Scoping the map to the
    // request that produced it removes both.
    let redactor = null;

    if (activeRedact) {
      // Scrub configured text values from string bodies. Numeric configured
      // values and pattern-detected PII cannot be tokenized by the redactor,
      // so after scrubbing we always run assertLlmRequestAllowed against the
      // body that will actually be sent. This preserves blocking when anything
      // the scrubber could not remove remains in the payload.
      if (typeof body === 'string') {
        redactor = makeRedactor(activeGuard);
        const scrubbed = redactor.scrub(body);
        if (scrubbed !== body) nextInit = { ...init, body: scrubbed };
        // Inspect the post-scrub body: block if numeric values or patterns remain.
        assertLlmRequestAllowed(url, scrubbed, { guard: activeGuard });
      } else {
        // Non-string body (undefined, Buffer, object): scrubbing is not
        // possible, so fall through to the same blocking check used in block
        // mode. This ensures non-string bodies are never silently bypassed.
        assertLlmRequestAllowed(url, body, { guard: activeGuard });
      }
    } else {
      // Blocking mode. Throws before any network activity on a finding.
      assertLlmRequestAllowed(url, body, { guard: activeGuard });
    }

    const response = await baseFetch(input, nextInit);

    // Rehydrate tokens in the response only when THIS request produced some.
    //
    // CAVEAT: this patches the two methods on the live response object and
    // nothing else. A caller that captured a reference to `response.text`
    // BEFORE this runs keeps the un-rehydrated version, and `response.body`
    // (the raw ReadableStream) is never rehydrated at all — a streaming caller
    // reads tokens straight off the wire. That is tolerable because redact mode
    // is the opt-in legacy path, not the default, and the workflows that use it
    // (`pii-workspace.mjs`) read the response as text. It is recorded here so
    // the gap is a known one rather than a surprise.
    if (redactor && redactor.tokens.size > 0) {
      const origText = response.text.bind(response);
      response.text = async () => redactor.rehydrate(await origText());
      response.json = async () => JSON.parse(redactor.rehydrate(await origText()));
    }

    return response;
  };

  return wrapped;
}

/**
 * Install the wrapper over `globalThis.fetch`.
 *
 * Idempotent: the second call returns the existing wrapper. Returns the wrapper
 * so a caller can restore it (`installPiiInterceptor` is what a test uses to
 * put the real `fetch` back).
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.target] Where to install. Defaults to `globalThis`.
 * @param {typeof fetch} [options.baseFetch] The function to wrap.
 * @param {import('./privacy-guard.mjs').PrivacyGuard} [options.guard]
 * @param {boolean} [options.redact]
 * @returns {typeof fetch}
 */
export function installPiiInterceptor({ target = globalThis, baseFetch, guard, redact } = {}) {
  if (target[INSTALLED]) return target[INSTALLED].wrapped;
  const base = baseFetch ?? target.fetch;
  if (typeof base !== 'function') return base;

  const wrapped = wrapFetch(base, {
    guard,
    redact,
  });

  const record = { wrapped, base };
  target[INSTALLED] = record;
  target.fetch = wrapped;
  return wrapped;
}

/** Remove the wrapper, restoring the original `fetch`. For tests and teardown. */
export function uninstallPiiInterceptor({ target = globalThis } = {}) {
  const record = target[INSTALLED];
  if (!record) return false;
  target.fetch = record.base;
  delete target[INSTALLED];
  return true;
}

// Auto-install on import. This is the whole point of the `--import` form:
// a script that lists this file gets the guard without editing its fetch calls.
installPiiInterceptor();

export { PrivacyGuardError };
