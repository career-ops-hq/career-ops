/**
 * endpoint-headers.mjs — extra request headers some OpenAI-compatible
 * endpoints ask for, keyed by host.
 *
 * OpenCode Go (https://opencode.ai/zen/go/v1) was observed (2026-10-08) to
 * answer HTTP 400 MissingSessionID to a client that sends no session id. Its
 * docs ask clients to identify themselves with their own user agent and to
 * send a stable session id in `x-opencode-session` for each conversation:
 * https://opencode.ai/v2/docs/console/go/#where-can-i-use-it
 *
 * The match is the exact hostname: a lookalike such as `opencode.ai.evil.com`
 * must not receive the session id. Every other host gets no extra headers, so
 * OpenRouter, OpenAI and loopback servers behave as before.
 */

/**
 * Headers to merge into the request for `host`.
 *
 * @param {string} host - Hostname of the endpoint (`new URL(baseUrl).hostname`).
 * @param {string} sessionId - Stable id for this conversation.
 * @param {string} [version] - career-ops version, for the User-Agent.
 * @returns {Record<string, string>} Extra headers; `{}` for any other host.
 */
export function endpointHeaders(host, sessionId, version = '1.0') {
  if (host !== 'opencode.ai') return {};
  return {
    'x-opencode-session': sessionId,
    'User-Agent': `career-ops/${version}`,
  };
}
